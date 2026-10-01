/**
 * Heroes of Lite - Main System File
 * Initializes the Heroes of Lite system for Foundry VTT.
 */

import HolWeaponSheet from './modules/sheets/holWeaponSheet.js';
import HolRefineSheet from './modules/sheets/holRefineSheet.js';
import HolConsumableSheet from './modules/sheets/holConsumableSheet.js';
import HolSkillSheet from './modules/sheets/holSkillSheet.js';
import HolActorSheet from './modules/sheets/holActorSheet.js';
import { SYSTEM_ID } from './modules/constants.js';
import { buildRefineIndex } from './modules/refineIndex.js';
import { registerTerrainAutomation } from './modules/automation/terrain.js';
import {
  registerApi,
  registerChatCommands,
  registerKeybindings,
  registerSceneControls,
  registerTokenHud,
  registerTurnAutomation
} from './modules/automation/register.js';

/** Bump when seed data changes so existing worlds re-run the import. */
const SEED_VERSION = 1;

/** v13 moved the document collections under the `foundry.documents.collections` namespace. */
const ActorsCollection = foundry.documents?.collections?.Actors ?? globalThis.Actors;
const ItemsCollection = foundry.documents?.collections?.Items ?? globalThis.Items;

Hooks.once('init', function () {
  console.log('Heroes of Lite | Initializing system...');

  Handlebars.registerHelper('includes', (array, value) => Array.isArray(array) && array.includes(value));
  Handlebars.registerHelper('join', (array, separator) => (Array.isArray(array) ? array.join(separator) : ''));
  Handlebars.registerHelper('eq', (a, b) => a === b);
  Handlebars.registerHelper('add', (a, b) => Number(a ?? 0) + Number(b ?? 0));

  ActorsCollection.registerSheet(SYSTEM_ID, HolActorSheet, {
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
    ItemsCollection.registerSheet(SYSTEM_ID, sheetClass, { types: [type], makeDefault: true, label });
  }

  game.settings.register(SYSTEM_ID, 'seedVersion', {
    name: 'Compendium Seed Version',
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
});

Hooks.once('ready', async function () {
  console.log('Heroes of Lite | System ready!');
  registerApi();

  if (!game.user.isGM) {
    await buildRefineIndex();
    return;
  }
  if (game.settings.get(SYSTEM_ID, 'seedVersion') >= SEED_VERSION) {
    await buildRefineIndex();
    return;
  }

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
    // Combat needs refine tags resolved synchronously, so index them after seeding.
    await buildRefineIndex();
  }
});

/* -------------------------------------------- */
/*  Seeding helpers                              */
/* -------------------------------------------- */

/**
 * Fetch a JSON seed file bundled with the system.
 * @param {string} fileName File name inside `data/seed`.
 * @returns {Promise<Array>} Parsed array of seed records.
 */
async function loadSeedFile(fileName) {
  const path = `systems/${SYSTEM_ID}/data/seed/${fileName}`;
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Unable to read seed file ${path} (HTTP ${response.status})`);
  const data = await response.json();
  if (!Array.isArray(data)) throw new Error(`Seed file ${path} did not contain an array`);
  return data;
}

/**
 * Run a callback with the given packs temporarily unlocked, always restoring lock state.
 * @param {CompendiumCollection[]} packs
 * @param {() => Promise<void>} callback
 */
async function withUnlockedPacks(packs, callback) {
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

/**
 * Collect the `sourceId` flags already present in a pack.
 * @param {CompendiumCollection} pack
 * @returns {Promise<Set<string>>}
 */
async function getSeededIds(pack) {
  const documents = await pack.getDocuments();
  return new Set(documents.map(doc => doc.flags?.[SYSTEM_ID]?.sourceId).filter(Boolean));
}

/**
 * Resolve a pack and log a warning if it is missing.
 * @param {string} name Pack name without the system prefix.
 * @returns {CompendiumCollection|null}
 */
function getPack(name) {
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
          attributes: {
            weaponGroup: weapon.weaponGroup,
            damageType: weapon.damageType
          },
          details: {
            range: weapon.range,
            might: weapon.might,
            costG: weapon.costG,
            innateAttributes: weapon.innateAttributes ?? [],
            attributes: weapon.attributes ?? [],
            attributeRules: weapon.attributeRules,
            refines: [{ id: '', name: '' }, { id: '', name: '' }]
          }
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

    const toItemData = refine => ({
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
          details: {
            range: consumable.range,
            uses: consumable.uses,
            costG: consumable.costG,
            effect: consumable.effect,
            temporaryStatBonuses: consumable.temporaryStatBonuses ?? {},
            tags: consumable.tags ?? []
          }
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
          attributes: {
            type: skill.type
          },
          details: {
            typeGroup: skill.typeGroup,
            prerequisite: skill.prereq ?? [],
            requiredCharge: skill.requiredCharge ?? '',
            effect: skill.effect,
            statBonuses: skill.statBonuses ?? {},
            tags: skill.tags ?? []
          }
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
      const refs = template._seedRefs ?? {};
      const equippedSourceId = refs.equipped ?? '';
      const itemsToEmbed = [];
      const refToSlot = [];

      for (const slot of ['skills', 'weapons', 'items']) {
        for (const sourceId of refs[slot] ?? []) {
          const source = itemIndex.get(sourceId);
          if (!source) {
            console.warn(`HoL | Actor template ${template.id}: ${slot} reference not found - ${sourceId}`);
            continue;
          }
          itemsToEmbed.push(source.toObject());
          refToSlot.push({ sourceId, slot });
        }
      }

      const created = await Actor.create({
        name: template.name,
        type: template.type ?? 'unit',
        system: template.system,
        items: itemsToEmbed,
        flags: { [SYSTEM_ID]: { sourceId: template.id, notes: template._notes ?? '' } }
      }, { pack: pack.collection });

      const slots = { skills: [], weapons: [], items: [] };
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
