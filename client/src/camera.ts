import * as THREE from 'three';
import { Vec3 } from '@picklebros/shared';

/** Third-person camera behind and above the player, looking down the court, leaning toward the ball. */
export class FollowCamera {
  readonly camera: THREE.PerspectiveCamera;
  private lookAt = new THREE.Vector3();
  private desired = new THREE.Vector3();
  private desiredLook = new THREE.Vector3();
  private shakeAmount = 0;
  private shakeClock = 0;
  /** The shake applied this frame (taken off again next frame). */
  private shakeOffset = new THREE.Vector3();

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(55, aspect, 0.05, 200);
    this.camera.position.set(0, 3.4, 11);
    this.lookAt.set(0, 0.6, 0);
  }

  /** Shake the view (big hits, Meteor Smash). Strength ~0.05 (bump) to 0.3 (huge). */
  shake(amount: number): void {
    this.shakeAmount = Math.max(this.shakeAmount, amount);
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    // Narrow (portrait) screens need a wider vertical view to see the court.
    this.camera.fov = aspect < 1 ? 72 : 55;
    this.camera.updateProjectionMatrix();
  }

  /** `side` = which end you play from (+1 near / -1 far): the camera always sits behind you. */
  update(dt: number, player: THREE.Vector3, ball: Vec3, followBall: boolean, side: 1 | -1 = 1): void {
    // Remove last frame's shake first, so shaking never drifts the camera away.
    this.camera.position.sub(this.shakeOffset);
    this.shakeOffset.set(0, 0, 0);
    this.desired.set(player.x * 0.7, 3.3, player.z + side * 5.0);
    const lean = followBall ? (ball.x - player.x) * 0.18 : 0;
    this.desiredLook.set(player.x * 0.45 + lean, 0.6, player.z - side * 6);
    // Switching ends (e.g. joining online on the far team): jump rather than swing through the net.
    if (Math.sign(this.camera.position.z - player.z) !== side) {
      this.camera.position.copy(this.desired);
      this.lookAt.copy(this.desiredLook);
    }
    const k = 1 - Math.exp(-6 * dt);
    this.camera.position.lerp(this.desired, k);
    this.lookAt.lerp(this.desiredLook, k);
    this.camera.lookAt(this.lookAt);
    if (this.shakeAmount > 0.001) {
      this.shakeClock += dt;
      const a = this.shakeAmount;
      this.shakeOffset.set(Math.sin(this.shakeClock * 71) * a, Math.sin(this.shakeClock * 57 + 1) * a * 0.7, 0);
      this.camera.position.add(this.shakeOffset);
      this.shakeAmount *= Math.exp(-7 * dt);
    }
  }
}
