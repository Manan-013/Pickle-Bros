import { ArenaId, BallState, CharacterId, Difficulty, Format, MatchSim, Team, pickCpuCharacters } from '@picklebros/shared';
import type { Player } from '../entities/player';
import { FrameInfo, GameMode, ModeContext, SwingIntent, isLettingGo, isPowerHeld } from './mode';
import { MatchView } from './matchView';

const LEVEL_ORDER: Difficulty[] = ['easy', 'medium', 'hard'];
const LEVEL_NAME: Record<Difficulty, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

/** Offline match vs the computer: the shared engine runs here in the browser; you are seat 0. */
export class MatchMode implements GameMode {
  readonly side = 1 as const;
  private sim: MatchSim;
  private view: MatchView;

  constructor(
    private ctx: ModeContext,
    format: Format,
    difficulty: Difficulty = 'medium',
    power = true,
    character: CharacterId = 'rookie',
    readonly arena: ArenaId = 'park',
  ) {
    // Opponents play at the chosen level; your doubles partner is at least Medium.
    const partnerLevel = LEVEL_ORDER[Math.max(1, LEVEL_ORDER.indexOf(difficulty))];
    // You play your character; the computer players get different ones.
    const cpu = pickCpuCharacters([character], format === 'doubles' ? 3 : 1);
    this.sim = new MatchSim(format, {
      levelFor: (team: Team) => (team === 0 ? partnerLevel : difficulty),
      humanSeats: [0],
      power,
      characterFor: (seat) => (seat === 0 ? character : cpu[seat - 1]),
      arena,
    });
    const level = LEVEL_NAME[difficulty];
    this.view = new MatchView(
      ctx,
      format,
      this.sim.seats.map((s) => ({ team: s.team, slot: s.slot, body: s.body, character: s.character.id })),
      0,
      format === 'singles' ? ['You', `CPU · ${level}`] : ['You + CPU', `CPUs · ${level}`],
      undefined,
      power,
      arena,
    );
    this.flushEvents();
  }

  get ball(): BallState {
    return this.sim.ball;
  }

  get clock(): number {
    return this.sim.time;
  }

  get focus(): Player {
    return this.view.me;
  }

  private flushEvents(): void {
    this.view.handle(this.sim.events, this.sim.state);
    this.sim.events = [];
  }

  onKey(code: string): void {
    if (code === 'MouseLeft') this.sim.serveRequest(0);
    else if (code === 'Space') this.sim.diveRequest(0);
    else if (code === 'KeyE') this.sim.armRequest(0, 'special');
    else if (code === 'KeyQ') this.sim.armRequest(0, 'super');
  }

  onSwing(intent: SwingIntent): void {
    this.sim.swingRequest(0, intent);
    this.flushEvents();
  }

  fixedUpdate(dt: number): void {
    const input = this.ctx.input;
    this.sim.seats[0].input = {
      move: input.move(),
      aim: this.ctx.aimPoint(),
      powerHeld: isPowerHeld(input),
      lettingGo: isLettingGo(input),
      manual: this.ctx.swingMode() === 'manual',
    };
    this.sim.step(dt);
    this.flushEvents();
  }

  frame(dt: number): FrameInfo {
    const ref = this.sim.referee;
    return this.view.frame(
      dt,
      this.sim.ball,
      {
        phase: this.sim.phase,
        hits: ref.hits,
        bouncesSinceHit: ref.bouncesSinceHit,
        lastHitTeam: ref.lastHitTeam,
        decided: ref.result !== null,
        serverSeat: this.sim.server().index,
      },
      this.sim.state,
      this.sim.power ? this.sim.powerState() : null,
      this.sim.time,
    );
  }

  dispose(): void {
    this.view.dispose();
  }
}
