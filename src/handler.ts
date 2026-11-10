import type { D1Database } from '@cloudflare/workers-types';
import {
  InteractionResponseFlags,
  InteractionResponseType,
  InteractionType,
} from 'discord-interactions';
import {
  addPromptToDb,
  getDealtPrompt,
  getLeaderboard,
  getUserRank,
  incrementScore,
  markPromptAnswered,
  pickPromptFromDb,
  saveDealtPrompt,
  saveShownPrompt,
  type DealtPrompt,
  type PromptType,
} from './db.js';
import { leaderboardPayload, promptPayload, type AuthorInfo } from './embeds.js';

export interface DiscordUser {
  id: string;
  username?: string;
  global_name?: string | null;
  avatar?: string | null;
  discriminator?: string;
}

export interface CommandOption {
  name: string;
  type: number;
  value: string | number | boolean;
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
    options?: CommandOption[];
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

function getOption(options: CommandOption[] | undefined, name: string) {
  return options?.find((o) => o.name === name)?.value;
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
  choice: 'truth' | 'dare' | 'random' | 'wyr',
  rng = Math.random
): Promise<DealtPrompt | null> {
  const type: PromptType = choice === 'random' ? (rng() < 0.5 ? 'truth' : 'dare') : choice;
  const picked = await pickPromptFromDb(db, guildId, channelId, type, 30);
  if (!picked) return null;

  await saveShownPrompt(db, channelId, String(picked.id));

  const dealt: DealtPrompt = {
    id: crypto.randomUUID().replace(/-/g, '').slice(0, 12),
    guildId,
    channelId,
    userId,
    type,
    rating: picked.rating,
    promptId: String(picked.id),
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

      if (cmd === 'truth' || cmd === 'dare' || cmd === 'random' || cmd === 'wouldyourather') {
        const choice = cmd === 'wouldyourather' ? 'wyr' : cmd;
        const dealt = await pickAndDeal(db, guildId, channelId, userId, choice, rng);
        if (!dealt) {
          return ephemeral('No prompts found in the database yet. Add one with `/addprompt`.');
        }
        return {
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: promptPayload(dealt, author),
        };
      }

      if (cmd === 'addprompt') {
        const type = getOption(interaction.data?.options, 'type');
        const rawText = getOption(interaction.data?.options, 'text');

        if ((type !== 'truth' && type !== 'dare' && type !== 'wyr') || typeof rawText !== 'string') {
          return ephemeral('Provide a valid type and text.');
        }

        const text = rawText.trim();
        if (text.length < 5 || text.length > 500) {
          return ephemeral('Prompt text must be between 5 and 500 characters.');
        }

        const { prompt, duplicate } = await addPromptToDb(db, guildId, type, text, userId);
        const label =
          prompt.type === 'truth' ? 'Truth' : prompt.type === 'dare' ? 'Dare' : 'Would You Rather';
        if (duplicate) {
          return ephemeral(`That ${label} already exists (#${prompt.id}): ${prompt.text}`);
        }
        return ephemeral(`Added ${label} #${prompt.id}: ${prompt.text}`);
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
        if (!dealt) {
          return ephemeral('No prompts found in the database yet.');
        }
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
