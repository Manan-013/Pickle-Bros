import { ARENAS, CHARACTERS, characterInfo } from '@picklebros/shared';
import type { ArenaChoice, CharacterId, Difficulty, Format, LobbyState, PublicRoom } from '@picklebros/shared';

export interface OnlineUiCallbacks {
  onCreate(name: string, format: Format, isPublic: boolean): void;
  onQuick(name: string, format: Format): void;
  onJoin(code: string, name: string): void;
  onSeat(seat: number): void;
  onSettings(s: { format?: Format; level?: Difficulty; isPublic?: boolean; power?: boolean; arena?: ArenaChoice }): void;
  onCharacter(id: CharacterId): void;
  onStart(): void;
  onLeave(): void;
  onBack(): void;
}

const NAME_KEY = 'picklebros.name';
const LEVEL_LABEL: Record<Difficulty, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The "Play online" screens: create / join a room, then the room lobby with seats. */
export class OnlineUi {
  private root: HTMLElement;
  private connectEl: HTMLElement;
  private lobbyEl: HTMLElement;
  private format: Format = 'singles';
  private isPublic = false;
  private joinWithName: (code: string) => void = () => {};

  constructor(parent: HTMLElement, private cb: OnlineUiCallbacks) {
    this.root = document.createElement('div');
    this.root.className = 'online';
    this.root.innerHTML = `
      <div class="overlay hidden" data-connect>
        <div class="card">
          <h1>Play <span>online</span></h1>
          <p>Play with friends: create a room and share the code.</p>
          <label class="field">Your name<input data-name maxlength="16" autocomplete="nickname" placeholder="Player" /></label>
          <div class="levels" role="group" aria-label="Match type">
            <span class="levels-label">Match</span>
            <button data-format="singles">Singles</button>
            <button data-format="doubles">Doubles</button>
          </div>
          <button data-quick>Quick match<small>Jump into a public game</small></button>
          <div class="divider">or start your own room</div>
          <div class="levels" role="group" aria-label="Who can join">
            <span class="levels-label">Room</span>
            <button data-vis="private">Private</button>
            <button data-vis="public">Public</button>
          </div>
          <button class="secondary" data-create>Create room</button>
          <div class="divider">public games</div>
          <div class="rooms" data-rooms><p class="empty">Looking for games…</p></div>
          <div class="divider">or join a friend</div>
          <div class="join-row">
            <input data-code maxlength="6" placeholder="CODE" autocapitalize="characters" aria-label="Room code" />
            <button data-join>Join</button>
          </div>
          <p class="status" data-status></p>
          <button class="secondary" data-back>Back</button>
        </div>
      </div>
      <div class="overlay hidden" data-lobby>
        <div class="card lobby">
          <p class="small-label">Room code</p>
          <div class="room-code" data-room-code></div>
          <button class="secondary copy" data-copy>Copy invite link</button>
          <div class="settings" data-settings></div>
          <div class="teams" data-teams></div>
          <p class="status" data-lobby-status></p>
          <button data-start>Start match</button>
          <button class="secondary" data-leave>Leave room</button>
        </div>
      </div>`;
    parent.appendChild(this.root);
    this.connectEl = this.q('[data-connect]');
    this.lobbyEl = this.q('[data-lobby]');

    const nameInput = this.q<HTMLInputElement>('[data-name]');
    try {
      nameInput.value = localStorage.getItem(NAME_KEY) ?? '';
    } catch {
      /* no saved name */
    }
    const name = () => {
      const n = nameInput.value.trim() || 'Player';
      try {
        localStorage.setItem(NAME_KEY, n);
      } catch {
        /* name just isn't remembered */
      }
      return n;
    };
    this.root.querySelectorAll<HTMLButtonElement>('[data-format]').forEach((b) =>
      b.addEventListener('click', () => this.setFormat(b.dataset.format as Format)),
    );
    this.setFormat('singles');
    this.root.querySelectorAll<HTMLButtonElement>('[data-vis]').forEach((b) =>
      b.addEventListener('click', () => this.setVisibility(b.dataset.vis === 'public')),
    );
    this.setVisibility(false);
    this.q('[data-create]').addEventListener('click', () => cb.onCreate(name(), this.format, this.isPublic));
    this.q('[data-quick]').addEventListener('click', () => cb.onQuick(name(), this.format));
    this.joinWithName = (code: string) => cb.onJoin(code, name());
    const codeInput = this.q<HTMLInputElement>('[data-code]');
    codeInput.addEventListener('input', () => (codeInput.value = codeInput.value.toUpperCase()));
    const join = () => {
      const code = codeInput.value.trim().toUpperCase();
      if (code.length !== 6) return this.setStatus('Room codes are 6 letters.');
      cb.onJoin(code, name());
    };
    this.q('[data-join]').addEventListener('click', join);
    codeInput.addEventListener('keydown', (e) => e.key === 'Enter' && join());
    this.q('[data-back]').addEventListener('click', () => cb.onBack());
    this.q('[data-start]').addEventListener('click', () => cb.onStart());
    this.q('[data-leave]').addEventListener('click', () => cb.onLeave());
    this.q('[data-copy]').addEventListener('click', () => this.copyInvite());
  }

  private q<T extends HTMLElement = HTMLElement>(sel: string): T {
    return this.root.querySelector<T>(sel)!;
  }

  private setVisibility(pub: boolean): void {
    this.isPublic = pub;
    this.connectEl.querySelectorAll<HTMLButtonElement>('[data-vis]').forEach((b) => {
      const on = (b.dataset.vis === 'public') === pub;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
  }

  /** Whether the create / join screen is showing (the public list refreshes while it is). */
  get connectVisible(): boolean {
    return !this.connectEl.classList.contains('hidden');
  }

  /** Fill the public games list (null = couldn't load it). */
  showRooms(rooms: PublicRoom[] | null): void {
    const list = this.q('[data-rooms]');
    if (rooms === null) {
      list.innerHTML = '<p class="empty">Can’t load public games right now.</p>';
      return;
    }
    if (!rooms.length) {
      list.innerHTML = '<p class="empty">No public games yet. Quick match starts one.</p>';
      return;
    }
    list.innerHTML = rooms
      .map((r) => {
        const kind = r.format === 'doubles' ? 'Doubles' : 'Singles';
        const seats = r.freeSeats > 0 ? `${r.freeSeats} open seat${r.freeSeats > 1 ? 's' : ''}` : 'full';
        const status = r.inGame ? 'playing now' : seats;
        const action = r.inGame || r.freeSeats === 0 ? 'Watch' : 'Join';
        return `<div class="room-row">
          <div><strong>${esc(r.hostName)}’s room</strong>
          <small>${kind} · ${r.players} player${r.players > 1 ? 's' : ''} · ${status}</small></div>
          <button data-join-room="${esc(r.code)}">${action}</button>
        </div>`;
      })
      .join('');
    list.querySelectorAll<HTMLButtonElement>('[data-join-room]').forEach((b) =>
      b.addEventListener('click', () => this.joinWithName(b.dataset.joinRoom!)),
    );
  }

  private setFormat(f: Format): void {
    this.format = f;
    this.connectEl.querySelectorAll<HTMLButtonElement>('[data-format]').forEach((b) => {
      b.classList.toggle('active', b.dataset.format === f);
      b.setAttribute('aria-pressed', String(b.dataset.format === f));
    });
  }

  showConnect(code = ''): void {
    this.lobbyEl.classList.add('hidden');
    this.connectEl.classList.remove('hidden');
    if (code) this.q<HTMLInputElement>('[data-code]').value = code.toUpperCase();
    this.setStatus('');
  }

  setStatus(text: string): void {
    this.q('[data-status]').textContent = text;
    this.q('[data-lobby-status]').textContent = text;
  }

  hide(): void {
    this.connectEl.classList.add('hidden');
    this.lobbyEl.classList.add('hidden');
  }

  private code = '';

  private inviteLink(): string {
    return `${location.origin}${location.pathname}?room=${this.code}`;
  }

  private async copyInvite(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.inviteLink());
      this.setStatus('Invite link copied — send it to your friends.');
    } catch {
      this.setStatus(`Share this link: ${this.inviteLink()}`);
    }
  }

  showLobby(lobby: LobbyState, you: string): void {
    this.code = lobby.code;
    this.connectEl.classList.add('hidden');
    this.lobbyEl.classList.remove('hidden');
    const host = lobby.hostId === you;
    this.q('[data-room-code]').textContent = lobby.code;

    // Match settings: the host can change them; others just see them.
    const settings = this.q('[data-settings]');
    const opt = (kind: string, value: string, label: string, on: boolean) =>
      `<button data-${kind}="${value}" class="${on ? 'active' : ''}" ${host ? '' : 'disabled'} aria-pressed="${on}">${label}</button>`;
    settings.innerHTML = `
      <div class="levels"><span class="levels-label">Match</span>
        ${opt('set-format', 'singles', 'Singles', lobby.format === 'singles')}
        ${opt('set-format', 'doubles', 'Doubles', lobby.format === 'doubles')}</div>
      <div class="levels"><span class="levels-label">CPU level</span>
        ${(['easy', 'medium', 'hard'] as Difficulty[]).map((l) => opt('set-level', l, LEVEL_LABEL[l], lobby.level === l)).join('')}</div>
      <div class="levels courts"><span class="levels-label">Court</span>
        ${[...ARENAS.map((a) => [a.id, a.name.split(' ')[0]]), ['random', 'Random']]
          .map(([id, name]) => opt('set-arena', id, name, lobby.arena === id))
          .join('')}</div>
      <div class="levels"><span class="levels-label">Mode</span>
        ${opt('set-power', 'power', 'Power ⚡', lobby.power)}
        ${opt('set-power', 'classic', 'Classic', !lobby.power)}</div>
      <div class="levels"><span class="levels-label">Room</span>
        ${opt('set-vis', 'private', 'Private', !lobby.isPublic)}
        ${opt('set-vis', 'public', 'Public', lobby.isPublic)}</div>`;
    settings.querySelectorAll<HTMLButtonElement>('[data-set-format]').forEach((b) =>
      b.addEventListener('click', () => this.cb.onSettings({ format: b.dataset.setFormat as Format })),
    );
    settings.querySelectorAll<HTMLButtonElement>('[data-set-level]').forEach((b) =>
      b.addEventListener('click', () => this.cb.onSettings({ level: b.dataset.setLevel as Difficulty })),
    );
    // Your character: anyone can change their own.
    const mine = lobby.seats.find((s) => s.playerId === you)?.character ?? null;
    settings.insertAdjacentHTML(
      'beforeend',
      `<div class="levels"><span class="levels-label">You</span>${CHARACTERS.map(
        (c) =>
          `<button data-set-char="${c.id}" class="${mine === c.id ? 'active' : ''}" ${lobby.inGame ? 'disabled' : ''} aria-pressed="${mine === c.id}">${c.name}</button>`,
      ).join('')}</div>`,
    );
    settings.querySelectorAll<HTMLButtonElement>('[data-set-char]').forEach((b) =>
      b.addEventListener('click', () => this.cb.onCharacter(b.dataset.setChar as CharacterId)),
    );
    settings.querySelectorAll<HTMLButtonElement>('[data-set-arena]').forEach((b) =>
      b.addEventListener('click', () => this.cb.onSettings({ arena: b.dataset.setArena as ArenaChoice })),
    );
    settings.querySelectorAll<HTMLButtonElement>('[data-set-power]').forEach((b) =>
      b.addEventListener('click', () => this.cb.onSettings({ power: b.dataset.setPower === 'power' })),
    );
    settings.querySelectorAll<HTMLButtonElement>('[data-set-vis]').forEach((b) =>
      b.addEventListener('click', () => this.cb.onSettings({ isPublic: b.dataset.setVis === 'public' })),
    );

    // Seats, grouped by team. Empty seats are played by the computer.
    const teams = this.q('[data-teams]');
    teams.innerHTML = [0, 1]
      .map((team) => {
        const rows = lobby.seats
          .map((s, i) => ({ s, i }))
          .filter(({ s }) => s.team === team)
          .map(({ s, i }) => {
            const mine = s.playerId === you;
            const as = s.character ? ` <span class="cpu">as ${characterInfo(s.character).name}</span>` : '';
            const who = s.playerId
              ? `${esc(s.name ?? 'Player')}${mine ? ' (you)' : ''}${s.playerId === lobby.hostId ? ' ★' : ''}${as}${s.connected ? '' : ' · reconnecting…'}`
              : `<span class="cpu">CPU · ${LEVEL_LABEL[lobby.level]}</span>`;
            const sit = !s.playerId && !lobby.inGame ? `<button class="sit" data-sit="${i}">Sit here</button>` : '';
            return `<div class="seat ${mine ? 'mine' : ''}"><span>${who}</span>${sit}</div>`;
          })
          .join('');
        return `<div class="team"><div class="team-name">Team ${team + 1}</div>${rows}</div>`;
      })
      .join('');
    teams.querySelectorAll<HTMLButtonElement>('[data-sit]').forEach((b) =>
      b.addEventListener('click', () => this.cb.onSeat(Number(b.dataset.sit))),
    );

    const start = this.q<HTMLButtonElement>('[data-start]');
    start.hidden = !host;
    start.textContent = lobby.inGame ? 'Match in progress' : 'Start match';
    start.disabled = lobby.inGame;
    if (!host) this.setStatus(lobby.inGame ? 'Match in progress — you can join the next one.' : 'Waiting for the host to start…');
  }
}
