import { BALL, GRAVITY } from './constants';
import { physicsEnv } from './physics';

/**
 * Courts ("arenas"): each looks different and changes the physics a little.
 * Shared so the online server plays every court exactly like the browser does.
 */

export type ArenaId = 'park' | 'beach' | 'ice' | 'space' | 'rooftop';

export interface ArenaInfo {
  id: ArenaId;
  name: string;
  /** What's different here, for the menu and the match intro. */
  twist: string;
  gravity: number;
  /** Air drag multiplier. */
  drag: number;
  /** Fraction of vertical speed kept on a bounce. */
  restitution: number;
  /** Fraction of horizontal speed kept on a bounce. */
  friction: number;
  /** Player run speed multiplier (footing). */
  runSpeed: number;
  /** Player acceleration multiplier (low = slippery). */
  grip: number;
  /** Peak wind (m/s² sideways push on the ball); 0 = still air. */
  wind: number;
}

export const ARENAS: ArenaInfo[] = [
  {
    id: 'park',
    name: 'Park',
    twist: 'Classic outdoor court',
    gravity: GRAVITY,
    drag: 1,
    restitution: BALL.RESTITUTION,
    friction: BALL.GROUND_FRICTION,
    runSpeed: 1,
    grip: 1,
    wind: 0,
  },
  {
    id: 'beach',
    name: 'Beach',
    twist: 'Wind pushes the ball · sand slows you, low bounces',
    gravity: GRAVITY,
    drag: 1,
    restitution: 0.55,
    friction: 0.72,
    runSpeed: 0.88,
    grip: 0.8,
    wind: 1.0,
  },
  {
    id: 'ice',
    name: 'Ice Rink',
    twist: 'You slide · the ball skids on bounces',
    gravity: GRAVITY,
    drag: 1,
    restitution: 0.62,
    friction: 0.95,
    runSpeed: 1.05,
    grip: 0.4,
    wind: 0,
  },
  {
    id: 'space',
    name: 'Space Station',
    twist: 'Low gravity · floaty, high arcs',
    gravity: 5.2,
    drag: 0.6,
    restitution: 0.74,
    friction: 0.84,
    runSpeed: 1,
    grip: 0.9,
    wind: 0,
  },
  {
    id: 'rooftop',
    name: 'Neon Rooftop',
    twist: 'Night court in the city',
    gravity: GRAVITY,
    drag: 1,
    restitution: BALL.RESTITUTION,
    friction: BALL.GROUND_FRICTION,
    runSpeed: 1,
    grip: 1,
    wind: 0,
  },
];

export const ARENA_IDS = ARENAS.map((a) => a.id);
export const arenaInfo = (id: string | null | undefined): ArenaInfo => ARENAS.find((a) => a.id === id) ?? ARENAS[0];
export const isArenaId = (id: unknown): id is ArenaId => typeof id === 'string' && (ARENA_IDS as string[]).includes(id);

/**
 * The wind right now (beach): mostly across the court, slowly changing strength and direction.
 * A pure function of match time, so every browser and the server agree.
 */
export function windAt(arena: ArenaInfo, time: number): { x: number; z: number } {
  if (!arena.wind) return { x: 0, z: 0 };
  const across = Math.sin(time * 0.21) * 0.75 + Math.sin(time * 0.53 + 1.3) * 0.25;
  const along = Math.sin(time * 0.17 + 2.1) * 0.3;
  return { x: arena.wind * across, z: arena.wind * along };
}

/** Set the ball physics for this court at this moment (call before simulating or predicting). */
export function applyArena(id: ArenaId, time: number): void {
  const a = arenaInfo(id);
  physicsEnv.gravity = a.gravity;
  physicsEnv.drag = a.drag;
  physicsEnv.restitution = a.restitution;
  physicsEnv.friction = a.friction;
  physicsEnv.wind = windAt(a, time);
}
