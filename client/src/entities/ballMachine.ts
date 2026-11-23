import * as THREE from 'three';
import { COURT, Vec3, v3 } from '@picklebros/shared';

/** Ball machine on the far side that feeds practice balls. Slides along the baseline. */
export class BallMachine {
  readonly group = new THREE.Group();
  targetX = 0;
  private barrel: THREE.Group;
  private recoil = 0;
  private readonly z = -COURT.LENGTH / 2 - 0.4;

  dispose(): void {
    this.scene.remove(this.group);
  }

  constructor(private scene: THREE.Scene) {
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 0.5, 0.6),
      new THREE.MeshStandardMaterial({ color: 0xf2a33a, roughness: 0.6 }),
    );
    body.position.y = 0.45;
    this.group.add(body);
    const legs = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 0.2, 8),
      new THREE.MeshStandardMaterial({ color: 0x333333 }),
    );
    legs.position.y = 0.1;
    this.group.add(legs);
    const hopper = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.2, 0.3, 16, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x2b2f36, side: THREE.DoubleSide }),
    );
    hopper.position.y = 0.85;
    this.group.add(hopper);

    this.barrel = new THREE.Group();
    this.barrel.position.set(0, 0.6, 0.25);
    const tube = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.07, 0.35, 14),
      new THREE.MeshStandardMaterial({ color: 0x2b2f36, metalness: 0.5, roughness: 0.4 }),
    );
    tube.rotation.x = Math.PI / 2 - 0.35;
    tube.position.z = 0.15;
    this.barrel.add(tube);
    this.group.add(this.barrel);

    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true;
    });
    this.group.position.set(0, 0, this.z);
    scene.add(this.group);
  }

  /** Where balls leave the machine. */
  muzzle(): Vec3 {
    return v3(this.group.position.x, 0.75, this.z + 0.6);
  }

  fire(): void {
    this.recoil = 1;
  }

  update(dt: number): void {
    this.group.position.x += (this.targetX - this.group.position.x) * (1 - Math.exp(-5 * dt));
    this.recoil = Math.max(0, this.recoil - dt * 6);
    this.barrel.position.z = 0.25 - this.recoil * 0.08;
  }
}
