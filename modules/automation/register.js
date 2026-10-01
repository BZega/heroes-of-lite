/**
 * Registers the player-facing entry points for the automation: token HUD button,
 * keybinding, chat commands, scene control tool and the `game.heroesOfLite` API.
 */

import { SYSTEM_ID } from '../constants.js';
import HolActionMenu from '../combat/actionMenu.js';
import HolCombatForecast from '../combat/forecast.js';
import { runPhaseStart } from '../combat/actions.js';
import { promptRegionTerrain, syncSceneTerrain } from './terrain.js';

/** Open the forecast for the controlled token against the single target. */
async function quickAttack() {
  const attacker = canvas?.tokens?.controlled?.[0] ?? game.user.character?.getActiveTokens()?.[0];
  const targets = Array.from(game.user.targets);
  if (targets.length !== 1) {
    ui.notifications.warn('Target exactly one enemy to attack.');
    return;
  }
  await HolCombatForecast.open(attacker, targets[0]);
}

export function registerApi() {
  game.heroesOfLite = {
    openActions: token => HolActionMenu.open(token),
    attack: (attacker, defender) => HolCombatForecast.open(attacker, defender),
    quickAttack,
    tagRegionTerrain: promptRegionTerrain,
    syncTerrain: syncSceneTerrain,
    runPhaseStart
  };
}

export function registerKeybindings() {
  game.keybindings.register(SYSTEM_ID, 'openActions', {
    name: 'Open Action Menu',
    hint: 'Opens the Heroes of Lite action menu for the selected token.',
    editable: [{ key: 'KeyQ' }],
    onDown: () => { HolActionMenu.open(); return true; }
  });

  game.keybindings.register(SYSTEM_ID, 'quickAttack', {
    name: 'Attack Target',
    hint: 'Opens the combat forecast against your current target.',
    editable: [{ key: 'KeyE' }],
    onDown: () => { quickAttack(); return true; }
  });
}

/** Add an action button to the token HUD for units the user controls. */
export function registerTokenHud() {
  Hooks.on('renderTokenHUD', (hud, element) => {
    const html = element instanceof HTMLElement ? element : element?.[0];
    const token = hud.object;
    if (!html || token?.actor?.type !== 'unit' || !token.actor.isOwner) return;

    const column = html.querySelector('.col.left') ?? html.querySelector('.left');
    if (!column) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'control-icon hol-hud-actions';
    button.dataset.tooltip = 'Heroes of Lite Actions';
    button.innerHTML = '<i class="fas fa-bolt"></i>';
    button.addEventListener('click', event => {
      event.preventDefault();
      HolActionMenu.open(token);
    });
    column.appendChild(button);
  });
}

export function registerChatCommands() {
  Hooks.on('chatMessage', (chatLog, message) => {
    const command = message.trim().toLowerCase();
    if (command === '/hol' || command === '/actions') {
      HolActionMenu.open();
      return false;
    }
    if (command === '/attack') {
      quickAttack();
      return false;
    }
    return true;
  });
}

/** GM tool on the Regions layer for tagging terrain. */
export function registerSceneControls() {
  Hooks.on('getSceneControlButtons', controls => {
    if (!game.user.isGM) return;
    const regions = Array.isArray(controls)
      ? controls.find(control => control.name === 'regions')
      : controls.regions;
    if (!regions) return;

    const tool = {
      name: 'holTerrain',
      title: 'Tag Terrain',
      icon: 'fas fa-mountain-sun',
      button: true,
      onChange: () => promptRegionTerrain(),
      onClick: () => promptRegionTerrain()
    };

    if (Array.isArray(regions.tools)) regions.tools.push(tool);
    else regions.tools[tool.name] = tool;
  });
}

/** Run start-of-phase bookkeeping when the combat turn advances. */
export function registerTurnAutomation() {
  Hooks.on('combatTurnChange', async (combat, previous, current) => {
    if (!game.users.activeGM?.isSelf) return;
    const actor = combat.combatants.get(current?.combatantId)?.actor;
    if (actor?.type !== 'unit') return;

    const notes = await runPhaseStart(actor);
    if (notes.length) {
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content: `<p class="hol-chat-line"><strong>${actor.name}</strong> phase start: ${notes.join(', ')}.</p>`
      });
    }
  });
}
