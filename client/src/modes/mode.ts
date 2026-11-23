import type * as THREE from 'three';
import { HumanSwingState } from '@picklebros/shared';
import type { ArenaId, BallState, ShotType, SwingIntent, Vec3 } from '@picklebros/shared';
import type { Hud } from '../hud';
import type { Input } from '../input';
import type { Player } from '../entities/player';
import type { BallView } from '../entities/ballView';
import type { Sound } from '../audio/sound';
import type { Venue } from '../scene/venue';

// Shot rules for human players live in shared (the online server uses them too).
export {
  FULL_CHARGE_TIME,
  SPIN_LABEL,
  applyIntent,
  chargePace,
  predictContactTime,
  previewShot,
  readFlick,
  shotAtContact,
} from '@picklebros/shared';
export type { Spin, SwingIntent } from '@picklebros/shared';

export type SwingMode = 'auto' | 'manual';

export interface ModeContext {
  scene: THREE.Scene;
  input: Input;
  hud: Hud;
  ballView: BallView;
  sound: Sound;
  /** Audience, referee and stadium scoreboard of the current court. */
  venue(): Venue;
  /** The shot your aim currently selects (dink / drive / lob); smash is decided at contact. */
  selectedShot(): ShotType;
  /** Point on the ground under the mouse (locked while a click is held), or null without a mouse. */
  aimPoint(): Vec3 | null;
  swingMode(): SwingMode;
  /** Shake the camera (big hits). */
  shake(amount: number): void;
  restart(): void;
  exitToMenu(): void;
}

export interface FrameInfo {
  ballVisible: boolean;
  /** Where the incoming ball will bounce on your side, for the landing marker. */
  landing: Vec3 | null;
  followBall: boolean;
  /** Where the aim crosshair should sit (already clamped to a legal target), or null to hide it. */
  aim: Vec3 | null;
  /** Seconds until the ball reaches your sweet spot (drives the timing ring), or null. */
  timeToContact: number | null;
  /** Phantom Dink mid-flight: draw only the ball's shadow. */
  ghost?: boolean;
  /** Clone Rally: how far (m) the two decoy balls fly beside the real one. */
  decoy?: number;
}

export interface GameMode {
  readonly ball: BallState;
  /** The player the camera follows. */
  readonly focus: Player;
  /** Which end you play from: +1 = near (+z) end, -1 = far end (online, team 2). */
  readonly side: 1 | -1;
  /** The court being played on, and match time (drives the wind). */
  readonly arena: ArenaId;
  readonly clock: number;
  fixedUpdate(dt: number): void;
  frame(dt: number): FrameInfo;
  onKey(code: string): void;
  /** Click mode: a mouse button was released — swing now with this intent. */
  onSwing(intent: SwingIntent): void;
  dispose(): void;
}

export const isLettingGo = (input: Input) => input.isDown('ShiftLeft') || input.isDown('ShiftRight');

/** Holding the right mouse button makes an automatic hit a power shot (lob / smash). */
export const isPowerHeld = (input: Input) => input.isDown('MouseRight');

/** Space: dive in the direction you're moving, or sideways toward the ball if standing still. */
export function diveTowardBall(player: Player, move: { x: number; z: number }, ball: Vec3): void {
  if (move.x !== 0 || move.z !== 0) player.dive(move.x, move.z);
  else player.dive(Math.sign(ball.x - player.position.x) || 1, 0);
}

/** Practice mode's swing: the shared swing state plus this browser's settings. */
export class HumanSwing {
  private state = new HumanSwingState();

  constructor(private ctx: ModeContext) {}

  get manual(): boolean {
    return this.ctx.swingMode() === 'manual';
  }

  start(intent: SwingIntent, time: number): void {
    this.state.start(intent, time);
  }

  wants(time: number, hd: number, prevHd: number | null, ballY: number, ballVy: number, bounced: boolean): boolean {
    return this.state.wants(this.manual, time, hd, prevHd, ballY, ballVy, bounced);
  }

  take(): SwingIntent {
    return this.state.take(this.manual, isPowerHeld(this.ctx.input));
  }
}
