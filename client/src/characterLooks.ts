import type { CharacterId } from '@picklebros/shared';

/** How each character is drawn: outfit colours and their bobblehead (built by tools/build-characters.mjs). */
export interface CharacterLook {
  shirt: number;
  shorts: number;
  skin: number;
  shoes: number;
  /** Head file in public/characters/, or null for the default cartoon head. */
  head: string | null;
  /** Bobblehead size: the real head is enlarged this much. */
  headScale: number;
  /** Short line for the select screen. */
  blurb: string;
}

export const LOOKS: Record<CharacterId, CharacterLook> = {
  rookie: { shirt: 0xff7a1a, shorts: 0x23272e, skin: 0xd9a37a, shoes: 0xf2f2f2, head: null, headScale: 1, blurb: 'Balanced' },
  modi: { shirt: 0xf3efe4, shorts: 0xc9a46a, skin: 0xb57e5a, shoes: 0xf2f2f2, head: 'modi', headScale: 2.4, blurb: 'Precise' },
  trump: { shirt: 0x22305c, shorts: 0x22305c, skin: 0xe8b38f, shoes: 0x1a1a1a, head: 'trump', headScale: 2.5, blurb: 'Big hitter' },
  babita: { shirt: 0xe23d7a, shorts: 0x2b2b44, skin: 0xd9a27e, shoes: 0xf2f2f2, head: 'babita', headScale: 2.3, blurb: 'Quick feet' },
  salman: { shirt: 0x1c1c1c, shorts: 0x3c5a7a, skin: 0xc68d68, shoes: 0xf2f2f2, head: 'salman', headScale: 2.4, blurb: 'Heavy shots' },
};

/** Team colours for the ring under each player. */
export const TEAM_COLORS = [0xff7a1a, 0x7b61ff];
