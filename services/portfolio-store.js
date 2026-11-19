const { readFileSync, writeFileSync, renameSync } = require('node:fs');
const { dataFile } = require('../db');
const { pool, portfolioDb } = require('./mysql');
const { currentMember, memberChanged, lockMemberGeneration } = require('./member-generation');

const localFile = dataFile + '.portfolio.json';
const conflict = () => Object.assign(new Error('Portfolio changed'), { status: 409 });

function readLocal() {
  try {
    return JSON.parse(readFileSync(localFile, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { items: [], analyses: [] };
  }
}

function updateLocal(update) {
  const data = readLocal();
  update(data);
  writeFileSync(localFile + '.tmp', JSON.stringify(data));
  renameSync(localFile + '.tmp', localFile);
}

async function loadItems(where, params, connection) {
  const db = connection || await portfolioDb();
  const [rows] = await db.execute(`SELECT p.*, covers.settings AS cover_settings, materials.settings AS material_settings,
    contacts.settings AS contact_settings
    FROM portfolios p
    LEFT JOIN portfolio_covers covers ON covers.portfolio_id = p.id
    LEFT JOIN portfolio_materials materials ON materials.portfolio_id = p.id
    LEFT JOIN portfolio_contacts contacts ON contacts.portfolio_id = p.id
    WHERE ${where} ORDER BY p.created_at DESC, p.id`, params);
  if (!rows.length) return [];
  const ids = rows.map(row => row.id);
  const placeholders = ids.map(() => '?').join(', ');
  const [[technologies], [files], [links]] = await Promise.all([
    db.execute(`SELECT * FROM portfolio_technologies WHERE portfolio_id IN (${placeholders}) ORDER BY id`, ids),
    db.execute(`SELECT * FROM portfolio_files WHERE portfolio_id IN (${placeholders}) ORDER BY sort_order`, ids),
    db.execute(`SELECT * FROM portfolio_links WHERE portfolio_id IN (${placeholders})`, ids)
  ]);
  const techByItem = Object.groupBy(technologies, row => row.portfolio_id);
  const filesByItem = Object.groupBy(files, row => row.portfolio_id);
  const linksByItem = Object.groupBy(links, row => row.portfolio_id);
  return rows.map(row => ({
    id: row.id, projectId: row.project_id || '', title: row.title, description: row.description,
    role: row.role, status: row.status, startDate: row.start_date,
    endDate: row.end_date, isPublic: Boolean(row.is_public), version: row.version, createdAt: row.created_at,
    cover: typeof row.cover_settings === 'string' ? JSON.parse(row.cover_settings) : row.cover_settings,
    materials: typeof row.material_settings === 'string' ? JSON.parse(row.material_settings) : row.material_settings,
    contact: (typeof row.contact_settings === 'string' ? JSON.parse(row.contact_settings) : row.contact_settings) || {},
    technologies: (techByItem[row.id] || []).map(item => item.technology),
    github: (linksByItem[row.id] || []).find(item => item.link_type === 'github')?.url || '',
    links: Object.fromEntries((linksByItem[row.id] || []).filter(item => item.link_type !== 'github').map(item => [item.link_type, item.url])),
    files: (filesByItem[row.id] || []).map(file => ({
      id: file.id, type: file.file_type, name: file.original_name, path: file.file_path, size: file.file_size,
      mime: file.mime_type, caption: file.caption, thumbnail: Boolean(file.is_thumbnail), createdAt: file.created_at
    }))
  }));
}

async function list(uid, connection) {
  if (!pool) return readLocal().items;
  return loadItems('p.user_id = ?', [uid], connection);
}

async function listCards(uid) {
  if (!pool) return readLocal().items;
  const db = await portfolioDb();
  const [rows] = await db.execute(`SELECT p.id, p.project_id, p.title, c.settings AS cover
    FROM portfolios p LEFT JOIN portfolio_covers c ON c.portfolio_id=p.id
    WHERE p.user_id=? ORDER BY p.created_at DESC, p.id`, [uid]);
  if (!rows.length) return [];
  const [files] = await db.execute(`SELECT f.id, f.portfolio_id, f.is_thumbnail FROM portfolio_files f
    JOIN portfolios p ON p.id=f.portfolio_id WHERE p.user_id=? AND f.file_type='image'
    ORDER BY f.sort_order`, [uid]);
  const byItem = Object.groupBy(files, file => file.portfolio_id);
  return rows.map(row => ({ id: row.id, projectId: row.project_id, title: row.title,
    cover: typeof row.cover === 'string' ? JSON.parse(row.cover) : row.cover,
    files: (byItem[row.id] || []).map(file => ({ id: file.id, type: 'image', thumbnail: Boolean(file.is_thumbnail) })) }));
}

async function pageSettings(uid) {
  if (!pool) return readLocal().page;
  const db = await portfolioDb();
  const [[settings]] = await db.execute('SELECT heading, description FROM portfolio_pages WHERE user_id = ?', [uid]);
  return settings;
}

async function savePageSettings(uid, settings, generation) {
  if (!pool) return updateLocal(data => { data.page = settings; });
  const db = await portfolioDb();
  const { heading, description } = settings;
  const [result] = await db.execute(`INSERT INTO portfolio_pages (user_id, heading, description)
    SELECT u.uid, ?, ? ${currentMember} ON DUPLICATE KEY UPDATE heading = ?, description = ?`,
    [heading, description, uid, generation, heading, description]);
  if (!result.affectedRows) {
    const [[member]] = await db.execute('SELECT u.uid ' + currentMember, [uid, generation]);
    if (!member) throw memberChanged();
  }
}

function localItem(id, publicOnly = false) {
  return readLocal().items.find(item => item.id === id && (!publicOnly || item.isPublic));
}

async function get(uid, id) {
  if (!pool) return localItem(id);
  const [item] = await loadItems('p.user_id = ? AND p.id = ?', [uid, id]);
  return item;
}

async function shared(id) {
  if (!pool) return localItem(id, true);
  const [item] = await loadItems('p.id = ? AND p.is_public = TRUE', [id]);
  return item;
}

async function save(uid, item, generation, transaction) {
  const now = new Date();
  if (!pool) {
    updateLocal(data => {
      if (item.version === undefined) {
        data.items.unshift({ ...item, createdAt: now, version: 0 });
        return;
      }
      const index = data.items.findIndex(row => row.id === item.id && row.version === item.version);
      if (index < 0) throw conflict();
      data.items[index] = { ...item, version: item.version + 1 };
    });
    return;
  }
  const db = await portfolioDb();
  const connection = transaction || await db.getConnection();
  try {
    if (!transaction) await connection.beginTransaction();
    await lockMemberGeneration(connection, uid, generation);
    const [previous] = item.version === undefined ? [] : await loadItems('p.user_id = ? AND p.id = ?', [uid, item.id], connection);
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const fields = [item.projectId || null, item.title, item.description, item.role, item.status,
      item.startDate, item.endDate, item.isPublic];
    if (item.version === undefined) {
      await connection.execute(`INSERT INTO portfolios
        (project_id, title, description, role, status, category, start_date, end_date, is_public, id, user_id)
        VALUES (?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?)`, [...fields, item.id, uid]);
    } else {
      const [result] = await connection.execute(`UPDATE portfolios SET project_id = ?, title = ?, description = ?,
        role = ?, status = ?, start_date = ?, end_date = ?, is_public = ?, version = version + 1
        WHERE id = ? AND user_id = ? AND version = ?`, [...fields, item.id, uid, item.version]);
      if (!result.affectedRows) throw conflict();

    }
    if (!same(previous?.technologies || [], item.technologies)) {
      await connection.execute('DELETE FROM portfolio_technologies WHERE portfolio_id = ?', [item.id]);
      if (item.technologies.length) await connection.query('INSERT INTO portfolio_technologies (portfolio_id, technology) VALUES ?',
        [item.technologies.map(technology => [item.id, technology])]);
    }
    const oldFiles = new Map((previous?.files || []).map((file, index) => [file.id, { file, index }]));
    const fileIds = new Set(item.files.map(file => file.id));
    for (const old of previous?.files || []) {
      if (!fileIds.has(old.id)) await connection.execute('DELETE FROM portfolio_files WHERE portfolio_id = ? AND id = ?', [item.id, old.id]);
    }
    for (const [index, file] of item.files.entries()) {
      const old = oldFiles.get(file.id);
      if (old?.index === index && same(old.file, file)) continue;
      if (old) {
        await connection.execute(`UPDATE portfolio_files SET file_type=?, original_name=?, file_size=?,
          mime_type=?, caption=?, is_thumbnail=?, sort_order=? WHERE portfolio_id=? AND id=?`,
        [file.type, file.name, file.size, file.mime, file.caption, file.thumbnail, index, item.id, file.id]);
      } else {
        await connection.execute(`INSERT INTO portfolio_files (id, portfolio_id, file_type, original_name, stored_name,
          file_path, file_size, mime_type, caption, is_thumbnail, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [file.id, item.id, file.type, file.name, file.id, file.path, file.size,
          file.mime, file.caption, file.thumbnail, index, new Date(file.createdAt)]);
      }
    }
    const oldLinks = { ...previous?.links, github: previous?.github };
    const links = { ...item.links, github: item.github };
    for (const type of new Set([...Object.keys(oldLinks), ...Object.keys(links)])) {
      const url = links[type];
      if ((oldLinks[type] || '') === (url || '')) continue;
      if (!url) await connection.execute('DELETE FROM portfolio_links WHERE portfolio_id=? AND link_type=?', [item.id, type]);
      else await connection.execute(`INSERT INTO portfolio_links (portfolio_id, link_type, url) VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE url=VALUES(url)`, [item.id, type, url]);
    }
    if (item.cover && !same(previous?.cover, item.cover)) {
      const settings = JSON.stringify(item.cover);
      await connection.execute(`INSERT INTO portfolio_covers (portfolio_id, settings) VALUES (?, ?)
        ON DUPLICATE KEY UPDATE settings = ?`, [item.id, settings, settings]);
    }
    if (item.materials && !same(previous?.materials, item.materials)) {
      const settings = JSON.stringify(item.materials);
      await connection.execute(`INSERT INTO portfolio_materials (portfolio_id, settings) VALUES (?, ?)
        ON DUPLICATE KEY UPDATE settings = ?`, [item.id, settings, settings]);
    }
    if (item.contact && !same(previous?.contact, item.contact)) {
      const settings = JSON.stringify(item.contact);
      await connection.execute(`INSERT INTO portfolio_contacts (portfolio_id, settings) VALUES (?, ?)
        ON DUPLICATE KEY UPDATE settings = ?`, [item.id, settings, settings]);
    }
    if (!transaction) await connection.commit();
  } catch (error) {
    if (!transaction) await connection.rollback();
    throw error;
  } finally {
    if (!transaction) connection.release();
  }
}

async function remove(uid, item) {
  if (!pool) {
    updateLocal(data => {
      const index = data.items.findIndex(row => row.id === item.id && row.version === item.version);
      if (index < 0) throw conflict();
      data.items.splice(index, 1);
      data.analyses = data.analyses.filter(row => row.portfolioId !== item.id);
    });
    return;
  }
  const db = await portfolioDb();
  const [result] = await db.execute('DELETE FROM portfolios WHERE user_id = ? AND id = ? AND version = ?',
    [uid, item.id, item.version]);
  if (!result.affectedRows) throw conflict();
}

async function analysisHistory(uid, portfolioId) {
  if (!pool) {
    return readLocal().analyses.filter(row => row.portfolioId === portfolioId).slice(0, 30);
  }
  const db = await portfolioDb();
  const [recent] = await db.execute(`SELECT id, analysis_content AS text, created_at AS createdAt FROM portfolio_analyses
    WHERE user_id = ? AND portfolio_id <=> ? ORDER BY created_at DESC, id LIMIT 30`, [uid, portfolioId]);
  return recent;
}

async function addAnalysis(uid, entry, generation) {
  if (!pool) {
    updateLocal(data => {
      if (entry.portfolioId && !data.items.some(item => item.id === entry.portfolioId)) throw conflict();
      data.analyses.unshift({ ...entry, createdAt: new Date() });
    });
    return;
  }
  const db = await portfolioDb();
  const [result] = await db.execute(`INSERT INTO portfolio_analyses (id, user_id, portfolio_id, analysis_content)
    SELECT ?, u.uid, ?, ? ${currentMember}`, [entry.id, entry.portfolioId, entry.text, uid, generation]);
  if (!result.affectedRows) throw memberChanged();
}

module.exports = { list, listCards, pageSettings, savePageSettings, get, shared, save, remove, analysisHistory, addAnalysis };
