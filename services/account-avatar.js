const multer = require('multer');
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
    saveAvatar(req.user.uid, req.memberGeneration, mime, bytes)
      .then(() => res.sendStatus(204)).catch(next);
  });
}

async function saveAvatar(uid, generation, mime, bytes) {
  const db = await ready();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    await lockMemberGeneration(connection, uid, generation);
    await connection.execute(`INSERT INTO projectlog_user_avatars (uid, mime_type, image_data)
      VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE mime_type = ?, image_data = ?`, [uid, mime, bytes, mime, bytes]);
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
  const [[avatar]] = await db.execute('SELECT mime_type, image_data FROM projectlog_user_avatars WHERE uid = ?', [req.user.uid]);
  res.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
  if (!avatar) return res.redirect('/default-avatar.svg');
  res.type(avatar.mime_type).send(avatar.image_data);
}

module.exports = { getAvatar, uploadAvatar };
