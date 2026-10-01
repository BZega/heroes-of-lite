/**
 * Non-attack actions a unit can take on its phase (rules p.22-25).
 */

import { buildUnitProfile, STATUSES } from '../rules.js';
import { weaponTags } from '../refineIndex.js';
import { tokenDistance } from './apply.js';

const announce = (token, flavor) => ChatMessage.create({
  speaker: ChatMessage.getSpeaker({ token: token.document }),
  content: `<p class="hol-chat-line">${flavor}</p>`
});

/**
 * Spend one use of a consumable, applying healing, status cures and temporary
 * stat bonuses. Only one stat-boosting consumable may be active at a time (p.25).
 */
export async function useConsumable(token, itemId, targetToken) {
  const actor = token.actor;
  const item = actor.items.get(itemId);
  if (!item || item.type !== 'consumable') return;

  const details = item.system?.details ?? {};
  const uses = Number(details.uses ?? 0);
  if (uses <= 0) {
    ui.notifications.warn(`${item.name} has no uses remaining.`);
    return;
  }

  const target = details.range === 'Self' ? token : (targetToken ?? token);
  const targetActor = target.actor;
  if (!targetActor) return;

  const profile = buildUnitProfile(targetActor, { weaponTags });
  const update = {};
  const effects = [];

  const healMatch = /restores? (?:all )?(\d+)?\s*(?:missing )?HP/i.exec(details.effect ?? '');
  const healsAll = /all (?:missing )?HP/i.test(details.effect ?? '');
  if (healsAll) {
    update['system.currentHP'] = profile.totals.hp;
    effects.push('fully healed');
  } else if (healMatch?.[1]) {
    const healed = Math.min(profile.totals.hp, profile.currentHP + Number(healMatch[1]));
    update['system.currentHP'] = healed;
    effects.push(`restored ${healed - profile.currentHP} HP`);
  }

  if (/removes all statuses/i.test(details.effect ?? '')) {
    if (targetActor.system.status !== 'injured') update['system.status'] = 'healthy';
    effects.push('cured all statuses');
  } else if (/removes poisoned/i.test(details.effect ?? '')) {
    if (targetActor.system.status === 'poisoned') update['system.status'] = 'healthy';
    effects.push('cured poison');
  }

  const bonuses = details.temporaryStatBonuses ?? {};
  const applied = Object.entries(bonuses).filter(([, value]) => Number(value));
  if (applied.length) {
    // Overwrite rather than stack: a second tonic replaces the first.
    const tempStats = { hp: 0, atk: 0, spd: 0, dex: 0, def: 0, res: 0, luck: 0 };
    for (const [key, value] of applied) {
      if (key in tempStats) tempStats[key] = Number(value);
    }
    update['system.tempStats'] = tempStats;
    effects.push(applied.map(([key, value]) => `${key.toUpperCase()} +${value}`).join(', '));
  }

  if (Object.keys(update).length) await targetActor.update(update);
  await item.update({ 'system.details.uses': uses - 1 });

  await announce(token, `uses <strong>${item.name}</strong> on ${target.name}: ${effects.join('; ') || 'no mechanical effect'}. (${uses - 1} use${uses - 1 === 1 ? '' : 's'} left)`);
}

/**
 * Use the equipped staff's Heal effect on an ally. Healing restores Attack + Might,
 * improved by Mend / Recover refines (rules p.52).
 */
export async function useStaffEffect(token, targetToken) {
  const actor = token.actor;
  const profile = buildUnitProfile(actor, { weaponTags });
  const weapon = profile.equipped;

  if (weapon?.group !== 'staff') {
    ui.notifications.warn('No staff equipped.');
    return;
  }
  if (profile.statusKey === 'silenced') {
    ui.notifications.warn('Silenced units cannot use Staff Effects.');
    return;
  }
  if (!targetToken) {
    ui.notifications.warn('Target the ally you want to heal.');
    return;
  }

  const distance = tokenDistance(token, targetToken);
  // The weapon's own range already reflects Physic and other range refines.
  if (distance > Math.max(1, weapon.range.max)) {
    ui.notifications.warn(`${targetToken.name} is out of staff range (${distance} away).`);
    return;
  }

  const targetActor = targetToken.actor;
  const targetProfile = buildUnitProfile(targetActor, { weaponTags });
  const amount = profile.totals.atk + weapon.might;
  const healed = Math.min(targetProfile.totals.hp, targetProfile.currentHP + amount);

  const update = { 'system.currentHP': healed };
  if (weapon.tags.has('statusCure:all') && targetActor.system.status !== 'injured') {
    update['system.status'] = 'healthy';
  }
  await targetActor.update(update);

  // Live to Serve mirrors the healing back onto the caster.
  if (profile.skills.has('live-to-serve')) {
    await actor.update({ 'system.currentHP': Math.min(profile.totals.hp, profile.currentHP + (healed - targetProfile.currentHP)) });
  }

  await actor.update({ 'system.derivedStats.charge': profile.derived.charge + 1 });
  await announce(token, `heals <strong>${targetToken.name}</strong> for ${healed - targetProfile.currentHP} HP with ${weapon.name}.`);
}

/** Transforming is a free action; the Gauge starts at 4 and ticks down each turn (p.11). */
export async function toggleTransform(token) {
  const actor = token.actor;
  const profile = buildUnitProfile(actor, { weaponTags });

  if (!profile.isShifter) {
    ui.notifications.warn('Only Strike, Talon and Breath users can transform.');
    return;
  }

  const transforming = !profile.isTransformed;
  await actor.update({ 'system.derivedStats.gauge': transforming ? 4 : 0 });
  await announce(token, transforming
    ? 'transforms. <strong>Gauge 4</strong>.'
    : 'returns to their untransformed state.');
}

/** A unit can rescue anyone whose Con is lower than their Aid (rules p.25). */
export async function rescueTarget(token, targetToken) {
  if (!targetToken) {
    ui.notifications.warn('Target the ally you want to rescue.');
    return;
  }

  const rescuer = buildUnitProfile(token.actor, { weaponTags });
  const rescuee = buildUnitProfile(targetToken.actor, { weaponTags });
  const distance = tokenDistance(token, targetToken);

  if (distance > 1) {
    ui.notifications.warn(`${targetToken.name} must be adjacent to be rescued.`);
    return;
  }
  if (rescuer.derived.aid <= rescuee.derived.con) {
    ui.notifications.warn(`Aid ${rescuer.derived.aid} is not greater than ${targetToken.name}'s Con ${rescuee.derived.con}.`);
    return;
  }

  await announce(token, `rescues <strong>${targetToken.name}</strong> (Aid ${rescuer.derived.aid} vs Con ${rescuee.derived.con}). While carrying, this unit takes Disadvantage on attacks and foes take Advantage against them.`);
}

export async function waitAction(token) {
  await announce(token, 'waits.');
}

/**
 * Start-of-phase bookkeeping (rules p.22): terrain and status HP changes, status
 * countdown, and the Gauge tick for transformed units.
 */
export async function runPhaseStart(actor) {
  const profile = buildUnitProfile(actor, { weaponTags });
  const update = {};
  const notes = [];

  let hp = profile.currentHP;
  const status = STATUSES[profile.statusKey] ?? STATUSES.healthy;

  if (profile.terrainHpStart) {
    hp = Math.min(profile.totals.hp, Math.max(0, hp + profile.terrainHpStart));
    notes.push(`${profile.terrain.label} ${profile.terrainHpStart > 0 ? '+' : ''}${profile.terrainHpStart} HP`);
  }
  if (profile.terrain.cureStatus && profile.statusKey !== 'injured' && profile.statusKey !== 'healthy') {
    update['system.status'] = 'healthy';
    notes.push(`${profile.terrain.label} cured ${status.label}`);
  }
  if (status.hpStart) {
    hp = Math.max(0, hp + status.hpStart);
    notes.push(`${status.label} ${status.hpStart} HP`);
  }
  if (profile.isTransformed) {
    const gauge = Math.max(1, profile.derived.gauge - 1);
    if (gauge !== profile.derived.gauge) {
      update['system.derivedStats.gauge'] = gauge;
      notes.push(`Gauge ${gauge}`);
    }
  }

  if (hp !== profile.currentHP) update['system.currentHP'] = hp;
  if (Object.keys(update).length) await actor.update(update);
  return notes;
}
