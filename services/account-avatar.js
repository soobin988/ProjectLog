const multer = require('multer');
const sharp = require('sharp');
const { createHash } = require('node:crypto');
const { ready } = require('./mysql');
const { lockMemberGeneration } = require('./member-generation');
const { matchesFileType } = require('./attachment-types');

const maxAvatarSize = 2 * 1024 * 1024;
const avatarTypes = ['image/jpeg', 'image/png', 'image/webp'];
const parseAvatar = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxAvatarSize, files: 1, fields: 0, parts: 2 }
}).single('avatar');

function uploadAvatar(req, res, next) {
  if (!req.user) return res.sendStatus(401);
  parseAvatar(req, res, error => {
    if (error instanceof multer.MulterError) {
      const reason = error.code === 'LIMIT_FILE_SIZE' ? '프로필 사진은 2MB까지 올릴 수 있어요.' : '사진 한 장을 선택해 주세요.';
      return res.status(422).json({ error: reason });
    }
    if (error) return next(error);
    const bytes = req.file?.buffer;
    const mime = bytes && avatarTypes.find(type => matchesFileType(bytes, type));
    if (!mime) return res.status(422).json({ error: 'JPG, PNG 또는 WebP 사진을 선택해 주세요.' });
    thumbnail(bytes).then(image => saveAvatar(req.user.uid, req.memberGeneration, 'image/webp', image))
      .then(() => res.sendStatus(204)).catch(error => {
        if (error.avatarDecode) return res.status(422).json({ error: '사진을 읽을 수 없어요. 다른 사진을 선택해 주세요.' });
        next(error);
      });
  });
}

const hashFor = bytes => createHash('sha256').update(bytes).digest('hex');

async function thumbnail(bytes) {
  try {
    return await sharp(bytes, { limitInputPixels: 16_000_000 }).rotate()
      .resize(256, 256, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
  } catch (error) { error.avatarDecode = true; throw error; }
}

async function saveAvatar(uid, generation, mime, bytes) {
  const db = await ready();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    await lockMemberGeneration(connection, uid, generation);
    const hash = hashFor(bytes);
    await connection.execute(`INSERT INTO projectlog_user_avatars (uid, mime_type, image_data, image_hash)
      VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE mime_type = VALUES(mime_type),
        image_data = VALUES(image_data), image_hash = VALUES(image_hash)`, [uid, mime, bytes, hash]);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function getAvatar(req, res) {
  if (!req.user) return res.sendStatus(401);
  const db = await ready();
  const [[metadata]] = await db.execute('SELECT image_hash FROM projectlog_user_avatars WHERE uid = ?', [req.user.uid]);
  res.set({ 'Cache-Control': 'private, no-cache', 'X-Content-Type-Options': 'nosniff', Vary: 'Cookie' });
  if (!metadata) return res.redirect('/default-avatar.svg');
  if (metadata.image_hash) {
    res.set('ETag', '"' + metadata.image_hash + '"');
    const etag = res.get('ETag');
    if ((req.get('If-None-Match') || '').split(',').some(value => value.trim().replace(/^W\//, '') === etag || value.trim() === '*')) {
      return res.sendStatus(304);
    }
  }
  const [[avatar]] = await db.execute('SELECT mime_type, image_data, image_hash FROM projectlog_user_avatars WHERE uid = ?', [req.user.uid]);
  if (!avatar) return res.redirect('/default-avatar.svg');
  if (!avatar.image_hash) {
    // Convert older uploads once; compare the original bytes to preserve a concurrent upload.
    const original = avatar.image_data;
    try { avatar.image_data = await thumbnail(original); avatar.mime_type = 'image/webp'; }
    catch { /* Keep older undecodable images available. New uploads are validated. */ }
    avatar.image_hash = hashFor(avatar.image_data);
    await db.execute(`UPDATE projectlog_user_avatars SET mime_type=?, image_data=?, image_hash=?
      WHERE uid=? AND image_hash IS NULL AND image_data=?`,
    [avatar.mime_type, avatar.image_data, avatar.image_hash, req.user.uid, original]);
  }
  res.set('ETag', '"' + avatar.image_hash + '"');
  res.type(avatar.mime_type).send(avatar.image_data);
}

module.exports = { getAvatar, uploadAvatar };
