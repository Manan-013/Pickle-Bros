import {
  ArenaId,
  BALL,
  COURT,
  CharacterId,
  applyArena,
  arenaInfo,
  characterInfo,
  REACH,
  BallEvent,
  ShotType,
  applyShotError,
  clampTarget,
  cloneVec,
  contactQuality,
  createBall,
  planShot,
  predictFirstBounce,
  rateContact,
  shotPace,
  solveShot,
  stepBall,
} from '@picklebros/shared';
import { Player } from '../entities/player';
import { BallMachine } from '../entities/ballMachine';
import { FlashKind, shotInfo } from '../hud';
import {
  FrameInfo,
  GameMode,
  HumanSwing,
  ModeContext,
  SwingIntent,
  applyIntent,
  chargePace,
  diveTowardBall,
  isLettingGo,
  predictContactTime,
  shotAtContact,
} from './mode';

/**
 * waiting  – ball is in the machine
 * incoming – feed is in the air / on the player's side
 * returned – player has hit it back
 * done     – result shown, next feed scheduled
 */
type Phase = 'waiting' | 'incoming' | 'returned' | 'done';

const FEED_DELAY = 1.1;
const RALLY_TIMEOUT = 7;
const BEST_KEY = 'picklebros.practice.best';

const pick = <T>(items: [T, number][]): T => {
  let r = Math.random() * items.reduce((s, [, w]) => s + w, 0);
  for (const [item, w] of items) if ((r -= w) <= 0) return item;
  return items[items.length - 1][0];
};

/** Solo practice against a ball machine; counts a streak of good returns. */
export class PracticeMode implements GameMode {
  readonly side = 1 as const;
  readonly ball = createBall();
  readonly focus: Player;
  private machine: BallMachine;
  private events: BallEvent[] = [];
  private phase: Phase = 'waiting';
  private timer = 0.8;
  private phaseTime = 0;
  private nearBounces = 0;
  private prevHd: number | null = null;
  private lastShot: ShotType = 'drive';
  private streak = 0;
  private best = 0;
  private time = 0;
  private swing: HumanSwing;

  constructor(
    private ctx: ModeContext,
    character: CharacterId = 'rookie',
    readonly arena: ArenaId = 'park',
  ) {
    this.swing = new HumanSwing(ctx);
    this.focus = new Player(ctx.scene, { team: 0, character });
    const court = arenaInfo(arena);
    this.focus.body.speedScale = characterInfo(character).speed;
    this.focus.body.footSpeed = court.runSpeed;
    this.focus.body.grip = court.grip;
    if (arena !== 'park') ctx.hud.flash(court.name, 'info', court.twist);
    this.focus.teleport(0, COURT.LENGTH / 2 - 0.8);
    this.machine = new BallMachine(ctx.scene);
    try {
      this.best = Number(localStorage.getItem(BEST_KEY)) || 0;
    } catch {
      this.best = 0;
    }
    ctx.hud.setView('practice');
    ctx.hud.setStreak(this.streak, this.best);
    this.showBoard();
  }

  private showBoard(): void {
    this.ctx.venue().setBoard({
      names: ['Streak', 'Best'],
      score: [this.streak, this.best],
      serving: 0,
      call: '',
      status: 'PRACTICE · BALL MACHINE',
    });
  }

  onKey(code: string): void {
    if (code === 'Space' && this.phase !== 'waiting') diveTowardBall(this.focus, this.ctx.input.move(), this.ball.pos);
  }

  onSwing(intent: SwingIntent): void {
    if (!this.swing.manual) return;
    this.swing.start(intent, this.time);
    this.focus.swingAt(this.ball.pos.x);
  }

  get clock(): number {
    return this.time;
  }

  fixedUpdate(dt: number): void {
    applyArena(this.arena, this.time);
    this.time += dt;
    const move = this.ctx.input.move();
    this.focus.update(dt, move);
    this.machine.update(dt);

    if (this.phase === 'waiting') {
      this.timer -= dt;
      if (this.timer <= 0) this.feed();
      return;
    }

    this.events.length = 0;
    stepBall(this.ball, dt, this.events);
    for (const e of this.events) this.onBallEvent(e);
    this.phaseTime += dt;

    if (this.phase === 'incoming') {
      this.tryHit(move.x);
      if (this.phaseTime > RALLY_TIMEOUT) this.finish('Missed!', 'bad');
    } else if (this.phase === 'returned') {
      if (this.phaseTime > RALLY_TIMEOUT) this.finish(null);
    } else if (this.phase === 'done') {
      this.timer -= dt;
      if (this.timer <= 0) this.feed();
    }
  }

  private feed(): void {
    const type = pick<ShotType>([
      ['drive', 55],
      ['lob', 25],
      ['dink', 20],
    ]);
    const from = this.machine.muzzle();
    const plan = planShot({ type, from, aim: Math.random() * 2 - 1, direction: 1, pace: 0.7 });
    const sol = solveShot(from, plan.target, plan.flightTime, plan.spin);
    this.ball.pos = from;
    this.ball.vel = sol.vel;
    this.ball.spin = plan.spin;
    this.ctx.ballView.resetTrail();
    this.machine.fire();
    this.ctx.sound.hit('drive', from, 0.6);
    this.phase = 'incoming';
    this.phaseTime = 0;
    this.nearBounces = 0;
    this.prevHd = null;
  }

  private tryHit(aim: number): void {
    const b = this.ball.pos;
    const p = this.focus.position;
    if (b.z < 0.15 || isLettingGo(this.ctx.input)) {
      this.prevHd = null;
      return;
    }
    const hd = Math.hypot(b.x - p.x, b.z - p.z);
    const swing = this.swing.wants(this.time, hd, this.prevHd, b.y, this.ball.vel.y, this.nearBounces > 0);
    this.prevHd = hd <= REACH ? hd : null;
    if (!swing) return;

    const intent = this.swing.take();
    const aimPoint = this.ctx.aimPoint();
    const type = shotAtContact(aimPoint, b.y, intent.power);
    const v = this.ball.vel;
    const q = contactQuality(b, p, this.focus.speed, type === 'smash', Math.hypot(v.x, v.y, v.z));
    const from = cloneVec(b);
    const pace = shotPace(q) * chargePace(intent.charge);
    const plan = planShot({ type, from, aim, target: aimPoint ?? undefined, direction: -1, pace });
    applyShotError(plan, q, type);
    applyIntent(plan, type, intent, -1);
    const sol = solveShot(from, plan.target, plan.flightTime, plan.spin);
    this.ball.vel = sol.vel;
    this.ball.spin = plan.spin;
    this.lastShot = type;
    this.focus.swingAt(b.x);
    this.ctx.sound.hit(type, b);
    this.ctx.hud.rating(rateContact(q), type, intent);
    this.ctx.ballView.setTrailColor(shotInfo(type).color);
    this.phase = 'returned';
    this.phaseTime = 0;
  }

  private onBallEvent(e: BallEvent): void {
    if (e.type === 'bounce') this.ctx.sound.bounce(e.pos, Math.hypot(this.ball.vel.x, this.ball.vel.y, this.ball.vel.z));
    else this.ctx.sound.net(e.pos);
    if (this.phase === 'incoming') {
      if (e.type === 'bounce' && e.pos.z > 0) {
        if (++this.nearBounces >= 2) this.finish('Missed!', 'bad');
      } else if (e.type !== 'netcord') {
        // Machine feed failed (net or landed on its own side): no penalty.
        this.finish(null);
      }
    } else if (this.phase === 'returned') {
      if (e.type === 'net') {
        this.finish('Net!', 'bad');
      } else if (e.type === 'netcord') {
        this.ctx.hud.flash('Net cord!', 'info');
      } else if (e.pos.z >= 0) {
        this.finish('Net!', 'bad');
      } else if (Math.abs(e.pos.x) <= COURT.WIDTH / 2 + BALL.RADIUS && e.pos.z >= -COURT.LENGTH / 2 - BALL.RADIUS) {
        const msg =
          this.lastShot === 'dink' && e.pos.z > -COURT.KITCHEN
            ? 'Perfect dink!'
            : this.lastShot === 'smash'
              ? 'SMASH!'
              : this.lastShot === 'lob' && e.pos.z < -COURT.LENGTH / 2 + 2
                ? 'Deep lob!'
                : 'In!';
        this.finish(msg, 'good');
      } else {
        this.finish('Out!', 'bad');
      }
    }
  }

  private finish(msg: string | null, kind: FlashKind = 'info'): void {
    if (msg) {
      if (kind === 'good') {
        this.streak++;
        if (this.streak > this.best) {
          this.best = this.streak;
          try {
            localStorage.setItem(BEST_KEY, String(this.best));
          } catch {
            /* storage unavailable: best score just won't persist */
          }
        }
      } else if (kind === 'bad') {
        this.streak = 0;
      }
      this.ctx.hud.flash(msg, kind);
      this.ctx.hud.setStreak(this.streak, this.best);
      this.showBoard();
      if (kind === 'good') this.ctx.venue().excite(Math.min(0.6, 0.15 + this.streak * 0.04));
      if (kind !== 'info') this.ctx.sound.point(kind === 'good');
    }
    this.phase = 'done';
    this.timer = FEED_DELAY;
    this.machine.targetX = (Math.random() * 2 - 1) * 2;
  }

  frame(): FrameInfo {
    applyArena(this.arena, this.time);
    this.ctx.sound.setListener(this.focus.position.x, this.focus.position.z, 1);
    const landing = this.phase === 'incoming' && this.nearBounces === 0 ? predictFirstBounce(this.ball) : null;
    const p = this.ctx.aimPoint();
    const timeToContact =
      this.phase === 'incoming' && this.swing.manual
        ? predictContactTime(this.ball, this.focus.position, 1, this.nearBounces, false)
        : null;
    return {
      ballVisible: this.phase !== 'waiting',
      landing: landing && landing.z > 0 ? landing : null,
      followBall: this.phase === 'incoming',
      aim: p ? clampTarget(this.ctx.selectedShot(), p.x, p.z, -1) : null,
      timeToContact,
    };
  }

  dispose(): void {
    this.focus.dispose();
    this.machine.dispose();
  }
}
