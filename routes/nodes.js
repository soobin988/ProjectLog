const express = require('express');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { mkdirSync, unlinkSync, writeFileSync } = require('node:fs');
const { projects, nodes, todos, saveData, uploadDirectory } = require('../db');
const { pool, ready } = require('../services/mysql');
const { removeNodeFiles } = require('../services/member-removal');
const { extensionTypes, matchesFileType } = require('../services/attachment-types');

const { base, projectUrl, setProject, setNode, seoulDate, value, findFeedback, withUpdatedFeedback,
  feedbackEntries, nodeDetailUrl, workStatuses, errorStatuses, workStatusFor, errorStatusFor } = require('./shared');

const router = express.Router();
router.param('projectId', setProject);
router.param('nodeId', setNode);

const maxFiles = 8;
const maxFileBytes = 8 * 1024 * 1024;
const fileLimitMessage = `파일은 최대 ${maxFiles}개, 각 8MB까지 등록할 수 있습니다.`;

function renderEditor(res, node, uploading = false, error = '') {
  const followUp = res.locals.feedbackFollowUp;
  let title = node.id ? '수정' : uploading ? '수정본 업로드' : '노드 추가';
  if (followUp) title = '다음 노드 추가';
  res.render('editor', { page: 'projects', title, node, uploading, error, followUp, maxFiles });
}

const newNode = () => ({ date: seoulDate.format(new Date()), status: 'work', errorStatus: '' });
router.get(base + '/nodes/new', (req, res) => renderEditor(res, newNode()));
router.get(base + '/revisions/new', (req, res) => renderEditor(res, newNode(), true));
router.get(base + '/nodes/:nodeId', (req, res) => {
  const entries = feedbackEntries(req.node).reverse();
  const pinnedIndex = entries.findIndex(entry => entry.key === req.node.pinnedFeedbackId);
  if (pinnedIndex > 0) entries.unshift(entries.splice(pinnedIndex, 1)[0]);
  res.render('node-detail', { page: 'projects', title: req.node.title, entries });
});

function editorOrigin(req, res, next) {
  res.locals.nodeBack = req.query.from === 'node' ? nodeDetailUrl(req.node) : '';
  next();
}

router.get(base + '/nodes/:nodeId/edit', editorOrigin, (req, res) => renderEditor(res, req.node));

router.get(base + '/nodes/:nodeId/files/:fileId', (req, res, next) => {
  const file = req.node.revision?.files?.find(item => item.id === req.params.fileId);
  if (!file) return next();
  res.set('X-Content-Type-Options', 'nosniff');
  if (!file.type.startsWith('image/') || req.query.download === '1') {
    return res.download(file.id, file.name, { root: uploadDirectory });
  }
  res.type(file.type);
  res.sendFile(file.id, { root: uploadDirectory });
});

function webUrl(text) {
  if (!/^https?:\/\//i.test(text) || /\s/.test(text)) return null;
  try {
    const url = new URL(text);
    return url.username || url.password ? null : url;
  } catch {
    return null;
  }
}

const readUpload = express.raw({ type: 'multipart/form-data', limit: maxFiles * maxFileBytes + 1024 * 1024 });

function editorPost(uploading = false) {
  return (req, res, next) => {
    readUpload(req, res, error => {
      if (error?.type === 'entity.too.large') {
        const draft = res.locals.feedbackFollowUp ? newNode() : req.node || newNode();
        return renderEditor(res.status(413), draft, uploading, fileLimitMessage);
      }
      if (error) return next(error);
      saveNode(req, res, uploading).catch(next);
    });
  };
}

async function saveNode(req, res, uploading) {
  let uploads = [];
  if (Buffer.isBuffer(req.body)) {
    try {
      const form = await new Response(req.body, { headers: { 'Content-Type': req.get('Content-Type') } }).formData();
      uploads = form.getAll('files').filter(item => typeof item !== 'string' && item.name);
      req.body = Object.fromEntries([...form].filter(([, item]) => typeof item === 'string'));
    } catch {
      const draft = res.locals.feedbackFollowUp ? newNode() : req.node || newNode();
      return renderEditor(res.status(400), draft, uploading, '첨부 파일을 읽지 못했습니다. 파일을 다시 선택하세요.');
    }
  }

  // Read the latest node after parsing the request so concurrent feedback is preserved.
  const source = res.locals.feedbackFollowUp?.source;
  const current = !source && req.node && nodes.find(node => node.id === req.node.id);
  const fields = Object.fromEntries(['date', 'title', 'note', 'status'].map(key => [key, value(req, key)]));
  const legacyError = req.body?.errorStatus === undefined && errorStatusFor({ status: fields.status });
  fields.status = legacyError || !fields.status ? workStatusFor(current) : fields.status;
  fields.errorStatus = req.body?.errorStatus === undefined
    ? legacyError || errorStatusFor(current)
    : value(req, 'errorStatus');
  fields.issueType = req.body?.issueType === undefined ? current?.issueType || '' : value(req, 'issueType');
  fields.parentNodeId = source?.nodeId || (req.body?.parentNodeId === undefined ? current?.parentNodeId || null : value(req, 'parentNodeId') || null);
  if (fields.issueType.length > 80 || fields.note.length > 4000) return renderEditor(res.status(422), { ...current, ...fields }, uploading, '설명은 4,000자, 문제 유형은 80자까지 입력하세요.');
  const ancestors = new Set(current?.id ? [current.id] : []);
  let parentId = fields.parentNodeId;
  while (parentId) {
    const parent = nodes.find(item => item.id === parentId && item.projectId === req.project.id);
    if (!parent || ancestors.has(parentId)) return renderEditor(res.status(422), { ...current, ...fields }, uploading, '같은 프로젝트의 이전 노드를 선택하세요. 순환 연결은 만들 수 없어요.');
    ancestors.add(parentId);
    parentId = parent.parentNodeId || parent.previousFeedback?.nodeId;
  }
  const date = new Date(fields.date + 'T00:00:00Z');
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(fields.date) && Number.isFinite(+date) && date.toISOString().slice(0, 10) === fields.date;
  fields.ai = { ...current?.ai, title: value(req, 'titleAi') === 'yes', note: value(req, 'noteAi') === 'yes' };
  const code = typeof req.body?.code === 'string' && req.body.code.trim() ? req.body.code : '';
  const files = current?.revision?.files || [];
  const revision = { github: value(req, 'github'), link: value(req, 'link'), code, codeAi: value(req, 'codeAi') === 'yes', files };
  const hasArtifact = Boolean(revision.github || code || files.length || uploads.length);
  const hasRevision = hasArtifact || Boolean(revision.link);
  fields.artifactRequired = current?.artifactRequired ?? (!current && !uploading);
  fields.revision = hasRevision ? revision : null;
  const draft = { ...current, ...fields };
  if (!validDate || !Object.hasOwn(workStatuses, fields.status) || !Object.hasOwn(errorStatuses, fields.errorStatus)
      || fields.title.length > 120 || (!fields.artifactRequired && !fields.title)) {
    return renderEditor(res.status(422), draft, uploading, '제목, 날짜, 작업 상태, 문제 상태를 확인하세요.');
  }
  if (fields.artifactRequired && !hasArtifact) {
    return renderEditor(res.status(422), draft, uploading, 'GitHub 링크, 코드, ZIP, 이미지 중 하나 이상을 등록하세요.');
  }
  if (uploading && !hasRevision) {
    return renderEditor(res.status(422), draft, uploading, 'GitHub 링크, 코드, 관련 링크 또는 파일을 등록하세요.');
  }
  const githubUrl = webUrl(revision.github);
  const relatedUrl = webUrl(revision.link);
  if (revision.github && (githubUrl?.hostname !== 'github.com' || githubUrl.pathname === '/')) {
    return renderEditor(res.status(422), draft, uploading, 'github.com의 저장소, 커밋 또는 풀 리퀘스트 링크를 입력하세요.');
  }
  if (revision.link && !relatedUrl) {
    return renderEditor(res.status(422), draft, uploading, '관련 링크는 http:// 또는 https://로 시작하는 주소를 입력하세요.');
  }
  if (revision.github.length > 2048 || revision.link.length > 2048 || code.length > 10000) {
    return renderEditor(res.status(422), draft, uploading, '링크는 각각 2,048자, 코드는 10,000자까지 입력할 수 있습니다.');
  }
  if (files.length + uploads.length > maxFiles || uploads.some(file => file.size > maxFileBytes)) {
    return renderEditor(res.status(422), draft, uploading, fileLimitMessage);
  }
  const pending = [];
  for (const file of uploads) {
    const name = path.win32.basename(file.name).replace(/[\x00-\x1f\x7f]/g, '').slice(-180);
    const type = extensionTypes[path.extname(name).toLowerCase()];
    const bytes = Buffer.from(await file.arrayBuffer());
    if (!matchesFileType(bytes, type)) {
      return renderEditor(res.status(422), draft, uploading, 'ZIP, PNG, JPG, GIF, WEBP 형식의 파일을 선택하세요.');
    }
    pending.push({ file: { id: randomUUID(), name, type, size: bytes.length }, bytes });
  }
  revision.github = githubUrl?.href || '';
  revision.link = relatedUrl?.href || '';
  const latestNode = current && nodes.find(node => node.id === current.id);
  const existingFiles = latestNode?.revision?.files || [];
  if (existingFiles.length + pending.length > maxFiles) {
    return renderEditor(res.status(422), draft, uploading, fileLimitMessage);
  }
  revision.files = [...existingFiles, ...pending.map(item => item.file)];
  fields.revision = hasRevision || revision.files.length ? revision : null;
  if (!draft.title) {
    draft.title = (revision.files[0]?.name || githubUrl?.pathname.slice(1) || '코드 작업물').slice(0, 120);
  }
  let nextNodes = nodes;
  if (source) {
    const parent = nodes.find(node => node.id === source.nodeId && node.projectId === source.projectId);
    const feedback = findFeedback(parent, source.feedbackId);
    // Another request may have created the next node while this upload was being read.
    if (feedback.nextNodeId) return res.redirect(303, projectUrl(req) + '#node-' + feedback.nextNodeId);
    draft.id = randomUUID();
    draft.previousFeedback = source;
    nextNodes = withUpdatedFeedback(parent, feedback, { nextNodeId: draft.id });
  }
  const written = [];
  try {
    if (pending.length) mkdirSync(uploadDirectory, { recursive: true });
    for (const { file, bytes } of pending) {
      const destination = path.join(uploadDirectory, file.id);
      writeFileSync(destination, bytes, { flag: 'wx' });
      written.push(destination);
    }
    if (latestNode) {
      await saveData(projects, nodes.map(node => node.id === draft.id ? { ...node, ...fields, title: draft.title } : node));
    } else {
      draft.id ||= randomUUID();
      await saveData(projects, [...nextNodes, { ...draft, projectId: req.project.id, feedback: [] }]);
    }
  } catch (error) {
    for (const destination of written) unlinkSync(destination);
    throw error;
  }
  res.redirect(res.locals.nodeBack || `${projectUrl(req)}#node-${draft.id}`);
}

router.post(base + '/nodes/new', editorPost());
router.post(base + '/revisions/new', editorPost(true));
router.post(base + '/nodes/:nodeId/edit', editorOrigin, editorPost());
router.post(base + '/nodes/:nodeId/revisions', editorOrigin, editorPost(true));
router.get(base + '/nodes/:nodeId/revisions', (req, res) => {
  res.render('node-revisions', { page: 'projects', title: '수정 이력', node: req.node });
});
router.post(base + '/nodes/:nodeId/delete', async (req, res) => {
  const id = req.node.id;
  const nextNodes = nodes.filter(item => item.id !== id).map(item => ({ ...item,
    parentNodeId: item.parentNodeId === id ? null : item.parentNodeId,
    previousFeedback: item.previousFeedback?.nodeId === id ? undefined : item.previousFeedback,
    feedback: item.feedback.map(feedback => feedback.nextNodeId === id ? { ...feedback, nextNodeId: undefined } : feedback)
  }));
  const nextTodos = todos.map(item => item.feedbackSource?.nodeId === id ? { ...item, feedbackSource: undefined } : item);
  await saveData(projects, nextNodes, nextTodos);
  await removeNodeFiles(pool ? await ready() : null, (req.node.revision?.files || []).map(file => file.id));
  res.redirect(303, projectUrl(req));
});

module.exports = { router, renderEditor, newNode, editorPost };
