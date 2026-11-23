import * as THREE from 'three';
import {
  ARENA_IDS,
  ArenaChoice,
  ArenaId,
  COURT,
  CharacterId,
  arenaInfo,
  windAt,
  Difficulty,
  PHYSICS_DT,
  SWING_WINDOW,
  ShotType,
  Vec3,
  createBall,
  isCharacterId,
  v3,
} from '@picklebros/shared';
import { AimMarker } from './entities/aimMarker';
import { ArenaScene, buildArenaScene } from './scene/arenaScene';
import { Venue } from './scene/venue';
import { BallView } from './entities/ballView';
import { FollowCamera } from './camera';
import { Input } from './input';
import { Hud, MenuChoice, shotInfo } from './hud';
import {
  FULL_CHARGE_TIME,
  FrameInfo,
  GameMode,
  ModeContext,
  SwingMode,
  isPowerHeld,
  previewShot,
  readFlick,
} from './modes/mode';
import { TimingRing } from './entities/timingRing';
import { Sound } from './audio/sound';
import { preloadHeads } from './entities/heads';
import { LOOKS } from './characterLooks';
import { PracticeMode } from './modes/practice';
import { MatchMode } from './modes/match';
import { OnlineMatchMode } from './modes/online';
import { OnlineController } from './onlineController';

/** Saved swing choice. (New key: the old one held test values; mouse clicks is now the default.) */
const SWING_KEY = 'picklebros.swing';
const LEVEL_KEY = 'picklebros.difficulty';
const POWER_KEY = 'picklebros.power';
const SOUND_KEY = 'picklebros.sound';
const CHARACTER_KEY = 'picklebros.character';
const ARENA_KEY = 'picklebros.arena';

/** Owns the renderer, the shared scene and the loop; swaps between menu, practice and matches. */
export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private cam: FollowCamera;
  private input = new Input();
  private hud: Hud;
  private ballView: BallView;
  private ctx: ModeContext;
  private mode: GameMode | null = null;
  private lastChoice: Exclude<MenuChoice, 'online'> = 'practice';
  private shot: ShotType = 'drive';
  private swing: SwingMode = 'manual';
  private difficulty: Difficulty = 'medium';
  /** Power Mode (specials) or Classic, for matches you start. */
  private power = true;
  private character: CharacterId = 'rookie';
  private arenaChoice: ArenaChoice = 'park';
  private arenaScene: ArenaScene;
  private venue: Venue;
  private idleBall = createBall();
  private idleFocus = new THREE.Vector3(0, 0, COURT.LENGTH / 2 - 0.8);
  private accumulator = 0;
  private lastTime = 0;
  private aimMarker: AimMarker;
  private timingRing: TimingRing;
  /** The mouse button being held, when it was pressed, and the aim locked at that moment. */
  private click: { button: 'MouseLeft' | 'MouseRight'; start: number; aim: Vec3 | null } | null = null;
  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private hitPoint = new THREE.Vector3();
  private online: OnlineController;
  private sound: Sound;
  /** The timing ring was green last frame (tick once as it turns green). */
  private ringGreen = false;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(this.renderer.domElement);
    this.input.attach(this.renderer.domElement);

    let soundOn = true;
    try {
      if (localStorage.getItem(SWING_KEY) === 'auto') this.swing = 'auto';
      const level = localStorage.getItem(LEVEL_KEY);
      if (level === 'easy' || level === 'medium' || level === 'hard') this.difficulty = level;
      if (localStorage.getItem(POWER_KEY) === 'classic') this.power = false;
      soundOn = localStorage.getItem(SOUND_KEY) !== 'off';
      const saved = localStorage.getItem(CHARACTER_KEY);
      if (isCharacterId(saved)) this.character = saved;
      const arena = localStorage.getItem(ARENA_KEY);
      if (arena === 'random' || (ARENA_IDS as string[]).includes(arena ?? '')) this.arenaChoice = arena as ArenaChoice;
      localStorage.removeItem('picklebros.swingMode');
    } catch {
      /* storage unavailable: default to mouse-click hitting */
    }

    this.sound = new Sound(soundOn);
    // A soft click for every button.
    container.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button')) this.sound.click();
    });

    this.arenaScene = buildArenaScene(this.scene, this.arenaChoice === 'random' ? 'park' : this.arenaChoice);
    this.venue = new Venue(this.scene, this.arenaScene.id);
    this.sound.setAmbience(this.arenaScene.id);
    this.ballView = new BallView(this.scene);
    this.aimMarker = new AimMarker(this.scene);
    this.timingRing = new TimingRing(this.scene);
    this.cam = new FollowCamera(innerWidth / innerHeight);
    this.hud = new Hud(container, {
      onPick: (c) => (c === 'online' ? this.online.open() : this.startMode(c)),
      // Online, "Play again" asks the host for a rematch and "Main menu" goes back to the room.
      onAgain: () => (this.mode instanceof OnlineMatchMode ? this.online.rematch() : this.startMode(this.lastChoice)),
      onMenu: () => (this.mode instanceof OnlineMatchMode ? this.online.backToLobby() : this.exitToMenu()),
      onToggleSwing: () => this.toggleSwing(),
      onTogglePower: () => this.togglePower(),
      onToggleSound: () => this.toggleSound(),
      onCharacter: (id) => this.setCharacter(id),
      onArena: (a) => this.setArenaChoice(a),
      onDifficulty: (level) => this.setDifficulty(level),
    });
    this.hud.setDifficulty(this.difficulty);
    this.hud.setShot(this.shot);
    this.hud.setSwingMode(this.swing);
    this.hud.setPowerMode(this.power);
    this.hud.setSoundOn(soundOn);
    this.hud.setCharacter(this.character);
    this.hud.setArena(this.arenaChoice);
    // Fetch the character heads while you're on the menu.
    preloadHeads(Object.values(LOOKS).flatMap((l) => (l.head ? [l.head] : [])));

    this.ctx = {
      scene: this.scene,
      input: this.input,
      hud: this.hud,
      ballView: this.ballView,
      sound: this.sound,
      venue: () => this.venue,
      selectedShot: () => this.shot,
      aimPoint: () => this.aimPoint(),
      swingMode: () => this.swing,
      shake: (amount) => this.cam.shake(amount),
      restart: () => this.startMode(this.lastChoice),
      exitToMenu: () => this.exitToMenu(),
    };

    this.online = new OnlineController(container, {
      difficulty: () => this.difficulty,
      power: () => this.power,
      character: () => this.character,
      arena: () => this.arenaChoice,
      pickCharacter: (id) => this.setCharacter(id),
      startOnlineMatch: (msg) => {
        this.mode?.dispose();
        this.hud.hideGameOver();
        this.accumulator = 0;
        this.ballView.resetTrail();
        this.showArena(msg.arena ?? 'park');
        this.mode = new OnlineMatchMode(this.ctx, this.online.net, msg);
      },
      endOnlineMatch: () => {
        if (this.mode instanceof OnlineMatchMode) {
          this.mode.dispose();
          this.mode = null;
        }
      },
      showMenu: () => this.hud.setView('menu'),
      hideMenu: () => this.hud.hideMenu(),
    });

    addEventListener('resize', () => this.resize());
    this.resize();

    // Invite link (?room=CODE): go straight to joining that room.
    const room = new URLSearchParams(location.search).get('room');
    if (room && /^[A-Za-z0-9]{6}$/.test(room)) this.online.open(room.toUpperCase());
  }

  start(): void {
    requestAnimationFrame(this.frame);
  }

  startMode(choice: Exclude<MenuChoice, 'online'>): void {
    this.mode?.dispose();
    this.hud.hideGameOver();
    this.lastChoice = choice;
    this.accumulator = 0;
    this.ballView.resetTrail();
    const arena = this.arenaChoice === 'random' ? ARENA_IDS[Math.floor(Math.random() * ARENA_IDS.length)] : this.arenaChoice;
    this.showArena(arena);
    this.mode =
      choice === 'practice'
        ? new PracticeMode(this.ctx, this.character, arena)
        : new MatchMode(this.ctx, choice, this.difficulty, this.power, this.character, arena);
  }

  /** Swap the 3D surroundings to this court (if they aren't already). */
  private showArena(id: ArenaId): void {
    if (this.arenaScene.id === id) return;
    this.arenaScene.dispose();
    this.arenaScene = buildArenaScene(this.scene, id);
    this.venue.dispose();
    this.venue = new Venue(this.scene, id);
    this.sound.setAmbience(id);
  }

  private setArenaChoice(a: ArenaChoice): void {
    this.arenaChoice = a;
    this.hud.setArena(a);
    if (a !== 'random') this.showArena(a); // preview it behind the menu
    try {
      localStorage.setItem(ARENA_KEY, a);
    } catch {
      /* storage unavailable: the choice lasts for this visit only */
    }
  }

  exitToMenu(): void {
    this.mode?.dispose();
    this.mode = null;
    this.hud.setView('menu');
  }

  private setDifficulty(level: Difficulty): void {
    this.difficulty = level;
    this.hud.setDifficulty(level);
    try {
      localStorage.setItem(LEVEL_KEY, level);
    } catch {
      /* storage unavailable: the choice lasts for this visit only */
    }
  }

  private setCharacter(id: CharacterId): void {
    this.character = id;
    this.hud.setCharacter(id);
    try {
      localStorage.setItem(CHARACTER_KEY, id);
    } catch {
      /* storage unavailable: the choice lasts for this visit only */
    }
  }

  private toggleSound(): void {
    const on = !this.sound.enabled;
    this.sound.setEnabled(on);
    this.hud.setSoundOn(on);
    try {
      localStorage.setItem(SOUND_KEY, on ? 'on' : 'off');
    } catch {
      /* storage unavailable: the choice lasts for this visit only */
    }
  }

  private togglePower(): void {
    this.power = !this.power;
    this.hud.setPowerMode(this.power);
    try {
      localStorage.setItem(POWER_KEY, this.power ? 'power' : 'classic');
    } catch {
      /* storage unavailable: the choice lasts for this visit only */
    }
  }

  private toggleSwing(): void {
    this.swing = this.swing === 'auto' ? 'manual' : 'auto';
    this.hud.setSwingMode(this.swing);
    try {
      localStorage.setItem(SWING_KEY, this.swing);
    } catch {
      /* storage unavailable: the choice lasts for this visit only */
    }
  }

  /** Your aim: locked to where you pressed while a click is held (so a flick doesn't move it). */
  private aimPoint(): Vec3 | null {
    if (this.click && this.swing === 'manual') return this.click.aim;
    return this.rawAimPoint();
  }

  /** Where the mouse ray meets the ground. */
  private rawAimPoint(): Vec3 | null {
    const p = this.input.pointer;
    if (!p) return null;
    this.ndc.set((p.x / innerWidth) * 2 - 1, -(p.y / innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.cam.camera);
    const hit = this.raycaster.ray.intersectPlane(this.ground, this.hitPoint);
    return hit ? v3(hit.x, 0, hit.z) : null;
  }

  private resize(): void {
    this.renderer.setSize(innerWidth, innerHeight);
    this.cam.setAspect(innerWidth / innerHeight);
  }

  private frame = (time: number): void => {
    // Never negative (a clock hiccup must not run anything backwards) and never huge (tab was hidden).
    const dt = this.lastTime ? Math.max(0, Math.min(0.1, (time - this.lastTime) / 1000)) : 0;
    this.lastTime = time;

    // The shot follows your controls: aim short = dink, deep = drive, right button = lob / smash.
    const shot = previewShot(this.aimPoint(), isPowerHeld(this.input), this.mode ? ((-this.mode.side) as 1 | -1) : -1);
    if (shot !== this.shot) {
      this.shot = shot;
      this.hud.setShot(shot);
    }

    for (const code of this.input.consumePressed()) {
      if (code === 'KeyM') {
        this.toggleSound();
      } else if (code === 'Escape' && this.mode) {
        // Online, Esc leaves the room (the computer takes over your player).
        if (this.mode instanceof OnlineMatchMode) this.online.leave();
        else this.exitToMenu();
      } else if (code === 'MouseLeft' || code === 'MouseRight') {
        // Press: lock the aim and start charging. (Also serves, via onKey.)
        if (!this.click) this.click = { button: code, start: performance.now(), aim: this.rawAimPoint() };
        this.mode?.onKey(code);
      } else if (code === 'MouseLeftUp' || code === 'MouseRightUp') {
        // Release: swing with the charge held and any flick as spin.
        const c = this.click;
        if (c && code === `${c.button}Up`) {
          this.click = null;
          const charge = (performance.now() - c.start) / 1000 / FULL_CHARGE_TIME;
          const spin = readFlick(this.input.flick());
          this.mode?.onSwing({ power: c.button === 'MouseRight', charge, spin });
        }
      } else {
        this.mode?.onKey(code);
      }
    }
    const charging = this.click && this.mode && this.swing === 'manual';
    const charge = charging ? (performance.now() - this.click!.start) / 1000 / FULL_CHARGE_TIME : null;
    this.hud.setCharge(charge);
    this.sound.setCharge(charge);

    if (this.mode) {
      this.accumulator += dt;
      while (this.accumulator >= PHYSICS_DT) {
        this.mode.fixedUpdate(PHYSICS_DT);
        this.accumulator -= PHYSICS_DT;
      }
    }

    const info: FrameInfo = this.mode
      ? this.mode.frame(dt)
      : { ballVisible: false, landing: null, followBall: false, aim: null, timeToContact: null };
    const ball = this.mode ? this.mode.ball : this.idleBall;
    this.ballView.update(dt, ball, info.ballVisible, info.landing, info.ghost, info.decoy);
    this.aimMarker.update(dt, info.aim, shotInfo(this.shot).color);
    this.timingRing.update(this.mode ? this.mode.focus.position : this.idleFocus, info.timeToContact);
    const green = info.timeToContact !== null && info.timeToContact <= SWING_WINDOW;
    if (green && !this.ringGreen) this.sound.tick();
    this.ringGreen = green;
    this.cam.update(dt, this.mode ? this.mode.focus.position : this.idleFocus, ball.pos, info.followBall, this.mode?.side ?? 1);
    // Scenery animation and the wind (beach) for the court on screen.
    const clock = this.mode ? this.mode.clock : time / 1000;
    const wind = windAt(arenaInfo(this.arenaScene.id), clock);
    this.arenaScene.update(dt, clock, wind);
    this.venue.update(dt, this.mode && info.ballVisible ? ball.pos : null);
    this.hud.setWind(this.mode && arenaInfo(this.arenaScene.id).wind ? wind : null, this.mode?.side ?? 1);
    this.hud.update(dt);
    this.renderer.render(this.scene, this.cam.camera);
    requestAnimationFrame(this.frame);
  };
}
