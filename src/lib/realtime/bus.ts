import { Client } from 'pg';
import { REALTIME_CHANNEL, type RealtimeEvent } from './events';

type Listener = (event: RealtimeEvent) => void;

interface BusState {
  client: Client | null;
  connecting: Promise<void> | null;
  listeners: Set<Listener>;
}

const globalForBus = globalThis as unknown as {
  __shiftsyncBus: BusState | undefined;
};

const state: BusState = (globalForBus.__shiftsyncBus ??= {
  client: null,
  connecting: null,
  listeners: new Set(),
});

async function connect(): Promise<void> {
  if (state.client) return;
  if (state.connecting) return state.connecting;

  state.connecting = (async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL });

    client.on('notification', (message) => {
      if (message.channel !== REALTIME_CHANNEL || !message.payload) return;
      let event: RealtimeEvent;
      try {
        event = JSON.parse(message.payload) as RealtimeEvent;
      } catch {
        return;
      }
      for (const listener of state.listeners) {
        try {
          listener(event);
        } catch {
        }
      }
    });

    client.on('error', () => {
      state.client = null;
      state.connecting = null;
    });
    client.on('end', () => {
      state.client = null;
      state.connecting = null;
    });

    await client.connect();
    await client.query(`LISTEN ${REALTIME_CHANNEL}`);
    state.client = client;
  })();

  try {
    await state.connecting;
  } finally {
    state.connecting = null;
  }
}

export async function subscribe(listener: Listener): Promise<() => void> {
  await connect();
  state.listeners.add(listener);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    state.listeners.delete(listener);
    if (state.listeners.size === 0 && state.client) {
      const client = state.client;
      state.client = null;
      void client.end().catch(() => {});
    }
  };
}

export function subscriberCount(): number {
  return state.listeners.size;
}
