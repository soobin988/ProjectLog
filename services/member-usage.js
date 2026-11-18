const { pool, ready } = require('./mysql');
const { currentMember } = require('./member-generation');

const activitySlotSeconds = 5;
const seoulOffset = 9 * 60 * 60;
const daySeconds = 24 * 60 * 60;
let initialized;

async function usageDb() {
  const db = await ready();
  initialized ||= (async () => {
    await db.query(`CREATE TABLE IF NOT EXISTS projectlog_activity (
      uid INT UNSIGNED NOT NULL,
      minute_slot INT UNSIGNED NOT NULL,
      active_slots SMALLINT UNSIGNED NOT NULL,
      PRIMARY KEY (uid, minute_slot),
      INDEX (minute_slot),
      FOREIGN KEY (uid) REFERENCES projectlog_users(uid) ON DELETE CASCADE
    ) ENGINE=InnoDB`);
    await db.query(`CREATE TABLE IF NOT EXISTS projectlog_ai_usage (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, uid INT UNSIGNED NOT NULL,
      recorded_at INT UNSIGNED NOT NULL, feature VARCHAR(20) NOT NULL, succeeded BOOLEAN NOT NULL,
      input_tokens INT UNSIGNED, output_tokens INT UNSIGNED, total_tokens INT UNSIGNED,
      INDEX (uid, recorded_at), INDEX (recorded_at),
      FOREIGN KEY (uid) REFERENCES projectlog_users(uid) ON DELETE CASCADE
    ) ENGINE=InnoDB`);
    const [columns] = await db.query(`SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='projectlog_ai_usage'`);
    const names = new Set(columns.map(row => row.COLUMN_NAME));
    for (const [name, definition] of Object.entries({
      project_id: 'VARCHAR(80) NULL', node_id: 'VARCHAR(80) NULL', feedback_id: 'CHAR(36) NULL',
      model: "VARCHAR(100) NOT NULL DEFAULT ''", estimated_cost: 'DECIMAL(14,8) NULL'
    })) if (!names.has(name)) await db.query('ALTER TABLE projectlog_ai_usage ADD COLUMN ' + name + ' ' + definition);
    const [keys] = await db.query(`SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='projectlog_ai_usage' AND CONSTRAINT_TYPE='FOREIGN KEY'`);
    const constraints = new Set(keys.map(row => row.CONSTRAINT_NAME));
    for (const [column, table] of [['project_id','projects'], ['node_id','nodes'], ['feedback_id','feedbacks']]) {
      const key = 'fk_ai_usage_' + column;
      if (!constraints.has(key)) await db.query(`ALTER TABLE projectlog_ai_usage ADD CONSTRAINT ${key}
        FOREIGN KEY (${column}) REFERENCES ${table}(id) ON DELETE SET NULL`);
    }
  })().catch(error => {
    initialized = undefined;
    throw error;
  });
  await initialized;
  return db;
}

async function recordActivity(uid, elapsedMs, generation) {
  const now = Date.now() / 1000;
  const start = now - elapsedMs / 1000;
  const buckets = new Map();
  // Count each five-second interval once across all of the member's tabs.
  for (let slot = Math.floor(start / activitySlotSeconds); slot <= Math.floor(now / activitySlotSeconds); slot++) {
    const midpoint = (slot + 0.5) * activitySlotSeconds;
    if (midpoint < start || midpoint >= now) continue;
    const minute = Math.floor(slot * activitySlotSeconds / 60);
    const bit = 1 << (slot % (60 / activitySlotSeconds));
    buckets.set(minute, (buckets.get(minute) || 0) | bit);
  }
  if (!buckets.size) return;
  const db = await usageDb();
  for (const [minute, slots] of buckets) {
    await db.execute(`INSERT INTO projectlog_activity (uid, minute_slot, active_slots)
      SELECT u.uid, ?, ? ${currentMember}
      ON DUPLICATE KEY UPDATE active_slots = active_slots | ?`, [minute, slots, uid, generation, slots]);
  }
}

const tokenCount = value => Number.isInteger(value) && value >= 0 && value <= 4_294_967_295 ? value : null;

async function trackAiResponse(uid, generation, feature, request, context = {}) {
  let response;
  const startedAt = Math.floor(Date.now() / 1000);
  try {
    response = await request();
    return response;
  } finally {
    if (pool && uid) {
      try {
        const db = await usageDb();
        const usage = response?.usage;
        const succeeded = Boolean(response?.output_text?.trim()) && (!response.status || response.status === 'completed');
        const [insert] = await db.execute(`INSERT INTO projectlog_ai_usage
          (uid, recorded_at, feature, succeeded, input_tokens, output_tokens, total_tokens, project_id, node_id, model)
          SELECT u.uid, ?, ?, ?, ?, ?, ?, ?, ?, ? ${currentMember}`, [startedAt, feature, succeeded,
          tokenCount(usage?.input_tokens), tokenCount(usage?.output_tokens), tokenCount(usage?.total_tokens),
          context.projectId || null, context.nodeId || null, context.model || '', uid, generation]);
        if (response && insert.insertId) response.projectLogUsageId = insert.insertId;
      } catch (error) {
        console.error('Unable to record AI usage:', error.code || error.name);
      }
    }
  }
}

async function linkFeedbackUsage(uid, usageId, feedbackId) {
  if (!pool || !uid || !usageId) return;
  const db = await usageDb();
  await db.execute(`UPDATE projectlog_ai_usage a JOIN feedbacks f ON f.id=? AND f.node_id=a.node_id
    SET a.feedback_id=f.id WHERE a.id=? AND a.uid=?`, [feedbackId, usageId, uid]);
}

const aiTotals = `COUNT(*) AS requests, COUNT(CASE WHEN succeeded = FALSE THEN 1 END) AS failures,
  COUNT(total_tokens) AS metered, COALESCE(SUM(input_tokens), 0) AS inputTokens,
  COALESCE(SUM(output_tokens), 0) AS outputTokens, COALESCE(SUM(total_tokens), 0) AS totalTokens`;
const activityTotal = `SUM(BIT_COUNT(active_slots)) * ${activitySlotSeconds}`;

function startOfPeriod(days) {
  if (!days) return 0;
  const today = Math.floor((Date.now() / 1000 + seoulOffset) / daySeconds);
  return (today - days + 1) * daySeconds - seoulOffset;
}

async function memberUsage(days) {
  const db = await usageDb();
  const from = startOfPeriod(days);
  const [rows] = await db.execute(`
    SELECT u.uid, u.username, u.display_name AS name, u.google_subject IS NOT NULL AS google,
      a.seconds, recent.lastActive, f.requests, f.failures, f.metered, f.inputTokens, f.outputTokens, f.totalTokens
    FROM projectlog_users u
    LEFT JOIN (
      SELECT uid, ${activityTotal} AS seconds
      FROM projectlog_activity WHERE minute_slot >= ? GROUP BY uid
    ) a ON a.uid = u.uid
    LEFT JOIN (
      SELECT uid, MAX(minute_slot) * 60 AS lastActive
      FROM projectlog_activity GROUP BY uid
    ) recent ON recent.uid = u.uid
    LEFT JOIN (
      SELECT uid, ${aiTotals}
      FROM projectlog_ai_usage WHERE recorded_at >= ? GROUP BY uid
    ) f ON f.uid = u.uid
    ORDER BY u.uid`, [from / 60, from]);
  return rows;
}

async function dailyUsage(uid, days) {
  const db = await usageDb();
  const from = startOfPeriod(days);
  const [[activity], [ai]] = await Promise.all([
    db.execute(`SELECT FLOOR((minute_slot * 60 + ${seoulOffset}) / ${daySeconds}) AS dateKey,
      ${activityTotal} AS seconds FROM projectlog_activity
      WHERE uid = ? AND minute_slot >= ? GROUP BY dateKey`, [uid, from / 60]),
    db.execute(`SELECT FLOOR((recorded_at + ${seoulOffset}) / ${daySeconds}) AS dateKey, ${aiTotals},
      COUNT(CASE WHEN feature = 'feedback' THEN 1 END) AS feedbackRequests
      FROM projectlog_ai_usage WHERE uid = ? AND recorded_at >= ? GROUP BY dateKey`, [uid, from])
  ]);
  const dates = new Map(activity.map(row => [Number(row.dateKey), row]));
  for (const row of ai) dates.set(Number(row.dateKey), { ...dates.get(Number(row.dateKey)), ...row });
  return [...dates.entries()].sort(([a], [b]) => b - a).map(([day, row]) => ({
    ...row, date: new Date(day * daySeconds * 1000).toISOString().slice(0, 10)
  }));
}

module.exports = { usageDb, recordActivity, trackAiResponse, linkFeedbackUsage, memberUsage, dailyUsage };
