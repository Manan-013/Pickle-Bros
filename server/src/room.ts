import { randomBytes } from 'node:crypto';
import type { WebSocket } from 'ws';
import {
  ARENA_IDS,
  ArenaChoice,
  ArenaId,
  CharacterId,
  ClientMsg,
  Difficulty,
  Format,
  LobbySeat,
  LobbyState,
  MatchSim,
  PublicRoom,
  ONLINE_SERVE_TIMEOUT,
  ONLINE_SWING_WINDOW_BONUS,
  PHYSICS_DT,
  SNAPSHOT_RATE,
  SWING_WINDOW,
  ServerMsg,
  SimEvent,
  Team,
  isCharacterId,
  pickCpuCharacters,
  v3,
} from '@picklebros/shared';

/** How long a disconnected player's seat is kept for them to rejoin. */
const REJOIN_GRACE_MS = 120_000;
const TICK_HZ = 60;

export interface Member {
  id: string;
  token: string;
  name: string;
  ws: WebSocket | null;
  seat: number | null;
  leftAt: number;
  character: CharacterId;
}

const seatCount = (format: Format) => (format === 'doubles' ? 4 : 2);
const seatTeam = (format: Format, seat: number): Team => (format === 'doubles' ? (seat < 2 ? 0 : 1) : (seat as Team));

/** One game room: a lobby where friends pick seats, then a match the server runs. */
export class Room {
  readonly members = new Map<string, Member>();
  format: Format;
  level: Difficulty;
  /** Listed in the public games list. */
  isPublic: boolean;
  /** Power Mode (specials, supers) or Classic. */
  power: boolean;
  /** Court for matches (or a random one each match). */
  arena: ArenaChoice = 'park';
  private matchArena: ArenaId = 'park';
  hostId = '';
  private sim: MatchSim | null = null;
  private loop: ReturnType<typeof setInterval> | null = null;
  private accumulator = 0;
  private lastTick = 0;
  private lastSnap = 0;
  private pending: SimEvent[] = [];
  /** Seat -> member id. */
  private seats: (string | null)[];
  /** Characters for each seat in the current match (CPU seats picked at start). */
  private matchCharacters: CharacterId[] = [];

  constructor(
    readonly code: string,
    format: Format,
    level: Difficulty,
    isPublic: boolean,
    power: boolean,
    private onEmpty: (room: Room) => void,
  ) {
    this.format = format;
    this.level = level;
    this.isPublic = isPublic;
    this.power = power;
    this.seats = new Array(seatCount(format)).fill(null);
  }

  get inGame(): boolean {
    return this.sim !== null;
  }

  // ---------------------------------------------------------------- membership

  add(name: string, ws: WebSocket, character?: unknown): Member {
    const m: Member = {
      id: randomBytes(6).toString('hex'),
      token: randomBytes(12).toString('hex'),
      name: cleanName(name),
      ws,
      seat: null,
      leftAt: 0,
      character: isCharacterId(character) ? character : 'rookie',
    };
    this.members.set(m.id, m);
    if (!this.hostId) this.hostId = m.id;
    // Take the first free seat (if any); otherwise watch until one frees up.
    const free = this.seats.indexOf(null);
    if (free >= 0 && !this.inGame) this.sit(m, free);
    this.send(m, { t: 'welcome', you: m.id, token: m.token, lobby: this.lobby() });
    this.broadcastLobby();
    return m;
  }

  /** A player with a token came back (refresh or dropped connection). */
  rejoin(token: string, ws: WebSocket): Member | null {
    const m = [...this.members.values()].find((x) => x.token === token);
    if (!m) return null;
    m.ws?.close();
    m.ws = ws;
    m.leftAt = 0;
    this.send(m, { t: 'welcome', you: m.id, token: m.token, lobby: this.lobby() });
    if (this.sim && m.seat !== null) {
      this.sim.setHuman(m.seat, true);
      this.sendStart(m);
    }
    this.broadcastLobby();
    return m;
  }

  disconnected(m: Member): void {
    m.ws = null;
    m.leftAt = Date.now();
    // The computer takes over until they come back.
    if (this.sim && m.seat !== null) this.sim.setHuman(m.seat, false);
    this.broadcastLobby();
    setTimeout(() => {
      if (m.ws === null && Date.now() - m.leftAt >= REJOIN_GRACE_MS) this.remove(m);
    }, REJOIN_GRACE_MS + 50);
    this.checkEmpty();
  }

  remove(m: Member): void {
    if (!this.members.has(m.id)) return;
    if (m.seat !== null) {
      this.seats[m.seat] = null;
      this.sim?.setHuman(m.seat, false);
    }
    m.ws = null;
    this.members.delete(m.id);
    if (this.hostId === m.id) {
      const next = [...this.members.values()].find((x) => x.ws) ?? [...this.members.values()][0];
      this.hostId = next?.id ?? '';
    }
    this.broadcastLobby();
    this.checkEmpty();
  }

  private checkEmpty(): void {
    if (![...this.members.values()].some((m) => m.ws)) {
      // Nobody connected: wait out the rejoin grace, then close the room.
      setTimeout(() => {
        if (![...this.members.values()].some((m) => m.ws)) this.close();
      }, REJOIN_GRACE_MS);
    }
  }

  close(): void {
    this.stopLoop();
    this.sim = null;
    this.onEmpty(this);
  }

  private sit(m: Member, seat: number): void {
    if (m.seat !== null) this.seats[m.seat] = null;
    this.seats[seat] = m.id;
    m.seat = seat;
  }

  // ---------------------------------------------------------------- messages

  handle(m: Member, msg: ClientMsg): void {
    switch (msg.t) {
      case 'seat':
        if (this.inGame || msg.seat < 0 || msg.seat >= this.seats.length) return;
        if (this.seats[msg.seat] !== null && this.seats[msg.seat] !== m.id) return this.error(m, 'That seat is taken.');
        this.sit(m, msg.seat);
        this.broadcastLobby();
        return;
      case 'settings':
        if (m.id !== this.hostId || this.inGame) return;
        if (msg.level) this.level = msg.level;
        if (typeof msg.isPublic === 'boolean') this.isPublic = msg.isPublic;
        if (typeof msg.power === 'boolean') this.power = msg.power;
        if (isArenaChoice(msg.arena)) this.arena = msg.arena;
        if (msg.format && msg.format !== this.format) this.changeFormat(msg.format);
        this.broadcastLobby();
        return;
      case 'start':
        if (m.id !== this.hostId) return this.error(m, 'Only the host can start the match.');
        if (!this.inGame) this.startMatch();
        return;
      case 'rematch':
        if (m.id !== this.hostId) return;
        this.stopLoop();
        this.sim = null;
        this.startMatch();
        return;
      case 'leave':
        this.remove(m);
        return;
      case 'character':
        if (!isCharacterId(msg.id) || this.inGame) return;
        m.character = msg.id;
        this.broadcastLobby();
        return;
      case 'input':
        this.applyInput(m, msg);
        return;
      case 'arm':
        if (this.sim && m.seat !== null) this.sim.armRequest(m.seat, msg.kind === 'special' || msg.kind === 'super' ? msg.kind : null);
        return;
      case 'serve':
        if (this.sim && m.seat !== null) this.sim.serveRequest(m.seat);
        return;
      case 'swing':
        if (this.sim && m.seat !== null) this.sim.swingRequest(m.seat, msg.intent, SWING_WINDOW + ONLINE_SWING_WINDOW_BONUS);
        return;
      case 'ping':
        this.send(m, { t: 'pong', at: msg.at });
        return;
    }
  }

  private changeFormat(format: Format): void {
    // Keep people seated in order when switching between singles and doubles.
    const seated = this.seats.filter((id): id is string => id !== null);
    this.format = format;
    this.seats = new Array(seatCount(format)).fill(null);
    for (const m of this.members.values()) m.seat = null;
    seated.slice(0, this.seats.length).forEach((id, i) => {
      // Spread players across teams: seat 0, then the first seat of the other team.
      const order = format === 'doubles' ? [0, 2, 1, 3] : [0, 1];
      const m = this.members.get(id);
      if (m) this.sit(m, order[i]);
    });
  }

  private applyInput(m: Member, msg: Extract<ClientMsg, { t: 'input' }>): void {
    if (!this.sim || m.seat === null) return;
    const seat = this.sim.seats[m.seat];
    if (!seat.human) return;
    const num = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? n : 0);
    seat.input = {
      move: { x: clampUnit(num(msg.move?.[0])), z: clampUnit(num(msg.move?.[1])) },
      aim: msg.aim ? v3(num(msg.aim[0]), 0, num(msg.aim[1])) : null,
      powerHeld: !!msg.power,
      lettingGo: !!msg.letGo,
      manual: !!msg.manual,
    };
    // Each player moves themselves; positions only count during rallies (otherwise the server
    // has placed everyone for the serve).
    if (this.sim.phase === 'rally') seat.body.setRemote(num(msg.x), num(msg.z), num(msg.vx), num(msg.vz), 1 / SNAPSHOT_RATE);
  }

  // ---------------------------------------------------------------- match

  private startMatch(): void {
    const humanSeats = this.seats.flatMap((id, i) => (id && this.members.get(id)?.ws ? [i] : []));
    // People keep their pick; CPU seats get characters nobody else is using.
    const picked = this.seats.map((id) => (id ? (this.members.get(id)?.character ?? null) : null));
    const cpu = pickCpuCharacters(picked.filter((c): c is CharacterId => c !== null), picked.filter((c) => c === null).length);
    this.matchCharacters = picked.map((c) => c ?? cpu.shift() ?? 'rookie');
    const characters = this.matchCharacters;
    this.matchArena = this.arena === 'random' ? ARENA_IDS[Math.floor(Math.random() * ARENA_IDS.length)] : this.arena;
    this.sim = new MatchSim(this.format, {
      levelFor: () => this.level,
      humanSeats,
      serveTimeout: ONLINE_SERVE_TIMEOUT,
      remoteBodies: true,
      power: this.power,
      characterFor: (seat) => characters[seat],
      arena: this.matchArena,
      firstServingTeam: Math.random() < 0.5 ? 0 : 1,
    });
    this.pending = [...this.sim.events];
    this.sim.events = [];
    for (const m of this.members.values()) this.sendStart(m);
    this.broadcastLobby();
    this.accumulator = 0;
    this.lastTick = this.lastSnap = performance.now();
    this.loop = setInterval(() => this.step(), 1000 / TICK_HZ);
  }

  private sendStart(m: Member): void {
    if (!this.sim || m.seat === null) return;
    this.send(m, {
      t: 'start',
      seat: m.seat,
      format: this.format,
      names: this.teamNames(),
      characters: this.matchCharacters,
      arena: this.matchArena,
      snap: this.sim.snapshot(),
    });
  }

  /**
   * Runs on a timer, but steps the match by the real time that passed (timers on some systems fire
   * late or in bursts), so the game always runs at real speed.
   */
  private step(): void {
    const sim = this.sim;
    if (!sim) return;
    const now = performance.now();
    this.accumulator += Math.min(0.25, (now - this.lastTick) / 1000);
    this.lastTick = now;
    while (this.accumulator >= PHYSICS_DT) {
      sim.step(PHYSICS_DT);
      this.accumulator -= PHYSICS_DT;
    }
    this.pending.push(...sim.events);
    sim.events = [];
    // Generous tolerance: coarse system timers can tick just under the snapshot interval.
    if (now - this.lastSnap >= 1000 / SNAPSHOT_RATE - 8) {
      this.lastSnap = now;
      this.broadcast({ t: 'snap', snap: sim.snapshot(), ev: this.pending });
      this.pending = [];
    }
  }

  private stopLoop(): void {
    if (this.loop) clearInterval(this.loop);
    this.loop = null;
  }

  // ---------------------------------------------------------------- lobby view

  teamNames(): [string, string] {
    const names = (team: Team) => {
      const list = this.seats
        .map((id, i) => ({ id, i }))
        .filter(({ i }) => seatTeam(this.format, i) === team)
        .map(({ id }) => (id ? (this.members.get(id)?.name ?? 'Player') : 'CPU'));
      return list.join(' + ');
    };
    return [names(0), names(1)];
  }

  lobby(): LobbyState {
    const seats: LobbySeat[] = this.seats.map((id, i) => {
      const m = id ? this.members.get(id) : undefined;
      return {
        team: seatTeam(this.format, i),
        playerId: m?.id ?? null,
        name: m?.name ?? null,
        connected: !!m?.ws,
        character: m?.character ?? null,
      };
    });
    return {
      code: this.code,
      format: this.format,
      level: this.level,
      hostId: this.hostId,
      seats,
      inGame: this.inGame,
      isPublic: this.isPublic,
      power: this.power,
      arena: this.arena,
    };
  }

  /** Seats still played by the CPU (a joiner can take one between matches). */
  get freeSeats(): number {
    return this.seats.filter((id) => id === null).length;
  }

  /** This room's row in the public games list, or null if it shouldn't be listed. */
  publicInfo(): PublicRoom | null {
    const connected = [...this.members.values()].filter((m) => m.ws);
    if (!this.isPublic || connected.length === 0) return null;
    return {
      code: this.code,
      hostName: this.members.get(this.hostId)?.name ?? 'Player',
      format: this.format,
      level: this.level,
      players: connected.length,
      freeSeats: this.freeSeats,
      inGame: this.inGame,
    };
  }

  private broadcastLobby(): void {
    this.broadcast({ t: 'lobby', lobby: this.lobby() });
  }

  private broadcast(msg: ServerMsg): void {
    const data = JSON.stringify(msg);
    for (const m of this.members.values()) if (m.ws?.readyState === 1) m.ws.send(data);
  }

  send(m: Member, msg: ServerMsg): void {
    if (m.ws?.readyState === 1) m.ws.send(JSON.stringify(msg));
  }

  private error(m: Member, message: string): void {
    this.send(m, { t: 'error', message });
  }
}

const clampUnit = (n: number) => Math.max(-1, Math.min(1, n));

export const isArenaChoice = (a: unknown): a is ArenaChoice =>
  a === 'random' || (typeof a === 'string' && (ARENA_IDS as string[]).includes(a));

/** Names are shown to everyone in the room: short, plain text. */
export function cleanName(name: unknown): string {
  const s = typeof name === 'string' ? name.replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 16) : '';
  return s || 'Player';
}
