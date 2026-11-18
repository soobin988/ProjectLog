const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { persistWorkspace, loadWorkspace, saveWorkspace } = require('../services/workspace-store');

test('completing one Todo does not write unrelated nodes or revisions', async () => {
  for (const count of [10, 100, 1000]) {
    const projectId = randomUUID();
    const previous = {
      projects: [{ id: projectId, name: 'Project', progress: 0 }],
      nodes: Array.from({ length: count }, () => ({
        id: randomUUID(), projectId, title: 'Node', date: '2026-11-18', feedback: [],
        revision: { id: randomUUID(), version: 1, code: '', files: [] }
      })),
      todos: [{ id: randomUUID(), title: 'Todo', done: false }], readAlerts: []
    };
    const records = structuredClone(previous);
    records.todos[0].done = true;
    records.todos[0].completedAt = new Date().toISOString();
    const statements = [];
    await persistWorkspace({ execute: async sql => { statements.push(sql); return [[]]; } }, 10000, records, previous);
    assert.equal(statements.length, 5);
    assert.equal(statements.filter(sql => sql.startsWith('INSERT INTO todos')).length, 1);
    assert.equal(statements.filter(sql => sql.startsWith('INSERT INTO activity_logs')).length, 1);
    assert.ok(!statements.some(sql => /node_revisions|UPDATE nodes|INSERT INTO nodes/.test(sql)));
  }
});

test('partial Todo reads omit node history and cannot overwrite a workspace', async () => {
  const statements = [];
  const connection = {
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {},
    execute: async sql => {
      statements.push(sql);
      return sql.startsWith('SELECT version') ? [[{ version: 1, storage_version: 1 }]] : [[]];
    }
  };
  const pool = { getConnection: async () => connection };
  const workspace = await loadWorkspace(pool, 10000, { nodes: false, alerts: false, readOnly: true });
  assert.equal(statements.length, 3);
  assert.ok(!statements.some(sql => /node_revisions|node_files|feedback_actions/.test(sql)));
  await assert.rejects(saveWorkspace(pool, workspace, workspace.records), /partial read-only workspace/);
});
