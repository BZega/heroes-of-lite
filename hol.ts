/**
 * Heroes of Lite - Main System File
 * Initializes the Heroes of Lite system for Foundry VTT.
 */

import HolWeaponSheet from './modules/sheets/holWeaponSheet.ts';
import HolRefineSheet from './modules/sheets/holRefineSheet.ts';
import HolConsumableSheet from './modules/sheets/holConsumableSheet.ts';
import HolSkillSheet from './modules/sheets/holSkillSheet.ts';
import HolActorSheet from './modules/sheets/holActorSheet.ts';
import { SYSTEM_ID } from './modules/constants.ts';
import { buildRefineIndex } from './modules/refineIndex.ts';
import UnitData from './modules/data/unitData.ts';
import { WeaponData, SkillData, RefineData, ConsumableData } from './modules/data/itemData.ts';
import HeroesOfLiteActor from './modules/documents/holActor.ts';
import HeroesOfLiteItem from './modules/documents/holItem.ts';
import { SCHEMA_VERSION, migrateIfNeeded } from './modules/migration.ts';
import { statusEffectConfig } from './modules/effects/statuses.ts';
import { registerTerrainAutomation } from './modules/automation/terrain.ts';
import { registerSupportAutomation } from './modules/automation/supports.ts';
import {
  registerApi,
  registerChatCommands,
  registerKeybindings,
  registerSceneControls,
  registerTokenHud,
  registerTurnAutomation
} from './modules/automation/register.ts';

/** Bump when seed data changes so existing worlds re-run the import. */
const SEED_VERSION = 1;

/** The inventory slots an actor template can reference. */
const SEED_SLOTS = ['skills', 'weapons', 'items'] as const;
type SeedSlot = typeof SEED_SLOTS[number];

Hooks.once('init', function () {
  console.log('Heroes of Lite | Initializing system...');

  CONFIG.Actor.documentClass = HeroesOfLiteActor;
  CONFIG.Item.documentClass = HeroesOfLiteItem;
  CONFIG.Actor.dataModels = { unit: UnitData };
  CONFIG.Item.dataModels = {
    weapon: WeaponData,
    skill: SkillData,
    refine: RefineData,
    consumable: ConsumableData
  };

  // Replace Foundry's generic conditions with the statuses from the rules (p.29).
  CONFIG.statusEffects = statusEffectConfig();
  CONFIG.specialStatusEffects.DEFEATED = 'injured';

  Handlebars.registerHelper('includes', (array, value) => Array.isArray(array) && array.includes(value));
  Handlebars.registerHelper('join', (array, separator) => (Array.isArray(array) ? array.join(separator) : ''));
  Handlebars.registerHelper('eq', (a, b) => a === b);
  Handlebars.registerHelper('add', (a, b) => Number(a ?? 0) + Number(b ?? 0));

  const { Actors, Items } = foundry.documents.collections;

  Actors.registerSheet(SYSTEM_ID, HolActorSheet, {
    types: ['unit'],
    makeDefault: true,
    label: 'HoL Character Sheet'
  });

  const itemSheets = [
    [HolWeaponSheet, 'weapon', 'HoL Weapon Sheet'],
    [HolRefineSheet, 'refine', 'HoL Refine Sheet'],
    [HolConsumableSheet, 'consumable', 'HoL Consumable Sheet'],
    [HolSkillSheet, 'skill', 'HoL Skill Sheet']
  ];
  for (const [sheetClass, type, label] of itemSheets) {
    Items.registerSheet(SYSTEM_ID, sheetClass, { types: [type], makeDefault: true, label });
  }

  game.settings.register(SYSTEM_ID, 'seedVersion', {
    name: 'Compendium Seed Version',
    scope: 'world',
    config: false,
    type: Number,
    default: 0
  });

  game.settings.register(SYSTEM_ID, 'schemaVersion', {
    name: 'World Schema Version',
    scope: 'world',
    config: false,
    type: Number,
    default: 0
  });

  registerKeybindings();
  registerTokenHud();
  registerChatCommands();
  registerSceneControls();
  registerTerrainAutomation();
  registerTurnAutomation();
  registerSupportAutomation();
});

Hooks.once('ready', async function () {
  console.log('Heroes of Lite | System ready!');
  registerApi();

  if (!game.user.isGM) {
    await buildRefineIndex();
    return;
  }

  // Refines must be indexed before migration so weapon tags resolve during derivation.
  await buildRefineIndex();
  await migrateIfNeeded();

  if (game.settings.get(SYSTEM_ID, 'seedVersion') >= SEED_VERSION) return;

  try {
    await seedWeapons();
    await seedRefines();
    await seedConsumables();
    await seedSkills();
    await seedActorTemplates();
    await game.settings.set(SYSTEM_ID, 'seedVersion', SEED_VERSION);
  } catch (error) {
    console.error('HoL | Compendium seeding aborted:', error);
    ui.notifications?.error('Heroes of Lite: compendium seeding failed. See the console for details.');
  } finally {
    await buildRefineIndex();
  }
});

/* -------------------------------------------- */
/*  Seeding helpers                              */
/* -------------------------------------------- */

/**
/** Fetch a JSON seed file bundled with the system. */
async function loadSeedFile(fileName: string): Promise<Record<string, any>[]> {
  const path = `systems/${SYSTEM_ID}/data/seed/${fileName}`;
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Unable to read seed file ${path} (HTTP ${response.status})`);
  const data = await response.json();
  if (!Array.isArray(data)) throw new Error(`Seed file ${path} did not contain an array`);
  return data;
}

/** Run a callback with the given packs temporarily unlocked, always restoring lock state. */
async function withUnlockedPacks(packs: CompendiumCollection[], callback: () => Promise<void>): Promise<void> {
  const previouslyLocked = packs.map(pack => pack.locked);
  try {
    for (const [index, pack] of packs.entries()) {
      if (previouslyLocked[index]) await pack.configure({ locked: false });
    }
    await callback();
  } finally {
    for (const [index, pack] of packs.entries()) {
      if (previouslyLocked[index]) await pack.configure({ locked: true });
    }
  }
}

/** Collect the `sourceId` flags already present in a pack. */
async function getSeededIds(pack: CompendiumCollection): Promise<Set<string>> {
  const documents = await pack.getDocuments();
  return new Set(
    documents
      .map(doc => doc.flags?.[SYSTEM_ID]?.['sourceId'] as string | undefined)
      .filter((id): id is string => !!id)
  );
}

/** Resolve a pack and log a warning if it is missing. */
function getPack(name: string): CompendiumCollection | null {
  const pack = game.packs.get(`${SYSTEM_ID}.${name}`);
  if (!pack) console.warn(`HoL | ${name} compendium pack not found`);
  return pack ?? null;
}

/* -------------------------------------------- */
/*  Seeders                                      */
/* -------------------------------------------- */

async function seedWeapons() {
  const pack = getPack('hol-weapons');
  if (!pack) return;

  await withUnlockedPacks([pack], async () => {
    const weapons = await loadSeedFile('weapons.json');
    const existingIds = await getSeededIds(pack);
    const itemData = weapons
      .filter(weapon => !existingIds.has(weapon.id))
      .map(weapon => ({
        name: weapon.name,
        type: 'weapon',
        system: {
          weaponGroup: weapon.weaponGroup,
          damageType: weapon.damageType,
          range: weapon.range,
          might: weapon.might,
          costG: weapon.costG,
          innateAttributes: weapon.innateAttributes ?? [],
          attributeRules: weapon.attributeRules,
          refines: [{ id: '', name: '' }, { id: '', name: '' }]
        },
        flags: { [SYSTEM_ID]: { sourceId: weapon.id } }
      }));

    if (!itemData.length) return;
    await Item.createDocuments(itemData, { pack: pack.collection });
    console.log(`HoL | Seeded ${itemData.length} weapons`);
  });
}

async function seedRefines() {
  const playerPack = getPack('hol-player-refines');
  const gmPack = getPack('hol-gm-refines');
  if (!playerPack || !gmPack) return;

  await withUnlockedPacks([playerPack, gmPack], async () => {
    const refines = await loadSeedFile('refines.json');
    const existingPlayerIds = await getSeededIds(playerPack);
    const existingGMIds = await getSeededIds(gmPack);

    const toItemData = (refine: Record<string, any>) => ({
      name: refine.name,
      type: 'refine',
      system: {
        category: refine.category,
        costG: refine.costG,
        appliesToWeaponGroups: refine.appliesToWeaponGroups,
        description: refine.description,
        statBonuses: refine.statBonuses ?? {},
        tags: refine.tags ?? []
      },
      flags: { [SYSTEM_ID]: { sourceId: refine.id } }
    });

    const playerData = refines
      .filter(refine => refine.category !== 'gmOnly' && !existingPlayerIds.has(refine.id))
      .map(toItemData);
    const gmData = refines
      .filter(refine => refine.category === 'gmOnly' && !existingGMIds.has(refine.id))
      .map(toItemData);

    if (playerData.length) await Item.createDocuments(playerData, { pack: playerPack.collection });
    if (gmData.length) await Item.createDocuments(gmData, { pack: gmPack.collection });
    console.log(`HoL | Seeded ${playerData.length} player and ${gmData.length} GM refines`);
  });
}

async function seedConsumables() {
  const pack = getPack('hol-consumables');
  if (!pack) return;

  await withUnlockedPacks([pack], async () => {
    const consumables = await loadSeedFile('consumables.json');
    const existingIds = await getSeededIds(pack);
    const itemData = consumables
      .filter(consumable => !existingIds.has(consumable.id))
      .map(consumable => ({
        name: consumable.name,
        type: 'consumable',
        system: {
          range: consumable.range,
          uses: consumable.uses,
          costG: consumable.costG,
          effect: consumable.effect,
          temporaryStatBonuses: consumable.temporaryStatBonuses ?? {},
          tags: consumable.tags ?? []
        },
        flags: { [SYSTEM_ID]: { sourceId: consumable.id } }
      }));

    if (!itemData.length) return;
    await Item.createDocuments(itemData, { pack: pack.collection });
    console.log(`HoL | Seeded ${itemData.length} consumables`);
  });
}

async function seedSkills() {
  const pack = getPack('hol-skills');
  if (!pack) return;

  await withUnlockedPacks([pack], async () => {
    const skills = await loadSeedFile('skills.json');
    const existingIds = await getSeededIds(pack);
    const itemData = skills
      .filter(skill => !existingIds.has(skill.id))
      .map(skill => ({
        name: skill.name,
        type: 'skill',
        system: {
          type: skill.type,
          typeGroup: skill.typeGroup,
          prerequisite: skill.prereq ?? [],
          requiredCharge: Number(skill.requiredCharge) || 0,
          effect: skill.effect,
          statBonuses: skill.statBonuses ?? {},
          tags: skill.tags ?? []
        },
        // `skillKey` is what prerequisite strings reference, so store it alongside the source id.
        flags: { [SYSTEM_ID]: { sourceId: skill.id, skillKey: skill.id } }
      }));

    if (!itemData.length) return;
    await Item.createDocuments(itemData, { pack: pack.collection });
    console.log(`HoL | Seeded ${itemData.length} skills`);
  });
}

/**
 * Build a one-time lookup of every Item reachable by its `sourceId` flag.
 * Scanning each pack once avoids re-reading every compendium per reference.
 * @returns {Promise<Map<string, Item>>}
 */
async function buildItemSourceIndex() {
  const index = new Map();
  for (const item of game.items) {
    const sourceId = item.flags?.[SYSTEM_ID]?.sourceId;
    if (sourceId && !index.has(sourceId)) index.set(sourceId, item);
  }
  for (const pack of game.packs) {
    if (pack.documentName !== 'Item') continue;
    for (const doc of await pack.getDocuments()) {
      const sourceId = doc.flags?.[SYSTEM_ID]?.sourceId;
      if (sourceId && !index.has(sourceId)) index.set(sourceId, doc);
    }
  }
  return index;
}

/**
 * Seed actor templates. Compendium-id references in `_seedRefs` are resolved into
 * embedded items, then the actor's inventory/skills arrays are rewritten to point
 * at the generated embedded item ids.
 */
async function seedActorTemplates() {
  const pack = getPack('hol-templates-actors');
  if (!pack) return;

  await withUnlockedPacks([pack], async () => {
    const templates = await loadSeedFile('actor-templates.json');
    const existingActors = await pack.getDocuments();
    const existingIds = new Set(existingActors.map(actor => actor.flags?.[SYSTEM_ID]?.sourceId));
    const pending = templates.filter(template => !existingIds.has(template.id));
    if (!pending.length) return;

    const itemIndex = await buildItemSourceIndex();

    for (const template of pending) {
      const refs = template['_seedRefs'] ?? {};
      const equippedSourceId: string = refs.equipped ?? '';
      const itemsToEmbed: Record<string, any>[] = [];
      const refToSlot: { sourceId: string; slot: SeedSlot }[] = [];

      for (const slot of SEED_SLOTS) {
        for (const sourceId of (refs[slot] ?? []) as string[]) {
          const source = itemIndex.get(sourceId);
          if (!source) {
            console.warn(`HoL | Actor template ${template.id}: ${slot} reference not found - ${sourceId}`);
            continue;
          }
          itemsToEmbed.push(source.toObject());
          refToSlot.push({ sourceId, slot });
        }
      }

      const [created] = await Actor.createDocuments([{
        name: template.name,
        type: template.type ?? 'unit',
        system: template.system,
        items: itemsToEmbed,
        flags: { [SYSTEM_ID]: { sourceId: template.id, notes: template['_notes'] ?? '' } }
      }], { pack: pack.collection });
      if (!created) continue;

      const slots: Record<SeedSlot, string[]> = { skills: [], weapons: [], items: [] };
      let equipped = '';
      const embedded = Array.from(created.items);

      refToSlot.forEach((ref, index) => {
        const embeddedItem = embedded[index];
        if (!embeddedItem) return;
        slots[ref.slot].push(embeddedItem.id);
        if (ref.sourceId === equippedSourceId) equipped = embeddedItem.id;
      });

      await created.update({
        'system.skills': slots.skills,
        'system.inventory.weapons': slots.weapons,
        'system.inventory.items': slots.items,
        'system.inventory.equipped': equipped
      });
    }

    console.log(`HoL | Seeded ${pending.length} actor templates`);
  });
}
