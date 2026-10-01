/**
 * Non-attack actions a unit can take on its phase (rules p.22-25).
 */

import { buildUnitProfile } from '../rules.ts';
import { weaponTags } from '../refineIndex.ts';
import { clearStatusesOnKO, cureStatuses } from '../effects/statuses.ts';
import { applyTonic } from '../effects/buffs.ts';
import { tokenDistance } from './apply.ts';

const announce = (token: Token, flavor: string): Promise<ChatMessage> => ChatMessage.create({
  speaker: ChatMessage.getSpeaker({ token: token.document }),
  content: `<p class="hol-chat-line">${flavor}</p>`
});

/**
 * Spend one use of a consumable, applying healing, status cures and temporary
 * stat bonuses. Only one stat-boosting consumable may be active at a time (p.25).
 */
export async function useConsumable(token: Token, itemId: string, targetToken?: Token | null): Promise<void> {
  const actor = token.actor;
  const item = actor?.items.get(itemId);
  if (!item || item.type !== 'consumable') return;

  const details = item.system ?? {};
  const uses = Number(details.uses ?? 0);
  if (uses <= 0) {
    ui.notifications?.warn(`${item.name} has no uses remaining.`);
    return;
  }

  const target = details.range === 'Self' ? token : (targetToken ?? token);
  const targetActor = target.actor;
  if (!targetActor) return;

  const profile = buildUnitProfile(targetActor, { weaponTags });
  const update: Record<string, unknown> = {};
  const effects: string[] = [];

  const healMatch = /restores? (?:all )?(\d+)?\s*(?:missing )?HP/i.exec(details.effect ?? '');
  const healsAll = /all (?:missing )?HP/i.test(details.effect ?? '');
  if (healsAll) {
    update['system.resources.hp.value'] = profile.totals.hp;
    effects.push('fully healed');
  } else if (healMatch?.[1]) {
    const healed = Math.min(profile.totals.hp, profile.currentHP + Number(healMatch[1]));
    update['system.resources.hp.value'] = healed;
    effects.push(`restored ${healed - profile.currentHP} HP`);
  }

  if (/removes all statuses/i.test(details.effect ?? '')) {
    const cured = await cureStatuses(targetActor);
    effects.push(cured.length ? `cured ${cured.join(', ')}` : 'no statuses to cure');
  } else if (/removes poisoned/i.test(details.effect ?? '')) {
    const cured = await cureStatuses(targetActor, { keys: ['poisoned'] });
    effects.push(cured.length ? 'cured poison' : 'no poison to cure');
  }

  const tonicApplied = await applyTonic(targetActor, item);
  if (tonicApplied) {
    const bonuses = Object.entries(details.temporaryStatBonuses ?? {}).filter(([, value]) => Number(value));
    effects.push(bonuses.map(([key, value]) => `${key.toUpperCase()} +${value}`).join(', '));
  }

  if (Object.keys(update).length) await targetActor.update(update);
  await item.update({ 'system.uses': uses - 1 });

  await announce(token, `uses <strong>${item.name}</strong> on ${target.name}: ${effects.join('; ') || 'no mechanical effect'}. (${uses - 1} use${uses - 1 === 1 ? '' : 's'} left)`);
}

/**
 * Use the equipped staff's Heal effect on an ally. Healing restores Attack + Might,
 * improved by Mend / Recover refines (rules p.52).
 */
export async function useStaffEffect(token: Token, targetToken?: Token | null): Promise<void> {
  const actor = token.actor;
  if (!actor) return;
  const profile = buildUnitProfile(actor, { weaponTags });
  const weapon = profile.equipped;

  if (weapon?.group !== 'staff') {
    ui.notifications?.warn('No staff equipped.');
    return;
  }
  if (profile.status.blocksMagic) {
    ui.notifications?.warn('Silenced units cannot use Staff Effects.');
    return;
  }
  if (!targetToken) {
    ui.notifications?.warn('Target the ally you want to heal.');
    return;
  }

  const distance = tokenDistance(token, targetToken);
  // The weapon's own range already reflects Physic and other range refines.
  if (distance > Math.max(1, weapon.range.max)) {
    ui.notifications?.warn(`${targetToken.name} is out of staff range (${distance} away).`);
    return;
  }

  const targetActor = targetToken.actor;
  if (!targetActor) return;
  const targetProfile = buildUnitProfile(targetActor, { weaponTags });
  const amount = profile.totals.atk + weapon.might;
  const healed = Math.min(targetProfile.totals.hp, targetProfile.currentHP + amount);

  const update = { 'system.resources.hp.value': healed };
  if (weapon.tags.has('statusCure:all')) await cureStatuses(targetActor);
  await targetActor.update(update);

  // Live to Serve mirrors the healing back onto the caster.
  if (profile.skills.has('live-to-serve')) {
    await actor.update({
      'system.resources.hp.value': Math.min(profile.totals.hp, profile.currentHP + (healed - targetProfile.currentHP))
    });
  }

  await actor.update({ 'system.charge': profile.derived.charge + 1 });
  await announce(token, `heals <strong>${targetToken.name}</strong> for ${healed - targetProfile.currentHP} HP with ${weapon.name}.`);
}

/** Transforming is a free action; the Gauge starts at 4 and ticks down each turn (p.11). */
export async function toggleTransform(token: Token): Promise<void> {
  const actor = token.actor;
  if (!actor) return;
  const profile = buildUnitProfile(actor, { weaponTags });

  if (!profile.isShifter) {
    ui.notifications?.warn('Only Strike, Talon and Breath users can transform.');
    return;
  }

  const transforming = !profile.isTransformed;
  await actor.update({ 'system.gauge': transforming ? 4 : 0 });
  await announce(token, transforming
    ? 'transforms. <strong>Gauge 4</strong>.'
    : 'returns to their untransformed state.');
}

/** A unit can rescue anyone whose Con is lower than their Aid (rules p.25). */
export async function rescueTarget(token: Token, targetToken?: Token | null): Promise<void> {
  if (!targetToken) {
    ui.notifications?.warn('Target the ally you want to rescue.');
    return;
  }
  if (!token.actor || !targetToken.actor) return;

  const rescuer = buildUnitProfile(token.actor, { weaponTags });
  const rescuee = buildUnitProfile(targetToken.actor, { weaponTags });
  const distance = tokenDistance(token, targetToken);

  if (distance > 1) {
    ui.notifications?.warn(`${targetToken.name} must be adjacent to be rescued.`);
    return;
  }
  if (rescuer.derived.aid <= rescuee.derived.con) {
    ui.notifications?.warn(`Aid ${rescuer.derived.aid} is not greater than ${targetToken.name}'s Con ${rescuee.derived.con}.`);
    return;
  }

  await announce(token, `rescues <strong>${targetToken.name}</strong> (Aid ${rescuer.derived.aid} vs Con ${rescuee.derived.con}). While carrying, this unit takes Disadvantage on attacks and foes take Advantage against them.`);
}

export async function waitAction(token: Token): Promise<void> {
  await announce(token, 'waits.');
}

/**
 * Start-of-phase bookkeeping (rules p.22): terrain and status HP changes, status
 * countdown, and the Gauge tick for transformed units.
 */
/**
 * Start-of-phase bookkeeping for one unit (rules p.22): terrain and status HP
 * changes, and the Gauge tick for transformed units.
 *
 * Status *expiry* is not handled here. A status counts down on the phase of
 * whoever inflicted it, which is combat-wide rather than per-unit, so that runs
 * once per phase change in the turn automation.
 */
export async function runPhaseStart(actor: Actor): Promise<string[]> {
  const profile = buildUnitProfile(actor, { weaponTags });
  const update: Record<string, unknown> = {};
  const notes: string[] = [];

  let hp = profile.currentHP;

  if (profile.terrainHpStart) {
    hp = Math.min(profile.totals.hp, Math.max(0, hp + profile.terrainHpStart));
    notes.push(`${profile.terrain.label} ${profile.terrainHpStart > 0 ? '+' : ''}${profile.terrainHpStart} HP`);
  }

  // Poison can take a unit all the way to 0 (rules p.29), unlike terrain damage.
  if (profile.status.hpStart) {
    hp = Math.max(0, hp + profile.status.hpStart);
    notes.push(`${profile.status.label} ${profile.status.hpStart} HP`);
  }

  if (profile.isTransformed) {
    const gauge = Math.max(1, profile.derived.gauge - 1);
    if (gauge !== profile.derived.gauge) {
      update['system.gauge'] = gauge;
      notes.push(`Gauge ${gauge}`);
    }
  }

  if (hp !== profile.currentHP) update['system.resources.hp.value'] = hp;
  if (Object.keys(update).length) await actor.update(update);

  if (profile.terrain.cureStatus) {
    const cured = await cureStatuses(actor);
    if (cured.length) notes.push(`${profile.terrain.label} cured ${cured.join(', ')}`);
  }

  if (hp <= 0) {
    const shed = await clearStatusesOnKO(actor);
    notes.push(shed.length ? `knocked out, shedding ${shed.join(', ')}` : 'knocked out');
  }

  return notes;
}
