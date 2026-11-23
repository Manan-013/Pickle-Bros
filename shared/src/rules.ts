import { BALL, COURT } from './constants';
import { Vec3 } from './vec';

/** Team 0 plays the +z half (near the default camera), team 1 the -z half. */
export type Team = 0 | 1;
export type Format = 'singles' | 'doubles';
export type CourtSide = 'right' | 'left';
export type Slot = 0 | 1;

export const other = (t: Team): Team => (t === 0 ? 1 : 0);
export const teamSign = (t: Team): 1 | -1 => (t === 0 ? 1 : -1);
export const teamOfZ = (z: number): Team => (z > 0 ? 0 : 1);

export interface MatchState {
  format: Format;
  pointsToWin: number;
  winBy: number;
  score: [number, number];
  servingTeam: Team;
  /** Doubles: 1st or 2nd server of the serving team. Always 1 in singles. */
  serverNumber: 1 | 2;
  /** Which player of the serving team is serving (always 0 in singles). */
  serverSlot: Slot;
  /** Doubles: which player of each team is standing in that team's right service court. */
  rightSlot: [Slot, Slot];
  winner: Team | null;
}

export function createMatch(format: Format, firstServingTeam: Team = 0, pointsToWin = 11, winBy = 2): MatchState {
  return {
    format,
    pointsToWin,
    winBy,
    score: [0, 0],
    servingTeam: firstServingTeam,
    // Doubles starts at "0-0-2": the first serving team only gets one server.
    serverNumber: format === 'doubles' ? 2 : 1,
    serverSlot: 0,
    rightSlot: [0, 0],
    winner: null,
  };
}

/** Which service court the serve is made from (and into, diagonally). */
export function serveSide(s: MatchState): CourtSide {
  if (s.format === 'singles') return s.score[s.servingTeam] % 2 === 0 ? 'right' : 'left';
  return s.serverSlot === s.rightSlot[s.servingTeam] ? 'right' : 'left';
}

/** Which service court a given player stands in (doubles), or follows the serve side (singles). */
export function slotSide(s: MatchState, team: Team, slot: Slot): CourtSide {
  if (s.format === 'singles') return serveSide(s);
  return s.rightSlot[team] === slot ? 'right' : 'left';
}

/** The receiving player: the one in the same-named court, diagonally opposite the server. */
export function receiverSlot(s: MatchState): Slot {
  if (s.format === 'singles') return 0;
  const recv = other(s.servingTeam);
  return serveSide(s) === 'right' ? s.rightSlot[recv] : ((1 - s.rightSlot[recv]) as Slot);
}

export interface RallyOutcome {
  point: boolean;
  sideOut: boolean;
  secondServer: boolean;
}

/** Applies the result of a rally (side-out scoring: only the serving team scores). Mutates `s`. */
export function applyRally(s: MatchState, winner: Team): RallyOutcome {
  const out: RallyOutcome = { point: false, sideOut: false, secondServer: false };
  if (s.winner !== null) return out;
  const serving = s.servingTeam;
  if (winner === serving) {
    s.score[serving]++;
    out.point = true;
    // In doubles the server swaps courts with their partner after winning a point.
    if (s.format === 'doubles') s.rightSlot[serving] = (1 - s.rightSlot[serving]) as Slot;
    const opp = other(serving);
    if (s.score[serving] >= s.pointsToWin && s.score[serving] - s.score[opp] >= s.winBy) s.winner = serving;
  } else if (s.format === 'doubles' && s.serverNumber === 1) {
    s.serverNumber = 2;
    s.serverSlot = (1 - s.serverSlot) as Slot;
    out.secondServer = true;
  } else {
    s.servingTeam = other(serving);
    s.serverNumber = 1;
    s.serverSlot = s.format === 'doubles' ? s.rightSlot[s.servingTeam] : 0;
    out.sideOut = true;
  }
  return out;
}

/** "Server score - receiver score" (singles) or "... - server number" (doubles). */
export function scoreCall(s: MatchState): string {
  const a = s.score[s.servingTeam];
  const b = s.score[other(s.servingTeam)];
  return s.format === 'doubles' ? `${a}-${b}-${s.serverNumber}` : `${a}-${b}`;
}

/** x of the centre of a team's right or left service court (players face the net). */
export function courtX(team: Team, side: CourtSide): number {
  const right = team === 0 ? 1 : -1; // team 0 faces -z, so its right is +x
  return (side === 'right' ? right : -right) * (COURT.WIDTH / 4);
}

/** Ball contact inside a team's half of the court (lines are in). */
export function inCourtHalf(p: Vec3, team: Team): boolean {
  const R = BALL.RADIUS;
  if (Math.abs(p.x) > COURT.WIDTH / 2 + R) return false;
  return team === 0 ? p.z > 0 && p.z <= COURT.LENGTH / 2 + R : p.z < 0 && p.z >= -COURT.LENGTH / 2 - R;
}

/** Inside a service court: beyond the kitchen line (the line itself is a fault), correct half. */
export function inServiceBox(p: Vec3, team: Team, side: CourtSide): boolean {
  if (!inCourtHalf(p, team) || Math.abs(p.z) <= COURT.KITCHEN) return false;
  const sign = Math.sign(courtX(team, side));
  return p.x * sign >= -COURT.LINE_WIDTH / 2;
}
