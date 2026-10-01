import { SYSTEM_ID } from './constants.js';

/**
 * Refines live in compendiums, so resolving them per render would mean repeated
 * async pack reads. The index is built once at `ready` and then queried synchronously.
 */
const index = new Map();
let built = false;

function register(doc) {
  const entry = {
    id: doc.id,
    name: doc.name,
    category: doc.system?.category ?? 'basic',
    tags: new Set(doc.system?.tags ?? []),
    statBonuses: doc.system?.statBonuses ?? {},
    description: doc.system?.description ?? ''
  };
  const sourceId = doc.flags?.[SYSTEM_ID]?.sourceId;
  if (sourceId && !index.has(sourceId)) index.set(sourceId, entry);
  if (doc.id && !index.has(doc.id)) index.set(doc.id, entry);
}

/** Populate the refine lookup from world items and every Item compendium. */
export async function buildRefineIndex() {
  index.clear();
  for (const item of game.items) {
    if (item.type === 'refine') register(item);
  }
  for (const pack of game.packs) {
    if (pack.documentName !== 'Item') continue;
    for (const doc of await pack.getDocuments()) {
      if (doc.type === 'refine') register(doc);
    }
  }
  built = true;
  console.log(`HoL | Indexed ${index.size} refine references`);
}

/** @returns {{id: string, name: string, category: string, tags: Set<string>}|null} */
export function getRefine(refineId) {
  return refineId ? index.get(refineId) ?? null : null;
}

export function isRefineIndexReady() {
  return built;
}

/**
 * Collect the refine tags that apply to a weapon, combining its innate attributes
 * with whatever is slotted into its two refine slots.
 * @param {Item} weapon
 * @returns {Set<string>}
 */
export function weaponTags(weapon) {
  const tags = new Set();
  if (!weapon) return tags;

  const details = weapon.system?.details ?? {};
  const refineIds = [
    ...(details.innateAttributes ?? []),
    ...(details.refines ?? []).map(slot => slot?.id).filter(Boolean)
  ];

  for (const refineId of refineIds) {
    const refine = getRefine(refineId);
    if (!refine) continue;
    for (const tag of refine.tags) tags.add(tag);
  }
  return tags;
}

/** Names of the refines currently applied to a weapon, for display. */
export function weaponRefineNames(weapon) {
  const details = weapon?.system?.details ?? {};
  return [
    ...(details.innateAttributes ?? []).map(id => getRefine(id)?.name).filter(Boolean),
    ...(details.refines ?? []).map(slot => slot?.name).filter(Boolean)
  ];
}
