import { ClientMsg, DEFAULT_PORT, ServerMsg } from '@picklebros/shared';

/**
 * Where the game server is. In development the page (Vite, port 5173) and the server (port 2567)
 * are separate; in a build the server hosts the page, so it's the same address the page came from.
 * VITE_SERVER_URL overrides both (e.g. page and server on different hosts).
 */
export function serverUrl(): string {
  const configured = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (configured) return configured;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return import.meta.env.DEV ? `${proto}://${location.hostname}:${DEFAULT_PORT}` : `${proto}://${location.host}`;
}

/** A WebSocket connection to the game server speaking the shared protocol. */
export class Net {
  private ws: WebSocket | null = null;
  private listeners = new Set<(msg: ServerMsg) => void>();
  onClose: (() => void) | null = null;

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  connect(url = serverUrl()): Promise<void> {
    this.close();
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error(`Can't reach the game server (${url}). Is it running?`));
      ws.onclose = () => {
        if (this.ws === ws) {
          this.ws = null;
          this.onClose?.();
        }
      };
      ws.onmessage = (e) => {
        let msg: ServerMsg;
        try {
          msg = JSON.parse(String(e.data));
        } catch {
          return;
        }
        for (const l of this.listeners) l(msg);
      };
    });
  }

  send(msg: ClientMsg): void {
    if (this.connected) this.ws!.send(JSON.stringify(msg));
  }

  listen(fn: (msg: ServerMsg) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  close(): void {
    const ws = this.ws;
    this.ws = null;
    ws?.close();
  }
}
