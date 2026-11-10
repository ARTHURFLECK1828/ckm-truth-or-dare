import type { D1Database } from '@cloudflare/workers-types';

export type PromptType = 'truth' | 'dare';

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
  totalAnswered: number;
  updatedAt: number;
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
  updated_at: number;
  total_answered?: number;
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
  return {
    guildId: row.guild_id,
    userId: row.user_id,
    truthsAnswered: truths,
    daresAnswered: dares,
    totalAnswered: row.total_answered !== undefined ? Number(row.total_answered) : truths + dares,
    updatedAt: Number(row.updated_at),
  };
}

export async function getRecentPromptIds(db: D1Database, channelId: string, limit = 30) {
  const { results } = await db
    .prepare('SELECT prompt_id FROM recent_prompts WHERE channel_id = ? ORDER BY id DESC LIMIT ?')
    .bind(channelId, limit)
    .all<{ prompt_id: string }>();
  return results.map((r) => r.prompt_id);
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
      `INSERT INTO leaderboard (guild_id, user_id, truths_answered, dares_answered, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(guild_id, user_id) DO UPDATE SET
         truths_answered = truths_answered + excluded.truths_answered,
         dares_answered = dares_answered + excluded.dares_answered,
         updated_at = excluded.updated_at
       RETURNING *`
    )
    .bind(guildId, userId, type === 'truth' ? 1 : 0, type === 'dare' ? 1 : 0, Date.now())
    .first<LeaderboardRow>();
  return toLeaderboardEntry(row!);
}

export async function getLeaderboard(db: D1Database, guildId: string, limit = 15) {
  const { results } = await db
    .prepare(
      `SELECT guild_id, user_id, truths_answered, dares_answered, updated_at,
              (truths_answered + dares_answered) AS total_answered
       FROM leaderboard
       WHERE guild_id = ? AND (truths_answered + dares_answered) > 0
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
           (truths_answered + dares_answered) > ?
           OR (
             (truths_answered + dares_answered) = ?
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
