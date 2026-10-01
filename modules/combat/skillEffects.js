/**
 * Skill effect evaluation.
 *
 * Skills carry a tag vocabulary in the seed data. This module turns the tags a
 * unit knows into concrete combat modifiers, given the context of a single
 * matchup. Keeping it pure means the forecast, the resolver and the tests all
 * read the same numbers.
 */

const SIGNED = /^([+-]?\d+(?:\.\d+)?)$/;

/** Parse `grant:hit:+3` into `{ key: 'hit', value: 3 }`. */
function parseGrant(tag) {
  const parts = tag.split(':');
  if (parts.length !== 3 || parts[0] !== 'grant') return null;
  const match = SIGNED.exec(parts[2]);
  return match ? { key: parts[1], value: Number(match[1]) } : null;
}

/** Parse `condition:foeDamageType:physical:hit+1` into its grant half. */
function parseInlineGrant(tail) {
  const match = /^([a-zA-Z]+)([+-]\d+)$/.exec(tail);
  return match ? { key: match[1], value: Number(match[2]) } : null;
}

const hpFraction = profile => {
  const max = profile.totals.hp;
  return max > 0 ? profile.currentHP / max : 0;
};

/**
 * Evaluate one `condition:*` tag.
 * @param {string} tag
 * @param {object} ctx Matchup context.
 * @returns {boolean|{grant: object}} True/false, or an inline grant when the tag carries one.
 */
function evaluateCondition(tag, ctx) {
  const body = tag.slice('condition:'.length);
  const { self, foe } = ctx;

  // HP thresholds, e.g. `hp>=50%`
  const hpMatch = /^hp(>=|<=)(\d+)%$/.exec(body);
  if (hpMatch) {
    const threshold = Number(hpMatch[2]) / 100;
    const fraction = hpFraction(self);
    return hpMatch[1] === '>=' ? fraction >= threshold : fraction <= threshold;
  }

  if (body.startsWith('foeWeapon:')) {
    return foe.equipped?.group === body.slice('foeWeapon:'.length);
  }

  if (body.startsWith('foeMovement:')) {
    const want = body.slice('foeMovement:'.length);
    if (want.startsWith('not')) {
      const excluded = want.slice(3).toLowerCase().split('|');
      return !excluded.includes(foe.movementType);
    }
    return foe.movementType === want;
  }

  // `foeDamageType:physical:hit+1` grants only when the foe's weapon matches.
  if (body.startsWith('foeDamageType:')) {
    const [, type, tail] = body.split(':');
    if ((foe.equipped?.damageType ?? 'physical') !== type) return false;
    const grant = tail ? parseInlineGrant(tail) : null;
    return grant ? { grant } : true;
  }

  if (body.startsWith('foeRange:')) {
    const want = body.slice('foeRange:'.length);
    return want.startsWith('>=') ? ctx.distance >= Number(want.slice(2)) : ctx.distance === Number(want);
  }

  if (body === 'terrainEffectActive') return ctx.selfTerrainActive;
  if (body === 'terrainEffect:none') return !ctx.selfTerrainActive;
  if (body === 'atk>foeAtk') return self.totals.atk > foe.totals.atk;
  if (body === 'spd>foeSpd') return self.totals.spd > foe.totals.spd;
  if (body === 'foeLevel<=userLevel') return foe.level <= self.level;
  if (body === 'rematch') return !!ctx.rematch;
  if (body === 'rescuing') return !!ctx.rescuing;

  const parity = /^turnParity:(even|odd)$/.exec(body);
  if (parity) return (ctx.turn % 2 === 0) === (parity[1] === 'even');

  const noAlly = /^noAllyWithin:(\d+)$/.exec(body);
  if (noAlly) {
    // Without board data assume the condition is unmet rather than silently granting a bonus.
    return ctx.alliesWithin === undefined ? false : ctx.alliesWithin(Number(noAlly[1])) === 0;
  }

  // Unknown conditions are treated as unmet so a skill never fires by accident.
  return false;
}

/** Skills whose tags only make sense once the unit is actually attacking. */
const ROLE_TAGS = { 'requires:initiator': 'attacker', 'requires:defender': 'defender' };

/**
 * Collect every modifier a unit's skills contribute to one matchup.
 *
 * @param {object} profile Unit profile for the skill owner.
 * @param {object} ctx `{ self, foe, role, distance, turn, selfTerrainActive, ... }`
 * @returns {object} Aggregated modifiers plus the list of skills that fired.
 */
export function evaluateSkills(profile, ctx) {
  const result = {
    stats: { atk: 0, spd: 0, dex: 0, def: 0, res: 0, luck: 0, hp: 0 },
    hit: 0,
    avoid: 0,
    movement: 0,
    maxRange: 0,
    bonusDamage: 0,
    damageTaken: 0,
    physicalDamageTaken: 0,
    magicalDamageTaken: 0,
    enemyCritAvoid: 0,
    bonusCharge: 0,
    amplifyTriangle: false,
    cancelTriangle: false,
    guaranteedFollowup: false,
    denyFollowupBoth: false,
    denyFoeFollowup: false,
    attackFirst: false,
    followupBeforeCounter: false,
    immuneCritMultiplier: false,
    immuneEffective: new Set(),
    denyChargeToFoe: false,
    disablePrioritySkills: false,
    disableFrequencySkills: false,
    counterAtAnyRange: false,
    staffInitiate: false,
    damageUsesLowerDefRes: false,
    damageVsRes: false,
    reverseLifesteal: false,
    postCombatDamage: 0,
    minDamage: 0,
    active: []
  };

  const STAT_KEYS = new Set(Object.keys(result.stats));

  for (const skill of profile.skillList ?? []) {
    const tags = skill.tags ?? [];
    if (!tags.length) continue;

    // Combat Arts are opt-in and cost Charge, so they never apply passively.
    if (tags.includes('combatArt')) continue;

    const roleTag = tags.find(tag => ROLE_TAGS[tag]);
    if (roleTag && ROLE_TAGS[roleTag] !== ctx.role) continue;

    const inlineGrants = [];
    let conditionsMet = true;
    for (const tag of tags) {
      if (!tag.startsWith('condition:')) continue;
      const outcome = evaluateCondition(tag, ctx);
      if (outcome === false) { conditionsMet = false; break; }
      if (outcome && outcome.grant) inlineGrants.push(outcome.grant);
    }
    if (!conditionsMet) continue;

    // Auras affect neighbours rather than the owner, so skip them here.
    if (tags.some(tag => tag.startsWith('aura:'))) continue;

    let fired = false;
    const apply = ({ key, value }) => {
      if (STAT_KEYS.has(key)) result.stats[key] += value;
      else if (key === 'hit') result.hit += value;
      else if (key === 'avoid') result.avoid += value;
      else if (key === 'movement') result.movement += value;
      else if (key === 'maxRange') result.maxRange += value;
      else return;
      fired = true;
    };

    for (const grant of inlineGrants) apply(grant);

    for (const tag of tags) {
      const grant = parseGrant(tag);
      if (grant) { apply(grant); continue; }

      switch (tag) {
        case 'amplify:weaponTriangle': result.amplifyTriangle = fired = true; break;
        case 'override:weaponTriangle': result.cancelTriangle = fired = true; break;
        case 'effect:guaranteedFollowup': result.guaranteedFollowup = fired = true; break;
        case 'deny:followup:both': result.denyFollowupBoth = fired = true; break;
        case 'deny:foeFollowup': result.denyFoeFollowup = fired = true; break;
        case 'priority:attackFirst': result.attackFirst = fired = true; break;
        case 'priority:followupBeforeCounter': result.followupBeforeCounter = fired = true; break;
        case 'immune:critMultiplier': result.immuneCritMultiplier = fired = true; break;
        case 'effect:denyChargeToFoe': result.denyChargeToFoe = fired = true; break;
        case 'disable:prioritySkills': result.disablePrioritySkills = fired = true; break;
        case 'disable:frequencySkills': result.disableFrequencySkills = fired = true; break;
        case 'enable:counterAtAnyRange': result.counterAtAnyRange = fired = true; break;
        case 'enable:staffInitiate': result.staffInitiate = fired = true; break;
        case 'damage:useLower:def|res': result.damageUsesLowerDefRes = fired = true; break;
        case 'damage:vsRes': result.damageVsRes = fired = true; break;
        case 'override:enemyLifesteal:reverse': result.reverseLifesteal = fired = true; break;
        case 'min:1': result.minDamage = Math.max(result.minDamage, 1); break;
        default: break;
      }

      if (tag.startsWith('immune:effective:')) {
        result.immuneEffective.add(tag.slice('immune:effective:'.length));
        fired = true;
      }

      const numeric = /^(effect:bonusDamage|mod:damageTaken|mod:physicalDamageTaken|mod:magicalDamageTaken|mod:enemyCritAvoid|effect:bonusCharge|effect:postCombatDamage):([+-]?\d+)$/.exec(tag);
      if (numeric) {
        const value = Number(numeric[2]);
        if (numeric[1] === 'effect:bonusDamage') result.bonusDamage += value;
        if (numeric[1] === 'mod:damageTaken') result.damageTaken += value;
        if (numeric[1] === 'mod:physicalDamageTaken') result.physicalDamageTaken += value;
        if (numeric[1] === 'mod:magicalDamageTaken') result.magicalDamageTaken += value;
        if (numeric[1] === 'mod:enemyCritAvoid') result.enemyCritAvoid += value;
        if (numeric[1] === 'effect:bonusCharge') result.bonusCharge += value;
        if (numeric[1] === 'effect:postCombatDamage') result.postCombatDamage += value;
        fired = true;
      }
    }

    if (fired) result.active.push(skill.name ?? skill.key);
  }

  return result;
}

/**
 * Hardy Bearing shuts off priority and frequency skills for *both* sides (p.33).
 * @param {object} selfMods
 * @param {object} foeMods
 */
export function applyMutualDisables(selfMods, foeMods) {
  const priorityOff = selfMods.disablePrioritySkills || foeMods.disablePrioritySkills;
  const frequencyOff = selfMods.disableFrequencySkills || foeMods.disableFrequencySkills;

  for (const mods of [selfMods, foeMods]) {
    if (priorityOff) {
      mods.attackFirst = false;
      mods.followupBeforeCounter = false;
      mods.guaranteedFollowup = false;
    }
    if (frequencyOff) mods.denyFollowupBoth = false;
  }
}
