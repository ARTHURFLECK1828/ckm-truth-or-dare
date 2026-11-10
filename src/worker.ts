import type { D1Database, ExecutionContext } from '@cloudflare/workers-types';
import { verifyKey } from 'discord-interactions';
import { handleInteraction, type InteractionPayload } from './handler.js';

export interface Env {
  DB: D1Database;
  DISCORD_PUBLIC_KEY: string;
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    if (request.method === 'GET') {
      return new Response('ok', { status: 200 });
    }
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const signature = request.headers.get('X-Signature-Ed25519');
    const timestamp = request.headers.get('X-Signature-Timestamp');
    const body = await request.text();

    if (!signature || !timestamp || !env.DISCORD_PUBLIC_KEY) {
      return new Response('Unauthorized', { status: 401 });
    }

    const ok = await verifyKey(body, signature, timestamp, env.DISCORD_PUBLIC_KEY);
    if (!ok) {
      return new Response('Bad signature', { status: 401 });
    }

    let payload: InteractionPayload;
    try {
      payload = JSON.parse(body) as InteractionPayload;
    } catch {
      return new Response('Bad JSON', { status: 400 });
    }

    return Response.json(await handleInteraction(payload, env.DB));
  },
};
