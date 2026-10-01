/**
 * Terrain automation.
 *
 * Scene Regions tagged with a `heroes-of-lite.terrain` flag write their terrain
 * onto whichever unit is standing in them, so players never set it by hand.
 */

import { SYSTEM_ID } from '../constants.ts';
import { TERRAIN, terrainChoices, terrainMoveCost, buildUnitProfile, movementReport } from '../rules.ts';
import { weaponTags } from '../refineIndex.ts';
import { applyStatus } from '../effects/statuses.ts';

const FLAG = 'terrain';

/** Terrain tagged on a region, or null if it is not a terrain region. */
function regionTerrain(region: RegionDocument | null | undefined): string | null {
  const key = region?.flags?.[SYSTEM_ID]?.[FLAG] as string | undefined;
  return key && Object.hasOwn(TERRAIN, key) ? key : null;
}

/** Does this region contain the token's centre point? */
function regionContainsToken(region: RegionDocument, tokenDocument: TokenDocument): boolean {
  const object = region.object;
  const gridSize = canvas?.grid?.size ?? 100;
  const center: Point = tokenDocument.object?.center ?? {
    x: tokenDocument.x + (tokenDocument.width * gridSize) / 2,
    y: tokenDocument.y + (tokenDocument.height * gridSize) / 2
  };

  try {
    if (typeof object?.testPoint === 'function') {
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
export function terrainForToken(tokenDocument: TokenDocument): string {
  const regions = tokenDocument.parent?.regions ?? [];
  let found = '';
  for (const region of regions) {
    const key = regionTerrain(region);
    if (key && regionContainsToken(region, tokenDocument)) found = key;
  }
  return found;
}

/** Write the terrain under a token onto its actor, if it changed. */
export async function syncTokenTerrain(tokenDocument: TokenDocument): Promise<void> {
  const actor = tokenDocument.actor;
  if (!actor || actor.type !== 'unit') return;

  const key = terrainForToken(tokenDocument);
  if ((actor.system.terrain ?? '') === key) return;

  await actor.update({ 'system.terrain': key });

  const terrain = TERRAIN[key];
  // Pitfalls and cursed veins inflict a status as soon as a unit stops on them.
  // The terrain has no phase of its own, so the unit's own phase counts it down.
  if (terrain?.inflicts) {
    const profile = buildUnitProfile(actor, { weaponTags });
    const applied = await applyStatus(actor, terrain.inflicts, {
      phaseOwner: tokenDocument.disposition ?? null,
      profile
    });
    if (applied) ui.notifications?.info(`${tokenDocument.name} is ${terrain.inflicts} from the ${terrain.label}.`);
  }
}

/** Re-evaluate every token on a scene, e.g. after a region is retagged. */
export async function syncSceneTerrain(scene: Scene | null = canvas?.scene ?? null): Promise<void> {
  if (!scene) return;
  for (const token of scene.tokens) await syncTokenTerrain(token);
}

/**
 * Terrain at an arbitrary position, so a move can be vetted before it lands.
 * @param position Top-left pixel coordinates.
 */
function terrainAtPosition(scene: Scene | null, position: Point, tokenDocument: TokenDocument): string {
  const size = canvas?.grid?.size ?? 100;
  const centre = {
    x: position.x + ((tokenDocument.width ?? 1) * size) / 2,
    y: position.y + ((tokenDocument.height ?? 1) * size) / 2
  };

  let found = '';
  for (const region of scene?.regions ?? []) {
    const key = regionTerrain(region);
    if (!key) continue;
    const object = region.object;
    try {
      if (object?.testPoint?.(centre, tokenDocument.elevation ?? 0)) found = key;
    } catch {
      // A region that cannot be tested simply does not contribute.
    }
  }
  return found;
}

/** Movement costs for the unit behind a token, for reference at the table. */
export function reportMovement(token: Token | null | undefined): ReturnType<typeof movementReport> {
  const actor = token?.actor ?? token?.document?.actor;
  if (!actor) return [];
  return movementReport(buildUnitProfile(actor, { weaponTags }));
}

/** Prompt a GM to tag the selected regions with a terrain type. */
export async function promptRegionTerrain(): Promise<void> {
  const regions = (canvas as any)?.regions?.controlled ?? [];
  if (!regions.length) {
    ui.notifications?.warn('Select one or more Regions on the Regions layer first.');
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
      callback: (event: Event, button: HTMLButtonElement): string =>
        (button.form?.elements.namedItem('terrain') as HTMLSelectElement).value
    }
  }) as string | null | undefined;

  if (key === null || key === undefined) return;
  for (const region of regions) {
    await region.document.setFlag(SYSTEM_ID, FLAG, key);
  }
  await syncSceneTerrain();
  ui.notifications?.info(`Tagged ${regions.length} region(s) as ${choices[key]}.`);
}

/** Register the hooks that keep actor terrain in step with token position. */
export function registerTerrainAutomation(): void {
  const movementKeys = ['x', 'y', 'elevation'];

  // Veto a move into ground the unit cannot cross (rules p.27).
  Hooks.on('preUpdateToken', (tokenDocument: TokenDocument, changes: Record<string, any>) => {
    if (!('x' in changes || 'y' in changes)) return true;
    const actor = tokenDocument.actor;
    if (actor?.type !== 'unit') return true;

    const destination: Point = { x: changes['x'] ?? tokenDocument.x, y: changes['y'] ?? tokenDocument.y };
    const key = terrainAtPosition(tokenDocument.parent, destination, tokenDocument);
    if (!key) return true;

    const profile = buildUnitProfile(actor, { weaponTags });
    const { passable, rule, cost, note } = terrainMoveCost(key, profile);
    const terrain = TERRAIN[key];

    if (!passable) {
      ui.notifications?.warn(
        `${tokenDocument.name} cannot cross ${terrain?.label} (${rule} terrain for ${profile.movementType}).`
      );
      return false;
    }
    if (cost > 1) {
      const suffix = note ? ` \u2014 ${note}` : '';
      ui.notifications?.info(`${terrain?.label} costs ${cost} movement for ${tokenDocument.name}${suffix}.`);
    }
    return true;
  });

  Hooks.on('updateToken', (tokenDocument: TokenDocument, changes: Record<string, unknown>) => {
    if (!movementKeys.some(key => key in changes)) return;
    // One writer only, otherwise every connected client races on the same update.
    if (!game.users.activeGM?.isSelf) return;
    void syncTokenTerrain(tokenDocument);
  });

  Hooks.on('createToken', (tokenDocument: TokenDocument) => {
    if (!game.users.activeGM?.isSelf) return;
    void syncTokenTerrain(tokenDocument);
  });

  Hooks.on('updateRegion', (region: RegionDocument) => {
    if (!game.users.activeGM?.isSelf) return;
    if (regionTerrain(region) === null && !(SYSTEM_ID in (region.flags ?? {}))) return;
    void syncSceneTerrain(region.parent);
  });
}
