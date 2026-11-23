import { COURT } from './constants';
import { CourtSide, Team, inCourtHalf, inServiceBox, other, teamOfZ } from './rules';
import { Vec3 } from './vec';

export type FaultReason =
  | 'out'
  | 'net'
  | 'serveOut'
  | 'serveKitchen'
  | 'missed'
  | 'twoBounce'
  | 'kitchenVolley'
  | 'doubleHit'
  | 'timeout';

export interface RallyResult {
  winner: Team;
  reason: FaultReason;
}

/** After a volley, stepping into the kitchen within this time is still a fault (momentum rule). */
export const VOLLEY_MOMENTUM_TIME = 0.6;

/** Decides faults for a single rally from hits and ball events. Shared by client and server. */
export class Referee {
  hits = 0;
  lastHitTeam: Team;
  bouncesSinceHit = 0;
  result: RallyResult | null = null;

  constructor(
    readonly servingTeam: Team,
    readonly serveSide: CourtSide,
  ) {
    this.lastHitTeam = servingTeam;
  }

  private fault(team: Team, reason: FaultReason): void {
    if (!this.result) this.result = { winner: other(team), reason };
  }

  /**
   * Whether `team` may hit the ball right now. Auto-swing uses this, so players are kept from
   * breaking the two-bounce rule by accident (return of serve and third shot wait for the bounce).
   */
  canHit(team: Team, ball: Vec3): boolean {
    if (this.result || this.hits === 0 || team === this.lastHitTeam) return false;
    if (teamOfZ(ball.z) !== team || this.bouncesSinceHit >= 2) return false;
    if (this.hits <= 2 && this.bouncesSinceHit === 0) return false;
    return true;
  }

  onServe(): void {
    this.hits = 1;
    this.lastHitTeam = this.servingTeam;
    this.bouncesSinceHit = 0;
  }

  /** Records a hit. `inKitchen` = hitter standing in (or on the line of) the non-volley zone. */
  onHit(team: Team, inKitchen: boolean): { volley: boolean } {
    const volley = this.bouncesSinceHit === 0;
    if (team === this.lastHitTeam) this.fault(team, 'doubleHit');
    else if (volley && this.hits <= 2) this.fault(team, 'twoBounce');
    else if (volley && inKitchen) this.fault(team, 'kitchenVolley');
    this.hits++;
    this.lastHitTeam = team;
    this.bouncesSinceHit = 0;
    return { volley };
  }

  /** The player who just volleyed stepped into the kitchen. */
  onKitchenMomentum(team: Team): void {
    this.fault(team, 'kitchenVolley');
  }

  onBounce(pos: Vec3): void {
    if (this.result) return;
    const side = teamOfZ(pos.z);
    if (this.bouncesSinceHit === 0) {
      this.bouncesSinceHit = 1;
      if (this.hits === 1) {
        const recv = other(this.servingTeam);
        if (!inServiceBox(pos, recv, this.serveSide)) {
          const kitchen = inCourtHalf(pos, recv) && Math.abs(pos.z) <= COURT.KITCHEN;
          this.fault(this.servingTeam, kitchen ? 'serveKitchen' : 'serveOut');
        }
      } else if (side === this.lastHitTeam) {
        this.fault(this.lastHitTeam, 'net');
      } else if (!inCourtHalf(pos, side)) {
        this.fault(this.lastHitTeam, 'out');
      }
    } else {
      this.bouncesSinceHit++;
      this.fault(side, 'missed');
    }
  }

  onNet(): void {
    this.fault(this.lastHitTeam, 'net');
  }

  /** Safety net for a stuck rally: the last hitter gets the point. */
  onTimeout(): void {
    this.fault(other(this.lastHitTeam), 'timeout');
  }
}
