const express = require('express');
const path = require('node:path');
const { projects, nodes, todos, readAlerts, saveData, useWorkspace } = require('./db');
const { router: accounts, loadAccount, requireAccount, verifyRequestOrigin, handleAccountConnectionError } = require('./routes/accounts');
const { router: portfolio, publicRouter: sharedPortfolio } = require('./routes/portfolio');
const { parser: feedbackMarkdown } = require('./services/feedback-markdown');
const { buildCalendar, validAnchor } = require('./calendar');
const { readDashboardDefault } = require('./services/dashboard-default');
const { currentVersion, listUpdates } = require('./services/updates');
const { pool, ready } = require('./services/mysql');
const { userStatistics, dashboardActivity, dashboardSummary } = require('./services/workspace-statistics');

const { projectFor, projectNodes, workStatuses, errorStatuses, workStatusFor, errorStatusFor, isIssue,
  shortDate, defaultColor, validColor, completionDate, completionTime,
  feedbackSourceUrl, feedbackResults, feedbackIdFor, feedbackAlertId, feedbackEntries, seoulDate, timelineEntries, completedTodos,
  latest, isUnresolvedIssue, todoFields, todoError, addTodo, nodeDetailUrl } = require('./routes/shared');

const app = express();

app.disable('x-powered-by');
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.locals.currentVersion = currentVersion;
app.use(express.urlencoded({ extended: false, limit: '256kb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(verifyRequestOrigin);
app.use(loadAccount);
app.use(accounts);
app.use(require('./routes/developer'));
app.get('/updates', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ version: currentVersion, updates: await listUpdates() });
});
app.use(async (req, res, next) => {
  res.locals.feedbackMarkdown = await feedbackMarkdown;
  next();
});
app.use(sharedPortfolio);
app.use(requireAccount);
app.get('/statistics', async (req, res) => {
  if (!pool) return res.status(503).json({ error: '통계는 MySQL 모드에서 사용할 수 있어요.' });
  res.json(await userStatistics(await ready(), req.user.uid));
});
app.use(useWorkspace);

Object.assign(app.locals, { projectFor, projectNodes, workStatuses, errorStatuses, workStatusFor, errorStatusFor, isIssue,
  shortDate, defaultColor, validColor, completionDate, completionTime,
  feedbackSourceUrl, feedbackResults, feedbackIdFor, feedbackEntries, nodeDetailUrl });

function alerts() {
  const read = new Set(readAlerts);
  return nodes.flatMap(node => {
    const project = projectFor(node.projectId);
    const destination = '/projects/' + project.id;
    let feedbackNumber = node.feedback.filter(item => item.id).length;
    const items = node.feedback.map((feedback, index) => {
      return {
        id: feedbackAlertId(node, feedback, index), type: 'feedback', project,
        destination: feedbackSourceUrl({ projectId: project.id, nodeId: node.id, feedbackId: feedbackIdFor(node, feedback, index) }),
        title: (feedback.id ? 'Feedback #' + feedbackNumber-- : 'AI 피드백') + ' · ' + node.title,
        date: feedback.createdAt ? seoulDate.format(new Date(feedback.createdAt)) : node.date,
        createdAt: feedback.createdAt || '', excerpt: feedback.text
      };
    });
    if (isIssue(node)) items.push({
      id: 'issue-' + node.id, type: 'issues', project, destination: destination + '#node-' + node.id,
      title: node.title, date: node.date, createdAt: '', excerpt: node.note, status: errorStatuses[errorStatusFor(node)]
    });
    return items.map(item => ({ ...item, read: read.has(item.id) }));
  }).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}

app.get('/notifications', (req, res) => {
  const tab = req.query.tab === 'feedback' ? 'feedback' : 'issues';
  const items = alerts();
  res.render('notifications', {
    page: 'notifications', title: '알림', tab,
    groups: Object.groupBy(items.filter(item => item.type === tab), item => item.date),
    unreadIssues: items.filter(item => item.type === 'issues' && !item.read).length,
    unreadFeedback: items.filter(item => item.type === 'feedback' && !item.read).length
  });
});

app.post('/notifications/:alertId/read', async (req, res, next) => {
  const items = alerts();
  const item = items.find(alert => alert.id === req.params.alertId);
  if (!item) return next();
  if (!item.read) await saveData(projects, nodes, todos, [...readAlerts, item.id]);
  if (req.get('Accept') === 'application/json') {
    return res.json({ unread: items.filter(alert => !alert.read && alert.id !== item.id).length });
  }
  res.redirect(303, '/notifications?tab=' + item.type + '#alert-' + item.id);
});

app.get('/', async (req, res) => {
  const dashboardDefault = await readDashboardDefault();
  const today = seoulDate.format(new Date());
  const statistics = pool ? await dashboardSummary(await ready(), req.user.uid) : null;
  const activityRows = pool ? await dashboardActivity(await ready(), req.user.uid) : null;
  const nodeById = new Map(nodes.map(node => [node.id, node]));
  const flowNodes = activityRows ? activityRows.flowNodeIds.map(id => nodeById.get(id)).filter(Boolean) : nodes;
  const recent = activityRows ? activityRows.recentNodeIds.map(id => nodeById.get(id)).filter(Boolean) : latest(nodes).slice(0, 5);
  const entries = timelineEntries(flowNodes, completedTodos().reverse());
  const activity = Object.groupBy(entries.filter(entry => entry.date <= today), entry => entry.date);
  const { [today]: todayEntries = [], ...pastEntries } = activity;
  const notifications = alerts();
  const nextTodos = new Map();
  const dueDate = todo => validAnchor(todo.dueDate) ? todo.dueDate : '9999-12-31';
  for (const todo of todos) {
    if (todo.done || !todo.projectId) continue;
    const current = nextTodos.get(todo.projectId);
    if (!current || dueDate(todo) < dueDate(current)) nextTodos.set(todo.projectId, todo);
  }
  const addedTodo = todos.find(todo => todo.id === req.query.added && todo.dueDate === req.query.date);
  res.render('dashboard', {
    page: 'dashboard', title: '대시보드', projects, today, dashboardDefault, recent,
    todayLabel: new Intl.DateTimeFormat('ko-KR', {
      year: 'numeric', month: 'long', day: 'numeric', weekday: 'long', timeZone: 'UTC'
    }).format(new Date(today + 'T00:00:00Z')),
    todayEntries, pastEntries, nextTodos, addedTodo,
    calendar: buildCalendar(req.query, today, projects, entries,
      Object.groupBy(todos.filter(todo => todo.dueDate || !todo.done || todo.completedAt),
        todo => todo.dueDate || (todo.done ? completionDate(todo) : today))),
    progressProjects: projects.filter(project => project.progress < 100)
      .sort((a, b) => a.progress - b.progress).slice(0, 4),
    activeProjectCount: statistics ? Number(statistics.activeProjectCount) : projects.filter(project => project.progress < 100).length,
    remainingIssueCount: statistics ? statistics.remainingIssueCount : nodes.filter(isUnresolvedIssue).length,
    unreadAlerts: notifications.filter(item => !item.read).length,
    recentAlerts: notifications.slice(0, 5)
  });
});

function renderTodos(res, { draft = {}, editing, error = '', completedOn = '' } = {}) {
  const today = seoulDate.format(new Date());
  const completionsByDate = Object.groupBy(completedTodos(), completionDate);
  const { [today]: todayDone = [], ...pastTimeline } = completionsByDate;
  const pending = todos.filter(todo => !todo.done);
  const pastDone = [...Object.values(pastTimeline).flat(), ...todos.filter(todo => todo.done && !todo.completedAt)];
  res.render('todos', {
    page: 'todos', title: 'Todo List', projects, pending, today, todayDone, pastDone, pastTimeline,
    draft, editing, error, completedOn, matchingCompletions: completionsByDate[completedOn] || []
  });
}

app.get('/todos', (req, res) => renderTodos(res, {
  editing: todos.find(todo => todo.id === req.query.edit),
  completedOn: validAnchor(req.query.completedOn) ? req.query.completedOn : ''
}));
app.post('/todos', async (req, res) => {
  const draft = todoFields(req, seoulDate.format(new Date()));
  const error = todoError(draft);
  if (error) return renderTodos(res.status(422), { draft, error });
  await addTodo(draft);
  res.redirect('/todos');
});

async function calendarTodo(req, res, next) {
  const date = req.params.date;
  if (!validAnchor(date)) return next();
  const mode = req.query.view === 'month' ? 'month' : 'week';
  const calendarUrl = '/?view=' + mode + '&date=' + date;
  const draft = { ...todoFields(req), dueDate: date };
  let error = '';
  if (req.method === 'POST') {
    error = todoError(draft);
    if (!error) {
      const todo = await addTodo(draft);
      return res.redirect(303, calendarUrl + '&added=' + todo.id + '#calendar');
    }
  }
  res.status(error ? 422 : 200).render('calendar-todo-new', {
    page: 'dashboard', title: '캘린더 할 일 추가', projects, draft, error, back: calendarUrl + '#calendar'
  });
}

app.get('/todos/calendar/:date', calendarTodo);
app.post('/todos/calendar/:date', calendarTodo);

app.post('/todos/:todoId/:action', async (req, res, next) => {
  const { todoId, action } = req.params;
  const todo = todos.find(item => item.id === todoId);
  if (!todo || !['done', 'reopen', 'delete', 'edit'].includes(action)) return next();
  if (action === 'edit') {
    const editing = { ...todo, ...todoFields(req, todo.dueDate) };
    if (todo.feedbackSource) editing.projectId = todo.feedbackSource.projectId;
    const error = todoError(editing);
    if (error) return renderTodos(res.status(422), { editing, error });
    await saveData(projects, nodes, todos.map(item => item.id === todoId ? editing : item));
    return res.redirect('/todos#todo-' + todoId);
  }
  const returnUrl = validAnchor(req.query.completedOn) ? '/todos?completedOn=' + req.query.completedOn : '/todos';
  const done = action === 'done';
  if (action !== 'delete' && todo.done === done) return res.redirect(303, returnUrl);
  const completedAt = done ? new Date().toISOString() : null;
  const nextTodos = action === 'delete'
    ? todos.filter(item => item.id !== todoId)
    : todos.map(item => item.id === todoId ? { ...item, done, completedAt } : item);
  await saveData(projects, nodes, nextTodos);
  res.redirect(303, returnUrl);
});

app.use(require('./routes/projects'));
app.use(require('./routes/nodes').router);
app.use(require('./routes/feedbacks'));
app.use(portfolio);

app.use((req, res) => res.status(404).render('missing', { page: '', title: '페이지를 찾을 수 없습니다' }));
app.use(handleAccountConnectionError);
app.use((error, req, res, next) => {
  if (error.status !== 409 || res.headersSent) return next(error);
  res.status(409).send('기록이 다른 요청에서 변경됐어요. 새로고침 후 다시 시도해 주세요.');
});

if (require.main === module) {
  app.listen(process.env.PORT || 3000, process.env.PROJECT_LOG_HOST, () => console.log('Project Log is running.'));
}

module.exports = app;
