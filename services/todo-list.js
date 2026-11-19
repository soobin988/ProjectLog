const { ready } = require('./mysql');
const { pageNumber } = require('./notifications');
const { validAnchor } = require('../calendar');

const fields = `SELECT t.*, f.public_id, f.node_id, n.project_id AS source_project_id
  FROM todos t LEFT JOIN feedbacks f ON f.id=t.feedback_id LEFT JOIN nodes n ON n.id=f.node_id`;
const todoFor = row => ({
  id: row.id, projectId: row.project_id || '', title: row.title, description: row.description,
  dueDate: row.due_date || '', done: row.status === 'complete',
  completedAt: row.completed_at ? new Date(String(row.completed_at).replace(' ', 'T') + 'Z').toISOString() : undefined,
  ...(row.feedback_id ? { feedbackSource: { projectId: row.source_project_id, nodeId: row.node_id, feedbackId: row.public_id } } : {})
});

async function todoList(uid, query = {}) {
  const db = await ready();
  const page = pageNumber(query.page);
  const completedOn = validAnchor(query.completedOn) ? query.completedOn : '';
  const params = [uid];
  let condition = '';
  if (completedOn) {
    const start = new Date(completedOn + 'T00:00:00+09:00');
    condition = ' AND t.completed_at >= ? AND t.completed_at < ?';
    params.push(start, new Date(+start + 86400000));
  }
  const [[pending], [completed]] = await Promise.all([
    db.execute(fields + " WHERE t.user_id=? AND t.status='pending' ORDER BY t.sort_order", [uid]),
    db.execute(fields + ` WHERE t.user_id=? AND t.status='complete' ${condition}
      ORDER BY t.completed_at DESC, t.id DESC LIMIT 31 OFFSET ${(page - 1) * 30}`, params)
  ]);
  const items = [...pending, ...completed.slice(0, 30)].map(todoFor);
  let editing = items.find(todo => todo.id === query.edit);
  if (!editing && typeof query.edit === 'string' && query.edit.length <= 80) {
    const [[row]] = await db.execute(fields + ' WHERE t.user_id=? AND t.id=?', [uid, query.edit]);
    if (row) { editing = todoFor(row); items.push(editing); }
  }
  const url = number => '/todos?' + new URLSearchParams({ page: number, ...(completedOn ? { completedOn } : {}) }) + '#todo-timeline';
  return { items, editing, completedOn,
    pagination: { previous: page > 1 ? url(page - 1) : '', next: completed.length > 30 ? url(page + 1) : '' } };
}

module.exports = { todoList };
