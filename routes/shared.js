const { randomUUID } = require('node:crypto');
const { projects, nodes, todos, saveData } = require('../db');
const { validAnchor } = require('../calendar');

const defaultColor = '#007fff';
const validColor = color => /^#[0-9a-f]{6}$/i.test(color);
const workStatuses = { work: '작업 중', complete: '작업 완료' };
const errorStatuses = { '': '문제 없음', issue: '문제 발생', resolved: '문제 해결' };
const workStatusFor = node => node?.status === 'complete' ? 'complete' : 'work';
function errorStatusFor(node) {
  const status = node?.errorStatus ?? node?.status;
  return status === 'issue' || status === 'resolved' ? status : '';
}
const isIssue = node => Boolean(errorStatusFor(node));
const isUnresolvedIssue = node => errorStatusFor(node) === 'issue';

const feedbackResults = { success: '성공', fail: '실패', pending: '진행 중' };

const seoulDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' });
const seoulTime = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
});

const projectFor = id => projects.find(project => project.id === id);
const latest = list => [...list].reverse().sort((a, b) => b.date.localeCompare(a.date));
const projectNodes = id => latest(nodes.filter(node => node.projectId === id));
const completedTodos = () => todos.filter(todo => todo.done && todo.completedAt)
  .sort((a, b) => b.completedAt.localeCompare(a.completedAt));
const completionDate = todo => seoulDate.format(new Date(todo.completedAt));
const completionTime = todo => seoulTime.format(new Date(todo.completedAt));
function timelineEntries(records, completions) {
  return [
    ...records.map(node => ({ date: node.date, projectId: node.projectId, node })),
    ...completions.map(todo => ({ date: completionDate(todo), projectId: todo.projectId || '', todo }))
  ].sort((a, b) => b.date.localeCompare(a.date));
}
const countIssues = list => list.filter(isIssue).length;
const countResolved = list => list.filter(node => errorStatusFor(node) === 'resolved').length;
const shortDate = date => date ? `${Number(date.slice(5, 7))}월 ${Number(date.slice(8, 10))}일` : '';
const value = (req, key) => typeof req.body?.[key] === 'string' ? req.body[key].trim() : '';

function todoFields(req, defaultDueDate = '') {
  return {
    title: value(req, 'title'), projectId: value(req, 'projectId'),
    dueDate: req.body?.dueDate === undefined ? defaultDueDate : value(req, 'dueDate')
  };
}

function todoError({ title, projectId, dueDate }) {
  if (!title || title.length > 160) return '할 일을 1~160자로 입력하세요.';
  if (projectId && !projectFor(projectId)) return '연결할 프로젝트를 다시 선택하세요.';
  if (dueDate && !validAnchor(dueDate)) return '할 일 날짜를 다시 선택하세요.';
  return '';
}

async function addTodo(fields) {
  const todo = { id: randomUUID(), ...fields, done: false };
  await saveData(projects, nodes, [todo, ...todos]);
  return todo;
}

function nodeDetailUrl(node) {
  return '/projects/' + node.projectId + '/nodes/' + node.id;
}

function feedbackSourceUrl({ projectId, nodeId, feedbackId }) {
  return nodeDetailUrl({ projectId, id: nodeId }) + '/feedback/' + feedbackId;
}

function feedbackIdFor(node, item, index = node.feedback.indexOf(item)) {
  return item.id || item.legacyId || 'legacy-' + (node.feedback.length - index);
}

const feedbackAlertId = (node, item, index) =>
  'feedback-' + node.id + '-' + (item.id || feedbackIdFor(node, item, index).slice('legacy-'.length));

function findFeedback(node, id) {
  return node.feedback.find((item, index) => feedbackIdFor(node, item, index) === id);
}

function feedbackEntries(node) {
  let number = 0;
  return [...node.feedback].reverse().map((item, index) => ({
    item,
    key: feedbackIdFor(node, item, node.feedback.length - index - 1),
    label: item.id ? 'Feedback #' + ++number : 'AI 피드백'
  }));
}

function withUpdatedFeedback(parent, feedback, changes) {
  return nodes.map(node => node.id === parent.id
    ? { ...node, feedback: node.feedback.map(item => item === feedback ? { ...item, ...changes } : item) }
    : node);
}

function setProject(req, res, next, id) {
  req.project = projectFor(id);
  if (!req.project) return res.status(404).render('missing', { page: '', title: '페이지를 찾을 수 없습니다' });
  res.locals.project = req.project;
  next();
}

function setNode(req, res, next, id) {
  req.node = nodes.find(node => node.id === id && node.projectId === req.project.id);
  if (!req.node) return res.status(404).render('missing', { page: '', title: '페이지를 찾을 수 없습니다' });
  res.locals.node = req.node;
  next();
}

const base = '/projects/:projectId';
const projectUrl = req => `/projects/${req.project.id}`;

module.exports = { defaultColor, validColor, workStatuses, errorStatuses, workStatusFor, errorStatusFor,
  isIssue, isUnresolvedIssue, feedbackResults, seoulDate, projectFor, latest, projectNodes,
  completedTodos, completionDate, completionTime, timelineEntries, countIssues, countResolved, shortDate, value,
  todoFields, todoError, addTodo, feedbackSourceUrl, feedbackIdFor, feedbackAlertId, feedbackEntries, findFeedback, withUpdatedFeedback,
  setProject, setNode, base, projectUrl, nodeDetailUrl };
