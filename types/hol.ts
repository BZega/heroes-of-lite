/**
 * Domain types shared across the system.
 *
 * These describe the shapes the rules and combat engines pass around. The
 * DataModel schemas in `modules/data` are the source of truth for persisted
 * data; the interfaces here describe the *prepared* and *derived* views of it.
 */

/* -------------------------------------------- */
/*  Primitives                                   */
/* -------------------------------------------- */

export type StatKey = 'hp' | 'atk' | 'spd' | 'dex' | 'def' | 'res' | 'luck';
export type ModifierKey = 'power' | 'tri' | 'hit' | 'avoid' | 'crit';
export type MovementType = 'infantry' | 'cavalry' | 'flier' | 'armor';
export type SizeCategory = 'small' | 'medium' | 'large' | 'extraLarge';
export type DamageType = 'physical' | 'magical';
export type SupportRank = 'C' | 'B' | 'A' | 'S';
export type StatusKey = 'poisoned' | 'silenced' | 'berserk' | 'broken' | 'shocked' | 'injured';
export type SkillType = 'technique' | 'action' | 'strategy' | 'reflex' | 'passive';
export type CombatSide = 'attacker' | 'defender';

export type StatBlock = Record<StatKey, number>;
export type ModifierBlock = Record<ModifierKey, number>;

/* -------------------------------------------- */
/*  Rules tables                                 */
/* -------------------------------------------- */

export type TerrainMoveClass = 'standard' | 'rough' | 'difficult' | 'impassable';

export interface TerrainEntry {
  label: string;
  avoid: number;
  def: number;
  hpStart: number;
  move: TerrainMoveClass;
  cureStatus?: boolean;
  inflicts?: StatusKey;
  destructible?: boolean;
  openable?: boolean;
}

export interface StatusDef {
  key: StatusKey;
  label: string;
  img: string;
  description: string;
  hpStart?: number;
  combatPenalty?: number;
  blocksMagic?: boolean;
  blocksCounter?: boolean;
  blocksMove?: boolean;
  indiscriminate?: boolean;
  unhealable?: boolean;
}

/** Every status a unit carries, folded into one set of mechanics. */
export interface AggregateStatus {
  keys: StatusKey[];
  labels: string[];
  label: string;
  blocksCounter: boolean;
  blocksMagic: boolean;
  blocksMove: boolean;
  indiscriminate: boolean;
  unhealable: boolean;
  hpStart: number;
  combatPenalty: number;
}

/** The status payload carried in an Active Effect's flags. */
export interface StatusFlagData {
  key: StatusKey;
  sourceActorId: string;
  sourceName: string;
  phaseOwner: number | null;
  remaining: number;
  unhealable: boolean;
}

export interface MovementReport {
  move: number;
  baseAid: number;
  trait: string;
}

export interface TerrainMoveResult {
  cost: number;
  passable: boolean;
  note: string;
}

/* -------------------------------------------- */
/*  Unit profile                                 */
/* -------------------------------------------- */

export interface DerivedStats {
  hit: number;
  avoid: number;
  critAvoid: number;
  crit: number;
  power: number;
  tri: number;
  size: number;
  con: number;
  aid: number;
  move: number;
  charge: number;
  gauge: number;
}

export interface EquippedWeapon {
  id: string;
  name: string;
  img: string;
  group: string;
  damageType: DamageType;
  might: number;
  baseMight: number;
  range: { min: number; max: number };
  tags: Set<string>;
}

export interface KnownSkill {
  key: string;
  name: string;
  type: SkillType;
  requiredCharge: number;
  tags: string[];
}

export interface NonCombatStats {
  strength: number;
  intellect: number;
  perception: number;
  charisma: number;
  fate: number;
  finesse: number;
  acrobatics: number;
}

/** Everything the sheet and the combat engine need about a unit. */
export interface UnitProfile {
  level: number;
  movementType: MovementType;
  statuses: Set<StatusKey>;
  status: AggregateStatus;
  terrainKey: string;
  terrain: TerrainEntry;
  ignoresTerrain: boolean;
  terrainHpStart: number;
  isShifter: boolean;
  isTransformed: boolean;
  totals: StatBlock;
  derived: DerivedStats;
  equipped: EquippedWeapon | null;
  powerBonus: number;
  traits: string[];
  skills: Set<string>;
  skillList: KnownSkill[];
  skillTags: Set<string>;
  currentHP: number;
  nonCombatStats: NonCombatStats;
  unallocatedPoints: number;
  unallocatedCombatPoints: number;
  caps: { hp: number; stat: number };
  skillCap: number;
}

/* -------------------------------------------- */
/*  Combat                                       */
/* -------------------------------------------- */

/** Everything a unit's skills contribute to one matchup. */
export interface SkillModifiers {
  stats: Record<StatKey, number>;
  hit: number;
  avoid: number;
  movement: number;
  maxRange: number;
  bonusDamage: number;
  damageTaken: number;
  physicalDamageTaken: number;
  magicalDamageTaken: number;
  enemyCritAvoid: number;
  bonusCharge: number;
  amplifyTriangle: boolean;
  cancelTriangle: boolean;
  guaranteedFollowup: boolean;
  denyFollowupBoth: boolean;
  denyFoeFollowup: boolean;
  attackFirst: boolean;
  followupBeforeCounter: boolean;
  immuneCritMultiplier: boolean;
  immuneEffective: Set<string>;
  denyChargeToFoe: boolean;
  disablePrioritySkills: boolean;
  disableFrequencySkills: boolean;
  counterAtAnyRange: boolean;
  staffInitiate: boolean;
  damageUsesLowerDefRes: boolean;
  damageVsRes: boolean;
  reverseLifesteal: boolean;
  postCombatDamage: number;
  minDamage: number;
  active: string[];
}

export type TriangleRelation = 'advantage' | 'disadvantage' | 'neutral';
export type AccuracyMode = 'normal' | 'advantage' | 'disadvantage';

/** One combatant's figures for a single matchup. */
export interface ForecastSide {
  armed: boolean;
  weaponName: string;
  weaponGroup: string;
  damageType: DamageType;
  range: { min: number; max: number };
  tags: Set<string>;
  mods: SkillModifiers;
  totals: StatBlock;
  triangle: TriangleRelation;
  effective: boolean;
  effectiveNegated: boolean;
  power: number;
  tri: number;
  damage: number;
  mitigationStat: StatKey;
  hit: number;
  avoid: number;
  critAvoidTarget: number;
  mode: AccuracyMode;
  hitNeeded: number;
  hitChance: number;
  canCrit: boolean;
  critMultiplier: number;
  critNeeded: number;
  critChance: number;
  staffCounter: boolean;
  wrathfulStaff: boolean;
  critNegatedByFoe: boolean;
  lifesteal: number;
  postCombatDamage: number;
  halvesRemainingHP: boolean;
  activeSkills: string[];

  /** Filled in by `buildForecast` once both sides are known. */
  canAct: boolean;
  strikesPerAttack: number;
  attackCount: number;
}

export interface StrikeOrderEntry {
  side: CombatSide;
  label: string;
}

export interface CombatForecast {
  distance: number;
  turn: number;
  spdDiff: number;
  attackerFollowUp: boolean;
  defenderFollowUp: boolean;
  vantage: boolean;
  desperation: boolean;
  attacker: ForecastSide;
  defender: ForecastSide;
  order: StrikeOrderEntry[];
}

/** Extra matchup facts the board supplies but the pure engine cannot know. */
export interface CombatContext {
  rematch?: boolean;
  attackerTerrainActive?: boolean;
  defenderTerrainActive?: boolean;
  attackerRescuing?: boolean;
  defenderRescuing?: boolean;
  alliesWithin?: (range: number) => number;
}

export interface PostCombatEntry {
  side: CombatSide;
  target: CombatSide;
  type: 'damage' | 'status' | 'heal';
  amount?: number;
  status?: StatusKey;
}

export interface CombatLogEntry {
  side: CombatSide;
  label: string;
  dice: number[];
  roll: number;
  total: number;
  mode: AccuracyMode;
  hit: boolean;
  crit: boolean;
  damage: number;
  targetHp: number;
}

export interface CombatResult {
  log: CombatLogEntry[];
  hp: Record<CombatSide, number>;
  postCombat: PostCombatEntry[];
  chargeGained: Record<CombatSide, number>;
  defeated: Record<CombatSide, boolean>;
}

/** Starting hit points for a resolved exchange. */
export interface CombatState {
  attacker: { hp: number; maxHp: number };
  defender: { hp: number; maxHp: number };
}

/* -------------------------------------------- */
/*  Items                                        */
/* -------------------------------------------- */

export interface RefineRecord {
  id: string;
  name: string;
  category: string;
  tags: Set<string>;
  statBonuses: Partial<Record<StatKey | ModifierKey | 'might' | 'minRange' | 'maxRange', number>>;
  description: string;
}

export interface RefineSlot {
  id: string;
  name: string;
}

export interface BuffFlagData {
  kind: 'tonic' | 'refine' | 'support' | 'combatArt';
  key: string;
  rank?: SupportRank;
}
