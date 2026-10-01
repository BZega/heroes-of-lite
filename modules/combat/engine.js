/**
 * Combat resolution for Heroes of Lite (rules p.22-24).
 *
 * `buildForecast` is pure: it takes two unit profiles and produces the Fire Emblem
 * style preview numbers. `resolveCombat` then rolls that forecast out strike by strike.
 */

import { triangleRelation, EFFECTIVE_TAGS } from '../rules.js';
import { evaluateSkills, applyMutualDisables } from './skillEffects.js';

/** A d20 roll needs to beat Avoid outright; ties go to the defender (rules p.23). */
export function requiredRoll(hit, avoid) {
  return avoid - hit + 1;
}

/** Probability that a d20 meets or beats `needed`, honouring advantage/disadvantage. */
export function rollChance(needed, mode = 'normal') {
  const single = Math.min(1, Math.max(0, (21 - needed) / 20));
  if (mode === 'advantage') return 1 - (1 - single) ** 2;
  if (mode === 'disadvantage') return single ** 2;
  return single;
}

/**
 * Advantage comes from out-ranging the foe's Avoid; disadvantage from trailing it
 * by 8 or more. Having both cancels out (rules p.23).
 */
export function accuracyMode(hit, avoid, { forceAdvantage = false, forceDisadvantage = false } = {}) {
  const advantage = forceAdvantage || hit > avoid;
  const disadvantage = forceDisadvantage || hit <= avoid - 8;
  if (advantage && disadvantage) return 'normal';
  if (advantage) return 'advantage';
  if (disadvantage) return 'disadvantage';
  return 'normal';
}

/** Slaying refines triple Might against the matching Trait, and do not stack. */
export function effectiveMultiplier(tags, defenderTraits) {
  const traits = new Set(defenderTraits);
  for (const [tag, trait] of Object.entries(EFFECTIVE_TAGS)) {
    if (tags.has(tag) && traits.has(trait)) return 3;
  }
  return 1;
}

function numericTag(tags, prefix) {
  for (const tag of tags) {
    if (tag.startsWith(prefix)) {
      const value = Number(tag.slice(prefix.length));
      if (Number.isFinite(value)) return value;
    }
  }
  return null;
}

/** Maps a Shield skill's immunity onto the refine tag it negates. */
const IMMUNITY_TAGS = {
  scalerending: 'effective:scaled',
  furflaying: 'effective:furred',
  wingclipping: 'effective:winged',
  fiendslaying: 'effective:fiendish'
};

/**
 * Build one side's attacking profile against the other.
 * @returns {object} Power, damage, accuracy and crit figures for a single strike.
 */
function buildSide(profile, foeProfile, { isInitiator, mods, foeMods }) {
  const weapon = profile.equipped;
  const tags = weapon?.tags ?? new Set();
  const armed = !!weapon;

  // Skill stat grants sit on top of the profile totals and ignore stat caps (p.15).
  const totals = {};
  for (const [key, value] of Object.entries(profile.totals)) {
    totals[key] = value + (mods.stats[key] ?? 0);
  }
  const foeTotals = {};
  for (const [key, value] of Object.entries(foeProfile.totals)) {
    foeTotals[key] = value + (foeMods.stats[key] ?? 0);
  }

  let triangle = triangleRelation(weapon?.group, foeProfile.equipped?.group, tags);
  // Cancel Affinity switches the triangle off for both combatants (p.33).
  if (mods.cancelTriangle || foeMods.cancelTriangle) triangle = 'neutral';

  // Shields deny effectiveness against the matching slaying attribute.
  const immune = [...foeMods.immuneEffective].some(kind => {
    const tag = IMMUNITY_TAGS[kind];
    return tag && tags.has(tag);
  });
  const multiplier = armed && !immune ? effectiveMultiplier(tags, foeProfile.traits) : 1;

  // A staff brings only the user's Attack to a counterattack unless they have
  // Wrathful Staff, which lets it be used like any other weapon (rules p.10/p.37).
  const wrathfulStaff = mods.staffInitiate || (profile.skills?.has('wrathful-staff') ?? false);
  const staffCounter = weapon?.group === 'staff' && !isInitiator && !wrathfulStaff;
  const might = !armed || staffCounter ? 0 : weapon.might * multiplier;

  let power = totals.atk + might + profile.powerBonus;
  const tri = Math.floor(power / 5);
  if (triangle === 'advantage') power += tri;
  if (triangle === 'disadvantage') power -= tri;

  // Blessed Strike targets the softer of Def/Res; Sorcery Blade forces Res.
  const mitigationStat = mods.damageUsesLowerDefRes
    ? (foeTotals.def <= foeTotals.res ? 'def' : 'res')
    : mods.damageVsRes || weapon?.damageType === 'magical' ? 'res' : 'def';
  const mitigation = foeTotals[mitigationStat];

  const typedReduction = weapon?.damageType === 'magical'
    ? foeMods.magicalDamageTaken
    : foeMods.physicalDamageTaken;
  const reduction = foeMods.damageTaken + typedReduction;
  const baseDamage = Math.max(1, power - mitigation + mods.bonusDamage + reduction);

  const hit = profile.derived.hit + mods.hit
    + (triangle === 'advantage' ? 2 : triangle === 'disadvantage' ? -2 : 0);
  const avoid = foeProfile.derived.avoid + foeMods.avoid;

  // Triangle Adept converts the triangle into full Advantage / Disadvantage (p.33).
  const mode = accuracyMode(hit, avoid, {
    forceAdvantage: mods.amplifyTriangle && triangle === 'advantage',
    forceDisadvantage: mods.amplifyTriangle && triangle === 'disadvantage'
  });

  // A Killer refine or Wrath lowers the *opponent's* Critical Avoid.
  const critAvoidTarget = foeProfile.derived.critAvoid
    + (numericTag(tags, 'mod:enemyCritAvoid:') ?? 0)
    + mods.enemyCritAvoid;
  const canCrit = !tags.has('limit:noCrit');

  const range = weapon?.range ?? { min: 1, max: 1 };
  const effectiveRange = { min: range.min, max: range.max + mods.maxRange };

  const hitNeeded = requiredRoll(hit, avoid);
  const critNeeded = requiredRoll(hit, critAvoidTarget);

  return {
    armed,
    weaponName: weapon?.name ?? 'Unarmed',
    weaponGroup: weapon?.group ?? '',
    damageType: weapon?.damageType ?? 'physical',
    range: effectiveRange,
    tags,
    mods,
    totals,
    triangle,
    effective: multiplier > 1,
    effectiveNegated: immune,
    power,
    tri,
    damage: baseDamage,
    mitigationStat,
    hit,
    avoid,
    critAvoidTarget,
    mode,
    hitNeeded,
    hitChance: rollChance(hitNeeded, mode),
    canCrit,
    critMultiplier: numericTag(tags, 'critMultiplier:') ?? 2,
    critNeeded,
    critChance: canCrit ? rollChance(critNeeded, mode) : 0,
    staffCounter,
    wrathfulStaff,
    // Fortune strips the multiplier from incoming critical hits (p.33).
    critNegatedByFoe: foeMods.immuneCritMultiplier,
    lifesteal: foeMods.reverseLifesteal ? -(numericTag(tags, 'lifesteal:') ?? 0) : (numericTag(tags, 'lifesteal:') ?? 0),
    postCombatDamage: (numericTag(tags, 'effect:postCombatDamage:') ?? 0) + mods.postCombatDamage,
    halvesRemainingHP: tags.has('effect:replaceDamage:halveRemainingHP'),
    activeSkills: mods.active
  };
}

/** Status refines only land when the tagged conditions are met. */
function statusFromTags(tags) {
  const statuses = new Set(['poisoned', 'silenced', 'berserk', 'broken', 'shocked', 'injured']);
  const aliases = { shock: 'shocked', break: 'broken' };
  for (const tag of tags) {
    if (!tag.startsWith('status:')) continue;
    const raw = tag.slice(7);
    const key = aliases[raw] ?? raw;
    if (statuses.has(key)) {
      return { status: key, requiresInitiator: tags.has('requires:initiator'), requiresHit: tags.has('requires:hit') };
    }
  }
  return null;
}

/**
 * Produce the full combat preview between two units.
 *
 * @param {object} args
 * @param {object} args.attacker Unit profile from `buildUnitProfile`.
 * @param {object} args.defender Unit profile from `buildUnitProfile`.
 * @param {number} args.distance Tiles between the combatants.
 * @param {number} [args.turn] Current combat turn, for parity skills.
 * @param {object} [args.context] Extra matchup facts (rematch, terrain, ally counts).
 * @returns {object} Forecast with per-side figures and the ordered strike list.
 */
export function buildForecast({ attacker, defender, distance = 1, turn = 1, context = {} }) {
  const shared = { distance, turn, ...context };

  const attackerMods = evaluateSkills(attacker, {
    ...shared,
    self: attacker,
    foe: defender,
    role: 'attacker',
    selfTerrainActive: context.attackerTerrainActive ?? hasTerrainEffect(attacker),
    rescuing: context.attackerRescuing
  });
  const defenderMods = evaluateSkills(defender, {
    ...shared,
    self: defender,
    foe: attacker,
    role: 'defender',
    selfTerrainActive: context.defenderTerrainActive ?? hasTerrainEffect(defender),
    rescuing: context.defenderRescuing
  });

  applyMutualDisables(attackerMods, defenderMods);

  const a = buildSide(attacker, defender, { isInitiator: true, mods: attackerMods, foeMods: defenderMods });
  const d = buildSide(defender, attacker, { isInitiator: false, mods: defenderMods, foeMods: attackerMods });

  const inAttackerRange = distance >= a.range.min && distance <= a.range.max;
  // Staves cannot initiate combat without Wrathful Staff (rules p.10).
  a.canAct = a.armed && inAttackerRange && (a.weaponGroup !== 'staff' || a.wrathfulStaff);

  // Distant Counter lets the defender answer from any range (rules p.65).
  const defenderInRange = defenderMods.counterAtAnyRange
    || (distance >= d.range.min && distance <= d.range.max);
  d.canAct = d.armed
    && defenderInRange
    && !defender.status.blocksCounter
    && defender.currentHP > 0;

  const spdDiff = a.totals.spd - d.totals.spd;
  const followUpBlocked = attackerMods.denyFollowupBoth || defenderMods.denyFollowupBoth;

  const attackerFollowUp = a.canAct && !followUpBlocked && !defenderMods.denyFoeFollowup
    && !a.tags.has('limit:noFollowUp')
    && (spdDiff >= 4 || (attackerMods.guaranteedFollowup && d.canAct));
  const defenderFollowUp = d.canAct && !followUpBlocked && !attackerMods.denyFoeFollowup
    && !d.tags.has('limit:noFollowUp')
    && (-spdDiff >= 4 || defenderMods.guaranteedFollowup);

  // Brave doubles each of the initiator's attacks (rules, Brave refine).
  a.strikesPerAttack = a.tags.has('effect:brave') ? 2 : 1;
  d.strikesPerAttack = 1;

  const order = [];
  const push = (side, count, label) => {
    for (let i = 0; i < count; i++) order.push({ side, label });
  };

  // Vantage lets the defender strike before the initiator (rules p.33).
  const vantage = d.canAct && defenderMods.attackFirst;
  if (vantage) push('defender', 1, 'Vantage');

  if (a.canAct) push('attacker', a.strikesPerAttack, 'Attack');

  // Desperation moves the initiator's follow-up ahead of the counter (rules p.33).
  const desperation = attackerFollowUp && attackerMods.followupBeforeCounter;
  if (desperation) push('attacker', a.strikesPerAttack, 'Follow-up');

  if (d.canAct && !vantage) push('defender', 1, 'Counter');
  if (attackerFollowUp && !desperation) push('attacker', a.strikesPerAttack, 'Follow-up');
  if (defenderFollowUp) push('defender', 1, 'Follow-up');

  a.attackCount = order.filter(entry => entry.side === 'attacker').length;
  d.attackCount = order.filter(entry => entry.side === 'defender').length;

  return {
    distance,
    turn,
    spdDiff,
    attackerFollowUp,
    defenderFollowUp,
    vantage,
    desperation,
    attacker: a,
    defender: d,
    order
  };
}

/** A unit benefits from terrain unless it is a flier or standing on neutral ground. */
function hasTerrainEffect(profile) {
  if (profile.ignoresTerrain) return false;
  const terrain = profile.terrain ?? {};
  return !!(terrain.avoid || terrain.def || terrain.hpStart);
}

/**
 * Roll out a forecast.
 *
 * @param {object} forecast Result of `buildForecast`.
 * @param {object} state `{ attacker: {hp}, defender: {hp} }` starting hit points.
 * @param {() => number} [rng] Injectable d20 source, used by the tests.
 * @returns {object} Strike log, final HP and post-combat effects.
 */
export function resolveCombat(forecast, state, rng = () => Math.ceil(Math.random() * 20)) {
  const hp = { attacker: state.attacker.hp, defender: state.defender.hp };
  const maxHp = { attacker: state.attacker.maxHp, defender: state.defender.maxHp };
  const log = [];

  const rollD20 = mode => {
    const first = rng();
    if (mode === 'normal') return { value: first, dice: [first] };
    const second = rng();
    const value = mode === 'advantage' ? Math.max(first, second) : Math.min(first, second);
    return { value, dice: [first, second] };
  };

  for (const entry of forecast.order) {
    if (hp.attacker <= 0 || hp.defender <= 0) break;

    const side = entry.side;
    const foe = side === 'attacker' ? 'defender' : 'attacker';
    const profile = forecast[side];

    const { value, dice } = rollD20(profile.mode);
    const total = value + profile.hit;
    const hitLanded = total > profile.avoid;
    const crit = hitLanded && profile.canCrit && total > profile.critAvoidTarget;

    let damage = 0;
    if (hitLanded) {
      // Fortune strips the multiplier but the hit still lands (rules p.33).
      const multiplier = crit && !profile.critNegatedByFoe ? profile.critMultiplier : 1;
      damage = profile.halvesRemainingHP
        ? Math.max(0, Math.floor(hp[foe] / 2))
        : profile.damage * multiplier;

      const floor = forecast[foe].mods?.minDamage ?? 0;
      if (floor) damage = Math.max(floor, damage);
      if (profile.tags.has('limit:noLethal')) damage = Math.min(damage, Math.max(0, hp[foe] - 1));
      hp[foe] = Math.max(0, hp[foe] - damage);

      if (profile.lifesteal) {
        const healed = Math.trunc(damage * (profile.lifesteal / 100));
        hp[side] = Math.max(0, Math.min(maxHp[side], hp[side] + healed));
      }
    }

    log.push({
      side,
      label: entry.label,
      dice,
      roll: value,
      total,
      mode: profile.mode,
      hit: hitLanded,
      crit,
      damage,
      targetHp: hp[foe]
    });
  }

  const postCombat = [];
  for (const side of ['attacker', 'defender']) {
    const foe = side === 'attacker' ? 'defender' : 'attacker';
    const profile = forecast[side];
    if (!profile.canAct) continue;

    const landedAHit = log.some(entry => entry.side === side && entry.hit);

    if (profile.postCombatDamage && hp[foe] > 0) {
      hp[foe] = Math.max(0, hp[foe] - profile.postCombatDamage);
      postCombat.push({ side, target: foe, type: 'damage', amount: profile.postCombatDamage });
    }

    const status = statusFromTags(profile.tags);
    if (status && hp[foe] > 0) {
      const initiatorOk = !status.requiresInitiator || side === 'attacker';
      const hitOk = !status.requiresHit || landedAHit;
      if (initiatorOk && hitOk) postCombat.push({ side, target: foe, type: 'status', status: status.status });
    }
  }

  return {
    log,
    hp,
    postCombat,
    // Every participant that fought gains a point of Charge, plus any skill bonus,
    // unless the foe denies it with Guard (rules p.24 / p.32).
    chargeGained: {
      attacker: forecast.attacker.canAct && !forecast.defender.mods.denyChargeToFoe
        ? 1 + forecast.attacker.mods.bonusCharge : 0,
      defender: forecast.defender.canAct && !forecast.attacker.mods.denyChargeToFoe
        ? 1 + forecast.defender.mods.bonusCharge : 0
    },
    defeated: {
      attacker: hp.attacker <= 0,
      defender: hp.defender <= 0
    }
  };
}
