import {
  statBlock, modifierBlock, integer, text, choice, stringList, freeObject,
  MOVEMENT_TYPES, SIZES, WEAPON_GROUPS, STATUS_KEYS
} from './common.ts';
import { TERRAIN, buildUnitProfile } from '../rules.ts';
import { weaponTags } from '../refineIndex.ts';
import type {
  DerivedStats, EquippedWeapon, MovementType, NonCombatStats, SizeCategory,
  StatBlock, ModifierBlock, SupportRank
} from '../../types/hol.ts';

const { SchemaField, StringField, ArrayField } = foundry.data.fields;

/**
 * A combat unit.
 *
 * Everything in the schema is a source value the player owns. Calculated figures
 * are attached as `system.derived` during data preparation and are never stored.
 */
export default class UnitData extends foundry.abstract.TypeDataModel {
  // ---- Source, as defined by the schema below ----
  declare level: number;
  declare race: string;
  declare money: number;
  declare size: SizeCategory;
  declare movementType: MovementType;
  declare weaponProficiency: string;
  declare trait: string;
  declare terrain: string;
  /** @deprecated Statuses live on Active Effects; retained for unmigrated worlds. */
  declare status: string;
  declare resources: { hp: { value: number } };
  declare stats: StatBlock;
  declare bonuses: StatBlock;
  declare temp: StatBlock;
  declare modifiers: ModifierBlock;
  declare nonCombat: Pick<NonCombatStats, 'strength' | 'intellect' | 'perception' | 'charisma'>;
  declare charge: number;
  declare gauge: number;
  declare skills: (string | null)[];
  declare inventory: { weapons: string[]; items: string[]; equipped: string };
  declare supports: Record<string, SupportRank>;
  declare activeSupport: string;
  declare supportLine: string;

  // ---- Derived, assigned in prepareDerivedData and never persisted ----
  declare derived: DerivedStats;
  declare totals: StatBlock;
  declare traits: string[];
  declare nonCombatDerived: NonCombatStats;
  declare caps: { hp: number; stat: number };
  declare skillCap: number;
  declare points: { combat: number; nonCombat: number };
  declare isShifter: boolean;
  declare isTransformed: boolean;
  declare equippedWeapon: EquippedWeapon | null;

  static override defineSchema(): Record<string, DataField> {
    return {
      level: integer(1, { min: 1 }),
      race: text(),
      money: integer(0, { min: 0 }),
      size: choice(SIZES, 'medium'),
      movementType: choice(MOVEMENT_TYPES, 'infantry'),
      weaponProficiency: new StringField({ required: true, blank: true, initial: '', choices: ['', ...WEAPON_GROUPS] }),
      trait: text(),
      terrain: new StringField({ required: true, blank: true, initial: '', choices: Object.keys(TERRAIN) }),

      // Deprecated: statuses live on Active Effects. Kept so a world that has not
      // migrated yet still reads correctly; `migrateStatus` blanks it.
      status: choice(STATUS_KEYS, 'healthy'),

      resources: new SchemaField({
        hp: new SchemaField({ value: integer(15, { min: 0 }) })
      }),

      stats: statBlock({ hp: 15, other: 3, min: 0 }),
      bonuses: statBlock(),
      temp: statBlock(),
      modifiers: modifierBlock(),

      nonCombat: new SchemaField({
        strength: integer(0, { min: 0, max: 3 }),
        intellect: integer(0, { min: 0, max: 3 }),
        perception: integer(0, { min: 0, max: 3 }),
        charisma: integer(0, { min: 0, max: 3 })
      }),

      charge: integer(0, { min: 0 }),
      gauge: integer(0, { min: 0, max: 4 }),

      skills: new ArrayField(new StringField({ required: true, blank: true, nullable: true }), { initial: [] }),

      inventory: new SchemaField({
        weapons: stringList(),
        items: stringList(),
        equipped: text()
      }),

      supports: freeObject(),

      // One support may be active per map and the pairing must be mutual (rules p.21).
      activeSupport: text(),

      // Infantry choose which bonus line they grant their partner (rules p.21).
      supportLine: new StringField({ required: true, blank: true, initial: '', choices: ['', 'cavalry', 'flier', 'armor'] })
    };
  }

  /**
   * Derived figures are recomputed from source on every preparation, so they stay
   * correct without a sheet being open and can never drift.
   */
  override prepareDerivedData(): void {
    const profile = buildUnitProfile(this.parent, { weaponTags });

    this.derived = profile.derived;
    this.totals = profile.totals;
    this.traits = profile.traits;
    this.nonCombatDerived = profile.nonCombatStats;
    this.caps = profile.caps;
    this.skillCap = profile.skillCap;
    this.points = {
      combat: profile.unallocatedCombatPoints,
      nonCombat: profile.unallocatedPoints
    };
    this.isShifter = profile.isShifter;
    this.isTransformed = profile.isTransformed;
    this.equippedWeapon = profile.equipped;
  }

  /** Current hit points, clamped to the derived maximum. */
  get currentHP(): number {
    return Math.min(this.resources.hp.value, this.totals?.hp ?? this.resources.hp.value);
  }
}
