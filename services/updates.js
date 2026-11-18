const { randomUUID } = require('node:crypto');
const { readFileSync, writeFileSync, renameSync } = require('node:fs');
const { dataFile } = require('../db');
const { pool, ready } = require('./mysql');
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

async function listUpdates() {
  if (!pool) return readLocalUpdates();
  const db = await ready();
  const [rows] = await db.query('SELECT id, version, title, content, published_at AS publishedAt FROM projectlog_updates ORDER BY published_at DESC, id DESC');
  return rows;
}

async function publishUpdate(draft) {
  const update = { ...draft, id: randomUUID(), publishedAt: new Date().toISOString() };
  if (!pool) {
    const updates = readLocalUpdates();
    updates.unshift(update);
    writeFileSync(localFile + '.tmp', JSON.stringify(updates));
    renameSync(localFile + '.tmp', localFile);
    return;
  }
  const db = await ready();
  await db.execute('INSERT INTO projectlog_updates (id, version, title, content) VALUES (?, ?, ?, ?)',
    [update.id, update.version, update.title, update.content]);
}

module.exports = { currentVersion, listUpdates, publishUpdate };
