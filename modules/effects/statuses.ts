/**
 * Status effects (rules p.29).
 *
 * Active Effects own a status's *lifecycle* — that it is present, who inflicted
 * it, whose phase counts it down, and when it expires. What a status *does* is
 * described here in `STATUS_DEFS` and read by the rules and combat engines.
 *
 * The split is deliberate: an Active Effect change can only write to a data
 * path, so it cannot express "cannot counterattack" or "Avoid becomes 0". Those
 * are behavioural, and live in the table below rather than on the actor.
 */

import { SYSTEM_ID } from '../constants.ts';
import type { StatusDef, StatusKey, StatusFlagData } from '../../types/hol.ts';

/** Statuses last 3 turns unless the source says otherwise (rules p.29). */
export const DEFAULT_STATUS_TURNS = 3;

export const STATUS_DEFS: Record<StatusKey, StatusDef> = {
  poisoned: {
    key: 'poisoned',
    label: 'Poisoned',
    img: 'icons/svg/poison.svg',
    // Can reduce HP to 0 (rules p.29), unlike terrain damage.
    hpStart: -4,
    description: 'Loses 4 HP at the start of their phase.'
  },
  silenced: {
    key: 'silenced',
    label: 'Silenced',
    img: 'icons/svg/silenced.svg',
    blocksMagic: true,
    description: 'Cannot use Magical weapons or Staff Effects.'
  },
  berserk: {
    key: 'berserk',
    label: 'Berserk',
    img: 'icons/svg/terror.svg',
    indiscriminate: true,
    description: 'Attacks nearby units regardless of affiliation.'
  },
  broken: {
    key: 'broken',
    label: 'Broken',
    img: 'icons/svg/downgrade.svg',
    blocksCounter: true,
    description: 'Cannot counterattack.'
  },
  shocked: {
    key: 'shocked',
    label: 'Shocked',
    img: 'icons/svg/paralysis.svg',
    blocksMove: true,
    description: 'Cannot move. Avoid becomes 0 and Critical Avoid 15.'
  },
  injured: {
    key: 'injured',
    label: 'Injured',
    img: 'icons/svg/blood.svg',
    combatPenalty: -3,
    unhealable: true,
    description: '-3 Attack, Speed, Defense and Resistance. Cannot be healed.'
  }
};

export const STATUS_KEYS = Object.keys(STATUS_DEFS) as StatusKey[];

export const isStatusKey = (key: unknown): key is StatusKey =>
  typeof key === 'string' && Object.hasOwn(STATUS_DEFS, key);

/** Token HUD / status icon registration. */
export function statusEffectConfig(): StatusEffectConfig[] {
  return STATUS_KEYS.map(key => ({
    id: key,
    name: STATUS_DEFS[key].label,
    img: STATUS_DEFS[key].img
  }));
}

/* -------------------------------------------- */
/*  Effect data (pure)                           */
/* -------------------------------------------- */

export interface StatusEffectOptions {
  /** Who inflicted it. */
  sourceActorId?: string;
  sourceName?: string;
  /** Token disposition whose phase counts it down. */
  phaseOwner?: number | null;
  /** Turns to recover. */
  turns?: number;
  origin?: string;
}

/** The Active Effect document data for a status. */
export function statusEffectData(
  key: string,
  { sourceActorId = '', sourceName = '', phaseOwner = null, turns = DEFAULT_STATUS_TURNS, origin = '' }: StatusEffectOptions = {}
): Record<string, unknown> | null {
  if (!isStatusKey(key)) return null;
  const def = STATUS_DEFS[key];

  const remaining = Math.max(0, Math.trunc(Number(turns) || 0));
  const status: StatusFlagData = {
    key, sourceActorId, sourceName, phaseOwner, remaining, unhealable: !!def.unhealable
  };

  return {
    name: def.label,
    img: def.img,
    statuses: [key],
    origin,
    duration: { rounds: remaining },
    flags: { [SYSTEM_ID]: { status } }
  };
}

/** Anything carrying Active Effects: a real Actor, or an effect document shape. */
interface EffectLike {
  id: string;
  disabled?: boolean;
  flags?: DocumentFlags;
}

/** The status payload carried by an Active Effect, or null if it is not a status. */
export function statusFlags(effect: EffectLike | null | undefined): StatusFlagData | null {
  const data = effect?.flags?.[SYSTEM_ID]?.['status'] as StatusFlagData | undefined;
  return data && isStatusKey(data.key) ? data : null;
}

/** Every status effect on an actor, newest last. */
export function statusEffects(actor: Actor): ActiveEffect[] {
  const effects = actor?.effects;
  if (!effects) return [];
  return effects.filter(effect => statusFlags(effect) !== null);
}

/**
 * The set of status keys currently afflicting an actor.
 * Falls back to the pre-migration `system.status` string so a world that has not
 * migrated yet still behaves correctly.
 */
export function activeStatusKeys(actor: Actor): Set<StatusKey> {
  const keys = new Set<StatusKey>();
  for (const effect of statusEffects(actor)) {
    if (effect.disabled) continue;
    const status = statusFlags(effect);
    if (status) keys.add(status.key);
  }
  if (!keys.size) {
    const legacy = actor?.system?.status;
    if (legacy && legacy !== 'healthy' && isStatusKey(legacy)) keys.add(legacy);
  }
  return keys;
}

export interface ExpiredStatus {
  id: string;
  key: StatusKey;
  label: string;
}

export interface TickedStatus {
  id: string;
  key: StatusKey;
  remaining: number;
}

/**
 * Work out what a phase change does to a set of status effects.
 * Statuses count down at the start of the phase of whoever inflicted them
 * (rules p.29), so only effects owned by this phase tick.
 *
 * @param phaseOwner Disposition of the phase that is starting.
 */
export function tickStatusEffects(
  effects: ActiveEffect[],
  phaseOwner: number
): { expired: ExpiredStatus[]; ticked: TickedStatus[] } {
  const expired: ExpiredStatus[] = [];
  const ticked: TickedStatus[] = [];

  for (const effect of effects) {
    const status = statusFlags(effect);
    if (!status) continue;
    // A status with no recorded owner is never counted down automatically.
    if (status.phaseOwner === null || status.phaseOwner === undefined) continue;
    if (Number(status.phaseOwner) !== Number(phaseOwner)) continue;

    const remaining = Math.max(0, Math.trunc(Number(status.remaining) || 0)) - 1;
    if (remaining <= 0) expired.push({ id: effect.id, key: status.key, label: STATUS_DEFS[status.key].label });
    else ticked.push({ id: effect.id, key: status.key, remaining });
  }

  return { expired, ticked };
}

/* -------------------------------------------- */
/*  Document operations                          */
/* -------------------------------------------- */

export interface ApplyStatusOptions {
  source?: Actor | null;
  turns?: number;
  phaseOwner?: number | null;
  /** Supplies the skill tags that grant immunity or shorten duration. */
  profile?: { skillTags?: Set<string> } | null;
}

/**
 * Inflict a status.
 *
 * A status that is already active cannot be re-applied, so an opponent cannot
 * refresh its duration by landing it twice (rules p.29).
 *
 * @returns Whether the status was newly applied.
 */
export async function applyStatus(
  actor: Actor,
  key: string,
  { source = null, turns, phaseOwner, profile = null }: ApplyStatusOptions = {}
): Promise<boolean> {
  if (!actor || !isStatusKey(key)) return false;
  if (activeStatusKeys(actor).has(key)) return false;

  const tags = profile?.skillTags ?? new Set<string>();
  if (tags.has('immune:statusEffects')) return false;

  // Steady Heart and friends shorten every status the unit receives.
  let duration = turns ?? DEFAULT_STATUS_TURNS;
  for (const tag of tags) {
    const match = /^mod:statusDuration:(\d+)$/.exec(tag);
    if (match?.[1]) duration = Math.min(duration, Number(match[1]));
  }

  const data = statusEffectData(key, {
    sourceActorId: source?.id ?? '',
    sourceName: source?.name ?? '',
    phaseOwner: phaseOwner ?? dispositionOf(source),
    turns: duration,
    origin: source?.uuid ?? ''
  });
  if (!data) return false;

  await actor.createEmbeddedDocuments('ActiveEffect', [data]);
  return true;
}

/** Disposition of whoever inflicted a status, used to decide whose phase ticks it. */
export function dispositionOf(actor: Actor | null): number | null {
  if (!actor) return null;
  const token = actor.token ?? actor.getActiveTokens?.(false, true)?.[0] ?? actor.prototypeToken;
  const disposition = token?.disposition;
  return Number.isFinite(disposition) ? Number(disposition) : null;
}

/** Remove a single status. */
export async function removeStatus(actor: Actor, key: StatusKey): Promise<boolean> {
  const ids = statusEffects(actor)
    .filter(effect => statusFlags(effect)?.key === key)
    .map(effect => effect.id);
  if (!ids.length) return false;
  await actor.deleteEmbeddedDocuments('ActiveEffect', ids);
  return true;
}

export interface CureOptions {
  keys?: StatusKey[] | null;
  includeUnhealable?: boolean;
}

/**
 * Cure statuses. Injured resists everything short of a full clear, since it
 * cannot be healed by Skills, Refines, Effects, Combat Arts or Items (rules p.29).
 */
export async function cureStatuses(
  actor: Actor,
  { keys = null, includeUnhealable = false }: CureOptions = {}
): Promise<string[]> {
  const cured: string[] = [];
  const ids: string[] = [];
  for (const effect of statusEffects(actor)) {
    const status = statusFlags(effect);
    if (!status) continue;
    if (keys && !keys.includes(status.key)) continue;
    if (status.unhealable && !includeUnhealable) continue;
    ids.push(effect.id);
    cured.push(STATUS_DEFS[status.key].label);
  }
  if (!ids.length) return [];
  await actor.deleteEmbeddedDocuments('ActiveEffect', ids);
  return cured;
}

/** A unit reduced to 0 HP loses every status, Injured included (rules p.29). */
export async function clearStatusesOnKO(actor: Actor): Promise<string[]> {
  return cureStatuses(actor, { includeUnhealable: true });
}

/**
 * Count down every status owned by the phase that is starting.
 * @returns Labels of the statuses that wore off.
 */
export async function advanceStatusPhase(actor: Actor, phaseOwner: number): Promise<string[]> {
  const effects = statusEffects(actor);
  if (!effects.length) return [];

  const { expired, ticked } = tickStatusEffects(effects, phaseOwner);

  if (ticked.length) {
    await actor.updateEmbeddedDocuments('ActiveEffect', ticked.map(entry => ({
      _id: entry.id,
      [`flags.${SYSTEM_ID}.status.remaining`]: entry.remaining,
      'duration.rounds': entry.remaining
    })));
  }
  if (expired.length) {
    await actor.deleteEmbeddedDocuments('ActiveEffect', expired.map(entry => entry.id));
  }
  return expired.map(entry => entry.label);
}
