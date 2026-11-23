/** All units are metres / seconds / radians. x = across court, y = up, z = along court; net at z = 0. */
export const COURT = {
  WIDTH: 6.096, // 20 ft
  LENGTH: 13.411, // 44 ft
  KITCHEN: 2.134, // 7 ft non-volley zone, measured from the net
  LINE_WIDTH: 0.0508, // 2 in
  NET_SIDE_HEIGHT: 0.914, // 36 in at the posts
  NET_CENTER_HEIGHT: 0.864, // 34 in at the centre
  POST_OFFSET: 0.3048, // posts 12 in outside the sidelines
} as const;

export const NET_HALF_SPAN = COURT.WIDTH / 2 + COURT.POST_OFFSET;

export const BALL = {
  RADIUS: 0.037,
  /** Fraction of vertical speed kept on a bounce. */
  RESTITUTION: 0.68,
  /** Fraction of horizontal speed kept on a bounce. */
  GROUND_FRICTION: 0.82,
  /** Quadratic drag: a = -DRAG_K * |v| * v. Pickleballs (holes) are draggy. */
  DRAG_K: 0.05,
  /** Magnus: a = MAGNUS_K * (spin x v). */
  MAGNUS_K: 0.003,
  /** How much topspin kicks the ball forward on a bounce (m/s per rad/s). */
  SPIN_KICK: 0.01,
} as const;

export const GRAVITY = 9.81;
export const PHYSICS_DT = 1 / 120;

/** Height of the top of the net at a given x (linear sag from posts to centre). */
export function netHeightAt(x: number): number {
  const t = Math.min(Math.abs(x) / NET_HALF_SPAN, 1);
  return COURT.NET_CENTER_HEIGHT + (COURT.NET_SIDE_HEIGHT - COURT.NET_CENTER_HEIGHT) * t;
}
