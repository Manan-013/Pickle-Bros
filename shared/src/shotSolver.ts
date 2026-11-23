import { BALL, NET_HALF_SPAN, PHYSICS_DT, netHeightAt } from './constants';
import { integrate, physicsEnv } from './physics';
import { Vec3, cloneVec } from './vec';

export interface ShotSolution {
  vel: Vec3;
  flightTime: number;
  /** Gap between the bottom of the ball and the net tape (Infinity if it never crosses). */
  netClearance: number;
}

function simulateFree(from: Vec3, vel: Vec3, spin: Vec3, T: number) {
  const b = { pos: cloneVec(from), vel: cloneVec(vel), spin: cloneVec(spin) };
  const steps = Math.max(1, Math.round(T / PHYSICS_DT));
  const dt = T / steps;
  let clearance = Infinity;
  for (let i = 0; i < steps; i++) {
    const px = b.pos.x;
    const py = b.pos.y;
    const pz = b.pos.z;
    integrate(b, dt);
    if (clearance === Infinity && pz > 0 !== b.pos.z > 0 && pz !== b.pos.z) {
      const f = pz / (pz - b.pos.z);
      const nx = px + (b.pos.x - px) * f;
      const ny = py + (b.pos.y - py) * f;
      if (Math.abs(nx) <= NET_HALF_SPAN) clearance = ny - BALL.RADIUS - netHeightAt(nx);
    }
  }
  return { end: b.pos, clearance };
}

/**
 * Finds the launch velocity that lands the ball on `target` (x/z; y is ignored) after
 * `flightTime` seconds, accounting for gravity, drag and spin on this court. If the ball would not
 * clear the net, the flight time is stretched (higher arc) until it does.
 *
 * Players aim as if the air were still, so on a windy court the wind really pushes shots off target.
 */
export function solveShot(
  from: Vec3,
  target: Vec3,
  flightTime: number,
  spin: Vec3,
  netMargin = 0.1,
  maxFlightTime = 3.5,
): ShotSolution {
  const windWas = physicsEnv.windOn;
  physicsEnv.windOn = false;
  try {
    return solveInStillAir(from, target, flightTime, spin, netMargin, maxFlightTime);
  } finally {
    physicsEnv.windOn = windWas;
  }
}

function solveInStillAir(
  from: Vec3,
  target: Vec3,
  flightTime: number,
  spin: Vec3,
  netMargin: number,
  maxFlightTime: number,
): ShotSolution {
  const ty = BALL.RADIUS;
  let T = flightTime;
  for (;;) {
    const v = {
      x: (target.x - from.x) / T,
      y: (ty - from.y + 0.5 * physicsEnv.gravity * T * T) / T,
      z: (target.z - from.z) / T,
    };
    for (let i = 0; i < 8; i++) {
      const { end } = simulateFree(from, v, spin, T);
      v.x += (target.x - end.x) / T;
      v.y += (ty - end.y) / T;
      v.z += (target.z - end.z) / T;
    }
    const { clearance } = simulateFree(from, v, spin, T);
    if (clearance >= netMargin || T >= maxFlightTime) {
      return { vel: v, flightTime: T, netClearance: clearance };
    }
    T += 0.05;
  }
}
