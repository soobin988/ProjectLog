const { readFile, unlink } = require('node:fs/promises');
const path = require('node:path');
const { dataFile, uploadDirectory } = require('../db');
const { ready, portfolioDb } = require('./mysql');
const { readMemberLimit } = require('./membership');
const { usageDb } = require('./member-usage');
const { removeFiles } = require('./portfolio-files');

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const attachmentIds = records => (records?.nodes || []).flatMap(node => (node.revision?.files || []).map(file => file.id));

async function findMember(uid) {
  const db = await ready();
  const [[member]] = await db.execute('SELECT uid, display_name AS name FROM projectlog_users WHERE uid = ?', [uid]);
  return member;
}

async function removeNodeFiles(db, ids) {
  if (!ids.length) return 0;
  let legacy = new Set();
  try {
    legacy = new Set(attachmentIds(JSON.parse(await readFile(dataFile, 'utf8'))));
  } catch (error) {
    if (error.code !== 'ENOENT') return ids.length;
  }
  let failed = 0;
  for (const id of new Set(ids)) {
    if (legacy.has(id)) continue;
    if (!uuid.test(id)) {
      failed++;
      continue;
    }
    try {
      const [[retained]] = db ? await db.execute('SELECT 1 AS retained FROM node_files WHERE stored_name = ? LIMIT 1', [id]) : [[]];
      if (!retained) await unlink(path.join(uploadDirectory, id));
    } catch (error) {
      if (error.code !== 'ENOENT') failed++;
    }
  }
  return failed;
}

async function removeMemberData(uid, deleteAccount) {
  const [db] = await Promise.all([portfolioDb(), usageDb()]);
  const connection = await db.getConnection();
  let nodeFiles = [];
  let portfolioFiles = [];
  try {
    await connection.beginTransaction();
    if (deleteAccount) await readMemberLimit(connection, true);
    const [[user]] = await connection.execute('SELECT uid FROM projectlog_users WHERE uid = ? FOR UPDATE', [uid]);
    if (!user) {
      await connection.rollback();
      return null;
    }
    await connection.execute('SELECT uid FROM projectlog_workspaces WHERE uid = ? FOR UPDATE', [uid]);
    const [attachments] = await connection.execute(`SELECT f.stored_name FROM node_files f JOIN nodes n ON n.id=f.node_id
      JOIN projects p ON p.id=n.project_id WHERE p.user_id = ?`, [uid]);
    nodeFiles = attachments.map(file => file.stored_name);
    const [files] = await connection.execute(`SELECT f.file_path AS path FROM portfolio_files f
      JOIN portfolios p ON p.id = f.portfolio_id WHERE p.user_id = ? FOR UPDATE`, [uid]);
    portfolioFiles = files;

    await connection.execute('DELETE FROM projectlog_sessions WHERE uid = ?', [uid]);
    await connection.execute('DELETE FROM projectlog_suggestions WHERE uid = ?', [uid]);
    await connection.execute('DELETE FROM projects WHERE user_id = ?', [uid]);
    await connection.execute('DELETE FROM todos WHERE user_id = ?', [uid]);
    await connection.execute('DELETE FROM alerts WHERE user_id = ?', [uid]);
    await connection.execute('DELETE FROM activity_logs WHERE user_id = ?', [uid]);
    if (deleteAccount) {
      await connection.execute('DELETE FROM projectlog_workspaces WHERE uid = ?', [uid]);
      await connection.execute('DELETE FROM projectlog_users WHERE uid = ?', [uid]);
    } else {
      await connection.execute('DELETE FROM projectlog_user_avatars WHERE uid = ?', [uid]);
      await connection.execute(`INSERT INTO projectlog_member_epochs (uid, generation)
        VALUES (?, 1) ON DUPLICATE KEY UPDATE generation = generation + 1`, [uid]);
      await connection.execute('DELETE FROM portfolios WHERE user_id = ?', [uid]);
      await connection.execute('DELETE FROM portfolio_pages WHERE user_id = ?', [uid]);
      await connection.execute('DELETE FROM portfolio_analyses WHERE user_id = ?', [uid]);
      await connection.execute('DELETE FROM projectlog_activity WHERE uid = ?', [uid]);
      await connection.execute('DELETE FROM projectlog_ai_usage WHERE uid = ?', [uid]);
      await connection.execute('UPDATE projectlog_workspaces SET version = version + 1 WHERE uid = ?', [uid]);
      const [columns] = await connection.query(`SELECT COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='projectlog_workspaces' AND COLUMN_NAME='legacy_records'`);
      if (columns.length) await connection.execute('UPDATE projectlog_workspaces SET legacy_records=NULL WHERE uid=?', [uid]);
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  const safePortfolioFiles = portfolioFiles.filter(file => uuid.test(file.path));
  const [nodeFailures, portfolioFailures] = await Promise.all([
    removeNodeFiles(db, nodeFiles), removeFiles(safePortfolioFiles)
  ]);
  const cleanupFailed = nodeFailures + portfolioFailures + portfolioFiles.length - safePortfolioFiles.length;
  if (cleanupFailed) console.error('Member attachment cleanup incomplete for UID %d (%d files)', uid, cleanupFailed);
  return { cleanupFailed };
}

module.exports = { findMember, removeMemberData, removeNodeFiles };
