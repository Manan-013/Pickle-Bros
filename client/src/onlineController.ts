import type { ArenaChoice, CharacterId, Difficulty, Format, LobbyState, ServerMsg } from '@picklebros/shared';
import { Net } from './net';
import { OnlineUi } from './onlineUi';

type StartMsg = Extract<ServerMsg, { t: 'start' }>;

/** What the online flow needs from the game. */
export interface OnlineHost {
  difficulty(): Difficulty;
  /** Power Mode chosen on the menu (new rooms start with it). */
  power(): boolean;
  /** Your character (from the menu). */
  character(): CharacterId;
  /** Court chosen on the menu (new rooms start with it). */
  arena(): ArenaChoice;
  /** You picked a character in the room lobby (remembered for next time too). */
  pickCharacter(id: CharacterId): void;
  startOnlineMatch(msg: StartMsg): void;
  /** Stop showing an online match (back to the room lobby or menu). */
  endOnlineMatch(): void;
  showMenu(): void;
  hideMenu(): void;
}

const SESSION_KEY = 'picklebros.session';

interface Session {
  code: string;
  token: string;
}

const loadSession = (): Session | null => {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null');
  } catch {
    return null;
  }
};
const saveSession = (s: Session | null) => {
  try {
    if (s) sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* rejoin after refresh just won't be automatic */
  }
};

/** Runs "Play online": connecting, creating/joining rooms, the lobby, and starting matches. */
export class OnlineController {
  readonly net = new Net();
  private ui: OnlineUi;
  private you = '';
  private lobby: LobbyState | null = null;
  private inMatch = false;
  private active = false;
  private listTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    container: HTMLElement,
    private host: OnlineHost,
  ) {
    this.ui = new OnlineUi(container, {
      onCreate: (name, format, isPublic) => this.create(name, format, isPublic),
      onQuick: (name, format) => this.quick(name, format),
      onJoin: (code, name) => this.join(code, name),
      onSeat: (seat) => this.net.send({ t: 'seat', seat }),
      onSettings: (s) => this.net.send({ t: 'settings', ...s }),
      onCharacter: (id) => {
        this.host.pickCharacter(id);
        this.net.send({ t: 'character', id });
      },
      onStart: () => this.net.send({ t: 'start' }),
      onLeave: () => this.leave(),
      onBack: () => this.close(),
    });
    this.net.listen((msg) => this.onMessage(msg));
    this.net.onClose = () => this.onDisconnected();
  }

  get isHost(): boolean {
    return !!this.lobby && this.lobby.hostId === this.you;
  }

  /** Open the online screen (optionally with a room code from an invite link). */
  open(code = ''): void {
    this.active = true;
    this.host.hideMenu();
    this.ui.showConnect(code);
    // Came back to a room we were in (page refresh): rejoin it automatically.
    const s = loadSession();
    if (code && s && s.code === code) void this.join(code, '');
    void this.startListing();
  }

  /** Keep the public games list fresh while the create / join screen is open. */
  private async startListing(): Promise<void> {
    this.stopListing();
    if (!(await this.connect())) return this.ui.showRooms(null);
    const ask = () => {
      if (!this.active || !this.ui.connectVisible) return this.stopListing();
      this.net.send({ t: 'list' });
    };
    ask();
    this.listTimer = setInterval(ask, 3000);
  }

  private stopListing(): void {
    if (this.listTimer) clearInterval(this.listTimer);
    this.listTimer = null;
  }

  private async connect(): Promise<boolean> {
    if (this.net.connected) return true;
    this.ui.setStatus('Connecting…');
    try {
      await this.net.connect();
      this.ui.setStatus('');
      return true;
    } catch (e) {
      this.ui.setStatus((e as Error).message);
      return false;
    }
  }

  private async create(name: string, format: Format, isPublic: boolean): Promise<void> {
    if (!(await this.connect())) return;
    this.net.send({
      t: 'create',
      name,
      format,
      level: this.host.difficulty(),
      isPublic,
      power: this.host.power(),
      character: this.host.character(),
      arena: this.host.arena(),
    });
  }

  private async quick(name: string, format: Format): Promise<void> {
    if (!(await this.connect())) return;
    this.net.send({ t: 'quick', name, format, level: this.host.difficulty(), character: this.host.character() });
  }

  private async join(code: string, name: string): Promise<void> {
    if (!(await this.connect())) return;
    const s = loadSession();
    this.net.send({
      t: 'join',
      code,
      name,
      token: s && s.code === code ? s.token : undefined,
      character: this.host.character(),
    });
  }

  private onMessage(msg: ServerMsg): void {
    switch (msg.t) {
      case 'welcome':
        this.you = msg.you;
        this.lobby = msg.lobby;
        saveSession({ code: msg.lobby.code, token: msg.token });
        history.replaceState(null, '', `?room=${msg.lobby.code}`);
        if (!this.inMatch) this.ui.showLobby(msg.lobby, this.you);
        break;
      case 'lobby':
        this.lobby = msg.lobby;
        if (!this.inMatch && this.active) this.ui.showLobby(msg.lobby, this.you);
        break;
      case 'rooms':
        this.ui.showRooms(msg.rooms);
        break;
      case 'error':
        this.ui.setStatus(msg.message);
        // A stale saved session for a room that's gone: forget it.
        if (!this.lobby) saveSession(null);
        break;
      case 'start':
        this.inMatch = true;
        this.ui.hide();
        this.host.startOnlineMatch(msg);
        break;
    }
  }

  /** Game over → Play again: the host restarts; others wait for the host. */
  rematch(): void {
    if (this.isHost) this.net.send({ t: 'rematch' });
    else this.ui.setStatus('Waiting for the host to start a rematch…');
  }

  /** Leave the match view and show the room lobby (still connected). */
  backToLobby(): void {
    this.inMatch = false;
    this.host.endOnlineMatch();
    if (this.lobby) this.ui.showLobby(this.lobby, this.you);
  }

  /** Leave the room entirely (the computer takes over your seat) and return to the menu. */
  leave(): void {
    this.net.send({ t: 'leave' });
    saveSession(null);
    this.close();
  }

  /** Back to the main menu, disconnecting. */
  close(): void {
    this.stopListing();
    this.active = false;
    this.inMatch = false;
    this.lobby = null;
    this.net.close();
    this.ui.hide();
    history.replaceState(null, '', location.pathname);
    this.host.endOnlineMatch();
    this.host.showMenu();
  }

  private onDisconnected(): void {
    if (!this.active) return;
    const s = loadSession();
    this.inMatch = false;
    this.host.endOnlineMatch();
    this.ui.showConnect(s?.code ?? '');
    this.ui.setStatus('Lost connection to the server. Press Join to get back in.');
    this.ui.showRooms(null);
  }
}
