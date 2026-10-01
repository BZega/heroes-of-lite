/**
 * Shared rules tables and unit derivations for Heroes of Lite.
 *
 * Both the character sheet and the combat automation read from here so a unit's
 * numbers are identical wherever they are displayed or rolled.
 */

import { STATUS_DEFS, activeStatusKeys } from './effects/statuses.ts';
import type {
  AggregateStatus, DerivedStats, EquippedWeapon, KnownSkill, MovementReport, MovementType,
  StatBlock, StatKey, StatusKey, TerrainEntry, TerrainMoveClass, TerrainMoveResult, TriangleRelation,
  UnitProfile
} from '../types/hol.ts';

/**
 * Terrain effects and move rules (rules p.27).
 * `hpStart` is applied at the start of the unit's phase; `move` drives movement cost.
 */
export const TERRAIN: Record<string, TerrainEntry> = {
  '':           { label: 'None',               avoid: 0, def: 0, hpStart:  0, move: 'standard' },
  plain:        { label: 'Plain / Floor',      avoid: 0, def: 0, hpStart:  0, move: 'standard' },
  forest:       { label: 'Forest / Pillar',    avoid: 2, def: 1, hpStart:  0, move: 'rough' },
  mountain:     { label: 'Mountain / Sandbag', avoid: 3, def: 3, hpStart:  0, move: 'difficult' },
  fort:         { label: 'Fort',               avoid: 2, def: 0, hpStart:  3, move: 'rough' },
  throne:       { label: 'Throne',             avoid: 2, def: 0, hpStart:  3, move: 'rough' },
  water:        { label: 'Water',              avoid: 4, def: 2, hpStart:  0, move: 'difficult' },
  house:        { label: 'House / Altar',      avoid: 1, def: 0, hpStart:  0, move: 'standard' },
  desert:       { label: 'Desert / Rubble',    avoid: 0, def: 0, hpStart:  0, move: 'rough' },
  bridge:       { label: 'Bridge',             avoid: 0, def: 0, hpStart:  0, move: 'standard' },
  miasma:       { label: 'Miasma',             avoid: 0, def: 0, hpStart: -3, move: 'standard' },
  magicVein:    { label: 'Magic Vein / Tile',  avoid: 0, def: 0, hpStart:  0, move: 'standard', cureStatus: true },
  cursedVein:   { label: 'Cursed Vein / Tile', avoid: 0, def: 0, hpStart:  0, move: 'standard', inflicts: 'silenced' },
  pitfall:      { label: 'Pitfall',            avoid: 0, def: 0, hpStart:  0, move: 'standard', inflicts: 'shocked' },
  wall:         { label: 'Wall',               avoid: 0, def: 0, hpStart:  0, move: 'impassable' },
  crackedWall:  { label: 'Cracked Wall',       avoid: 0, def: 0, hpStart:  0, move: 'impassable', destructible: true },
  door:         { label: 'Door / Gate',        avoid: 0, def: 0, hpStart:  0, move: 'impassable', openable: true },
  chest:        { label: 'Chest / Crate',      avoid: 0, def: 0, hpStart:  0, move: 'standard', openable: true }
};

/** Movement point cost per move rule, keyed by movement type (rules p.12 / p.27). */
const MOVE_COSTS: Record<TerrainMoveClass, Record<MovementType, number>> = {
  standard:   { infantry: 1, armor: 1, cavalry: 1, flier: 1 },
  rough:      { infantry: 2, armor: 2, cavalry: 3, flier: 1 },
  difficult:  { infantry: Infinity, armor: Infinity, cavalry: Infinity, flier: 1 },
  impassable: { infantry: Infinity, armor: Infinity, cavalry: Infinity, flier: Infinity }
};

/** Magic-wielding infantry cross desert unhindered (rules p.27). */
const DESERT_MAGIC = new Set(['anima', 'light', 'dark']);

/** The slice of a unit profile that movement costs depend on. */
interface MovementContext {
  movementType?: MovementType;
  skills?: Set<string>;
  equipped?: { group?: string } | null;
}

/** Movement cost for a unit entering one tile of the given terrain. */
export function terrainMoveCost(terrainKey: string, profile: MovementContext): TerrainMoveResult & { rule: TerrainMoveClass } {
  const terrain = TERRAIN[terrainKey] ?? TERRAIN['']!;
  const movementType = profile?.movementType ?? 'infantry';
  const skills = profile?.skills ?? new Set<string>();
  const notes: string[] = [];

  let rule: TerrainMoveClass = terrain.move ?? 'standard';

  // Desert is only rough for those without the right magic.
  if (terrainKey === 'desert' && movementType === 'infantry'
    && DESERT_MAGIC.has(profile?.equipped?.group ?? '')) {
    rule = 'standard';
    notes.push('magic crosses desert freely');
  }

  if (rule === 'difficult' && terrainKey === 'mountain' && skills.has('mountain-climber')) {
    rule = 'rough';
    notes.push('Mountain Climber');
  }
  if (rule === 'difficult' && terrainKey === 'water' && skills.has('seafarer')) {
    rule = 'rough';
    notes.push('Seafarer');
  }
  if (rule === 'rough' && skills.has('acrobat')) {
    rule = 'standard';
    notes.push('Acrobat');
  }

  let cost = MOVE_COSTS[rule]?.[movementType] ?? MOVE_COSTS.standard.infantry;
  // Shadow Gambit ignores movement penalties outright (rules p.38).
  if (skills.has('shadow-gambit') && rule !== 'impassable') {
    cost = 1;
    notes.push('Shadow Gambit');
  } else if (skills.has('coral-cover') && Number.isFinite(cost)) {
    // Coral Cover doubles penalties as well as benefits (rules p.38).
    cost *= 2;
    notes.push('Coral Cover');
  }

  return {
    cost,
    passable: Number.isFinite(cost),
    rule,
    note: notes.join(', ')
  };
}

/** Every terrain a unit may enter, with the cost of doing so. */
export function movementReport(profile: MovementContext): Array<{ key: string; label: string } & TerrainMoveResult> {
  return Object.entries(TERRAIN)
    .filter(([key]) => key !== '')
    .map(([key, terrain]) => ({ key, label: terrain.label, ...terrainMoveCost(key, profile) }));
}

/** Movement, Base Aid and granted Trait per movement type (rules p.12). */
export const MOVEMENT_TYPES: Record<MovementType, { label: string; move: number; baseAid: number; trait: string | null }> = {
  infantry: { label: 'Infantry', move: 5, baseAid: 2, trait: null },
  cavalry:  { label: 'Cavalry',  move: 7, baseAid: 4, trait: 'Furred' },
  flier:    { label: 'Flier',    move: 6, baseAid: 4, trait: 'Winged' },
  armor:    { label: 'Armor',    move: 4, baseAid: 2, trait: 'Scaled' }
};

export const SIZE_NUMBERS: Record<string, number> = { small: 1, medium: 2, large: 3, extraLarge: 4 };

/** Status effects (rules p.29). Re-exported so callers have one import site. */
export { STATUS_DEFS as STATUSES } from './effects/statuses.ts';

/**
 * Fold every status a unit is carrying into one set of mechanics.
 * A unit may suffer several at once (rules p.29), so penalties combine.
 */
export function aggregateStatuses(keys: Set<StatusKey>): AggregateStatus {
  // Ordered by the status table rather than by when each was inflicted, so the
  // summary line and the sheet chips always read in the same order.
  const active = (Object.keys(STATUS_DEFS) as StatusKey[]).filter(key => keys.has(key));
  const defs = active.map(key => STATUS_DEFS[key]);

  return {
    keys: active,
    labels: defs.map(def => def.label),
    label: defs.length ? defs.map(def => def.label).join(', ') : 'Healthy',
    blocksCounter: defs.some(def => def.blocksCounter),
    blocksMagic: defs.some(def => def.blocksMagic),
    blocksMove: defs.some(def => def.blocksMove),
    indiscriminate: defs.some(def => def.indiscriminate),
    unhealable: defs.some(def => def.unhealable),
    hpStart: defs.reduce((sum, def) => sum + (def.hpStart ?? 0), 0),
    combatPenalty: defs.reduce((sum, def) => sum + (def.combatPenalty ?? 0), 0)
  };
}

/** Shifter weapon groups and the Trait they grant while Transformed (rules p.8). */
export const SHIFTER_TRAITS: Record<string, string> = { strike: 'Furred', talons: 'Winged', breath: 'Scaled' };

/** Curse weapons always carry the Fiendish trait (rules p.9). */
export const WEAPON_TRAITS: Record<string, string> = { curse: 'Fiendish' };

const PHYSICAL_TRIANGLE: Record<string, string> = { sword: 'axe', axe: 'lance', lance: 'sword' };
const MAGIC_TRIANGLE: Record<string, string> = { anima: 'light', light: 'dark', dark: 'anima' };

/** Maps the shorthand used by the Adaptive refine's `wta:` tag onto weapon groups. */
const ADAPTIVE_ALIASES: Record<string, string> = {
  stones: 'shiftingStone',
  strikes: 'strike',
  talons: 'talons',
  breaths: 'breath',
  bows: 'bow',
  daggers: 'dagger',
  staves: 'staff',
  curses: 'curse'
};

/** Refine tags that make a weapon effective against a Trait (rules p.24). */
export const EFFECTIVE_TAGS: Record<string, string> = {
  'effective:scaled': 'Scaled',
  'effective:furred': 'Furred',
  'effective:winged': 'Winged',
  'effective:fiendish': 'Fiendish'
};

/**
 * Weapon Triangle relation for an attacker against a defender.
 * @param attackerTags Refine tags on the attacker's weapon.
 */
export function triangleRelation(
  attackerGroup: string,
  defenderGroup: string,
  attackerTags: Set<string> = new Set()
): TriangleRelation {
  if (!attackerGroup || !defenderGroup) return 'neutral';

  for (const tag of attackerTags) {
    if (!tag.startsWith('wta:')) continue;
    const covered = tag.slice(4).split(',').map(entry => ADAPTIVE_ALIASES[entry.trim()] ?? entry.trim());
    if (covered.includes(defenderGroup)) return 'advantage';
  }

  for (const table of [PHYSICAL_TRIANGLE, MAGIC_TRIANGLE]) {
    if (table[attackerGroup] === defenderGroup) return 'advantage';
    if (table[defenderGroup] === attackerGroup) return 'disadvantage';
  }
  return 'neutral';
}

/** Base stat floors used during character creation (rules p.13). */
export const STAT_FLOOR: StatBlock = { hp: 15, atk: 3, spd: 3, dex: 3, def: 3, res: 3, luck: 3 };

export const STAT_LABELS: Record<StatKey, string> = {
  hp: 'HP', atk: 'Atk', spd: 'Spd', dex: 'Dex', def: 'Def', res: 'Res', luck: 'Luck'
};

/** Stat caps by level band (rules p.17). */
export function statCapsForLevel(level: number): { hp: number; stat: number } {
  const bands = [
    { max: 1,        hp: 20, stat: 8 },
    { max: 10,       hp: 30, stat: 12 },
    { max: 15,       hp: 35, stat: 16 },
    { max: 20,       hp: 40, stat: 20 },
    { max: 25,       hp: 45, stat: 24 },
    { max: Infinity, hp: 50, stat: 30 }
  ];
  const band = bands.find(entry => level <= entry.max) ?? bands[bands.length - 1]!;
  return { hp: band.hp, stat: band.stat };
}

/** Skill slots: 2 at level 1, one more every 5 levels, capped at 8 (rules p.15). */
export function skillCapForLevel(level: number): number {
  return Math.min(2 + Math.floor(level / 5), 8);
}

/** Terrain dropdown choices, labelled with the effects they grant. */
export function terrainChoices(): Record<string, string> {
  return Object.fromEntries(Object.entries(TERRAIN).map(([key, terrain]) => {
    const effects: string[] = [];
    if (terrain.avoid) effects.push(`+${terrain.avoid} Avd`);
    if (terrain.def) effects.push(`+${terrain.def} Def`);
    if (terrain.hpStart > 0) effects.push(`+${terrain.hpStart} HP`);
    if (terrain.hpStart < 0) effects.push(`${terrain.hpStart} HP`);
    if (terrain.cureStatus) effects.push('cures status');
    if (terrain.inflicts) effects.push(`inflicts ${terrain.inflicts}`);
    if (terrain.move && terrain.move !== 'standard') effects.push(terrain.move);
    return [key, effects.length ? `${terrain.label} (${effects.join(', ')})` : terrain.label];
  }));
}

const toInt = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
};

export interface BuildProfileOptions {
  /** Resolver for a weapon's refine tags. */
  weaponTags?: (item: Item) => Set<string>;
}

/** Compute every derived value for a unit in one place. */
export function buildUnitProfile(
  actor: Actor,
  { weaponTags = (): Set<string> => new Set<string>() }: BuildProfileOptions = {}
): UnitProfile {
  const system = actor?.system ?? {};
  const combatStats = system.stats ?? {};
  const bonusStats = system.bonuses ?? {};
  const tempStats = system.temp ?? {};
  const modifiers = system.modifiers ?? {};
  const nonCombat = system.nonCombat ?? {};

  const level = Math.max(1, toInt(system.level) || 1);
  const movementType: MovementType = system.movementType || 'infantry';
  const sizeCategory: string = system.size || 'medium';
  const terrainKey = Object.hasOwn(TERRAIN, system.terrain ?? '') ? (system.terrain ?? '') : '';

  const statuses = activeStatusKeys(actor);
  const status = aggregateStatuses(statuses);
  const isShocked = statuses.has('shocked');
  const injuredMod = status.combatPenalty;

  const sumStat = (key: StatKey, extra = 0): number =>
    toInt(combatStats[key] ?? STAT_FLOOR[key]) + toInt(bonusStats[key]) + toInt(tempStats[key]) + extra;

  const totals: StatBlock = {
    hp:   sumStat('hp'),
    atk:  sumStat('atk', injuredMod),
    spd:  sumStat('spd', injuredMod),
    dex:  sumStat('dex'),
    def:  sumStat('def', injuredMod),
    res:  sumStat('res', injuredMod),
    luck: sumStat('luck')
  };

  const movement = MOVEMENT_TYPES[movementType] ?? MOVEMENT_TYPES.infantry;
  const sizeNumber = SIZE_NUMBERS[sizeCategory] ?? 2;
  const terrain = TERRAIN[terrainKey] ?? TERRAIN['']!;

  // Fliers ignore terrain effects "aside from effects that cause the unit to lose or gain HP".
  const ignoresTerrain = movementType === 'flier';
  const terrainAvoid = ignoresTerrain ? 0 : terrain.avoid;
  const terrainDef = ignoresTerrain ? 0 : terrain.def;
  totals.def += terrainDef;

  // ---- Equipped weapon ----
  const equippedId = system.inventory?.equipped || '';
  const item = equippedId ? actor?.items?.get(equippedId) : null;
  const weapon = item?.type === 'weapon' ? item : null;
  const group: string = weapon?.system?.weaponGroup || '';
  const tags: Set<string> = weapon ? weaponTags(weapon) : new Set<string>();

  const gauge = Math.max(0, Math.min(4, toInt(system.gauge)));
  const isShifter = Object.hasOwn(SHIFTER_TRAITS, group);
  const isTransformed = isShifter && gauge > 0;

  const baseMight = toInt(weapon?.system?.might);
  const might = baseMight + (isTransformed ? gauge : 0);

  const equipped: EquippedWeapon | null = weapon ? {
    id: weapon.id,
    name: weapon.name,
    img: weapon.img,
    group,
    damageType: weapon.system?.damageType || 'physical',
    might,
    baseMight,
    range: {
      min: Math.max(1, toInt(weapon.system?.range?.min) || 1),
      max: Math.max(1, toInt(weapon.system?.range?.max) || 1)
    },
    tags
  } : null;

  // ---- Derived combat values (rules p.14) ----
  const hit = Math.floor(totals.dex / 4) + toInt(modifiers.hit);
  const avoid = isShocked ? 0 : Math.floor(totals.luck / 4) + 4 + terrainAvoid + toInt(modifiers.avoid);
  const critAvoid = isShocked ? 15 : avoid + 15;
  const power = totals.atk + might + toInt(modifiers.power);
  const tri = Math.floor(power / 5) + toInt(modifiers.tri);

  const effectiveSize = sizeNumber + (isTransformed ? 2 : 0);
  const con = effectiveSize + (movementType === 'armor' ? 2 : 0);
  const aid = toInt(nonCombat.strength) + movement.baseAid;

  const derived: DerivedStats = {
    hit,
    avoid,
    critAvoid,
    crit: toInt(modifiers.crit),
    power,
    tri,
    size: effectiveSize,
    con,
    aid,
    move: isShocked ? 0 : movement.move,
    charge: toInt(system.charge),
    gauge
  };

  // ---- Traits (rules p.14) ----
  const traits = new Set<string>();
  if (movement.trait) traits.add(movement.trait);
  if (WEAPON_TRAITS[group]) traits.add(WEAPON_TRAITS[group]!);
  if (isTransformed && SHIFTER_TRAITS[group]) traits.add(SHIFTER_TRAITS[group]!);
  for (const entry of String(system.trait ?? '').split(',')) {
    const trimmed = entry.trim();
    if (trimmed) traits.add(trimmed);
  }

  // ---- Known skills, keyed by the slug prerequisites reference ----
  const skills = new Set<string>();
  const skillList: KnownSkill[] = [];
  for (const skillId of system.skills ?? []) {
    const skill = skillId ? actor?.items?.get(skillId) : null;
    if (!skill) continue;
    const key = String(
      skill.flags?.['heroes-of-lite']?.skillKey
      ?? skill.flags?.['heroes-of-lite']?.sourceId
      ?? skill.name.toLowerCase().replace(/\s+/g, '-')
    ).replace(/^skill\./, '');
    skills.add(key);
    skillList.push({
      key,
      name: skill.name,
      type: skill.system?.type ?? 'passive',
      requiredCharge: Number(skill.system?.requiredCharge) || 0,
      tags: skill.system?.tags ?? []
    });
  }

  // ---- Point budgets and caps ----
  const allocatable = {
    strength:   toInt(nonCombat.strength),
    intellect:  toInt(nonCombat.intellect),
    perception: toInt(nonCombat.perception),
    charisma:   toInt(nonCombat.charisma)
  };
  const caps = statCapsForLevel(level);
  const spentCombatPoints = (Object.keys(STAT_FLOOR) as StatKey[])
    .reduce((sum, key) => sum + (toInt(combatStats[key] ?? STAT_FLOOR[key]) - STAT_FLOOR[key]), 0);

  return {
    level,
    movementType,
    statuses,
    status,
    terrainKey,
    terrain,
    ignoresTerrain,
    terrainHpStart: terrain.hpStart,
    isShifter,
    isTransformed,
    totals,
    derived,
    equipped,
    powerBonus: toInt(modifiers.power),
    traits: Array.from(traits),
    skills,
    skillList,
    skillTags: new Set(skillList.flatMap(skill => skill.tags ?? [])),
    currentHP: system.resources?.hp?.value ?? totals.hp,
    nonCombatStats: {
      ...nonCombat,
      ...allocatable,
      fate:       Math.min(3, Math.floor(totals.luck / 5)),
      finesse:    Math.min(3, Math.floor(totals.dex / 5)),
      acrobatics: Math.min(3, Math.floor(totals.spd / 5))
    },
    unallocatedPoints: 6 - Object.values(allocatable).reduce((sum, value) => sum + value, 0),
    unallocatedCombatPoints: 12 + (level - 1) * 3 - spentCombatPoints,
    caps: { hp: caps.hp, stat: caps.stat },
    skillCap: skillCapForLevel(level)
  };
}
