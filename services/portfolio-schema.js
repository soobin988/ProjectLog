async function createPortfolioTables(db) {
  await db.query(`CREATE TABLE IF NOT EXISTS portfolio_pages (
    user_id INT UNSIGNED PRIMARY KEY,
    heading VARCHAR(80) NOT NULL,
    description VARCHAR(300) NOT NULL,
    FOREIGN KEY (user_id) REFERENCES projectlog_users(uid) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await db.query(`CREATE TABLE IF NOT EXISTS portfolios (
    id CHAR(36) PRIMARY KEY,
    user_id INT UNSIGNED NOT NULL,
    project_id VARCHAR(80),
    title VARCHAR(160) NOT NULL,
    description TEXT NOT NULL,
    role VARCHAR(100) NOT NULL,
    status VARCHAR(20) NOT NULL,
    category VARCHAR(20) NOT NULL,
    start_date CHAR(10) NOT NULL,
    end_date CHAR(10) NOT NULL,
    is_public BOOLEAN NOT NULL DEFAULT FALSE,
    version INT UNSIGNED NOT NULL DEFAULT 0,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    INDEX (user_id, created_at),
    INDEX (project_id),
    CONSTRAINT fk_portfolio_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
    FOREIGN KEY (user_id) REFERENCES projectlog_users(uid) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await db.query(`CREATE TABLE IF NOT EXISTS portfolio_covers (
    portfolio_id CHAR(36) PRIMARY KEY,
    settings JSON NOT NULL,
    FOREIGN KEY (portfolio_id) REFERENCES portfolios(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await db.query(`CREATE TABLE IF NOT EXISTS portfolio_materials (
    portfolio_id CHAR(36) PRIMARY KEY,
    settings JSON NOT NULL,
    FOREIGN KEY (portfolio_id) REFERENCES portfolios(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await db.query(`CREATE TABLE IF NOT EXISTS portfolio_contacts (
    portfolio_id CHAR(36) PRIMARY KEY,
    settings JSON NOT NULL,
    FOREIGN KEY (portfolio_id) REFERENCES portfolios(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await db.query(`CREATE TABLE IF NOT EXISTS portfolio_technologies (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    portfolio_id CHAR(36) NOT NULL,
    technology VARCHAR(80) NOT NULL,
    FOREIGN KEY (portfolio_id) REFERENCES portfolios(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await db.query(`CREATE TABLE IF NOT EXISTS portfolio_files (
    id CHAR(36) PRIMARY KEY,
    portfolio_id CHAR(36) NOT NULL,
    file_type VARCHAR(16) NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    stored_name CHAR(36) NOT NULL,
    file_path VARCHAR(255) NOT NULL,
    file_size INT UNSIGNED NOT NULL,
    mime_type VARCHAR(32) NOT NULL,
    caption VARCHAR(200) NOT NULL,
    is_thumbnail BOOLEAN NOT NULL,
    sort_order INT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    FOREIGN KEY (portfolio_id) REFERENCES portfolios(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await db.query(`CREATE TABLE IF NOT EXISTS portfolio_links (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    portfolio_id CHAR(36) NOT NULL,
    link_type VARCHAR(20) NOT NULL,
    url VARCHAR(255) NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE (portfolio_id, link_type),
    FOREIGN KEY (portfolio_id) REFERENCES portfolios(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await db.query(`CREATE TABLE IF NOT EXISTS portfolio_analyses (
    id CHAR(36) PRIMARY KEY,
    user_id INT UNSIGNED NOT NULL,
    portfolio_id CHAR(36),
    analysis_content MEDIUMTEXT NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX (user_id, portfolio_id, created_at),
    FOREIGN KEY (user_id) REFERENCES projectlog_users(uid) ON DELETE CASCADE,
    FOREIGN KEY (portfolio_id) REFERENCES portfolios(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
}

module.exports = { createPortfolioTables };
