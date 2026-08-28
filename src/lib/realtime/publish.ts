import { randomUUID } from 'node:crypto';
import { db } from '@/lib/db';
import {
  REALTIME_CHANNEL,
  type RealtimeAudience,
  type RealtimeEvent,
  type RealtimeEventType,
} from './events';

const MAX_PAYLOAD_BYTES = 7000;

export interface PublishInput {
  type: RealtimeEventType;
  audience: RealtimeAudience;
  message?: string;
  payload?: Record<string, unknown>;
  actorId?: string;
}

export async function publish(input: PublishInput): Promise<void> {
  const event: RealtimeEvent = {
    id: randomUUID(),
    type: input.type,
    audience: input.audience,
    message: input.message,
    payload: input.payload,
    actorId: input.actorId,
    at: new Date().toISOString(),
  };

  let json = JSON.stringify(event);
  if (Buffer.byteLength(json) > MAX_PAYLOAD_BYTES) {
    json = JSON.stringify({ ...event, payload: undefined });
  }

  try {
    await db.$executeRaw`SELECT pg_notify(${REALTIME_CHANNEL}, ${json})`;
  } catch (error) {
    console.error('[realtime] publish failed', error);
  }
}

export async function publishAll(inputs: PublishInput[]): Promise<void> {
  await Promise.allSettled(inputs.map(publish));
}
