import { BALL, GRAVITY, NET_HALF_SPAN, PHYSICS_DT, netHeightAt } from './constants';
import { Vec3, cloneVec, v3 } from './vec';

export interface BallState {
  pos: Vec3;
  vel: Vec3;
  /** Angular velocity (rad/s). Topspin for a ball travelling -z is negative x. */
  spin: Vec3;
}

export type BallEvent =
  | { type: 'bounce'; pos: Vec3 }
  | { type: 'net'; pos: Vec3 }
  | { type: 'netcord'; pos: Vec3 };

export const createBall = (): BallState => ({ pos: v3(0, BALL.RADIUS, 0), vel: v3(), spin: v3() });

/**
 * The court's physics (gravity, drag, bounce, wind). Set by applyArena() before simulating;
 * defaults are the standard outdoor court. `windOn` lets the shot solver plan as if the air were
 * still, so wind really does push shots off target.
 */
export const physicsEnv = {
  gravity: GRAVITY,
  drag: 1,
  restitution: BALL.RESTITUTION as number,
  friction: BALL.GROUND_FRICTION as number,
  wind: { x: 0, z: 0 },
  windOn: true,
};

export const cloneBall = (b: BallState): BallState => ({
  pos: cloneVec(b.pos),
  vel: cloneVec(b.vel),
  spin: cloneVec(b.spin),
});

/** Free flight only: gravity, drag, Magnus. Semi-implicit Euler. */
export function integrate(b: BallState, dt: number): void {
  const v = b.vel;
  const w = b.spin;
  const speed = Math.hypot(v.x, v.y, v.z);
  const env = physicsEnv;
  const k = BALL.DRAG_K * env.drag * speed;
  const m = BALL.MAGNUS_K;
  const wx = env.windOn ? env.wind.x : 0;
  const wz = env.windOn ? env.wind.z : 0;
  const ax = -k * v.x + m * (w.y * v.z - w.z * v.y) + wx;
  const ay = -env.gravity - k * v.y + m * (w.z * v.x - w.x * v.z);
  const az = -k * v.z + m * (w.x * v.y - w.y * v.x) + wz;
  v.x += ax * dt;
  v.y += ay * dt;
  v.z += az * dt;
  b.pos.x += v.x * dt;
  b.pos.y += v.y * dt;
  b.pos.z += v.z * dt;
}

const scaleSpin = (b: BallState, s: number) => {
  b.spin.x *= s;
  b.spin.y *= s;
  b.spin.z *= s;
};

/** One fixed physics step including net and ground collisions. Deterministic. */
export function stepBall(b: BallState, dt: number = PHYSICS_DT, events?: BallEvent[]): void {
  const R = BALL.RADIUS;
  const px = b.pos.x;
  const py = b.pos.y;
  const pz = b.pos.z;
  integrate(b, dt);

  // Net: did the ball cross the z = 0 plane this step?
  if (pz > 0 !== b.pos.z > 0 && pz !== b.pos.z) {
    const f = pz / (pz - b.pos.z);
    const nx = px + (b.pos.x - px) * f;
    const ny = py + (b.pos.y - py) * f;
    if (Math.abs(nx) <= NET_HALF_SPAN) {
      const h = netHeightAt(nx);
      if (ny - R < h) {
        if (ny < h - R * 0.2) {
          // Into the net: stop and drop on the hitter's side.
          const side = pz > 0 ? 1 : -1;
          b.pos.x = nx;
          b.pos.y = Math.max(ny, R);
          b.pos.z = side * R * 1.05;
          b.vel.z = -b.vel.z * 0.12;
          b.vel.x *= 0.4;
          b.vel.y *= 0.4;
          scaleSpin(b, 0.2);
          events?.push({ type: 'net', pos: cloneVec(b.pos) });
        } else {
          // Clipped the tape: slows down and pops up, but carries on.
          b.vel.z *= 0.55;
          b.vel.x *= 0.8;
          b.vel.y = Math.abs(b.vel.y) * 0.4 + 0.8;
          events?.push({ type: 'netcord', pos: cloneVec(b.pos) });
        }
      }
    }
  }

  // Ground.
  if (b.pos.y < R) {
    b.pos.y = R;
    if (b.vel.y < 0) {
      const impact = -b.vel.y;
      if (impact > 0.4) {
        events?.push({ type: 'bounce', pos: cloneVec(b.pos) });
        b.vel.y = impact * physicsEnv.restitution;
        b.vel.x *= physicsEnv.friction;
        b.vel.z = b.vel.z * physicsEnv.friction + b.spin.x * BALL.SPIN_KICK;
        scaleSpin(b, 0.5);
      } else {
        b.vel.y = 0;
      }
    }
    if (b.vel.y === 0) {
      const f = Math.max(0, 1 - 2 * dt);
      b.vel.x *= f;
      b.vel.z *= f;
    }
  }
}

/** Where the ball will first touch the ground, or null if it hits the net first. */
export function predictFirstBounce(b: BallState, maxTime = 4): Vec3 | null {
  const s = cloneBall(b);
  const events: BallEvent[] = [];
  const steps = Math.ceil(maxTime / PHYSICS_DT);
  for (let i = 0; i < steps; i++) {
    stepBall(s, PHYSICS_DT, events);
    for (const e of events) {
      if (e.type === 'bounce') return e.pos;
      if (e.type === 'net') return null;
    }
    events.length = 0;
  }
  return null;
}
