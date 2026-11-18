const { randomUUID } = require('node:crypto');
const { mkdir, open, readFile, unlink } = require('node:fs/promises');
const path = require('node:path');
const multer = require('multer');
const { extensionTypes, imageTypes, matchesFileType } = require('./attachment-types');

const uploadRoot = path.resolve(process.env.PROJECT_LOG_PORTFOLIO_UPLOADS || path.join(__dirname, '../uploads/portfolio'));
const imageLimit = 8 * 1024 ** 2;
const fileLimit = 30 * 1024 ** 2;
const maxImages = 12;
const maxFiles = 3;
const uploadError = message => Object.assign(new Error(message), { status: 422 });
const mimeFor = file => {
  const extension = path.extname(file.originalname).toLowerCase();
  return extension === '.pdf' ? 'application/pdf' : extensionTypes[extension];
};
const typeFor = file => file.fieldname === 'images' ? 'image' : mimeFor(file) === 'application/pdf' ? 'pdf' : 'zip';
const uploader = multer({
  defParamCharset: 'utf8',
  storage: multer.diskStorage({
    destination: (req, file, callback) => mkdir(uploadRoot, { recursive: true, mode: 0o700 })
      .then(() => callback(null, uploadRoot), callback),
    filename: (req, file, callback) => callback(null, randomUUID())
  }),
  limits: { files: maxImages + maxFiles, fileSize: fileLimit, fields: 65, fieldSize: 12_000, parts: 80 },
  fileFilter: (req, file, callback) => {
    const mime = mimeFor(file);
    const allowed = file.fieldname === 'images' ? imageTypes.has(mime) && mime !== 'image/gif' : ['application/zip', 'application/pdf'].includes(mime);
    callback(allowed ? null : uploadError('이미지는 JPG, PNG, WebP, 파일은 ZIP 또는 PDF 형식으로 올려 주세요.'), allowed);
  }
}).fields([{ name: 'images', maxCount: maxImages }, { name: 'zips', maxCount: maxFiles }]);

async function uploads(req, res) {
  try {
    if (req.is('multipart/form-data')) {
      await new Promise((resolve, reject) => uploader(req, res, error => error ? reject(error) : resolve()));
    }
    const result = [];
    for (const file of Object.values(req.files || {}).flat()) {
      const type = typeFor(file);
      if (type === 'image' && file.size > imageLimit) throw uploadError('이미지는 파일당 8MB까지 올릴 수 있어요.');
      const mime = mimeFor(file);
      const handle = await open(file.path);
      const header = Buffer.alloc(12);
      try {
        const { bytesRead } = await handle.read(header, 0, header.length);
        const valid = mime === 'application/pdf' ? header.toString('ascii', 0, 5) === '%PDF-' : matchesFileType(header.subarray(0, bytesRead), mime);
        if (!valid) throw uploadError('파일 확장자와 실제 형식이 일치하지 않아요.');
      } finally {
        await handle.close();
      }
      result.push({
        id: file.filename, path: file.filename, name: file.originalname.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 200),
        size: file.size, mime, type, caption: '', thumbnail: false, createdAt: new Date()
      });
    }
    return result;
  } catch (error) {
    await removeFiles(Object.values(req.files || {}).flat().map(file => ({ path: file.filename })));
    if (error instanceof multer.MulterError) {
      throw uploadError(error.code === 'LIMIT_FILE_SIZE'
        ? '파일당 30MB까지 올릴 수 있어요.'
        : '첨부 개수나 입력 길이 제한을 확인해 주세요.');
    }
    throw error;
  }
}

function orderedFiles(files, thumbnailId) {
  const images = files.filter(file => file.type === 'image');
  const attachments = files.filter(file => file.type !== 'image');
  if (images.length > maxImages || attachments.length > maxFiles) {
    throw uploadError('항목당 이미지 12장, 파일 3개까지 올릴 수 있어요.');
  }
  const thumbnail = images.find(file => file.id === thumbnailId) || images.find(file => file.thumbnail) || images[0];
  return files.map(file => ({ ...file, thumbnail: file.type === 'image' && file.id === thumbnail.id }));
}

async function removeFiles(files) {
  const results = await Promise.allSettled(files.map(file => unlink(path.join(uploadRoot, file.path))));
  return results.filter(result => result.status === 'rejected' && result.reason.code !== 'ENOENT').length;
}

function serveFile(res, file, next) {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-cache' }).type(file.mime);
  const options = { root: uploadRoot, cacheControl: false };
  const sent = error => { if (error) next(error); };
  if (file.type !== 'image') return res.download(file.path, file.name, options, sent);
  res.sendFile(file.path, options, sent);
}

async function readPortfolioImage(file) {
  if (file.type !== 'image' || !imageTypes.has(file.mime) || !/^[0-9a-f-]{36}$/i.test(file.path)) return null;
  const bytes = await readFile(path.join(uploadRoot, file.path));
  return bytes.length <= imageLimit && matchesFileType(bytes.subarray(0, 12), file.mime) ? bytes : null;
}

module.exports = { uploads, orderedFiles, removeFiles, serveFile, readPortfolioImage };
