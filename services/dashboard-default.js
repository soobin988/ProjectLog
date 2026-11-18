const { pool, ready } = require('./mysql');

const widgetIds = ['active', 'issues', 'calendar', 'today', 'recent', 'overview'];

function normalizeLayout(input) {
  if (!Array.isArray(input?.visible) || input.visible.some(id => !widgetIds.includes(id))) return null;
  const result = { visible: [...new Set(input.visible)] };
  for (const columns of [1, 6, 12]) {
    if (!input[columns] || typeof input[columns] !== 'object') continue;
    result[columns] = {};
    for (const id of result.visible) {
      const item = input[columns][id];
      if (!item) continue;
      const { column, span, y, height } = item;
      if (!Number.isInteger(column) || !Number.isInteger(span) || !Number.isFinite(y) ||
          column < 0 || span < 1 || column + span > columns || y < 0 || y > 20000 ||
          (height !== undefined && (!Number.isFinite(height) || height < 104 || height > 1400))) return null;
      result[columns][id] = { column, span, y, ...(height === undefined ? {} : { height }) };
    }
  }
  return result;
}

async function readDashboardDefault() {
  if (!pool) return null;
  const db = await ready();
  const [[row]] = await db.query('SELECT layout FROM projectlog_dashboard_settings WHERE id = 1');
  if (!row) return null;
  return normalizeLayout(typeof row.layout === 'string' ? JSON.parse(row.layout) : row.layout);
}

async function saveDashboardDefault(layout) {
  const db = await ready();
  const json = JSON.stringify(layout);
  await db.execute('INSERT INTO projectlog_dashboard_settings (id, layout) VALUES (1, ?) ON DUPLICATE KEY UPDATE layout = ?', [json, json]);
}

module.exports = { normalizeLayout, readDashboardDefault, saveDashboardDefault };
