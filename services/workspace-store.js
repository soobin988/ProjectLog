const { createHash, randomUUID } = require('node:crypto');

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const stableId = (...parts) => {
  const hex = createHash('sha256').update(parts.join('\0')).digest('hex');
  return [hex.slice(0, 8), hex.slice(8, 12), '5' + hex.slice(13, 16), 'a' + hex.slice(17, 20), hex.slice(20, 32)].join('-');
};
const dateOnly = value => value ? String(value).slice(0, 10) : null;
const timestamp = value => value && Number.isFinite(+new Date(value)) ? new Date(value) : null;
const iso = value => value ? new Date(typeof value === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:/.test(value)
  ? value.replace(' ', 'T') + 'Z' : value).toISOString() : undefined;
const json = value => typeof value === 'string' ? JSON.parse(value) : value;
const publicFeedbackId = (node, item, index) => item.id || item.legacyId || 'legacy-' + (node.feedback.length - index);
const feedbackRowId = (node, item, index) => stableId('feedback', node.id, publicFeedbackId(node, item, index));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const conflict = () => Object.assign(new Error('Workspace changed'), { status: 409 });

// Old starter records reused short IDs between users. Scope only those IDs during import.
function normalizeRecords(uid, input) {
  const records = structuredClone({ projects: [], nodes: [], todos: [], readAlerts: [], ...input });
  for (const key of ['projects', 'nodes', 'todos', 'readAlerts']) {
    if (!Array.isArray(records[key])) throw new Error('Invalid workspace array: ' + key);
  }
  const projectIds = new Map(records.projects.map(item => [item.id, uuid.test(item.id) ? item.id : stableId(uid, 'project', item.id)]));
  const nodeIds = new Map(records.nodes.map(item => [item.id, uuid.test(item.id) ? item.id : stableId(uid, 'node', item.id)]));
  const source = value => value && ({ ...value, projectId: projectIds.get(value.projectId) || value.projectId,
    nodeId: nodeIds.get(value.nodeId) || value.nodeId });
  const alertIds = new Map();
  for (const node of records.nodes) {
    const oldId = node.id;
    node.feedback ||= [];
    const mapped = nodeIds.get(oldId);
    alertIds.set('issue-' + oldId, 'issue-' + mapped);
    for (const [index, item] of node.feedback.entries()) {
      const key = publicFeedbackId(node, item, index);
      const suffix = item.id || key.slice('legacy-'.length);
      alertIds.set('feedback-' + oldId + '-' + suffix, 'feedback-' + mapped + '-' + suffix);
      if (!item.id) item.legacyId = key;
      if (item.nextNodeId) item.nextNodeId = nodeIds.get(item.nextNodeId) || item.nextNodeId;
    }
    node.id = mapped;
    node.projectId = projectIds.get(node.projectId) || node.projectId;
    if (node.parentNodeId) node.parentNodeId = nodeIds.get(node.parentNodeId) || node.parentNodeId;
    if (node.previousFeedback) node.previousFeedback = source(node.previousFeedback);
  }
  records.projects = records.projects.map(item => ({ ...item, id: projectIds.get(item.id) }));
  records.todos = records.todos.map(item => ({ ...item,
    id: uuid.test(item.id) ? item.id : stableId(uid, 'todo', item.id),
    projectId: projectIds.get(item.projectId) || item.projectId || '', feedbackSource: source(item.feedbackSource)
  }));
  records.readAlerts = records.readAlerts.map(id => alertIds.get(id) || id);
  return { records, projectIds, nodeIds };
}

async function readWorkspaceRows(db, uid, options) {
  const [[workspace]] = await db.execute('SELECT version, storage_version FROM projectlog_workspaces WHERE uid = ?', [uid]);
  if (!workspace || workspace.storage_version !== 1) {
    throw Object.assign(new Error('Run scripts/migrate-records.js before loading this workspace'), { status: 503 });
  }
  const [projectRows] = await db.execute('SELECT * FROM projects WHERE user_id = ? ORDER BY sort_order', [uid]);
  const projectCondition = options.projectId ? ' AND p.id = ?' : '';
  const nodeParams = options.projectId ? [uid, options.projectId] : [uid];
  const [nodeRows] = options.nodes === false ? [[]] : await db.execute(`SELECT n.* FROM nodes n JOIN projects p ON p.id = n.project_id
    WHERE p.user_id = ? ${projectCondition} ORDER BY n.sort_order`, nodeParams);
  const [revisionRows] = !nodeRows.length ? [[]] : await db.execute(`SELECT r.* FROM node_revisions r JOIN nodes n ON n.id = r.node_id
    JOIN projects p ON p.id = n.project_id WHERE p.user_id = ? ${projectCondition}
    ${options.history === false ? 'AND NOT EXISTS (SELECT 1 FROM node_revisions newer WHERE newer.node_id=r.node_id AND newer.version>r.version)' : ''}
    ORDER BY r.version`, nodeParams);
  const [fileRows] = !nodeRows.length ? [[]] : await db.execute(`SELECT f.* FROM node_files f JOIN nodes n ON n.id = f.node_id
    JOIN projects p ON p.id = n.project_id WHERE p.user_id = ? ${projectCondition} ORDER BY f.sort_order`, nodeParams);
  const [feedbackRows] = !nodeRows.length ? [[]] : await db.execute(`SELECT f.* FROM feedbacks f JOIN nodes n ON n.id = f.node_id
    JOIN projects p ON p.id = n.project_id WHERE p.user_id = ? ${projectCondition} ORDER BY f.sort_order`, nodeParams);
  const [actions] = !nodeRows.length ? [[]] : await db.execute(`SELECT a.* FROM feedback_actions a JOIN nodes n ON n.id = a.node_id
    JOIN projects p ON p.id = n.project_id WHERE p.user_id = ? ${projectCondition} ORDER BY a.created_at, a.id`, nodeParams);
  const [todoRows] = options.todos === false ? [[]] : await db.execute(`SELECT t.*, f.public_id, f.node_id, n.project_id AS source_project_id
    FROM todos t LEFT JOIN feedbacks f ON f.id = t.feedback_id LEFT JOIN nodes n ON n.id = f.node_id
    WHERE t.user_id = ? ORDER BY t.sort_order`, [uid]);
  const [alertRows] = options.alerts === false ? [[]] : await db.execute('SELECT alert_key FROM alerts WHERE user_id = ? AND is_read = TRUE', [uid]);
  const nodeById = new Map(nodeRows.map(row => [row.id, row]));
  const previousFeedbackByNode = new Map(feedbackRows.filter(row => row.next_node_id).map(row => [row.next_node_id, row]));
  const feedbackById = new Map(feedbackRows.map(row => [row.id, row]));
  const revisions = Object.groupBy(revisionRows, row => row.node_id);
  const revisionById = new Map(revisionRows.map(row => [row.id, row]));
  const files = Object.groupBy(fileRows, row => row.node_id);
  const feedbacks = Object.groupBy(feedbackRows, row => row.node_id);
  const actionHistory = Object.groupBy(actions, row => row.feedback_id);
  const actionFor = row => ({ id: row.id, text: row.action_content,
    result: row.result === 'failed' ? 'fail' : row.result, note: row.result_note, createdAt: iso(row.created_at) });
  const records = {
    projects: projectRows.map(row => ({ id: row.id, name: row.title, summary: row.description, tech: row.technologies,
      progress: row.progress, color: row.color, category: row.category, icon: row.icon,
      startedDate: dateOnly(row.started_at) || '', completedDate: dateOnly(row.completed_at) || '', deadline: dateOnly(row.deadline) || '' })),
    nodes: nodeRows.map(row => {
      const history = revisions[row.id] || [];
      const current = history.at(-1);
      const feedback = (feedbacks[row.id] || []).map(item => {
        const history = (actionHistory[item.id] || []).map(actionFor);
        return { ...(item.is_legacy ? { legacyId: item.public_id } : { id: item.public_id }),
          mode: item.mode, style: item.style, request: item.request_content, text: item.content,
          selected: Boolean(item.selected), adoptedAt: iso(item.adopted_at), createdAt: iso(item.created_at),
          regeneratedFrom: feedbackById.get(item.regenerated_from)?.public_id, nextNodeId: item.next_node_id || undefined,
          highlights: json(item.highlights), underlines: json(item.underlines), action: history.at(-1), actions: history };
      });
      const previous = previousFeedbackByNode.get(row.id);
      return { id: row.id, projectId: row.project_id, parentNodeId: row.parent_node_id || null,
        title: row.title, type: row.type, note: row.content, status: row.status, errorStatus: row.error_status,
        issueType: row.issue_type, date: dateOnly(row.work_date), action: row.action_content, result: row.result_content,
        ai: { title: Boolean(row.title_ai), note: Boolean(row.content_ai), action: Boolean(row.action_ai), result: Boolean(row.result_ai) },
        artifactRequired: Boolean(row.artifact_required),
        revision: current ? { id: current.id, version: current.version, code: current.content, github: current.github,
          link: current.related_link, codeAi: Boolean(current.code_ai),
          files: (files[row.id] || []).map(file => ({ id: file.stored_name, name: file.original_name, type: file.file_type, size: Number(file.file_size) })) } : null,
        revisions: history.map(item => ({ id: item.id, version: item.version, code: item.content, github: item.github,
          link: item.related_link, title: item.snapshot_title, note: item.snapshot_content, createdAt: iso(item.created_at),
          files: (files[row.id] || []).filter(file => !file.revision_id || revisionById.get(file.revision_id)?.version <= item.version)
            .map(file => ({ id: file.stored_name, name: file.original_name, type: file.file_type })) })),
        feedback, pinnedFeedbackId: (feedbacks[row.id] || []).find(item => item.pinned)?.public_id || null,
        ...(previous ? { previousFeedback: { projectId: nodeById.get(previous.node_id).project_id,
          nodeId: previous.node_id, feedbackId: previous.public_id } } : {}) };
    }),
    todos: todoRows.map(row => ({ id: row.id, projectId: row.project_id || '', title: row.title, description: row.description,
      dueDate: dateOnly(row.due_date) || '', done: row.status === 'complete', completedAt: iso(row.completed_at),
      ...(row.feedback_id ? { feedbackSource: { projectId: row.source_project_id, nodeId: row.node_id, feedbackId: row.public_id } } : {}) })),
    readAlerts: alertRows.map(row => row.alert_key)
  };
  return { uid, version: workspace.version, records, readOnly: Boolean(options.readOnly), scope: options.scope, projectId: options.projectId };
}

async function loadWorkspace(pool, uid, options = {}) {
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const workspace = await readWorkspaceRows(db, uid, options);
    await db.commit();
    return workspace;
  } catch (error) { await db.rollback(); throw error; }
  finally { db.release(); }
}

async function upsert(db, table, values, mutable = Object.keys(values).filter(key => key !== 'id' && key !== 'user_id')) {
  const keys = Object.keys(values);
  await db.execute(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})
    ON DUPLICATE KEY UPDATE ${mutable.map(key => key + ' = VALUES(' + key + ')').join(',')}`, keys.map(key => values[key] ?? null));
}

async function persistWorkspace(db, uid, records, previous = { projects: [], nodes: [], todos: [], readAlerts: [] }, { migration = false } = {}) {
  const projectIds = new Set(records.projects.map(item => item.id));
  const nodeById = new Map(records.nodes.map(item => [item.id, item]));
  if (projectIds.size !== records.projects.length || nodeById.size !== records.nodes.length ||
      new Set(records.todos.map(item => item.id)).size !== records.todos.length) throw new Error('Duplicate record ID');
  for (const node of records.nodes) {
    if (!projectIds.has(node.projectId)) throw new Error('Node references missing project: ' + node.id);
    const seen = new Set([node.id]);
    let parent = node.parentNodeId || node.previousFeedback?.nodeId;
    while (parent) {
      const target = nodeById.get(parent);
      if (!target || target.projectId !== node.projectId || seen.has(parent)) throw new Error('Invalid parent node relationship');
      seen.add(parent);
      parent = target.parentNodeId || target.previousFeedback?.nodeId;
    }
  }
  // Avoid cross-account writes even if IDs were supplied outside a normal route.
  for (const [table, ids] of [['projects', [...projectIds]], ['nodes', [...nodeById.keys()]], ['todos', records.todos.map(item => item.id)]]) {
    if (!ids.length) continue;
    const ownership = table === 'nodes' ? 'SELECT n.id FROM nodes n JOIN projects p ON p.id=n.project_id WHERE p.user_id <> ? AND n.id' : `SELECT id FROM ${table} WHERE user_id <> ? AND id`;
    const [other] = await db.execute(ownership + ` IN (${ids.map(() => '?')})`, [uid, ...ids]);
    if (other.length) throw new Error('Record belongs to another account');
  }
  const oldProjects = new Map(previous.projects.map(item => [item.id, item]));
  const oldNodes = new Map(previous.nodes.map(item => [item.id, item]));
  const oldTodos = new Map(previous.todos.map(item => [item.id, item]));
  const oldProjectOrder = new Map(previous.projects.map((item, index) => [item.id, index]));
  const oldNodeOrder = new Map(previous.nodes.map((item, index) => [item.id, index]));
  const oldTodoOrder = new Map(previous.todos.map((item, index) => [item.id, index]));
  const nextNodeOrder = new Map(records.nodes.map((item, index) => [item.id, index]));
  const changedNodes = records.nodes.filter((node, index) =>
    oldNodeOrder.get(node.id) !== index || !same(oldNodes.get(node.id), node));
  const feedbackIds = new Map();
  for (const node of records.nodes) {
    for (const [index, item] of (node.feedback || []).entries()) {
      feedbackIds.set(node.id + ':' + publicFeedbackId(node, item, index), feedbackRowId(node, item, index));
    }
  }
  const event = async (type, description, projectId = null, nodeId = null, progress = null, todoId = null) => db.execute(`INSERT INTO activity_logs
    (user_id, project_id, node_id, todo_id, activity_type, description, progress) VALUES (?, ?, ?, ?, ?, ?, ?)`, [uid, projectId, nodeId, todoId, type, description, progress]);
  for (const [index, project] of records.projects.entries()) {
    if (oldProjectOrder.get(project.id) === index && same(oldProjects.get(project.id), project)) continue;
    await upsert(db, 'projects', { id: project.id, user_id: uid, title: project.name || '', description: project.summary || '',
      technologies: project.tech || '', status: project.progress >= 100 ? 'complete' : 'work', progress: project.progress || 0,
      color: project.color || '#007fff', category: project.category || 'development', icon: project.icon || 'file',
      started_at: dateOnly(project.startedDate), completed_at: dateOnly(project.completedDate), deadline: dateOnly(project.deadline), sort_order: index });
    if (!same(oldProjects.get(project.id), project)) await event(oldProjects.has(project.id) ? 'project_updated' : 'project_created', project.name || '', project.id, null, project.progress || 0);
  }
  for (const node of changedNodes) {
    const index = nextNodeOrder.get(node.id);
    await upsert(db, 'nodes', { id: node.id, project_id: node.projectId, parent_node_id: null, title: node.title || '',
      type: node.type || 'work', content: node.note || '', status: node.status === 'complete' ? 'complete' : 'work',
      error_status: node.errorStatus ?? (['issue', 'resolved'].includes(node.status) ? node.status : ''), issue_type: node.issueType || '',
      work_date: node.date, action_content: node.action || '', result_content: node.result || '', title_ai: Boolean(node.ai?.title),
      content_ai: Boolean(node.ai?.note), action_ai: Boolean(node.ai?.action), result_ai: Boolean(node.ai?.result),
      artifact_required: Boolean(node.artifactRequired), sort_order: index });
    const before = oldNodes.get(node.id);
    const revisionState = item => ({ title: item?.title || '', note: item?.note || '', code: item?.revision?.code || '',
      github: item?.revision?.github || '', link: item?.revision?.link || '', codeAi: Boolean(item?.revision?.codeAi),
      files: (item?.revision?.files || []).map(file => file.id) });
    let latest = before?.revision;
    if (!latest?.id) {
      [[latest]] = await db.execute('SELECT id, version FROM node_revisions WHERE node_id = ? ORDER BY version DESC LIMIT 1', [node.id]);
    }
    if (!latest || !same(revisionState(before), revisionState(node))) {
      latest = { id: randomUUID(), version: (latest?.version || 0) + 1 };
      await db.execute(`INSERT INTO node_revisions (id, node_id, version, content, github, related_link, code_ai, snapshot_title, snapshot_content)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [latest.id, node.id, latest.version, node.revision?.code || '',
        node.revision?.github || '', node.revision?.link || '', Boolean(node.revision?.codeAi), node.title || '', node.note || '']);
      await event(before ? 'node_updated' : 'node_created', node.title || '', node.projectId, node.id);
    }
    const oldFiles = new Map((before?.revision?.files || []).map((file, index) => [file.id, { file, index }]));
    for (const [order, file] of (node.revision?.files || []).entries()) {
      const old = oldFiles.get(file.id);
      if (old?.index === order && same(old.file, file)) continue;
      await upsert(db, 'node_files', { id: stableId('file', node.id, file.id), node_id: node.id, revision_id: latest.id,
        original_name: file.name, stored_name: file.id, file_path: file.id, file_type: file.type, file_size: file.size || 0, sort_order: order },
      ['original_name', 'file_size', 'sort_order']);
    }
  }
  for (const node of changedNodes) {
    await db.execute('UPDATE nodes SET parent_node_id = ? WHERE id = ?', [node.parentNodeId || node.previousFeedback?.nodeId || null, node.id]);
    const before = oldNodes.get(node.id);
    const oldFeedback = new Map((before?.feedback || []).map((item, index) => [publicFeedbackId(before, item, index), item]));
    const oldFeedbackOrder = new Map((before?.feedback || []).map((item, index) => [publicFeedbackId(before, item, index), index]));
    for (const [index, item] of (node.feedback || []).entries()) {
      const key = publicFeedbackId(node, item, index);
      const id = feedbackRowId(node, item, index);
      const old = oldFeedback.get(key);
      const oldIndex = oldFeedbackOrder.get(key);
      if (oldIndex === index && same(old, item) && (before?.pinnedFeedbackId === key) === (node.pinnedFeedbackId === key)) continue;
      await upsert(db, 'feedbacks', { id, node_id: node.id, public_id: key, is_legacy: !item.id,
        mode: item.mode || '', style: item.style || item.tone || '', request_content: item.request || '', content: item.text || '',
        selected: Boolean(item.adoptedAt || item.selected), adopted_at: timestamp(item.adoptedAt), pinned: node.pinnedFeedbackId === key,
        highlights: JSON.stringify(item.highlights || []), underlines: JSON.stringify(item.underlines || []), sort_order: index,
        created_at: timestamp(item.createdAt) || new Date(node.date + 'T00:00:00Z') });
      if (!oldFeedback.has(key)) await event('feedback_created', node.title || '', node.projectId, node.id);
      if (item.action?.text) {
        const [[last]] = await db.execute('SELECT * FROM feedback_actions WHERE feedback_id = ? ORDER BY created_at DESC, id DESC LIMIT 1', [id]);
        const result = item.action.result === 'success' ? 'success' : ['fail', 'failed'].includes(item.action.result) ? 'failed' : 'pending';
        if (!last || last.action_content !== item.action.text || last.result !== result || last.result_note !== (item.action.note || '')) {
          await db.execute(`INSERT INTO feedback_actions (id, feedback_id, node_id, action_content, result, result_note)
            VALUES (?, ?, ?, ?, ?, ?)`, [randomUUID(), id, node.id, item.action.text, result, item.action.note || '']);
          await event('feedback_action', item.action.text, node.projectId, node.id);
        }
      }
    }
  }
  for (const node of changedNodes) {
    const before = oldNodes.get(node.id);
    const oldFeedback = new Map((before?.feedback || []).map((item, index) => [publicFeedbackId(before, item, index), item]));
    for (const [index, item] of (node.feedback || []).entries()) {
      const old = oldFeedback.get(publicFeedbackId(node, item, index));
      if (old && old.regeneratedFrom === item.regeneratedFrom && old.nextNodeId === item.nextNodeId) continue;
      const id = feedbackRowId(node, item, index);
      const regenerated = item.regeneratedFrom && feedbackIds.get(node.id + ':' + item.regeneratedFrom);
      await db.execute('UPDATE feedbacks SET regenerated_from = ?, next_node_id = ? WHERE id = ?',
        [regenerated || null, nodeById.has(item.nextNodeId) ? item.nextNodeId : null, id]);
    }
  }
  for (const [index, todo] of records.todos.entries()) {
    if (oldTodoOrder.get(todo.id) === index && same(oldTodos.get(todo.id), todo)) continue;
    const source = todo.feedbackSource;
    let feedbackId = source && feedbackIds.get(source.nodeId + ':' + source.feedbackId);
    // Todo-only requests retain a previously verified feedback link without loading every node.
    if (source && !feedbackId && !records.nodes.length && same(source, oldTodos.get(todo.id)?.feedbackSource)) {
      feedbackId = stableId('feedback', source.nodeId, source.feedbackId);
    }
    if (todo.projectId && !projectIds.has(todo.projectId)) throw new Error('Todo references missing project');
    await upsert(db, 'todos', { id: todo.id, user_id: uid, project_id: todo.projectId || null, feedback_id: feedbackId || null,
      title: todo.title, description: todo.description || '', status: todo.done ? 'complete' : 'pending', due_date: dateOnly(todo.dueDate),
      completed_at: timestamp(todo.completedAt), sort_order: index });
    const old = oldTodos.get(todo.id);
    if (!old || old.done !== todo.done || old.title !== todo.title) await event(todo.done ? 'todo_completed' : old ? 'todo_updated' : 'todo_created', todo.title, todo.projectId || null, null, null, todo.id);
  }
  // Cascades remove dependent rows; optional Todo/Portfolio project links survive as NULL.
  for (const old of previous.nodes) {
    const next = nodeById.get(old.id);
    if (!next) { await db.execute('DELETE FROM nodes WHERE id = ? AND project_id IN (SELECT id FROM projects WHERE user_id = ?)', [old.id, uid]); continue; }
    const keep = new Set((next.feedback || []).map((item, index) => feedbackRowId(next, item, index)));
    for (const [index, item] of (old.feedback || []).entries()) {
      const id = feedbackRowId(old, item, index);
      if (!keep.has(id)) await db.execute('DELETE FROM feedbacks WHERE id = ?', [id]);
    }
  }
  const todoIds = new Set(records.todos.map(item => item.id));
  for (const old of previous.todos) if (!todoIds.has(old.id)) await db.execute('DELETE FROM todos WHERE id = ? AND user_id = ?', [old.id, uid]);
  for (const old of previous.projects) if (!projectIds.has(old.id)) await db.execute('DELETE FROM projects WHERE id = ? AND user_id = ?', [old.id, uid]);
  const read = new Set(records.readAlerts);
  const oldRead = new Set(previous.readAlerts);
  for (const node of records.nodes) {
    const before = oldNodes.get(node.id);
    const oldFeedback = new Set((before?.feedback || []).map((item, index) => feedbackRowId(before, item, index)));
    const items = (node.feedback || []).map((item, index) => ({
      key: 'feedback-' + node.id + '-' + (item.id || publicFeedbackId(node, item, index).slice('legacy-'.length)),
      feedbackId: feedbackRowId(node, item, index), type: 'feedback', message: node.title || '', createdAt: timestamp(item.createdAt)
    }));
    if (node.errorStatus || ['issue', 'resolved'].includes(node.status)) items.push({ key: 'issue-' + node.id, type: 'issues', message: node.title || '' });
    else if (before?.errorStatus || ['issue', 'resolved'].includes(before?.status)) {
      await db.execute('DELETE FROM alerts WHERE user_id = ? AND alert_key = ?', [uid, 'issue-' + node.id]);
    }
    for (const item of items) {
      const existed = item.type === 'feedback' ? oldFeedback.has(item.feedbackId)
        : Boolean(before?.errorStatus || ['issue', 'resolved'].includes(before?.status));
      if (existed && before.title === node.title && oldRead.has(item.key) === read.has(item.key)) continue;
      await upsert(db, 'alerts', { user_id: uid, alert_key: item.key, node_id: node.id,
      feedback_id: item.feedbackId || null, type: item.type, message: item.message, is_read: read.has(item.key),
      created_at: item.createdAt || new Date(node.date + 'T00:00:00Z') }, ['message', 'is_read']);
    }
  }
  if (migration) await db.execute('UPDATE projectlog_workspaces SET storage_version = 1 WHERE uid = ?', [uid]);
}

async function saveWorkspace(pool, current, records) {
  if (current.readOnly) throw new Error('Cannot save a partial read-only workspace');
  if (current.scope === 'todos' && (records.nodes.length || !same(records.projects, current.records.projects)
      || !same(records.readAlerts, current.records.readAlerts))) {
    throw new Error('A Todo workspace can only modify Todos');
  }
  if (current.scope === 'projects' && (records.nodes.length || records.todos.length || records.readAlerts.length)) {
    throw new Error('A project creation workspace can only modify projects');
  }
  if (current.scope === 'project') {
    const otherProjects = list => list.filter(project => project.id !== current.projectId);
    if (records.nodes.some(node => node.projectId !== current.projectId)
        || !same(otherProjects(records.projects), otherProjects(current.records.projects))) {
      throw new Error('A project workspace cannot modify another project');
    }
  }
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const [result] = await db.execute(`UPDATE projectlog_workspaces SET version = version + 1
      WHERE uid = ? AND version = ? AND storage_version = 1`, [current.uid, current.version]);
    if (result.affectedRows !== 1) throw conflict();
    await persistWorkspace(db, current.uid, records, current.records);
    await db.commit();
    current.records = records;
    current.version++;
  } catch (error) { await db.rollback(); throw error; }
  finally { db.release(); }
}

module.exports = { normalizeRecords, persistWorkspace, loadWorkspace, saveWorkspace, stableId };
