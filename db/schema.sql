CREATE DATABASE IF NOT EXISTS cafp CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE cafp;
CREATE TABLE IF NOT EXISTS tenants (id CHAR(36) PRIMARY KEY, name VARCHAR(160) NOT NULL UNIQUE, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS users (id CHAR(36) PRIMARY KEY, tenant_id CHAR(36) NOT NULL, email VARCHAR(255) NOT NULL, name VARCHAR(160) NOT NULL, password_hash VARCHAR(255) NOT NULL, role ENUM('owner','admin','operator','viewer') NOT NULL, active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE KEY uq_tenant_email (tenant_id,email), KEY idx_user_tenant (tenant_id), FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS sessions (token_hash CHAR(64) PRIMARY KEY, user_id CHAR(36) NOT NULL, expires_at DATETIME NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, KEY idx_session_user (user_id), FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS plots (id CHAR(36) PRIMARY KEY, tenant_id CHAR(36) NOT NULL, name VARCHAR(160) NOT NULL, crop VARCHAR(120) NOT NULL DEFAULT '', area VARCHAR(80) NOT NULL DEFAULT '', created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, KEY idx_plot_tenant (tenant_id), FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS devices (id CHAR(36) PRIMARY KEY, tenant_id CHAR(36) NOT NULL, plot_id CHAR(36) NULL, label VARCHAR(160) NOT NULL, kind ENUM('sensor','camera','gateway') NOT NULL DEFAULT 'sensor', status ENUM('online','offline','maintenance') NOT NULL DEFAULT 'offline', api_key_hash CHAR(64) NOT NULL, last_seen_at DATETIME NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, KEY idx_device_tenant (tenant_id), FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE, FOREIGN KEY (plot_id) REFERENCES plots(id) ON DELETE SET NULL);
CREATE TABLE IF NOT EXISTS records (id CHAR(36) PRIMARY KEY, tenant_id CHAR(36) NOT NULL, plot_id CHAR(36) NOT NULL, device_id CHAR(36) NULL, type ENUM('reading','photo') NOT NULL, observed_at DATETIME NOT NULL, moisture DECIMAL(5,2) NULL, temperature DECIMAL(6,2) NULL, humidity DECIMAL(5,2) NULL, note TEXT NULL, photo MEDIUMTEXT NULL, source VARCHAR(80) NOT NULL DEFAULT 'manual', created_by CHAR(36) NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, KEY idx_record_tenant_time (tenant_id,observed_at), KEY idx_record_plot (plot_id), FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE, FOREIGN KEY (plot_id) REFERENCES plots(id) ON DELETE CASCADE, FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE SET NULL, FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL);
CREATE TABLE IF NOT EXISTS tenant_settings (tenant_id CHAR(36) PRIMARY KEY, low_moisture DECIMAL(5,2) NOT NULL DEFAULT 20, high_temperature DECIMAL(6,2) NOT NULL DEFAULT 35, FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS audit_events (id BIGINT AUTO_INCREMENT PRIMARY KEY, tenant_id CHAR(36) NOT NULL, actor_id CHAR(36) NULL, action VARCHAR(80) NOT NULL, entity VARCHAR(80) NOT NULL, entity_id VARCHAR(80) NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, KEY idx_audit_tenant (tenant_id,created_at));
CREATE TABLE IF NOT EXISTS alerts (
  id CHAR(36) PRIMARY KEY, tenant_id CHAR(36) NOT NULL, plot_id CHAR(36) NOT NULL,
  record_id CHAR(36) NULL, metric ENUM('moisture','temperature') NOT NULL,
  status ENUM('open','acknowledged','resolved') NOT NULL DEFAULT 'open',
  severity ENUM('warning','critical') NOT NULL DEFAULT 'warning',
  threshold DECIMAL(7,2) NOT NULL, current_value DECIMAL(7,2) NOT NULL,
  occurrences INT NOT NULL DEFAULT 1, opened_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  acknowledged_at DATETIME NULL, acknowledged_by CHAR(36) NULL,
  resolved_at DATETIME NULL, resolved_by CHAR(36) NULL, resolution_note VARCHAR(500) NULL,
  KEY idx_alert_tenant_status (tenant_id,status,last_seen_at),
  KEY idx_alert_plot_metric (tenant_id,plot_id,metric),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (plot_id) REFERENCES plots(id) ON DELETE CASCADE,
  FOREIGN KEY (record_id) REFERENCES records(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS invitations (
  id CHAR(36) PRIMARY KEY, tenant_id CHAR(36) NOT NULL,
  email VARCHAR(255) NOT NULL, role ENUM('admin','operator','viewer') NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE, created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL, used_at DATETIME NULL, revoked_at DATETIME NULL,
  KEY idx_invitation_tenant (tenant_id,created_at),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);
