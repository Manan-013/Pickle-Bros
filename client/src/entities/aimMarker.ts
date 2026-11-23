import * as THREE from 'three';
import { Vec3 } from '@picklebros/shared';

/** Crosshair on the opponent's court showing where your next shot is aimed. */
export class AimMarker {
  private group = new THREE.Group();
  private material: THREE.MeshBasicMaterial;
  private pulse = 0;

  constructor(scene: THREE.Scene) {
    this.material = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.28, 40), this.material);
    ring.rotation.x = -Math.PI / 2;
    this.group.add(ring);
    for (let i = 0; i < 4; i++) {
      const tick = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.16), this.material);
      tick.rotation.x = -Math.PI / 2;
      const a = (i * Math.PI) / 2;
      tick.position.set(Math.cos(a) * 0.38, 0, Math.sin(a) * 0.38);
      tick.rotation.z = a + Math.PI / 2;
      this.group.add(tick);
    }
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.045, 16), this.material);
    dot.rotation.x = -Math.PI / 2;
    this.group.add(dot);
    // White outline so the crosshair reads on any court colour.
    const outline = new THREE.Mesh(
      new THREE.RingGeometry(0.28, 0.32, 40),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false }),
    );
    outline.rotation.x = -Math.PI / 2;
    this.group.add(outline);
    this.group.position.y = 0.01;
    this.group.visible = false;
    scene.add(this.group);
  }

  update(dt: number, target: Vec3 | null, color: string): void {
    this.group.visible = target !== null;
    if (!target) return;
    this.material.color.set(color);
    this.group.position.x = target.x;
    this.group.position.z = target.z;
    this.pulse += dt * 4;
    // Drawn ~1.8x real size so it stays visible at the far end of the court.
    const s = 1.8 * (1 + Math.sin(this.pulse) * 0.06);
    this.group.scale.set(s, 1, s);
  }
}
