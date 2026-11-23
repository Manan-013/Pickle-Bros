import { BOT_SKILLS, BotSkill, Difficulty, botReadyPosition, chooseBotServe, chooseBotShot, findVolleySpot } from '../ai';
import { BALL, COURT } from '../constants';
import { REACH, applyShotError, contactQuality, rateContact, shotPace, shouldSwing } from '../contact';
import type { ContactRating } from '../contact';
import { BallEvent, createBall, predictFirstBounce, stepBall } from '../physics';
import { FaultReason, Referee, VOLLEY_MOMENTUM_TIME } from '../referee';
import {
  Format,
  MatchState,
  RallyOutcome,
  Slot,
  Team,
  applyRally,
  courtX,
  createMatch,
  inCourtHalf,
  other,
  receiverSlot,
  serveSide,
  slotSide,
  teamOfZ,
  teamSign,
} from '../rules';
import { solveShot } from '../shotSolver';
import { ShotType, canSmash, planShot } from '../shots';
import { Vec3, cloneVec, v3 } from '../vec';
import type { PowerSnapshot, Snapshot } from '../net/protocol';
import { CharacterId, CharacterInfo, characterInfo } from '../characters';
import { ArenaId, applyArena, arenaInfo } from '../arenas';
import { PlayerBody } from './body';
import { HumanSwingState, SwingIntent, applyIntent, chargePace, shotAtContact } from './human';
import {
  ArmKind,
  BLOCK_QUALITY,
  BLOCK_REWARD,
  BallFx,
  FREEZE_SPEED,
  FREEZE_TIME,
  INCOMING_PENALTY,
  MAX_METER,
  POINT_LOSS,
  POINT_WIN_GAIN,
  SLOWMO_SCALE,
  SLOWMO_TIME,
  SPECIAL_COOLDOWN,
  SPECIAL_COST,
  SUPER_COST,
  SpecialKind,
  BLIZZARD_TIME,
  QUAKE_STUN_SPEED,
  QUAKE_STUN_TIME,
  comboPace,
  isSuper,
  meterGain,
  specialFor,
} from './power';

/**
 * A complete pickleball match without graphics: players, ball, referee, scoring and computer
 * players. The offline game runs it in the browser; the online server runs the same code.
 */

export type SimPhase = 'preServe' | 'rally' | 'pointOver' | 'gameOver';

/** What a human player's controls say this step. */
export interface SeatInput {
  /** World-space movement, length <= 1. */
  move: { x: number; z: number };
  /** Where the mouse points on the ground, or null. */
  aim: Vec3 | null;
  /** Right mouse button held (auto swing: lob / smash). */
  powerHeld: boolean;
  /** Shift held: auto swing lets the ball go. */
  lettingGo: boolean;
  /** Click-to-hit swing mode (otherwise auto swing). */
  manual: boolean;
}

export const idleInput = (): SeatInput => ({ move: { x: 0, z: 0 }, aim: null, powerHeld: false, lettingGo: false, manual: false });

export type SimEvent =
  /** A player started a swing (animation cue). */
  | { type: 'swing'; seat: number; ballX: number }
  | {
      type: 'hit';
      seat: number;
      shot: ShotType;
      rating: ContactRating;
      intent: SwingIntent | null;
      /** Power Mode: the special this hit was, and the hitter's combo after it. */
      special: SpecialKind | null;
      combo: number;
    }
  /** Power Mode: a special or super was played (callout for everyone). */
  | { type: 'special'; seat: number; kind: SpecialKind }
  /** Power Mode: a special was blocked by a clean return. */
  | { type: 'block'; seat: number; kind: SpecialKind }
  /** Power Mode: a Freeze Lob landed (or a Blizzard hit); this team is slowed. */
  | { type: 'freeze'; team: Team }
  /** Power Mode: an Earthquake landed; this team is stunned. */
  | { type: 'quake'; team: Team; x: number; z: number }
  | { type: 'netcord' }
  /** The ball hit the court (for sound). */
  | { type: 'bounce'; x: number; z: number; speed: number }
  /** The ball went into the net (for sound). */
  | { type: 'net'; x: number }
  | { type: 'serveReady'; seat: number }
  | { type: 'served'; seat: number }
  | { type: 'point'; winner: Team; reason: FaultReason; outcome: RallyOutcome }
  | { type: 'gameOver'; winner: Team };

export interface Seat {
  index: number;
  team: Team;
  slot: Slot;
  /** Controlled by a person (input) rather than the AI. */
  human: boolean;
  body: PlayerBody;
  skill: BotSkill;
  input: SeatInput;
  swing: HumanSwingState;
  /** Distance to the ball last step, for detecting the closest approach. */
  prevHd: number | null;
  /** Bots: where they're heading. */
  target: { x: number; z: number };
  /** Bot decided the ball is going out and will let it go. */
  leave: boolean;
  /** Time of this player's last volley (kitchen momentum rule), or -1. */
  volleyTime: number;
  /** When this bot next re-plans after a shot (its reaction time), or -1. */
  planAt: number;
  /** Power Mode: 0..MAX_METER bars. */
  meter: number;
  /** Power Mode: consecutive PERFECT hits. */
  combo: number;
  /** Power Mode: special / super armed for the next hit (or serve). */
  armed: ArmKind | null;
  /** Power Mode: match time of this player's last special. */
  lastSpecial: number;
  /** Power Mode: slowed by a Freeze Lob until this match time. */
  slowUntil: number;
  /** How slow while slowed (Freeze / Blizzard ≈ half speed, Earthquake ≈ stunned). */
  slowFactor: number;
  character: CharacterInfo;
}

export interface MatchOptions {
  /** Skill level for each seat when an AI plays it. */
  levelFor: (team: Team, slot: Slot) => Difficulty;
  /** Seats (indices) controlled by people. */
  humanSeats: number[];
  firstServingTeam?: Team;
  /** A human server who doesn't serve within this many seconds serves automatically (online). */
  serveTimeout?: number;
  /** Online: people move themselves and report positions, so the engine doesn't move human bodies. */
  remoteBodies?: boolean;
  /** Power Mode: meter, combos, specials and supers (otherwise classic pickleball). */
  power?: boolean;
  /** Character for each seat (stats and super); default Rookie. */
  characterFor?: (seat: number) => CharacterId;
  /** The court (physics twists); default Park. */
  arena?: ArenaId;
  rand?: () => number;
}

const BOT_SERVE_DELAY = 1.3;
const POINT_PAUSE = 1.9;
/** A ball that has stopped moving for this long ends the rally (safety net). */
const DEAD_BALL_TIME = 1.5;

const gauss = (r: () => number) => (r() + r() + r() - 1.5) * 2;

/** Stretched contact can catch the net: the solver is allowed to aim below the tape. */
const netMarginFor = (q: number, type: ShotType, r: () => number) => {
  // Dinks skim the tape, so a shaky dink is more likely to find the net.
  const risky = type === 'dink' ? q < 0.5 && r() < 0.5 : q < 0.3 && r() < 0.35;
  return risky ? -0.12 : 0.1;
};

/**
 * Serve target inside the diagonal service box. An aim point is clamped to the box; without one,
 * a random spot in the box is picked.
 */
export function serveTargetFor(state: MatchState, point: Vec3 | null, rand: () => number = Math.random): Vec3 {
  const recv = other(state.servingTeam);
  const cx = courtX(recv, serveSide(state));
  const halfW = COURT.WIDTH / 4 - 0.35;
  const [near, far] = [COURT.KITCHEN + 0.6, COURT.LENGTH / 2 - 0.4];
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  if (point) {
    const depth = clamp(point.z * teamSign(recv), near, far);
    return v3(clamp(point.x, cx - halfW, cx + halfW), 0, teamSign(recv) * depth);
  }
  return v3(cx + (rand() * 2 - 1) * halfW, 0, teamSign(recv) * (near + rand() * (far - near - 0.8)));
}

/** Seat order: team 0 slot 0, (team 0 slot 1), team 1 slot 0, (team 1 slot 1). */
export const seatIndex = (format: Format, team: Team, slot: Slot) =>
  format === 'doubles' ? team * 2 + slot : team;

export class MatchSim {
  readonly ball = createBall();
  readonly state: MatchState;
  readonly seats: Seat[] = [];
  referee!: Referee;
  phase: SimPhase = 'preServe';
  time = 0;
  /** Increases every time players are put in serving positions. */
  resetId = 0;
  /** Events since the last drain (cleared by the caller). */
  events: SimEvent[] = [];
  /** Power Mode: effect riding on the ball in flight. */
  ballFx: BallFx | null = null;
  /** Power Mode: slow motion until this match time (Meteor Smash). */
  slowmoUntil = -1;
  private timer = 0;
  private phaseTime = 0;
  private deadTime = 0;
  private servedAt = -Infinity;
  /** Where the current shot will first bounce (computed once per shot, shared by all bots). */
  private shotLanding: Vec3 | null | undefined = undefined;
  private ballEvents: BallEvent[] = [];
  private rand: () => number;

  constructor(
    readonly format: Format,
    private opts: MatchOptions,
  ) {
    this.rand = opts.rand ?? Math.random;
    this.state = createMatch(format, opts.firstServingTeam ?? 0);
    const slots: Slot[] = format === 'doubles' ? [0, 1] : [0];
    for (const team of [0, 1] as Team[]) {
      for (const slot of slots) {
        const index = this.seats.length;
        const character = characterInfo(opts.characterFor?.(index));
        const body = new PlayerBody(team);
        body.speedScale = character.speed;
        const court = arenaInfo(opts.arena);
        body.footSpeed = court.runSpeed;
        body.grip = court.grip;
        this.seats.push({
          index,
          team,
          slot,
          human: opts.humanSeats.includes(index),
          body,
          character,
          slowFactor: 1,
          skill: BOT_SKILLS[opts.levelFor(team, slot)],
          input: idleInput(),
          swing: new HumanSwingState(),
          prevHd: null,
          target: { x: 0, z: 0 },
          leave: false,
          volleyTime: -1,
          planAt: -1,
          meter: 0,
          combo: 0,
          armed: null,
          lastSpecial: -Infinity,
          slowUntil: -1,
        });
      }
    }
    this.setupServe();
  }

  // ---------------------------------------------------------------- control from outside

  /** Hand a seat to a person or to the AI (e.g. when someone disconnects). */
  setHuman(seat: number, human: boolean): void {
    const s = this.seats[seat];
    if (!s || s.human === human) return;
    s.human = human;
    s.input = idleInput();
    s.swing.reset();
    if (!human) {
      s.target = { x: s.body.x, z: s.body.z };
      if (this.phase === 'rally') s.planAt = this.time;
      if (this.phase === 'preServe' && this.server() === s) this.timer = BOT_SERVE_DELAY;
    } else if (this.phase === 'preServe' && this.server() === s) {
      this.timer = this.opts.serveTimeout ?? Infinity;
      this.events.push({ type: 'serveReady', seat });
    }
  }

  /** The human at `seat` clicked to serve. */
  serveRequest(seat: number): void {
    const s = this.seats[seat];
    if (this.phase === 'preServe' && s?.human && this.server() === s) this.serve(s.input.aim);
  }

  /** Click mode: the human at `seat` released a click. */
  swingRequest(seat: number, intent: SwingIntent, window?: number): void {
    const s = this.seats[seat];
    // Ignore the release of the click that just served.
    if (!s?.human || !s.input.manual || this.phase !== 'rally' || this.time - this.servedAt < 0.8) return;
    s.swing.start(intent, this.time, window);
    this.events.push({ type: 'swing', seat, ballX: this.ball.pos.x });
  }

  /** Dive toward where the player is moving, or sideways toward the ball if standing still. */
  diveRequest(seat: number): void {
    const s = this.seats[seat];
    if (!s || this.phase !== 'rally') return;
    const m = s.input.move;
    if (m.x !== 0 || m.z !== 0) s.body.dive(m.x, m.z);
    else s.body.dive(Math.sign(this.ball.pos.x - s.body.x) || 1, 0);
  }

  get power(): boolean {
    return !!this.opts.power;
  }

  /** Power Mode: arm a special (E) or the super (Q) for the next hit; the same again disarms. */
  armRequest(seat: number, kind: ArmKind | null): void {
    const s = this.seats[seat];
    if (!s || !this.power) return;
    if (kind === null || s.armed === kind) s.armed = null;
    else if (s.meter >= (kind === 'super' ? SUPER_COST : SPECIAL_COST)) s.armed = kind;
  }

  /** Whether this seat's armed special can fire now (enough meter, not cooling down). */
  private canFire(s: Seat): boolean {
    if (!this.power || !s.armed) return false;
    const cost = s.armed === 'super' ? SUPER_COST : SPECIAL_COST;
    return s.meter >= cost && this.time - s.lastSpecial >= SPECIAL_COOLDOWN;
  }

  private spend(s: Seat, kind: SpecialKind): void {
    s.meter = Math.max(0, s.meter - (kind === 'meteor' ? SUPER_COST : SPECIAL_COST));
    s.armed = null;
    s.lastSpecial = this.time;
    this.events.push({ type: 'special', seat: s.index, kind });
  }

  /** Bots decide whether to spend meter on this shot: mostly on attacking shots, rarely on dinks. */
  private botArm(s: Seat, ballY: number, shot?: ShotType): void {
    if (!this.power || s.human) return;
    s.armed = null;
    const rate = s.skill.specialRate * (shot === 'dink' ? 0.25 : shot === 'smash' ? 2 : 1);
    if (s.meter >= SUPER_COST && this.rand() < (ballY > 0.9 ? 0.6 : 0.2)) s.armed = 'super';
    else if (s.meter >= SPECIAL_COST && this.rand() < rate) s.armed = 'special';
  }

  server(): Seat {
    const slot: Slot = this.format === 'doubles' ? this.state.serverSlot : 0;
    return this.seats[seatIndex(this.format, this.state.servingTeam, slot)];
  }

  inKitchen(s: Seat): boolean {
    return Math.abs(s.body.z) <= COURT.KITCHEN;
  }

  // ---------------------------------------------------------------- serve

  private servePosition(s: Seat): Vec3 {
    const st = this.state;
    const sign = teamSign(s.team);
    const x = courtX(s.team, slotSide(st, s.team, s.slot));
    const back = sign * (COURT.LENGTH / 2 + 0.25);
    if (s.team === st.servingTeam) return v3(x, 0, back);
    if (this.format === 'singles' || s.slot === receiverSlot(st)) return v3(x, 0, back);
    return v3(x, 0, sign * (COURT.KITCHEN + 0.4)); // receiver's partner waits at the kitchen line
  }

  private setupServe(): void {
    this.phase = 'preServe';
    this.phaseTime = 0;
    this.resetId++;
    this.referee = new Referee(this.state.servingTeam, serveSide(this.state));
    for (const s of this.seats) {
      const p = this.servePosition(s);
      s.body.teleport(p.x, p.z);
      s.target = { x: p.x, z: p.z };
      s.prevHd = null;
      s.leave = false;
      s.volleyTime = -1;
      s.slowUntil = -1;
      s.slowFactor = 1;
      s.swing.reset();
    }
    this.ballFx = null;
    this.slowmoUntil = -1;
    this.holdBallForServe();
    const server = this.server();
    this.timer = server.human ? (this.opts.serveTimeout ?? Infinity) : BOT_SERVE_DELAY;
    if (server.human) this.events.push({ type: 'serveReady', seat: server.index });
  }

  private holdBallForServe(): void {
    const b = this.server().body;
    this.ball.pos = v3(b.x + b.sign * 0.3, 0.7, b.z - b.sign * 0.35);
    this.ball.vel = v3();
    this.ball.spin = v3();
  }

  /** Serve target inside the diagonal service box; a human's aim point is clamped to the box. */
  serveTarget(point: Vec3 | null): Vec3 {
    return serveTargetFor(this.state, point, this.rand);
  }

  private serve(point: Vec3 | null): void {
    const server = this.server();
    const recv = other(this.state.servingTeam);
    const target = server.human
      ? this.serveTarget(point)
      : chooseBotServe(courtX(recv, serveSide(this.state)), teamSign(recv), server.skill, this.rand);
    target.x += gauss(this.rand) * 0.3;
    target.z += gauss(this.rand) * 0.4;
    const from = cloneVec(this.ball.pos);
    const dist = Math.hypot(target.x - from.x, target.z - from.z);
    const spin = v3(-teamSign(server.team) * 15, 0, 0);
    let flight = Math.max(0.8, Math.min(1.4, dist / 11));
    // Thunder Serve: the only special allowed on a serve — fast, with a big zig of sidespin.
    if (!server.human) this.botArm(server, 0);
    if (server.armed === 'super') server.armed = null; // supers can't be served
    const thunder = this.canFire(server);
    if (thunder) {
      flight /= 1.5;
      spin.y = (this.rand() < 0.5 ? 1 : -1) * 220;
      this.spend(server, 'thunder');
    }
    const sol = solveShot(from, target, flight, spin);
    this.ball.vel = sol.vel;
    this.ball.spin = spin;
    this.ballFx = thunder ? { kind: 'thunder', team: server.team, start: this.time, flight: sol.flightTime } : null;
    this.referee.onServe();
    this.phase = 'rally';
    this.phaseTime = 0;
    this.deadTime = 0;
    this.servedAt = this.time;
    this.events.push({ type: 'served', seat: server.index });
    this.afterShot();
  }

  /** A new shot is in the air: every bot re-plans after its own reaction time. */
  private afterShot(): void {
    this.shotLanding = undefined;
    for (const s of this.seats) {
      s.prevHd = null;
      s.leave = false;
      if (!s.human) s.planAt = this.time + s.skill.reaction;
    }
  }

  // ---------------------------------------------------------------- loop

  /** Physics time scale right now (Meteor Smash slow motion). */
  get timeScale(): number {
    return this.time < this.slowmoUntil ? SLOWMO_SCALE : 1;
  }

  get arena(): ArenaId {
    return this.opts.arena ?? 'park';
  }

  step(realDt: number): void {
    // This court's physics (and the wind right now) for everything simulated this step.
    applyArena(this.arena, this.time);
    // Timers run in real time; the ball and players move in (possibly slowed) game time.
    this.time += realDt;
    this.phaseTime += realDt;
    const dt = realDt * this.timeScale;
    const locked = this.phase !== 'rally';
    for (const s of this.seats) {
      if (s.human && this.opts.remoteBodies) continue; // positions come from that player's browser
      const move = locked ? { x: 0, z: 0 } : s.human ? s.input.move : this.botMove(s);
      const slow = this.time < s.slowUntil ? s.slowFactor : 1;
      s.body.update(dt, { x: move.x * slow, z: move.z * slow });
    }

    switch (this.phase) {
      case 'preServe':
        this.holdBallForServe();
        this.timer -= dt;
        if (this.timer <= 0) this.serve(null);
        return;
      case 'pointOver':
        stepBall(this.ball, dt);
        this.timer -= dt;
        if (this.timer <= 0) {
          if (this.state.winner !== null) {
            this.phase = 'gameOver';
            this.events.push({ type: 'gameOver', winner: this.state.winner });
          } else {
            this.setupServe();
          }
        }
        return;
      case 'gameOver':
        stepBall(this.ball, dt);
        return;
      case 'rally':
        this.rallyStep(dt);
    }
  }

  private rallyStep(dt: number): void {
    const ref = this.referee;
    this.ballEvents.length = 0;
    stepBall(this.ball, dt, this.ballEvents);
    for (const e of this.ballEvents) {
      if (e.type === 'bounce') {
        ref.onBounce(e.pos);
        this.onFxBounce(e.pos.x, e.pos.z);
        const v = this.ball.vel;
        this.events.push({ type: 'bounce', x: e.pos.x, z: e.pos.z, speed: Math.hypot(v.x, v.y, v.z) });
      } else if (e.type === 'net') {
        ref.onNet();
        this.events.push({ type: 'net', x: e.pos.x });
      } else {
        this.events.push({ type: 'netcord' });
      }
    }

    for (const s of this.seats) {
      if (s.volleyTime >= 0 && this.time - s.volleyTime < VOLLEY_MOMENTUM_TIME && this.inKitchen(s)) {
        ref.onKitchenMomentum(s.team);
      }
    }

    if (!ref.result) this.tryHits();
    const v = this.ball.vel;
    const resting = this.ball.pos.y <= BALL.RADIUS + 0.01 && Math.hypot(v.x, v.y, v.z) < 0.3;
    this.deadTime = resting ? this.deadTime + dt : 0;
    if (!ref.result && this.deadTime > DEAD_BALL_TIME) ref.onTimeout();
    for (const s of this.seats) {
      if (s.planAt >= 0 && this.time >= s.planAt) {
        s.planAt = -1;
        this.planBot(s);
      }
    }
    if (ref.result) this.endPoint();
  }

  private tryHits(): void {
    const b = this.ball.pos;
    const bounced = this.referee.bouncesSinceHit > 0;
    let best: Seat | null = null;
    let bestHd = Infinity;
    for (const s of this.seats) {
      const blocked =
        !this.referee.canHit(s.team, b) ||
        (s.human && s.input.lettingGo) ||
        // Auto swing never volleys from inside the kitchen (that's an automatic fault); it waits
        // for the bounce. With mouse clicks the choice is yours.
        (s.human && !s.input.manual && !bounced && this.inKitchen(s)) ||
        (!s.human && (s.leave || (!bounced && this.inKitchen(s))));
      if (blocked) {
        s.prevHd = null;
        continue;
      }
      const hd = Math.hypot(b.x - s.body.x, b.z - s.body.z);
      const swing = s.human
        ? s.swing.wants(s.input.manual, this.time, hd, s.prevHd, b.y, this.ball.vel.y, bounced)
        : shouldSwing(hd, s.prevHd, b.y, this.ball.vel.y, bounced);
      s.prevHd = hd <= REACH ? hd : null;
      if (swing && hd < bestHd) {
        best = s;
        bestHd = hd;
      }
    }
    if (best) this.hit(best);
  }

  private hit(s: Seat): void {
    const b = this.ball.pos;
    const sign = teamSign(s.team);
    const direction = (-sign) as 1 | -1;
    const me = v3(s.body.x, 0, s.body.z);
    const intent = s.human ? s.swing.take(s.input.manual, s.input.powerHeld) : null;
    // Computer players decide shot and target from the court situation (shared AI).
    const botShot = s.human
      ? null
      : chooseBotShot(
          {
            me,
            team: s.team,
            opponents: this.seats.filter((o) => o.team !== s.team).map((o) => v3(o.body.x, 0, o.body.z)),
            ball: b,
            hits: this.referee.hits,
          },
          s.skill,
          this.rand,
        );
    let type = intent ? shotAtContact(s.input.aim, b.y, intent.power, direction) : botShot!.type;
    if (type === 'smash' && !canSmash(b.y)) type = 'drive';
    const v = this.ball.vel;
    let q = contactQuality(b, me, s.body.speed, type === 'smash', Math.hypot(v.x, v.y, v.z));
    q = Math.min(1, q * s.character.control);
    if (!s.human) {
      // Pressure: deep into a long rally even good players start to crack.
      const pressure = Math.min(0.6, Math.max(0, this.referee.hits - 10) * 0.035);
      q *= (1 - this.rand() * s.skill.sloppiness) * (1 - pressure);
    }

    // Power Mode: returning a special. Clean contact blocks it (and earns a bar); otherwise
    // it's harder to control.
    const incoming = this.power && this.ballFx && this.ballFx.team !== s.team ? this.ballFx.kind : null;
    if (incoming) {
      if (q >= BLOCK_QUALITY) {
        s.meter = Math.min(MAX_METER, s.meter + BLOCK_REWARD);
        this.events.push({ type: 'block', seat: s.index, kind: incoming });
      } else {
        q = Math.max(0, q - INCOMING_PENALTY[incoming]);
      }
    }

    // Power Mode: an armed special / super turns this shot into one.
    this.botArm(s, b.y, type);
    let special: SpecialKind | null = null;
    if (this.canFire(s)) {
      special = s.armed === 'super' ? s.character.superMove : specialFor(type);
      this.spend(s, special);
      q = Math.max(q, isSuper(special) ? 0.85 : 0.6); // specials are reliable, supers very
    }

    const { volley } = this.referee.onHit(s.team, this.inKitchen(s));
    if (volley) s.volleyTime = this.time;

    const target = s.human ? (s.input.aim ?? undefined) : botShot!.target;
    // Without a mouse aim, steering while hitting nudges the shot (world x).
    const aim = s.human ? s.input.move.x : 0;
    const from = cloneVec(b);
    let pace = shotPace(q) * (intent ? chargePace(intent.charge) : s.skill.pace) * s.character.power;
    if (this.power) pace *= comboPace(s.combo);
    if (special === 'fire') pace *= 1.6;
    if (special === 'phantom') pace *= 1.1;
    if (special === 'clone') pace *= 1.25;
    if (special === 'quake') pace *= 1.35;
    const plan = planShot({ type, from, aim, target, direction, pace, rand: this.rand });
    applyShotError(plan, q, type, this.rand);
    if (intent) applyIntent(plan, type, intent, direction, this.rand);
    // A sloppy dink floats up high, giving the other side a ball to attack.
    if (type === 'dink' && q < 0.5 && !special) plan.flightTime *= 1.35;
    if (special === 'curve') plan.spin.y = (this.rand() < 0.5 ? 1 : -1) * 320; // big visible bend
    if (special === 'meteor') {
      // Climbs high, then heavy topspin drives it down steeply.
      plan.flightTime = 1.5;
      plan.spin.x = direction * 260;
      this.slowmoUntil = this.time + SLOWMO_TIME;
    }
    if (special === 'quake') plan.spin.x = direction * 200; // dives into the court
    if (special === 'blizzard') {
      // A deep, floating shot — and the other side is frozen right away.
      plan.flightTime = Math.max(plan.flightTime, 1.6);
      this.slowTeam(other(s.team), BLIZZARD_TIME, FREEZE_SPEED);
      this.events.push({ type: 'freeze', team: other(s.team) });
    }
    const margin = special ? 0.1 : netMarginFor(q, type, this.rand);
    const sol = solveShot(from, plan.target, plan.flightTime, plan.spin, margin);
    this.ball.vel = sol.vel;
    this.ball.spin = plan.spin;
    this.ballFx = special ? { kind: special, team: s.team, start: this.time, flight: sol.flightTime } : null;

    // Power Mode: meter and combo for this hit.
    const rating = rateContact(q);
    if (this.power) {
      s.combo = rating === 'perfect' ? s.combo + 1 : 0;
      if (!special) s.meter = Math.min(MAX_METER, s.meter + meterGain(rating, s.combo, this.referee.hits));
    }
    this.events.push({ type: 'swing', seat: s.index, ballX: b.x });
    this.events.push({ type: 'hit', seat: s.index, shot: type, rating, intent, special, combo: s.combo });
    this.afterShot();
  }

  // ---------------------------------------------------------------- computer players

  /** After its reaction time: chase the ball if it's this bot's to hit, otherwise get in position. */
  private planBot(s: Seat): void {
    const home = botReadyPosition(
      {
        team: s.team,
        format: this.format,
        servingTeam: this.state.servingTeam,
        hits: this.referee.hits,
        sideX: courtX(s.team, slotSide(this.state, s.team, s.slot)),
        ballX: this.ball.pos.x,
      },
      s.skill,
    );
    s.target = { x: home.x, z: home.z };
    if (this.shotLanding === undefined) this.shotLanding = predictFirstBounce(this.ball);
    const landing = this.shotLanding;
    if (!landing) return;
    const receiving = teamOfZ(landing.z);
    if (receiving !== s.team || receiving === this.referee.lastHitTeam) return;

    // Chase a point a little past the bounce, so the ball is met on the way up.
    const v = this.ball.vel;
    const hv = Math.hypot(v.x, v.z) || 1;
    const ideal = { x: landing.x + (v.x / hv) * 0.9, z: landing.z + (v.z / hv) * 0.9 };
    // Whoever on the team is closer takes it (a human teammate counts: the bot leaves it to them).
    const dist = (o: Seat) => Math.hypot(o.body.x - ideal.x, o.body.z - ideal.z);
    const chaser = this.seats.filter((o) => o.team === s.team).reduce((a, b) => (dist(a) <= dist(b) ? a : b));
    if (chaser !== s) return;
    if (!inCourtHalf(landing, s.team) && this.rand() < s.skill.readsOut) {
      s.leave = true;
      return;
    }
    const err = () => (this.rand() * 2 - 1) * s.skill.positionError;
    // Volleys are legal from the 4th shot on (serve, return and third shot must all bounce):
    // take the ball out of the air at the kitchen line rather than backing in to let it bounce.
    if (this.referee.hits >= 3) {
      const spot = findVolleySpot(this.ball, s.team, v3(s.body.x, 0, s.body.z));
      if (spot) {
        s.target = { x: spot.x + err() * 0.5, z: spot.z };
        return;
      }
    }
    s.target = { x: ideal.x + err(), z: ideal.z + err() };
  }

  private botMove(s: Seat): { x: number; z: number } {
    const dx = s.target.x - s.body.x;
    const dz = s.target.z - s.body.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.1) return { x: 0, z: 0 };
    const m = Math.min(1, d / 0.6) * s.skill.speed;
    return { x: (dx / d) * m, z: (dz / d) * m };
  }

  // ---------------------------------------------------------------- online

  /** Everything a browser needs to draw the match (sent ~30 times a second). */
  snapshot(): Snapshot {
    const b = this.ball;
    const r = (n: number) => Math.round(n * 1000) / 1000;
    const ref = this.referee;
    return {
      time: r(this.time),
      phase: this.phase,
      resetId: this.resetId,
      ball: [b.pos.x, b.pos.y, b.pos.z, b.vel.x, b.vel.y, b.vel.z, b.spin.x, b.spin.y, b.spin.z].map(r) as Snapshot['ball'],
      seats: this.seats.map((s) => [
        r(s.body.x),
        r(s.body.z),
        r(s.body.vx),
        r(s.body.vz),
        s.body.diving ? 1 : 0,
        r(s.body.diveX),
        r(s.body.diveZ),
      ]),
      state: this.state,
      rally: {
        hits: ref.hits,
        bouncesSinceHit: ref.bouncesSinceHit,
        lastHitTeam: ref.lastHitTeam,
        decided: ref.result !== null,
        serverSeat: this.server().index,
      },
      power: this.power ? this.powerState() : null,
    };
  }

  /** Power Mode state for drawing: meters, combos, armed shots, effects, slow motion. */
  powerState(): PowerSnapshot {
    return {
      meters: this.seats.map((s) => Math.round(s.meter * 100) / 100),
      combos: this.seats.map((s) => s.combo),
      armed: this.seats.map((s) => s.armed),
      slowed: this.seats.map((s) => (this.time < s.slowUntil ? 1 : 0)),
      fx: this.ballFx,
      slowmo: this.time < this.slowmoUntil,
    };
  }

  // ---------------------------------------------------------------- scoring

  private slowTeam(team: Team, time: number, factor: number): void {
    for (const s of this.seats) {
      if (s.team !== team) continue;
      s.slowUntil = this.time + time;
      s.slowFactor = factor;
    }
  }

  /** Freeze Lob / Earthquake landing on the other side. */
  private onFxBounce(x: number, z: number): void {
    const fx = this.ballFx;
    if (!fx || teamOfZ(z) === fx.team) return;
    const hit = other(fx.team);
    if (fx.kind === 'freeze') {
      this.slowTeam(hit, FREEZE_TIME, FREEZE_SPEED);
      this.events.push({ type: 'freeze', team: hit });
      this.ballFx = null;
    } else if (fx.kind === 'quake') {
      // The court shakes: the ball skids low and sideways, and the other team is stunned.
      this.ball.vel.y *= 0.35;
      this.ball.vel.x += (this.rand() * 2 - 1) * 3;
      this.slowTeam(hit, QUAKE_STUN_TIME, QUAKE_STUN_SPEED);
      this.events.push({ type: 'quake', team: hit, x, z });
      this.ballFx = null;
    }
  }

  private endPoint(): void {
    const r = this.referee.result!;
    if (this.power) {
      for (const s of this.seats) {
        const won = s.team === r.winner;
        s.meter = Math.max(0, Math.min(MAX_METER, s.meter + (won ? POINT_WIN_GAIN : -POINT_LOSS)));
        if (!won) s.combo = 0;
        s.armed = null;
      }
    }
    this.ballFx = null;
    const outcome = applyRally(this.state, r.winner);
    this.events.push({ type: 'point', winner: r.winner, reason: r.reason, outcome });
    this.phase = 'pointOver';
    this.timer = POINT_PAUSE;
  }
}
