import { COURT } from '../constants';
import { MAX_RUN_SPEED } from '../contact';
import { Team, teamSign } from '../rules';

const ACCEL = 12;
const DIVE_SPEED = 8.5;
const DIVE_TIME = 0.28;
/** After a dive the player is on the ground and can't move for this long. */
const DIVE_RECOVERY = 0.5;

/** A player's movement on the court (no graphics). Used by the client, the server and the AI. */
export class PlayerBody {
  x = 0;
  z = 0;
  vx = 0;
  vz = 0;
  diveX = 0;
  diveZ = 0;
  private diveClock = 0;
  private recoverClock = 0;
  readonly sign: 1 | -1;
  /** Character run speed multiplier. */
  speedScale = 1;
  /** Court footing: run speed and grip (low grip = sliding, e.g. ice). */
  footSpeed = 1;
  grip = 1;
  private readonly minX = -COURT.WIDTH / 2 - 2;
  private readonly maxX = COURT.WIDTH / 2 + 2;
  private readonly minZ: number;
  private readonly maxZ: number;

  constructor(readonly team: Team) {
    this.sign = teamSign(team);
    const near = 0.35;
    const far = COURT.LENGTH / 2 + 3;
    this.minZ = this.sign > 0 ? near : -far;
    this.maxZ = this.sign > 0 ? far : -near;
  }

  get speed(): number {
    return Math.hypot(this.vx, this.vz);
  }

  /** Diving or getting up from a dive. */
  get diving(): boolean {
    return this.diveClock > 0 || this.recoverClock > 0;
  }

  get canDive(): boolean {
    return !this.diving;
  }

  teleport(x: number, z: number): void {
    this.x = x;
    this.z = z;
    this.vx = this.vz = 0;
    this.diveClock = this.recoverClock = 0;
  }

  /** Lunge in a direction for a last-ditch reach, then lie on the ground briefly. */
  dive(dx: number, dz: number): void {
    const len = Math.hypot(dx, dz);
    if (!this.canDive || len === 0) return;
    this.diveX = dx / len;
    this.diveZ = dz / len;
    this.diveClock = DIVE_TIME;
  }

  /** `move` is in world space (x right, z toward the near baseline), length <= 1. */
  update(dt: number, move: { x: number; z: number }): void {
    if (this.diveClock > 0) {
      this.vx = this.diveX * DIVE_SPEED;
      this.vz = this.diveZ * DIVE_SPEED;
      if ((this.diveClock -= dt) <= 0) this.recoverClock = DIVE_RECOVERY;
    } else if (this.recoverClock > 0) {
      const f = Math.exp(-10 * dt);
      this.vx *= f;
      this.vz *= f;
      this.recoverClock -= dt;
    } else {
      const k = 1 - Math.exp(-ACCEL * this.grip * dt);
      const top = MAX_RUN_SPEED * this.speedScale * this.footSpeed;
      this.vx += (move.x * top - this.vx) * k;
      this.vz += (move.z * top - this.vz) * k;
    }
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this.clamp();
  }

  /**
   * Position reported by a remote client (online play: each player moves themselves).
   * Kept inside the player's own area and to a believable speed.
   */
  setRemote(x: number, z: number, vx: number, vz: number, dt: number): void {
    const maxStep = DIVE_SPEED * dt * 1.5 + 0.05;
    const dx = x - this.x;
    const dz = z - this.z;
    const d = Math.hypot(dx, dz);
    const f = d > maxStep ? maxStep / d : 1;
    this.x += dx * f;
    this.z += dz * f;
    const s = Math.hypot(vx, vz);
    const vf = s > DIVE_SPEED ? DIVE_SPEED / s : 1;
    this.vx = vx * vf;
    this.vz = vz * vf;
    this.clamp();
  }

  /** Show another player exactly as the server reports (online; no physics). */
  applyRemote(x: number, z: number, vx: number, vz: number, diving: boolean, diveX: number, diveZ: number): void {
    this.x = x;
    this.z = z;
    this.vx = vx;
    this.vz = vz;
    this.diveX = diveX;
    this.diveZ = diveZ;
    this.diveClock = 0;
    this.recoverClock = diving ? 0.05 : 0;
  }

  private clamp(): void {
    this.x = Math.max(this.minX, Math.min(this.maxX, this.x));
    this.z = Math.max(this.minZ, Math.min(this.maxZ, this.z));
  }
}
