import { ButtonStyleTypes, MessageComponentTypes } from 'discord-interactions';
import type { DealtPrompt, LeaderboardEntry } from './db.js';

export interface AuthorInfo {
  name: string;
  iconUrl?: string;
}

export function promptPayload(prompt: DealtPrompt, author: AuthorInfo, totalAnswered?: number) {
  const color =
    prompt.type === 'truth' ? 0x22c55e : prompt.type === 'dare' ? 0xef4444 : 0x8b5cf6;

  const embed: Record<string, unknown> = {
    color,
    author: {
      name: `Requested by ${author.name}`,
      ...(author.iconUrl ? { icon_url: author.iconUrl } : {}),
    },
    description: `**${prompt.promptText}**`,
  };

  if (prompt.answered) {
    embed.footer = {
      text: totalAnswered !== undefined ? `Answered (${totalAnswered} total answered)` : 'Answered',
    };
  }

  return {
    embeds: [embed],
    components: [
      {
        type: MessageComponentTypes.ACTION_ROW,
        components: [
          {
            type: MessageComponentTypes.BUTTON,
            style: ButtonStyleTypes.SECONDARY,
            custom_id: `tod:answer:${prompt.id}`,
            label: 'Answered',
            disabled: prompt.answered,
          },
          {
            type: MessageComponentTypes.BUTTON,
            style: ButtonStyleTypes.SUCCESS,
            custom_id: 'tod:deal:truth',
            label: 'Truth',
          },
          {
            type: MessageComponentTypes.BUTTON,
            style: ButtonStyleTypes.DANGER,
            custom_id: 'tod:deal:dare',
            label: 'Dare',
          },
          {
            type: MessageComponentTypes.BUTTON,
            style: ButtonStyleTypes.PRIMARY,
            custom_id: 'tod:deal:random',
            label: 'Random',
          },
        ],
      },
    ],
  };
}

export function leaderboardPayload(
  entries: LeaderboardEntry[],
  requesterRank: { rank: number; entry: LeaderboardEntry } | null
) {
  const description =
    entries.length === 0
      ? 'No questions answered in this server yet. Use `/truth`, `/dare`, or `/wouldyourather` and click **Answered**.'
      : entries
          .map((e, i) => {
            const q = e.totalAnswered === 1 ? 'question' : 'questions';
            const t = e.truthsAnswered === 1 ? 'Truth' : 'Truths';
            const d = e.daresAnswered === 1 ? 'Dare' : 'Dares';
            const wyr = e.wyrAnswered > 0 ? `, ${e.wyrAnswered} WYR` : '';
            return `**#${i + 1}** <@${e.userId}> — **${e.totalAnswered}** ${q} (${e.truthsAnswered} ${t}, ${e.daresAnswered} ${d}${wyr})`;
          })
          .join('\n');

  const embed: Record<string, unknown> = {
    color: 0xf59e0b,
    title: 'Server Truth or Dare Leaderboard',
    description,
  };

  if (requesterRank) {
    embed.footer = {
      text: `Your Rank: #${requesterRank.rank} (${requesterRank.entry.totalAnswered} answered)`,
    };
  }

  return { embeds: [embed] };
}
