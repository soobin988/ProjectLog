const { Router } = require('express');
const { ready, portfolioDb } = require('../services/mysql');
const { uploadDirectory } = require('../db');
const { serveFile } = require('../services/portfolio-files');

const router = Router();
const publicRouter = Router();
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const missing = res => res.status(404).render('missing', { page: '', title: '페이지를 찾을 수 없습니다' });

router.get('/projects/:projectId/nodes/:nodeId/files/:fileId', async (req, res, next) => {
  if (!uuid.test(req.params.fileId)) return missing(res);
  const db = await ready();
  const [[file]] = await db.execute(`SELECT f.stored_name, f.original_name, f.file_type
    FROM node_files f JOIN nodes n ON n.id=f.node_id JOIN projects p ON p.id=n.project_id
    WHERE p.user_id=? AND p.id=? AND n.id=? AND f.stored_name=?`,
  [req.user.uid, req.params.projectId, req.params.nodeId, req.params.fileId]);
  if (!file) return missing(res);
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-cache' });
  const options = { root: uploadDirectory, cacheControl: false };
  const sent = error => { if (error) next(error); };
  if (!file.file_type.startsWith('image/') || req.query.download === '1') {
    return res.download(file.stored_name, file.original_name, options, sent);
  }
  res.type(file.file_type).sendFile(file.stored_name, options, sent);
});

async function portfolioFile(req, res, next, shared) {
  if (!uuid.test(req.params.fileId)) return missing(res);
  const db = await portfolioDb();
  const [[file]] = await db.execute(`SELECT f.file_path AS path, f.original_name AS name,
    f.file_type AS type, f.mime_type AS mime FROM portfolio_files f JOIN portfolios p ON p.id=f.portfolio_id
    WHERE p.id=? AND f.id=? AND ${shared ? 'p.is_public=TRUE' : 'p.user_id=?'}`,
  shared ? [req.params.portfolioId, req.params.fileId] : [req.params.portfolioId, req.params.fileId, req.user.uid]);
  if (!file) return missing(res);
  serveFile(res, file, next);
}

router.get('/portfolio/:portfolioId/files/:fileId', (req, res, next) => portfolioFile(req, res, next, false));
publicRouter.get('/portfolio/shared/:portfolioId/files/:fileId', (req, res, next) => {
  res.set('X-Robots-Tag', 'noindex');
  return portfolioFile(req, res, next, true);
});

module.exports = { router, publicRouter };
