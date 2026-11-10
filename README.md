# truth or dare discord bot

Simple Truth or Dare bot running on Cloudflare Workers + D1.
Commands: `/truth`, `/dare`, `/random`, `/wouldyourather`, `/addprompt`, `/leaderboard`.

## Setup

```bash
npm install
npx wrangler login
npx wrangler d1 create truth-or-dare-db
```

Put the D1 `database_id` in `wrangler.toml`, then:

```bash
npm run db:init:remote
npm run db:seed:remote
npx wrangler secret put DISCORD_PUBLIC_KEY
npm run deploy:worker
```

Copy `.env.example` to `.env`, add `DISCORD_TOKEN` and `DISCORD_CLIENT_ID`, set your Worker URL in Discord Developer Portal -> Interactions Endpoint URL, then register commands:

```bash
npm run deploy:commands
```
