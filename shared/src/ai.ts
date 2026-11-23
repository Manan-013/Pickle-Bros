import { COURT, PHYSICS_DT } from './constants';
import { BallEvent, BallState, cloneBall, stepBall } from './physics';
import { Format, Team, teamSign } from './rules';
import { ShotType, canSmash } from './shots';
import { Vec3, v3 } from './vec';

/**
 * Computer player decisions: which shot to play and where, where to stand, where to serve.
 * Pure functions of a snapshot of the court, so the online server can run the same AI.
 */

export type Difficulty = 'easy' | 'medium' | 'hard';

export interface BotSkill {
  /** Seconds before reacting to a new shot. */
  reaction: number;
  /** Fraction of full running speed. */
  speed: number;
  /** How far off (m) the bot misjudges where to stand. */
  positionError: number;
  /** Contact quality is scaled by a random factor in [1 - this, 1] (more = more errors). */
  sloppiness: number;
  /** Chance of correctly letting a ball that is going out drop. */
  readsOut: number;
  /** Chance of aiming for open court (otherwise a random spot). */
  gapAim: number;
  /** Chance of speeding up a medium-height ball instead of dinking. */
  aggression: number;
  /** Chance of a drop shot into the kitchen when opponents are at the net. */
  dropRate: number;
  /** Chance of a lob over opponents at the net. */
  lobRate: number;
  /** Chance of smashing a ball above head height. */
  smashRate: number;
  /** How far from the net (m) the bot stands once it has moved forward. */
  netDepth: number;
  /** Overall shot pace multiplier. */
  pace: number;
  /** Power Mode: chance of spending a bar on a special when one is available. */
  specialRate: number;
}

export const BOT_SKILLS: Record<Difficulty, BotSkill> = {
  easy: {
    reaction: 0.45,
    speed: 0.6,
    positionError: 0.9,
    sloppiness: 0.65,
    readsOut: 0.5,
    gapAim: 0.25,
    aggression: 0.12,
    dropRate: 0.15,
    lobRate: 0.06,
    smashRate: 0.45,
    netDepth: 4.2,
    pace: 0.8,
    specialRate: 0.1,
  },
  medium: {
    reaction: 0.3,
    speed: 0.78,
    positionError: 0.6,
    sloppiness: 0.45,
    readsOut: 0.82,
    gapAim: 0.6,
    aggression: 0.4,
    dropRate: 0.45,
    lobRate: 0.08,
    smashRate: 0.8,
    netDepth: COURT.KITCHEN + 0.6,
    pace: 0.95,
    specialRate: 0.22,
  },
  hard: {
    reaction: 0.15,
    speed: 0.95,
    positionError: 0.22,
    sloppiness: 0.12,
    readsOut: 0.96,
    gapAim: 0.85,
    aggression: 0.55,
    dropRate: 0.7,
    lobRate: 0.1,
    smashRate: 0.95,
    netDepth: COURT.KITCHEN + 0.3,
    pace: 1.05,
    specialRate: 0.35,
  },
};

const HALF = COURT.LENGTH / 2;
const K = COURT.KITCHEN;
const EDGE = COURT.WIDTH / 2 - 0.35;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** The x across the opponents' court that is furthest from any opponent (or random, by skill). */
function pickGapX(opponents: Vec3[], s: BotSkill, rand: () => number): number {
  if (rand() > s.gapAim || opponents.length === 0) return (rand() * 2 - 1) * EDGE;
  let best = 0;
  let bestGap = -1;
  for (let x = -EDGE; x <= EDGE + 1e-6; x += 0.4) {
    const gap = Math.min(...opponents.map((o) => Math.abs(o.x - x))) + rand() * 0.3;
    if (gap > bestGap) {
      bestGap = gap;
      best = x;
    }
  }
  return best;
}

export interface BotShotView {
  /** The bot's own position. */
  me: Vec3;
  team: Team;
  opponents: Vec3[];
  /** Where the ball is being hit from. */
  ball: Vec3;
  /** Hits so far in this rally, not counting this one (1 = this is the return of serve). */
  hits: number;
}

export interface BotShot {
  type: ShotType;
  /** World-space landing target on the opponents' side. */
  target: Vec3;
}

/**
 * Picks a shot like a club player would: deep return, third-shot drop, patient dinks at the net,
 * and attack anything that sits up high (at the gap or at an opponent's feet).
 */
export function chooseBotShot(v: BotShotView, s: BotSkill, rand: () => number): BotShot {
  const dir = -teamSign(v.team); // z sign of the opponents' side
  const at = (x: number, depth: number) => v3(clamp(x, -EDGE, EDGE), 0, dir * clamp(depth, 0.6, HALF - 0.4));
  const gap = () => pickGapX(v.opponents, s, rand);
  const feet = () => {
    const o = v.opponents[Math.floor(rand() * v.opponents.length)] ?? v3();
    return at(o.x + (rand() - 0.5) * 0.6, Math.abs(o.z) - 0.3);
  };
  const y = v.ball.y;
  const myDepth = Math.abs(v.me.z);
  const oppAtNet = v.opponents.length > 0 && v.opponents.every((o) => Math.abs(o.z) < K + 1.3);
  const crossX = () => -(Math.sign(v.me.x) || (rand() < 0.5 ? 1 : -1)) * (0.6 + rand() * 1.7);

  // Put-aways: a ball above head height gets smashed, one that sits up gets driven.
  if (canSmash(y) && rand() < s.smashRate) return { type: 'smash', target: rand() < 0.5 ? feet() : at(gap(), 2.5 + rand() * 3) };
  if (y > 1.15 && rand() < s.aggression + 0.3) {
    return { type: 'drive', target: rand() < 0.5 ? feet() : at(gap(), HALF - 1.2) };
  }

  // Return of serve: deep and safe, then move up.
  if (v.hits === 1) return { type: 'drive', target: at(gap() * 0.6, HALF - 1.0 - rand() * 1.2) };

  // Third shot: drop it into the kitchen if the returners have come to the net.
  if (v.hits === 2) {
    if (oppAtNet && rand() < s.dropRate) return { type: 'dink', target: at(gap() * 0.8, 0.9 + rand() * 1.0) };
    return { type: 'drive', target: rand() < 0.5 ? feet() : at(gap(), HALF - 1.0) };
  }

  // At the net: dink crosscourt, attack anything above net height, the odd lob.
  if (myDepth < K + 1.2) {
    if (y > 0.9 && rand() < s.aggression + 0.25) return { type: 'drive', target: feet() };
    if (oppAtNet && rand() < s.lobRate) return { type: 'lob', target: at(gap(), HALF - 0.8) };
    return { type: 'dink', target: at(crossX(), 0.8 + rand() * 1.1) };
  }

  // From the back: against net players drop, lob or drive at the feet; otherwise drive deep.
  if (oppAtNet) {
    const r = rand();
    if (r < s.dropRate) return { type: 'dink', target: at(gap() * 0.8, 0.9 + rand() * 1.0) };
    if (r < s.dropRate + s.lobRate * 2) return { type: 'lob', target: at(gap(), HALF - 0.8) };
    return { type: 'drive', target: feet() };
  }
  return { type: 'drive', target: at(gap(), HALF - 1.0 - rand() * 1.5) };
}

export interface BotReadyView {
  team: Team;
  format: Format;
  servingTeam: Team;
  /** Hits so far in this rally. */
  hits: number;
  /** x of the centre of this player's half (doubles), from courtX(). */
  sideX: number;
  ballX: number;
}

/**
 * Where to wait when the ball isn't coming to you. Both teams start back; the serving team must
 * stay back until the third shot (two-bounce rule), the returners come in after the return, then
 * everyone works up to the kitchen line. Doubles partners hold their halves and shift with the ball.
 */
export function botReadyPosition(v: BotReadyView, s: BotSkill): Vec3 {
  const sign = teamSign(v.team);
  const serving = v.team === v.servingTeam;
  const stayBack = serving ? v.hits < 3 : v.hits < 2;
  const depth = stayBack ? HALF - 0.4 : s.netDepth;
  if (v.format === 'singles') return v3(v.ballX * 0.45, 0, sign * depth);
  const home = v.sideX * 0.75;
  return v3(home + (v.ballX - home) * 0.25, 0, sign * depth);
}

/**
 * Where to stand to volley the ball out of the air at the kitchen line, or null if it won't pass
 * at a volleyable height near the net. Follows the real flight (drag, spin) until the first
 * bounce. Returns a spot outside the kitchen, an arm's length from the ball's path.
 */
export function findVolleySpot(ball: BallState, team: Team, from: Vec3): Vec3 | null {
  const sign = teamSign(team);
  const s = cloneBall(ball);
  const events: BallEvent[] = [];
  for (let t = 0; t < 3; t += PHYSICS_DT) {
    stepBall(s, PHYSICS_DT, events);
    if (events.length) return null; // bounced or hit the net first
    const depth = s.pos.z * sign;
    if (depth >= K + 0.25 && depth <= K + 2.2 && s.pos.y >= 0.45 && s.pos.y <= 1.9) {
      // Stand beside the ball's path on the side we're coming from.
      const side = Math.sign(from.x - s.pos.x) || 1;
      return v3(s.pos.x + side * 0.45, 0, sign * Math.max(depth, K + 0.2));
    }
  }
  return null;
}

/** A serve target in the service box centred on `boxX`, deep, toward the receiver's side. */
export function chooseBotServe(boxX: number, receiverSign: 1 | -1, s: BotSkill, rand: () => number): Vec3 {
  const halfW = COURT.WIDTH / 4 - 0.4;
  const x = boxX + (rand() * 2 - 1) * halfW * (0.5 + s.gapAim * 0.5);
  const depth = HALF - 0.6 - rand() * 2.4 * (1 - s.gapAim * 0.6);
  return v3(x, 0, receiverSign * depth);
}
