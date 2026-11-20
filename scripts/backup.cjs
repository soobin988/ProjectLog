// Run while the app is stopped, or use --service project-log to stop/restart systemd.
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');
const { createWriteStream } = require('node:fs');
const { spawn } = require('node:child_process');
const { pipeline } = require('node:stream/promises');

const root = path.resolve(__dirname, '..');
function run(command, args, output) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', output ? 'pipe' : 'ignore', 'ignore'], windowsHide: true });
    const stream = output ? pipeline(child.stdout, createWriteStream(output, { mode: 0o600, flags: 'wx' })) : Promise.resolve();
    const ended = new Promise((done, fail) => {
      child.once('error', fail);
      child.once('close', code => code === 0 ? done() : fail(new Error(`${command} failed (${code}); backup was not completed.`)));
    });
    Promise.all([ended, stream]).then(resolve, error => { child.kill(); reject(error); });
  });
}
const optionValue = value => '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r') + '"';

async function main() {
  const args = process.argv.slice(2);
  const serviceMode = args.length === 2 && args[0] === '--service' && /^[a-zA-Z0-9_.@-]+$/.test(args[1]);
  if (!serviceMode && !(args.length === 1 && args[0] === '--offline')) {
    throw new Error('Usage: node --env-file=.env scripts/backup.cjs --service project-log (or --offline after stopping every app process).');
  }
  const url = new URL(process.env.PROJECT_LOG_MYSQL_URL || '');
  if (url.protocol !== 'mysql:') throw new Error('A MySQL connection URL is required.');
  const dataFile = path.resolve(process.env.PROJECT_LOG_DATA_FILE || path.join(root, 'project-log-data.json'));
  const portfolio = path.resolve(process.env.PROJECT_LOG_PORTFOLIO_UPLOADS || path.join(root, 'uploads/portfolio'));
  const destination = path.resolve(process.env.PROJECT_LOG_BACKUPS || path.join(root, 'backups'));
  // Avoid recursively copying the backup staging directory into itself.
  for (const source of [dataFile + '.uploads', portfolio]) {
    const relative = path.relative(source, destination);
    if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) {
      throw new Error('Backup destination must be outside upload directories.');
    }
  }
  await fs.mkdir(destination, { recursive: true, mode: 0o700 });
  const staging = await fs.mkdtemp(path.join(destination, '.backup-'));
  await fs.chmod(staging, 0o700);
  const credentials = await fs.mkdtemp(path.join(os.tmpdir(), 'projectlog-backup-'));
  await fs.chmod(credentials, 0o700);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const archive = path.join(destination, `projectlog-${timestamp}.tar.gz`);
  const partial = archive + '.partial';
  let restart = false;
  try {
    if (serviceMode) {
      await run('systemctl', ['is-active', '--quiet', args[1]]);
      restart = true;
      await run('systemctl', ['stop', args[1]]);
    }
    const config = path.join(credentials, 'mysql.cnf');
    const settings = { host: url.hostname, port: url.port || '3306', user: decodeURIComponent(url.username), password: decodeURIComponent(url.password) };
    await fs.writeFile(config, '[client]\n' + Object.entries(settings).map(([key, value]) => key + '=' + optionValue(value)).join('\n') + '\n', { mode: 0o600 });
    await run('mysqldump', [`--defaults-extra-file=${config}`, '--single-transaction', '--quick', '--no-tablespaces', '--set-gtid-purged=OFF', '--hex-blob', '--', decodeURIComponent(url.pathname.slice(1))], path.join(staging, 'database.sql'));
    const sources = [[dataFile + '.uploads', 'node-uploads'], [portfolio, 'portfolio-uploads'], [dataFile, 'legacy-data.json']];
    const included = [];
    for (const [source, name] of sources) {
      try { await fs.stat(source); }
      catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      await fs.cp(source, path.join(staging, name), { recursive: true, dereference: false });
      included.push(name);
    }
    await fs.writeFile(path.join(staging, 'manifest.json'), JSON.stringify({ format: 1, createdAt: new Date().toISOString(), included }, null, 2), { mode: 0o600 });
    // Database and file snapshot are now fixed; resume before compression.
    if (restart) { await run('systemctl', ['start', args[1]]); restart = false; }
    const archiveHandle = await fs.open(partial, 'wx', 0o600);
    await archiveHandle.close();
    await run('tar', ['-czf', partial, '-C', staging, '.']);
    await fs.chmod(partial, 0o600);
    await run('tar', ['-tzf', partial]);
    await fs.rename(partial, archive);
    console.log('Backup completed:', archive);
  } finally {
    try { if (restart) await run('systemctl', ['start', args[1]]); }
    finally {
      await fs.rm(credentials, { recursive: true, force: true });
      await fs.rm(staging, { recursive: true, force: true });
      await fs.rm(partial, { force: true });
    }
  }
}
if (require.main === module) main().catch(() => {
  console.error('Backup failed. Check database credentials, mysqldump/tar, disk space and service status. No completed backup was published.');
  process.exitCode = 1;
});
module.exports = { main };
