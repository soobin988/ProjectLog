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

async function readWorkspace(uid) {
  const connection = await ready();
  return loadWorkspace(connection, uid);
}

async function useWorkspace(req, res, next) {
  workspace.run(await readWorkspace(req.user.uid), next);
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
