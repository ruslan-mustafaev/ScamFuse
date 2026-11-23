-- ScamFuse relay: the only data the server keeps.

-- One row per browser where the extension is linked. The secrets are stored as SHA-256 hashes.
CREATE TABLE IF NOT EXISTS installs (
  id TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL,
  uninstall_hash TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  profile TEXT NOT NULL DEFAULT 'elder',
  language TEXT NOT NULL DEFAULT 'en',
  time_zone TEXT NOT NULL DEFAULT 'UTC',
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  silent_notified INTEGER NOT NULL DEFAULT 0,
  removed_at INTEGER
);

-- Trusted people: a Telegram chat linked to an install. Up to three per install.
CREATE TABLE IF NOT EXISTS guardians (
  install_id TEXT NOT NULL,
  chat_id INTEGER NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  language TEXT NOT NULL DEFAULT 'en',
  created_at INTEGER NOT NULL,
  PRIMARY KEY (install_id, chat_id)
);
CREATE INDEX IF NOT EXISTS guardians_by_chat ON guardians (chat_id);

-- One-time pairing codes, valid for 10 minutes.
CREATE TABLE IF NOT EXISTS pairings (
  code TEXT PRIMARY KEY,
  install_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  chat_id INTEGER,
  guardian_name TEXT
);

-- Alerts: kind, site name, time, decision. Deleted after 30 days.
CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  install_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  host TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  always_allow INTEGER NOT NULL DEFAULT 0,
  decided_by TEXT,
  decided_at INTEGER,
  reply TEXT,
  reply_by TEXT
);
CREATE INDEX IF NOT EXISTS alerts_by_install ON alerts (install_id);
CREATE INDEX IF NOT EXISTS alerts_by_time ON alerts (created_at);

-- Telegram messages sent for an alert, to update them after a decision and to match replies.
CREATE TABLE IF NOT EXISTS alert_messages (
  alert_id TEXT NOT NULL,
  chat_id INTEGER NOT NULL,
  message_id INTEGER NOT NULL,
  PRIMARY KEY (chat_id, message_id)
);
CREATE INDEX IF NOT EXISTS alert_messages_by_alert ON alert_messages (alert_id);

-- Rate limits.
CREATE TABLE IF NOT EXISTS counters (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
