import { SYSTEM_ID } from './constants.ts';
import type { RefineRecord, RefineSlot } from '../types/hol.ts';

/**
 * Refines live in compendiums, so resolving them per render would mean repeated
 * async pack reads. The index is built once at `ready` and then queried synchronously.
 */
const index = new Map<string, RefineRecord>();
let built = false;

function register(doc: Item): void {
  const entry: RefineRecord = {
    id: doc.id,
    name: doc.name,
    category: doc.system?.category ?? 'basic',
    tags: new Set<string>(doc.system?.tags ?? []),
    statBonuses: doc.system?.statBonuses ?? {},
    description: doc.system?.description ?? ''
  };
  const sourceId = doc.flags?.[SYSTEM_ID]?.['sourceId'] as string | undefined;
  if (sourceId && !index.has(sourceId)) index.set(sourceId, entry);
  if (doc.id && !index.has(doc.id)) index.set(doc.id, entry);
}

/** Populate the refine lookup from world items and every Item compendium. */
export async function buildRefineIndex(): Promise<void> {
  index.clear();
  for (const item of game.items) {
    if (item.type === 'refine') register(item);
  }
  for (const pack of game.packs) {
    if (pack.documentName !== 'Item') continue;
    for (const doc of await pack.getDocuments()) {
      const item = doc as Item;
      if (item.type === 'refine') register(item);
    }
  }
  built = true;
  console.log(`HoL | Indexed ${index.size} refine references`);
}

export function getRefine(refineId: string | null | undefined): RefineRecord | null {
  return refineId ? index.get(refineId) ?? null : null;
}

export function isRefineIndexReady(): boolean {
  return built;
}

/** The refine ids on a weapon, combining innate attributes with its two slots. */
function refineIdsOf(weapon: Item | null | undefined): string[] {
  return [
    ...((weapon?.system?.innateAttributes ?? []) as string[]),
    ...((weapon?.system?.refines ?? []) as RefineSlot[]).map(slot => slot?.id).filter(Boolean)
  ];
}

/**
 * Collect the refine tags that apply to a weapon, combining its innate attributes
 * with whatever is slotted into its two refine slots.
 */
export function weaponTags(weapon: Item | null | undefined): Set<string> {
  const tags = new Set<string>();
  if (!weapon) return tags;

  for (const refineId of refineIdsOf(weapon)) {
    const refine = getRefine(refineId);
    if (!refine) continue;
    for (const tag of refine.tags) tags.add(tag);
  }
  return tags;
}

/** The indexed refine records applied to a weapon, innate slots included. */
export function weaponRefines(weapon: Item | null | undefined): RefineRecord[] {
  return refineIdsOf(weapon)
    .map(id => getRefine(id))
    .filter((refine): refine is RefineRecord => refine !== null);
}

/** Names of the refines currently applied to a weapon, for display. */
export function weaponRefineNames(weapon: Item | null | undefined): string[] {
  return [
    ...((weapon?.system?.innateAttributes ?? []) as string[]).map(id => getRefine(id)?.name),
    ...((weapon?.system?.refines ?? []) as RefineSlot[]).map(slot => slot?.name)
  ].filter((name): name is string => !!name);
}
