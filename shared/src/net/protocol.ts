import type { Difficulty } from '../ai';
import type { Format, MatchState, Team } from '../rules';
import type { SwingIntent } from '../sim/human';
import type { SimEvent, SimPhase } from '../sim/match';
import type { ArmKind, BallFx } from '../sim/power';
import type { CharacterId } from '../characters';
import type { ArenaId } from '../arenas';

/** A court choice: a specific court, or a random one each match. */
export type ArenaChoice = ArenaId | 'random';

/** Messages between the browser and the online server (JSON over WebSocket). */

export const DEFAULT_PORT = 2567;
export const SNAPSHOT_RATE = 30;
/** Extra click window online, to absorb network delay. */
export const ONLINE_SWING_WINDOW_BONUS = 0.1;
/** A human online server serves automatically after this long. */
export const ONLINE_SERVE_TIMEOUT = 10;

export interface LobbySeat {
  team: Team;
  /** Player id sitting here, or null (a CPU fills it). */
  playerId: string | null;
  name: string | null;
  connected: boolean;
  /** The seated player's character (null for an empty seat: a CPU picks one when the match starts). */
  character: CharacterId | null;
}

export interface LobbyState {
  code: string;
  format: Format;
  /** Level of the CPUs that fill empty seats. */
  level: Difficulty;
  /** Power Mode (specials, supers) or Classic. */
  power: boolean;
  arena: ArenaChoice;
  hostId: string;
  seats: LobbySeat[];
  inGame: boolean;
  /** Listed in the public games list (anyone can join); otherwise code / invite link only. */
  isPublic: boolean;
}

/** One row of the public games list. */
export interface PublicRoom {
  code: string;
  hostName: string;
  format: Format;
  level: Difficulty;
  /** People in the room (seated or waiting). */
  players: number;
  /** Seats still played by the CPU. */
  freeSeats: number;
  inGame: boolean;
}

export interface RallySnapshot {
  hits: number;
  bouncesSinceHit: number;
  lastHitTeam: Team;
  decided: boolean;
  serverSeat: number;
}

/** Power Mode state per seat, plus what's riding on the ball. */
export interface PowerSnapshot {
  meters: number[];
  combos: number[];
  armed: (ArmKind | null)[];
  /** 1 while slowed by a Freeze Lob. */
  slowed: number[];
  fx: BallFx | null;
  /** Meteor Smash slow motion is on. */
  slowmo: boolean;
}

export interface Snapshot {
  /** Server match time (s). */
  time: number;
  phase: SimPhase;
  /** Increases whenever the server puts players in serving positions; clients snap to them. */
  resetId: number;
  /** pos, vel, spin. */
  ball: [number, number, number, number, number, number, number, number, number];
  /** Per seat: x, z, vx, vz, diving (0/1), diveX, diveZ. */
  seats: [number, number, number, number, number, number, number][];
  state: MatchState;
  rally: RallySnapshot;
  /** Null in Classic Mode. */
  power: PowerSnapshot | null;
}

export type ClientMsg =
  | {
      t: 'create';
      name: string;
      format: Format;
      level: Difficulty;
      isPublic?: boolean;
      power?: boolean;
      character?: CharacterId;
      arena?: ArenaChoice;
    }
  /** Join an open public room of this format, or open a new public one. */
  | { t: 'quick'; name: string; format: Format; level: Difficulty; character?: CharacterId }
  /** Pick your character in the room lobby. */
  | { t: 'character'; id: CharacterId }
  /** Ask for the public games list. */
  | { t: 'list' }
  | { t: 'join'; code: string; name: string; token?: string; character?: CharacterId }
  | { t: 'seat'; seat: number }
  | { t: 'settings'; format?: Format; level?: Difficulty; isPublic?: boolean; power?: boolean; arena?: ArenaChoice }
  /** Power Mode: arm a special (E) / the super (Q) for your next hit; null disarms. */
  | { t: 'arm'; kind: ArmKind | null }
  | { t: 'start' }
  | { t: 'leave' }
  /** ~30 Hz while playing: your own position (you move yourself) and controls. */
  | {
      t: 'input';
      x: number;
      z: number;
      vx: number;
      vz: number;
      move: [number, number];
      aim: [number, number] | null;
      power: boolean;
      letGo: boolean;
      manual: boolean;
    }
  | { t: 'serve' }
  | { t: 'swing'; intent: SwingIntent }
  | { t: 'rematch' }
  | { t: 'ping'; at: number };

export type ServerMsg =
  | { t: 'welcome'; you: string; token: string; lobby: LobbyState }
  | { t: 'lobby'; lobby: LobbyState }
  | { t: 'error'; message: string }
  | { t: 'rooms'; rooms: PublicRoom[] }
  /** The match began (or you rejoined it). `seat` is yours. */
  | {
      t: 'start';
      seat: number;
      format: Format;
      names: [string, string];
      /** Character for every seat. */
      characters: CharacterId[];
      /** The court for this match. */
      arena: ArenaId;
      snap: Snapshot;
    }
  | { t: 'snap'; snap: Snapshot; ev: SimEvent[] }
  | { t: 'pong'; at: number };
