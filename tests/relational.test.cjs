const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { mkdtemp, readFile } = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const mysql = require('mysql2/promise');

const url = process.env.PROJECT_LOG_TEST_MYSQL_URL;
if (url && !/^projectlog_test_[a-z0-9_]+$/i.test(new URL(url).pathname.slice(1))) {
  throw new Error('Tests require an isolated database named projectlog_test_*');
}

test('relational migration and application flows', { skip: !url }, async t => {
  process.env.PROJECT_LOG_MYSQL_URL = url;
  process.env.PROJECT_LOG_DEVELOPER_UID = '10000';
  process.env.OPENAI_API_KEY = 'test-only';
  const folder = await mkdtemp(path.join(os.tmpdir(), 'projectlog-relational-test-'));
  process.env.PROJECT_LOG_DATA_FILE = path.join(folder, 'workspace.json');
  process.env.PROJECT_LOG_PORTFOLIO_UPLOADS = path.join(folder, 'portfolio');
  let requests = 0;
  let apiFailure = false;
  let saveFailure = false;
  const workspaceStore = require('../services/workspace-store');
  const originalSave = workspaceStore.saveWorkspace;
  workspaceStore.saveWorkspace = (...args) => {
    if (saveFailure) throw Object.assign(new Error('test storage unavailable'), { code: 'TEST_DB_UNAVAILABLE' });
    return originalSave(...args);
  };
  require.cache[require.resolve('../services/openai')] = { exports: { responses: {
    create: async () => {
      if (apiFailure) throw Object.assign(new Error('test API unavailable'), { status: 429, code: 'insufficient_quota' });
      return { status: 'completed', output_text: '## 확인\n테스트 분석 ' + ++requests,
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } };
    }
  } } };
  const { pool, portfolioDb } = require('../services/mysql');
  const { usageDb } = require('../services/member-usage');
  await portfolioDb();
  await usageDb();
  const [[existing]] = await pool.query('SELECT COUNT(*) AS count FROM projectlog_users');
  assert.equal(existing.count, 0, 'Use a fresh test database');
  const server = require('../app').listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const sql = async (query, params = []) => (await pool.execute(query, params))[0];
  const form = (route, body, cookie = '') => fetch(base + route, { method: 'POST', redirect: 'manual',
    headers: { Cookie: cookie }, body: body instanceof FormData ? body : new URLSearchParams(body) });
  let cookie, secondCookie;
  try {
    await t.test('signup creates relational starter records; tenant isolation', async () => {
      let response = await form('/register', { username: 'qa_first', password: 'testing-pass' });
      assert.equal(response.status, 303);
      cookie = response.headers.get('set-cookie').split(';')[0];
      response = await form('/register', { username: 'qa_second', password: 'testing-pass' });
      assert.equal(response.status, 303);
      secondCookie = response.headers.get('set-cookie').split(';')[0];
      const [firstProject] = await sql('SELECT id FROM projects WHERE user_id=10000');
      const blocked = await fetch(base + '/projects/' + firstProject.id, { headers: { Cookie: secondCookie } });
      assert.equal(blocked.status, 404);
      const rows = await sql('SELECT uid, storage_version FROM projectlog_workspaces');
      assert.equal(rows.length, 2);
      assert.ok(rows.every(row => row.storage_version === 1));
      assert.equal((await sql('SELECT * FROM todos')).length, 2);
    });
    let projectId, nodeId, feedbackUrl, secondFeedbackUrl;
    await t.test('project, node, file, revision, parent relationship', async () => {
      let response = await form('/projects', { name: 'Integration Project', summary: 'test', tech: 'Node.js', color: '#007fff', category: 'development', icon: 'file' }, cookie);
      assert.equal(response.status, 302);
      projectId = response.headers.get('location').split('/').at(-1);
      const data = new FormData();
      for (const [key, value] of Object.entries({ title: 'DB 연결', date: '2026-11-18', note: '문제 기록', status: 'work', errorStatus: 'issue', issueType: 'DB 연결', code: 'SELECT 1;' })) data.set(key, value);
      const png = Buffer.from('89504e470d0a1a0a00000000', 'hex');
      data.set('files', new Blob([png], { type: 'image/png' }), 'test.png');
      response = await form('/projects/' + projectId + '/nodes/new', data, cookie);
      assert.equal(response.status, 302, await response.text());
      [nodeId] = (await sql('SELECT id FROM nodes WHERE project_id=?', [projectId])).map(row => row.id);
      assert.equal((await sql('SELECT * FROM node_files WHERE node_id=?', [nodeId])).length, 1);
      response = await form('/projects/' + projectId + '/nodes/' + nodeId + '/edit', { title: 'DB 연결', date: '2026-11-18', note: '수정 기록', status: 'work', errorStatus: 'issue', issueType: 'DB 연결', code: 'SELECT 2;' }, cookie);
      assert.equal(response.status, 302);
      const history = await sql('SELECT version, content FROM node_revisions WHERE node_id=? ORDER BY version', [nodeId]);
      assert.deepEqual(history.map(row => row.version), [1, 2]);
      assert.equal(history[0].content, 'SELECT 1;');
      assert.equal(history[1].content, 'SELECT 2;');
    });
    await t.test('feedback generation and regeneration insert rows; actions retain history', async () => {
      const route = '/projects/' + projectId + '/nodes/' + nodeId + '/feedback';
      let response = await form(route, { style: 'mentor', request: '분석해 주세요' }, cookie);
      assert.equal(response.status, 303, await response.text());
      feedbackUrl = response.headers.get('location');
      response = await form(route + '?retry=' + feedbackUrl.split('/').at(-1), { style: 'strict', request: '다시 분석' }, cookie);
      assert.equal(response.status, 303);
      secondFeedbackUrl = response.headers.get('location');
      assert.equal((await sql('SELECT * FROM feedbacks WHERE node_id=?', [nodeId])).length, 2);
      response = await form(feedbackUrl + '/adopt', {}, cookie);
      assert.equal(response.status, 303);
      response = await form(feedbackUrl + '/action', { action: '권한 확인', result: 'pending' }, cookie);
      assert.equal(response.status, 303);
      response = await form(feedbackUrl + '/action', { action: '권한 수정', result: 'success', resultNote: '연결 성공' }, cookie);
      assert.equal(response.status, 303);
      const actions = await sql('SELECT result FROM feedback_actions WHERE node_id=? ORDER BY created_at', [nodeId]);
      assert.equal(actions.length, 2);
      assert.ok(actions.some(row => row.result === 'success'));
      assert.equal(Number((await sql('SELECT SUM(selected) AS count FROM feedbacks WHERE node_id=?', [nodeId]))[0].count), 1);
      const usage = await sql('SELECT * FROM projectlog_ai_usage WHERE uid=10000');
      assert.equal(usage.length, 2);
      assert.ok(usage.every(row => row.feedback_id && row.node_id === nodeId && row.total_tokens === 15));
    });
    await t.test('todo, parent chain, SQL aggregates and optimistic locking', async () => {
      let response = await form('/todos', { title: '후속 테스트', projectId }, cookie);
      assert.equal(response.status, 302);
      response = await form(feedbackUrl + '/next-node', { title: '재테스트', date: '2026-11-18', status: 'complete', errorStatus: 'resolved', code: 'SELECT 3;' }, cookie);
      assert.equal(response.status, 302, await response.text());
      const children = await sql('SELECT id FROM nodes WHERE parent_node_id=?', [nodeId]);
      assert.equal(children.length, 1);
      const stats = await (await fetch(base + '/projects/' + projectId + '/statistics', { headers: { Cookie: cookie } })).json();
      assert.equal(stats.nodeCount, 2);
      assert.equal(stats.issueCount, 2);
      assert.equal(stats.resolvedCount, 1);
      assert.equal(stats.feedbackCount, 2);
      assert.equal(stats.selectedFeedbackCount, 1);
      assert.equal(stats.actionCount, 2);
      assert.equal(stats.actionSuccessCount, 1);
      assert.equal(stats.feedbackAdoptionRate, 50);
      assert.equal(stats.issueResolutionRate, 50);
      const { loadWorkspace, saveWorkspace } = require('../services/workspace-store');
      const first = await loadWorkspace(pool, 10000), stale = await loadWorkspace(pool, 10000);
      await saveWorkspace(pool, first, first.records);
      await assert.rejects(saveWorkspace(pool, stale, stale.records), { status: 409 });
    });
    let portfolioId;
    await t.test('project progress, Todo CRUD, read alerts and independent node deletion', async () => {
      let response = await form('/projects/' + projectId + '/progress', { progress: '72' }, cookie);
      assert.equal(response.status, 302);
      assert.equal((await sql('SELECT progress FROM projects WHERE id=?', [projectId]))[0].progress, 72);
      const [todo] = await sql('SELECT id FROM todos WHERE title=? AND user_id=10000', ['후속 테스트']);
      response = await form('/todos/' + todo.id + '/edit', { title: '후속 테스트', projectId, dueDate: '2026-11-19' }, cookie);
      assert.equal(response.status, 302);
      response = await form('/todos/' + todo.id + '/done', {}, cookie);
      assert.equal(response.status, 303);
      assert.equal((await sql('SELECT status FROM todos WHERE id=?', [todo.id]))[0].status, 'complete');
      response = await form('/todos/' + todo.id + '/reopen', {}, cookie);
      assert.equal(response.status, 303);
      const [alert] = await sql('SELECT alert_key FROM alerts WHERE user_id=10000 AND node_id=? LIMIT 1', [nodeId]);
      response = await form('/notifications/' + encodeURIComponent(alert.alert_key) + '/read', {}, cookie);
      assert.equal(response.status, 303);
      assert.equal((await sql('SELECT is_read FROM alerts WHERE alert_key=?', [alert.alert_key]))[0].is_read, 1);
      response = await form('/projects/' + projectId + '/nodes/new', { title: '삭제 확인', date: '2026-11-18', status: 'work', code: 'test' }, cookie);
      assert.equal(response.status, 302);
      const [extra] = await sql('SELECT id FROM nodes WHERE title=? AND project_id=?', ['삭제 확인', projectId]);
      response = await form('/projects/' + projectId + '/nodes/' + extra.id + '/delete', {}, cookie);
      assert.equal(response.status, 303);
      assert.equal((await sql('SELECT * FROM node_revisions WHERE node_id=?', [extra.id])).length, 0);
    });
    await t.test('portfolio project FK, resource categories and analysis', async () => {
      let response = await form('/portfolio', { title: 'Linked Portfolio', description: 'test', projectId, visibility: 'private' }, cookie);
      assert.equal(response.status, 303, await response.text());
      portfolioId = response.headers.get('location').split('/').at(-1);
      response = await form('/portfolio/' + portfolioId + '/analyze', { analysisCategory: '*', analysisTags: 'strengths' }, cookie);
      assert.equal(response.status, 303, await response.text());
      assert.equal((await sql('SELECT * FROM portfolio_analyses WHERE portfolio_id=?', [portfolioId])).length, 1);
      const orphan = await pool.execute('INSERT INTO nodes (id,project_id,title,content,work_date,action_content,result_content,sort_order) VALUES (?,?,?,?,?,?,?,?)', [randomUUID(), randomUUID(), 'bad', '', '2026-11-18', '', '', 0]).then(() => null, error => error);
      assert.equal(orphan.code, 'ER_NO_REFERENCED_ROW_2');
    });
    await t.test('other members cannot read or mutate nodes, files, feedback, actions, Todos or Portfolios', async () => {
      const nodeUrl = '/projects/' + projectId + '/nodes/' + nodeId;
      const [file] = await sql('SELECT stored_name FROM node_files WHERE node_id=?', [nodeId]);
      const [todo] = await sql('SELECT id FROM todos WHERE title=? AND user_id=10000', ['후속 테스트']);
      for (const route of ['/projects/' + projectId, nodeUrl, nodeUrl + '/revisions', nodeUrl + '/files/' + file.stored_name,
        feedbackUrl, feedbackUrl + '/action', '/portfolio/' + portfolioId, '/portfolio/' + portfolioId + '/edit', '/portfolio/' + portfolioId + '/analysis']) {
        const response = await fetch(base + route, { headers: { Cookie: secondCookie } });
        assert.equal(response.status, 404, route);
      }
      for (const route of ['/projects/' + projectId + '/delete', nodeUrl + '/delete', nodeUrl + '/edit', feedbackUrl + '/delete',
        feedbackUrl + '/adopt', feedbackUrl + '/action', '/todos/' + todo.id + '/delete', '/todos/' + todo.id + '/edit',
        '/portfolio/' + portfolioId + '/edit', '/portfolio/' + portfolioId + '/delete', '/portfolio/' + portfolioId + '/analyze']) {
        const response = await form(route, { action: 'should not write', result: 'success' }, secondCookie);
        assert.equal(response.status, 404, route);
      }
      assert.equal((await sql('SELECT * FROM projects WHERE id=?', [projectId])).length, 1);
      const privateShare = await fetch(base + '/portfolio/shared/' + portfolioId);
      assert.equal(privateShare.status, 404);
    });
    await t.test('API errors and storage errors do not save partial feedback or stop the server', async () => {
      const before = (await sql('SELECT COUNT(*) AS count FROM feedbacks'))[0].count;
      const route = '/projects/' + projectId + '/nodes/' + nodeId + '/feedback';
      try {
        apiFailure = true;
        let response = await form(route, { style: 'mentor', request: '실패 확인' }, cookie);
        assert.equal(response.status, 502);
        apiFailure = false;
        saveFailure = true;
        response = await form(route, { style: 'mentor', request: '저장 실패 확인' }, cookie);
        assert.equal(response.status, 503);
      } finally { apiFailure = false; saveFailure = false; }
      assert.equal((await sql('SELECT COUNT(*) AS count FROM feedbacks'))[0].count, before);
      const health = await fetch(base + '/projects', { headers: { Cookie: cookie } });
      assert.equal(health.status, 200);
    });
    await t.test('existing pages render; delete cascades and optional links survive', async () => {
      for (const route of ['/', '/projects', '/todos', '/notifications', '/developer', '/statistics', '/projects/' + projectId,
        '/projects/' + projectId + '/nodes/' + nodeId + '/revisions', '/portfolio/' + portfolioId, '/portfolio/' + portfolioId + '/edit']) {
        const response = await fetch(base + route, { headers: { Cookie: cookie } });
        assert.equal(response.status, 200, route + ': ' + await response.text());
      }
      const response = await form('/projects/' + projectId + '/delete', {}, cookie);
      assert.equal(response.status, 303, await response.text());
      assert.equal((await sql('SELECT * FROM nodes WHERE project_id=?', [projectId])).length, 0);
      assert.equal((await sql('SELECT * FROM feedback_actions')).length, 0);
      assert.equal((await sql('SELECT * FROM node_revisions')).length, 0);
      assert.equal((await sql('SELECT project_id FROM portfolios WHERE id=?', [portfolioId]))[0].project_id, null);
      assert.equal((await sql('SELECT project_id FROM todos WHERE title=?', ['후속 테스트']))[0].project_id, null);
    });
    await t.test('member data reset and account removal clean relational children', async () => {
      const { removeMemberData } = require('../services/member-removal');
      assert.ok(await removeMemberData(10001, false));
      assert.equal((await sql('SELECT * FROM projectlog_users WHERE uid=10001')).length, 1);
      assert.equal((await sql('SELECT * FROM projects WHERE user_id=10001')).length, 0);
      assert.equal((await sql('SELECT * FROM todos WHERE user_id=10001')).length, 0);
      assert.ok(await removeMemberData(10001, true));
      assert.equal((await sql('SELECT * FROM projectlog_users WHERE uid=10001')).length, 0);
      assert.equal((await sql('SELECT * FROM projectlog_workspaces WHERE uid=10001')).length, 0);
    });
    await t.test('legacy migration is backed up and idempotent, including duplicate starter IDs', async () => {
      const legacyName = new URL(url).pathname.slice(1) + '_legacy';
      await pool.query('CREATE DATABASE ' + pool.escapeId(legacyName) + ' CHARACTER SET utf8mb4');
      const legacyUrl = new URL(url); legacyUrl.pathname = '/' + legacyName;
      const legacy = mysql.createPool({ uri: legacyUrl.href, dateStrings: true, timezone: 'Z' });
      try {
        await legacy.query('CREATE TABLE projectlog_users (uid INT UNSIGNED PRIMARY KEY, display_name VARCHAR(100)) ENGINE=InnoDB');
        await legacy.query('CREATE TABLE projectlog_workspaces (uid INT UNSIGNED PRIMARY KEY, records JSON NOT NULL, version INT UNSIGNED DEFAULT 0) ENGINE=InnoDB');
        const sample = require('../data');
        for (const uid of [10000, 10001]) {
          await legacy.execute('INSERT INTO projectlog_users VALUES (?, ?)', [uid, 'legacy']);
          await legacy.execute('INSERT INTO projectlog_workspaces (uid,records) VALUES (?,?)', [uid, JSON.stringify({ ...sample, readAlerts: [] })]);
        }
        const initialize = async () => {
          await require('../services/workspace-schema').createWorkspaceTables(legacy);
          await require('../services/portfolio-schema').createPortfolioTables(legacy);
        };
        const { migrateRecords } = require('../services/workspace-migration');
        const result = await migrateRecords(legacy, { backupDirectory: path.join(folder, 'backups'), initialize });
        assert.equal(result.migrated, 2);
        assert.match(await readFile(result.backup, 'utf8'), /INSERT INTO `projectlog_workspaces`/);
        const [counts] = await legacy.query('SELECT user_id, COUNT(*) AS count FROM projects GROUP BY user_id');
        assert.ok(counts.every(row => row.count === sample.projects.length));
        const [feedbacks] = await legacy.query('SELECT * FROM feedbacks');
        assert.equal(feedbacks.length, sample.nodes.reduce((count, node) => count + node.feedback.length, 0) * 2);
        await legacy.query("UPDATE feedbacks SET style='' WHERE is_legacy=TRUE");
        const again = await migrateRecords(legacy, { backupDirectory: path.join(folder, 'backups'), initialize });
        assert.equal(again.migrated, 0);
        assert.equal(again.skipped, 2);
        assert.ok(again.repairedFeedbackStyles > 0);
        const { loadWorkspace } = require('../services/workspace-store');
        const loaded = await loadWorkspace(legacy, 10000);
        assert.equal(loaded.records.projects.length, sample.projects.length);
        assert.equal(loaded.records.nodes.length, sample.nodes.length);
        assert.deepEqual(loaded.records.nodes.flatMap(node => node.feedback.map(item => item.style)),
          sample.nodes.flatMap(node => node.feedback.map(item => item.style || item.tone || '')));
      } finally { await legacy.end(); }
    });
  } finally {
    await new Promise(resolve => server.close(resolve));
    await pool.end();
  }
});
