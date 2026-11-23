import * as THREE from 'three';
import { CharacterId, PlayerBody, Team, teamSign } from '@picklebros/shared';
import { LOOKS, TEAM_COLORS } from '../characterLooks';
import { loadHead } from './heads';

const SWING_TIME = 0.3;
const CELEBRATE_TIME = 1.3;
const SLUMP_TIME = 1.2;

// Paddle arm yaw angles (radians around y). 0 = arm pointing at the net.
const REST_YAW = -0.9;
const FORE = { from: -2.4, to: -0.1 };
const BACK = { from: 2.2, to: 0.2 };

const HIP_Y = 0.92;
const SHOULDER_Y = 1.42;
const NECK_Y = 1.53;

export type SwingSide = 'fore' | 'back';

export interface PlayerOptions {
  team: Team;
  character?: CharacterId;
  /** Movement to draw. Practice owns its own; matches pass the shared engine's body. */
  body?: PlayerBody;
}

/** One leg: a hip joint, a knee joint and a shoe. */
interface Leg {
  hip: THREE.Group;
  knee: THREE.Group;
}

/** A cartoon player with a bobblehead: runs, swings, dives, celebrates. Always faces the net. */
export class Player {
  readonly group = new THREE.Group();
  /** Where the player is drawn (kept in sync with `body`). */
  readonly position = new THREE.Vector3();
  readonly team: Team;
  /** Movement physics (shared with the match engine and the server). */
  readonly body: PlayerBody;
  private sign: 1 | -1;
  /** Everything that leans and bobs. */
  private figure = new THREE.Group();
  private torso = new THREE.Group();
  private legs: Leg[] = [];
  private leftArm = new THREE.Group();
  private armPivot = new THREE.Group();
  /** Bobblehead spring: the head wobbles around this joint. */
  private headPivot = new THREE.Group();
  private shirtMat: THREE.MeshStandardMaterial;
  private ring: THREE.Mesh;
  private tinted = false;

  private swingClock = -1;
  private swingSide: SwingSide = 'fore';
  private runPhase = 0;
  private time = 0;
  private celebrateClock = -1;
  private slumpClock = -1;
  /** Head wobble angle and speed (x = nod, z = tilt). */
  private wobble = { x: 0, z: 0, vx: 0, vz: 0 };
  private prevV = { x: 0, z: 0 };

  constructor(
    private scene: THREE.Scene,
    opts: PlayerOptions,
  ) {
    this.team = opts.team;
    this.sign = teamSign(opts.team);
    this.body = opts.body ?? new PlayerBody(opts.team);
    this.group.rotation.y = this.sign > 0 ? 0 : Math.PI;
    const look = LOOKS[opts.character ?? 'rookie'];

    const mat = (color: number, roughness = 0.75) => new THREE.MeshStandardMaterial({ color, roughness });
    this.shirtMat = mat(look.shirt, 0.7);
    const skin = mat(look.skin, 0.8);
    const shorts = mat(look.shorts);
    const shoes = mat(look.shoes, 0.5);
    const dark = mat(0x23272e);

    // Legs: hip → thigh → knee → shin → shoe.
    for (const side of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(side * 0.1, HIP_Y, 0);
      const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.068, 0.46, 10), shorts);
      thigh.position.y = -0.23;
      hip.add(thigh);
      const knee = new THREE.Group();
      knee.position.y = -0.46;
      const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.055, 0.42, 10), skin);
      shin.position.y = -0.21;
      knee.add(shin);
      const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.07, 0.22), shoes);
      shoe.position.set(0, -0.43, -0.04);
      knee.add(shoe);
      hip.add(knee);
      this.figure.add(hip);
      this.legs.push({ hip, knee });
    }

    // Shorts, torso and neck.
    const waist = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.21, 0.2, 14), shorts);
    waist.position.y = HIP_Y;
    this.figure.add(waist);
    const chest = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.36, 6, 14), this.shirtMat);
    chest.position.y = 1.2 - HIP_Y;
    this.torso.add(chest);
    this.torso.position.y = HIP_Y;
    this.figure.add(this.torso);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.12, 10), skin);
    neck.position.y = NECK_Y - 0.03;
    this.figure.add(neck);

    // Left arm (swings while running, up when celebrating).
    this.leftArm.position.set(-0.25, SHOULDER_Y, 0);
    const lUpper = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.55, 8), skin);
    lUpper.position.y = -0.27;
    this.leftArm.add(lUpper);
    this.figure.add(this.leftArm);

    // Paddle arm on the right shoulder. The arm points along local -z, angled down a little.
    this.armPivot.position.set(0.25, SHOULDER_Y, 0);
    const arm = new THREE.Group();
    arm.rotation.x = -0.45;
    const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.55, 8), skin);
    upper.rotation.x = Math.PI / 2;
    upper.position.z = -0.275;
    arm.add(upper);
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.13, 8), dark);
    handle.rotation.x = Math.PI / 2;
    handle.position.z = -0.6;
    arm.add(handle);
    const face = new THREE.Mesh(
      new THREE.BoxGeometry(0.02, 0.2, 0.24),
      new THREE.MeshStandardMaterial({ color: 0x1f8ef1, roughness: 0.4, metalness: 0.1 }),
    );
    face.position.z = -0.78;
    arm.add(face);
    this.armPivot.add(arm);
    this.armPivot.rotation.y = REST_YAW;
    this.figure.add(this.armPivot);

    // Bobblehead: a cartoon head right away, swapped for the character's head once it loads.
    this.headPivot.position.y = NECK_Y;
    this.figure.add(this.headPivot);
    const cartoon = this.cartoonHead(skin);
    this.headPivot.add(cartoon);
    if (look.head) {
      loadHead(look.head)
        .then((head) => {
          head.scale.setScalar(look.headScale);
          head.rotation.y = Math.PI; // models face +z; players face -z
          head.traverse((o) => o instanceof THREE.Mesh && (o.castShadow = true));
          this.headPivot.remove(cartoon);
          this.headPivot.add(head);
        })
        .catch(() => {
          /* keep the cartoon head if the model can't load */
        });
    }

    this.figure.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true;
    });
    this.group.add(this.figure);

    // Team ring on the ground.
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.34, 0.42, 32),
      new THREE.MeshBasicMaterial({ color: TEAM_COLORS[opts.team], transparent: true, opacity: 0.75, depthWrite: false }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.01;
    this.group.add(this.ring);

    scene.add(this.group);
  }

  private cartoonHead(skin: THREE.Material): THREE.Group {
    const g = new THREE.Group();
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 20, 16), skin);
    head.position.y = 0.17;
    g.add(head);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.195, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2), this.shirtMat);
    cap.position.y = 0.2;
    g.add(cap);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.02, 16, 1, false, 0, Math.PI), this.shirtMat);
    brim.position.set(0, 0.2, -0.16);
    brim.rotation.y = Math.PI / 2;
    g.add(brim);
    return g;
  }

  get speed(): number {
    return this.body.speed;
  }

  get canDive(): boolean {
    return this.body.canDive;
  }

  teleport(x: number, z: number): void {
    this.body.teleport(x, z);
    this.render(0);
  }

  /** Lunge in a world-space direction for a last-ditch reach, then lie on the ground briefly. */
  dive(dx: number, dz: number): void {
    this.body.dive(dx, dz);
  }

  /** Icy glow while slowed by a Freeze Lob. */
  setFrozen(frozen: boolean): void {
    if (frozen === this.tinted) return;
    this.tinted = frozen;
    this.shirtMat.emissive.set(frozen ? 0x3fb6ff : 0x000000);
    this.shirtMat.emissiveIntensity = frozen ? 0.9 : 1;
  }

  /** Forehand if the ball is on the player's right (paddle side), backhand otherwise. */
  swingAt(ballX: number): void {
    const right = (ballX - this.body.x) * this.sign;
    this.swingSide = right >= -0.05 ? 'fore' : 'back';
    this.swingClock = 0;
    // The head jolts with the swing.
    this.wobble.vz += (this.swingSide === 'fore' ? 1 : -1) * 3;
  }

  /** Won the point: jump with both arms up. */
  celebrate(): void {
    this.celebrateClock = 0;
    this.slumpClock = -1;
    this.wobble.vx -= 4;
  }

  /** Lost the point: head down for a moment. */
  slump(): void {
    this.slumpClock = 0;
    this.celebrateClock = -1;
  }

  /** Move (own physics) and draw. `move` is world space, length <= 1. */
  update(dt: number, move: { x: number; z: number }): void {
    this.body.update(dt, move);
    this.render(dt);
  }

  /** Draw the body's current state: position, running, lean, swing, celebrations, bobblehead. */
  render(dt: number): void {
    const b = this.body;
    this.time += dt;
    this.position.set(b.x, 0, b.z);
    this.group.position.copy(this.position);

    // Velocity in the player's own frame (+z = backwards, away from the net).
    const lvx = b.vx * this.sign;
    const lvz = b.vz * this.sign;
    const speed = Math.hypot(b.vx, b.vz);

    // Lean into movement; thrown well over while diving.
    const diving = b.diving;
    const dirX = diving ? b.diveX * 8.5 * this.sign : lvx;
    const dirZ = diving ? b.diveZ * 8.5 * this.sign : lvz;
    const lean = diving ? 0.13 : 0.04;
    const k = dt > 0 ? 1 - Math.exp(-14 * dt) : 1;
    this.figure.rotation.x = THREE.MathUtils.lerp(this.figure.rotation.x, dirZ * lean, k);
    this.figure.rotation.z = THREE.MathUtils.lerp(this.figure.rotation.z, -dirX * lean, k);

    // Running: legs stride, knees bend, the left arm pumps, the body bobs.
    const stride = diving ? 0 : Math.min(1, speed / 5);
    this.runPhase += dt * (5 + speed * 1.6);
    const swing = Math.sin(this.runPhase) * 0.75 * stride;
    this.legs[0].hip.rotation.x = swing;
    this.legs[1].hip.rotation.x = -swing;
    this.legs[0].knee.rotation.x = Math.max(0, -Math.sin(this.runPhase)) * 1.1 * stride;
    this.legs[1].knee.rotation.x = Math.max(0, Math.sin(this.runPhase)) * 1.1 * stride;
    let bob = Math.abs(Math.sin(this.runPhase)) * 0.05 * stride;
    // Idle: a slow breath.
    this.torso.scale.y = 1 + Math.sin(this.time * 2.2) * 0.015 * (1 - stride);

    // Left arm: pumps while running, both arms up when celebrating.
    let leftArmX = -swing * 0.9;
    let leftArmZ = 0.12;
    if (this.celebrateClock >= 0) {
      this.celebrateClock += dt;
      const t = this.celebrateClock / CELEBRATE_TIME;
      bob += Math.abs(Math.sin(t * Math.PI * 2)) * 0.3; // two hops
      leftArmZ = -2.6; // arm straight up
      leftArmX = 0;
      if (t >= 1) this.celebrateClock = -1;
    }
    this.leftArm.rotation.x = leftArmX;
    this.leftArm.rotation.z = THREE.MathUtils.lerp(this.leftArm.rotation.z, leftArmZ, k);
    this.figure.position.y = bob;

    // Paddle arm: swing animation, paddle raised when celebrating, otherwise ready position.
    if (this.swingClock >= 0) {
      this.swingClock += dt;
      const t = Math.min(1, this.swingClock / SWING_TIME);
      const e = 1 - Math.pow(1 - t, 3);
      const s = this.swingSide === 'fore' ? FORE : BACK;
      this.armPivot.rotation.y = s.from + (s.to - s.from) * e;
      this.armPivot.rotation.x = 0;
      if (t >= 1) this.swingClock = -1;
    } else {
      const raise = this.celebrateClock >= 0 ? 1.3 : 0;
      this.armPivot.rotation.y = THREE.MathUtils.lerp(this.armPivot.rotation.y, REST_YAW, 1 - Math.exp(-6 * dt));
      this.armPivot.rotation.x = THREE.MathUtils.lerp(this.armPivot.rotation.x, raise, k);
    }

    // Bobblehead: a damped spring pushed around by acceleration (starts, stops, dives, hits).
    if (dt > 0) {
      const ax = (lvx - this.prevV.x) / dt;
      const az = (lvz - this.prevV.z) / dt;
      this.prevV = { x: lvx, z: lvz };
      const w = this.wobble;
      const stiff = 60;
      const damp = 5;
      w.vx += (-stiff * w.x - damp * w.vx - az * 0.12) * dt;
      w.vz += (-stiff * w.z - damp * w.vz + ax * 0.12) * dt;
      w.x = THREE.MathUtils.clamp(w.x + w.vx * dt, -0.6, 0.6);
      w.z = THREE.MathUtils.clamp(w.z + w.vz * dt, -0.6, 0.6);
    }
    let droop = 0;
    if (this.slumpClock >= 0) {
      this.slumpClock += dt;
      droop = Math.sin(Math.min(1, this.slumpClock / SLUMP_TIME) * Math.PI) * 0.45;
      if (this.slumpClock >= SLUMP_TIME) this.slumpClock = -1;
    }
    this.headPivot.rotation.x = this.wobble.x - droop;
    this.headPivot.rotation.z = this.wobble.z;
    this.ring.visible = !diving;
  }

  dispose(): void {
    this.scene.remove(this.group);
  }
}
