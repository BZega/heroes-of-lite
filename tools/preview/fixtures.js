/**
 * Mock render contexts mirroring what each sheet's `_prepareContext` produces.
 * Used only by the local preview harness.
 */

const PORTRAIT = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96">
     <rect width="96" height="96" fill="#1b2d44"/>
     <circle cx="48" cy="38" r="17" fill="#e8d49a"/>
     <path d="M16 92c0-18 14-30 32-30s32 12 32 30z" fill="#e8d49a"/>
   </svg>`
);

const weaponItem = (id, name) => ({ id, name });

export const actorContext = {
  name: 'Seris Aldwin',
  img: PORTRAIT,
  hpPercent: 68,
  unallocatedPoints: 0,
  system: {
    level: 7,
    race: 'Human',
    money: 1250,
    size: 'medium',
    status: 'healthy',
    terrain: 'forest',
    trait: 'Noble',
    movementType: 'cavalry',
    weaponProficiency: 'lance',
    currentHP: 21,    combatStats: { hp: 31, atk: 12, spd: 11, dex: 10, def: 9, res: 6, luck: 8 },
    tempStats: { hp: 0, atk: 2, spd: 0, dex: 0, def: 0, res: 0, luck: 0 },
    bonusStats: { hp: 0, atk: 0, spd: 1, dex: 0, def: 0, res: 0, luck: 0 },
    bonuses: { power: 0, tri: 0, hit: 2, avoid: 0 },
    nonCombatStats: {
      strength: 2, intellect: 1, perception: 1, charisma: 2,
      fate: 1, finesse: 2, acrobatics: 2
    },
    derivedStats: {
      hit: 4, avoid: 8, crit: 0, critAvoid: 23, power: 23, tri: 4,
      size: 2, con: 2, aid: 6, move: 7, charge: 2, gauge: 1
    }
  },
  combatStatTotals: { hp: 31, atk: 14, spd: 12, dex: 10, def: 10, res: 6, luck: 8 },
  statCaps: { hp: 30, stat: 12 },
  overCapStats: ['hp'],
  unallocatedCombatPoints: 0,
  traits: ['Furred', 'Noble'],
  showGauge: false,
  isTransformed: false,
  combatStatRows: [
    { key: 'hp', label: 'HP', total: 31, base: 31, temp: 0, bonus: 0, min: 15, max: 30, overCap: true },
    { key: 'atk', label: 'Atk', total: 14, base: 12, temp: 2, bonus: 0, min: 3, max: 12, overCap: false },
    { key: 'spd', label: 'Spd', total: 12, base: 11, temp: 0, bonus: 1, min: 3, max: 12, overCap: false },
    { key: 'dex', label: 'Dex', total: 10, base: 10, temp: 0, bonus: 0, min: 3, max: 12, overCap: false },
    { key: 'def', label: 'Def', total: 10, base: 9, temp: 0, bonus: 0, min: 3, max: 12, overCap: false },
    { key: 'res', label: 'Res', total: 6, base: 6, temp: 0, bonus: 0, min: 3, max: 12, overCap: false },
    { key: 'luck', label: 'Luck', total: 8, base: 8, temp: 0, bonus: 0, min: 3, max: 12, overCap: false }
  ],
  weaponSlots: [
    { item: weaponItem('w1', 'Silver Lance'), equipped: true },
    { item: weaponItem('w2', 'Killer Lance'), equipped: false },
    { item: null, equipped: false },
    { item: null, equipped: false },
    { item: null, equipped: false }
  ],
  itemSlots: [
    { item: weaponItem('i1', 'Vulnerary') },
    { item: weaponItem('i2', 'Antitoxin') },
    { item: null },
    { item: null }
  ],
  skillSlots: [
    { item: weaponItem('s1', 'Canter') },
    { item: weaponItem('s2', 'Darting Blow') },
    { item: weaponItem('s3', 'Heritor of Furs') },
    { item: null }, { item: null }, { item: null }, { item: null }, { item: null }
  ],
  supportList: [
    { id: 'a1', name: 'Rowan Vale', level: 'B' },
    { id: 'a2', name: 'Mira Thorne', level: 'C' }
  ],
  terrainOptions: {
    '': 'None',
    plain: 'Plain / Floor',
    forest: 'Forest / Pillar (+2 Avd, +1 Def)',
    mountain: 'Mountain / Sandbag (+3 Avd, +3 Def)',
    fort: 'Fort (+2 Avd, +3 HP)',
    throne: 'Throne (+2 Avd, +3 HP)',
    water: 'Water (+4 Avd, +2 Def)',
    house: 'House / Altar (+1 Avd)',
    desert: 'Desert / Rubble',
    bridge: 'Bridge',
    miasma: 'Miasma (-3 HP)',
    magicVein: 'Magic Vein / Tile (cures status)',
    cursedVein: 'Cursed Vein / Tile (inflicts silenced)',
    pitfall: 'Pitfall (inflicts shocked)'
  }
};

export const weaponContext = {
  name: 'Killer Lance',
  img: PORTRAIT,
  system: {
    attributes: { weaponGroup: 'lance', damageType: 'physical' },
    details: {
      might: 11,
      costG: 3200,
      range: { min: 1, max: 1 },
      innateAttributes: ['refine.killer'],
      refines: [
        { id: 'refine.steel', name: 'Steel' },
        { id: '', name: '' }
      ]
    }
  },
  innateRefines: [{ id: 'refine.killer', name: 'Killer' }]
};

export const refineContext = {
  name: 'Brave',
  img: PORTRAIT,
  system: {
    category: 'advanced',
    costG: 5000,
    appliesToWeaponGroups: ['sword', 'lance', 'axe', 'bow'],
    description: 'When this unit initiates combat, it attacks twice in a row before the opponent may respond.',
    statBonuses: {
      might: -2, minRange: 0, maxRange: 0, hit: -10, crit: 0,
      critAvoid: 0, avoid: 0, atk: 0, dex: 0, spd: 0, def: 0, res: 0, luck: 0
    }
  }
};

export const consumableContext = {
  name: 'Elixir',
  img: PORTRAIT,
  system: {
    details: {
      range: 'Self',
      uses: 3,
      costG: 2000,
      effect: 'Restores all HP to the user and removes one negative status effect.',
      temporaryStatBonuses: {
        hp: 0, atk: 0, spd: 0, dex: 0, def: 0, res: 0,
        luck: 0, hit: 0, avoid: 0, crit: 0, mov: 0
      }
    }
  }
};

export const skillContext = {
  name: 'Luna',
  img: PORTRAIT,
  system: {
    attributes: { type: 'technique' },
    details: {
      typeGroup: 'combat',
      requiredCharge: '2',
      prerequisite: ['level:10', 'weapon:sword|lance|axe'],
      effect: 'Halve the target\'s Def or Res (whichever applies) for this attack.'
    }
  }
};

export const forecastContext = {
  distance: 1,
  spdDiff: 5,
  rangeHint: 'Range 1-1, target is 1 away',
  outOfRange: false,
  attacker: {
    name: 'Seris Aldwin',
    img: PORTRAIT,
    hp: 21, maxHp: 31, hpPercent: 68,
    weapon: 'Silver Lance',
    canAct: true,
    damage: 17,
    attackCount: 2,
    hitChance: '85%',
    critChance: '15%',
    mode: 'advantage',
    triangle: 'advantage',
    effective: false,
    skills: ['Death Blow', 'Swordbreaker'],
    potential: 34
  },
  defender: {
    name: 'Bandit Brigand',
    img: PORTRAIT,
    hp: 28, maxHp: 28, hpPercent: 100,
    weapon: 'Steel Axe',
    canAct: true,
    damage: 6,
    attackCount: 1,
    hitChance: '40%',
    critChance: '0%',
    mode: 'disadvantage',
    triangle: 'disadvantage',
    effective: false,
    staffCounter: false,
    skills: ['Natural Cover'],
    potential: 6
  },
  order: [
    { side: 'attacker', label: 'Attack' },
    { side: 'defender', label: 'Counter' },
    { side: 'attacker', label: 'Follow-up' }
  ],
  weapons: [
    { id: 'w1', name: 'Silver Lance', equipped: true },
    { id: 'w2', name: 'Killer Lance', equipped: false }
  ]
};

export const actionMenuContext = {
  name: 'Seris Aldwin',
  img: PORTRAIT,
  hp: 21,
  maxHp: 31,
  hpPercent: 68,
  status: 'Healthy',
  terrain: 'Forest / Pillar (+2 Avd, +1 Def)',
  charge: 2,
  move: 7,
  weaponName: 'Silver Lance',
  traits: ['Furred', 'Noble'],
  targetName: 'Bandit Brigand',
  distance: 1,
  canAttack: true,
  canRescue: true,
  isShifter: false,
  isTransformed: false,
  isStaffUser: false,
  attackHint: '1 tile away',
  consumables: [
    { id: 'i1', name: 'Vulnerary', uses: 5, spent: false },
    { id: 'i2', name: 'Antitoxin', uses: 0, spent: true }
  ]
};
