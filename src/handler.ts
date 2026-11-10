import type { D1Database } from '@cloudflare/workers-types';
import {
  InteractionResponseFlags,
  InteractionResponseType,
  InteractionType,
} from 'discord-interactions';
import {
  getDealtPrompt,
  getLeaderboard,
  getRecentPromptIds,
  getUserRank,
  incrementScore,
  markPromptAnswered,
  saveDealtPrompt,
  saveShownPrompt,
  type DealtPrompt,
  type PromptType,
} from './db.js';
import { leaderboardPayload, promptPayload, type AuthorInfo } from './embeds.js';
import { PROMPTS } from './prompts.js';

export interface DiscordUser {
  id: string;
  username?: string;
  global_name?: string | null;
  avatar?: string | null;
  discriminator?: string;
}

export interface InteractionPayload {
  type: number;
  guild_id?: string;
  channel_id?: string;
  member?: {
    avatar?: string | null;
    user?: DiscordUser;
  };
  user?: DiscordUser;
  data?: {
    name?: string;
    custom_id?: string;
  };
}

function avatarUrl(user: DiscordUser, guildId?: string, memberAvatar?: string | null) {
  if (guildId && memberAvatar) {
    const ext = memberAvatar.startsWith('a_') ? 'gif' : 'png';
    return `https://cdn.discordapp.com/guilds/${guildId}/users/${user.id}/avatars/${memberAvatar}.${ext}?size=64`;
  }
  if (user.avatar) {
    const ext = user.avatar.startsWith('a_') ? 'gif' : 'png';
    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${ext}?size=64`;
  }
  if (user.discriminator && user.discriminator !== '0' && /^\d+$/.test(user.discriminator)) {
    return `https://cdn.discordapp.com/embed/avatars/${Number(user.discriminator) % 5}.png`;
  }
  if (/^\d+$/.test(user.id)) {
    return `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(user.id) >> 22n) % 6n)}.png`;
  }
  return 'https://cdn.discordapp.com/embed/avatars/0.png';
}

function getAuthor(interaction: InteractionPayload): AuthorInfo {
  const user = interaction.member?.user ?? interaction.user;
  if (!user) return { name: 'Player' };
  return {
    name: user.username ?? user.global_name ?? user.id,
    iconUrl: avatarUrl(user, interaction.guild_id, interaction.member?.avatar),
  };
}

function ephemeral(content: string) {
  return {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      content,
      flags: InteractionResponseFlags.EPHEMERAL,
    },
  };
}

async function pickAndDeal(
  db: D1Database,
  guildId: string,
  channelId: string,
  userId: string,
  choice: 'truth' | 'dare' | 'random',
  rng = Math.random
): Promise<DealtPrompt> {
  const type: PromptType = choice === 'random' ? (rng() < 0.5 ? 'truth' : 'dare') : choice;
  const pool = PROMPTS.filter((p) => p.type === type);
  const recent = new Set(await getRecentPromptIds(db, channelId, 30));

  let candidates = pool.filter((p) => !recent.has(p.id));
  if (candidates.length === 0) candidates = pool;

  const picked = candidates[Math.min(candidates.length - 1, Math.floor(rng() * candidates.length))]!;
  await saveShownPrompt(db, channelId, picked.id);

  const dealt: DealtPrompt = {
    id: crypto.randomUUID().replace(/-/g, '').slice(0, 12),
    guildId,
    channelId,
    userId,
    type,
    rating: picked.rating,
    promptId: picked.id,
    promptText: picked.text,
    answered: false,
    answeredByUserId: null,
    createdAt: Date.now(),
    answeredAt: null,
  };

  await saveDealtPrompt(db, dealt);
  return dealt;
}

export async function handleInteraction(
  interaction: InteractionPayload,
  db: D1Database,
  rng = Math.random
): Promise<Record<string, unknown>> {
  if (interaction.type === InteractionType.PING) {
    return { type: InteractionResponseType.PONG };
  }

  const guildId = interaction.guild_id;
  const channelId = interaction.channel_id;
  const user = interaction.member?.user ?? interaction.user;
  const userId = user?.id;

  if (!guildId || !channelId || !userId) {
    return ephemeral('Use this inside a server channel.');
  }

  const author = getAuthor(interaction);

  try {
    if (interaction.type === InteractionType.APPLICATION_COMMAND) {
      const cmd = interaction.data?.name;

      if (cmd === 'truth' || cmd === 'dare' || cmd === 'random') {
        const dealt = await pickAndDeal(db, guildId, channelId, userId, cmd, rng);
        return {
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: promptPayload(dealt, author),
        };
      }

      if (cmd === 'leaderboard') {
        const [entries, rank] = await Promise.all([
          getLeaderboard(db, guildId, 15),
          getUserRank(db, guildId, userId),
        ]);
        return {
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: leaderboardPayload(entries, rank),
        };
      }

      return ephemeral('Unknown command.');
    }

    if (interaction.type === InteractionType.MESSAGE_COMPONENT) {
      const customId = interaction.data?.custom_id ?? '';
      const [, action, value] = customId.split(':');

      if (action === 'answer' && value) {
        const existing = await getDealtPrompt(db, value);
        if (!existing) return ephemeral('Question not found.');
        if (existing.answered) return ephemeral('Already marked as answered.');
        if (existing.userId !== userId) {
          return ephemeral(`Only <@${existing.userId}> can mark this as answered.`);
        }

        const updated = await markPromptAnswered(db, existing.id, userId);
        if (!updated) return ephemeral('Already marked as answered.');

        const score = await incrementScore(db, updated.guildId, updated.userId, updated.type);
        return {
          type: InteractionResponseType.UPDATE_MESSAGE,
          data: promptPayload(updated, author, score.totalAnswered),
        };
      }

      if (action === 'deal' && (value === 'truth' || value === 'dare' || value === 'random')) {
        const dealt = await pickAndDeal(db, guildId, channelId, userId, value, rng);
        return {
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: promptPayload(dealt, author),
        };
      }
    }

    return ephemeral('Unsupported interaction.');
  } catch (err) {
    console.error('Interaction error:', err);
    return ephemeral('Something went wrong, try again.');
  }
}
