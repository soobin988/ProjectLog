const path = require('node:path');
const { mkdir, writeFile } = require('node:fs/promises');
const { normalizeRecords, persistWorkspace, stableId } = require('./workspace-store');

async function backupDatabase(db, directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const [tables] = await db.query("SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'");
  const sql = ['-- Project Log backup before relational migration', 'SET FOREIGN_KEY_CHECKS=0;'];
  for (const row of tables) {
    const name = Object.values(row)[0];
    const identifier = db.escapeId(name);
    const [[definition]] = await db.query('SHOW CREATE TABLE ' + identifier);
    sql.push(definition['Create Table'] + ';');
    const [rows] = await db.query('SELECT * FROM ' + identifier);
    for (const item of rows) {
      const keys = Object.keys(item);
      const values = keys.map(key => {
        const value = item[key];
        return db.escape(value && typeof value === 'object' && !Buffer.isBuffer(value) && !(value instanceof Date) ? JSON.stringify(value) : value);
      });
      sql.push('INSERT INTO ' + identifier + ' (' + keys.map(key => db.escapeId(key)).join(',') + ') VALUES (' + values.join(',') + ');');
    }
  }
  sql.push('SET FOREIGN_KEY_CHECKS=1;');
  const file = path.join(directory, 'before-relational-' + new Date().toISOString().replace(/[:.]/g, '-') + '.sql');
  await writeFile(file, sql.join('\n'), { mode: 0o600, flag: 'wx' });
  return file;
}

async function migrateRecords(pool, { backupDirectory, initialize }) {
  const db = await pool.getConnection();
  let locked = false;
  try {
    const [[lock]] = await db.query("SELECT GET_LOCK('projectlog_records_migration', 0) AS acquired");
    if (!lock.acquired) throw new Error('Another workspace migration is running');
    locked = true;
    const backup = await backupDatabase(db, backupDirectory);
    await initialize();
    const [columns] = await db.query(`SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'projectlog_workspaces'`);
    const legacyColumn = columns.some(row => row.COLUMN_NAME === 'records') ? 'records'
      : columns.some(row => row.COLUMN_NAME === 'legacy_records') ? 'legacy_records' : null;
    const [workspaces] = await db.query('SELECT uid, storage_version' + (legacyColumn ? ', ' + legacyColumn + ' AS legacy_records' : '') + ' FROM projectlog_workspaces ORDER BY uid');
    let migrated = 0;
    let repairedFeedbackStyles = 0;
    for (const workspace of workspaces) {
      if (workspace.storage_version === 1) {
        if (workspace.legacy_records) {
          const legacy = typeof workspace.legacy_records === 'string' ? JSON.parse(workspace.legacy_records) : workspace.legacy_records;
          const { records } = normalizeRecords(workspace.uid, legacy);
          for (const node of records.nodes) for (const item of node.feedback) {
            if (!item.style && item.tone) {
              const [updated] = await db.execute("UPDATE feedbacks SET style=? WHERE id=? AND style=''",
                [item.tone, stableId('feedback', node.id, item.id || item.legacyId)]);
              repairedFeedbackStyles += updated.affectedRows;
            }
          }
        }
        continue;
      }
      if (!workspace.legacy_records) throw new Error('Missing legacy records for UID ' + workspace.uid);
      const legacy = typeof workspace.legacy_records === 'string' ? JSON.parse(workspace.legacy_records) : workspace.legacy_records;
      const { records, projectIds } = normalizeRecords(workspace.uid, legacy);
      await db.beginTransaction();
      try {
        const [[lockedWorkspace]] = await db.execute('SELECT storage_version FROM projectlog_workspaces WHERE uid = ? FOR UPDATE', [workspace.uid]);
        if (lockedWorkspace.storage_version === 1) { await db.rollback(); continue; }
        await persistWorkspace(db, workspace.uid, records, undefined, { migration: true });
        const [portfolios] = await db.execute('SELECT id, project_id FROM portfolios WHERE user_id = ? AND project_id IS NOT NULL', [workspace.uid]);
        for (const item of portfolios) {
          const projectId = projectIds.get(item.project_id);
          if (!projectId) throw new Error('Portfolio references a missing project: ' + item.id);
          await db.execute('UPDATE portfolios SET project_id = ? WHERE id = ?', [projectId, item.id]);
        }
        await db.commit();
        migrated++;
      } catch (error) { await db.rollback(); throw error; }
    }
    const [[orphans]] = await db.query(`SELECT COUNT(*) AS count FROM portfolios p
      LEFT JOIN projects pr ON pr.id=p.project_id AND pr.user_id=p.user_id
      WHERE p.project_id IS NOT NULL AND pr.id IS NULL`);
    if (orphans.count) throw new Error('Portfolio project links need manual review: ' + orphans.count);
    const [keys] = await db.query(`SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='portfolios' AND COLUMN_NAME='project_id' AND REFERENCED_TABLE_NAME='projects'`);
    // The original project may be removed while its published portfolio stays available.
    if (!keys.length) await db.query('ALTER TABLE portfolios ADD CONSTRAINT fk_portfolio_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL');
    if (legacyColumn === 'records') await db.query('ALTER TABLE projectlog_workspaces RENAME COLUMN records TO legacy_records');
    await db.query('ALTER TABLE projectlog_workspaces ALTER COLUMN storage_version SET DEFAULT 1');
    return { backup, migrated, skipped: workspaces.length - migrated, repairedFeedbackStyles };
  } finally {
    if (locked) await db.query("SELECT RELEASE_LOCK('projectlog_records_migration')");
    db.release();
  }
}

module.exports = { migrateRecords, backupDatabase };
