/**
 * Support automation.
 *
 * Two supported units gain stat bonuses while within 2 tiles of one another
 * (rules p.21). The pairing must be mutual and only one support may be active
 * per map, so both conditions are checked before any bonus is granted.
 */

import { SUPPORT_RANGE, syncSupportEffect } from '../effects/buffs.ts';
import { tokenDistance } from '../combat/apply.ts';
import type { SupportRank } from '../../types/hol.ts';

/**
 * The partner an actor has nominated for this map, but only if the nomination
 * is mutual and both sides agree on a rank.
 */
export function activeSupportFor(actor: Actor): { partner: Actor; rank: SupportRank } | null {
  const partnerId: string = actor?.system?.activeSupport;
  if (!partnerId) return null;

  const partner = game.actors?.get(partnerId);
  if (!partner || partner.id === actor.id) return null;

  // Mutual nomination (rules p.21): A must pick B and B must pick A.
  if (partner.system?.activeSupport !== actor.id) return null;

  const rank: SupportRank | undefined = actor.system?.supports?.[partnerId];
  if (!rank) return null;

  return { partner, rank };
}

/** The token representing an actor on the current scene, if any. */
function tokenFor(actor: Actor | null): Token | null {
  const document = actor?.getActiveTokens?.(false, true)?.[0];
  return (document?.object as Token | undefined) ?? null;
}

/**
 * Re-evaluate one actor's support bonus against its partner's position.
 * Safe to call repeatedly; the effect layer only writes when something changed.
 */
export async function syncSupportFor(actor: Actor): Promise<void> {
  const support = activeSupportFor(actor);
  if (!support) {
    await syncSupportEffect(actor, null, null, false);
    return;
  }

  const self = tokenFor(actor);
  const other = tokenFor(support.partner);
  // Off-scene partners simply provide nothing rather than erroring.
  const inRange = !!self && !!other && tokenDistance(self, other) <= SUPPORT_RANGE;

  await syncSupportEffect(actor, support.partner, support.rank, inRange);
}

/** Re-evaluate both halves of a pairing after one of them moves. */
export async function syncSupportPair(actor: Actor): Promise<void> {
  await syncSupportFor(actor);
  const support = activeSupportFor(actor);
  if (support) await syncSupportFor(support.partner);
}

export function registerSupportAutomation(): void {
  Hooks.on('updateToken', async (tokenDocument: TokenDocument, changes: Record<string, unknown>) => {
    if (!game.users.activeGM?.isSelf) return;
    if (!('x' in changes) && !('y' in changes)) return;

    const actor = tokenDocument.actor;
    if (actor?.type !== 'unit') return;
    await syncSupportPair(actor);
  });

  // A nomination or rank change can make a bonus apply without anyone moving.
  Hooks.on('updateActor', async (actor: Actor, changes: Record<string, any>) => {
    if (!game.users.activeGM?.isSelf) return;
    if (actor.type !== 'unit') return;
    const system = changes?.system ?? {};
    if (!('activeSupport' in system) && !('supports' in system) && !('supportLine' in system)) return;
    await syncSupportPair(actor);
  });
}
