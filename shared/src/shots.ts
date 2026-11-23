import { COURT } from './constants';
import { Vec3, v3 } from './vec';

export type ShotType = 'drive' | 'dink' | 'lob' | 'smash';

export interface ShotRequest {
  type: ShotType;
  from: Vec3;
  /** -1 (left) .. 1 (right), along the x axis. */
  aim: number;
  /** Which way the ball travels: -1 toward the far (-z) side, 1 toward the near (+z) side. */
  direction: 1 | -1;
  /** Speed multiplier; < 1 for softer feeds / easier AI. */
  pace?: number;
  rand?: () => number;
  /** Where the hitter is aiming (e.g. the mouse). Overrides `aim`; clamped to what the shot type allows. */
  target?: { x: number; z: number };
}

/** How far past the net (m) each shot type can land: dinks stay short, lobs go deep. */
export const SHOT_DEPTH: Record<ShotType, [number, number]> = {
  drive: [3.0, COURT.LENGTH / 2 - 0.5],
  dink: [0.6, COURT.KITCHEN + 0.6],
  lob: [COURT.LENGTH / 2 - 3, COURT.LENGTH / 2 - 0.4],
  smash: [1.5, COURT.LENGTH / 2 - 0.6],
};

/** Clamps an aim point to the opponent's court and to the depth range of the shot type. */
export function clampTarget(type: ShotType, x: number, z: number, direction: 1 | -1): Vec3 {
  const [lo, hi] = SHOT_DEPTH[type];
  const depth = clamp(z * direction, lo, hi);
  return v3(clamp(x, -MAX_X, MAX_X), 0, direction * depth);
}

export interface ShotPlan {
  target: Vec3;
  flightTime: number;
  spin: Vec3;
}

/** Smashes need the ball to be above roughly head height. */
export const SMASH_MIN_HEIGHT = 1.3;
export const canSmash = (ballHeight: number) => ballHeight >= SMASH_MIN_HEIGHT;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const MAX_X = COURT.WIDTH / 2 - 0.3;

/** Turns a high-level shot choice into a landing target, flight time and spin. */
export function planShot(req: ShotRequest): ShotPlan {
  const rand = req.rand ?? Math.random;
  const pace = req.pace ?? 1;
  const d = req.direction;
  const half = COURT.LENGTH / 2;
  let depth: number;
  let xSpread: number;
  let topspin: number;
  let flightTime: number;

  switch (req.type) {
    case 'drive':
      depth = half - 1.0 - rand() * 0.8;
      xSpread = 2.3;
      topspin = 30;
      break;
    case 'dink':
      depth = 0.7 + rand() * 1.1;
      xSpread = 2.2;
      topspin = -8;
      break;
    case 'lob':
      depth = half - 0.7 - rand() * 0.5;
      xSpread = 2.2;
      topspin = 12;
      break;
    case 'smash':
      depth = 2.6 + rand() * 2.4;
      xSpread = 2.5;
      topspin = 20;
      break;
  }

  const target = req.target
    ? clampTarget(req.type, req.target.x, req.target.z, d)
    : v3(clamp(req.aim * xSpread, -MAX_X, MAX_X), 0, d * depth);
  const dist = Math.hypot(target.x - req.from.x, target.z - req.from.z);

  switch (req.type) {
    case 'drive':
      flightTime = clamp(dist / (17 * pace), 0.45, 1.6);
      break;
    case 'dink':
      flightTime = (0.85 + dist * 0.04) / pace;
      break;
    case 'lob':
      flightTime = (2.0 + rand() * 0.2) / Math.sqrt(pace);
      break;
    case 'smash':
      flightTime = clamp(dist / (24 * pace), 0.3, 0.9);
      break;
  }

  // Topspin around the x axis has the sign of the travel direction (see physics.ts).
  return { target, flightTime, spin: v3(d * topspin, 0, 0) };
}
