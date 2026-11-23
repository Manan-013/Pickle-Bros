import * as THREE from 'three';
import { COURT, NET_HALF_SPAN, netHeightAt } from '@picklebros/shared';

function meshTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const g = c.getContext('2d')!;
  g.strokeStyle = 'rgba(20,20,24,0.95)';
  g.lineWidth = 2;
  g.strokeRect(0, 0, 16, 16);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Net with posts, sagging mesh, tape, and centre strap. Shape matches netHeightAt(). */
export function buildNet(parent: THREE.Object3D, tapeColor = 0xffffff, glowingTape = false): void {
  const span = NET_HALF_SPAN;
  const group = new THREE.Group();

  // Mesh: a plane whose top edge follows the sag.
  const geo = new THREE.PlaneGeometry(span * 2, 1, 32, 1);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    pos.setY(i, pos.getY(i) > 0 ? netHeightAt(x) : 0.03);
  }
  pos.needsUpdate = true;
  const tex = meshTexture();
  tex.repeat.set((span * 2) / 0.045, 0.9 / 0.045);
  const net = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false }),
  );
  group.add(net);

  // Tape along the top.
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 24; i++) {
    const x = -span + (2 * span * i) / 24;
    pts.push(new THREE.Vector3(x, netHeightAt(x) - 0.02, 0));
  }
  const tape = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.025, 6, false),
    glowingTape ? new THREE.MeshBasicMaterial({ color: tapeColor }) : new THREE.MeshStandardMaterial({ color: tapeColor, roughness: 0.6 }),
  );
  tape.castShadow = true;
  group.add(tape);

  // Centre strap.
  const strap = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, COURT.NET_CENTER_HEIGHT, 0.01),
    new THREE.MeshStandardMaterial({ color: 0xffffff }),
  );
  strap.position.y = COURT.NET_CENTER_HEIGHT / 2;
  group.add(strap);

  // Posts.
  const postMat = new THREE.MeshStandardMaterial({ color: 0x2b2f36, metalness: 0.5, roughness: 0.4 });
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, COURT.NET_SIDE_HEIGHT + 0.06, 12), postMat);
    post.position.set(side * span, (COURT.NET_SIDE_HEIGHT + 0.06) / 2, 0);
    post.castShadow = true;
    group.add(post);
  }

  parent.add(group);
}
