const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const childProcess = require('node:child_process');

test('backup snapshots database and both upload folders, restarts on dump failure and hides credentials', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'projectlog-backup-test-'));
  const previous = { ...process.env };
  const argv = process.argv;
  const calls = [];
  let failDump = false;
  t.mock.method(childProcess, 'spawn', (command, args) => {
    calls.push([command, args]);
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.kill = () => {};
    setImmediate(async () => {
      try {
        if (command === 'mysqldump') {
          assert.ok(!args.join(' ').includes('private-password'));
          const config = args[0].slice('--defaults-extra-file='.length);
          assert.match(await fs.readFile(config, 'utf8'), /password="private-password"/);
          child.stdout.end('-- database snapshot');
          child.emit('close', failDump ? 1 : 0);
        } else if (command === 'tar' && args[0] === '-czf') {
          const staging = args[3];
          assert.equal(await fs.readFile(path.join(staging, 'database.sql'), 'utf8'), '-- database snapshot');
          assert.equal(await fs.readFile(path.join(staging, 'node-uploads', 'node.bin'), 'utf8'), 'node file');
          assert.equal(await fs.readFile(path.join(staging, 'portfolio-uploads', 'art.bin'), 'utf8'), 'portfolio file');
          assert.deepEqual(JSON.parse(await fs.readFile(path.join(staging, 'manifest.json'), 'utf8')).included,
            ['node-uploads', 'portfolio-uploads', 'legacy-data.json']);
          await fs.writeFile(args[1], 'archive fixture');
          child.emit('close', 0);
        } else { child.stdout.end(); child.emit('close', 0); }
      } catch (error) { child.emit('error', error); }
    });
    return child;
  });
  try {
    process.env.PROJECT_LOG_MYSQL_URL = 'mysql://fixture:private-password@127.0.0.1:3306/projectlog_test_backup';
    process.env.PROJECT_LOG_DATA_FILE = path.join(directory, 'data.json');
    process.env.PROJECT_LOG_PORTFOLIO_UPLOADS = path.join(directory, 'portfolio');
    process.env.PROJECT_LOG_BACKUPS = path.join(directory, 'backups');
    await fs.mkdir(process.env.PROJECT_LOG_DATA_FILE + '.uploads');
    await fs.mkdir(process.env.PROJECT_LOG_PORTFOLIO_UPLOADS);
    await fs.writeFile(process.env.PROJECT_LOG_DATA_FILE, '{}');
    await fs.writeFile(path.join(process.env.PROJECT_LOG_DATA_FILE + '.uploads', 'node.bin'), 'node file');
    await fs.writeFile(path.join(process.env.PROJECT_LOG_PORTFOLIO_UPLOADS, 'art.bin'), 'portfolio file');
    process.argv = ['node', 'backup.cjs', '--service', 'project-log'];
    const { main } = require('../scripts/backup.cjs');
    await main();
    assert.equal((await fs.readdir(process.env.PROJECT_LOG_BACKUPS)).length, 1);
    assert.deepEqual(calls.filter(([command]) => command === 'systemctl').map(([, args]) => args[0]), ['is-active', 'stop', 'start']);
    failDump = true;
    calls.length = 0;
    await assert.rejects(main(), /mysqldump failed/);
    assert.equal((await fs.readdir(process.env.PROJECT_LOG_BACKUPS)).length, 1);
    assert.deepEqual(calls.filter(([command]) => command === 'systemctl').map(([, args]) => args[0]), ['is-active', 'stop', 'start']);
    for (const [, args] of calls.filter(([command]) => command === 'mysqldump')) {
      await assert.rejects(fs.stat(args[0].slice('--defaults-extra-file='.length)), { code: 'ENOENT' });
    }
  } finally {
    process.argv = argv;
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
    await fs.rm(directory, { recursive: true, force: true });
  }
});
