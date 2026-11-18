const path = require('node:path');
const { readFile } = require('node:fs/promises');
const { pool, ready, emptyWorkspace } = require('../services/mysql');
const { normalizeRecords, persistWorkspace, loadWorkspace } = require('../services/workspace-store');

async function importWorkspace() {
  const uid = process.argv[2] || '';
  if (!pool || !/^[1-9]\d{4}$/.test(uid)) {
    throw new Error('PROJECT_LOG_MYSQL_URL을 설정하고 기존 기록을 받을 회원 UID 5자리를 지정하세요.');
  }
  const file = process.env.PROJECT_LOG_DATA_FILE || path.resolve(__dirname, '..', 'project-log-data.json');
  const existing = JSON.parse(await readFile(file, 'utf8'));
  const records = normalizeRecords(Number(uid), { ...emptyWorkspace(), ...existing }).records;
  if (!['projects', 'nodes', 'todos', 'readAlerts'].every(key => Array.isArray(records[key]))) {
    throw new Error('기존 JSON 기록의 형식이 올바르지 않습니다.');
  }
  const db = await ready();
  const previous = await loadWorkspace(db, Number(uid));
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute('UPDATE projectlog_workspaces SET version = 1 WHERE uid = ? AND version = 0 AND storage_version = 1', [Number(uid)]);
    if (result.affectedRows !== 1) throw new Error('등록된 UID가 없거나 해당 계정에 이미 기록이 있습니다.');
    await persistWorkspace(connection, Number(uid), records, previous.records);
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
  console.log(`UID ${uid}의 계정으로 기존 기록을 옮겼습니다.`);
}

importWorkspace().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
}).finally(() => pool?.end());
