/**
 * Terrain automation.
 *
 * Scene Regions tagged with a `heroes-of-lite.terrain` flag write their terrain
 * onto whichever unit is standing in them, so players never set it by hand.
 */

import { SYSTEM_ID } from '../constants.js';
import { TERRAIN, terrainChoices } from '../rules.js';

const FLAG = 'terrain';

/** Terrain tagged on a region, or null if it is not a terrain region. */
function regionTerrain(region) {
  const key = region?.flags?.[SYSTEM_ID]?.[FLAG];
  return key && Object.hasOwn(TERRAIN, key) ? key : null;
}

/** Does this region contain the token's centre point? */
function regionContainsToken(region, tokenDocument) {
  const object = region.object ?? region;
  const center = tokenDocument.object?.center ?? {
    x: tokenDocument.x + (tokenDocument.width * (canvas.grid?.size ?? 100)) / 2,
    y: tokenDocument.y + (tokenDocument.height * (canvas.grid?.size ?? 100)) / 2
  };

  try {
    if (typeof object.testPoint === 'function') {
      return object.testPoint(center, tokenDocument.elevation ?? 0);
    }
  } catch {
    // Fall through to the membership check below.
  }
  return region.tokens?.has?.(tokenDocument) ?? false;
}

/**
 * Terrain under a token. When regions overlap, the last one in the scene's
 * sort order wins so GMs can layer a specific tile over a broad background.
 */
export function terrainForToken(tokenDocument) {
  const regions = tokenDocument.parent?.regions ?? [];
  let found = '';
  for (const region of regions) {
    const key = regionTerrain(region);
    if (key && regionContainsToken(region, tokenDocument)) found = key;
  }
  return found;
}

/** Write the terrain under a token onto its actor, if it changed. */
export async function syncTokenTerrain(tokenDocument) {
  const actor = tokenDocument.actor;
  if (!actor || actor.type !== 'unit') return;

  const key = terrainForToken(tokenDocument);
  if ((actor.system.terrain ?? '') === key) return;

  await actor.update({ 'system.terrain': key });

  const terrain = TERRAIN[key];
  // Pitfalls and cursed veins inflict a status as soon as a unit stops on them.
  if (terrain?.inflicts && actor.system.status === 'healthy') {
    await actor.update({ 'system.status': terrain.inflicts });
    ui.notifications.info(`${tokenDocument.name} is ${terrain.inflicts} from the ${terrain.label}.`);
  }
}

/** Re-evaluate every token on a scene, e.g. after a region is retagged. */
export async function syncSceneTerrain(scene = canvas?.scene) {
  if (!scene) return;
  for (const token of scene.tokens) await syncTokenTerrain(token);
}

/** Prompt a GM to tag the selected regions with a terrain type. */
export async function promptRegionTerrain() {
  const regions = canvas?.regions?.controlled ?? [];
  if (!regions.length) {
    ui.notifications.warn('Select one or more Regions on the Regions layer first.');
    return;
  }

  const choices = terrainChoices();
  const current = regions[0].document.flags?.[SYSTEM_ID]?.[FLAG] ?? '';
  const options = Object.entries(choices)
    .map(([key, label]) => `<option value="${key}" ${key === current ? 'selected' : ''}>${label}</option>`)
    .join('');

  const key = await foundry.applications.api.DialogV2.prompt({
    window: { title: 'Tag Region Terrain' },
    content: `<p>Apply terrain to ${regions.length} selected region(s).</p>
      <select name="terrain" style="width:100%">${options}</select>`,
    ok: {
      label: 'Apply',
      callback: (event, button) => button.form.elements.terrain.value
    }
  });

  if (key === null || key === undefined) return;
  for (const region of regions) {
    await region.document.setFlag(SYSTEM_ID, FLAG, key);
  }
  await syncSceneTerrain();
  ui.notifications.info(`Tagged ${regions.length} region(s) as ${choices[key]}.`);
}

/** Register the hooks that keep actor terrain in step with token position. */
export function registerTerrainAutomation() {
  const movementKeys = ['x', 'y', 'elevation'];

  Hooks.on('updateToken', (tokenDocument, changes) => {
    if (!movementKeys.some(key => key in changes)) return;
    // One writer only, otherwise every connected client races on the same update.
    if (!game.users.activeGM?.isSelf) return;
    syncTokenTerrain(tokenDocument);
  });

  Hooks.on('createToken', tokenDocument => {
    if (!game.users.activeGM?.isSelf) return;
    syncTokenTerrain(tokenDocument);
  });

  Hooks.on('updateRegion', region => {
    if (!game.users.activeGM?.isSelf) return;
    if (regionTerrain(region) === null && !(SYSTEM_ID in (region.flags ?? {}))) return;
    syncSceneTerrain(region.parent);
  });
}
