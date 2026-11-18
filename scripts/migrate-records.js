const path = require('node:path');
const { pool, portfolioDb } = require('../services/mysql');
const { usageDb } = require('../services/member-usage');
const { migrateRecords } = require('../services/workspace-migration');

async function main() {
  if (!pool) throw new Error('PROJECT_LOG_MYSQL_URL을 설정해 주세요.');
  const result = await migrateRecords(pool, {
    backupDirectory: process.env.PROJECT_LOG_BACKUPS || path.resolve(__dirname, '../backups'),
    initialize: async () => { await portfolioDb(); await usageDb(); }
  });
  console.log('Migration complete:', result);
  if (process.argv.includes('--export-schema')) {
    console.log('Verified relational records:', (await require('./verify-relational').verifyRelational(pool, result.migrated > 0 || process.argv.includes('--compare-legacy'))).length, 'users');
    const metadata = await require('./export-schema').exportSchema(pool);
    console.log('Exported actual schema:', metadata.tables.length, 'tables,', metadata.relations.length, 'foreign keys');
  }
}

if (require.main === module) main().catch(error => {
  console.error('Migration stopped:', error.message);
  process.exitCode = 1;
}).finally(() => pool?.end());

module.exports = { main };
