const { appendFile, readFile } = require('node:fs/promises');
const { dataFile } = require('../db');
const { pool, ready } = require('./mysql');
const { currentMember, memberChanged } = require('./member-generation');

const suggestionsFile = dataFile + '.suggestions.jsonl';

async function saveSuggestion(uid, message, generation) {
  if (!pool) {
    const entry = JSON.stringify({ uid: null, message, submitted: Math.floor(Date.now() / 1000) });
    await appendFile(suggestionsFile, entry + '\n', { encoding: 'utf8', mode: 0o600 });
    return;
  }
  const db = await ready();
  if (uid) {
    const [result] = await db.execute(`INSERT INTO projectlog_suggestions (uid, message)
      SELECT u.uid, ? ${currentMember}`, [message, uid, generation]);
    if (!result.affectedRows) throw memberChanged();
  } else {
    await db.execute('INSERT INTO projectlog_guest_suggestions (message) VALUES (?)', [message]);
  }
}

async function suggestionInbox() {
  const db = await ready();
  const [items] = await db.query(`SELECT uid, message, UNIX_TIMESTAMP(submitted_at) AS submitted
    FROM projectlog_suggestions
    UNION ALL
    SELECT NULL AS uid, message, UNIX_TIMESTAMP(submitted_at) AS submitted FROM projectlog_guest_suggestions
    ORDER BY submitted DESC`);
  try {
    const legacy = await readFile(suggestionsFile, 'utf8');
    items.push(...legacy.trim().split('\n').filter(Boolean).map(line => JSON.parse(line)));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return items.sort((first, second) => second.submitted - first.submitted);
}

module.exports = { saveSuggestion, suggestionInbox };
