import HolItemSheet from './modules/sheets/holItemSheet.js';
/**
 * Heroes of Lite - Main System File
 * Initializes the Heroes of Lite system for Foundry VTT
 */

// Import the system configuration
// import { heroesOfLite } from './modules/config.js';

// Hooks that run once the game is initialized
Hooks.once('init', async function() {
  console.log('Heroes of Lite | Initializing system...');
  
  // Register V2 sheets
  Actors.registerSheet('heroes-of-lite', HolItemSheet, { makeDefault: true });
  Items.registerSheet('heroes-of-lite', HolItemSheet, { makeDefault: true });
  // Register system settings if needed
  // game.settings.register('heroes-of-lite', 'setting-name', { ... });
  
  // Register document sheet classes
  // Actors.unregisterSheet('core', ActorSheet);
  // Items.unregisterSheet('core', ItemSheet);
});

// Hook that runs when the game is fully ready
Hooks.once('ready', async function() {
  console.log('Heroes of Lite | System ready!');
  
  // Seed weapons data into a compendium on first setup
  if (game.user.isGM) {
    await seedWeapons();
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
        console.log(`HoL | Weapon already exists: ${weaponData.name}`);
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
      console.log(`HoL | Created weapon: ${weaponData.name}`);
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

// Register any custom hooks or event listeners
Hooks.on('renderActorSheet', (sheet, html, data) => {
  // Custom actor sheet rendering logic
});
