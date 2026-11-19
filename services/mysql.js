const mysqlUrl = process.env.PROJECT_LOG_MYSQL_URL;
const { createPortfolioTables } = require('./portfolio-schema');
const { createWorkspaceTables } = require('./workspace-schema');
const pool = mysqlUrl ? require('mysql2/promise').createPool({ uri: mysqlUrl, dateStrings: true, timezone: 'Z' }) : null;
// DATETIME values and usage counters share UTC; display dates are converted to Seoul time in the UI.
if (pool) pool.on('connection', connection => connection.query("SET time_zone = '+00:00'"));
let initialized;

async function createTables() {
  await pool.query(`CREATE TABLE IF NOT EXISTS projectlog_users (
    uid INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(40) UNIQUE,
    password_hash VARCHAR(200),
    google_subject VARCHAR(255) UNIQUE,
    display_name VARCHAR(100) NOT NULL
  ) ENGINE=InnoDB AUTO_INCREMENT=10000 DEFAULT CHARSET=utf8mb4`);
  await pool.query(`CREATE TABLE IF NOT EXISTS projectlog_user_avatars (
    uid INT UNSIGNED PRIMARY KEY,
    mime_type VARCHAR(32) NOT NULL,
    image_data MEDIUMBLOB NOT NULL,
    image_hash CHAR(64),
    FOREIGN KEY (uid) REFERENCES projectlog_users(uid) ON DELETE CASCADE
  ) ENGINE=InnoDB`);
  const [avatarColumns] = await pool.query("SHOW COLUMNS FROM projectlog_user_avatars LIKE 'image_hash'");
  if (!avatarColumns.length) await pool.query('ALTER TABLE projectlog_user_avatars ADD image_hash CHAR(64) NULL');
  await pool.query(`CREATE TABLE IF NOT EXISTS projectlog_workspaces (
    uid INT UNSIGNED PRIMARY KEY,
    version INT UNSIGNED NOT NULL DEFAULT 0,
    storage_version TINYINT UNSIGNED NOT NULL DEFAULT 1,
    FOREIGN KEY (uid) REFERENCES projectlog_users(uid)
  ) ENGINE=InnoDB`);
  await pool.query(`CREATE TABLE IF NOT EXISTS projectlog_sessions (
    token_hash BINARY(32) PRIMARY KEY,
    uid INT UNSIGNED NOT NULL,
    expires_at DATETIME NOT NULL,
    INDEX (expires_at),
    FOREIGN KEY (uid) REFERENCES projectlog_users(uid) ON DELETE CASCADE
  ) ENGINE=InnoDB`);
  await pool.query(`CREATE TABLE IF NOT EXISTS projectlog_suggestions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    uid INT UNSIGNED NOT NULL,
    message TEXT NOT NULL,
    submitted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (uid) REFERENCES projectlog_users(uid)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await pool.query(`CREATE TABLE IF NOT EXISTS projectlog_guest_suggestions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    message TEXT NOT NULL,
    submitted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  for (const table of ['projectlog_suggestions', 'projectlog_guest_suggestions']) {
    const [indexes] = await pool.query('SHOW INDEX FROM ' + table + " WHERE Key_name='inbox_date'");
    if (!indexes.length) await pool.query('ALTER TABLE ' + table + ' ADD INDEX inbox_date (submitted_at, id)');
  }
  await pool.query(`CREATE TABLE IF NOT EXISTS projectlog_member_settings (
    id TINYINT UNSIGNED PRIMARY KEY,
    member_limit INT UNSIGNED NOT NULL
  ) ENGINE=InnoDB`);
  await pool.query('INSERT IGNORE INTO projectlog_member_settings (id, member_limit) VALUES (1, 90000)');
  await pool.query(`CREATE TABLE IF NOT EXISTS projectlog_dashboard_settings (
    id TINYINT UNSIGNED PRIMARY KEY,
    layout JSON NOT NULL
  ) ENGINE=InnoDB`);
  await pool.query(`CREATE TABLE IF NOT EXISTS projectlog_updates (
    id CHAR(36) PRIMARY KEY,
    version VARCHAR(32) NOT NULL,
    title VARCHAR(160) NOT NULL,
    content TEXT NOT NULL,
    published_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX (published_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await pool.query(`CREATE TABLE IF NOT EXISTS projectlog_member_epochs (
    uid INT UNSIGNED PRIMARY KEY,
    generation INT UNSIGNED NOT NULL,
    FOREIGN KEY (uid) REFERENCES projectlog_users(uid) ON DELETE CASCADE
  ) ENGINE=InnoDB`);
  await createWorkspaceTables(pool);
}

async function ready() {
  initialized ||= createTables().catch(error => {
    initialized = undefined;
    throw error;
  });
  await initialized;
  return pool;
}

let portfolioInitialized;
async function portfolioDb() {
  await ready();
  portfolioInitialized ||= createPortfolioTables(pool).catch(error => {
    portfolioInitialized = undefined;
    throw error;
  });
  await portfolioInitialized;
  return pool;
}

const emptyWorkspace = () => ({ projects: [], nodes: [], todos: [], readAlerts: [] });

module.exports = { pool, ready, portfolioDb, emptyWorkspace };
