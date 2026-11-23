import * as THREE from 'three';
import { BALL, BallState, SPECIAL_COLOR, SpecialKind, Vec3 } from '@picklebros/shared';

/** Drawn a little larger than a real ball so it reads well on screen. */
const VISUAL_RADIUS = 0.055;
const TRAIL_POINTS = 22;
const DEFAULT_TRAIL = '#faffb0';

export class BallView {
  private mesh: THREE.Mesh;
  private shadow: THREE.Mesh;
  private trail: THREE.Line;
  private trailPositions = new Float32Array(TRAIL_POINTS * 3);
  private trailCount = 0;
  private marker: THREE.Mesh;
  private markerPulse = 0;
  private fx: SpecialKind | null = null;
  private fxClock = 0;
  /** A soft glow around the ball while a special is in flight. */
  private glow: THREE.Mesh;
  /** Clone Rally decoys (look exactly like the real ball). */
  private decoys: THREE.Mesh[] = [];

  constructor(scene: THREE.Scene) {
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(VISUAL_RADIUS, 20, 14),
      new THREE.MeshStandardMaterial({ color: 0xe6f53c, emissive: 0x3a4000, roughness: 0.45 }),
    );
    this.mesh.castShadow = true;
    scene.add(this.mesh);

    this.glow = new THREE.Mesh(
      new THREE.SphereGeometry(VISUAL_RADIUS * 2.6, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    scene.add(this.glow);
    for (let i = 0; i < 2; i++) {
      const d = new THREE.Mesh(this.mesh.geometry, this.mesh.material);
      d.visible = false;
      d.castShadow = true;
      scene.add(d);
      this.decoys.push(d);
    }

    // Blob shadow straight below the ball helps judge height.
    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.08, 20),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    scene.add(this.shadow);

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.trailPositions, 3));
    this.trail = new THREE.Line(
      g,
      new THREE.LineBasicMaterial({ color: DEFAULT_TRAIL, transparent: true, opacity: 0.55 }),
    );
    this.trail.frustumCulled = false;
    scene.add(this.trail);

    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(0.13, 0.19, 32),
      new THREE.MeshBasicMaterial({ color: 0xfff35c, transparent: true, opacity: 0.85, depthWrite: false }),
    );
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.position.y = 0.008;
    scene.add(this.marker);
  }

  resetTrail(): void {
    this.trailCount = 0;
    this.setTrailColor(DEFAULT_TRAIL);
    this.setFx(null);
  }

  /** Special in flight: colours the ball, trail and glow (null = a normal ball). */
  setFx(kind: SpecialKind | null): void {
    if (kind === this.fx) return;
    this.fx = kind;
    const mat = this.mesh.material as THREE.MeshStandardMaterial;
    if (kind) {
      const c = new THREE.Color(SPECIAL_COLOR[kind]);
      mat.color.copy(c);
      mat.emissive.copy(c).multiplyScalar(0.8);
      this.setTrailColor(SPECIAL_COLOR[kind]);
      (this.glow.material as THREE.MeshBasicMaterial).color.copy(c);
    } else {
      mat.color.set(0xe6f53c);
      mat.emissive.set(0x3a4000);
    }
    const s = kind === 'meteor' ? 1.7 : kind === 'fire' ? 1.25 : 1;
    this.mesh.scale.setScalar(s);
  }

  /** Tints the trail so each shot type is easy to tell apart in flight. */
  setTrailColor(color: string): void {
    const m = this.trail.material as THREE.LineBasicMaterial;
    m.color.set(color);
    m.opacity = color === DEFAULT_TRAIL ? 0.55 : 0.9;
  }

  /** `ghost` = Phantom Dink mid-flight: ball and trail vanish, only the shadow gives it away. */
  update(dt: number, ball: BallState, visible: boolean, landing: Vec3 | null, ghost = false, decoy = 0): void {
    const p = ball.pos;
    this.shadow.visible = visible;
    this.mesh.visible = this.trail.visible = visible && !ghost;
    this.mesh.position.set(p.x, p.y + (VISUAL_RADIUS - BALL.RADIUS), p.z);

    // Clone Rally: decoys fly either side of the real ball (sideways to its path) and merge at the bounce.
    const hv = Math.hypot(ball.vel.x, ball.vel.z) || 1;
    const px = -ball.vel.z / hv;
    const pz = ball.vel.x / hv;
    this.decoys.forEach((d, i) => {
      d.visible = visible && decoy > 0.05;
      const s = (i === 0 ? 1 : -1) * decoy;
      d.position.set(this.mesh.position.x + px * s, this.mesh.position.y + Math.abs(s) * 0.15, this.mesh.position.z + pz * s);
      d.scale.copy(this.mesh.scale);
    });

    // Glow pulses around a special (the "tell"); Thunder flickers like lightning.
    this.fxClock += dt;
    const glowMat = this.glow.material as THREE.MeshBasicMaterial;
    const flicker = this.fx === 'thunder' ? (Math.sin(this.fxClock * 60) > 0 ? 1 : 0.3) : 1;
    glowMat.opacity = this.fx && visible && !ghost ? (0.35 + Math.sin(this.fxClock * 12) * 0.1) * flicker : 0;
    this.glow.position.copy(this.mesh.position);
    this.glow.scale.setScalar(this.fx === 'meteor' ? 1.8 : 1);

    this.shadow.position.set(p.x, 0.006, p.z);
    const h = Math.max(0, p.y);
    const s = 1 + h * 0.35;
    this.shadow.scale.set(s, s, s);
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = Math.max(0.08, 0.4 - h * 0.1);

    // Trail: shift and append.
    if (visible) {
      this.trailPositions.copyWithin(3, 0, (TRAIL_POINTS - 1) * 3);
      this.trailPositions[0] = this.mesh.position.x;
      this.trailPositions[1] = this.mesh.position.y;
      this.trailPositions[2] = this.mesh.position.z;
      this.trailCount = Math.min(TRAIL_POINTS, this.trailCount + 1);
      this.trail.geometry.setDrawRange(0, this.trailCount);
      this.trail.geometry.attributes.position.needsUpdate = true;
    }

    this.marker.visible = landing !== null;
    if (landing) {
      this.markerPulse += dt * 6;
      const m = 1 + Math.sin(this.markerPulse) * 0.12;
      this.marker.position.x = landing.x;
      this.marker.position.z = landing.z;
      this.marker.scale.set(m, m, m);
    }
  }
}
