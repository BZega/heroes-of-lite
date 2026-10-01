/**
 * World migration to the V14 DataModel schema.
 *
 * Only source values are carried across. Everything calculated is dropped and
 * recomputed by `prepareDerivedData`, so a bad legacy figure cannot survive.
 */

import { SYSTEM_ID } from './constants.ts';
import { statusEffectData, isStatusKey, activeStatusKeys } from './effects/statuses.ts';

/** Bump when the schema changes. Worlds below this are migrated on load. */
export const SCHEMA_VERSION = 3;

const num = (value: unknown, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
};

const STAT_KEYS = ['hp', 'atk', 'spd', 'dex', 'def', 'res', 'luck'];

/** A thrown value is not guaranteed to be an Error, so report it defensively. */
const reason = (error: unknown): string => error instanceof Error ? error.message : String(error);

const statBlock = (source: Record<string, unknown> | undefined, { hp = 0, other = 0 } = {}): Record<string, number> =>
  Object.fromEntries(
    STAT_KEYS.map(key => [key, num(source?.[key], key === 'hp' ? hp : other)])
  );

/**
 * Translate a legacy unit into the new schema.
 * @returns Update data, or null when nothing needs changing.
 */
export function migrateUnit(system: Record<string, any> | null | undefined): Record<string, any> | null {
  if (!system || system.stats) return null;

  const derived = system.derivedStats ?? {};

  return {
    level: num(system.level, 1),
    race: system.race ?? '',
    money: num(system.money),
    size: system.size || 'medium',
    movementType: system.movementType || 'infantry',
    weaponProficiency: system.weaponProficiency ?? '',
    trait: system.trait ?? '',
    terrain: system.terrain ?? '',
    // Statuses live on Active Effects now; `migrateStatus` carries the old value across.
    status: 'healthy',

    resources: { hp: { value: num(system.currentHP, num(system.combatStats?.hp, 15)) } },

    stats: statBlock(system.combatStats, { hp: 15, other: 3 }),
    bonuses: statBlock(system.bonusStats),
    temp: statBlock(system.tempStats),

    // `bonuses` used to hold flat combat modifiers; they become `modifiers`.
    modifiers: {
      power: num(system.bonuses?.power),
      tri: num(system.bonuses?.tri),
      hit: num(system.bonuses?.hit),
      avoid: num(system.bonuses?.avoid),
      crit: num(derived.crit)
    },

    // Fate, Finesse and Acrobatics are derived from Luck, Dex and Spd, so they are not carried over.
    nonCombat: {
      strength: num(system.nonCombatStats?.strength),
      intellect: num(system.nonCombatStats?.intellect),
      perception: num(system.nonCombatStats?.perception),
      charisma: num(system.nonCombatStats?.charisma)
    },

    // Charge and Gauge were filed under derived data but are genuinely source values.
    charge: num(derived.charge),
    gauge: Math.min(4, Math.max(0, num(derived.gauge))),

    skills: Array.isArray(system.skills) ? system.skills : [],
    inventory: {
      weapons: system.inventory?.weapons ?? [],
      items: system.inventory?.items ?? [],
      equipped: system.inventory?.equipped ?? ''
    },
    supports: system.supports ?? {},
    activeSupport: system.activeSupport ?? '',
    supportLine: system.supportLine ?? '',

    '-=combatStats': null,
    '-=bonusStats': null,
    '-=tempStats': null,
    '-=nonCombatStats': null,
    '-=derivedStats': null,
    '-=currentHP': null,
    '-=personalSkill': null
  };
}

/** Translate a legacy item of any supported subtype. */
export function migrateItem(type: string, system: Record<string, any> | null | undefined): Record<string, any> | null {
  if (!system) return null;
  const details = system.details ?? {};
  const attributes = system.attributes ?? {};

  switch (type) {
    case 'weapon': {
      if (system.weaponGroup !== undefined) return null;
      return {
        weaponGroup: attributes.weaponGroup ?? '',
        damageType: attributes.damageType || 'physical',
        might: num(details.might),
        costG: num(details.costG, 500),
        range: { min: Math.max(1, num(details.range?.min, 1)), max: Math.max(1, num(details.range?.max, 1)) },
        innateAttributes: details.innateAttributes ?? [],
        refines: (details.refines ?? []).length === 2
          ? details.refines.map((slot: { id?: string; name?: string }) => ({ id: slot?.id ?? '', name: slot?.name ?? '' }))
          : [{ id: '', name: '' }, { id: '', name: '' }],
        attributeRules: {
          maxAttributes: num(details.attributeRules?.maxAttributes, 2),
          maxAdvanced: num(details.attributeRules?.maxAdvanced, 1),
          noDuplicates: details.attributeRules?.noDuplicates ?? true
        },
        '-=attributes': null,
        '-=details': null
      };
    }

    case 'skill': {
      if (system.typeGroup !== undefined) return null;
      const prerequisite = Array.isArray(details.prerequisite)
        ? details.prerequisite
        : String(details.prerequisite ?? '').split(',').map(entry => entry.trim()).filter(Boolean);
      return {
        type: attributes.type || 'passive',
        typeGroup: details.typeGroup ?? '',
        prerequisite,
        requiredCharge: num(details.requiredCharge),
        effect: details.effect ?? '',
        tags: details.tags ?? [],
        '-=attributes': null,
        '-=details': null
      };
    }

    case 'consumable': {
      if (system.uses !== undefined) return null;
      return {
        range: details.range ?? '',
        uses: num(details.uses, 1),
        costG: num(details.costG),
        effect: details.effect ?? '',
        temporaryStatBonuses: details.temporaryStatBonuses ?? {},
        tags: details.tags ?? [],
        '-=attributes': null,
        '-=details': null
      };
    }

    // Refines were already flat, so there is nothing to move.
    default:
      return null;
  }
}

/**
 * The status Active Effect a legacy `system.status` string becomes, or null.
 * Pre-migration worlds have no record of who inflicted it, so it is left without
 * a phase owner and will not count down until a GM reapplies it.
 */
export function migrateStatus(system: Record<string, any> | null | undefined): Record<string, unknown> | null {
  const legacy = system?.status;
  if (!legacy || legacy === 'healthy' || !isStatusKey(legacy)) return null;
  return statusEffectData(legacy, { phaseOwner: null });
}

/** Apply migrations to every actor and item in the world, logging anything that fails. */
export async function migrateWorld(): Promise<{ migrated: number; failures: string[] }> {
  const failures: string[] = [];
  let migrated = 0;

  const migrateActor = async (actor: Actor): Promise<void> => {
    try {
      const statusEffect = migrateStatus(actor.system);
      const update = migrateUnit(actor.system);
      const embedded = [];

      for (const item of actor.items) {
        const itemUpdate = migrateItem(item.type, item.system);
        if (itemUpdate) embedded.push({ _id: item.id, system: itemUpdate });
      }

      if (update) await actor.update({ system: update }, { diff: false, recursive: false });
      if (embedded.length) await actor.updateEmbeddedDocuments('Item', embedded);
      if (statusEffect && !activeStatusKeys(actor).size) {
        await actor.createEmbeddedDocuments('ActiveEffect', [statusEffect]);
        // Blank the legacy field so the Active Effect is the only source of truth.
        // Worlds already on schema 2 skip `migrateUnit`, so this cannot ride along with it.
        await actor.update({ 'system.status': 'healthy' });
      }
      if (update || embedded.length || statusEffect) migrated++;
    } catch (error) {
      failures.push(`Actor "${actor.name}" (${actor.id}): ${reason(error)}`);
      console.error('HoL | Migration failed for actor', actor, error);
    }
  };

  for (const actor of game.actors) await migrateActor(actor);

  for (const item of game.items) {
    try {
      const update = migrateItem(item.type, item.system);
      if (update) {
        await item.update({ system: update }, { diff: false, recursive: false });
        migrated++;
      }
    } catch (error) {
      failures.push(`Item "${item.name}" (${item.id}): ${reason(error)}`);
      console.error('HoL | Migration failed for item', item, error);
    }
  }

  for (const scene of game.scenes) {
    for (const token of scene.tokens) {
      // Unlinked tokens carry their own actor data and need migrating too.
      if (token.actorLink || !token.actor) continue;
      await migrateActor(token.actor);
    }
  }

  if (failures.length) {
    ui.notifications?.error(
      `Heroes of Lite: ${failures.length} document(s) failed to migrate. See the console.`,
      { permanent: true }
    );
    console.error(`HoL | Migration failures:\n${failures.join('\n')}`);
  } else {
    ui.notifications?.info(`Heroes of Lite: migrated ${migrated} document(s) to the V14 schema.`);
  }

  console.log(`HoL | Migration complete — ${migrated} migrated, ${failures.length} failed`);
  return { migrated, failures };
}

/** Run the migration when the stored schema version is behind. */
export async function migrateIfNeeded() {
  const current = game.settings.get(SYSTEM_ID, 'schemaVersion');
  if (current >= SCHEMA_VERSION) return;

  console.log(`HoL | Migrating world from schema ${current} to ${SCHEMA_VERSION}`);
  await migrateWorld();
  await game.settings.set(SYSTEM_ID, 'schemaVersion', SCHEMA_VERSION);
}
