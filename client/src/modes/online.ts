import {
  ArenaId,
  FREEZE_SPEED,
  characterInfo,
  Format,
  MatchState,
  PlayerBody,
  SLOWMO_SCALE,
  SNAPSHOT_RATE,
  ServerMsg,
  Slot,
  Snapshot,
  Team,
  createBall,
} from '@picklebros/shared';
import type { Player } from '../entities/player';
import type { Net } from '../net';
import { FrameInfo, GameMode, ModeContext, SwingIntent, isLettingGo, isPowerHeld } from './mode';
import { MatchView, ViewSeat } from './matchView';

/** Draw other players and the ball this far in the past, so there are always two snapshots to blend. */
const INTERP_DELAY = 0.1;
const SEND_INTERVAL = 1 / SNAPSHOT_RATE;

type StartMsg = Extract<ServerMsg, { t: 'start' }>;

const seatList = (format: Format): { team: Team; slot: Slot }[] =>
  format === 'doubles'
    ? [
        { team: 0, slot: 0 },
        { team: 0, slot: 1 },
        { team: 1, slot: 0 },
        { team: 1, slot: 1 },
      ]
    : [
        { team: 0, slot: 0 },
        { team: 1, slot: 0 },
      ];

/**
 * Online match: the server runs the match; this browser moves its own player, sends controls,
 * and draws everything else smoothly from the server's snapshots.
 */
export class OnlineMatchMode implements GameMode {
  readonly ball = createBall();
  readonly side: 1 | -1;
  readonly arena: ArenaId;
  private view: MatchView;
  private bodies: PlayerBody[];
  private mySeat: number;
  private snaps: Snapshot[] = [];
  private latest: Snapshot;
  /** Server time minus local time (s), smoothed. */
  private clockOffset: number | null = null;
  /** Server time currently being drawn (for Phantom Dink timing). */
  private renderTime = 0;
  private resetId = -1;
  private sendTimer = 0;
  private unlisten: () => void;

  constructor(
    private ctx: ModeContext,
    private net: Net,
    start: StartMsg,
  ) {
    this.mySeat = start.seat;
    const seats = seatList(start.format);
    this.arena = start.arena ?? 'park';
    this.bodies = seats.map((s, i) => {
      const b = new PlayerBody(s.team);
      b.speedScale = characterInfo(start.characters[i]).speed; // you move yourself, at your character's speed
      return b;
    });
    const viewSeats: ViewSeat[] = seats.map((s, i) => ({ ...s, body: this.bodies[i], character: start.characters[i] ?? 'rookie' }));
    this.view = new MatchView(
      ctx,
      start.format,
      viewSeats,
      this.mySeat,
      start.names,
      ['Rematch', 'Back to room'],
      start.snap.power !== null,
      this.arena,
    );
    this.side = this.view.side;
    this.latest = start.snap;
    this.receive(start.snap);
    this.view.updateScoreboard(start.snap.state);
    if (start.snap.phase === 'preServe' && start.snap.rally.serverSeat === this.mySeat) {
      ctx.hud.setPrompt('Aim with the mouse · click to serve');
    }
    this.unlisten = net.listen((msg) => {
      if (msg.t === 'snap') {
        this.receive(msg.snap);
        // Your own swing animates the moment you click; skip the server's echo of it.
        const events = msg.ev.filter((e) => !(e.type === 'swing' && e.seat === this.mySeat));
        this.view.handle(events, msg.snap.state);
      }
    });
  }

  get clock(): number {
    return this.renderTime || this.latest.time;
  }

  get focus(): Player {
    return this.view.me;
  }

  private get myBody(): PlayerBody {
    return this.bodies[this.mySeat];
  }

  private receive(snap: Snapshot): void {
    const now = performance.now() / 1000;
    const sample = snap.time - now;
    this.clockOffset = this.clockOffset === null ? sample : this.clockOffset + (sample - this.clockOffset) * 0.1;
    this.snaps.push(snap);
    if (this.snaps.length > 30) this.snaps.shift();
    this.latest = snap;
    // The server put everyone in serving positions: jump there.
    if (snap.resetId !== this.resetId) {
      this.resetId = snap.resetId;
      const [x, z] = snap.seats[this.mySeat];
      this.myBody.teleport(x, z);
    }
  }

  /** Your movement keys are screen-relative: from the far end, "up" is +z. Frozen = slower. */
  private move(): { x: number; z: number } {
    const m = this.ctx.input.move();
    const world = this.side > 0 ? m : { x: -m.x, z: -m.z };
    const slow = this.latest.power?.slowed[this.mySeat] === 1 ? FREEZE_SPEED : 1;
    return { x: world.x * slow, z: world.z * slow };
  }

  onKey(code: string): void {
    const s = this.latest;
    if (code === 'MouseLeft' && s.phase === 'preServe' && s.rally.serverSeat === this.mySeat) {
      this.net.send({ t: 'serve' });
      this.ctx.hud.setPrompt(null);
    } else if (code === 'KeyE' || code === 'KeyQ') {
      this.net.send({ t: 'arm', kind: code === 'KeyE' ? 'special' : 'super' });
    } else if (code === 'Space' && s.phase === 'rally') {
      const m = this.move();
      if (m.x !== 0 || m.z !== 0) this.myBody.dive(m.x, m.z);
      else this.myBody.dive(Math.sign(this.ball.pos.x - this.myBody.x) || 1, 0);
    }
  }

  onSwing(intent: SwingIntent): void {
    if (this.ctx.swingMode() !== 'manual' || this.latest.phase !== 'rally') return;
    this.net.send({ t: 'swing', intent });
    // The server widens the click window a little to absorb the network delay.
    this.focus.swingAt(this.ball.pos.x);
  }

  fixedUpdate(dt: number): void {
    // You move yourself (no waiting on the server); positions are locked outside rallies.
    // Meteor Smash slow motion slows you too (the server runs the same slow motion).
    const scale = this.latest.power?.slowmo ? SLOWMO_SCALE : 1;
    if (this.latest.phase === 'rally') this.myBody.update(dt * scale, this.move());
    this.sendTimer += dt;
    if (this.sendTimer >= SEND_INTERVAL) {
      this.sendTimer = 0;
      const b = this.myBody;
      const aim = this.ctx.aimPoint();
      const m = this.move();
      this.net.send({
        t: 'input',
        x: b.x,
        z: b.z,
        vx: b.vx,
        vz: b.vz,
        move: [m.x, m.z],
        aim: aim ? [aim.x, aim.z] : null,
        power: isPowerHeld(this.ctx.input),
        letGo: isLettingGo(this.ctx.input),
        manual: this.ctx.swingMode() === 'manual',
      });
    }
  }

  /** Blend the two snapshots around the render time for the ball and the other players. */
  private interpolate(): void {
    const snaps = this.snaps;
    if (!snaps.length || this.clockOffset === null) return;
    const renderTime = performance.now() / 1000 + this.clockOffset - INTERP_DELAY;
    this.renderTime = renderTime;
    let a = snaps[0];
    let b = snaps[snaps.length - 1];
    for (let i = 0; i < snaps.length - 1; i++) {
      if (snaps[i].time <= renderTime && snaps[i + 1].time >= renderTime) {
        a = snaps[i];
        b = snaps[i + 1];
        break;
      }
    }
    const span = b.time - a.time;
    const t = span > 0 ? Math.max(0, Math.min(1, (renderTime - a.time) / span)) : 1;
    const lerp = (x: number, y: number) => x + (y - x) * t;
    const ball = this.ball;
    ball.pos = { x: lerp(a.ball[0], b.ball[0]), y: lerp(a.ball[1], b.ball[1]), z: lerp(a.ball[2], b.ball[2]) };
    ball.vel = { x: b.ball[3], y: b.ball[4], z: b.ball[5] };
    ball.spin = { x: b.ball[6], y: b.ball[7], z: b.ball[8] };
    for (let i = 0; i < this.bodies.length; i++) {
      if (i === this.mySeat) continue;
      const p = a.seats[i];
      const q = b.seats[i];
      if (!p || !q) continue;
      this.bodies[i].applyRemote(lerp(p[0], q[0]), lerp(p[1], q[1]), q[2], q[3], q[4] === 1, q[5], q[6]);
    }
  }

  frame(dt: number): FrameInfo {
    this.interpolate();
    const s = this.latest;
    return this.view.frame(dt, this.ball, { ...s.rally, phase: s.phase }, s.state, s.power, this.renderTime);
  }

  /** The final score, from your team's point of view (for the game-over screen). */
  get state(): MatchState {
    return this.latest.state;
  }

  dispose(): void {
    this.unlisten();
    this.view.dispose();
  }
}
