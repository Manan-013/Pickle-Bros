import { createServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { ClientMsg, DEFAULT_PORT, Difficulty, Format, PublicRoom, ServerMsg } from '@picklebros/shared';
import { Member, Room, isArenaChoice } from './room';
import { serveGamePage } from './static';

/**
 * PickleBros online server: friends create or join a room by code, pick seats, and the server
 * runs the match (ball, rules, score, CPU players) and streams it to everyone.
 */

const PORT = Number(process.env.PORT) || DEFAULT_PORT;
/** Room codes avoid look-alike characters (0/O, 1/I/L). */
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const MAX_MESSAGE_BYTES = 4096;

const rooms = new Map<string, Room>();

function newCode(): string {
  for (;;) {
    let code = '';
    for (let i = 0; i < 6; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    if (!rooms.has(code)) return code;
  }
}

const FORMATS: Format[] = ['singles', 'doubles'];
const LEVELS: Difficulty[] = ['easy', 'medium', 'hard'];
/** At most this many rooms in the public list (open seats first). */
const LIST_LIMIT = 30;

function publicRooms(): PublicRoom[] {
  return [...rooms.values()]
    .map((r) => r.publicInfo())
    .filter((r): r is PublicRoom => r !== null)
    .sort((a, b) => Number(a.inGame) - Number(b.inGame) || b.freeSeats - a.freeSeats || b.players - a.players)
    .slice(0, LIST_LIMIT);
}

/** An open public room for quick match: waiting in the lobby, right format, a free seat. */
function findQuickRoom(format: Format): Room | null {
  const open = [...rooms.values()].filter((r) => r.publicInfo() && !r.inGame && r.format === format && r.freeSeats > 0);
  // Prefer the room with the most people waiting, so games fill up and start sooner.
  open.sort((a, b) => b.members.size - a.members.size);
  return open[0] ?? null;
}

function createRoom(format: unknown, level: unknown, isPublic: boolean, power = true): Room {
  const f = FORMATS.includes(format as Format) ? (format as Format) : 'singles';
  const l = LEVELS.includes(level as Difficulty) ? (level as Difficulty) : 'medium';
  const room = new Room(newCode(), f, l, isPublic, power, (r) => rooms.delete(r.code));
  rooms.set(room.code, room);
  console.log(`room ${room.code} created (${f}, CPU ${l}, ${isPublic ? 'public' : 'private'})`);
  return room;
}

const http = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
    return;
  }
  void serveGamePage(req.url ?? '/', res);
});

const wss = new WebSocketServer({ server: http, maxPayload: MAX_MESSAGE_BYTES });

wss.on('connection', (ws: WebSocket) => {
  let room: Room | null = null;
  let me: Member | null = null;
  const send = (msg: ServerMsg) => ws.readyState === 1 && ws.send(JSON.stringify(msg));

  ws.on('message', (data) => {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(String(data));
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;

    // The public list can be asked for at any time (before joining, or from a room's lobby).
    if (msg.t === 'list') return send({ t: 'rooms', rooms: publicRooms() });

    if (!room || !me) {
      if (msg.t === 'create') {
        room = createRoom(msg.format, msg.level, !!msg.isPublic, msg.power !== false);
        if (isArenaChoice(msg.arena)) room.arena = msg.arena;
        me = room.add(msg.name, ws, msg.character);
      } else if (msg.t === 'quick') {
        room = findQuickRoom(FORMATS.includes(msg.format) ? msg.format : 'singles') ?? createRoom(msg.format, msg.level, true);
        me = room.add(msg.name, ws, msg.character);
      } else if (msg.t === 'join') {
        const r = rooms.get(String(msg.code ?? '').toUpperCase().trim());
        if (!r) return send({ t: 'error', message: 'No room with that code. Check it and try again.' });
        // A token means "I was here before" (refresh / dropped connection): get your seat back.
        // Joining a match already underway puts you in the lobby until the next match.
        const back = msg.token ? r.rejoin(msg.token, ws) : null;
        room = r;
        me = back ?? r.add(msg.name, ws, msg.character);
      }
      return;
    }
    room.handle(me, msg);
  });

  ws.on('close', () => {
    if (room && me && me.ws === ws) room.disconnected(me);
  });
});

http.listen(PORT, '0.0.0.0', () => {
  console.log(`PickleBros server listening on port ${PORT}`);
});
