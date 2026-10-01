/**
 * Numeric buffs carried by Active Effects.
 *
 * Unlike statuses, these map cleanly onto data paths, so they are expressed as
 * real Active Effect `changes` and applied by Foundry before derivation runs:
 *
 *   tonics   -> system.temp.*        (until the end of the map, rules p.37)
 *   refines  -> system.bonuses.*     (while the weapon is equipped)
 *   supports -> system.bonuses.*, system.modifiers.*  (while within 2 tiles, rules p.21)
 */

import { SYSTEM_ID } from '../constants.ts';
import type { BuffFlagData, ModifierKey, RefineRecord, StatKey, SupportRank } from '../../types/hol.ts';

/** CONST.ACTIVE_EFFECT_MODES.ADD, without needing Foundry globals at import time. */
export const MODE_ADD = 2;

export const BUFF_KINDS = {
  tonic: 'tonic', refine: 'refine', support: 'support', combatArt: 'combatArt'
} as const;

const MODIFIER_KEYS = new Set<string>(['hit', 'avoid', 'crit', 'power', 'tri']);
const STAT_KEYS = new Set<string>(['hp', 'atk', 'spd', 'dex', 'def', 'res', 'luck']);

/** A bonus object keyed by stat or flat modifier, as refines and supports express them. */
export type BonusMap = Partial<Record<StatKey | ModifierKey, number>> & Record<string, unknown>;

/**
 * Turn a `{ atk: 2, hit: 1 }` bonus object into Active Effect changes.
 * Stats and flat combat modifiers live in different blocks, so they are routed
 * to the right one here rather than by each caller.
 */
export function bonusChanges(
  bonuses: BonusMap | null | undefined,
  { statPath = 'system.bonuses' }: { statPath?: string } = {}
): EffectChange[] {
  const changes: EffectChange[] = [];
  for (const [key, raw] of Object.entries(bonuses ?? {})) {
    const value = Number(raw);
    if (!Number.isFinite(value) || value === 0) continue;
    if (STAT_KEYS.has(key)) changes.push({ key: `${statPath}.${key}`, mode: MODE_ADD, value });
    else if (MODIFIER_KEYS.has(key)) changes.push({ key: `system.modifiers.${key}`, mode: MODE_ADD, value });
  }
  return changes;
}

/** The buff payload on an Active Effect, or null if it is not one of ours. */
export function buffFlags(effect: { flags?: DocumentFlags } | null | undefined): BuffFlagData | null {
  return (effect?.flags?.[SYSTEM_ID]?.['buff'] as BuffFlagData | undefined) ?? null;
}

function buffEffects(actor: Actor, kind: string | null = null): ActiveEffect[] {
  const effects = actor?.effects;
  if (!effects) return [];
  return effects.filter(effect => {
    const buff = buffFlags(effect);
    return !!buff && (!kind || buff.kind === kind);
  });
}

/** Active Effect data for one of our buffs. */
export interface BuffEffectData {
  name: string;
  img: string;
  origin: string;
  changes: EffectChange[];
  flags: DocumentFlags;
}

const buffEffectData = (
  buff: BuffFlagData,
  fields: { name: string; img: string; origin: string; changes: EffectChange[] }
): BuffEffectData => ({ ...fields, flags: { [SYSTEM_ID]: { buff } } });

/* -------------------------------------------- */
/*  Tonics                                       */
/* -------------------------------------------- */

/** Re-drinking the same tonic must not stack, so it is keyed by its source item. */
const tonicKey = (item: Item): string =>
  (item.flags?.[SYSTEM_ID]?.['sourceId'] as string | undefined) || item.name;

/**
 * A tonic grants its bonus until the end of the map.
 * Each tonic is its own effect, so an Attack Tonic and a Speed Tonic stack,
 * while drinking the same tonic twice does not.
 */
export function tonicEffectData(item: Item): BuffEffectData | null {
  const changes = bonusChanges(item?.system?.temporaryStatBonuses, { statPath: 'system.temp' });
  if (!changes.length) return null;

  return buffEffectData(
    { kind: BUFF_KINDS.tonic, key: tonicKey(item) },
    { name: item.name, img: item.img, origin: item.uuid ?? '', changes }
  );
}

/** @returns Whether a new tonic effect was created. */
export async function applyTonic(actor: Actor, item: Item): Promise<boolean> {
  const data = tonicEffectData(item);
  if (!data) return false;

  const key = tonicKey(item);
  if (buffEffects(actor, BUFF_KINDS.tonic).some(effect => buffFlags(effect)?.key === key)) return false;

  await actor.createEmbeddedDocuments('ActiveEffect', [data]);
  return true;
}

/** Tonics wear off when the map ends. */
export async function clearTonics(actor: Actor): Promise<boolean> {
  const ids = buffEffects(actor, BUFF_KINDS.tonic).map(effect => effect.id);
  if (!ids.length) return false;
  await actor.deleteEmbeddedDocuments('ActiveEffect', ids);
  return true;
}

/* -------------------------------------------- */
/*  Refines                                      */
/* -------------------------------------------- */

/**
 * Wielder bonuses from the refines on an equipped weapon.
 * Might, range and cost are baked into the weapon when the refine is attached;
 * only the bonuses that modify the *unit* belong here.
 */
export function refineEffectData(weapon: Item | null, refines: RefineRecord[]): BuffEffectData | null {
  const totals: Record<string, number> = {};
  for (const refine of refines ?? []) {
    for (const [key, raw] of Object.entries(refine?.statBonuses ?? {})) {
      if (!STAT_KEYS.has(key) && !MODIFIER_KEYS.has(key)) continue;
      const value = Number(raw);
      if (Number.isFinite(value) && value !== 0) totals[key] = (totals[key] ?? 0) + value;
    }
  }

  const changes = bonusChanges(totals);
  if (!changes.length) return null;

  return buffEffectData(
    { kind: BUFF_KINDS.refine, key: weapon?.id ?? '' },
    {
      name: `${weapon?.name ?? 'Weapon'} (Refinements)`,
      img: weapon?.img ?? 'icons/svg/upgrade.svg',
      origin: weapon?.uuid ?? '',
      changes
    }
  );
}

/**
 * Keep the refine effect in step with whatever is equipped.
 * Called after an equip change or a refine being added or removed.
 */
export async function syncRefineEffects(actor: Actor, weapon: Item | null, refines: RefineRecord[]): Promise<void> {
  const existing = buffEffects(actor, BUFF_KINDS.refine);
  const data = weapon ? refineEffectData(weapon, refines) : null;
  const key = data ? weapon?.id ?? '' : null;

  const stale = existing.filter(effect => key === null || buffFlags(effect)?.key !== key);
  if (stale.length) await actor.deleteEmbeddedDocuments('ActiveEffect', stale.map(effect => effect.id));

  if (!data) return;
  const current = existing.find(effect => buffFlags(effect)?.key === key);
  if (current) await actor.updateEmbeddedDocuments('ActiveEffect', [{ _id: current.id, changes: data.changes }]);
  else await actor.createEmbeddedDocuments('ActiveEffect', [data]);
}

/* -------------------------------------------- */
/*  Supports                                     */
/* -------------------------------------------- */

/** The movement types that define a support bonus line. */
export type SupportLine = 'cavalry' | 'flier' | 'armor';

/**
 * Support bonuses, keyed by the *partner's* movement type and the rank between
 * them (rules p.21). A unit receives the line its partner provides.
 */
export const SUPPORT_BONUSES: Record<SupportLine, Record<SupportRank, BonusMap>> = {
  cavalry: {
    C: { atk: 1 },
    B: { atk: 2 },
    A: { atk: 2, hit: 1 },
    S: { atk: 3, hit: 1 }
  },
  flier: {
    C: { spd: 1 },
    B: { spd: 2 },
    A: { spd: 2, avoid: 1 },
    S: { spd: 3, avoid: 1 }
  },
  armor: {
    C: { def: 1 },
    B: { def: 1, res: 1 },
    A: { def: 2, res: 2 },
    S: { def: 3, res: 3 }
  }
};

export const SUPPORT_RANKS: readonly SupportRank[] = ['C', 'B', 'A', 'S'];

/** How far apart two supported units may stand and still benefit (rules p.21). */
export const SUPPORT_RANGE = 2;

const isSupportLine = (value: string): value is SupportLine =>
  Object.hasOwn(SUPPORT_BONUSES, value);

/**
 * The bonus a unit receives from a partner.
 * Infantry partners pick which line they provide at character creation, stored
 * on the partner as `system.supportLine`.
 */
export function supportBonusFrom(partner: Actor | null, rank: SupportRank): BonusMap | null {
  const movementType: string = partner?.system?.movementType === 'infantry'
    ? (partner?.system?.supportLine || '')
    : (partner?.system?.movementType || '');

  if (!isSupportLine(movementType)) return null;
  return SUPPORT_BONUSES[movementType][rank] ?? null;
}

export function supportEffectData(partner: Actor, rank: SupportRank): BuffEffectData | null {
  const bonuses = supportBonusFrom(partner, rank);
  if (!bonuses) return null;

  const changes = bonusChanges(bonuses);
  if (!changes.length) return null;

  return buffEffectData(
    { kind: BUFF_KINDS.support, key: partner.id, rank },
    {
      name: `Support: ${partner.name} (${rank})`,
      img: 'icons/svg/heal.svg',
      origin: partner.uuid ?? '',
      changes
    }
  );
}

/**
 * Apply or drop the support bonus depending on whether the partner is close
 * enough. Supports must be mutual and only one may be active per map (rules p.21).
 */
export async function syncSupportEffect(
  actor: Actor,
  partner: Actor | null,
  rank: SupportRank | null,
  inRange: boolean
): Promise<boolean> {
  const existing = buffEffects(actor, BUFF_KINDS.support);
  const data = inRange && partner && rank ? supportEffectData(partner, rank) : null;
  const key = data ? partner!.id : null;

  const matches = (effect: ActiveEffect): boolean => {
    const buff = buffFlags(effect);
    return !!buff && buff.key === key && buff.rank === rank;
  };

  const stale = existing.filter(effect => !matches(effect));
  if (stale.length) await actor.deleteEmbeddedDocuments('ActiveEffect', stale.map(effect => effect.id));

  if (!data) return false;
  if (existing.some(matches)) return false;

  await actor.createEmbeddedDocuments('ActiveEffect', [data]);
  return true;
}
