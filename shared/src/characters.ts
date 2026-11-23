import type { SpecialKind } from './sim/power';

/**
 * The playable characters: small stat differences and a signature super each.
 * Shared so the online server plays them exactly like the browser does.
 */

export type CharacterId = 'rookie' | 'modi' | 'trump' | 'babita' | 'salman';

/** A character's super (Q, all 3 bars). */
export type SuperKind = Extract<SpecialKind, 'meteor' | 'clone' | 'quake' | 'blizzard'>;

export interface CharacterInfo {
  id: CharacterId;
  name: string;
  /** One-line style description for the select screen. */
  style: string;
  /** Run speed multiplier. */
  speed: number;
  /** Shot pace multiplier. */
  power: number;
  /** Contact-quality multiplier (accuracy). */
  control: number;
  superMove: SuperKind;
}

export const CHARACTERS: CharacterInfo[] = [
  { id: 'rookie', name: 'Rookie', style: 'All-rounder', speed: 1, power: 1, control: 1, superMove: 'meteor' },
  { id: 'modi', name: 'Modi', style: 'Strategist · precise', speed: 1, power: 0.98, control: 1.08, superMove: 'meteor' },
  { id: 'trump', name: 'Trump', style: 'Showman · big hitter', speed: 0.94, power: 1.08, control: 0.97, superMove: 'clone' },
  { id: 'babita', name: 'Babita', style: 'Speedster · quick feet', speed: 1.08, power: 0.95, control: 1, superMove: 'blizzard' },
  { id: 'salman', name: 'Salman', style: 'Powerhouse · heavy shots', speed: 0.97, power: 1.1, control: 0.95, superMove: 'quake' },
];

export const CHARACTER_IDS = CHARACTERS.map((c) => c.id);

export const characterInfo = (id: string | null | undefined): CharacterInfo =>
  CHARACTERS.find((c) => c.id === id) ?? CHARACTERS[0];

export const isCharacterId = (id: unknown): id is CharacterId =>
  typeof id === 'string' && (CHARACTER_IDS as string[]).includes(id);

/** Characters for computer players: different from the ones people picked (and each other) where possible. */
export function pickCpuCharacters(taken: CharacterId[], count: number, rand: () => number = Math.random): CharacterId[] {
  const pool = CHARACTER_IDS.filter((id) => id !== 'rookie' && !taken.includes(id));
  const out: CharacterId[] = [];
  for (let i = 0; i < count; i++) {
    const from = pool.length ? pool : CHARACTER_IDS.filter((id) => id !== 'rookie');
    const k = Math.floor(rand() * from.length);
    out.push(from[k]);
    if (pool.length) pool.splice(k, 1);
  }
  return out;
}
