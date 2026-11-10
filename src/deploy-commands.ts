import dotenv from 'dotenv';
import { SLASH_COMMANDS } from './commands.js';

dotenv.config({ quiet: true });

async function run() {
  const token = process.env.DISCORD_TOKEN?.trim();
  const clientId = process.env.DISCORD_CLIENT_ID?.trim();
  const guildId = process.env.DISCORD_GUILD_ID?.trim();

  if (!token || !clientId) {
    throw new Error('Set DISCORD_TOKEN and DISCORD_CLIENT_ID in .env first.');
  }

  const url = guildId
    ? `https://discord.com/api/v10/applications/${clientId}/guilds/${guildId}/commands`
    : `https://discord.com/api/v10/applications/${clientId}/commands`;

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(SLASH_COMMANDS),
  });

  if (!res.ok) {
    throw new Error(`Discord API ${res.status}: ${await res.text()}`);
  }

  console.log(`Registered ${SLASH_COMMANDS.length} commands (${guildId ? `guild ${guildId}` : 'global'})`);
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
