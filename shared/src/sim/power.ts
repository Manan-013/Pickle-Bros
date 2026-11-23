import type { ContactRating } from '../contact';
import type { Team } from '../rules';
import type { ShotType } from '../shots';

/**
 * Power Mode: a 3-bar meter, combos, special shots (1 bar) and a super (3 bars).
 * Rules live here so the browser and the online server agree.
 */

export type SpecialKind =
  | 'fire'
  | 'curve'
  | 'phantom'
  | 'freeze'
  | 'thunder'
  // Supers (one per character):
  | 'meteor'
  | 'clone'
  | 'quake'
  | 'blizzard';

export const isSuper = (k: SpecialKind) => k === 'meteor' || k === 'clone' || k === 'quake' || k === 'blizzard';
/** What the player has armed for their next hit: a special (E) or the super (Q). */
export type ArmKind = 'special' | 'super';

export const MAX_METER = 3;
export const SPECIAL_COST = 1;
export const SUPER_COST = 3;
/** Seconds between one player's specials. */
export const SPECIAL_COOLDOWN = 2;

export const SPECIAL_NAME: Record<SpecialKind, string> = {
  fire: 'FIRE SMASH',
  curve: 'CURVE DRIVE',
  phantom: 'PHANTOM DINK',
  freeze: 'FREEZE LOB',
  thunder: 'THUNDER SERVE',
  meteor: 'METEOR SMASH',
  clone: 'CLONE RALLY',
  quake: 'EARTHQUAKE',
  blizzard: 'BLIZZARD',
};

export const SPECIAL_COLOR: Record<SpecialKind, string> = {
  fire: '#ff6a1f',
  curve: '#c06bff',
  phantom: '#cfe6ff',
  freeze: '#7fe3ff',
  thunder: '#ffe14a',
  meteor: '#ff2d55',
  clone: '#ffd700',
  quake: '#b5651d',
  blizzard: '#e0f7ff',
};

/** The special a normal shot turns into when a special is armed. */
export const specialFor = (shot: ShotType): SpecialKind =>
  shot === 'smash' ? 'fire' : shot === 'dink' ? 'phantom' : shot === 'lob' ? 'freeze' : 'curve';

/** How much harder a special is to return (contact quality lost), unless it's blocked. */
export const INCOMING_PENALTY: Record<SpecialKind, number> = {
  fire: 0.4,
  curve: 0.3,
  phantom: 0.3,
  freeze: 0.2,
  thunder: 0.3,
  meteor: 0.5,
  clone: 0.45,
  quake: 0.4,
  blizzard: 0.3,
};

/** Clone Rally: two decoy balls fly beside the real one and merge into it at the bounce. */
export const CLONE_SPREAD = 1.4;
export function cloneOffset(fx: BallFx | null, time: number): number {
  if (!fx || fx.kind !== 'clone') return 0;
  const p = (time - fx.start) / fx.flight;
  return p > 0 && p < 1 ? CLONE_SPREAD * Math.sin(Math.PI * p) : 0;
}

/** Earthquake: when it lands the ball skids low and the other team is stunned. */
export const QUAKE_STUN_TIME = 0.8;
export const QUAKE_STUN_SPEED = 0.2;
/** Blizzard: the other team is frozen the moment it's hit. */
export const BLIZZARD_TIME = 2.2;

/** Contact at least this clean on a special blocks it (no penalty, +1 bar). */
export const BLOCK_QUALITY = 0.8;
export const BLOCK_REWARD = 1;

/** Freeze Lob: opponents move at this fraction of their speed for this long after it lands. */
export const FREEZE_TIME = 1.2;
export const FREEZE_SPEED = 0.5;

/** Meteor Smash: the whole court runs in slow motion for this long (real seconds). */
export const SLOWMO_TIME = 0.9;
export const SLOWMO_SCALE = 0.35;

/** Meter for a hit: clean contact fills most, combos and long rallies add more. */
export function meterGain(rating: ContactRating, combo: number, rallyHits: number): number {
  const base = rating === 'perfect' ? 0.18 : rating === 'good' ? 0.07 : 0.02;
  const comboBoost = 1 + 0.25 * Math.max(0, combo - 1);
  const rallyBonus = rallyHits > 6 ? 0.03 : 0;
  return base * comboBoost + rallyBonus;
}

/** Points change the meter a little: winners gain, losers drop. */
export const POINT_WIN_GAIN = 0.15;
export const POINT_LOSS = 0.15;

/** Combos also speed shots up a little (up to +16%). */
export const comboPace = (combo: number) => 1 + 0.04 * Math.min(Math.max(0, combo - 1), 4);

/** Effect riding on the ball in flight (for drawing and for blocks). */
export interface BallFx {
  kind: SpecialKind;
  /** Team that hit it. */
  team: Team;
  /** Match time it was hit. */
  start: number;
  /** Expected flight time to the first bounce. */
  flight: number;
}

/** Phantom Dink: the ball is invisible for the middle of its flight (its shadow still shows). */
export function phantomHidden(fx: BallFx | null, time: number): boolean {
  if (!fx || fx.kind !== 'phantom') return false;
  const p = (time - fx.start) / fx.flight;
  return p > 0.2 && p < 0.85;
}
