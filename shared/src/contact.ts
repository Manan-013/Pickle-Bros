import { ShotPlan, ShotType } from './shots';
import { Vec3 } from './vec';

/** Horizontal distance from a player's centre at which they can still reach the ball. */
export const REACH = 1.2;
/** Ideal horizontal distance (arm + paddle length, ball beside the body). */
export const IDEAL_REACH = 0.55;
export const MAX_RUN_SPEED = 5.2;

export type ContactRating = 'perfect' | 'good' | 'stretch';

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * 0..1 quality of contact: best when the ball is an arm's length away, between knee and
 * shoulder height (overhead for smashes), and the player is set rather than sprinting.
 */
export function contactQuality(
  ball: Vec3,
  player: Vec3,
  playerSpeed: number,
  overhead = false,
  incomingSpeed = 0,
): number {
  const hd = Math.hypot(ball.x - player.x, ball.z - player.z);
  const distPen = Math.max(0, Math.abs(hd - IDEAL_REACH) - 0.12) / 0.55;
  const y = ball.y;
  const low = y < 0.35 ? (0.35 - y) / 0.3 : 0;
  const high = !overhead && y > 1.5 ? (y - 1.5) / 0.8 : 0;
  const movePen = (playerSpeed / MAX_RUN_SPEED) * 0.35;
  // A hard-hit ball is harder to control, so attacking shots force errors.
  const fastPen = Math.max(0, incomingSpeed - 10) * 0.03;
  return clamp01(1 - distPen - low - high - movePen - fastPen);
}

export function rateContact(q: number): ContactRating {
  return q >= 0.75 ? 'perfect' : q >= 0.4 ? 'good' : 'stretch';
}

/** Better contact = faster ball. */
export const shotPace = (q: number) => 0.85 + 0.25 * q;

const ERROR_SCALE: Record<ShotType, number> = { drive: 1, dink: 1, lob: 1.1, smash: 0.9 };

/** Scatters the landing target; poor contact can push the ball long or wide. Mutates `plan`. */
export function applyShotError(plan: ShotPlan, q: number, type: ShotType, rand: () => number = Math.random): void {
  const r = (1 - q) * 1.5 * ERROR_SCALE[type] * Math.sqrt(rand());
  const a = rand() * Math.PI * 2;
  plan.target.x += Math.cos(a) * r;
  plan.target.z += Math.sin(a) * r;
}

/**
 * Auto-swing trigger. Swings when the ball is in the sweet spot, when it has passed its closest
 * point to the player, or as a last chance before it bounces a second time.
 */
export function shouldSwing(hd: number, prevHd: number | null, ballY: number, ballVy: number, bounced: boolean): boolean {
  if (hd > REACH || ballY > 2.6 || ballY < 0.04) return false;
  if (hd <= IDEAL_REACH + 0.1) return true;
  if (prevHd !== null && hd > prevHd + 1e-4) return true;
  return bounced && ballY < 0.2 && ballVy < 0;
}
