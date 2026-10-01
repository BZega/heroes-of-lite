/**
 * Shared rules tables and unit derivations for Heroes of Lite.
 *
 * Both the character sheet and the combat automation read from here so a unit's
 * numbers are identical wherever they are displayed or rolled.
 */

/** Terrain effects (rules p.27). `hpStart` is applied at the start of the unit's phase. */
export const TERRAIN = {
  '':           { label: 'None',               avoid: 0, def: 0, hpStart:  0 },
  plain:        { label: 'Plain / Floor',      avoid: 0, def: 0, hpStart:  0 },
  forest:       { label: 'Forest / Pillar',    avoid: 2, def: 1, hpStart:  0 },
  mountain:     { label: 'Mountain / Sandbag', avoid: 3, def: 3, hpStart:  0 },
  fort:         { label: 'Fort',               avoid: 2, def: 0, hpStart:  3 },
  throne:       { label: 'Throne',             avoid: 2, def: 0, hpStart:  3 },
  water:        { label: 'Water',              avoid: 4, def: 2, hpStart:  0 },
  house:        { label: 'House / Altar',      avoid: 1, def: 0, hpStart:  0 },
  desert:       { label: 'Desert / Rubble',    avoid: 0, def: 0, hpStart:  0 },
  bridge:       { label: 'Bridge',             avoid: 0, def: 0, hpStart:  0 },
  miasma:       { label: 'Miasma',             avoid: 0, def: 0, hpStart: -3 },
  magicVein:    { label: 'Magic Vein / Tile',  avoid: 0, def: 0, hpStart:  0, cureStatus: true },
  cursedVein:   { label: 'Cursed Vein / Tile', avoid: 0, def: 0, hpStart:  0, inflicts: 'silenced' },
  pitfall:      { label: 'Pitfall',            avoid: 0, def: 0, hpStart:  0, inflicts: 'shocked' }
};

/** Movement, Base Aid and granted Trait per movement type (rules p.12). */export const MOVEMENT_TYPES = {
  infantry: { label: 'Infantry', move: 5, baseAid: 2, trait: null },
  cavalry:  { label: 'Cavalry',  move: 7, baseAid: 4, trait: 'Furred' },
  flier:    { label: 'Flier',    move: 6, baseAid: 4, trait: 'Winged' },
  armor:    { label: 'Armor',    move: 4, baseAid: 2, trait: 'Scaled' }
};

export const SIZE_NUMBERS = { small: 1, medium: 2, large: 3, extraLarge: 4 };

/** Status effects (rules p.29). */
export const STATUSES = {
  healthy:  { label: 'Healthy' },
  poisoned: { label: 'Poisoned', hpStart: -4 },
  silenced: { label: 'Silenced', blocksMagic: true },
  berserk:  { label: 'Berserk' },
  broken:   { label: 'Broken', blocksCounter: true },
  shocked:  { label: 'Shocked', blocksMove: true },
  injured:  { label: 'Injured', combatPenalty: -3, unhealable: true }
};

/** Shifter weapon groups and the Trait they grant while Transformed (rules p.8). */
export const SHIFTER_TRAITS = { strike: 'Furred', talons: 'Winged', breath: 'Scaled' };

/** Curse weapons always carry the Fiendish trait (rules p.9). */
export const WEAPON_TRAITS = { curse: 'Fiendish' };

const PHYSICAL_TRIANGLE = { sword: 'axe', axe: 'lance', lance: 'sword' };
const MAGIC_TRIANGLE = { anima: 'light', light: 'dark', dark: 'anima' };

/** Maps the shorthand used by the Adaptive refine's `wta:` tag onto weapon groups. */
const ADAPTIVE_ALIASES = {
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
export const EFFECTIVE_TAGS = {
  'effective:scaled': 'Scaled',
  'effective:furred': 'Furred',
  'effective:winged': 'Winged',
  'effective:fiendish': 'Fiendish'
};

/**
 * Weapon Triangle relation for an attacker against a defender.
 * @param {string} attackerGroup
 * @param {string} defenderGroup
 * @param {Set<string>} attackerTags Refine tags on the attacker's weapon.
 * @returns {'advantage'|'disadvantage'|'neutral'}
 */
export function triangleRelation(attackerGroup, defenderGroup, attackerTags = new Set()) {
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
export const STAT_FLOOR = { hp: 15, atk: 3, spd: 3, dex: 3, def: 3, res: 3, luck: 3 };

export const STAT_LABELS = { hp: 'HP', atk: 'Atk', spd: 'Spd', dex: 'Dex', def: 'Def', res: 'Res', luck: 'Luck' };

/** Stat caps by level band (rules p.17). */
export function statCapsForLevel(level) {
  return [
    { max: 1,        hp: 20, stat: 8 },
    { max: 10,       hp: 30, stat: 12 },
    { max: 15,       hp: 35, stat: 16 },
    { max: 20,       hp: 40, stat: 20 },
    { max: 25,       hp: 45, stat: 24 },
    { max: Infinity, hp: 50, stat: 30 }
  ].find(band => level <= band.max);
}

/** Skill slots: 2 at level 1, one more every 5 levels, capped at 8 (rules p.15). */
export function skillCapForLevel(level) {
  return Math.min(2 + Math.floor(level / 5), 8);
}

/** Terrain dropdown choices, labelled with the effects they grant. */
export function terrainChoices() {
  return Object.fromEntries(Object.entries(TERRAIN).map(([key, terrain]) => {
    const effects = [];
    if (terrain.avoid) effects.push(`+${terrain.avoid} Avd`);
    if (terrain.def) effects.push(`+${terrain.def} Def`);
    if (terrain.hpStart > 0) effects.push(`+${terrain.hpStart} HP`);
    if (terrain.hpStart < 0) effects.push(`${terrain.hpStart} HP`);
    if (terrain.cureStatus) effects.push('cures status');
    if (terrain.inflicts) effects.push(`inflicts ${terrain.inflicts}`);
    return [key, effects.length ? `${terrain.label} (${effects.join(', ')})` : terrain.label];
  }));
}

const toInt = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
};

/**
 * Compute every derived value for a unit in one place.
 *
 * @param {Actor} actor
 * @param {object} [options]
 * @param {(item: Item) => Set<string>} [options.weaponTags] Resolver for a weapon's refine tags.
 * @returns {object} Totals, derived stats, traits, equipment summary and budget info.
 */
export function buildUnitProfile(actor, { weaponTags = () => new Set() } = {}) {
  const system = actor?.system ?? {};
  const combatStats = system.combatStats ?? {};
  const bonusStats = system.bonusStats ?? {};
  const tempStats = system.tempStats ?? {};
  const bonuses = system.bonuses ?? {};
  const nonCombat = system.nonCombatStats ?? {};
  const derivedStats = system.derivedStats ?? {};

  const level = Math.max(1, toInt(system.level) || 1);
  const movementType = system.movementType || 'infantry';
  const sizeCategory = system.size || 'medium';
  const statusKey = system.status || 'healthy';
  const terrainKey = Object.hasOwn(TERRAIN, system.terrain ?? '') ? (system.terrain ?? '') : '';

  const status = STATUSES[statusKey] ?? STATUSES.healthy;
  const isInjured = statusKey === 'injured';
  const isShocked = statusKey === 'shocked';
  const injuredMod = isInjured ? (status.combatPenalty ?? -3) : 0;

  const sumStat = (key, extra = 0) =>
    toInt(combatStats[key] ?? STAT_FLOOR[key]) + toInt(bonusStats[key]) + toInt(tempStats[key]) + extra;

  const totals = {
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
  const terrain = TERRAIN[terrainKey];

  // Fliers ignore terrain effects "aside from effects that cause the unit to lose or gain HP".
  const ignoresTerrain = movementType === 'flier';
  const terrainAvoid = ignoresTerrain ? 0 : terrain.avoid;
  const terrainDef = ignoresTerrain ? 0 : terrain.def;
  totals.def += terrainDef;

  // ---- Equipped weapon ----
  const equippedId = system.inventory?.equipped || '';
  const item = equippedId ? actor?.items?.get(equippedId) : null;
  const weapon = item?.type === 'weapon' ? item : null;
  const group = weapon?.system?.attributes?.weaponGroup || '';
  const tags = weapon ? weaponTags(weapon) : new Set();

  const gauge = Math.max(0, Math.min(4, toInt(derivedStats.gauge)));
  const isShifter = Object.hasOwn(SHIFTER_TRAITS, group);
  const isTransformed = isShifter && gauge > 0;

  const baseMight = toInt(weapon?.system?.details?.might);
  const might = baseMight + (isTransformed ? gauge : 0);

  const equipped = weapon ? {
    id: weapon.id,
    name: weapon.name,
    img: weapon.img,
    group,
    damageType: weapon.system?.attributes?.damageType || 'physical',
    might,
    baseMight,
    range: {
      min: Math.max(1, toInt(weapon.system?.details?.range?.min) || 1),
      max: Math.max(1, toInt(weapon.system?.details?.range?.max) || 1)
    },
    tags
  } : null;

  // ---- Derived combat values (rules p.14) ----
  const hit = Math.floor(totals.dex / 4) + toInt(bonuses.hit);
  const avoid = isShocked ? 0 : Math.floor(totals.luck / 4) + 4 + terrainAvoid + toInt(bonuses.avoid);
  const critAvoid = isShocked ? 15 : avoid + 15;
  const power = totals.atk + might + toInt(bonuses.power);
  const tri = Math.floor(power / 5) + toInt(bonuses.tri);

  const effectiveSize = sizeNumber + (isTransformed ? 2 : 0);
  const con = effectiveSize + (movementType === 'armor' ? 2 : 0);
  const aid = toInt(nonCombat.strength) + movement.baseAid;

  const derived = {
    ...derivedStats,
    hit,
    avoid,
    critAvoid,
    crit: toInt(derivedStats.crit),
    power,
    tri,
    size: effectiveSize,
    con,
    aid,
    move: isShocked ? 0 : movement.move,
    charge: toInt(derivedStats.charge),
    gauge
  };

  // ---- Traits (rules p.14) ----
  const traits = new Set();
  if (movement.trait) traits.add(movement.trait);
  if (WEAPON_TRAITS[group]) traits.add(WEAPON_TRAITS[group]);
  if (isTransformed) traits.add(SHIFTER_TRAITS[group]);
  for (const entry of String(system.trait ?? '').split(',')) {
    const trimmed = entry.trim();
    if (trimmed) traits.add(trimmed);
  }

  // ---- Known skills, keyed by the slug prerequisites reference ----
  const skills = new Set();
  const skillList = [];
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
      type: skill.system?.attributes?.type ?? 'passive',
      requiredCharge: Number(skill.system?.details?.requiredCharge) || 0,
      tags: skill.system?.details?.tags ?? []
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
  const spentCombatPoints = Object.keys(STAT_FLOOR)
    .reduce((sum, key) => sum + (toInt(combatStats[key] ?? STAT_FLOOR[key]) - STAT_FLOOR[key]), 0);

  return {
    level,
    movementType,
    statusKey,
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
    powerBonus: toInt(bonuses.power),
    traits: Array.from(traits),
    skills,
    skillList,
    currentHP: system.currentHP ?? totals.hp,
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
