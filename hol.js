import HolWeaponSheet from './modules/sheets/holWeaponSheet.js';
import HolRefineSheet from './modules/sheets/holRefineSheet.js';
import HolConsumableSheet from './modules/sheets/holConsumableSheet.js';
import HolSkillSheet from './modules/sheets/holSkillSheet.js';
import HolActorSheet from './modules/sheets/holActorSheet.js';
/**
 * Heroes of Lite - Main System File
 * Initializes the Heroes of Lite system for Foundry VTT
 */

// Import the system configuration
// import { heroesOfLite } from './modules/config.js';

// Hooks that run once the game is initialized
Hooks.once('init', async function() {
  console.log('Heroes of Lite | Initializing system...');
  
  // Register Handlebars helpers
  Handlebars.registerHelper('includes', function(array, value) {
    return Array.isArray(array) && array.includes(value);
  });
  
  Handlebars.registerHelper('join', function(array, separator) {
    return Array.isArray(array) ? array.join(separator) : '';
  });

  Handlebars.registerHelper('eq', function(a, b) {
    return a === b;
  });
  
  // Register actor sheets by type
  Actors.registerSheet('heroes-of-lite', HolActorSheet, {
    types: ['unit'],
    makeDefault: true,
    label: "HoL Character Sheet"
  });
  
  // Register item sheets by type
  Items.registerSheet('heroes-of-lite', HolWeaponSheet, {
    types: ['weapon'],
    makeDefault: true,
    label: "HoL Weapon Sheet"
  });
  
  Items.registerSheet('heroes-of-lite', HolRefineSheet, {
    types: ['refine'],
    makeDefault: true,
    label: "HoL Refine Sheet"
  });
  
  Items.registerSheet('heroes-of-lite', HolConsumableSheet, {
    types: ['consumable'],
    makeDefault: true,
    label: "HoL Consumable Sheet"
  });

  Items.registerSheet('heroes-of-lite', HolSkillSheet, {
    types: ['skill'],
    makeDefault: true,
    label: "HoL Skill Sheet"
  });
  
  // Register system settings if needed
  // game.settings.register('heroes-of-lite', 'setting-name', { ... });
  
  // Register document sheet classes
  // Actors.unregisterSheet('core', ActorSheet);
  // Items.unregisterSheet('core', ItemSheet);
});

// Hook that runs when the game is fully ready
Hooks.once('ready', async function() {
  console.log('Heroes of Lite | System ready!');
  
  // Seed weapons, refines, consumables, skills, and actor templates into compendiums on first setup
  if (game.user.isGM) {
    await seedWeapons();
    await seedRefines();
    await seedConsumables();
    await seedSkills();
    await seedActorTemplates();
  }
});

/**
 * Seed weapons from the seed data file into the hol-weapons compendium
 */
async function seedWeapons() {
  const pack = game.packs.get('heroes-of-lite.hol-weapons');
  if (!pack) {
    console.warn('HoL | hol-weapons compendium pack not found');
    return;
  }

  // Unlock the pack so we can add items
  const wasLocked = pack.locked;
  if (wasLocked) {
    await pack.configure({ locked: false });
    console.log('HoL | Unlocked hol-weapons pack');
  }

  // Fetch weapons from seed data
  try {
    const response = await fetch('systems/heroes-of-lite/data/seed/weapons.json');
    const weapons = await response.json();
    
    console.log(`HoL | Found ${weapons.length} weapons to seed`);
    
    // Get existing items in pack
    const existingItems = await pack.getDocuments();
    const existingIds = new Set(existingItems.map(item => item.flags?.['heroes-of-lite']?.sourceId));
    
    for (const weaponData of weapons) {
      if (existingIds.has(weaponData.id)) {
        continue;
      }
      
      // Create proper Foundry item document
      const itemData = {
        name: weaponData.name,
        type: 'weapon',
        system: {
          attributes: {
            weaponGroup: weaponData.weaponGroup,
            damageType: weaponData.damageType
          },
          details: {
            range: weaponData.range,
            might: weaponData.might,
            costG: weaponData.costG,
            innateAttributes: weaponData.innateAttributes || [],
            attributes: weaponData.attributes || [],
            attributeRules: weaponData.attributeRules,
            refines: [{id: '', name: ''}, {id: '', name: ''}]
          }
        },
        flags: {
          'heroes-of-lite': {
            sourceId: weaponData.id
          }
        }
      };
      
      // Create the document in the pack
      await Item.create(itemData, {pack: pack.collection});
    }
    
    console.log('HoL | Weapons seeding complete');
  } catch (error) {
    console.error('HoL | Error seeding weapons:', error);
  } finally {
    // Re-lock the pack if it was locked before
    if (wasLocked) {
      await pack.configure({ locked: true });
      console.log('HoL | Re-locked hol-weapons pack');
    }
  }
}

/**
 * Seed refines from the seed data file into separate player and GM compendiums
 */
async function seedRefines() {
  const playerPack = game.packs.get('heroes-of-lite.hol-player-refines');
  const gmPack = game.packs.get('heroes-of-lite.hol-gm-refines');
  
  if (!playerPack || !gmPack) {
    console.warn('HoL | Player or GM refines compendium pack not found');
    return;
  }

  // Fetch refines from seed data
  try {
    const response = await fetch('systems/heroes-of-lite/data/seed/refines.json');
    const refines = await response.json();
    
    console.log(`HoL | Found ${refines.length} refines to seed`);
    
    // Seed player refines
    const playerWasLocked = playerPack.locked;
    if (playerWasLocked) await playerPack.configure({ locked: false });
    
    const existingPlayerItems = await playerPack.getDocuments();
    const existingPlayerIds = new Set(existingPlayerItems.map(item => item.flags?.['heroes-of-lite']?.sourceId));
    
    // Seed GM refines
    const gmWasLocked = gmPack.locked;
    if (gmWasLocked) await gmPack.configure({ locked: false });
    
    const existingGMItems = await gmPack.getDocuments();
    const existingGMIds = new Set(existingGMItems.map(item => item.flags?.['heroes-of-lite']?.sourceId));
    
    for (const refineData of refines) {
      const isGMOnly = refineData.category === 'gmOnly';
      const targetPack = isGMOnly ? gmPack : playerPack;
      const existingIds = isGMOnly ? existingGMIds : existingPlayerIds;
      
      if (existingIds.has(refineData.id)) {
        continue;
      }
      
      // Create proper Foundry item document
      const itemData = {
        name: refineData.name,
        type: 'refine',
        system: {
          category: refineData.category,
          costG: refineData.costG,
          appliesToWeaponGroups: refineData.appliesToWeaponGroups,
          description: refineData.description,
          statBonuses: refineData.statBonuses || {},
          tags: refineData.tags || []
        },
        flags: {
          'heroes-of-lite': {
            sourceId: refineData.id
          }
        }
      };
      
      // Create the document in the appropriate pack
      await Item.create(itemData, {pack: targetPack.collection});
    }
    
    // Re-lock packs
    if (playerWasLocked) await playerPack.configure({ locked: true });
    if (gmWasLocked) await gmPack.configure({ locked: true });
    
    console.log('HoL | Refines seeding complete');
  } catch (error) {
    console.error('HoL | Error seeding refines:', error);
  }
}

/**
 * Seed consumables from the seed data file into the hol-consumables compendium
 */
async function seedConsumables() {
  const pack = game.packs.get('heroes-of-lite.hol-consumables');
  if (!pack) {
    console.warn('HoL | hol-consumables compendium pack not found');
    return;
  }

  // Unlock the pack so we can add items
  const wasLocked = pack.locked;
  if (wasLocked) {
    await pack.configure({ locked: false });
    console.log('HoL | Unlocked hol-consumables pack');
  }

  // Fetch consumables from seed data
  try {
    const response = await fetch('systems/heroes-of-lite/data/seed/consumables.json');
    const consumables = await response.json();
    
    console.log(`HoL | Found ${consumables.length} consumables to seed`);
    
    // Get existing items in pack
    const existingItems = await pack.getDocuments();
    const existingIds = new Set(existingItems.map(item => item.flags?.['heroes-of-lite']?.sourceId));
    
    for (const consumableData of consumables) {
      if (existingIds.has(consumableData.id)) {
        continue;
      }
      
      // Create proper Foundry item document
      const itemData = {
        name: consumableData.name,
        type: 'consumable',
        system: {
          details: {
            range: consumableData.range,
            uses: consumableData.uses,
            costG: consumableData.costG,
            effect: consumableData.effect,
            temporaryStatBonuses: consumableData.temporaryStatBonuses || {},
            tags: consumableData.tags || []
          }
        },
        flags: {
          'heroes-of-lite': {
            sourceId: consumableData.id
          }
        }
      };
      
      // Create the document in the pack
      await Item.create(itemData, {pack: pack.collection});
    }
    
    console.log('HoL | Consumables seeding complete');
  } catch (error) {
    console.error('HoL | Error seeding consumables:', error);
  } finally {
    // Re-lock the pack if it was locked before
    if (wasLocked) {
      await pack.configure({ locked: true });
      console.log('HoL | Re-locked hol-consumables pack');
    }
  }
}

// Register any custom hooks or event listeners
Hooks.on('renderActorSheet', (sheet, html, data) => {
  // Custom actor sheet rendering logic
});

/**
 * Seed skills from the seed data file into the hol-skills compendium
 */
async function seedSkills() {
  const pack = game.packs.get('heroes-of-lite.hol-skills');
  if (!pack) {
    console.warn('HoL | hol-skills compendium pack not found');
    return;
  }

  const wasLocked = pack.locked;
  if (wasLocked) {
    await pack.configure({ locked: false });
    console.log('HoL | Unlocked hol-skills pack');
  }

  try {
    const response = await fetch('systems/heroes-of-lite/data/seed/skills.json');
    const skills = await response.json();

    console.log(`HoL | Found ${skills.length} skills to seed`);

    const existingItems = await pack.getDocuments();
    const existingIds = new Set(existingItems.map(item => item.flags?.['heroes-of-lite']?.sourceId));

    for (const skillData of skills) {
      if (existingIds.has(skillData.id)) {
        continue;
      }

      const itemData = {
        name: skillData.name,
        type: 'skill',
        system: {
          attributes: {
            id: skillData.id,
            name: skillData.name,
            type: skillData.type
          },
          details: {
            typeGroup: skillData.typeGroup,
            prerequisite: skillData.prereq || [],
            requiredCharge: skillData.requiredCharge || '',
            effect: skillData.effect,
            statBonuses: skillData.statBonuses || {},
            tags: skillData.tags || []
          }
        },
        flags: {
          'heroes-of-lite': {
            sourceId: skillData.id
          }
        }
      };

      await Item.create(itemData, {pack: pack.collection});
    }

    console.log('HoL | Skills seeding complete');
  } catch (error) {
    console.error('HoL | Error seeding skills:', error);
  } finally {
    if (wasLocked) {
      await pack.configure({ locked: true });
      console.log('HoL | Re-locked hol-skills pack');
    }
  }
}

/**
 * Look up an item by source-id flag across the world and all compendium item packs.
 */
async function findItemBySourceId(sourceId) {
  if (!sourceId) return null;
  const worldHit = game.items.find(i => i.flags?.['heroes-of-lite']?.sourceId === sourceId);
  if (worldHit) return worldHit;
  for (const pack of game.packs) {
    if (pack.documentName !== 'Item') continue;
    const docs = await pack.getDocuments();
    const hit = docs.find(d => d.flags?.['heroes-of-lite']?.sourceId === sourceId);
    if (hit) return hit;
  }
  return null;
}

/**
 * Seed actor templates from the seed data file into the hol-templates-actors compendium.
 * Resolves compendium-id references in _seedRefs into embedded items and rewrites the
 * actor's inventory/skills arrays to point at the embedded item ids.
 */
async function seedActorTemplates() {
  const pack = game.packs.get('heroes-of-lite.hol-templates-actors');
  if (!pack) {
    console.warn('HoL | hol-templates-actors compendium pack not found');
    return;
  }

  const wasLocked = pack.locked;
  if (wasLocked) {
    await pack.configure({ locked: false });
    console.log('HoL | Unlocked hol-templates-actors pack');
  }

  try {
    const response = await fetch('systems/heroes-of-lite/data/seed/actor-templates.json');
    const templates = await response.json();

    console.log(`HoL | Found ${templates.length} actor templates to seed`);

    const existingActors = await pack.getDocuments();
    const existingIds = new Set(existingActors.map(a => a.flags?.['heroes-of-lite']?.sourceId));

    for (const t of templates) {
      if (existingIds.has(t.id)) continue;

      // Resolve compendium-id references into embedded item documents
      const refs = t._seedRefs || { skills: [], weapons: [], items: [], equipped: '' };
      const itemsToEmbed = [];
      const refToSlot = []; // [{sourceId, slot}]

      for (const skillId of refs.skills || []) {
        const src = await findItemBySourceId(skillId);
        if (src) { itemsToEmbed.push(src.toObject()); refToSlot.push({ sourceId: skillId, slot: 'skills' }); }
        else console.warn(`HoL | Actor template ${t.id}: skill not found ${skillId}`);
      }
      for (const weaponId of refs.weapons || []) {
        const src = await findItemBySourceId(weaponId);
        if (src) { itemsToEmbed.push(src.toObject()); refToSlot.push({ sourceId: weaponId, slot: 'weapons' }); }
        else console.warn(`HoL | Actor template ${t.id}: weapon not found ${weaponId}`);
      }
      for (const itemId of refs.items || []) {
        const src = await findItemBySourceId(itemId);
        if (src) { itemsToEmbed.push(src.toObject()); refToSlot.push({ sourceId: itemId, slot: 'items' }); }
        else console.warn(`HoL | Actor template ${t.id}: item not found ${itemId}`);
      }

      const actorData = {
        name: t.name,
        type: t.type || 'unit',
        system: t.system,
        items: itemsToEmbed,
        flags: {
          'heroes-of-lite': {
            sourceId: t.id,
            notes: t._notes || ''
          }
        }
      };

      const created = await Actor.create(actorData, { pack: pack.collection });

      // After creation, map embedded items back to the seed refs and update inventory/skills
      const skills = [];
      const weapons = [];
      const itemsList = [];
      let equipped = '';
      const equippedSourceId = refs.equipped || '';

      const embedded = Array.from(created.items);
      for (let i = 0; i < refToSlot.length; i++) {
        const ref = refToSlot[i];
        const emb = embedded[i];
        if (!emb) continue;
        if (ref.slot === 'skills')  skills.push(emb.id);
        if (ref.slot === 'weapons') weapons.push(emb.id);
        if (ref.slot === 'items')   itemsList.push(emb.id);
        if (ref.sourceId === equippedSourceId) equipped = emb.id;
      }

      await created.update({
        'system.skills': skills,
        'system.inventory.weapons': weapons,
        'system.inventory.items': itemsList,
        'system.inventory.equipped': equipped
      });
    }

    console.log('HoL | Actor templates seeding complete');
  } catch (error) {
    console.error('HoL | Error seeding actor templates:', error);
  } finally {
    if (wasLocked) {
      await pack.configure({ locked: true });
      console.log('HoL | Re-locked hol-templates-actors pack');
    }
  }
}
