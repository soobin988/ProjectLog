-- Generated from the implemented MySQL schema; no user data included.

-- Parent tables precede dependent tables. Live sequence counters are reset for a fresh installation.

CREATE TABLE `projectlog_dashboard_settings` (
  `id` tinyint unsigned NOT NULL,
  `layout` json NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `projectlog_guest_suggestions` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `message` text NOT NULL,
  `submitted_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `projectlog_member_settings` (
  `id` tinyint unsigned NOT NULL,
  `member_limit` int unsigned NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `projectlog_updates` (
  `id` char(36) NOT NULL,
  `version` varchar(32) NOT NULL,
  `title` varchar(160) NOT NULL,
  `content` text NOT NULL,
  `published_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `published_at` (`published_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `projectlog_users` (
  `uid` int unsigned NOT NULL AUTO_INCREMENT,
  `username` varchar(40) DEFAULT NULL,
  `password_hash` varchar(200) DEFAULT NULL,
  `google_subject` varchar(255) DEFAULT NULL,
  `display_name` varchar(100) NOT NULL,
  PRIMARY KEY (`uid`),
  UNIQUE KEY `username` (`username`),
  UNIQUE KEY `google_subject` (`google_subject`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci AUTO_INCREMENT=10000;

CREATE TABLE `portfolio_categories` (
  `id` char(20) NOT NULL,
  `user_id` int unsigned NOT NULL,
  `name` varchar(40) NOT NULL,
  `name_key` varbinary(255) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `user_id` (`user_id`,`name_key`),
  CONSTRAINT `portfolio_categories_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `projectlog_users` (`uid`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `portfolio_pages` (
  `user_id` int unsigned NOT NULL,
  `heading` varchar(80) NOT NULL,
  `description` varchar(300) NOT NULL,
  PRIMARY KEY (`user_id`),
  CONSTRAINT `portfolio_pages_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `projectlog_users` (`uid`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `projectlog_activity` (
  `uid` int unsigned NOT NULL,
  `minute_slot` int unsigned NOT NULL,
  `active_slots` smallint unsigned NOT NULL,
  PRIMARY KEY (`uid`,`minute_slot`),
  KEY `minute_slot` (`minute_slot`),
  CONSTRAINT `projectlog_activity_ibfk_1` FOREIGN KEY (`uid`) REFERENCES `projectlog_users` (`uid`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `projectlog_member_epochs` (
  `uid` int unsigned NOT NULL,
  `generation` int unsigned NOT NULL,
  PRIMARY KEY (`uid`),
  CONSTRAINT `projectlog_member_epochs_ibfk_1` FOREIGN KEY (`uid`) REFERENCES `projectlog_users` (`uid`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `projectlog_sessions` (
  `token_hash` binary(32) NOT NULL,
  `uid` int unsigned NOT NULL,
  `expires_at` datetime NOT NULL,
  PRIMARY KEY (`token_hash`),
  KEY `expires_at` (`expires_at`),
  KEY `uid` (`uid`),
  CONSTRAINT `projectlog_sessions_ibfk_1` FOREIGN KEY (`uid`) REFERENCES `projectlog_users` (`uid`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `projectlog_suggestions` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `uid` int unsigned NOT NULL,
  `message` text NOT NULL,
  `submitted_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `uid` (`uid`),
  CONSTRAINT `projectlog_suggestions_ibfk_1` FOREIGN KEY (`uid`) REFERENCES `projectlog_users` (`uid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `projectlog_user_avatars` (
  `uid` int unsigned NOT NULL,
  `mime_type` varchar(32) NOT NULL,
  `image_data` mediumblob NOT NULL,
  PRIMARY KEY (`uid`),
  CONSTRAINT `projectlog_user_avatars_ibfk_1` FOREIGN KEY (`uid`) REFERENCES `projectlog_users` (`uid`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `projectlog_workspaces` (
  `uid` int unsigned NOT NULL,
  `legacy_records` json DEFAULT NULL,
  `version` int unsigned NOT NULL DEFAULT '0',
  `storage_version` tinyint unsigned NOT NULL DEFAULT '1',
  PRIMARY KEY (`uid`),
  CONSTRAINT `projectlog_workspaces_ibfk_1` FOREIGN KEY (`uid`) REFERENCES `projectlog_users` (`uid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `projects` (
  `id` varchar(80) NOT NULL,
  `user_id` int unsigned NOT NULL,
  `title` varchar(160) NOT NULL,
  `description` text NOT NULL,
  `technologies` text NOT NULL,
  `status` enum('work','complete') NOT NULL DEFAULT 'work',
  `progress` tinyint unsigned NOT NULL DEFAULT '0',
  `color` char(7) NOT NULL,
  `category` varchar(20) NOT NULL,
  `icon` varchar(20) NOT NULL,
  `started_at` date DEFAULT NULL,
  `completed_at` date DEFAULT NULL,
  `deadline` date DEFAULT NULL,
  `sort_order` int unsigned NOT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`,`status`),
  CONSTRAINT `projects_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `projectlog_users` (`uid`) ON DELETE CASCADE,
  CONSTRAINT `projects_chk_1` CHECK ((`progress` <= 100))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `nodes` (
  `id` varchar(80) NOT NULL,
  `project_id` varchar(80) NOT NULL,
  `parent_node_id` varchar(80) DEFAULT NULL,
  `title` varchar(160) NOT NULL,
  `type` varchar(40) NOT NULL DEFAULT 'work',
  `content` mediumtext NOT NULL,
  `status` enum('work','complete') NOT NULL DEFAULT 'work',
  `error_status` enum('','issue','resolved') NOT NULL DEFAULT '',
  `issue_type` varchar(80) NOT NULL DEFAULT '',
  `work_date` date NOT NULL,
  `action_content` text NOT NULL,
  `result_content` text NOT NULL,
  `title_ai` tinyint(1) NOT NULL DEFAULT '0',
  `content_ai` tinyint(1) NOT NULL DEFAULT '0',
  `action_ai` tinyint(1) NOT NULL DEFAULT '0',
  `result_ai` tinyint(1) NOT NULL DEFAULT '0',
  `artifact_required` tinyint(1) NOT NULL DEFAULT '0',
  `sort_order` int unsigned NOT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `project_id` (`project_id`,`work_date`),
  KEY `parent_node_id` (`parent_node_id`),
  KEY `work_date` (`work_date`),
  CONSTRAINT `nodes_ibfk_1` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE CASCADE,
  CONSTRAINT `nodes_ibfk_2` FOREIGN KEY (`parent_node_id`) REFERENCES `nodes` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `portfolios` (
  `id` char(36) NOT NULL,
  `user_id` int unsigned NOT NULL,
  `project_id` varchar(80) DEFAULT NULL,
  `title` varchar(160) NOT NULL,
  `description` text NOT NULL,
  `role` varchar(100) NOT NULL,
  `status` varchar(20) NOT NULL,
  `category` varchar(20) NOT NULL,
  `start_date` char(10) NOT NULL,
  `end_date` char(10) NOT NULL,
  `is_public` tinyint(1) NOT NULL DEFAULT '0',
  `version` int unsigned NOT NULL DEFAULT '0',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`,`created_at`),
  KEY `fk_portfolio_project` (`project_id`),
  CONSTRAINT `fk_portfolio_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE SET NULL,
  CONSTRAINT `portfolios_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `projectlog_users` (`uid`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `feedbacks` (
  `id` char(36) NOT NULL,
  `node_id` varchar(80) NOT NULL,
  `public_id` varchar(100) NOT NULL,
  `is_legacy` tinyint(1) NOT NULL DEFAULT '0',
  `mode` varchar(40) NOT NULL,
  `style` varchar(80) NOT NULL,
  `request_content` text NOT NULL,
  `content` mediumtext NOT NULL,
  `selected` tinyint(1) NOT NULL DEFAULT '0',
  `adopted_at` datetime(3) DEFAULT NULL,
  `pinned` tinyint(1) NOT NULL DEFAULT '0',
  `regenerated_from` char(36) DEFAULT NULL,
  `next_node_id` varchar(80) DEFAULT NULL,
  `highlights` json NOT NULL,
  `underlines` json NOT NULL,
  `sort_order` int unsigned NOT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `node_id` (`node_id`,`public_id`),
  KEY `selected` (`selected`,`node_id`),
  KEY `regenerated_from` (`regenerated_from`),
  KEY `next_node_id` (`next_node_id`),
  CONSTRAINT `feedbacks_ibfk_1` FOREIGN KEY (`node_id`) REFERENCES `nodes` (`id`) ON DELETE CASCADE,
  CONSTRAINT `feedbacks_ibfk_2` FOREIGN KEY (`regenerated_from`) REFERENCES `feedbacks` (`id`) ON DELETE SET NULL,
  CONSTRAINT `feedbacks_ibfk_3` FOREIGN KEY (`next_node_id`) REFERENCES `nodes` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `node_revisions` (
  `id` char(36) NOT NULL,
  `node_id` varchar(80) NOT NULL,
  `version` int unsigned NOT NULL,
  `content` mediumtext NOT NULL,
  `github` varchar(2048) NOT NULL,
  `related_link` varchar(2048) NOT NULL,
  `code_ai` tinyint(1) NOT NULL DEFAULT '0',
  `snapshot_title` varchar(160) NOT NULL,
  `snapshot_content` mediumtext NOT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `node_id` (`node_id`,`version`),
  CONSTRAINT `node_revisions_ibfk_1` FOREIGN KEY (`node_id`) REFERENCES `nodes` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `portfolio_analyses` (
  `id` char(36) NOT NULL,
  `user_id` int unsigned NOT NULL,
  `portfolio_id` char(36) DEFAULT NULL,
  `analysis_content` mediumtext NOT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`,`portfolio_id`,`created_at`),
  KEY `portfolio_id` (`portfolio_id`),
  CONSTRAINT `portfolio_analyses_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `projectlog_users` (`uid`) ON DELETE CASCADE,
  CONSTRAINT `portfolio_analyses_ibfk_2` FOREIGN KEY (`portfolio_id`) REFERENCES `portfolios` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `portfolio_contacts` (
  `portfolio_id` char(36) NOT NULL,
  `settings` json NOT NULL,
  PRIMARY KEY (`portfolio_id`),
  CONSTRAINT `portfolio_contacts_ibfk_1` FOREIGN KEY (`portfolio_id`) REFERENCES `portfolios` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `portfolio_covers` (
  `portfolio_id` char(36) NOT NULL,
  `settings` json NOT NULL,
  PRIMARY KEY (`portfolio_id`),
  CONSTRAINT `portfolio_covers_ibfk_1` FOREIGN KEY (`portfolio_id`) REFERENCES `portfolios` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `portfolio_files` (
  `id` char(36) NOT NULL,
  `portfolio_id` char(36) NOT NULL,
  `file_type` varchar(16) NOT NULL,
  `original_name` varchar(255) NOT NULL,
  `stored_name` char(36) NOT NULL,
  `file_path` varchar(255) NOT NULL,
  `file_size` int unsigned NOT NULL,
  `mime_type` varchar(32) NOT NULL,
  `caption` varchar(200) NOT NULL,
  `is_thumbnail` tinyint(1) NOT NULL,
  `sort_order` int unsigned NOT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `portfolio_id` (`portfolio_id`),
  CONSTRAINT `portfolio_files_ibfk_1` FOREIGN KEY (`portfolio_id`) REFERENCES `portfolios` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `portfolio_links` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `portfolio_id` char(36) NOT NULL,
  `link_type` varchar(20) NOT NULL,
  `url` varchar(255) NOT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `portfolio_id` (`portfolio_id`,`link_type`),
  CONSTRAINT `portfolio_links_ibfk_1` FOREIGN KEY (`portfolio_id`) REFERENCES `portfolios` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `portfolio_materials` (
  `portfolio_id` char(36) NOT NULL,
  `settings` json NOT NULL,
  PRIMARY KEY (`portfolio_id`),
  CONSTRAINT `portfolio_materials_ibfk_1` FOREIGN KEY (`portfolio_id`) REFERENCES `portfolios` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `portfolio_technologies` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `portfolio_id` char(36) NOT NULL,
  `technology` varchar(80) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `portfolio_id` (`portfolio_id`),
  CONSTRAINT `portfolio_technologies_ibfk_1` FOREIGN KEY (`portfolio_id`) REFERENCES `portfolios` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `alerts` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int unsigned NOT NULL,
  `alert_key` varchar(255) NOT NULL,
  `node_id` varchar(80) DEFAULT NULL,
  `feedback_id` char(36) DEFAULT NULL,
  `type` varchar(20) NOT NULL,
  `message` text NOT NULL,
  `is_read` tinyint(1) NOT NULL DEFAULT '0',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `user_id` (`user_id`,`alert_key`),
  KEY `user_id_2` (`user_id`,`is_read`,`created_at`),
  KEY `node_id` (`node_id`),
  KEY `feedback_id` (`feedback_id`),
  CONSTRAINT `alerts_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `projectlog_users` (`uid`) ON DELETE CASCADE,
  CONSTRAINT `alerts_ibfk_2` FOREIGN KEY (`node_id`) REFERENCES `nodes` (`id`) ON DELETE CASCADE,
  CONSTRAINT `alerts_ibfk_3` FOREIGN KEY (`feedback_id`) REFERENCES `feedbacks` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `feedback_actions` (
  `id` char(36) NOT NULL,
  `feedback_id` char(36) NOT NULL,
  `node_id` varchar(80) NOT NULL,
  `action_content` text NOT NULL,
  `result` enum('success','failed','pending') NOT NULL DEFAULT 'pending',
  `result_note` text NOT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `feedback_id` (`feedback_id`,`created_at`),
  KEY `node_id` (`node_id`),
  KEY `result` (`result`),
  CONSTRAINT `feedback_actions_ibfk_1` FOREIGN KEY (`feedback_id`) REFERENCES `feedbacks` (`id`) ON DELETE CASCADE,
  CONSTRAINT `feedback_actions_ibfk_2` FOREIGN KEY (`node_id`) REFERENCES `nodes` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `node_files` (
  `id` char(36) NOT NULL,
  `node_id` varchar(80) NOT NULL,
  `revision_id` char(36) DEFAULT NULL,
  `original_name` varchar(255) NOT NULL,
  `stored_name` varchar(255) NOT NULL,
  `file_path` varchar(255) NOT NULL,
  `file_type` varchar(80) NOT NULL,
  `file_size` bigint unsigned NOT NULL DEFAULT '0',
  `sort_order` int unsigned NOT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `node_id` (`node_id`,`stored_name`),
  KEY `stored_name` (`stored_name`),
  KEY `revision_id` (`revision_id`),
  CONSTRAINT `node_files_ibfk_1` FOREIGN KEY (`node_id`) REFERENCES `nodes` (`id`) ON DELETE CASCADE,
  CONSTRAINT `node_files_ibfk_2` FOREIGN KEY (`revision_id`) REFERENCES `node_revisions` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `projectlog_ai_usage` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `uid` int unsigned NOT NULL,
  `recorded_at` int unsigned NOT NULL,
  `feature` varchar(20) NOT NULL,
  `succeeded` tinyint(1) NOT NULL,
  `input_tokens` int unsigned DEFAULT NULL,
  `output_tokens` int unsigned DEFAULT NULL,
  `total_tokens` int unsigned DEFAULT NULL,
  `project_id` varchar(80) DEFAULT NULL,
  `node_id` varchar(80) DEFAULT NULL,
  `feedback_id` char(36) DEFAULT NULL,
  `model` varchar(100) NOT NULL DEFAULT '',
  `estimated_cost` decimal(14,8) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `uid` (`uid`,`recorded_at`),
  KEY `recorded_at` (`recorded_at`),
  KEY `fk_ai_usage_project_id` (`project_id`),
  KEY `fk_ai_usage_node_id` (`node_id`),
  KEY `fk_ai_usage_feedback_id` (`feedback_id`),
  CONSTRAINT `fk_ai_usage_feedback_id` FOREIGN KEY (`feedback_id`) REFERENCES `feedbacks` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_ai_usage_node_id` FOREIGN KEY (`node_id`) REFERENCES `nodes` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_ai_usage_project_id` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE SET NULL,
  CONSTRAINT `projectlog_ai_usage_ibfk_1` FOREIGN KEY (`uid`) REFERENCES `projectlog_users` (`uid`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `todos` (
  `id` varchar(80) NOT NULL,
  `user_id` int unsigned NOT NULL,
  `project_id` varchar(80) DEFAULT NULL,
  `feedback_id` char(36) DEFAULT NULL,
  `title` varchar(160) NOT NULL,
  `description` text NOT NULL,
  `status` enum('pending','complete') NOT NULL DEFAULT 'pending',
  `due_date` date DEFAULT NULL,
  `completed_at` datetime(3) DEFAULT NULL,
  `sort_order` int unsigned NOT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`,`status`,`completed_at`),
  KEY `project_id` (`project_id`),
  KEY `due_date` (`due_date`),
  KEY `feedback_id` (`feedback_id`),
  CONSTRAINT `todos_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `projectlog_users` (`uid`) ON DELETE CASCADE,
  CONSTRAINT `todos_ibfk_2` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE SET NULL,
  CONSTRAINT `todos_ibfk_3` FOREIGN KEY (`feedback_id`) REFERENCES `feedbacks` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `activity_logs` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int unsigned NOT NULL,
  `project_id` varchar(80) DEFAULT NULL,
  `node_id` varchar(80) DEFAULT NULL,
  `activity_type` varchar(40) NOT NULL,
  `description` text NOT NULL,
  `progress` tinyint unsigned DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `todo_id` varchar(80) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`,`created_at`),
  KEY `project_id` (`project_id`,`created_at`),
  KEY `node_id` (`node_id`),
  KEY `created_at` (`created_at`),
  KEY `fk_activity_todo` (`todo_id`),
  CONSTRAINT `activity_logs_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `projectlog_users` (`uid`) ON DELETE CASCADE,
  CONSTRAINT `activity_logs_ibfk_2` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE SET NULL,
  CONSTRAINT `activity_logs_ibfk_3` FOREIGN KEY (`node_id`) REFERENCES `nodes` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_activity_todo` FOREIGN KEY (`todo_id`) REFERENCES `todos` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
