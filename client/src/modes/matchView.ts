import {
  BallState,
  COURT,
  CharacterId,
  FaultReason,
  Format,
  MAX_METER,
  MatchState,
  PlayerBody,
  PowerSnapshot,
  SPECIAL_COLOR,
  SPECIAL_COST,
  SPECIAL_NAME,
  SUPER_COST,
  SpecialKind,
  SimEvent,
  SimPhase,
  Slot,
  Team,
  Vec3,
  ArenaId,
  applyArena,
  arenaInfo,
  canSmash,
  clampTarget,
  cloneOffset,
  phantomHidden,
  predictContactTime,
  predictFirstBounce,
  scoreCall,
  serveTargetFor,
  specialFor,
  teamSign,
} from '@picklebros/shared';
import { Player } from '../entities/player';
import { shotInfo } from '../hud';
import { FrameInfo, ModeContext } from './mode';

/** What the referee says out loud for each call. */
const refereeWord: Record<FaultReason, string> = {
  out: 'Out',
  net: 'Net',
  serveOut: 'Fault',
  serveKitchen: 'Kitchen. Fault',
  missed: 'Point',
  twoBounce: 'Fault. Two bounce rule',
  kitchenVolley: 'Kitchen fault',
  doubleHit: 'Fault',
  timeout: 'Dead ball',
};

const reasonText = (reason: FaultReason, youWon: boolean): string => {
  switch (reason) {
    case 'out':
      return 'Out!';
    case 'net':
      return 'Net!';
    case 'serveOut':
      return 'Service fault!';
    case 'serveKitchen':
      return 'Serve in the kitchen!';
    case 'missed':
      return youWon ? 'Winner!' : 'Missed it!';
    case 'twoBounce':
      return 'Two-bounce rule!';
    case 'kitchenVolley':
      return 'Kitchen fault!';
    case 'doubleHit':
      return 'Double hit!';
    case 'timeout':
      return 'Dead ball';
  }
};

export interface ViewSeat {
  team: Team;
  slot: Slot;
  body: PlayerBody;
  character: CharacterId;
}

/** Rally facts the view needs (from the local engine offline, or from server snapshots online). */
export interface RallyInfo {
  phase: SimPhase;
  hits: number;
  bouncesSinceHit: number;
  lastHitTeam: Team;
  decided: boolean;
  /** Seat index of the server. */
  serverSeat: number;
}

/**
 * Everything a match looks like from one player's point of view: the 3D players, messages,
 * scoreboard, aim crosshair, landing marker and timing ring. Used by offline and online matches.
 */
export class MatchView {
  readonly players: Player[];
  readonly myTeam: Team;
  /** +1 if you play from the near (+z) end, -1 from the far end. */
  readonly side: 1 | -1;

  constructor(
    private ctx: ModeContext,
    readonly format: Format,
    seats: ViewSeat[],
    readonly mySeat: number,
    /** Display names for team 0 and team 1. */
    private teamNames: [string, string],
    /** Game-over buttons (online they mean rematch / back to the room). */
    private gameOverLabels?: [string, string],
    /** Power Mode match (specials, supers). */
    readonly power = false,
    /** The court (its physics are used for the landing marker and timing ring). */
    readonly arena: ArenaId = 'park',
  ) {
    this.players = seats.map((s) => new Player(ctx.scene, { team: s.team, character: s.character, body: s.body }));
    this.myTeam = seats[mySeat].team;
    this.side = teamSign(this.myTeam);
    ctx.hud.setView('match');
    ctx.hud.setMatchPower(power);
    ctx.sound.setCrowd(true);
    const court = arenaInfo(arena);
    for (const s of seats) {
      s.body.footSpeed = court.runSpeed;
      s.body.grip = court.grip;
    }
    if (arena !== 'park') ctx.hud.flash(court.name, 'info', court.twist);
    if (!power) {
      ctx.hud.setPower(null);
      ctx.hud.setTeamMeters(null);
    }
  }

  /** Rally length seen on the last frame (louder cheers for long rallies). */
  private rallyHits = 0;

  private seatPos(seat: number): { x: number; z: number } {
    const b = this.players[seat]?.body;
    return b ? { x: b.x, z: b.z } : { x: 0, z: 0 };
  }

  get me(): Player {
    return this.players[this.mySeat];
  }

  private get opponentsName(): string {
    return this.teamNames[1 - this.myTeam];
  }

  /** React to engine events: animations, messages, prompts, scoreboard. */
  handle(events: SimEvent[], state: MatchState): void {
    const hud = this.ctx.hud;
    for (const e of events) {
      switch (e.type) {
        case 'swing':
          this.players[e.seat]?.swingAt(e.ballX);
          this.ctx.sound.swing(this.seatPos(e.seat));
          break;
        case 'hit':
          this.ctx.sound.hit(e.shot, this.seatPos(e.seat), e.special ? 1.3 : 1);
          if (e.seat === this.mySeat && e.combo >= 2) this.ctx.sound.combo(e.combo);
          if (e.seat === this.mySeat) hud.rating(e.rating, e.shot, e.intent ?? undefined);
          this.ctx.ballView.setFx(e.special);
          if (!e.special) this.ctx.ballView.setTrailColor(shotInfo(e.shot).color);
          if (e.special) this.ctx.shake(e.special === 'meteor' ? 0.3 : 0.08);
          else if (e.shot === 'smash') {
            this.ctx.shake(0.05);
            this.ctx.venue().excite(0.25);
          }
          break;
        case 'special':
          hud.callout(`${SPECIAL_NAME[e.kind]}!`, SPECIAL_COLOR[e.kind]);
          this.ctx.venue().excite(0.5);
          this.ctx.sound.special(e.kind, this.seatPos(e.seat));
          break;
        case 'block':
          hud.callout(e.seat === this.mySeat ? 'BLOCKED! +1 BAR' : 'BLOCKED!', '#ffffff');
          this.ctx.sound.block();
          this.ctx.ballView.setFx(null);
          break;
        case 'freeze':
          hud.callout(e.team === this.myTeam ? 'FROZEN!' : 'FREEZE!', SPECIAL_COLOR.freeze);
          break;
        case 'quake':
          hud.callout(e.team === this.myTeam ? 'STUNNED!' : 'EARTHQUAKE!', SPECIAL_COLOR.quake);
          this.ctx.shake(0.4);
          this.ctx.sound.special('quake', e);
          this.ctx.ballView.setFx(null);
          break;
        case 'netcord':
          hud.flash('Net cord!', 'info');
          this.ctx.sound.net({ x: 0, z: 0 });
          break;
        case 'bounce':
          this.ctx.sound.bounce(e, e.speed);
          break;
        case 'net':
          this.ctx.sound.net({ x: e.x, z: 0 });
          break;
        case 'serveReady':
          if (e.seat === this.mySeat) hud.setPrompt('Aim with the mouse · click to serve');
          this.ctx.ballView.resetTrail();
          break;
        case 'served':
          this.ctx.sound.hit('drive', this.seatPos(e.seat), 0.8);
          hud.setPrompt(null);
          this.ctx.ballView.resetTrail();
          this.players[e.seat]?.swingAt(this.players[e.seat].position.x + 1);
          break;
        case 'point': {
          const youWon = e.winner === this.myTeam;
          const sub = e.outcome.point
            ? youWon
              ? 'Point for you'
              : `Point for ${this.opponentsName}`
            : e.outcome.secondServer
              ? 'Second server'
              : 'Side out';
          hud.flash(reasonText(e.reason, youWon), youWon ? 'good' : 'bad', sub);
          this.ctx.sound.point(youWon);
          this.ctx.venue().point(e.reason, e.winner, this.rallyHits);
          // The referee calls it, then the new score ("Out. Side out. Four, two, one").
          const next = e.outcome.sideOut ? ' Side out.' : e.outcome.secondServer ? ' Second server.' : '';
          if (state.winner === null) this.ctx.sound.say(`${refereeWord[e.reason]}.${next} ${scoreCall(state).split('-').join(', ')}`);
          for (const p of this.players) {
            if (p.team === e.winner) p.celebrate();
            else p.slump();
          }
          this.ctx.sound.cheer(Math.min(1, this.rallyHits / 14) * (youWon ? 1 : 0.6));
          hud.setBadge(null);
          hud.setPrompt(null);
          break;
        }
        case 'gameOver': {
          const won = e.winner === this.myTeam;
          const mine = state.score[this.myTeam];
          const theirs = state.score[1 - this.myTeam];
          hud.showGameOver(won ? 'You win!' : `${this.opponentsName} win`, `${mine} – ${theirs}`, won, this.gameOverLabels);
          this.ctx.sound.gameOver(won);
          this.ctx.venue().excite(1);
          this.ctx.sound.say(`Game. ${this.teamNames[e.winner]} win, ${state.score[e.winner]}, ${state.score[1 - e.winner]}`);
          break;
        }
      }
    }
    this.updateScoreboard(state);
  }

  updateScoreboard(state: MatchState): void {
    const board = {
      names: this.teamNames,
      score: state.score,
      serving: state.servingTeam,
      call: scoreCall(state),
    };
    this.ctx.hud.setScoreboard(board);
    // The stadium board only redraws when something changed.
    const key = `${board.call}|${board.serving}|${board.score.join()}`;
    if (key !== this.boardKey) {
      this.boardKey = key;
      this.ctx.venue().setBoard({
        ...board,
        serverNumber: this.format === 'doubles' ? state.serverNumber : undefined,
        status: state.winner !== null ? `GAME · ${this.teamNames[state.winner].toUpperCase()} WIN` : undefined,
      });
    }
  }

  private boardKey = '';

  /** Your meter panel and both teams' meter pips (Power Mode). */
  private updatePower(power: PowerSnapshot, rally: RallyInfo, ballY: number): void {
    const i = this.mySeat;
    const meter = power.meters[i] ?? 0;
    const armed = power.armed[i] ?? null;
    let next: SpecialKind | null = null;
    if (armed === 'super') next = 'meteor';
    else if (armed === 'special') {
      if (rally.phase === 'preServe' && rally.serverSeat === i) next = 'thunder';
      else {
        const shot = this.ctx.selectedShot();
        next = shot === 'lob' && canSmash(ballY) ? 'fire' : specialFor(shot);
      }
    }
    const cost = armed === 'super' ? SUPER_COST : SPECIAL_COST;
    this.ctx.hud.setPower({ meter, combo: power.combos[i] ?? 0, armed, next, blocked: !!armed && meter < cost });
    const best = (team: Team) => Math.max(0, ...power.meters.filter((_, k) => this.players[k].team === team));
    this.ctx.hud.setTeamMeters([Math.min(MAX_METER, best(0)), Math.min(MAX_METER, best(1))]);
  }

  /** Draw players and work out the landing marker, crosshair and timing ring for this frame. */
  frame(
    dt: number,
    ball: BallState,
    rally: RallyInfo,
    state: MatchState,
    power: PowerSnapshot | null = null,
    time = 0,
  ): FrameInfo {
    // Predictions below use this court's physics and the wind right now.
    applyArena(this.arena, time);
    for (const p of this.players) p.render(dt);
    this.rallyHits = rally.hits;
    this.ctx.sound.setListener(this.me.body.x, this.me.body.z, this.side);
    if (power) {
      this.players.forEach((p, k) => p.setFrozen(power.slowed[k] === 1));
      this.updatePower(power, rally, ball.pos.y);
      if (!power.fx) this.ctx.ballView.setFx(null);
    }
    const me = this.me.body;
    const live = rally.phase === 'rally';
    const inKitchen = Math.abs(me.z) <= COURT.KITCHEN;
    this.ctx.hud.setBadge(live && inKitchen ? 'In the kitchen: no volleys' : null);

    // Landing marker for a ball coming to your side.
    let landing: Vec3 | null = null;
    if (live && ball.vel.z * this.side > 0 && rally.bouncesSinceHit === 0) {
      const l = predictFirstBounce(ball);
      if (l && l.z * this.side > 0) landing = l;
    }
    // Aim crosshair: inside the service box while you serve, otherwise your next shot.
    const p = this.ctx.aimPoint();
    let aim: Vec3 | null = null;
    if (p && rally.phase === 'preServe' && rally.serverSeat === this.mySeat) aim = serveTargetFor(state, p);
    else if (p && live) aim = clampTarget(this.ctx.selectedShot(), p.x, p.z, (-this.side) as 1 | -1);
    // Timing ring: only in click mode, while it's your team's ball to hit.
    const yourBall = live && this.ctx.swingMode() === 'manual' && rally.lastHitTeam !== this.myTeam && !rally.decided;
    const timeToContact = yourBall
      ? predictContactTime(ball, me, this.side, rally.bouncesSinceHit, rally.hits <= 2 && rally.bouncesSinceHit === 0)
      : null;
    return {
      ballVisible: true,
      landing,
      followBall: live,
      aim,
      timeToContact,
      ghost: live && phantomHidden(power?.fx ?? null, time),
      decoy: live ? cloneOffset(power?.fx ?? null, time) : 0,
    };
  }

  dispose(): void {
    for (const p of this.players) p.dispose();
    this.ctx.sound.setCrowd(false);
    this.ctx.hud.setPower(null);
    this.ctx.hud.setTeamMeters(null);
    this.ctx.ballView.setFx(null);
    this.ctx.hud.setPrompt(null);
    this.ctx.hud.setBadge(null);
    this.ctx.hud.hideGameOver();
  }
}
