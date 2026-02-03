import HolItemSheet from './modules/sheets/holItemSheet.js';
/**
 * Heroes of Lite - Main System File
 * Initializes the Heroes of Lite system for Foundry VTT
 */

// Import the system configuration
import { heroesOfLite } from './modules/config.js';

// Hooks that run once the game is initialized
Hooks.once('init', async function() {
  console.log('Heroes of Lite | Initializing system...');
  
  Items.unregisterSheet('core', ItemSheet);
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
});

// Register any custom hooks or event listeners
Hooks.on('renderActorSheet', (sheet, html, data) => {
  // Custom actor sheet rendering logic
});
