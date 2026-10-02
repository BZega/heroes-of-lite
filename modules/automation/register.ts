/**
 * Registers the player-facing entry points for the automation: token HUD button,
 * keybinding, chat commands, scene control tool and the `game.heroesOfLite` API.
 */

import { SYSTEM_ID } from '../constants.ts';
import HolActionMenu from '../combat/actionMenu.ts';
import HolCombatForecast from '../combat/forecast.ts';
import { runPhaseStart } from '../combat/actions.ts';
import { advanceStatusPhase } from '../effects/statuses.ts';
import { clearTonics } from '../effects/buffs.ts';
import { inferWeaponGroup, MAGICAL_WEAPON_GROUPS } from '../data/common.ts';
import { promptRegionTerrain, reportMovement, syncSceneTerrain } from './terrain.ts';

/**
 * Backfill the weapon group on world weapons that were created without one,
 * guessing from the weapon name. Weapons that already have a group are left alone.
 */
async function repairWeaponGroups(): Promise<number> {
  let repaired = 0;
  for (const item of game.items) {
    if (item.type !== 'weapon' || item.system.weaponGroup) continue;
    const group = inferWeaponGroup(item.name);
    if (!group) continue;
    await item.update({
      'system.weaponGroup': group,
      'system.damageType': MAGICAL_WEAPON_GROUPS.has(group) ? 'magical' : 'physical'
    });
    repaired += 1;
  }

  for (const actor of game.actors) {
    for (const item of actor.items) {
      if (item.type !== 'weapon' || item.system.weaponGroup) continue;
      const group = inferWeaponGroup(item.name);
      if (!group) continue;
      await item.update({
        'system.weaponGroup': group,
        'system.damageType': MAGICAL_WEAPON_GROUPS.has(group) ? 'magical' : 'physical'
      });
      repaired += 1;
    }
  }

  ui.notifications?.info(`Heroes of Lite: set the weapon group on ${repaired} weapon(s).`);
  return repaired;
}

/** Open the forecast for the controlled token against the single target. */
async function quickAttack(): Promise<void> {
  const attacker = canvas?.tokens?.controlled?.[0] ?? game.user.character?.getActiveTokens()?.[0];
  const targets = Array.from(game.user.targets);
  if (targets.length !== 1) {
    ui.notifications?.warn('Target exactly one enemy to attack.');
    return;
  }
  await HolCombatForecast.open(attacker, targets[0]);
}

export function registerApi(): void {
  game.heroesOfLite = {
    openActions: (token: Token) => HolActionMenu.open(token),
    attack: (attacker: Token, defender: Token) => HolCombatForecast.open(attacker, defender),
    quickAttack,
    tagRegionTerrain: promptRegionTerrain,
    syncTerrain: syncSceneTerrain,
    movementReport: reportMovement,
    runPhaseStart,
    repairWeaponGroups
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

/**
 * Count down every status inflicted by the side whose phase is starting.
 *
 * This is deliberately combat-wide rather than per-combatant: a status counts
 * down on the phase of whoever *inflicted* it (rules p.29), so when the Enemy
 * Phase begins, every status an enemy inflicted ticks, wherever it landed.
 */
async function advancePhaseStatuses(combat: Combat, phaseOwner: number): Promise<void> {
  const reported: string[] = [];
  const seen = new Set<string>();

  for (const combatant of combat.combatants) {
    const actor = combatant.actor;
    if (actor?.type !== 'unit' || seen.has(actor.id)) continue;
    seen.add(actor.id);

    const expired = await advanceStatusPhase(actor, phaseOwner);
    if (expired.length) reported.push(`<strong>${actor.name}</strong> recovered from ${expired.join(', ')}`);
  }

  if (reported.length) {
    await ChatMessage.create({ content: `<p class="hol-chat-line">${reported.join('; ')}.</p>` });
  }
}

/**
 * Tonics last until the end of the map and Charge resets at the start of one
 * (rules p.20, p.37), so ending the encounter clears both.
 */
async function endOfMapCleanup(combat: Combat): Promise<void> {
  const seen = new Set<string>();
  for (const combatant of combat.combatants) {
    const actor = combatant.actor;
    if (actor?.type !== 'unit' || seen.has(actor.id)) continue;
    seen.add(actor.id);

    await clearTonics(actor);
    if (actor.system.charge) await actor.update({ 'system.charge': 0 });
  }
}

/** Run start-of-phase bookkeeping when the combat turn advances. */
export function registerTurnAutomation() {
  Hooks.on('combatTurnChange', async (combat, previous, current) => {
    if (!game.users.activeGM?.isSelf) return;
    const combatant = combat.combatants.get(current?.combatantId);
    const actor = combatant?.actor;
    if (actor?.type !== 'unit') return;

    const previousDisposition = combat.combatants.get(previous?.combatantId)?.token?.disposition ?? null;
    const disposition = combatant.token?.disposition ?? null;
    if (disposition !== null && previousDisposition !== disposition) {
      await advancePhaseStatuses(combat, disposition);
    }

    const notes = await runPhaseStart(actor);
    if (notes.length) {
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content: `<p class="hol-chat-line"><strong>${actor.name}</strong> phase start: ${notes.join(', ')}.</p>`
      });
    }
  });

  Hooks.on('deleteCombat', async combat => {
    if (!game.users.activeGM?.isSelf) return;
    await endOfMapCleanup(combat);
  });
}
