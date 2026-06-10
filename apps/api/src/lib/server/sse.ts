import type { RequestEvent } from '@sveltejs/kit';

/**
 * Build a Server-Sent Events response.
 *
 * `start` is called once with a `send(data, name?)` function; it returns a
 * cleanup run when the client disconnects. A heartbeat comment every 15s keeps
 * idle connections from being reaped by proxies. CORS headers are added by the
 * /api hook (src/hooks.server.ts), so we only set the stream headers here.
 */
export function sse(
  event: RequestEvent,
  start: (send: (data: unknown, name?: string) => void) => () => void,
): Response {
  const encoder = new TextEncoder();
  let cleanup: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  function close() {
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
    if (cleanup) {
      cleanup();
      cleanup = null;
    }
  }

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: unknown, name?: string) => {
        try {
          const frame = (name ? `event: ${name}\n` : '') + `data: ${JSON.stringify(data)}\n\n`;
          controller.enqueue(encoder.encode(frame));
        } catch {
          /* controller already closed */
        }
      };
      cleanup = start(send);
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': ping\n\n'));
        } catch {
          /* ignore */
        }
      }, 15_000);
      event.request.signal.addEventListener('abort', close);
    },
    cancel() {
      close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
