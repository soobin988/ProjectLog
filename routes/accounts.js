const { Router } = require('express');
const { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');
const { pool, ready, emptyWorkspace } = require('../services/mysql');
const { saveSuggestion, suggestionInbox } = require('../services/suggestions');
const { defaultColor, seoulDate } = require('./shared');
const { checkSignupCapacity, isMemberLimitError, memberLimitMessage } = require('../services/membership');
const { publicOrigin: origin } = require('../services/public-origin');
const { getAvatar, uploadAvatar } = require('../services/account-avatar');
const { persistWorkspace } = require('../services/workspace-store');

const router = Router();
const deriveKey = promisify(scrypt);
const developerUid = Number(process.env.PROJECT_LOG_DEVELOPER_UID);
const secure = origin?.startsWith('https://') || false;
const sessionCookie = secure ? '__Host-projectlog' : 'projectlog';
const googleCookie = secure ? '__Host-projectlog_google' : 'projectlog_google';
const cookieOptions = { httpOnly: true, sameSite: 'lax', path: '/', secure };
const sessionDuration = 7 * 24 * 60 * 60 * 1000;
const googleId = process.env.GOOGLE_CLIENT_ID;
const googleSecret = process.env.GOOGLE_CLIENT_SECRET;
const googleRedirect = origin && origin + '/auth/google/callback';
const google = pool && googleId && googleSecret && googleRedirect
  ? new (require('google-auth-library').OAuth2Client)(googleId, googleSecret, googleRedirect) : null;
const randomToken = () => randomBytes(32).toString('base64url');
const hashToken = token => createHash('sha256').update(token).digest();
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const passwordMinLength = 7;
const passwordMaxLength = 128;

function cookie(req, name) {
  const prefix = name + '=';
  return req.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith(prefix))?.slice(prefix.length);
}

function verifyRequestOrigin(req, res, next) {
  if ((!pool && req.path !== '/suggestions') || !['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const source = req.get('Origin');
  const expected = origin || req.protocol + '://' + req.get('Host');
  if (req.get('Sec-Fetch-Site') === 'cross-site' || (source && source !== expected)) return res.sendStatus(403);
  next();
}

function requestLimit() {
  const attempts = new Map();
  return (req, res, next) => {
    const now = Date.now();
    if (attempts.size >= 2000) {
      for (const [ip, entry] of attempts) if (entry.until <= now) attempts.delete(ip);
      if (attempts.size >= 2000 && !attempts.has(req.ip)) return res.sendStatus(429);
    }
    let entry = attempts.get(req.ip);
    if (!entry || entry.until <= now) {
      entry = { until: now + 10 * 60 * 1000, count: 0 };
      attempts.set(req.ip, entry);
    }
    if (++entry.count > 25) return res.status(429).send('잠시 후 다시 시도해 주세요.');
    next();
  };
}
const limitAccounts = requestLimit();
const limitInquiries = requestLimit();

async function findUser(key, value) {
  const column = key === 'google' ? 'google_subject' : 'username';
  const db = await ready();
  const [[user]] = await db.execute('SELECT uid, display_name, password_hash FROM projectlog_users WHERE ' + column + ' = ?', [value]);
  return user;
}

function starterWorkspace() {
  const projectId = randomUUID();
  const today = seoulDate.format(new Date());
  return {
    ...emptyWorkspace(),
    projects: [{
      id: projectId, name: '예시 프로젝트', category: 'development', icon: 'folder',
      color: defaultColor, progress: 0, startedDate: today
    }],
    todos: [{ id: randomUUID(), projectId, title: '첫 작업 기록하기', dueDate: today, done: false }]
  };
}

async function createUser({ username = null, passwordHash = null, subject = null, displayName }) {
  const db = await ready();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    await checkSignupCapacity(connection);
    const [result] = await connection.execute(
      'INSERT INTO projectlog_users (username, password_hash, google_subject, display_name) VALUES (?, ?, ?, ?)',
      [username, passwordHash, subject, displayName]);
    const uid = result.insertId;
    if (uid < 10000 || uid > 99999) throw Object.assign(new Error('UID capacity exhausted'), { code: 'MEMBER_LIMIT_REACHED' });
    await connection.execute('INSERT INTO projectlog_workspaces (uid, storage_version) VALUES (?, 1)', [uid]);
    await persistWorkspace(connection, uid, starterWorkspace());
    await connection.commit();
    return { uid, display_name: displayName };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function saveSession(req, res, uid) {
  const token = randomToken();
  const old = cookie(req, sessionCookie);
  const db = await ready();
  if (tokenPattern.test(old || '')) await db.execute('DELETE FROM projectlog_sessions WHERE token_hash = ?', [hashToken(old)]);
  await db.execute('DELETE FROM projectlog_sessions WHERE expires_at <= UTC_TIMESTAMP()');
  await db.execute(
    'INSERT INTO projectlog_sessions (token_hash, uid, expires_at) VALUES (?, ?, UTC_TIMESTAMP() + INTERVAL 7 DAY)',
    [hashToken(token), uid]);
  res.cookie(sessionCookie, token, { ...cookieOptions, maxAge: sessionDuration });
}

async function loadAccount(req, res, next) {
  if (!pool) return next();
  const token = cookie(req, sessionCookie);
  if (tokenPattern.test(token || '')) {
    const db = await ready();
    const [[user]] = await db.execute(`SELECT u.uid, u.display_name, a.uid AS avatar_uid, COALESCE(e.generation, 0) AS generation FROM projectlog_sessions AS s
      JOIN projectlog_users AS u ON u.uid = s.uid LEFT JOIN projectlog_member_epochs e ON e.uid = u.uid
      LEFT JOIN projectlog_user_avatars a ON a.uid = u.uid
      WHERE s.token_hash = ? AND s.expires_at > UTC_TIMESTAMP()`,
    [hashToken(token)]);
    if (user) {
      req.user = { uid: user.uid, name: user.display_name, developer: developerUid === user.uid, hasAvatar: Boolean(user.avatar_uid) };
      req.memberGeneration = user.generation;
      res.locals.account = req.user;
      res.set('Cache-Control', 'private, no-store');
    }
  }
  next();
}

function requireAccount(req, res, next) {
  if (!pool || req.user) return next();
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.sendStatus(401);
  res.redirect(303, '/login');
}

function renderAccount(res, signup, error = '', username = '') {
  res.set('Cache-Control', 'no-store');
  res.render('account', { signup, error, username, googleEnabled: Boolean(google), passwordMinLength, passwordMaxLength });
}

const connectionErrors = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'PROTOCOL_CONNECTION_LOST']);

function handleAccountConnectionError(error, req, res, next) {
  if (res.headersSent || !connectionErrors.has(error.code) || !['/login', '/register'].includes(req.path.toLowerCase().replace(/\/$/, ''))) return next(error);
  const signup = req.path.toLowerCase().startsWith('/register');
  renderAccount(res.status(503), signup, '데이터베이스에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.', String(req.body?.username || '').trim());
}

if (pool) {
  router.get('/account/avatar', getAvatar);
  router.post('/account/avatar', uploadAvatar);
  router.get('/register', (req, res) => renderAccount(res, true));
  router.get('/login', (req, res) => {
    res.locals.dataReset = req.query.reset === '1';
    res.locals.cleanupPending = res.locals.dataReset && req.query.cleanup === 'pending';
    renderAccount(res, false);
  });

  router.post('/register', limitAccounts, async (req, res) => {
    const username = String(req.body?.username || '').trim().toLowerCase();
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!/^[a-z0-9_.-]{3,40}$/.test(username) || password.length < passwordMinLength || password.length > passwordMaxLength) {
      const error = `아이디는 영문·숫자·._- 3~40자, 비밀번호는 ${passwordMinLength}~${passwordMaxLength}자로 입력하세요.`;
      return renderAccount(res.status(422), true, error, username);
    }
    const salt = randomBytes(16).toString('hex');
    const key = await deriveKey(password, salt, 64);
    let user;
    try {
      user = await createUser({ username, passwordHash: salt + ':' + key.toString('hex'), displayName: username });
    } catch (error) {
      if (isMemberLimitError(error)) return renderAccount(res.status(409), true, memberLimitMessage, username);
      if (error.code !== 'ER_DUP_ENTRY') throw error;
      return renderAccount(res.status(409), true, '이미 사용 중인 아이디예요.', username);
    }
    await saveSession(req, res, user.uid);
    res.redirect(303, '/');
  });

  router.post('/login', limitAccounts, async (req, res) => {
    const username = String(req.body?.username || '').trim().toLowerCase();
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const user = /^[a-z0-9_.-]{3,40}$/.test(username) ? await findUser('username', username) : null;
    if (!user) return renderAccount(res.status(401), false, '존재하지 않는 아이디입니다.', username);
    const incorrectPassword = () => renderAccount(res.status(401), false, '비밀번호가 다릅니다.', username);
    if (!user.password_hash || !password || password.length > passwordMaxLength) return incorrectPassword();
    const [salt, expected] = user.password_hash.split(':');
    if (!salt || !/^[0-9a-f]{128}$/i.test(expected)) return incorrectPassword();
    const key = await deriveKey(password, salt, 64);
    if (!timingSafeEqual(key, Buffer.from(expected, 'hex'))) return incorrectPassword();
    await saveSession(req, res, user.uid);
    res.redirect(303, '/');
  });

  router.post('/logout', async (req, res) => {
    const token = cookie(req, sessionCookie);
    if (tokenPattern.test(token || '')) {
      const db = await ready();
      await db.execute('DELETE FROM projectlog_sessions WHERE token_hash = ?', [hashToken(token)]);
    }
    res.clearCookie(sessionCookie, cookieOptions).redirect(303, '/login');
  });

}

async function renderSuggestions(req, res, { draft = '', error = '' } = {}) {
  const inbox = req.user?.developer ? await suggestionInbox(req.query.cursor) : null;
  res.set('Cache-Control', 'private, no-store');
  res.render('suggestions', {
    page: 'suggestions', guestsOnly: Boolean(pool && !req.user), inbox: inbox?.items,
    pagination: { previous: req.query.cursor ? '/suggestions' : '', next: inbox?.nextCursor ? '/suggestions?cursor=' + inbox.nextCursor : '' },
    sent: !error && req.query.sent === '1', draft, error
  });
}

router.get('/suggestions', (req, res) => renderSuggestions(req, res));
router.post('/suggestions', limitInquiries, async (req, res) => {
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  if (!message || message.length > 3000) {
    return renderSuggestions(req, res.status(422), { draft: message.slice(0, 3000), error: '문의 내용을 1~3,000자로 입력하세요.' });
  }
  await saveSuggestion(req.user?.uid, message, req.memberGeneration);
  res.redirect(303, '/suggestions?sent=1');
});

if (google) {
  router.get('/auth/google', (req, res) => {
    const state = randomToken();
    const verifier = randomToken();
    const challenge = hashToken(verifier).toString('base64url');
    res.cookie(googleCookie, state + '.' + verifier, { ...cookieOptions, maxAge: 10 * 60 * 1000 });
    res.redirect(google.generateAuthUrl({
      scope: ['openid', 'email', 'profile'], state, code_challenge: challenge, code_challenge_method: 'S256'
    }));
  });

  router.get('/auth/google/callback', limitAccounts, async (req, res) => {
    const [state, verifier] = (cookie(req, googleCookie) || '').split('.');
    res.clearCookie(googleCookie, cookieOptions);
    const invalid = () => renderAccount(res.status(401), false, 'Google 로그인에 실패했어요. 다시 시도해 주세요.');
    if (!tokenPattern.test(state || '') || !tokenPattern.test(verifier || '') ||
        req.query.state !== state || typeof req.query.code !== 'string') return invalid();
    let profile;
    try {
      const { tokens } = await google.getToken({ code: req.query.code, codeVerifier: verifier });
      const ticket = await google.verifyIdToken({ idToken: tokens.id_token, audience: googleId });
      profile = ticket.getPayload();
    } catch {
      return invalid();
    }
    if (!profile?.sub) return invalid();
    let user = await findUser('google', profile.sub);
    if (!user) {
      const displayName = (profile.name || profile.email || 'Google 회원').slice(0, 100);
      try {
        user = await createUser({ subject: profile.sub, displayName });
      } catch (error) {
        if (error.code !== 'ER_DUP_ENTRY' && !isMemberLimitError(error)) throw error;
        user = await findUser('google', profile.sub);
        if (!user && isMemberLimitError(error)) return renderAccount(res.status(409), false, memberLimitMessage);
        if (!user) throw error;
      }
    }
    await saveSession(req, res, user.uid);
    res.redirect(303, '/');
  });
}

module.exports = { router, loadAccount, requireAccount, verifyRequestOrigin, handleAccountConnectionError };
