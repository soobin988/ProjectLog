const assert = require('node:assert/strict');
const { normalizeRecords, loadWorkspace } = require('../services/workspace-store');

async function verifyRelational(db, compareLegacy = false) {
  if (compareLegacy) {
    const [columns] = await db.query(`SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='projectlog_workspaces' AND COLUMN_NAME='legacy_records'`);
    compareLegacy = columns.length > 0;
  }
  const [users] = await db.query('SELECT uid FROM projectlog_workspaces WHERE storage_version=1 ORDER BY uid');
  const results = [];
  for (const { uid } of users) {
    const { records } = await loadWorkspace(db, uid);
    const counts = { uid, projects: records.projects.length, nodes: records.nodes.length, todos: records.todos.length,
      feedbacks: records.nodes.reduce((sum, node) => sum + node.feedback.length, 0) };
    if (compareLegacy) {
      const [[row]] = await db.execute('SELECT legacy_records FROM projectlog_workspaces WHERE uid=?', [uid]);
      if (row?.legacy_records) {
        const { records: old } = normalizeRecords(uid, typeof row.legacy_records === 'string' ? JSON.parse(row.legacy_records) : row.legacy_records);
        for (const key of ['projects','nodes','todos']) assert.equal(records[key].length, old[key].length, 'Migrated row count: ' + key);
        assert.equal(counts.feedbacks, old.nodes.reduce((sum, node) => sum + (node.feedback || []).length, 0));
        for (const node of old.nodes) {
          const current = records.nodes.find(item => item.id === node.id);
          assert.equal(current.title, node.title || '');
          assert.equal(current.note, node.note || '');
          assert.deepEqual((current.revision?.files || []).map(file => file.id), (node.revision?.files || []).map(file => file.id));
          assert.deepEqual(current.feedback.map(item => item.text), node.feedback.map(item => item.text));
          assert.deepEqual(current.feedback.map(item => item.style), node.feedback.map(item => item.style || item.tone || ''));
          assert.equal(current.revision?.code || '', node.revision?.code || '');
          assert.equal(current.revision?.github || '', node.revision?.github || '');
        }
      }
    }
    results.push(counts);
  }
  const checks = [
    `SELECT COUNT(*) AS count FROM nodes n LEFT JOIN projects p ON p.id=n.project_id WHERE p.id IS NULL`,
    `SELECT COUNT(*) AS count FROM nodes n JOIN nodes parent ON parent.id=n.parent_node_id WHERE n.project_id<>parent.project_id`,
    `SELECT COUNT(*) AS count FROM node_files f LEFT JOIN nodes n ON n.id=f.node_id WHERE n.id IS NULL`,
    `SELECT COUNT(*) AS count FROM node_files f JOIN node_revisions r ON r.id=f.revision_id WHERE f.node_id<>r.node_id`,
    `SELECT COUNT(*) AS count FROM feedback_actions a LEFT JOIN feedbacks f ON f.id=a.feedback_id WHERE f.id IS NULL OR a.node_id<>f.node_id`,
    `SELECT COUNT(*) AS count FROM todos t JOIN projects p ON p.id=t.project_id WHERE t.user_id<>p.user_id`,
    `SELECT COUNT(*) AS count FROM portfolios f JOIN projects p ON p.id=f.project_id WHERE f.user_id<>p.user_id`
  ];
  for (const sql of checks) {
    const [[row]] = await db.query(sql);
    assert.equal(row.count, 0, 'Orphan/cross-owner check: ' + sql);
  }
  return results;
}

if (require.main === module) {
  const { pool, portfolioDb } = require('../services/mysql');
  (async () => {
    if (!pool) throw new Error('PROJECT_LOG_MYSQL_URL is required');
    await portfolioDb();
    console.log('Verified relational records:', await verifyRelational(pool, process.argv.includes('--compare-legacy')));
  })().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => pool?.end());
}

module.exports = { verifyRelational };
