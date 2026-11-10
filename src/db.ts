import type { D1Database } from '@cloudflare/workers-types';

export type PromptType = 'truth' | 'dare' | 'wyr';

export interface PromptRecord {
  id: number;
  guildId: string | null;
  type: PromptType;
  rating: 'pg' | 'pg13';
  text: string;
}

export interface DealtPrompt {
  id: string;
  guildId: string;
  channelId: string;
  userId: string;
  type: PromptType;
  rating: 'pg' | 'pg13';
  promptId: string;
  promptText: string;
  answered: boolean;
  answeredByUserId: string | null;
  createdAt: number;
  answeredAt: number | null;
}

export interface LeaderboardEntry {
  guildId: string;
  userId: string;
  truthsAnswered: number;
  daresAnswered: number;
  wyrAnswered: number;
  totalAnswered: number;
  updatedAt: number;
}

interface PromptRow {
  id: number;
  guild_id: string | null;
  type: string;
  rating: string;
  text: string;
}

interface DealtRow {
  id: string;
  guild_id: string;
  channel_id: string;
  user_id: string;
  type: string;
  rating: string;
  prompt_id: string;
  prompt_text: string;
  answered: number;
  answered_by_user_id: string | null;
  created_at: number;
  answered_at: number | null;
}

interface LeaderboardRow {
  guild_id: string;
  user_id: string;
  truths_answered: number;
  dares_answered: number;
  wyr_answered: number;
  updated_at: number;
  total_answered?: number;
}

function toPromptRecord(row: PromptRow): PromptRecord {
  return {
    id: Number(row.id),
    guildId: row.guild_id,
    type: row.type as PromptType,
    rating: row.rating as 'pg' | 'pg13',
    text: row.text,
  };
}

function toDealtPrompt(row: DealtRow): DealtPrompt {
  return {
    id: row.id,
    guildId: row.guild_id,
    channelId: row.channel_id,
    userId: row.user_id,
    type: row.type as PromptType,
    rating: row.rating as 'pg' | 'pg13',
    promptId: row.prompt_id,
    promptText: row.prompt_text,
    answered: Boolean(row.answered),
    answeredByUserId: row.answered_by_user_id,
    createdAt: Number(row.created_at),
    answeredAt: row.answered_at !== null ? Number(row.answered_at) : null,
  };
}

function toLeaderboardEntry(row: LeaderboardRow): LeaderboardEntry {
  const truths = Number(row.truths_answered);
  const dares = Number(row.dares_answered);
  const wyr = Number(row.wyr_answered ?? 0);
  return {
    guildId: row.guild_id,
    userId: row.user_id,
    truthsAnswered: truths,
    daresAnswered: dares,
    wyrAnswered: wyr,
    totalAnswered:
      row.total_answered !== undefined ? Number(row.total_answered) : truths + dares + wyr,
    updatedAt: Number(row.updated_at),
  };
}

export async function pickPromptFromDb(
  db: D1Database,
  guildId: string,
  channelId: string,
  type: PromptType,
  recentLimit = 30
): Promise<PromptRecord | null> {
  const fresh = await db
    .prepare(
      `SELECT id, guild_id, type, rating, text
       FROM prompts
       WHERE type = ?
         AND (guild_id IS NULL OR guild_id = ?)
         AND CAST(id AS TEXT) NOT IN (
           SELECT prompt_id FROM recent_prompts WHERE channel_id = ? ORDER BY id DESC LIMIT ?
         )
       ORDER BY RANDOM()
       LIMIT 1`
    )
    .bind(type, guildId, channelId, recentLimit)
    .first<PromptRow>();

  if (fresh) return toPromptRecord(fresh);

  const fallback = await db
    .prepare(
      `SELECT id, guild_id, type, rating, text
       FROM prompts
       WHERE type = ? AND (guild_id IS NULL OR guild_id = ?)
       ORDER BY RANDOM()
       LIMIT 1`
    )
    .bind(type, guildId)
    .first<PromptRow>();

  return fallback ? toPromptRecord(fallback) : null;
}

export async function addPromptToDb(
  db: D1Database,
  guildId: string,
  type: PromptType,
  text: string,
  createdBy: string
): Promise<{ prompt: PromptRecord; duplicate: boolean }> {
  const existing = await db
    .prepare(
      `SELECT id, guild_id, type, rating, text
       FROM prompts
       WHERE type = ?
         AND (guild_id IS NULL OR guild_id = ?)
         AND LOWER(TRIM(text)) = LOWER(?)
       LIMIT 1`
    )
    .bind(type, guildId, text)
    .first<PromptRow>();

  if (existing) {
    return { prompt: toPromptRecord(existing), duplicate: true };
  }

  const inserted = await db
    .prepare(
      `INSERT INTO prompts (guild_id, type, rating, text, created_by, created_at)
       VALUES (?, ?, 'pg13', ?, ?, ?)
       RETURNING id, guild_id, type, rating, text`
    )
    .bind(guildId, type, text, createdBy, Date.now())
    .first<PromptRow>();

  return { prompt: toPromptRecord(inserted!), duplicate: false };
}

export async function saveShownPrompt(
  db: D1Database,
  channelId: string,
  promptId: string,
  keep = 60
) {
  await db.batch([
    db
      .prepare('INSERT INTO recent_prompts (channel_id, prompt_id, shown_at) VALUES (?, ?, ?)')
      .bind(channelId, promptId, Date.now()),
    db
      .prepare(
        `DELETE FROM recent_prompts
         WHERE channel_id = ?
           AND id NOT IN (SELECT id FROM recent_prompts WHERE channel_id = ? ORDER BY id DESC LIMIT ?)`
      )
      .bind(channelId, channelId, keep),
  ]);
}

export async function saveDealtPrompt(db: D1Database, p: DealtPrompt) {
  await db
    .prepare(
      `INSERT INTO dealt_prompts (
        id, guild_id, channel_id, user_id, type, rating,
        prompt_id, prompt_text, answered, answered_by_user_id, created_at, answered_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      p.id,
      p.guildId,
      p.channelId,
      p.userId,
      p.type,
      p.rating,
      p.promptId,
      p.promptText,
      p.answered ? 1 : 0,
      p.answeredByUserId,
      p.createdAt,
      p.answeredAt
    )
    .run();
}

export async function getDealtPrompt(db: D1Database, id: string) {
  const row = await db.prepare('SELECT * FROM dealt_prompts WHERE id = ?').bind(id).first<DealtRow>();
  return row ? toDealtPrompt(row) : null;
}

export async function markPromptAnswered(db: D1Database, id: string, userId: string) {
  const row = await db
    .prepare(
      `UPDATE dealt_prompts
       SET answered = 1, answered_by_user_id = ?, answered_at = ?
       WHERE id = ? AND answered = 0
       RETURNING *`
    )
    .bind(userId, Date.now(), id)
    .first<DealtRow>();
  return row ? toDealtPrompt(row) : null;
}

export async function incrementScore(
  db: D1Database,
  guildId: string,
  userId: string,
  type: PromptType
) {
  const row = await db
    .prepare(
      `INSERT INTO leaderboard (guild_id, user_id, truths_answered, dares_answered, wyr_answered, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(guild_id, user_id) DO UPDATE SET
         truths_answered = truths_answered + excluded.truths_answered,
         dares_answered = dares_answered + excluded.dares_answered,
         wyr_answered = wyr_answered + excluded.wyr_answered,
         updated_at = excluded.updated_at
       RETURNING *`
    )
    .bind(
      guildId,
      userId,
      type === 'truth' ? 1 : 0,
      type === 'dare' ? 1 : 0,
      type === 'wyr' ? 1 : 0,
      Date.now()
    )
    .first<LeaderboardRow>();
  return toLeaderboardEntry(row!);
}

export async function getLeaderboard(db: D1Database, guildId: string, limit = 15) {
  const { results } = await db
    .prepare(
      `SELECT guild_id, user_id, truths_answered, dares_answered, wyr_answered, updated_at,
              (truths_answered + dares_answered + wyr_answered) AS total_answered
       FROM leaderboard
       WHERE guild_id = ? AND (truths_answered + dares_answered + wyr_answered) > 0
       ORDER BY total_answered DESC, truths_answered DESC, updated_at ASC
       LIMIT ?`
    )
    .bind(guildId, limit)
    .all<LeaderboardRow>();
  return results.map(toLeaderboardEntry);
}

export async function getUserRank(db: D1Database, guildId: string, userId: string) {
  const row = await db
    .prepare('SELECT * FROM leaderboard WHERE guild_id = ? AND user_id = ?')
    .bind(guildId, userId)
    .first<LeaderboardRow>();
  if (!row) return null;

  const entry = toLeaderboardEntry(row);
  if (entry.totalAnswered === 0) return null;

  const countRow = await db
    .prepare(
      `SELECT COUNT(*) AS n
       FROM leaderboard
       WHERE guild_id = ?
         AND (
           (truths_answered + dares_answered + wyr_answered) > ?
           OR (
             (truths_answered + dares_answered + wyr_answered) = ?
             AND (truths_answered > ? OR (truths_answered = ? AND updated_at < ?))
           )
         )`
    )
    .bind(
      guildId,
      entry.totalAnswered,
      entry.totalAnswered,
      entry.truthsAnswered,
      entry.truthsAnswered,
      entry.updatedAt
    )
    .first<{ n: number }>();

  return { rank: Number(countRow?.n ?? 0) + 1, entry };
}
