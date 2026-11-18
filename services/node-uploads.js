const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { mkdir, open, unlink } = require('node:fs/promises');
const multer = require('multer');
const { uploadDirectory } = require('../db');
const { extensionTypes, matchesFileType } = require('./attachment-types');

const temporaryDirectory = uploadDirectory + '.pending';
const maxFiles = 8;
const maxFileBytes = 8 * 1024 * 1024;
const limitMessage = '파일은 최대 8개, 각 8MB까지 등록할 수 있습니다.';
const uploadError = message => Object.assign(new Error(message), { status: 422 });
const uploader = multer({
  defParamCharset: 'utf8',
  storage: multer.diskStorage({
    destination: (req, file, callback) => mkdir(temporaryDirectory, { recursive: true, mode: 0o700 })
      .then(() => callback(req.aborted ? uploadError('업로드가 취소됐어요.') : null, temporaryDirectory), callback),
    filename: (req, file, callback) => {
      const id = randomUUID();
      req.nodeUploadPaths.push(path.join(temporaryDirectory, id));
      callback(null, id);
    }
  }),
  limits: { files: maxFiles, fileSize: maxFileBytes, fields: 30, fieldSize: 64 * 1024, parts: 38 },
  fileFilter: (req, file, callback) => {
    const type = extensionTypes[path.extname(file.originalname).toLowerCase()];
    callback(type ? null : uploadError('ZIP, PNG, JPG, GIF, WEBP 형식의 파일을 선택하세요.'), Boolean(type));
  }
}).array('files', maxFiles);

async function cleanupUploads(req) {
  const results = await Promise.allSettled((req.nodeUploadPaths || []).map(file => unlink(file)));
  for (const result of results) {
    if (result.status === 'rejected' && result.reason.code !== 'ENOENT') {
      console.error('Unable to clean node upload:', result.reason.code);
    }
  }
}

async function readNodeUploads(req, res) {
  req.nodeUploadPaths = [];
  if (!req.is('multipart/form-data')) return [];
  try {
    await new Promise((resolve, reject) => uploader(req, res, error => error ? reject(error) : resolve()));
    const files = [];
    for (const file of req.files || []) {
      const name = path.win32.basename(file.originalname).replace(/[\x00-\x1f\x7f]/g, '').slice(-180);
      const type = extensionTypes[path.extname(name).toLowerCase()];
      const handle = await open(file.path);
      try {
        const header = Buffer.alloc(12);
        const { bytesRead } = await handle.read(header, 0, 12, 0);
        if (!matchesFileType(header.subarray(0, bytesRead), type)) throw uploadError('파일 확장자와 실제 형식이 일치하지 않아요.');
      } finally { await handle.close(); }
      files.push({ id: file.filename, name, type, size: file.size, temporaryPath: file.path });
    }
    return files;
  } catch (error) {
    await cleanupUploads(req);
    if (error instanceof multer.MulterError) throw Object.assign(new Error(limitMessage), { status: 413 });
    throw error;
  }
}

module.exports = { readNodeUploads, cleanupUploads, maxFiles, maxFileBytes, limitMessage };
