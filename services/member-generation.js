const currentMember = `FROM projectlog_users u LEFT JOIN projectlog_member_epochs e ON e.uid = u.uid
  WHERE u.uid = ? AND COALESCE(e.generation, 0) = ?`;

function memberChanged() {
  return Object.assign(new Error('Member data changed'), { status: 409 });
}

async function lockMemberGeneration(connection, uid, generation) {
  const [[user]] = await connection.execute('SELECT uid FROM projectlog_users WHERE uid = ? FOR UPDATE', [uid]);
  const [[epoch]] = await connection.execute('SELECT generation FROM projectlog_member_epochs WHERE uid = ? FOR UPDATE', [uid]);
  if (!user || (epoch?.generation || 0) !== generation) throw memberChanged();
}

module.exports = { currentMember, memberChanged, lockMemberGeneration };
