/**
 * Shared schema building blocks.
 *
 * Source values live in the schema; anything calculated is assigned in
 * `prepareDerivedData` so it can never be edited or persisted.
 */

import type { StatKey } from '../../types/hol.ts';

const { SchemaField, NumberField, StringField, ArrayField, BooleanField, ObjectField, HTMLField } =
  foundry.data.fields;

export const STAT_KEYS: readonly StatKey[] = ['hp', 'atk', 'spd', 'dex', 'def', 'res', 'luck'];

interface StatBlockOptions {
  hp?: number;
  other?: number;
  min?: number;
}

/** A block of the seven combat stats. */
export function statBlock({ hp = 0, other = 0, min }: StatBlockOptions = {}): DataField {
  const field = (initial: number): DataField => new NumberField({
    required: true, integer: true, initial, ...(min === undefined ? {} : { min })
  });
  return new SchemaField(Object.fromEntries(
    STAT_KEYS.map(key => [key, field(key === 'hp' ? hp : other)])
  ));
}

/** Flat modifiers a player may set by hand, outside the stat block. */
export function modifierBlock(): DataField {
  const field = (): DataField => new NumberField({ required: true, integer: true, initial: 0 });
  return new SchemaField({
    power: field(),
    tri: field(),
    hit: field(),
    avoid: field(),
    crit: field()
  });
}

export const integer = (initial = 0, extra: DataFieldOptions = {}): DataField =>
  new NumberField({ required: true, integer: true, initial, ...extra });

export const text = (initial = '', extra: DataFieldOptions = {}): DataField =>
  new StringField({ required: true, blank: true, initial, ...extra });

export const choice = (choices: readonly string[], initial: string, extra: DataFieldOptions = {}): DataField =>
  new StringField({ required: true, choices, initial, ...extra });

export const stringList = (): DataField =>
  new ArrayField(new StringField({ required: true, blank: true }), { required: true, initial: [] });

export const richText = (): DataField => new HTMLField({ required: true, blank: true, initial: '' });

export const flag = (initial = false): DataField => new BooleanField({ required: true, initial });

export const freeObject = (initial: object = {}): DataField => new ObjectField({ required: true, initial });

export const WEAPON_GROUPS = [
  'sword', 'lance', 'axe', 'bow', 'dagger',
  'anima', 'light', 'dark', 'staff',
  'strike', 'talons', 'breath', 'shiftingStone', 'curse', 'siege'
] as const;

export const MAGICAL_WEAPON_GROUPS: ReadonlySet<string> =
  new Set(['anima', 'light', 'dark', 'shiftingStone', 'curse']);

/**
 * Name keywords that identify a weapon group, most specific first.
 * Used only to fill a blank group on creation; an explicit group always wins.
 */
const WEAPON_GROUP_KEYWORDS: readonly (readonly [RegExp, string])[] = [
  [/shifting\s*stone|\bstone\b/i, 'shiftingStone'],
  [/ballista|catapult|\borb\b|onager|meteor|blizzard|bolting|hoist/i, 'siege'],
  [/\bstaff\b|heal|mend|recover|physic|rescue|warp|fortify|catharsis|sacrifice|freeze|miswarp/i, 'staff'],
  [/curse|screech|nightmare|ravager|wretched/i, 'curse'],
  [/breath|fireball/i, 'breath'],
  [/talon|beak/i, 'talons'],
  [/strike|claw|fang|\bbite\b|\bpaw\b/i, 'strike'],
  [/\bbow\b|longbow|shortbow|skadi|silencer/i, 'bow'],
  [/dagger|knife|\bkard\b|stiletto|shuriken/i, 'dagger'],
  [/\baxe\b|hammer|\bclub\b|tomahawk|freikugel/i, 'axe'],
  [/lance|javelin|spear|naginata|vidofnir/i, 'lance'],
  [/sword|\bedge\b|\bblade\b|rapier|falchion|katana/i, 'sword'],
  [/anima|thunder|\bwind\b|\bfire\b|surge|sagittae|corvus|lightning|elfire|arcfire/i, 'anima'],
  [/light|shine|prayer|aura|seraphim|purge|nosferatu|resire|ivaldi/i, 'light'],
  [/\bdark\b|flux|waste|swarm|\bruin\b|goetia|almadel|theurgia|death|apocalypse|fenrir/i, 'dark']
];

/** Best-guess weapon group for a weapon name, or '' when nothing matches. */
export function inferWeaponGroup(name: string): string {
  for (const [pattern, group] of WEAPON_GROUP_KEYWORDS) {
    if (pattern.test(name)) return group;
  }
  return '';
}

export const MOVEMENT_TYPES = ['infantry', 'cavalry', 'flier', 'armor'] as const;
export const SIZES = ['small', 'medium', 'large', 'extraLarge'] as const;
export const DAMAGE_TYPES = ['physical', 'magical'] as const;
export const SKILL_TYPES = ['passive', 'action', 'strategy', 'technique', 'reflex'] as const;
export const REFINE_CATEGORIES = ['basic', 'advanced', 'gmOnly'] as const;
export const STATUS_KEYS = ['healthy', 'poisoned', 'silenced', 'berserk', 'broken', 'shocked', 'injured'] as const;
