import * as THREE from 'three';
import { ArenaId, FaultReason, NET_HALF_SPAN, Team, Vec3, arenaInfo } from '@picklebros/shared';
import { TEAM_COLORS } from '../characterLooks';
import { APRON } from './arenaScene';

/**
 * Everything around the court that makes it feel like a real match: an audience in the stands that
 * reacts to points, a referee on a high chair who watches the ball and signals calls, and a stadium
 * scoreboard behind the court.
 */

// ------------------------------------------------------------------ audience

interface Fan {
  pos: THREE.Vector3;
  yaw: number;
  /** Standing (beach crowd, rooftop) rather than seated. */
  standing: boolean;
  phase: number;
  /** How excitable this person is. */
  zeal: number;
  hat: boolean;
  /** Rooftop: waving a glow stick. */
  glow: boolean;
}

type HatKind = 'cap' | 'beanie' | 'sunhat' | 'helmet' | 'none';

/** What the crowd looks like on each court. */
interface CrowdTheme {
  outfits: number[];
  /** Long sleeves (arms in the outfit colour) — jackets, space suits. */
  sleeves: boolean;
  hat: HatKind;
  hatColors: number[];
  hatChance: number;
  /** Some people dressed in skin tone only (e.g. shirtless at the beach). */
  bareChance: number;
  standing: boolean;
  glowSticks: boolean;
}

const SKINS = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac, 0xd9a37a];

const THEMES: Record<ArenaId, CrowdTheme> = {
  park: {
    outfits: [0xe74c3c, 0x3498db, 0xf1c40f, 0xecf0f1, 0x9b59b6, 0x2ecc71, 0xe67e22, 0x1abc9c, 0x34495e, 0xffffff],
    sleeves: false, hat: 'cap', hatColors: [0xe74c3c, 0x2a5bd7, 0x222222, 0xffffff, 0x2ecc71], hatChance: 0.45,
    bareChance: 0, standing: false, glowSticks: false,
  },
  beach: {
    // Summer brights: tank tops, swimwear, sarongs.
    outfits: [0xff6f61, 0x00b4d8, 0xffd23f, 0xff8fd0, 0x7bd389, 0xffffff, 0xff9f1c, 0x48cae4],
    sleeves: false, hat: 'sunhat', hatColors: [0xe9cf8f, 0xf2dfa7, 0xd8b66a, 0xffffff], hatChance: 0.5,
    bareChance: 0.25, standing: true, glowSticks: false,
  },
  ice: {
    // Winter jackets and woolly hats.
    outfits: [0x1f3a5f, 0xb22222, 0x2f4f4f, 0x111111, 0x4b5d7a, 0x8b0000, 0x355e3b, 0xd9d9d9],
    sleeves: true, hat: 'beanie', hatColors: [0xd62828, 0xf1faee, 0x264653, 0xf4a261, 0x6a4c93], hatChance: 0.75,
    bareChance: 0, standing: false, glowSticks: false,
  },
  space: {
    // Space suits (white and orange) and crew uniforms, glass helmets.
    outfits: [0xf2f2f2, 0xf2f2f2, 0xff7b00, 0xe8e8e8, 0x2e5cff, 0xc1121f],
    sleeves: true, hat: 'helmet', hatColors: [0x9fd8ff], hatChance: 0.85,
    bareChance: 0, standing: false, glowSticks: false,
  },
  rooftop: {
    // Dark party outfits; glow sticks in the air.
    outfits: [0x111111, 0x1b1b2f, 0x2d1b4e, 0x0f3057, 0x3a0ca3, 0x222222],
    sleeves: false, hat: 'cap', hatColors: [0xff4fd8, 0x4ff6ff, 0x111111], hatChance: 0.3,
    bareChance: 0, standing: true, glowSticks: true,
  },
};

const pick = <T>(list: T[]) => list[Math.floor(Math.random() * list.length)];

function hatGeometry(kind: HatKind): THREE.BufferGeometry {
  switch (kind) {
    case 'beanie': {
      const g = new THREE.SphereGeometry(0.13, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
      g.scale(1, 1.25, 1);
      g.translate(0, 0.02, 0);
      return g;
    }
    case 'sunhat': {
      const g = new THREE.ConeGeometry(0.3, 0.16, 14);
      g.translate(0, 0.09, 0);
      return g;
    }
    case 'helmet':
      return new THREE.SphereGeometry(0.2, 14, 10);
    default: {
      const g = new THREE.SphereGeometry(0.128, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
      g.translate(0, 0.02, 0);
      return g;
    }
  }
}

class Audience {
  readonly group = new THREE.Group();
  private fans: Fan[] = [];
  private bodies: THREE.InstancedMesh;
  private heads: THREE.InstancedMesh;
  private arms: THREE.InstancedMesh;
  private hats: THREE.InstancedMesh | null = null;
  private glows: THREE.InstancedMesh | null = null;
  /** 0..1 how loud the crowd is right now (decays). */
  private excitement = 0;
  private time = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3(1, 1, 1);
  private v = new THREE.Vector3();
  private e = new THREE.Euler();
  private base = new THREE.Vector3();
  private armQ = new THREE.Quaternion();
  private hidden = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(arena: ArenaId) {
    const theme = THEMES[arena];
    const standing = theme.standing;
    const bleachers = arena !== 'beach';
    const stepColor = { park: 0x8a6b4a, beach: 0, ice: 0x334455, space: 0x2a2f3f, rooftop: 0x3a3344 }[arena];
    const stepMat = new THREE.MeshStandardMaterial({ color: stepColor, roughness: 0.85 });
    const rows = arena === 'beach' ? 3 : 6;
    const sideX = APRON.WIDTH / 2 + 1.3;
    const endZ = APRON.LENGTH / 2 + 1.3;
    const addRow = (r: number, along: 'side' | 'end', sign: number) => {
      const depth = bleachers ? r * 0.85 : r * 1.0;
      const floorY = bleachers ? 0.35 + r * 0.45 : 0;
      const length = along === 'side' ? APRON.LENGTH - 1.5 : APRON.WIDTH + 3;
      if (bleachers) {
        // The bleacher step this row sits (or stands) on.
        const step = new THREE.Mesh(new THREE.BoxGeometry(along === 'side' ? 0.85 : length, floorY + 0.02, along === 'side' ? length : 0.85), stepMat);
        if (along === 'side') step.position.set(sign * (sideX + depth), (floorY + 0.02) / 2, 0);
        else step.position.set(0, (floorY + 0.02) / 2, -(endZ + depth));
        step.receiveShadow = true;
        this.group.add(step);
      }
      const spacing = arena === 'beach' ? 1.1 : 0.72;
      for (let t = -length / 2 + spacing / 2; t < length / 2; t += spacing) {
        if (Math.random() < (arena === 'beach' ? 0.45 : 0.12)) continue; // some empty spots
        const jitter = (Math.random() - 0.5) * 0.15;
        const pos =
          along === 'side'
            ? new THREE.Vector3(sign * (sideX + depth), floorY, t + jitter)
            : new THREE.Vector3(t + jitter, floorY, -(endZ + depth));
        // Face the middle of the court.
        const look = along === 'side' ? new THREE.Vector3(0, 0, pos.z * 0.6) : new THREE.Vector3(pos.x * 0.6, 0, 0);
        const yaw = Math.atan2(-(look.x - pos.x), -(look.z - pos.z));
        // At the beach some people sit on towels on the sand.
        const sits = arena === 'beach' && Math.random() < 0.35;
        this.fans.push({
          pos,
          yaw,
          standing: standing && !sits,
          phase: Math.random() * Math.PI * 2,
          zeal: 0.5 + Math.random() * 0.8,
          hat: theme.hat !== 'none' && Math.random() < theme.hatChance,
          glow: theme.glowSticks && Math.random() < 0.6,
        });
        if (sits) this.addTowel(pos, yaw);
      }
    };
    for (let r = 0; r < rows; r++) {
      addRow(r, 'side', -1);
      addRow(r, 'side', 1);
      addRow(r, 'end', -1);
    }
    if (arena === 'beach') this.addUmbrellas();

    const n = this.fans.length;
    const outfitMat = new THREE.MeshStandardMaterial({ roughness: arena === 'space' ? 0.45 : 0.8 });
    const skinMat = new THREE.MeshStandardMaterial({ roughness: 0.8 });
    this.bodies = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.19, 0.55, 8), outfitMat, n);
    this.heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.12, 10, 8), skinMat, n);
    const armGeo = new THREE.BoxGeometry(0.08, 0.42, 0.08);
    armGeo.translate(0, -0.21, 0); // pivot at the shoulder
    this.arms = new THREE.InstancedMesh(armGeo, new THREE.MeshStandardMaterial({ roughness: 0.8 }), n * 2);
    if (theme.hat !== 'none') {
      const hatMat =
        theme.hat === 'helmet'
          ? new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.35, roughness: 0.05, metalness: 0.3, depthWrite: false })
          : new THREE.MeshStandardMaterial({ roughness: 0.85 });
      this.hats = new THREE.InstancedMesh(hatGeometry(theme.hat), hatMat, n);
    }
    if (theme.glowSticks) {
      const stick = new THREE.CylinderGeometry(0.022, 0.022, 0.32, 6);
      stick.translate(0, -0.55, 0); // held at the end of the arm
      this.glows = new THREE.InstancedMesh(stick, new THREE.MeshBasicMaterial({ toneMapped: false }), n);
    }

    const c = new THREE.Color();
    this.fans.forEach((f, i) => {
      const skin = new THREE.Color(pick(SKINS));
      const bare = Math.random() < theme.bareChance;
      const outfit = bare ? skin : new THREE.Color(pick(theme.outfits));
      this.bodies.setColorAt(i, outfit);
      this.heads.setColorAt(i, skin);
      const armColor = theme.sleeves ? outfit : skin;
      this.arms.setColorAt(i * 2, armColor);
      this.arms.setColorAt(i * 2 + 1, armColor);
      this.hats?.setColorAt(i, c.set(pick(theme.hatColors)));
      this.glows?.setColorAt(i, c.set(pick([0xff4fd8, 0x4ff6ff, 0x9dff4f, 0xffe14a])));
      void f;
    });
    for (const mesh of [this.bodies, this.heads, this.arms, this.hats, this.glows]) {
      if (!mesh) continue;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = false;
      this.group.add(mesh);
    }
    this.update(0);
  }

  /** A beach towel on the sand under someone sitting. */
  private addTowel(pos: THREE.Vector3, yaw: number): void {
    const towel = new THREE.Mesh(
      new THREE.PlaneGeometry(0.7, 1.5),
      new THREE.MeshStandardMaterial({ color: pick([0xff6f61, 0x00b4d8, 0xffd23f, 0x7bd389, 0xff8fd0]), roughness: 0.9 }),
    );
    towel.rotation.set(-Math.PI / 2, 0, yaw);
    towel.position.set(pos.x, 0.005, pos.z);
    towel.receiveShadow = true;
    this.group.add(towel);
  }

  /** Striped beach umbrellas dotted among the crowd. */
  private addUmbrellas(): void {
    const stripes = new THREE.CanvasTexture(
      (() => {
        const cv = document.createElement('canvas');
        cv.width = 128;
        cv.height = 8;
        const g = cv.getContext('2d')!;
        for (let i = 0; i < 8; i++) {
          g.fillStyle = i % 2 ? '#ffffff' : pick(['#ff4d4d', '#1e88e5', '#ffb300', '#43a047']);
          g.fillRect(i * 16, 0, 16, 8);
        }
        return cv;
      })(),
    );
    stripes.colorSpace = THREE.SRGBColorSpace;
    const canopyMat = new THREE.MeshStandardMaterial({ map: stripes, roughness: 0.8, side: THREE.DoubleSide });
    const poleMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee });
    const spots: [number, number][] = [
      [-(APRON.WIDTH / 2 + 2.2), -6], [-(APRON.WIDTH / 2 + 3.4), 1], [-(APRON.WIDTH / 2 + 2.6), 7],
      [APRON.WIDTH / 2 + 2.4, -4], [APRON.WIDTH / 2 + 3.2, 3], [APRON.WIDTH / 2 + 2.2, 8],
      [-3, -(APRON.LENGTH / 2 + 2.6)], [3.5, -(APRON.LENGTH / 2 + 3.2)],
    ];
    for (const [x, z] of spots) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.3, 6), poleMat);
      pole.position.set(x, 1.15, z);
      const canopy = new THREE.Mesh(new THREE.ConeGeometry(1.2, 0.45, 16, 1, true), canopyMat);
      canopy.position.set(x, 2.3, z);
      canopy.castShadow = true;
      this.group.add(pole, canopy);
    }
  }

  /** The crowd reacts: 0.2 = a polite clap, 1 = on their feet. */
  cheer(amount: number): void {
    this.excitement = Math.max(this.excitement, Math.min(1, amount));
  }

  update(dt: number): void {
    this.time += dt;
    this.excitement = Math.max(0, this.excitement - dt * 0.35);
    const t = this.time;
    this.fans.forEach((f, i) => {
      const e = Math.min(1, this.excitement * f.zeal);
      const hop = e > 0.2 ? Math.max(0, Math.sin(t * 7 + f.phase)) * 0.22 * e : 0;
      const sway = Math.sin(t * 0.8 + f.phase) * 0.04;
      const baseY = f.pos.y + (f.standing ? 0.55 : 0.3) + hop + Math.sin(t * 1.3 + f.phase) * 0.008;
      this.q.setFromEuler(this.e.set(0, f.yaw + sway, 0));
      // Body.
      this.m.compose(this.v.set(f.pos.x, baseY, f.pos.z), this.q, this.s);
      this.bodies.setMatrixAt(i, this.m);
      // Head (and hat).
      this.m.compose(this.v.set(f.pos.x, baseY + 0.4, f.pos.z), this.q, this.s);
      this.heads.setMatrixAt(i, this.m);
      this.hats?.setMatrixAt(i, f.hat ? this.m : this.hidden);
      // Arms: down at rest, up and waving when cheering. Glow sticks wave in the air all night.
      const raised = e > 0.25 || f.glow;
      const up = raised ? 2.7 + Math.sin(t * (f.glow ? 5 : 9) + f.phase) * (f.glow ? 0.5 : 0.35) : 0.15;
      this.base.set(f.pos.x, baseY, f.pos.z);
      for (const side of [-1, 1]) {
        const lift = f.glow && side < 0 && e <= 0.25 ? 0.15 : up; // the free arm rests unless cheering
        const shoulder = this.v.set(side * 0.2, 0.24, 0).applyQuaternion(this.q).add(this.base);
        this.armQ.setFromEuler(this.e.set(0, f.yaw + sway, side * lift));
        this.m.compose(shoulder, this.armQ, this.s);
        this.arms.setMatrixAt(i * 2 + (side > 0 ? 1 : 0), this.m);
        if (side > 0) this.glows?.setMatrixAt(i, f.glow ? this.m : this.hidden);
      }
    });
    for (const mesh of [this.bodies, this.heads, this.arms, this.hats, this.glows]) if (mesh) mesh.instanceMatrix.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ referee

type Signal = 'out' | 'fault' | 'point' | null;

class Referee {
  readonly group = new THREE.Group();
  private head = new THREE.Group();
  private leftArm = new THREE.Group();
  private rightArm = new THREE.Group();
  private signal: Signal = null;
  private signalTime = 0;
  /** World z of the end the referee points to (the team that won the point). */
  private pointTo = 1;

  /** Headwear to suit the court: cap, straw sun hat, woolly beanie, space helmet or neon cap. */
  private addHat(arena: ArenaId, black: THREE.Material): void {
    const dome = (r: number, mat: THREE.Material) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat);
      m.position.y = 0.02;
      this.head.add(m);
      return m;
    };
    if (arena === 'beach') {
      const straw = new THREE.MeshStandardMaterial({ color: 0xe6cc8a, roughness: 0.9 });
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.015, 20), straw);
      rim.position.y = 0.06;
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.135, 0.12, 16), straw);
      crown.position.y = 0.12;
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.137, 0.137, 0.03, 16), new THREE.MeshStandardMaterial({ color: 0xd62828 }));
      band.position.y = 0.08;
      this.head.add(rim, crown, band);
    } else if (arena === 'ice') {
      const wool = new THREE.MeshStandardMaterial({ color: 0xd62828, roughness: 1 });
      dome(0.14, wool).scale.set(1, 1.3, 1);
      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.142, 0.142, 0.05, 16), new THREE.MeshStandardMaterial({ color: 0xf1faee, roughness: 1 }));
      cuff.position.y = 0.03;
      const bobble = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), cuff.material);
      bobble.position.y = 0.21;
      this.head.add(cuff, bobble);
    } else if (arena === 'space') {
      const glass = new THREE.Mesh(
        new THREE.SphereGeometry(0.21, 20, 14),
        new THREE.MeshStandardMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.3, roughness: 0.05, metalness: 0.3, depthWrite: false }),
      );
      const collar = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.035, 8, 20), new THREE.MeshStandardMaterial({ color: 0xcfd6e0, metalness: 0.6, roughness: 0.3 }));
      collar.rotation.x = Math.PI / 2;
      collar.position.y = -0.15;
      this.head.add(glass, collar);
    } else {
      const neon = arena === 'rooftop';
      const capMat = neon ? new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xff2fd0, emissiveIntensity: 0.25 }) : black;
      dome(0.135, capMat);
      const brim = new THREE.Mesh(
        new THREE.BoxGeometry(0.14, 0.02, 0.2),
        neon ? new THREE.MeshBasicMaterial({ color: 0x4ff6ff, toneMapped: false }) : black,
      );
      brim.position.set(0.13, 0.04, 0);
      this.head.add(brim);
    }
  }

  constructor(arena: ArenaId) {
    const x = -(NET_HALF_SPAN + 0.95);
    const seatY = 1.7;
    // The tall umpire's chair.
    const metal = new THREE.MeshStandardMaterial({ color: 0x3b4048, metalness: 0.5, roughness: 0.4 });
    const wood = new THREE.MeshStandardMaterial({ color: 0x2a5bd7, roughness: 0.6 });
    for (const [lx, lz] of [[-0.3, -0.3], [-0.3, 0.3], [0.3, -0.3], [0.3, 0.3]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, seatY, 0.06), metal);
      leg.position.set(lx, seatY / 2, lz);
      this.group.add(leg);
    }
    for (let i = 1; i < 5; i++) {
      const rung = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 0.64), metal);
      rung.position.set(-0.3, (seatY * i) / 5, 0);
      this.group.add(rung);
    }
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.08, 0.7), wood);
    seat.position.y = seatY;
    this.group.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.6, 0.7), wood);
    back.position.set(-0.32, seatY + 0.3, 0);
    this.group.add(back);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 0.6), metal);
    foot.position.set(0.35, seatY - 0.55, 0);
    this.group.add(foot);

    // The referee, sitting, facing the court (+x in the chair's frame).
    const stripes = new THREE.CanvasTexture(
      (() => {
        const c = document.createElement('canvas');
        c.width = 64;
        c.height = 8;
        const g = c.getContext('2d')!;
        for (let i = 0; i < 8; i++) {
          g.fillStyle = i % 2 ? '#111111' : '#f4f4f4';
          g.fillRect(i * 8, 0, 8, 8);
        }
        return c;
      })(),
    );
    stripes.colorSpace = THREE.SRGBColorSpace;
    const shirt = new THREE.MeshStandardMaterial({ map: stripes, roughness: 0.8 });
    const black = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.8 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xc68d68, roughness: 0.8 });
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.21, 0.6, 14), shirt);
    torso.position.set(-0.05, seatY + 0.36, 0);
    this.group.add(torso);
    for (const side of [-1, 1]) {
      const thigh = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.13, 0.13), black);
      thigh.position.set(0.16, seatY + 0.1, side * 0.1);
      this.group.add(thigh);
      const shin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.5, 0.12), black);
      shin.position.set(0.36, seatY - 0.2, side * 0.1);
      this.group.add(shin);
    }
    this.head.position.set(-0.05, seatY + 0.8, 0);
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), skin);
    this.head.add(face);
    this.addHat(arena, black);
    this.group.add(this.head);
    for (const [arm, side] of [[this.leftArm, -1], [this.rightArm, 1]] as [THREE.Group, number][]) {
      arm.position.set(-0.05, seatY + 0.6, side * 0.24);
      const limb = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, 0.08), shirt);
      limb.position.y = -0.25;
      arm.add(limb);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), skin);
      hand.position.y = -0.52;
      arm.add(hand);
      this.group.add(arm);
    }
    this.group.traverse((o) => o instanceof THREE.Mesh && (o.castShadow = true));
    this.group.position.set(x, 0, 0);
  }

  /**
   * Hand signals: out = both arms straight out in front; fault = one arm straight up;
   * point = arm out toward the end of the team that won it.
   */
  call(reason: FaultReason, winner: Team): void {
    this.signal = reason === 'out' ? 'out' : reason === 'missed' || reason === 'timeout' ? 'point' : 'fault';
    this.signalTime = 1.6;
    this.pointTo = winner === 0 ? 1 : -1;
  }

  update(dt: number, ball: Vec3 | null): void {
    // Watch the ball.
    if (ball) {
      const yaw = Math.atan2(-(ball.z - this.group.position.z), ball.x - this.group.position.x);
      this.head.rotation.y += (THREE.MathUtils.clamp(yaw, -1.3, 1.3) - this.head.rotation.y) * Math.min(1, dt * 8);
    }
    let l = { x: 0, z: 0.1 };
    let r = { x: 0, z: -0.1 };
    if (this.signalTime > 0) {
      this.signalTime -= dt;
      if (this.signal === 'out') {
        l = { x: 0, z: 1.5 };
        r = { x: 0, z: 1.5 };
      } else if (this.signal === 'fault') {
        r = { x: 0, z: 3.0 };
      } else if (this.signal === 'point') {
        // World +z is to the referee's left (they sit at -x facing +x).
        if (this.pointTo > 0) l = { x: -1.5, z: 0.2 };
        else r = { x: 1.5, z: -0.2 };
      }
    }
    const k = Math.min(1, dt * 10);
    this.leftArm.rotation.x += (l.x - this.leftArm.rotation.x) * k;
    this.leftArm.rotation.z += (l.z - this.leftArm.rotation.z) * k;
    this.rightArm.rotation.x += (r.x - this.rightArm.rotation.x) * k;
    this.rightArm.rotation.z += (r.z - this.rightArm.rotation.z) * k;
  }
}

// ------------------------------------------------------------------ stadium scoreboard

export interface BoardInfo {
  names: [string, string];
  score: [number, number];
  serving: Team;
  call: string;
  /** Doubles: server 1 or 2. */
  serverNumber?: number;
  status?: string;
}

class Scoreboard {
  readonly group = new THREE.Group();
  private canvas = document.createElement('canvas');
  private texture: THREE.CanvasTexture;

  constructor(private courtName: string) {
    this.canvas.width = 1024;
    this.canvas.height = 512;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    const screenMat = new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x1b1f27, metalness: 0.4, roughness: 0.5 });
    // Big board behind the far end, up on legs.
    const far = new THREE.Group();
    const frame = new THREE.Mesh(new THREE.BoxGeometry(7.6, 3.9, 0.3), frameMat);
    far.add(frame);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 3.6), screenMat);
    screen.position.z = 0.16;
    far.add(screen);
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.25, 4.2, 0.25), frameMat);
      leg.position.set(side * 3, -3.9, 0);
      far.add(leg);
    }
    far.position.set(0, 6.1, -(APRON.LENGTH / 2 + 3.2));
    this.group.add(far);
    // A second screen high above the near end for players at the far end (face-on only, so it
    // never blocks the near camera from behind).
    const near = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 3.6), screenMat);
    near.position.set(0, 8.5, APRON.LENGTH / 2 + 5);
    near.rotation.y = Math.PI;
    this.group.add(near);
    this.draw({ names: ['', ''], score: [0, 0], serving: 0, call: '', status: 'Welcome' });
  }

  draw(info: BoardInfo): void {
    const g = this.canvas.getContext('2d')!;
    const W = 1024;
    const H = 512;
    g.fillStyle = '#05070d';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = '#e6f53c';
    g.lineWidth = 6;
    g.strokeRect(10, 10, W - 20, H - 20);
    // Header.
    g.fillStyle = '#e6f53c';
    g.font = 'bold 44px system-ui, sans-serif';
    g.textBaseline = 'middle';
    g.fillText('PICKLEBROS', 40, 60);
    g.fillStyle = '#9fb0c8';
    g.font = '600 32px system-ui, sans-serif';
    g.textAlign = 'right';
    g.fillText(this.courtName.toUpperCase(), W - 40, 60);
    g.textAlign = 'left';
    // Team rows.
    for (const t of [0, 1] as Team[]) {
      const y = 170 + t * 120;
      g.fillStyle = `#${TEAM_COLORS[t].toString(16).padStart(6, '0')}`;
      g.fillRect(40, y - 45, 18, 90);
      g.fillStyle = '#ffffff';
      g.font = 'bold 50px system-ui, sans-serif';
      const name = info.names[t].length > 22 ? `${info.names[t].slice(0, 21)}…` : info.names[t];
      g.fillText(name, 80, y);
      if (info.serving === t && info.call) {
        g.fillStyle = '#e6f53c';
        g.beginPath();
        g.arc(W - 230, y, 16, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = '#ff9d2e';
      g.font = 'bold 110px ui-monospace, monospace';
      g.textAlign = 'right';
      g.fillText(String(info.score[t]), W - 50, y + 6);
      g.textAlign = 'left';
    }
    // Footer: the score call (or a status line).
    g.fillStyle = '#9fb0c8';
    g.font = '600 34px system-ui, sans-serif';
    const footer = info.status ?? `CALL  ${info.call}${info.serverNumber ? `     SERVER ${info.serverNumber}` : ''}`;
    g.fillText(footer, 40, H - 55);
    this.texture.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ venue

export class Venue {
  readonly group = new THREE.Group();
  private audience: Audience;
  private referee: Referee;
  private board: Scoreboard;

  constructor(
    private scene: THREE.Scene,
    arena: ArenaId,
  ) {
    this.audience = new Audience(arena);
    this.referee = new Referee(arena);
    this.board = new Scoreboard(arenaInfo(arena).name);
    this.group.add(this.audience.group, this.referee.group, this.board.group);
    scene.add(this.group);
  }

  update(dt: number, ball: Vec3 | null): void {
    this.audience.update(dt);
    this.referee.update(dt, ball);
  }

  /** A point ended: the referee signals and the crowd reacts (bigger for long rallies). */
  point(reason: FaultReason, winner: Team, rallyHits: number): void {
    this.referee.call(reason, winner);
    this.audience.cheer(0.3 + Math.min(0.7, rallyHits / 14));
  }

  /** Something exciting (a special, a smash): the crowd reacts. */
  excite(amount: number): void {
    this.audience.cheer(amount);
  }

  setBoard(info: BoardInfo): void {
    this.board.draw(info);
  }

  dispose(): void {
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          (m as THREE.MeshBasicMaterial).map?.dispose();
          m.dispose();
        }
      }
    });
  }
}

