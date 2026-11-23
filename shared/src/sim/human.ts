import { COURT, PHYSICS_DT } from '../constants';
import { IDEAL_REACH, REACH, shouldSwing } from '../contact';
import { BallEvent, BallState, cloneBall, stepBall } from '../physics';
import { ShotPlan, ShotType, canSmash } from '../shots';
import { Vec3 } from '../vec';

/** How a human player's controls turn into shots. Shared so the server judges hits the same way. */

// ------------------------------------------------------------------ which shot

/** Aiming this far past the net or closer plays a dink; deeper plays a drive. */
export const DINK_ZONE = COURT.KITCHEN + 0.6;

/** `d` = travel direction of your shots (-1 for the near team, +1 for the far team). */
const placementShot = (aim: Vec3 | null, d: 1 | -1): ShotType => (aim && aim.z * d <= DINK_ZONE ? 'dink' : 'drive');

/** The shot your controls select right now, before contact (for the crosshair and shot bar). */
export const previewShot = (aim: Vec3 | null, power: boolean, d: 1 | -1 = -1): ShotType =>
  power ? 'lob' : placementShot(aim, d);

/**
 * The shot actually played at contact. Normal hit: dink or drive by aim.
 * Power hit (right click): smash if the ball is above head height, otherwise a lob.
 */
export function shotAtContact(aim: Vec3 | null, ballY: number, power: boolean, d: 1 | -1 = -1): ShotType {
  if (power) return canSmash(ballY) ? 'smash' : 'lob';
  return placementShot(aim, d);
}

// ------------------------------------------------------------------ swing intent (charge + spin)

export type Spin = 'top' | 'slice' | 'left' | 'right';

/** What the player asked for with a click: power shot or not, how long it was charged, any spin. */
export interface SwingIntent {
  power: boolean;
  /** Seconds held / FULL_CHARGE_TIME: 0 = tap, 1 = full power, above 1 = overcharged. */
  charge: number;
  spin: Spin | null;
}

/** Holding a click this long gives full power. */
export const FULL_CHARGE_TIME = 0.7;
/** Auto swing hits at a medium pace with no spin. */
export const AUTO_CHARGE = 0.45;

/** Tap = soft touch (0.8x pace), full charge = 1.25x pace. */
export const chargePace = (charge: number) => 0.8 + 0.45 * Math.min(charge, 1);

/** Holding too long makes the shot wild: up to ~1.6 m of extra scatter. */
export const overchargeError = (charge: number) => Math.max(0, Math.min(charge, 1.8) - 1) * 2;

/** A quick mouse movement during the hold, read at release. Small movements are ignored. */
export function readFlick(f: { dx: number; dy: number }): Spin | null {
  if (Math.hypot(f.dx, f.dy) < 35) return null;
  if (Math.abs(f.dy) >= Math.abs(f.dx)) return f.dy < 0 ? 'top' : 'slice';
  return f.dx > 0 ? 'right' : 'left';
}

export const SPIN_LABEL: Record<Spin, string> = { top: 'TOPSPIN', slice: 'SLICE', left: 'CURVE ←', right: 'CURVE →' };

/**
 * Applies charge and spin to a planned shot. `d` is the travel direction (-1 = toward the far side).
 * The shot solver accounts for spin, so the ball still lands on target — spin changes the flight
 * (dip, float, curve) and the bounce (topspin kicks on, slice skids).
 */
export function applyIntent(
  plan: ShotPlan,
  type: ShotType,
  intent: SwingIntent,
  d: 1 | -1,
  rand: () => number = Math.random,
): void {
  const wild = overchargeError(intent.charge);
  if (wild > 0) {
    const r = wild * Math.sqrt(rand());
    const a = rand() * Math.PI * 2;
    plan.target.x += Math.cos(a) * r;
    plan.target.z += Math.sin(a) * r;
  }
  // A hard shot from waist height only stays in with topspin pulling it down, so on drives and
  // smashes more charge also means more topspin (tap ≈ flat and floaty, full ≈ heavy topspin).
  // Without this the arc needed to clear the net would cancel out the extra power.
  let topspin = plan.spin.x * d;
  if (type === 'drive' || type === 'smash') topspin += 110 * Math.min(intent.charge, 1) - 20;
  plan.spin.x = d * topspin;
  switch (intent.spin) {
    case 'top':
      plan.spin.x = d * (topspin + 50);
      break;
    case 'slice':
      plan.spin.x = -d * 45;
      break;
    case 'left':
    case 'right': {
      const side = intent.spin === 'right' ? 1 : -1;
      // Strong sidespin so the bend is easy to see (~0.4 m on a drive); Magnus pushes toward `side`.
      plan.spin.y = side * d * 150;
      break;
    }
  }
}

// ------------------------------------------------------------------ swing timing

/** After a release, the hit happens at the best moment inside this window. */
export const SWING_WINDOW = 0.3;

/** A human's swing: auto, or click mode with a timed window after each release. */
export class HumanSwingState {
  private until = -1;
  private intent: SwingIntent = { power: false, charge: AUTO_CHARGE, spin: null };

  /** Click mode: the button was released, start the swing window. */
  start(intent: SwingIntent, time: number, window = SWING_WINDOW): void {
    this.intent = intent;
    this.until = time + window;
  }

  reset(): void {
    this.until = -1;
  }

  /**
   * Whether to hit now. Auto: at the best moment. Click mode: at the best moment inside the window;
   * release too early and the window closes before the ball arrives, too late and it has passed.
   */
  wants(manual: boolean, time: number, hd: number, prevHd: number | null, ballY: number, ballVy: number, bounced: boolean): boolean {
    const best = shouldSwing(hd, prevHd, ballY, ballVy, bounced);
    if (!manual) return best;
    if (time > this.until) return false;
    const lastChance = this.until - time < 0.02 && hd <= REACH && ballY >= 0.04 && ballY <= 2.6;
    return best || lastChance;
  }

  /** The intent for the hit happening now (consumes the click). */
  take(manual: boolean, powerHeld: boolean): SwingIntent {
    this.until = -1;
    if (manual) return this.intent;
    return { power: powerHeld, charge: AUTO_CHARGE, spin: null };
  }
}

/**
 * Seconds until the ball reaches the player's sweet spot (an arm's length away), following the
 * real flight including bounces. Null if it won't come within reach in `maxTime` (or hits the net,
 * or bounces twice first). `side` = the player's team sign; `mustBounce` = two-bounce rule.
 */
export function predictContactTime(
  ball: BallState,
  player: { x: number; z: number },
  side: 1 | -1,
  bouncesSoFar: number,
  mustBounce: boolean,
  maxTime = 1.5,
): number | null {
  const s = cloneBall(ball);
  const events: BallEvent[] = [];
  let bounces = bouncesSoFar;
  for (let t = 0; t < maxTime; t += PHYSICS_DT) {
    stepBall(s, PHYSICS_DT, events);
    for (const e of events) {
      if (e.type === 'net') return null;
      if (e.type === 'bounce' && ++bounces >= 2) return null;
    }
    events.length = 0;
    if (mustBounce && bounces === 0) continue;
    if (s.pos.z * side < 0.15 || s.pos.y < 0.04 || s.pos.y > 2.6) continue;
    if (Math.hypot(s.pos.x - player.x, s.pos.z - player.z) <= IDEAL_REACH + 0.1) return t;
  }
  return null;
}
