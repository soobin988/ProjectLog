const { buildCalendar, validAnchor } = require('../calendar');
const { pageNumber, pageSize } = require('./notifications');

const completionDay = 'DATE(DATE_ADD(t.completed_at, INTERVAL 9 HOUR))';
const nodeSummary = row => ({ id: row.id, projectId: row.project_id, title: row.title,
  status: row.status, errorStatus: row.error_status, date: String(row.date), ai: { title: Boolean(row.title_ai) } });
const todoSummary = row => ({ id: row.id, projectId: row.project_id || '', title: row.title, done: row.status === 'complete',
  dueDate: row.due_date || '', completedAt: row.completed_at ? new Date(row.completed_at.replace(' ', 'T') + 'Z').toISOString() : null,
  ...(row.public_id ? { feedbackSource: { projectId: row.source_project_id, nodeId: row.source_node_id, feedbackId: row.public_id } } : {}) });

async function dashboardData(db, uid, query, today, projects) {
  const page = pageNumber(query.flowPage);
  const [flow] = await db.execute(`SELECT * FROM (
      SELECT n.id,n.project_id,n.title,n.status,n.error_status,n.title_ai,n.work_date AS date,'node' AS kind,
        NULL AS public_id,NULL AS source_node_id,NULL AS source_project_id,n.sort_order AS node_order,NULL AS todo_time
      FROM nodes n JOIN projects p ON p.id=n.project_id WHERE p.user_id=? AND n.work_date<=?
        AND EXISTS (SELECT 1 FROM activity_logs a WHERE a.node_id=n.id AND a.user_id=?)
      UNION ALL
      SELECT t.id,t.project_id,t.title,t.status,'' AS error_status,FALSE AS title_ai,${completionDay} AS date,'todo' AS kind,
        f.public_id,f.node_id AS source_node_id,source.project_id AS source_project_id,NULL AS node_order,t.completed_at AS todo_time
      FROM todos t LEFT JOIN feedbacks f ON f.id=t.feedback_id LEFT JOIN nodes source ON source.id=f.node_id
      WHERE t.user_id=? AND t.status='complete' AND t.completed_at IS NOT NULL AND ${completionDay}<=?
    ) AS entries ORDER BY date DESC,kind,node_order,todo_time,id LIMIT ${pageSize + 1} OFFSET ${(page - 1) * pageSize}`, [uid, today, uid, uid, today]);
  const entries = flow.slice(0, pageSize).map(row => ({ date: String(row.date), projectId: row.project_id || '',
    ...(row.kind === 'node' ? { node: nodeSummary(row) } : { todo: { ...todoSummary(row), done: true } }) }));
  const [recent] = await db.execute(`SELECT n.id,n.project_id,n.title,n.status,n.error_status,n.title_ai,n.work_date AS date
    FROM nodes n JOIN (SELECT node_id,MAX(created_at) AS last_at,MAX(id) AS last_id FROM activity_logs
      WHERE user_id=? AND activity_type IN ('node_created','node_updated') AND node_id IS NOT NULL
      GROUP BY node_id ORDER BY last_at DESC,last_id DESC LIMIT 5) a ON a.node_id=n.id
    JOIN projects p ON p.id=n.project_id WHERE p.user_id=? ORDER BY a.last_at DESC,a.last_id DESC`, [uid, uid]);
  // Calendar project spans need only two dates per project, including history outside the visible month.
  const [bounds] = await db.execute(`SELECT project_id,MIN(date) AS first_date,MAX(date) AS last_date FROM (
    SELECT n.project_id,n.work_date AS date FROM nodes n JOIN projects p ON p.id=n.project_id
      WHERE p.user_id=? AND n.work_date<=? AND EXISTS (SELECT 1 FROM activity_logs a WHERE a.node_id=n.id AND a.user_id=?)
    UNION ALL
    SELECT t.project_id,${completionDay} AS date FROM todos t
      WHERE t.user_id=? AND t.project_id IS NOT NULL AND t.status='complete' AND t.completed_at IS NOT NULL AND ${completionDay}<=?
    ) AS activity GROUP BY project_id`, [uid, today, uid, uid, today]);
  const spanDates = bounds.flatMap(row => [{ projectId: row.project_id, date: String(row.first_date) },
    { projectId: row.project_id, date: String(row.last_date) }]);
  const window = buildCalendar(query, today, [], []);
  const firstDay = window.weeks[0].days[0];
  const lastDay = window.weeks.at(-1).days[6];
  const [calendarRows] = window.mode === 'month' ? [[]] : await db.execute(`SELECT t.id,t.project_id,t.title,t.status,
    t.due_date,t.completed_at,f.public_id,f.node_id AS source_node_id,source.project_id AS source_project_id,
    CASE WHEN t.due_date IS NOT NULL THEN t.due_date WHEN t.status='complete' THEN ${completionDay} ELSE ? END AS calendar_date
    FROM todos t LEFT JOIN feedbacks f ON f.id=t.feedback_id LEFT JOIN nodes source ON source.id=f.node_id
    WHERE t.user_id=? AND (t.due_date BETWEEN ? AND ? OR (t.due_date IS NULL AND (
      (t.status='complete' AND ${completionDay} BETWEEN ? AND ?) OR (t.status='pending' AND ? BETWEEN ? AND ?))))
    ORDER BY t.sort_order`, [today, uid, firstDay, lastDay, firstDay, lastDay, today, firstDay, lastDay]);
  const calendarTodos = Object.groupBy(calendarRows.map(row => ({ ...todoSummary(row), calendarDate: String(row.calendar_date) })), todo => todo.calendarDate);
  const progressProjects = projects.filter(project => project.progress < 100).sort((a, b) => a.progress - b.progress).slice(0, 4);
  const projectIds = progressProjects.map(project => project.id);
  const [nextRows] = projectIds.length ? await db.execute(`SELECT id,project_id,title,due_date FROM (
    SELECT id,project_id,title,due_date,ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY due_date IS NULL,due_date,sort_order) AS position
    FROM todos WHERE user_id=? AND status='pending' AND project_id IN (${projectIds.map(() => '?').join(',')})
    ) AS ranked WHERE position=1`, [uid, ...projectIds]) : [[]];
  let addedTodo;
  if (typeof query.added === 'string' && validAnchor(query.date)) {
    const [[added]] = await db.execute('SELECT id,title FROM todos WHERE user_id=? AND id=? AND due_date=?', [uid, query.added, window.anchor]);
    addedTodo = added;
  }
  const pageUrl = number => {
    const params = new URLSearchParams({ view: window.mode, date: window.anchor, flowPage: number });
    return '/?' + params + '#work-flow';
  };
  return { entries, recent: recent.map(nodeSummary), progressProjects, addedTodo,
    nextTodos: new Map(nextRows.map(row => [row.project_id, { id: row.id, title: row.title, dueDate: row.due_date || '' }])),
    calendar: buildCalendar(query, today, projects, spanDates, calendarTodos),
    flowPagination: { previous: page > 1 ? pageUrl(page - 1) : '', next: flow.length > pageSize ? pageUrl(page + 1) : '' } };
}

module.exports = { dashboardData };
