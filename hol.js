import HolWeaponSheet from './modules/sheets/holWeaponSheet.js';
import HolRefineSheet from './modules/sheets/holRefineSheet.js';
import HolConsumableSheet from './modules/sheets/holConsumableSheet.js';
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
  
  // Register system settings if needed
  // game.settings.register('heroes-of-lite', 'setting-name', { ... });
  
  // Register document sheet classes
  // Actors.unregisterSheet('core', ActorSheet);
  // Items.unregisterSheet('core', ItemSheet);
});

// Hook that runs when the game is fully ready
Hooks.once('ready', async function() {
  console.log('Heroes of Lite | System ready!');
  
  // Seed weapons, refines, and consumables data into compendiums on first setup
  if (game.user.isGM) {
    await seedWeapons();
    await seedRefines();
    await seedConsumables();
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
    const existingNames = new Set(existingItems.map(item => item.name));
    
    for (const weaponData of weapons) {
      if (existingNames.has(weaponData.name)) {
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
