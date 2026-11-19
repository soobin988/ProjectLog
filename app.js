const express = require('express');
const path = require('node:path');
const { projects, nodes, todos, saveData, useWorkspace } = require('./db');
const { router: accounts, loadAccount, requireAccount, verifyRequestOrigin, handleAccountConnectionError } = require('./routes/accounts');
const { router: portfolio, publicRouter: sharedPortfolio } = require('./routes/portfolio');
const { router: files, publicRouter: sharedFiles } = require('./routes/files');
const { parser: feedbackMarkdown } = require('./services/feedback-markdown');
const { validAnchor } = require('./calendar');
const { readDashboardDefault } = require('./services/dashboard-default');
const { currentVersion, listUpdates } = require('./services/updates');
const { pool, ready } = require('./services/mysql');
const { userStatistics, dashboardSummary } = require('./services/workspace-statistics');
const { dashboardData } = require('./services/dashboard-data');
const { todoList } = require('./services/todo-list');
const { unreadCounts, listNotifications, markNotificationRead, pageNumber } = require('./services/notifications');

const { projectFor, projectNodes, workStatuses, errorStatuses, workStatusFor, errorStatusFor, isIssue,
  shortDate, defaultColor, validColor, completionDate, completionTime,
  feedbackSourceUrl, feedbackResults, feedbackIdFor, feedbackEntries, seoulDate,
  todoFields, todoError, addTodo, nodeDetailUrl } = require('./routes/shared');

const { assetUrl, assetHeaders } = require('./services/static-assets');

const app = express();
app.locals.assetUrl = assetUrl;

app.disable('x-powered-by');
// Same-host Nginx overwrites forwarded headers; trust only explicitly configured peers.
app.set('trust proxy', process.env.PROJECT_LOG_TRUST_PROXY === 'false' ? false
  : (process.env.PROJECT_LOG_TRUST_PROXY || 'loopback'));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.locals.currentVersion = currentVersion;
app.use(express.urlencoded({ extended: false, limit: '256kb' }));
app.use(express.static(path.join(__dirname, 'public'), { setHeaders: assetHeaders }));
app.use(verifyRequestOrigin);
app.use(loadAccount);
app.use(accounts);
app.use(require('./routes/developer'));
app.get('/updates', async (req, res) => {
  res.set('Cache-Control', 'private, no-cache');
  res.json({ version: currentVersion, ...await listUpdates(req.query.cursor) });
});
app.use(async (req, res, next) => {
  res.locals.feedbackMarkdown = await feedbackMarkdown;
  next();
});
app.use(sharedFiles);
app.use(sharedPortfolio);
app.use(requireAccount);
app.use(files);
app.get('/statistics', async (req, res) => {
  if (!pool) return res.status(503).json({ error: '통계는 MySQL 모드에서 사용할 수 있어요.' });
  res.json(await userStatistics(await ready(), req.user.uid));
});

Object.assign(app.locals, { projectFor, projectNodes, workStatuses, errorStatuses, workStatusFor, errorStatusFor, isIssue,
  shortDate, defaultColor, validColor, completionDate, completionTime,
  feedbackSourceUrl, feedbackResults, feedbackIdFor, feedbackEntries, nodeDetailUrl });

app.get('/notifications', async (req, res) => {
  const tab = req.query.tab === 'feedback' ? 'feedback' : 'issues';
  const page = pageNumber(req.query.page);
  const { items, hasMore } = await listNotifications(req.user.uid, { tab, page });
  const counts = await unreadCounts(req.user.uid);
  const pageUrl = number => '/notifications?tab=' + tab + '&page=' + number;
  res.render('notifications', {
    page: 'notifications', title: '알림', tab, notificationPage: page,
    groups: Object.groupBy(items, item => item.date), unreadIssues: counts.issues, unreadFeedback: counts.feedback,
    pagination: { previous: page > 1 ? pageUrl(page - 1) : '', next: hasMore ? pageUrl(page + 1) : '' }
  });
});

app.post('/notifications/:alertId/read', async (req, res) => {
  const item = await markNotificationRead(req.user.uid, req.params.alertId);
  if (!item) return res.status(404).render('missing', { page: '', title: '페이지를 찾을 수 없습니다' });
  if (req.get('Accept') === 'application/json') {
    const counts = await unreadCounts(req.user.uid);
    return res.json({ unread: counts.issues + counts.feedback });
  }
  res.redirect(303, '/notifications?tab=' + item.type + '&page=' + pageNumber(req.query.page) + '#alert-' + encodeURIComponent(req.params.alertId));
});

app.use(useWorkspace);

app.get('/', async (req, res) => {
  const dashboardDefault = await readDashboardDefault();
  const today = seoulDate.format(new Date());
  const statistics = await dashboardSummary(await ready(), req.user.uid);
  const data = await dashboardData(await ready(), req.user.uid, req.query, today, [...projects]);
  const activity = Object.groupBy(data.entries, entry => entry.date);
  const { [today]: todayEntries = [], ...pastEntries } = activity;
  const { items: recentAlerts } = await listNotifications(req.user.uid, { limit: 5 });
  const counts = await unreadCounts(req.user.uid);
  res.render('dashboard', {
    page: 'dashboard', title: '대시보드', projects, today, dashboardDefault, ...data,
    todayLabel: new Intl.DateTimeFormat('ko-KR', {
      year: 'numeric', month: 'long', day: 'numeric', weekday: 'long', timeZone: 'UTC'
    }).format(new Date(today + 'T00:00:00Z')),
    todayEntries, pastEntries,
    activeProjectCount: statistics.activeProjectCount,
    remainingIssueCount: statistics.remainingIssueCount,
    unreadAlerts: counts.issues + counts.feedback, recentAlerts
  });
});

function todoQuery(req) {
  const params = new URLSearchParams();
  const page = pageNumber(req.query.page);
  if (page > 1) params.set('page', page);
  if (validAnchor(req.query.completedOn)) params.set('completedOn', req.query.completedOn);
  return params.size ? '?' + params : '';
}

async function renderTodos(req, res, { draft = {}, editing, error = '' } = {}) {
  const listing = await todoList(req.user.uid, req.query);
  const { items, completedOn, pagination } = listing;
  editing ||= listing.editing;
  if (editing && !items.some(item => item.id === editing.id)) items.push(editing);
  const today = seoulDate.format(new Date());
  const completionsByDate = Object.groupBy(items.filter(todo => todo.done && todo.completedAt).sort((a,b) => b.completedAt.localeCompare(a.completedAt)), completionDate);
  const { [today]: todayDone = [], ...pastTimeline } = completionsByDate;
  const pending = items.filter(todo => !todo.done);
  const pastDone = [...Object.values(pastTimeline).flat(), ...items.filter(todo => todo.done && !todo.completedAt)];
  res.render('todos', {
    page: 'todos', title: 'Todo List', projects, pending, today, todayDone, pastDone, pastTimeline,
    draft, editing, error, completedOn, pagination, todoQuery: todoQuery(req), matchingCompletions: completionsByDate[completedOn] || []
  });
}

app.get('/todos', (req, res) => renderTodos(req, res));
app.post('/todos', async (req, res) => {
  const draft = todoFields(req, seoulDate.format(new Date()));
  const error = todoError(draft);
  if (error) return renderTodos(req, res.status(422), { draft, error });
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
    if (error) return renderTodos(req, res.status(422), { editing, error });
    await saveData(projects, nodes, todos.map(item => item.id === todoId ? editing : item));
    return res.redirect('/todos' + todoQuery(req) + '#todo-' + todoId);
  }
  const returnUrl = '/todos' + todoQuery(req);
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
