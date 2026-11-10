CREATE TABLE IF NOT EXISTS prompts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT,
  type TEXT NOT NULL,
  rating TEXT NOT NULL DEFAULT 'pg13',
  text TEXT NOT NULL,
  created_by TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_prompts_lookup
  ON prompts (type, guild_id);

CREATE TABLE IF NOT EXISTS dealt_prompts (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  rating TEXT NOT NULL,
  prompt_id TEXT NOT NULL,
  prompt_text TEXT NOT NULL,
  answered INTEGER NOT NULL DEFAULT 0,
  answered_by_user_id TEXT,
  created_at INTEGER NOT NULL,
  answered_at INTEGER
);

CREATE TABLE IF NOT EXISTS leaderboard (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  truths_answered INTEGER NOT NULL DEFAULT 0,
  dares_answered INTEGER NOT NULL DEFAULT 0,
  wyr_answered INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_leaderboard_rank
  ON leaderboard (guild_id, (truths_answered + dares_answered + wyr_answered) DESC);

CREATE TABLE IF NOT EXISTS recent_prompts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id TEXT NOT NULL,
  prompt_id TEXT NOT NULL,
  shown_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_recent_prompts_channel
  ON recent_prompts (channel_id, id DESC);
