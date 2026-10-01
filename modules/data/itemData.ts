import {
  integer, text, choice, stringList, richText, flag,
  WEAPON_GROUPS, DAMAGE_TYPES, SKILL_TYPES, REFINE_CATEGORIES
} from './common.ts';
import type { DamageType, ModifierKey, RefineSlot, SkillType, StatKey } from '../../types/hol.ts';

const { SchemaField, NumberField, StringField, ArrayField } = foundry.data.fields;

const nullableNumber = (): DataField =>
  new NumberField({ required: false, nullable: true, integer: true, initial: null });

/** Stat bonuses are nullable so "unset" is distinguishable from "zero". */
type NullableBonuses<K extends string> = Record<K, number | null>;

/** A weapon, with up to two refine slots plus any innate attributes. */
export class WeaponData extends foundry.abstract.TypeDataModel {
  declare weaponGroup: string;
  declare damageType: DamageType;
  declare might: number;
  declare costG: number;
  declare range: { min: number; max: number };
  declare innateAttributes: string[];
  declare refines: RefineSlot[];
  declare attributeRules: { maxAttributes: number; maxAdvanced: number; noDuplicates: boolean };

  static override defineSchema(): Record<string, DataField> {
    return {
      weaponGroup: new StringField({ required: true, blank: true, initial: '', choices: ['', ...WEAPON_GROUPS] }),
      damageType: choice(DAMAGE_TYPES, 'physical'),
      might: integer(0),
      costG: integer(500, { min: 0 }),
      range: new SchemaField({
        min: integer(1, { min: 1 }),
        max: integer(1, { min: 1 })
      }),
      innateAttributes: stringList(),
      refines: new ArrayField(
        new SchemaField({ id: text(), name: text() }),
        { initial: () => [{ id: '', name: '' }, { id: '', name: '' }] }
      ),
      attributeRules: new SchemaField({
        maxAttributes: integer(2, { min: 0 }),
        maxAdvanced: integer(1, { min: 0 }),
        noDuplicates: flag(true)
      })
    };
  }
}

/** A skill or Combat Art. The `combatArt` tag plus a Charge cost distinguishes the latter. */
export class SkillData extends foundry.abstract.TypeDataModel {
  declare type: SkillType;
  declare typeGroup: string;
  declare prerequisite: string[];
  declare requiredCharge: number;
  declare effect: string;
  declare tags: string[];
  declare statBonuses: NullableBonuses<StatKey | 'hit' | 'avoid' | 'movement'>;

  static override defineSchema(): Record<string, DataField> {
    return {
      type: choice(SKILL_TYPES, 'passive'),
      typeGroup: text(),
      prerequisite: stringList(),
      requiredCharge: integer(0, { min: 0 }),
      effect: richText(),
      tags: stringList(),
      statBonuses: new SchemaField({
        hp: nullableNumber(), atk: nullableNumber(), spd: nullableNumber(), dex: nullableNumber(),
        def: nullableNumber(), res: nullableNumber(), luck: nullableNumber(),
        hit: nullableNumber(), avoid: nullableNumber(), movement: nullableNumber()
      })
    };
  }

  get isCombatArt(): boolean {
    return this.tags.includes('combatArt');
  }
}

/** A weapon attribute. Refines are data definitions, never code. */
export class RefineData extends foundry.abstract.TypeDataModel {
  declare category: string;
  declare costG: number;
  declare appliesToWeaponGroups: string[];
  declare description: string;
  declare statBonuses: NullableBonuses<StatKey | ModifierKey | 'might' | 'minRange' | 'maxRange' | 'critAvoid'>;
  declare tags: string[];

  static override defineSchema(): Record<string, DataField> {
    return {
      category: choice(REFINE_CATEGORIES, 'basic'),
      costG: integer(0, { min: 0 }),
      appliesToWeaponGroups: stringList(),
      description: richText(),
      statBonuses: new SchemaField({
        might: nullableNumber(), minRange: nullableNumber(), maxRange: nullableNumber(),
        hit: nullableNumber(), crit: nullableNumber(), critAvoid: nullableNumber(), avoid: nullableNumber(),
        atk: nullableNumber(), dex: nullableNumber(), spd: nullableNumber(),
        def: nullableNumber(), res: nullableNumber(), luck: nullableNumber()
      }),
      tags: stringList()
    };
  }
}

/** A consumable item with a limited number of uses. */
export class ConsumableData extends foundry.abstract.TypeDataModel {
  declare range: string;
  declare uses: number;
  declare costG: number;
  declare effect: string;
  declare temporaryStatBonuses: Record<StatKey | 'hit' | 'avoid' | 'crit' | 'mov', number>;
  declare tags: string[];

  static override defineSchema(): Record<string, DataField> {
    return {
      range: text(),
      uses: integer(1, { min: 0 }),
      costG: integer(0, { min: 0 }),
      effect: richText(),
      temporaryStatBonuses: new SchemaField({
        hp: integer(0), atk: integer(0), spd: integer(0), dex: integer(0),
        def: integer(0), res: integer(0), luck: integer(0),
        hit: integer(0), avoid: integer(0), crit: integer(0), mov: integer(0)
      }),
      tags: stringList()
    };
  }

  get isSpent(): boolean {
    return this.uses <= 0;
  }
}
