const { randomUUID } = require('node:crypto');
const { ready } = require('./mysql');

const configured = Number(process.env.PROJECT_LOG_AI_CONCURRENCY || 2);
const concurrency = Number.isInteger(configured) && configured >= 1 && configured <= 8 ? configured : 2;

async function acquireAiSlot() {
  const pool = await ready();
  const db = await pool.getConnection();
  const token = randomUUID();
  let slot;
  try {
    await db.beginTransaction();
    [[slot]] = await db.execute(`SELECT id FROM projectlog_ai_slots
      WHERE id<=? AND (lease_token IS NULL OR expires_at<=UTC_TIMESTAMP())
      ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED`, [concurrency]);
    if (!slot) throw Object.assign(new Error('서버가 다른 AI 요청을 처리 중이에요. 잠시 후 다시 요청하세요.'), { code: 'AI_BUSY', status: 503 });
    await db.execute(`UPDATE projectlog_ai_slots SET lease_token=?, expires_at=UTC_TIMESTAMP()+INTERVAL 20 MINUTE WHERE id=?`, [token, slot.id]);
    await db.commit();
  } catch (error) {
    await db.rollback();
    throw error;
  } finally { db.release(); }
  return async () => {
    await pool.execute('UPDATE projectlog_ai_slots SET lease_token=NULL, expires_at=NULL WHERE id=? AND lease_token=?', [slot.id, token]);
  };
}

async function withAiSlot(work) {
  const release = await acquireAiSlot();
  try { return await work(); }
  finally {
    try { await release(); }
    catch (error) { console.error('Unable to release AI slot:', error.code || error.name); }
  }
}

module.exports = { acquireAiSlot, withAiSlot };
