const { appendFile } = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const { createInterface } = require('node:readline');
const { encodeCursor, decodeCursor } = require('./list-cursor');
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

const compare = (a, b) => b.submitted - a.submitted || b.source.localeCompare(a.source)
  || b.id.padStart(20, '0').localeCompare(a.id.padStart(20, '0'));

async function suggestionInbox(value) {
  const parsed = decodeCursor(value);
  const cursor = parsed?.length === 3 && Number.isSafeInteger(parsed[0]) && parsed[0] >= 0
    && ['member', 'guest', 'local'].includes(parsed[1]) && /^\d{1,20}$/.test(parsed[2])
    ? { submitted: parsed[0], source: parsed[1], id: parsed[2] } : null;
  const db = await ready();
  const batches = await Promise.all([['projectlog_suggestions', 'member'], ['projectlog_guest_suggestions', 'guest']].map(async ([table, source]) => {
    const sameTime = cursor && (source < cursor.source ? 'TRUE' : source === cursor.source ? 'id < ?' : 'FALSE');
    const condition = cursor ? `WHERE submitted_at < FROM_UNIXTIME(?) OR (submitted_at=FROM_UNIXTIME(?) AND ${sameTime})` : '';
    const params = cursor ? [cursor.submitted, cursor.submitted, ...(source === cursor.source ? [cursor.id] : [])] : [];
    const [rows] = await db.execute(`SELECT CAST(id AS CHAR) AS id, ${source === 'member' ? 'uid' : 'NULL AS uid'},
      message, UNIX_TIMESTAMP(submitted_at) AS submitted FROM ${table} inbox ${condition}
      ORDER BY submitted_at DESC, inbox.id DESC LIMIT 31`, params);
    return rows.map(row => ({ ...row, submitted: Number(row.submitted), source }));
  }));
  const items = batches.flat();
  // Old JSONL inquiries remain readable without retaining the whole file in memory.
  const input = createReadStream(suggestionsFile, { encoding: 'utf8' });
  const lines = createInterface({ input, crlfDelay: Infinity });
  let lineNumber = 0;
  try {
    for await (const line of lines) {
      lineNumber++;
      if (!line.trim()) continue;
      const entry = JSON.parse(line);
      const row = { ...entry, submitted: Number(entry.submitted), source: 'local', id: String(lineNumber) };
      if (!cursor || compare(row, cursor) > 0) items.push(row);
      items.sort(compare);
      if (items.length > 31) items.length = 31;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  } finally { lines.close(); input.destroy(); }
  items.sort(compare);
  const page = items.slice(0, 30);
  const last = page.at(-1);
  return { items: page, nextCursor: items.length > 30 ? encodeCursor([last.submitted, last.source, last.id]) : '' };
}

module.exports = { saveSuggestion, suggestionInbox };
