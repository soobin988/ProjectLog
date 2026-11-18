const path = require('node:path');
const { mkdir, writeFile } = require('node:fs/promises');

async function exportSchema(db, root = path.resolve(__dirname, '..')) {
  const [columns] = await db.query(`SELECT TABLE_NAME AS tableName, COLUMN_NAME AS name, COLUMN_TYPE AS type,
    IS_NULLABLE AS nullable, COLUMN_KEY AS columnKey, ORDINAL_POSITION AS position
    FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME, ORDINAL_POSITION`);
  const [relations] = await db.query(`SELECT k.TABLE_NAME AS child, k.COLUMN_NAME AS columnName,
    k.REFERENCED_TABLE_NAME AS parent, k.REFERENCED_COLUMN_NAME AS parentColumn,
    r.DELETE_RULE AS deleteRule, k.CONSTRAINT_NAME AS constraintName
    FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r
      ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.TABLE_NAME=k.TABLE_NAME AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME
    WHERE k.TABLE_SCHEMA=DATABASE() AND k.REFERENCED_TABLE_NAME IS NOT NULL
    ORDER BY k.TABLE_NAME,k.CONSTRAINT_NAME,k.ORDINAL_POSITION`);
  const [indexes] = await db.query(`SELECT TABLE_NAME AS tableName, INDEX_NAME AS name, COLUMN_NAME AS columnName,
    NON_UNIQUE AS nonUnique, SEQ_IN_INDEX AS position FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX`);
  const tables = Object.entries(Object.groupBy(columns, row => row.tableName)).map(([name, columns]) => ({ name, columns }));
  const pending = new Map(tables.map(table => [table.name, table]));
  const ordered = [];
  while (pending.size) {
    const ready = [...pending.values()].filter(table => !relations.some(edge => edge.child === table.name && edge.parent !== table.name && pending.has(edge.parent)));
    if (!ready.length) throw new Error('Cyclic schema dependencies require explicit ALTER statements');
    for (const table of ready) { ordered.push(table.name); pending.delete(table.name); }
  }
  const ddl = ['-- Generated from the implemented MySQL schema; no user data included.', '-- Parent tables precede dependent tables. Live sequence counters are reset for a fresh installation.'];
  for (const name of ordered) {
    const [[row]] = await db.query('SHOW CREATE TABLE ' + db.escapeId(name));
    const statement = row['Create Table'].replace(/ AUTO_INCREMENT=\d+/g, '');
    ddl.push(statement + (name === 'projectlog_users' ? ' AUTO_INCREMENT=10000' : '') + ';');
  }
  await mkdir(path.join(root, 'sql'), { recursive: true });
  await mkdir(path.join(root, 'docs'), { recursive: true });
  await writeFile(path.join(root, 'sql/schema.sql'), ddl.join('\n\n') + '\n');
  const metadata = { database: 'Project Log', generatedAt: new Date().toISOString(), tables, relations, indexes };
  await writeFile(path.join(root, 'docs/schema-metadata.json'), JSON.stringify(metadata, null, 2) + '\n');
  return metadata;
}

if (require.main === module) {
  const { pool, portfolioDb } = require('../services/mysql');
  const { usageDb } = require('../services/member-usage');
  (async () => {
    if (!pool) throw new Error('PROJECT_LOG_MYSQL_URL is required');
    await portfolioDb(); await usageDb();
    const metadata = await exportSchema(pool);
    console.log('Exported actual schema:', metadata.tables.length, 'tables,', metadata.relations.length, 'foreign keys');
  })().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => pool?.end());
}

module.exports = { exportSchema };
