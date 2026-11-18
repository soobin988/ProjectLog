const { ready } = require('./mysql');
const { lockMemberGeneration } = require('./member-generation');

const conflict = message => Object.assign(new Error(message), { status: 409 });

async function reserveFeedbackRequest(uid, generation, nodeId, requestId, fingerprint) {
  const pool = await ready();
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    // Serialize reservations across tabs and server processes for this member.
    await lockMemberGeneration(db, uid, generation);
    const [[node]] = await db.execute(`SELECT n.id FROM nodes n JOIN projects p ON p.id=n.project_id
      WHERE n.id=? AND p.user_id=?`, [nodeId, uid]);
    if (!node) throw conflict('작업 기록이 변경됐어요. 새로고침해 주세요.');
    const [[previous]] = await db.execute(`SELECT *, updated_at > UTC_TIMESTAMP() - INTERVAL 20 MINUTE AS recent
      FROM projectlog_feedback_requests WHERE user_id=? AND request_id=? FOR UPDATE`, [uid, requestId]);
    if (previous && (previous.node_id !== nodeId || previous.generation !== generation || previous.fingerprint !== fingerprint)) {
      throw conflict('요청 내용이 변경됐어요. 새로고침 후 다시 요청하세요.');
    }
    if (previous?.status === 'saved' || previous?.payload) {
      await db.commit();
      return { ...previous, payload: typeof previous.payload === 'string' ? JSON.parse(previous.payload) : previous.payload };
    }
    const [[pending]] = await db.execute(`SELECT request_id FROM projectlog_feedback_requests
      WHERE user_id=? AND status='generating' AND updated_at > UTC_TIMESTAMP() - INTERVAL 20 MINUTE LIMIT 1`, [uid]);
    if (pending) throw conflict('이미 피드백을 생성 중이에요. 결과를 기다린 뒤 다시 시도하세요.');
    await db.execute(`INSERT INTO projectlog_feedback_requests
      (user_id, request_id, generation, node_id, fingerprint, status) VALUES (?, ?, ?, ?, ?, 'generating')
      ON DUPLICATE KEY UPDATE status='generating', updated_at=UTC_TIMESTAMP(3)`,
    [uid, requestId, generation, nodeId, fingerprint]);
    await db.commit();
    return { status: 'generating' };
  } catch (error) {
    await db.rollback();
    throw error;
  } finally {
    db.release();
  }
}

async function saveFeedbackResponse(uid, requestId, payload) {
  const db = await ready();
  const [result] = await db.execute(`UPDATE projectlog_feedback_requests SET payload=?, status='ready'
    WHERE user_id=? AND request_id=? AND status='generating'`, [JSON.stringify(payload), uid, requestId]);
  if (!result.affectedRows) throw conflict('피드백 요청 상태가 변경됐어요. 새로고침해 주세요.');
}

async function finishFeedbackRequest(uid, requestId, status) {
  const db = await ready();
  await db.execute(`UPDATE projectlog_feedback_requests SET status=? ${status === 'saved' ? ', payload=NULL' : ''} WHERE user_id=? AND request_id=? ${status === 'failed' ? "AND status='generating'" : ''}`, [status, uid, requestId]);
}

module.exports = { reserveFeedbackRequest, saveFeedbackResponse, finishFeedbackRequest };
