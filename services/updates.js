const { randomUUID } = require('node:crypto');
const { readFileSync, writeFileSync, renameSync } = require('node:fs');
const { dataFile } = require('../db');
const { pool, ready } = require('./mysql');
const { encodeCursor, decodeCursor } = require('./list-cursor');
const { version: currentVersion } = require('../package.json');
const localFile = dataFile + '.updates.json';

function readLocalUpdates() {
  try {
    return JSON.parse(readFileSync(localFile, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return [];
  }
}

let firstPage;
const stampFor = value => value instanceof Date ? value.toISOString().replace('T', ' ').replace('Z', '') : value;

async function readUpdatePage(cursor) {
  let rows;
  if (!pool) {
    rows = readLocalUpdates().map(row => ({ ...row, publishedAt: stampFor(new Date(row.publishedAt)) }))
      .sort((a,b) => b.publishedAt.localeCompare(a.publishedAt) || b.id.localeCompare(a.id))
      .filter(row => !cursor || row.publishedAt < cursor[0] || (row.publishedAt === cursor[0] && row.id < cursor[1])).slice(0, 31);
  } else {
    const db = await ready();
    [rows] = await db.execute(`SELECT id, version, title, content, published_at AS publishedAt FROM projectlog_updates
      ${cursor ? 'WHERE published_at < ? OR (published_at = ? AND id < ?)' : ''}
      ORDER BY published_at DESC, id DESC LIMIT 31`, cursor ? [cursor[0], cursor[0], cursor[1]] : []);
  }
  const last = rows[29];
  return { updates: rows.slice(0,30).map(row => ({ ...row, publishedAt: stampFor(row.publishedAt).replace(' ', 'T') + 'Z' })),
    nextCursor: rows.length > 30 ? encodeCursor([stampFor(last.publishedAt), last.id]) : '' };
}

async function listUpdates(value) {
  const parsed = decodeCursor(value);
  const cursor = parsed?.length === 2 && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/.test(parsed[0])
    && Number.isFinite(Date.parse(parsed[0].replace(' ', 'T') + 'Z'))
    && /^[0-9a-f-]{36}$/i.test(parsed[1]) ? parsed : null;
  if (cursor) return readUpdatePage(cursor);
  if (!firstPage || firstPage.expires <= Date.now()) {
    const entry = { expires: Date.now() + 30000 };
    entry.promise = readUpdatePage(null).catch(error => { if (firstPage === entry) firstPage = null; throw error; });
    firstPage = entry;
  }
  return firstPage.promise;
}

async function publishUpdate(draft) {
  const update = { ...draft, id: randomUUID(), publishedAt: new Date().toISOString() };
  if (!pool) {
    const updates = readLocalUpdates();
    updates.unshift(update);
    writeFileSync(localFile + '.tmp', JSON.stringify(updates));
    renameSync(localFile + '.tmp', localFile);
    firstPage = null;
    return;
  }
  const db = await ready();
  await db.execute('INSERT INTO projectlog_updates (id, version, title, content) VALUES (?, ?, ?, ?)',
    [update.id, update.version, update.title, update.content]);
  firstPage = null;
}

module.exports = { currentVersion, listUpdates, publishUpdate };
