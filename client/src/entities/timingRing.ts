import * as THREE from 'three';
import { SWING_WINDOW } from '@picklebros/shared';

const TARGET_RADIUS = 0.75;
/** How fast the outer ring closes in (m per second of time-to-contact). */
const SHRINK = 3.2;
const GREEN = new THREE.Color('#5ee38a');
const WHITE = new THREE.Color('#ffffff');

/**
 * Two rings on the court around your player. The outer ring closes in as the ball approaches and
 * turns green while releasing the click would hit the ball; it meets the inner ring at the ideal
 * moment to release.
 */
export class TimingRing {
  private group = new THREE.Group();
  private target: THREE.Mesh;
  private closing: THREE.Mesh;
  private closingMat: THREE.MeshBasicMaterial;

  constructor(scene: THREE.Scene) {
    this.target = new THREE.Mesh(
      new THREE.RingGeometry(TARGET_RADIUS - 0.03, TARGET_RADIUS, 48),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, depthWrite: false }),
    );
    this.closingMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false });
    this.closing = new THREE.Mesh(new THREE.RingGeometry(0.94, 1, 48), this.closingMat);
    for (const m of [this.target, this.closing]) {
      m.rotation.x = -Math.PI / 2;
      this.group.add(m);
    }
    this.group.position.y = 0.012;
    this.group.visible = false;
    scene.add(this.group);
  }

  /** `t` = seconds until the ball reaches the sweet spot, or null to hide. */
  update(player: THREE.Vector3, t: number | null): void {
    const show = t !== null && t < 1.4;
    this.group.visible = show;
    if (!show || t === null) return;
    this.group.position.x = player.x;
    this.group.position.z = player.z;
    // Meets the inner ring in the middle of the swing window.
    const r = Math.max(0.25, TARGET_RADIUS + (t - SWING_WINDOW / 2) * SHRINK);
    this.closing.scale.set(r, r, 1);
    const releaseNow = t <= SWING_WINDOW;
    this.closingMat.color.copy(releaseNow ? GREEN : WHITE);
    this.closingMat.opacity = releaseNow ? 1 : 0.75;
  }
}
