const { ready } = require('./mysql');

const maxMemberLimit = 90_000;
const isMemberLimitError = error => error.code === 'MEMBER_LIMIT_REACHED';
const memberLimitMessage = '회원 수 상한에 도달해 새 계정을 만들 수 없어요.';

async function readMemberLimit(connection, lock = false) {
  const db = connection || await ready();
  const [[row]] = await db.execute('SELECT member_limit FROM projectlog_member_settings WHERE id = 1' +
    (lock ? ' FOR UPDATE' : ''));
  return row.member_limit;
}

async function checkSignupCapacity(connection) {
  const limit = await readMemberLimit(connection, true);
  const [[row]] = await connection.execute('SELECT COUNT(*) AS count FROM projectlog_users');
  if (Number(row.count) >= limit) throw Object.assign(new Error(memberLimitMessage), { code: 'MEMBER_LIMIT_REACHED' });
}

async function setMemberLimit(limit) {
  const db = await ready();
  await db.execute('UPDATE projectlog_member_settings SET member_limit = ? WHERE id = 1', [limit]);
}

module.exports = { maxMemberLimit, readMemberLimit, checkSignupCapacity, setMemberLimit, isMemberLimitError, memberLimitMessage };
