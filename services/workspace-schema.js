// Account table names and UIDs stay stable so existing logins remain valid.
async function createWorkspaceTables(db) {
  const statements = [
    `CREATE TABLE IF NOT EXISTS projects (
      id VARCHAR(80) PRIMARY KEY, user_id INT UNSIGNED NOT NULL,
      title VARCHAR(160) NOT NULL, description TEXT NOT NULL, technologies TEXT NOT NULL,
      status ENUM('work','complete') NOT NULL DEFAULT 'work', progress TINYINT UNSIGNED NOT NULL DEFAULT 0,
      color CHAR(7) NOT NULL, category VARCHAR(20) NOT NULL, icon VARCHAR(20) NOT NULL,
      started_at DATE, completed_at DATE, deadline DATE, sort_order INT UNSIGNED NOT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      INDEX (user_id, status), FOREIGN KEY (user_id) REFERENCES projectlog_users(uid) ON DELETE CASCADE,
      CHECK (progress <= 100)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS nodes (
      id VARCHAR(80) PRIMARY KEY, project_id VARCHAR(80) NOT NULL, parent_node_id VARCHAR(80),
      title VARCHAR(160) NOT NULL, type VARCHAR(40) NOT NULL DEFAULT 'work', content MEDIUMTEXT NOT NULL,
      status ENUM('work','complete') NOT NULL DEFAULT 'work',
      error_status ENUM('','issue','resolved') NOT NULL DEFAULT '', issue_type VARCHAR(80) NOT NULL DEFAULT '',
      work_date DATE NOT NULL, action_content TEXT NOT NULL, result_content TEXT NOT NULL,
      title_ai BOOLEAN NOT NULL DEFAULT FALSE, content_ai BOOLEAN NOT NULL DEFAULT FALSE,
      action_ai BOOLEAN NOT NULL DEFAULT FALSE, result_ai BOOLEAN NOT NULL DEFAULT FALSE,
      artifact_required BOOLEAN NOT NULL DEFAULT FALSE, sort_order INT UNSIGNED NOT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      INDEX (project_id, work_date), INDEX (parent_node_id), INDEX (work_date),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_node_id) REFERENCES nodes(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS node_revisions (
      id CHAR(36) PRIMARY KEY, node_id VARCHAR(80) NOT NULL, version INT UNSIGNED NOT NULL,
      content MEDIUMTEXT NOT NULL, github VARCHAR(2048) NOT NULL, related_link VARCHAR(2048) NOT NULL,
      code_ai BOOLEAN NOT NULL DEFAULT FALSE, snapshot_title VARCHAR(160) NOT NULL, snapshot_content MEDIUMTEXT NOT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      UNIQUE (node_id, version), FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS node_files (
      id CHAR(36) PRIMARY KEY, node_id VARCHAR(80) NOT NULL, revision_id CHAR(36),
      original_name VARCHAR(255) NOT NULL, stored_name VARCHAR(255) NOT NULL, file_path VARCHAR(255) NOT NULL,
      file_type VARCHAR(80) NOT NULL, file_size BIGINT UNSIGNED NOT NULL DEFAULT 0, sort_order INT UNSIGNED NOT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      UNIQUE (node_id, stored_name), INDEX (stored_name),
      FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE,
      FOREIGN KEY (revision_id) REFERENCES node_revisions(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS feedbacks (
      id CHAR(36) PRIMARY KEY, node_id VARCHAR(80) NOT NULL, public_id VARCHAR(100) NOT NULL,
      is_legacy BOOLEAN NOT NULL DEFAULT FALSE, mode VARCHAR(40) NOT NULL, style VARCHAR(80) NOT NULL,
      request_content TEXT NOT NULL, content MEDIUMTEXT NOT NULL, selected BOOLEAN NOT NULL DEFAULT FALSE,
      adopted_at DATETIME(3), pinned BOOLEAN NOT NULL DEFAULT FALSE, regenerated_from CHAR(36), next_node_id VARCHAR(80),
      highlights JSON NOT NULL, underlines JSON NOT NULL, sort_order INT UNSIGNED NOT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      UNIQUE (node_id, public_id), INDEX (selected, node_id),
      FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE,
      FOREIGN KEY (regenerated_from) REFERENCES feedbacks(id) ON DELETE SET NULL,
      FOREIGN KEY (next_node_id) REFERENCES nodes(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS feedback_actions (
      id CHAR(36) PRIMARY KEY, feedback_id CHAR(36) NOT NULL, node_id VARCHAR(80) NOT NULL,
      action_content TEXT NOT NULL, result ENUM('success','failed','pending') NOT NULL DEFAULT 'pending', result_note TEXT NOT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX (feedback_id, created_at), INDEX (node_id), INDEX (result),
      FOREIGN KEY (feedback_id) REFERENCES feedbacks(id) ON DELETE CASCADE,
      FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS todos (
      id VARCHAR(80) PRIMARY KEY, user_id INT UNSIGNED NOT NULL, project_id VARCHAR(80), feedback_id CHAR(36),
      title VARCHAR(160) NOT NULL, description TEXT NOT NULL,
      status ENUM('pending','complete') NOT NULL DEFAULT 'pending', due_date DATE, completed_at DATETIME(3),
      sort_order INT UNSIGNED NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX (user_id, status, completed_at), INDEX (project_id), INDEX (due_date),
      FOREIGN KEY (user_id) REFERENCES projectlog_users(uid) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
      FOREIGN KEY (feedback_id) REFERENCES feedbacks(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS activity_logs (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, user_id INT UNSIGNED NOT NULL,
      project_id VARCHAR(80), node_id VARCHAR(80), todo_id VARCHAR(80), activity_type VARCHAR(40) NOT NULL, description TEXT NOT NULL,
      progress TINYINT UNSIGNED,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX (user_id, created_at), INDEX (project_id, created_at), INDEX (node_id), INDEX (created_at),
      FOREIGN KEY (user_id) REFERENCES projectlog_users(uid) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
      CONSTRAINT fk_activity_todo FOREIGN KEY (todo_id) REFERENCES todos(id) ON DELETE SET NULL,
      FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS alerts (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, user_id INT UNSIGNED NOT NULL, alert_key VARCHAR(255) NOT NULL,
      node_id VARCHAR(80), feedback_id CHAR(36), type VARCHAR(20) NOT NULL, message TEXT NOT NULL,
      is_read BOOLEAN NOT NULL DEFAULT FALSE, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      UNIQUE (user_id, alert_key), INDEX (user_id, is_read, created_at),
      FOREIGN KEY (user_id) REFERENCES projectlog_users(uid) ON DELETE CASCADE,
      FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE,
      FOREIGN KEY (feedback_id) REFERENCES feedbacks(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS projectlog_ai_slots (
      id TINYINT UNSIGNED PRIMARY KEY, lease_token CHAR(36), expires_at DATETIME(3)
    ) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS projectlog_feedback_requests (
      user_id INT UNSIGNED NOT NULL, request_id CHAR(36) NOT NULL, generation INT UNSIGNED NOT NULL,
      node_id VARCHAR(80) NOT NULL, fingerprint CHAR(64) NOT NULL,
      status VARCHAR(16) NOT NULL, payload JSON,
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (user_id, request_id), INDEX (user_id, status, updated_at),
      FOREIGN KEY (user_id) REFERENCES projectlog_users(uid) ON DELETE CASCADE,
      FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  ];
  for (const sql of statements) await db.query(sql);
  await db.query('INSERT IGNORE INTO projectlog_ai_slots (id) VALUES (1),(2),(3),(4),(5),(6),(7),(8)');
  const [activityColumns] = await db.query(`SELECT COLUMN_NAME FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='activity_logs'`);
  if (!activityColumns.some(column => column.COLUMN_NAME === 'todo_id')) {
    await db.query('ALTER TABLE activity_logs ADD todo_id VARCHAR(80) NULL, ADD CONSTRAINT fk_activity_todo FOREIGN KEY (todo_id) REFERENCES todos(id) ON DELETE SET NULL');
  }
  const [columns] = await db.query(`SELECT COLUMN_NAME FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'projectlog_workspaces'`);
  if (!columns.some(column => column.COLUMN_NAME === 'storage_version')) {
    const legacy = columns.some(column => column.COLUMN_NAME === 'records');
    await db.query('ALTER TABLE projectlog_workspaces ADD storage_version TINYINT UNSIGNED NOT NULL DEFAULT ' + (legacy ? 0 : 1));
  }
  // Retain raw SQL backups in the migration script; active workspace rows only hold lock metadata.
  if (columns.some(column => column.COLUMN_NAME === 'records')) {
    await db.query('ALTER TABLE projectlog_workspaces MODIFY records JSON NULL');
  }
}

module.exports = { createWorkspaceTables };
