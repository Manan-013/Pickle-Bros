import * as THREE from 'three';
import { ArenaId, COURT } from '@picklebros/shared';
import { buildNet } from './net';
import { SAND_EDGE_Z, buildOcean } from './ocean';

/**
 * The 3D surroundings for each court: sky, lights, ground, court colours, fences and scenery
 * (ocean and palms, ice rink boards, stars and a planet, a night city). Purely visual: the
 * gameplay differences live in shared/src/arenas.ts.
 */

export const APRON = { WIDTH: COURT.WIDTH + 4, LENGTH: COURT.LENGTH + 7 };

interface Palette {
  sky: number;
  fogNear: number;
  fogFar: number;
  hemi: [number, number, number]; // sky colour, ground colour, intensity
  sun: [number, number]; // colour, intensity
  ground: number;
  apron: number;
  court: number;
  kitchen: number;
  lines: number;
  /** Lines and net tape glow (night / space courts). */
  neon: boolean;
  /** Shiny surface (ice). */
  gloss: boolean;
  fence: 'chain' | 'none' | 'boards' | 'glass';
}

const PALETTES: Record<ArenaId, Palette> = {
  park: {
    sky: 0x9fd3f5, fogNear: 35, fogFar: 90, hemi: [0xdff1ff, 0x4a6b3a, 1.1], sun: [0xfff4e0, 2.2],
    ground: 0x5a9445, apron: 0x3d7a52, court: 0x2f6db5, kitchen: 0x4f93d6, lines: 0xf5f7fa,
    neon: false, gloss: false, fence: 'chain',
  },
  beach: {
    sky: 0xbfe6ff, fogNear: 60, fogFar: 160, hemi: [0xffffff, 0xd8c08a, 1.15], sun: [0xfff0d0, 2.5],
    ground: 0xe8d3a2, apron: 0xe2c992, court: 0xd8b97c, kitchen: 0xcca868, lines: 0x1f4e8c,
    neon: false, gloss: false, fence: 'none',
  },
  ice: {
    sky: 0x1d2633, fogNear: 30, fogFar: 70, hemi: [0xe8f3ff, 0x40506a, 1.3], sun: [0xffffff, 1.6],
    ground: 0x2a2f38, apron: 0xe4f1fb, court: 0xd2e8f8, kitchen: 0xb9d8f0, lines: 0xd63a3a,
    neon: false, gloss: true, fence: 'boards',
  },
  space: {
    sky: 0x04050d, fogNear: 80, fogFar: 260, hemi: [0x8899ff, 0x111122, 0.7], sun: [0xffffff, 1.7],
    ground: 0x1b1f2a, apron: 0x232838, court: 0x101a33, kitchen: 0x1a2a52, lines: 0x4ff6ff,
    neon: true, gloss: false, fence: 'glass',
  },
  rooftop: {
    sky: 0x150c2b, fogNear: 45, fogFar: 140, hemi: [0x9a7bff, 0x1a1026, 0.75], sun: [0x8fa4ff, 1.0],
    ground: 0x2b2b33, apron: 0x2f2540, court: 0x1d1240, kitchen: 0x2c1a5e, lines: 0xff4fd8,
    neon: true, gloss: false, fence: 'chain',
  },
};

export interface ArenaScene {
  readonly id: ArenaId;
  readonly group: THREE.Group;
  /** Animate scenery (waves, flags, twinkling). `wind` drives the beach flags. */
  update(dt: number, time: number, wind: { x: number; z: number }): void;
  dispose(): void;
}

// ------------------------------------------------------------------ helpers

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function surface(color: number, p: Palette): THREE.Material {
  return p.gloss
    ? new THREE.MeshStandardMaterial({ color, roughness: 0.12, metalness: 0.05 })
    : new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
}

function flat(w: number, l: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, l), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y, z);
  m.receiveShadow = true;
  return m;
}

function lights(g: THREE.Group, p: Palette): void {
  g.add(new THREE.HemisphereLight(p.hemi[0], p.hemi[1], p.hemi[2]));
  const sun = new THREE.DirectionalLight(p.sun[0], p.sun[1]);
  sun.position.set(7, 14, 5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const s = sun.shadow.camera;
  s.left = -12;
  s.right = 12;
  s.top = 14;
  s.bottom = -14;
  s.near = 1;
  s.far = 40;
  sun.shadow.bias = -0.0005;
  g.add(sun);
}

/** Regulation court: apron, playing surface, kitchens, and lines. */
function court(g: THREE.Group, p: Palette): void {
  const { WIDTH: W, LENGTH: L, KITCHEN: K, LINE_WIDTH: LW } = COURT;
  const half = L / 2;
  // Ground. On the beach the sand stops at the shore so the sea can show.
  const groundMat = new THREE.MeshStandardMaterial({ color: p.ground, roughness: 1 });
  if (p.fence === 'none') {
    const back = SAND_EDGE_Z;
    g.add(flat(400, 200 - back, groundMat, 0, -0.01, (200 + back) / 2));
  } else {
    g.add(flat(160, 160, groundMat, 0, -0.01, 0));
  }
  g.add(flat(APRON.WIDTH, APRON.LENGTH, surface(p.apron, p), 0, 0, 0));
  g.add(flat(W, L, surface(p.court, p), 0, 0.002, 0));
  g.add(flat(W, K, surface(p.kitchen, p), 0, 0.003, -K / 2));
  g.add(flat(W, K, surface(p.kitchen, p), 0, 0.003, K / 2));
  const lineMat = p.neon ? new THREE.MeshBasicMaterial({ color: p.lines }) : surface(p.lines, p);
  const line = (w: number, l: number, x: number, z: number) => g.add(flat(w, l, lineMat, x, 0.004, z));
  line(LW, L, -(W / 2 - LW / 2), 0);
  line(LW, L, W / 2 - LW / 2, 0);
  line(W, LW, 0, -(half - LW / 2));
  line(W, LW, 0, half - LW / 2);
  line(W, LW, 0, -(K - LW / 2));
  line(W, LW, 0, K - LW / 2);
  const cl = half - K;
  line(LW, cl, 0, -(K + cl / 2));
  line(LW, cl, 0, K + cl / 2);
}

/** Fence or walls on the two sides and the far end (never behind the near camera). */
function fence(g: THREE.Group, p: Palette): void {
  if (p.fence === 'none') return;
  const hw = APRON.WIDTH / 2;
  const hl = APRON.LENGTH / 2;
  const sides: [number, number, number, number][] = [
    [APRON.WIDTH, 0, -hl, 0],
    [APRON.LENGTH, -hw, 0, Math.PI / 2],
    [APRON.LENGTH, hw, 0, Math.PI / 2],
  ];
  if (p.fence === 'boards') {
    // Ice rink boards: white walls with a blue rail, all the way round.
    sides.push([APRON.WIDTH, 0, hl, 0]);
    const wall = new THREE.MeshStandardMaterial({ color: 0xf4f7fb, roughness: 0.5 });
    const rail = new THREE.MeshStandardMaterial({ color: 0x2a5bd7, roughness: 0.4 });
    for (const [w, x, z, ry] of sides) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, 1.05, 0.12), wall);
      b.position.set(x, 0.52, z);
      b.rotation.y = ry;
      b.castShadow = b.receiveShadow = true;
      g.add(b);
      const r = new THREE.Mesh(new THREE.BoxGeometry(w, 0.08, 0.16), rail);
      r.position.set(x, 1.08, z);
      r.rotation.y = ry;
      g.add(r);
    }
    return;
  }
  const height = p.fence === 'glass' ? 1.2 : 3;
  const panelMat =
    p.fence === 'glass'
      ? new THREE.MeshStandardMaterial({ color: 0x88ccff, transparent: true, opacity: 0.18, roughness: 0.1, metalness: 0.2, side: THREE.DoubleSide, depthWrite: false })
      : new THREE.MeshBasicMaterial({
          map: canvasTexture(32, 32, (c) => {
            c.strokeStyle = 'rgba(200,210,215,0.9)';
            c.lineWidth = 2;
            c.beginPath();
            c.moveTo(0, 16);
            c.lineTo(16, 0);
            c.lineTo(32, 16);
            c.lineTo(16, 32);
            c.closePath();
            c.stroke();
          }),
          transparent: true,
          side: THREE.DoubleSide,
          depthWrite: false,
          opacity: 0.55,
        });
  const postMat = p.neon
    ? new THREE.MeshBasicMaterial({ color: p.lines })
    : new THREE.MeshStandardMaterial({ color: 0x2b3238, metalness: 0.6, roughness: 0.4 });
  for (const [w, x, z, ry] of sides) {
    const mat = panelMat.clone();
    if ((mat as THREE.MeshBasicMaterial).map) {
      const t = (mat as THREE.MeshBasicMaterial).map!.clone();
      t.repeat.set(w / 0.12, height / 0.12);
      t.needsUpdate = true;
      (mat as THREE.MeshBasicMaterial).map = t;
    }
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(w, height), mat);
    panel.position.set(x, height / 2, z);
    panel.rotation.y = ry;
    g.add(panel);
    const posts = Math.round(w / 3);
    for (let i = 0; i <= posts; i++) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, height, 8), postMat);
      const off = -w / 2 + (w * i) / posts;
      post.position.set(x + Math.cos(ry) * off, height / 2, z - Math.sin(ry) * off);
      post.castShadow = true;
      g.add(post);
    }
  }
}

// ------------------------------------------------------------------ scenery per court

type Animator = (dt: number, time: number, wind: { x: number; z: number }) => void;

function beachScenery(g: THREE.Group, p: Palette): Animator {
  // Ocean beyond the far end: shoreline, waves, foam (see ocean.ts).
  const ocean = buildOcean(g, { color: p.sky, near: p.fogNear, far: p.fogFar });

  // Palm trees around the court.
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.9 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x2f8f3a, roughness: 0.8, side: THREE.DoubleSide });
  for (const [x, z, h] of [[-8, -8, 6], [8.5, -5, 7], [-9, 4, 5.5], [9, 6, 6.5], [-14, -13, 8], [15, -14, 7.5], [-22, -4, 7], [21, 2, 6.5]]) {
    const palm = new THREE.Group();
    for (let i = 0; i < 6; i++) {
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.16 - i * 0.012, 0.19 - i * 0.012, h / 6, 8), trunkMat);
      seg.position.set(Math.sin(i * 0.35) * 0.35, (i + 0.5) * (h / 6), 0);
      seg.castShadow = true;
      palm.add(seg);
    }
    for (let i = 0; i < 7; i++) {
      const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.45, 2.6, 4, 1), leafMat);
      leaf.scale.z = 0.15;
      leaf.position.set(Math.sin(5 * 0.35) * 0.35, h, 0);
      leaf.rotation.set(Math.PI / 2 - 0.5, (i / 7) * Math.PI * 2, 0, 'YXZ');
      leaf.translateY(1.2);
      leaf.castShadow = true;
      palm.add(leaf);
    }
    palm.position.set(x, 0, z);
    g.add(palm);
  }

  // Wind flags on poles by the net posts: they point where the wind blows.
  const flags: THREE.Group[] = [];
  const flagMat = new THREE.MeshStandardMaterial({ color: 0xff4d4d, side: THREE.DoubleSide });
  for (const side of [-1, 1]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 3, 8), new THREE.MeshStandardMaterial({ color: 0xdddddd }));
    pole.position.set(side * (COURT.WIDTH / 2 + 1.2), 1.5, -3);
    g.add(pole);
    const pivot = new THREE.Group();
    pivot.position.set(side * (COURT.WIDTH / 2 + 1.2), 2.75, -3);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.5, 6, 1), flagMat);
    flag.position.x = 0.45;
    pivot.add(flag);
    g.add(pivot);
    flags.push(pivot);
  }

  return (_dt, time, wind) => {
    ocean.update(time);
    // Flags turn with the wind and flutter harder when it's strong.
    const strength = Math.hypot(wind.x, wind.z);
    const yaw = Math.atan2(-wind.z, wind.x);
    for (const f of flags) {
      f.rotation.y = yaw + Math.sin(time * (4 + strength * 6)) * 0.15 * (0.3 + strength);
      f.rotation.z = -0.5 * (1 - Math.min(1, strength)); // droops in still air
    }
  };
}

function iceScenery(g: THREE.Group): Animator {
  // Big arena lights overhead (the spectators come from the venue's audience).
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  for (const z of [-6, 0, 6]) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(5, 0.15, 0.6), lampMat);
    lamp.position.set(0, 12, z);
    g.add(lamp);
  }
  return () => {};
}

function spaceScenery(g: THREE.Group): Animator {
  // Starfield.
  const n = 1800;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const u = Math.random() * 2 - 1;
    const a = Math.random() * Math.PI * 2;
    const r = 180;
    const s = Math.sqrt(1 - u * u);
    pos.set([r * s * Math.cos(a), Math.abs(r * u) * 0.9 + 5, r * s * Math.sin(a)], i * 3);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, fog: false });
  g.add(new THREE.Points(starGeo, starMat));

  // A banded planet with a ring.
  const bands = canvasTexture(64, 256, (c) => {
    const cols = ['#c97b4a', '#e0a96d', '#a8603a', '#f2c992', '#8c4a2f', '#d99a6c'];
    for (let y = 0; y < 256; y += 16) {
      c.fillStyle = cols[(y / 16) % cols.length];
      c.fillRect(0, y, 64, 16);
    }
  });
  const planet = new THREE.Mesh(new THREE.SphereGeometry(26, 48, 32), new THREE.MeshStandardMaterial({ map: bands, roughness: 1, fog: false }));
  planet.position.set(70, 35, -140);
  planet.rotation.z = 0.35;
  g.add(planet);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(34, 46, 64),
    new THREE.MeshBasicMaterial({ color: 0xe8c9a0, transparent: true, opacity: 0.55, side: THREE.DoubleSide, fog: false }),
  );
  ring.position.copy(planet.position);
  ring.rotation.set(1.2, 0.2, 0.35);
  g.add(ring);

  // Deck grid beyond the court.
  const grid = new THREE.GridHelper(160, 80, 0x2a6bff, 0x1a2a55);
  grid.position.y = -0.005;
  g.add(grid);
  return (_dt, time) => {
    starMat.size = 1.4 + Math.sin(time * 1.7) * 0.25; // gentle twinkle
    planet.rotation.y = time * 0.02;
  };
}

function rooftopScenery(g: THREE.Group): Animator {
  // City skyline with lit windows, all around the roof.
  const windows = canvasTexture(64, 128, (c) => {
    c.fillStyle = '#0c0a18';
    c.fillRect(0, 0, 64, 128);
    for (let y = 4; y < 128; y += 8) {
      for (let x = 4; x < 64; x += 8) {
        if (Math.random() < 0.45) {
          c.fillStyle = Math.random() < 0.8 ? '#ffd27a' : '#7ad7ff';
          c.fillRect(x, y, 4, 5);
        }
      }
    }
  });
  for (let i = 0; i < 46; i++) {
    const a = (i / 46) * Math.PI * 2 + Math.random() * 0.1;
    const r = 60 + Math.random() * 40;
    const h = 10 + Math.random() * 38;
    const w = 6 + Math.random() * 8;
    const tex = windows.clone();
    tex.repeat.set(w / 8, h / 16);
    tex.needsUpdate = true;
    const tower = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, w),
      new THREE.MeshStandardMaterial({ color: 0x111122, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.9, roughness: 0.8 }),
    );
    tower.position.set(Math.cos(a) * r, h / 2 - 6, Math.sin(a) * r);
    g.add(tower);
  }
  // Neon glow lights around the court.
  const pink = new THREE.PointLight(0xff4fd8, 18, 18);
  pink.position.set(-6, 3, 0);
  const cyan = new THREE.PointLight(0x4ff6ff, 18, 18);
  cyan.position.set(6, 3, 0);
  g.add(pink, cyan);
  // String lights along the side fences.
  const bulbMat = new THREE.MeshBasicMaterial({ color: 0xfff1b0 });
  for (const side of [-1, 1]) {
    for (let i = 0; i < 16; i++) {
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), bulbMat);
      const z = -APRON.LENGTH / 2 + (i + 0.5) * (APRON.LENGTH / 16);
      bulb.position.set(side * (APRON.WIDTH / 2 - 0.05), 2.6 + Math.sin(i * 0.9) * 0.15, z);
      g.add(bulb);
    }
  }
  return (_dt, time) => {
    pink.intensity = 16 + Math.sin(time * 2.1) * 3;
    cyan.intensity = 16 + Math.cos(time * 1.7) * 3;
  };
}

// ------------------------------------------------------------------ build

export function buildArenaScene(scene: THREE.Scene, id: ArenaId): ArenaScene {
  const p = PALETTES[id];
  const group = new THREE.Group();
  scene.background = new THREE.Color(p.sky);
  scene.fog = new THREE.Fog(p.sky, p.fogNear, p.fogFar);
  lights(group, p);
  court(group, p);
  fence(group, p);
  buildNet(group, p.neon ? p.lines : 0xffffff, p.neon);
  const animate: Animator =
    id === 'beach' ? beachScenery(group, p) : id === 'ice' ? iceScenery(group) : id === 'space' ? spaceScenery(group) : id === 'rooftop' ? rooftopScenery(group) : () => {};
  scene.add(group);
  return {
    id,
    group,
    update: animate,
    dispose() {
      scene.remove(group);
      group.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.Points) {
          o.geometry.dispose();
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) {
            (m as THREE.MeshStandardMaterial).map?.dispose();
            (m as THREE.MeshStandardMaterial).emissiveMap?.dispose();
            m.dispose();
          }
        }
      });
    },
  };
}
