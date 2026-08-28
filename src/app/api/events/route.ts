import { subscribe } from '@/lib/realtime/bus';
import { matchesAudience, type SubscriberIdentity } from '@/lib/realtime/events';
import { getViewer } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

const HEARTBEAT_MS = 25_000;

export async function GET(request: Request) {
  const viewer = await getViewer();
  if (!viewer) {
    return new Response('Unauthorized', { status: 401 });
  }

  const identity: SubscriberIdentity = {
    userId: viewer.id,
    role: viewer.role,
    locationIds: viewer.locationIds,
  };

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };

      send(`retry: 3000\n\n`);
      send(`event: ready\ndata: ${JSON.stringify({ userId: viewer.id })}\n\n`);

      const unsubscribe = await subscribe((event) => {
        if (!matchesAudience(event, identity)) return;
        send(`event: ${event.type}\nid: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`);
      });

      const heartbeat = setInterval(() => send(`: ping\n\n`), HEARTBEAT_MS);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
        }
      };

      request.signal.addEventListener('abort', cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
