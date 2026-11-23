import { ARENAS, CHARACTERS, MAX_METER, SPECIAL_COLOR, SPECIAL_NAME } from '@picklebros/shared';
import type { ArenaChoice, ArmKind, CharacterId, ContactRating, Difficulty, ShotType, SpecialKind, Team } from '@picklebros/shared';
import { LOOKS } from './characterLooks';
import { SPIN_LABEL, type Spin } from './modes/mode';

/** How each shot is chosen (`hint`). `color` tints the crosshair and the ball trail. */
export const SHOTS: { type: ShotType; hint: string; label: string; color: string }[] = [
  { type: 'dink', hint: 'left · aim short', label: 'Dink', color: '#5ee38a' },
  { type: 'drive', hint: 'left · aim deep', label: 'Drive', color: '#ff5d5d' },
  { type: 'lob', hint: 'right-click', label: 'Lob', color: '#5fb4ff' },
  { type: 'smash', hint: 'right · high ball', label: 'Smash', color: '#ffb547' },
];

export const shotInfo = (type: ShotType) => SHOTS.find((s) => s.type === type)!;

export type FlashKind = 'good' | 'bad' | 'info';
export type MenuChoice = 'practice' | 'singles' | 'doubles' | 'online';
export type HudView = 'menu' | 'practice' | 'match';

export interface Scoreboard {
  names: [string, string];
  score: [number, number];
  serving: Team;
  call: string;
}

export interface HudCallbacks {
  onPick(choice: MenuChoice): void;
  onAgain(): void;
  onMenu(): void;
  onToggleSwing(): void;
  onTogglePower(): void;
  onToggleSound(): void;
  onCharacter(id: CharacterId): void;
  onArena(a: ArenaChoice): void;
  onDifficulty(level: Difficulty): void;
}

/** Your Power Mode state for the meter panel. */
export interface PowerHud {
  meter: number;
  combo: number;
  armed: ArmKind | null;
  /** What the armed shot will be if you hit now. */
  next: SpecialKind | null;
  /** Can't fire yet (cooling down or not enough bars). */
  blocked: boolean;
}

type SwingMode = 'auto' | 'manual';

const HIT_HELP: Record<SwingMode, string> = {
  auto: 'hits are automatic · hold RIGHT button for lob / smash',
  manual: 'hold LEFT (hit) or RIGHT (lob / smash) to charge, release on the green ring · flick while holding = spin',
};

const help = (view: HudView, swing: SwingMode, power: boolean): string => {
  if (view === 'menu') return '';
  const serve = view === 'match' ? ' · click to serve' : '';
  const specials = view === 'match' && power ? ' · E special (1 bar) · Q super (3 bars)' : '';
  return `WASD move · Space dive · mouse aims (short = dink, deep = drive) · ${HIT_HELP[swing]}${serve}${specials} · Esc menu`;
};

const RATING_TEXT: Record<ContactRating, string> = { perfect: 'PERFECT', good: 'GOOD', stretch: 'STRETCH' };

const el = <T extends HTMLElement = HTMLElement>(root: HTMLElement, sel: string) => root.querySelector<T>(sel)!;

export class Hud {
  private root: HTMLElement;
  private chips = new Map<ShotType, HTMLElement>();
  private msgTime = 0;
  private ratingTime = 0;

  constructor(parent: HTMLElement, cb: HudCallbacks) {
    const root = (this.root = document.createElement('div'));
    root.className = 'hud';
    root.innerHTML = `
      <div class="panel score practice-only">
        <div class="mode">Practice · Ball machine</div>
        <div class="stats">
          <div><span class="label">Streak</span><span class="value" data-streak>0</span></div>
          <div><span class="label">Best</span><span class="value" data-best>0</span></div>
        </div>
      </div>
      <div class="panel board match-only">
        <div class="call"><span class="label">PickleBros</span><span class="live">LIVE</span><span data-call>0-0</span></div>
        <div class="row" data-row="0"><span class="team-chip t0"></span><span class="serve-dot"></span><span class="name"></span><span class="pips"></span><span class="pts"></span></div>
        <div class="row" data-row="1"><span class="team-chip t1"></span><span class="serve-dot"></span><span class="name"></span><span class="pips"></span><span class="pts"></span></div>
      </div>
      <div class="panel power-panel hidden" data-power>
        <div class="power-top"><span class="label">POWER</span><span class="combo" data-combo></span></div>
        <div class="bars">${'<div class="bar"><div class="fill"></div></div>'.repeat(MAX_METER)}</div>
        <div class="armed" data-armed></div>
      </div>
      <div class="callout" data-callout></div>
      <div class="wind" data-wind><span class="arrow">➜</span><span data-wind-text></span></div>
      <div class="badge" data-badge></div>
      <div class="msg" data-msg><div class="main"></div><div class="sub"></div></div>
      <div class="rating" data-rating></div>
      <div class="charge" data-charge><div class="fill"></div><span class="label">POWER</span></div>
      <div class="prompt" data-prompt></div>
      <div class="shots play-only" data-shots></div>
      <div class="help" data-help></div>
      <div class="overlay" data-menu>
        <div class="card">
          <h1>Pickle<span>Bros</span></h1>
          <p>3D arcade pickleball</p>
          <div class="chars" role="group" aria-label="Your character" data-chars></div>
          <div class="levels courts" role="group" aria-label="Court" data-courts></div>
          <div class="levels" role="group" aria-label="Computer difficulty">
            <span class="levels-label">CPU level</span>
            <button data-level="easy">Easy</button>
            <button data-level="medium">Medium</button>
            <button data-level="hard">Hard</button>
          </div>
          <button data-pick="practice">Practice<small>Ball machine</small></button>
          <button data-pick="singles">Singles vs CPU<small>1 v 1 · first to 11, win by 2</small></button>
          <button data-pick="doubles">Doubles vs CPU<small>You + CPU partner vs 2 CPUs</small></button>
          <button data-pick="online">Play online<small>With friends · share a room code</small></button>
          <button class="secondary toggle" data-power-toggle></button>
          <button class="secondary toggle" data-swing></button>
          <button class="secondary toggle" data-sound-toggle></button>
        </div>
      </div>
      <div class="overlay hidden" data-over>
        <div class="card">
          <h1 data-over-title></h1>
          <p class="final" data-over-sub></p>
          <button data-again>Play again</button>
          <button class="secondary" data-menu-btn>Main menu</button>
        </div>
      </div>
    `;
    parent.appendChild(root);

    const shots = el(root, '[data-shots]');
    for (const s of SHOTS) {
      const chip = document.createElement('div');
      chip.className = 'chip';
      chip.innerHTML = `${s.label}<kbd>${s.hint}</kbd>`;
      chip.style.setProperty('--shot', s.color);
      shots.appendChild(chip);
      this.chips.set(s.type, chip);
    }
    root.querySelectorAll<HTMLButtonElement>('[data-pick]').forEach((b) =>
      b.addEventListener('click', () => cb.onPick(b.dataset.pick as MenuChoice)),
    );
    el(root, '[data-again]').addEventListener('click', () => cb.onAgain());
    el(root, '[data-menu-btn]').addEventListener('click', () => cb.onMenu());
    el(root, '[data-swing]').addEventListener('click', () => cb.onToggleSwing());
    el(root, '[data-power-toggle]').addEventListener('click', () => cb.onTogglePower());
    el(root, '[data-sound-toggle]').addEventListener('click', () => cb.onToggleSound());
    const chars = el(root, '[data-chars]');
    chars.innerHTML = CHARACTERS.map((c) => {
      const color = `#${LOOKS[c.id].shirt.toString(16).padStart(6, '0')}`;
      return `<button class="char" data-char="${c.id}" style="--char:${color}" title="${c.style} · Super: ${SPECIAL_NAME[c.superMove]}">
        <span class="swatch"></span><strong>${c.name}</strong><small>${LOOKS[c.id].blurb}</small></button>`;
    }).join('');
    chars.querySelectorAll<HTMLButtonElement>('[data-char]').forEach((b) =>
      b.addEventListener('click', () => cb.onCharacter(b.dataset.char as CharacterId)),
    );
    chars.insertAdjacentHTML('afterend', '<p class="char-info" data-char-info></p>');
    const courts = el(root, '[data-courts]');
    courts.innerHTML =
      '<span class="levels-label">Court</span>' +
      [...ARENAS.map((a) => [a.id, a.name.replace('Space Station', 'Space').replace('Neon Rooftop', 'Rooftop'), a.twist]), ['random', 'Random', 'A different court each match']]
        .map(([id, name, twist]) => `<button data-court="${id}" title="${twist}">${name}</button>`)
        .join('');
    courts.querySelectorAll<HTMLButtonElement>('[data-court]').forEach((b) =>
      b.addEventListener('click', () => cb.onArena(b.dataset.court as ArenaChoice)),
    );
    root.querySelectorAll<HTMLButtonElement>('[data-level]').forEach((b) =>
      b.addEventListener('click', () => cb.onDifficulty(b.dataset.level as Difficulty)),
    );
    this.setView('menu');
  }

  private view: HudView = 'menu';
  private swing: SwingMode = 'auto';
  private power = true;
  private calloutTime = 0;

  /** Highlight your character on the menu and describe them. */
  setCharacter(id: CharacterId): void {
    this.root.querySelectorAll<HTMLButtonElement>('[data-char]').forEach((b) => {
      const on = b.dataset.char === id;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    const c = CHARACTERS.find((x) => x.id === id)!;
    const pct = (v: number) => `${v >= 1 ? '+' : ''}${Math.round((v - 1) * 100)}%`;
    el(this.root, '[data-char-info]').innerHTML =
      `<strong>${c.name}</strong> · ${c.style}<br>Speed ${pct(c.speed)} · Power ${pct(c.power)} · Control ${pct(c.control)}` +
      ` · Super: <span style="color:${SPECIAL_COLOR[c.superMove]}">${SPECIAL_NAME[c.superMove]}</span>`;
  }

  setArena(a: ArenaChoice): void {
    this.root.querySelectorAll<HTMLButtonElement>('[data-court]').forEach((b) => {
      const on = b.dataset.court === a;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
  }

  /** Wind arrow and strength (beach), drawn from your end of the court; null hides it. */
  setWind(wind: { x: number; z: number } | null, side: 1 | -1): void {
    const w = el(this.root, '[data-wind]');
    w.classList.toggle('show', !!wind);
    if (!wind) return;
    // Screen direction: x to the right, z toward you (flipped if you play from the far end).
    const sx = wind.x * side;
    const sz = wind.z * side;
    const angle = Math.atan2(sz, sx);
    el(w, '.arrow').style.transform = `rotate(${angle}rad)`;
    const strength = Math.hypot(wind.x, wind.z);
    el(w, '[data-wind-text]').textContent = `Wind ${strength < 0.2 ? 'calm' : strength < 0.55 ? 'light' : 'strong'}`;
  }

  setSoundOn(on: boolean): void {
    el(this.root, '[data-sound-toggle]').innerHTML = on
      ? 'Sound: On 🔊<small>Press M anytime to mute</small>'
      : 'Sound: Off 🔇<small>Press M anytime to turn on</small>';
  }

  /** Menu switch between Power Mode and Classic (also changes the help line). */
  setPowerMode(on: boolean): void {
    this.power = on;
    el(this.root, '[data-power-toggle]').innerHTML = on
      ? 'Mode: Power ⚡<small>Specials &amp; supers · click for Classic</small>'
      : 'Mode: Classic<small>Plain pickleball · click for Power</small>';
    el(this.root, '[data-help]').textContent = help(this.view, this.swing, this.power);
  }

  /** In a match: is Power Mode on (shows help for E / Q). */
  setMatchPower(on: boolean): void {
    this.power = on;
    el(this.root, '[data-help]').textContent = help(this.view, this.swing, on);
  }

  /** Your meter, combo and armed shot (null hides the panel, e.g. Classic Mode). */
  setPower(p: PowerHud | null): void {
    const panel = el(this.root, '[data-power]');
    panel.classList.toggle('hidden', !p);
    if (!p) return;
    panel.querySelectorAll<HTMLElement>('.bar .fill').forEach((f, i) => {
      f.style.width = `${Math.max(0, Math.min(1, p.meter - i)) * 100}%`;
      f.parentElement!.classList.toggle('full', p.meter >= i + 1);
    });
    el(panel, '[data-combo]').textContent = p.combo >= 2 ? `x${p.combo} COMBO` : '';
    const armed = el(panel, '[data-armed]');
    if (p.armed && p.next) {
      armed.innerHTML = `<span style="color:${SPECIAL_COLOR[p.next]}">${SPECIAL_NAME[p.next]}</span> ${p.blocked ? 'not ready' : 'ready'} · ${p.armed === 'super' ? 'Q' : 'E'} to cancel`;
    } else {
      const canSpecial = p.meter >= 1;
      const canSuper = p.meter >= MAX_METER;
      armed.textContent = canSuper ? 'Q: SUPER ready! · E: special' : canSpecial ? 'E: special ready' : '';
    }
    panel.classList.toggle('armed', !!p.armed);
  }

  /** Small meter pips next to each team's name (strongest player on the team). */
  setTeamMeters(meters: [number, number] | null): void {
    for (const t of [0, 1] as Team[]) {
      const pips = el(el(this.root, `[data-row="${t}"]`), '.pips');
      pips.innerHTML = meters ? '●'.repeat(Math.floor(meters[t])) + '○'.repeat(MAX_METER - Math.floor(meters[t])) : '';
    }
  }

  /** Big announcement for specials, blocks and freezes. */
  callout(text: string, color: string): void {
    const c = el(this.root, '[data-callout]');
    c.textContent = text;
    c.style.color = color;
    c.classList.remove('show');
    void c.offsetWidth; // restart the animation
    c.classList.add('show');
    this.calloutTime = 1.2;
  }

  setDifficulty(level: Difficulty): void {
    this.root.querySelectorAll<HTMLButtonElement>('[data-level]').forEach((b) => {
      const on = b.dataset.level === level;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
  }

  /** Updates the menu toggle and the controls help line. */
  setSwingMode(mode: SwingMode): void {
    this.swing = mode;
    el(this.root, '[data-swing]').innerHTML =
      mode === 'auto'
        ? 'Swing: Auto<small>Your player hits by itself · click to switch to mouse clicks</small>'
        : 'Swing: Mouse clicks<small>Left = hit, right = lob / smash · click to switch to auto</small>';
    el(this.root, '[data-help]').textContent = help(this.view, mode, this.power);
  }

  setView(view: HudView): void {
    this.view = view;
    this.root.dataset.view = view;
    el(this.root, '[data-menu]').classList.toggle('hidden', view !== 'menu');
    el(this.root, '[data-help]').textContent = help(view, this.swing, this.power);
    if (view === 'menu') {
      this.setPrompt(null);
      this.setBadge(null);
      this.hideGameOver();
      el(this.root, '[data-msg]').classList.remove('show');
      el(this.root, '[data-rating]').classList.remove('show');
      this.msgTime = this.ratingTime = 0;
      this.setCharge(null);
      this.setPower(null);
      this.setTeamMeters(null);
    }
  }

  setShot(type: ShotType): void {
    for (const [t, chip] of this.chips) chip.classList.toggle('active', t === type);
  }

  setStreak(streak: number, best: number): void {
    el(this.root, '[data-streak]').textContent = String(streak);
    el(this.root, '[data-best]').textContent = String(best);
  }

  setScoreboard(s: Scoreboard): void {
    el(this.root, '[data-call]').textContent = s.call;
    for (const t of [0, 1] as Team[]) {
      const row = el(this.root, `[data-row="${t}"]`);
      row.classList.toggle('serving', s.serving === t);
      el(row, '.name').textContent = s.names[t];
      el(row, '.pts').textContent = String(s.score[t]);
    }
  }

  flash(text: string, kind: FlashKind, sub = ''): void {
    const msg = el(this.root, '[data-msg]');
    el(msg, '.main').textContent = text;
    el(msg, '.sub').textContent = sub;
    msg.className = `msg show ${kind}`;
    this.msgTime = kind === 'info' ? 0.8 : 1.5;
  }

  /** Shown at contact: shot, spin, power and how cleanly, e.g. "DRIVE · TOPSPIN · POWER · PERFECT". */
  rating(r: ContactRating, shot: ShotType, intent?: { charge: number; spin: Spin | null }): void {
    const e = el(this.root, '[data-rating]');
    const s = shotInfo(shot);
    const parts = [`<span style="color:${s.color}">${s.label.toUpperCase()}</span>`];
    if (intent?.spin) parts.push(SPIN_LABEL[intent.spin]);
    if (intent && intent.charge > 1) parts.push('<span class="over">OVERHIT</span>');
    else if (intent && intent.charge >= 0.9) parts.push('POWER');
    else if (intent && intent.charge < 0.15) parts.push('TOUCH');
    parts.push(RATING_TEXT[r]);
    e.innerHTML = parts.join(' · ');
    e.className = `rating show ${r}`;
    this.ratingTime = 1.0;
  }

  /** Power bar while a click is held (null hides it). Above 1 = overcharged. */
  setCharge(charge: number | null): void {
    const bar = el(this.root, '[data-charge]');
    bar.classList.toggle('show', charge !== null);
    if (charge === null) return;
    el(bar, '.fill').style.width = `${Math.min(charge, 1) * 100}%`;
    bar.classList.toggle('over', charge > 1);
    el(bar, '.label').textContent = charge > 1 ? 'TOO MUCH!' : charge >= 0.9 ? 'FULL POWER' : 'POWER';
  }

  setPrompt(text: string | null): void {
    const e = el(this.root, '[data-prompt]');
    e.textContent = text ?? '';
    e.classList.toggle('show', !!text);
  }

  setBadge(text: string | null): void {
    const e = el(this.root, '[data-badge]');
    if (e.textContent !== (text ?? '')) e.textContent = text ?? '';
    e.classList.toggle('show', !!text);
  }

  /** Hide the main menu (e.g. while the online screens are open). */
  hideMenu(): void {
    el(this.root, '[data-menu]').classList.add('hidden');
  }

  showGameOver(title: string, sub: string, won: boolean, labels: [string, string] = ['Play again', 'Main menu']): void {
    const o = el(this.root, '[data-over]');
    el(o, '[data-again]').textContent = labels[0];
    el(o, '[data-menu-btn]').textContent = labels[1];
    el(o, '[data-over-title]').textContent = title;
    el(o, '[data-over-title]').className = won ? 'win' : 'lose';
    el(o, '[data-over-sub]').textContent = sub;
    o.classList.remove('hidden');
  }

  hideGameOver(): void {
    el(this.root, '[data-over]').classList.add('hidden');
  }

  update(dt: number): void {
    if (this.msgTime > 0 && (this.msgTime -= dt) <= 0) el(this.root, '[data-msg]').classList.remove('show');
    if (this.ratingTime > 0 && (this.ratingTime -= dt) <= 0) el(this.root, '[data-rating]').classList.remove('show');
    if (this.calloutTime > 0 && (this.calloutTime -= dt) <= 0) el(this.root, '[data-callout]').classList.remove('show');
  }
}
