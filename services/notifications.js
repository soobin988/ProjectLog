const { ready } = require('./mysql');
const { errorStatuses, feedbackSourceUrl } = require('../routes/shared');

const pageSize = 30;
const pageNumber = value => typeof value === 'string' && /^[1-9]\d{0,6}$/.test(value) ? Number(value) : 1;
const displayDate = `CASE WHEN a.type='issues' THEN n.work_date ELSE DATE(DATE_ADD(a.created_at, INTERVAL 9 HOUR)) END`;

async function unreadCounts(uid) {
  const db = await ready();
  const [[counts]] = await db.execute(`SELECT
    COALESCE(SUM(type='issues'),0) AS issues, COALESCE(SUM(type='feedback'),0) AS feedback
    FROM alerts WHERE user_id=? AND is_read=FALSE`, [uid]);
  return { issues: Number(counts.issues), feedback: Number(counts.feedback) };
}

async function listNotifications(uid, { tab, page = 1, limit = pageSize } = {}) {
  const db = await ready();
  const size = Math.min(pageSize, Math.max(1, limit));
  const [rows] = await db.execute(`SELECT a.alert_key, a.type, a.is_read, ${displayDate} AS display_date,
    a.created_at, n.id AS node_id, n.title, n.project_id, n.error_status,
    p.title AS project_title, p.color, f.public_id, f.is_legacy,
    CASE WHEN a.type='feedback' THEN LEFT(f.content,240) ELSE LEFT(n.content,240) END AS excerpt,
    CASE WHEN f.is_legacy=FALSE THEN (SELECT COUNT(*) FROM feedbacks numbered
      WHERE numbered.node_id=f.node_id AND numbered.is_legacy=FALSE AND numbered.sort_order>=f.sort_order) END AS feedback_number
    FROM alerts a JOIN nodes n ON n.id=a.node_id JOIN projects p ON p.id=n.project_id
    LEFT JOIN feedbacks f ON f.id=a.feedback_id
    WHERE a.user_id=? AND p.user_id=? ${tab ? 'AND a.type=?' : ''}
    ORDER BY display_date DESC, CASE WHEN a.type='feedback' THEN a.created_at END DESC, a.id DESC
    LIMIT ${size + 1} OFFSET ${(page - 1) * size}`, tab ? [uid, uid, tab] : [uid, uid]);
  const items = rows.slice(0, size).map(row => ({
    id: row.alert_key, type: row.type, read: Boolean(row.is_read), date: String(row.display_date), excerpt: row.excerpt,
    project: { id: row.project_id, name: row.project_title, color: row.color },
    title: row.type === 'feedback'
      ? (row.is_legacy ? 'AI 피드백' : 'Feedback #' + row.feedback_number) + ' · ' + row.title : row.title,
    status: row.type === 'issues' ? errorStatuses[row.error_status] : undefined,
    destination: row.type === 'feedback' ? feedbackSourceUrl({ projectId: row.project_id, nodeId: row.node_id, feedbackId: row.public_id })
      : '/projects/' + row.project_id + '#node-' + row.node_id
  }));
  return { items, hasMore: rows.length > size };
}

async function markNotificationRead(uid, alertId) {
  const pool = await ready();
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const [[workspace]] = await db.execute('SELECT uid FROM projectlog_workspaces WHERE uid=? FOR UPDATE', [uid]);
    const [[alert]] = await db.execute('SELECT type, is_read FROM alerts WHERE user_id=? AND alert_key=?', [uid, alertId]);
    if (!workspace || !alert) { await db.rollback(); return null; }
    if (!alert.is_read) {
      await db.execute('UPDATE alerts SET is_read=TRUE WHERE user_id=? AND alert_key=?', [uid, alertId]);
      await db.execute('UPDATE projectlog_workspaces SET version=version+1 WHERE uid=?', [uid]);
    }
    await db.commit();
    return alert;
  } catch (error) { await db.rollback(); throw error; }
  finally { db.release(); }
}

module.exports = { unreadCounts, listNotifications, markNotificationRead, pageNumber, pageSize };
