const path = require('node:path');
const { AsyncLocalStorage } = require('node:async_hooks');
const { pool, ready } = require('./services/mysql');
const { loadWorkspace, saveWorkspace } = require('./services/workspace-store');

const dataFile = process.env.PROJECT_LOG_DATA_FILE || path.join(__dirname, 'project-log-data.json');
const uploadDirectory = path.resolve(dataFile + '.uploads');

if (!pool) throw new Error('PROJECT_LOG_MYSQL_URL을 설정하세요. 핵심 작업 기록은 MySQL 관계형 테이블에 저장합니다.');
const workspace = new AsyncLocalStorage();

function recordsFor(key) {
  return new Proxy([], {
    get(target, property) {
      const current = workspace.getStore();
      if (!current) throw new Error('A member workspace context is required');
      const records = current.records[key];
      const value = records[property];
      return typeof value === 'function' ? value.bind(records) : value;
    }
  });
}

const projects = recordsFor('projects');
const nodes = recordsFor('nodes');
const todos = recordsFor('todos');
const readAlerts = recordsFor('readAlerts');

async function readWorkspace(uid, options) {
  const connection = await ready();
  return loadWorkspace(connection, uid, options);
}

async function useWorkspace(req, res, next) {
  let options;
  if (req.method === 'GET' || req.method === 'HEAD') {
    options = { readOnly: true, history: req.path.endsWith('/revisions') };
    if (req.path === '/' || req.path === '/projects' || req.path === '/todos' || /^\/portfolio\/[^/]+\/files\//.test(req.path)) {
      options.nodes = false;
      options.alerts = false;
      options.todos = req.path === '/todos';
    }
    const projectPath = /^\/projects\/([^/]+)(?:\/|$)/.exec(req.path);
    if (projectPath) options.projectId = projectPath[1];
    const strip = /^\/projects\/([^/]+)\/strip$/.exec(req.path);
    if (strip) Object.assign(options, { projectId: strip[1], todos: false, alerts: false });
  }
  if (req.method === 'POST' && /^\/todos(?:\/|$)/.test(req.path)) {
    options = { nodes: false, alerts: false, scope: 'todos' };
  }
  if (req.method === 'POST' && req.path === '/projects') {
    options = { nodes: false, todos: false, alerts: false, scope: 'projects' };
  }
  const projectWrite = req.method === 'POST' && /^\/projects\/([^/]+)(?:\/|$)/.exec(req.path);
  if (projectWrite) options = { projectId: projectWrite[1], history: false, scope: 'project' };
  workspace.run(await readWorkspace(req.user.uid, options), next);
}

async function refreshWorkspace() {
  const current = workspace.getStore();
  if (current) Object.assign(current, await readWorkspace(current.uid));
}

async function saveData(nextProjects, nextNodes, nextTodos = todos, nextReadAlerts = readAlerts) {
  const records = {
    projects: [...nextProjects], nodes: [...nextNodes], todos: [...nextTodos], readAlerts: [...nextReadAlerts]
  };
  const current = workspace.getStore();
  if (current) {
    const connection = await ready();
    return saveWorkspace(connection, current, records);
  }
  throw new Error('A member workspace context is required');
}

module.exports = { projects, nodes, todos, readAlerts, saveData, dataFile, uploadDirectory, useWorkspace, refreshWorkspace };
