/**
 * Combat engine conformance checks (rules p.22-24).
 * Run with: npm run test:combat
 */

import assert from 'node:assert/strict';
import { buildForecast, resolveCombat, accuracyMode, rollChance, requiredRoll, effectiveMultiplier } from '../modules/combat/engine.ts';
import { diceNeeded } from '../modules/combat/apply.ts';
import { triangleRelation } from '../modules/rules.ts';

/** Minimal stand-in for `buildUnitProfile` output. */
function profile({
  atk = 10, spd = 5, dex = 8, def = 5, res = 5, luck = 4, hp = 30,
  hit = 2, avoid = 5, critAvoid = 20, power = 0,
  group = 'sword', damageType = 'physical', might = 6, range = { min: 1, max: 1 },
  tags = [], traits = [], skills = [], skillList = [], status = {}, currentHP = null,
  movementType = 'infantry', level = 10, terrain = {}, ignoresTerrain = false
} = {}) {
  return {
    totals: { hp, atk, spd, dex, def, res, luck },
    derived: { hit, avoid, critAvoid, charge: 0, gauge: 0 },
    powerBonus: power,
    equipped: group === null ? null : { name: 'Test Weapon', group, damageType, might, range, tags: new Set(tags) },
    traits,
    skills: new Set(skills),
    skillList,
    status,
    movementType,
    level,
    terrain,
    ignoresTerrain,
    currentHP: currentHP ?? hp
  };
}

/** Build a skill entry the way `buildUnitProfile` would. */
const skill = (name, tags, extra = {}) => ({ key: name.toLowerCase().replace(/\s+/g, '-'), name, tags, type: 'passive', requiredCharge: 0, ...extra });

/** Deterministic d20 source. */
const fixedRolls = values => {
  let index = 0;
  return () => values[index++] ?? 10;
};

const tests = {
  'A tie on accuracy goes to the defender': () => {
    // Hit 2 + roll 3 = 5 against Avoid 5 must miss.
    assert.equal(requiredRoll(2, 5), 4);
    const f = buildForecast({ attacker: profile({ hit: 2 }), defender: profile({ avoid: 5, spd: 5 }), distance: 1 });
    const result = resolveCombat(f, { attacker: { hp: 30, maxHp: 30 }, defender: { hp: 30, maxHp: 30 } }, fixedRolls([3, 20]));
    assert.equal(result.log[0].hit, false);
  },

  'Advantage applies when Hit exceeds Avoid': () => {
    assert.equal(accuracyMode(10, 5), 'advantage');
    assert.equal(accuracyMode(1, 9), 'disadvantage');
    // Holding both cancels out.
    assert.equal(accuracyMode(10, 5, { forceDisadvantage: true }), 'normal');
  },

  'Advantage and disadvantage reshape the odds': () => {
    const base = rollChance(11, 'normal');
    assert.ok(rollChance(11, 'advantage') > base);
    assert.ok(rollChance(11, 'disadvantage') < base);
    assert.equal(rollChance(1, 'normal'), 1);
    assert.equal(rollChance(21, 'normal'), 0);
  },

  'Weapon triangle follows both physical and magical cycles': () => {
    assert.equal(triangleRelation('sword', 'axe'), 'advantage');
    assert.equal(triangleRelation('axe', 'lance'), 'advantage');
    assert.equal(triangleRelation('lance', 'sword'), 'advantage');
    assert.equal(triangleRelation('axe', 'sword'), 'disadvantage');
    assert.equal(triangleRelation('anima', 'light'), 'advantage');
    assert.equal(triangleRelation('dark', 'anima'), 'advantage');
    assert.equal(triangleRelation('sword', 'bow'), 'neutral');
  },

  'The Adaptive refine grants WTA against its listed groups': () => {
    const tags = new Set(['wta:stones,strikes,breaths,talons,bows,daggers,staves,curses']);
    assert.equal(triangleRelation('anima', 'shiftingStone', tags), 'advantage');
    assert.equal(triangleRelation('anima', 'bow', tags), 'advantage');
    assert.equal(triangleRelation('anima', 'sword', tags), 'neutral');
  },

  'WTA adds Tri to Power and +2 Hit; WTD subtracts': () => {
    const neutral = buildForecast({
      attacker: profile({ atk: 10, might: 6, group: 'sword' }),
      defender: profile({ group: 'bow', def: 5 }),
      distance: 1
    });
    // Power 16, no triangle, minus Def 5.
    assert.equal(neutral.attacker.power, 16);
    assert.equal(neutral.attacker.damage, 11);

    const advantaged = buildForecast({
      attacker: profile({ atk: 10, might: 6, group: 'sword', hit: 2 }),
      defender: profile({ group: 'axe', def: 5 }),
      distance: 1
    });
    // Tri = floor(16/5) = 3, so Power 19 and Hit 4.
    assert.equal(advantaged.attacker.power, 19);
    assert.equal(advantaged.attacker.damage, 14);
    assert.equal(advantaged.attacker.hit, 4);
  },

  'Effective weapons triple Might and do not stack': () => {
    assert.equal(effectiveMultiplier(new Set(['effective:scaled']), ['Scaled']), 3);
    assert.equal(effectiveMultiplier(new Set(['effective:scaled']), ['Furred']), 1);
    assert.equal(effectiveMultiplier(new Set(['effective:scaled', 'effective:furred']), ['Scaled', 'Furred']), 3);

    const f = buildForecast({
      attacker: profile({ atk: 10, might: 6, group: 'axe', tags: ['effective:scaled'] }),
      defender: profile({ group: 'bow', def: 5, traits: ['Scaled'] }),
      distance: 1
    });
    // Might 6 becomes 18, so Power 28 minus Def 5.
    assert.equal(f.attacker.damage, 23);
  },

  'Damage never drops below 1': () => {
    const f = buildForecast({
      attacker: profile({ atk: 3, might: 1, group: 'sword' }),
      defender: profile({ group: 'bow', def: 50 }),
      distance: 1
    });
    assert.equal(f.attacker.damage, 1);
  },

  'Counterattacks only happen inside the defender weapon range': () => {
    const melee = buildForecast({
      attacker: profile({ range: { min: 2, max: 2 }, group: 'bow' }),
      defender: profile({ range: { min: 1, max: 1 }, group: 'sword' }),
      distance: 2
    });
    assert.equal(melee.attacker.canAct, true);
    assert.equal(melee.defender.canAct, false);

    const ranged = buildForecast({
      attacker: profile({ range: { min: 1, max: 2 }, group: 'anima' }),
      defender: profile({ range: { min: 1, max: 2 }, group: 'light' }),
      distance: 2
    });
    assert.equal(ranged.defender.canAct, true);
  },

  'Broken units cannot counterattack': () => {
    const f = buildForecast({
      attacker: profile(),
      defender: profile({ status: { blocksCounter: true } }),
      distance: 1
    });
    assert.equal(f.defender.canAct, false);
  },

  'Four or more Speed grants a follow-up': () => {
    const even = buildForecast({ attacker: profile({ spd: 7 }), defender: profile({ spd: 4 }), distance: 1 });
    assert.equal(even.attackerFollowUp, false);

    const fast = buildForecast({ attacker: profile({ spd: 8 }), defender: profile({ spd: 4 }), distance: 1 });
    assert.equal(fast.attackerFollowUp, true);
    assert.deepEqual(fast.order.map(entry => `${entry.side}:${entry.label}`), [
      'attacker:Attack', 'defender:Counter', 'attacker:Follow-up'
    ]);

    const slow = buildForecast({ attacker: profile({ spd: 4 }), defender: profile({ spd: 9 }), distance: 1 });
    assert.equal(slow.defenderFollowUp, true);
  },

  'Brave doubles every strike the initiator makes': () => {
    const f = buildForecast({
      attacker: profile({ spd: 9, tags: ['effect:brave'] }),
      defender: profile({ spd: 4 }),
      distance: 1
    });
    assert.equal(f.attacker.attackCount, 4);
    assert.deepEqual(f.order.map(entry => entry.side), [
      'attacker', 'attacker', 'defender', 'attacker', 'attacker'
    ]);
  },

  'Staves cannot initiate but counter with Attack only': () => {
    const initiating = buildForecast({
      attacker: profile({ group: 'staff', might: 5 }),
      defender: profile({ group: 'sword' }),
      distance: 1
    });
    assert.equal(initiating.attacker.canAct, false);

    const countering = buildForecast({
      attacker: profile({ group: 'sword' }),
      defender: profile({ group: 'staff', might: 5, atk: 10, def: 0 }),
      distance: 1
    });
    assert.equal(countering.defender.staffCounter, true);
    // Might is ignored, so Power is the bare Attack of 10.
    assert.equal(countering.defender.power, 10);
  },

  'Wrathful Staff lets a staff initiate with full Might': () => {
    const f = buildForecast({
      attacker: profile({ group: 'staff', might: 5, atk: 10, skills: ['wrathful-staff'] }),
      defender: profile({ group: 'sword', def: 0 }),
      distance: 1
    });
    assert.equal(f.attacker.canAct, true);
    assert.equal(f.attacker.power, 15);
  },

  'Critical hits double damage and Killer lowers Crit Avoid': () => {
    const plain = buildForecast({
      attacker: profile({ hit: 2 }),
      defender: profile({ critAvoid: 20 }),
      distance: 1
    });
    assert.equal(plain.attacker.critAvoidTarget, 20);

    const killer = buildForecast({
      attacker: profile({ hit: 2, tags: ['mod:enemyCritAvoid:-5'] }),
      defender: profile({ critAvoid: 20 }),
      distance: 1
    });
    assert.equal(killer.attacker.critAvoidTarget, 15);

    // Roll 20 + Hit 2 = 22, beating the reduced Crit Avoid of 15.
    const result = resolveCombat(killer, { attacker: { hp: 30, maxHp: 30 }, defender: { hp: 60, maxHp: 60 } }, fixedRolls([20, 1]));
    assert.equal(result.log[0].crit, true);
    assert.equal(result.log[0].damage, plain.attacker.damage * 2);
  },

  'Lethal triples critical damage': () => {
    const f = buildForecast({
      attacker: profile({ hit: 2, tags: ['mod:enemyCritAvoid:-5', 'critMultiplier:3'] }),
      defender: profile({ critAvoid: 20 }),
      distance: 1
    });
    assert.equal(f.attacker.critMultiplier, 3);
    const result = resolveCombat(f, { attacker: { hp: 30, maxHp: 30 }, defender: { hp: 99, maxHp: 99 } }, fixedRolls([20, 1]));
    assert.equal(result.log[0].damage, f.attacker.damage * 3);
  },

  'Combat stops once a combatant reaches 0 HP': () => {
    const f = buildForecast({ attacker: profile({ atk: 50, spd: 9 }), defender: profile({ spd: 4, hp: 10, def: 0 }), distance: 1 });
    const result = resolveCombat(f, { attacker: { hp: 30, maxHp: 30 }, defender: { hp: 10, maxHp: 10 } }, fixedRolls([20, 20, 20]));
    assert.equal(result.hp.defender, 0);
    assert.equal(result.defeated.defender, true);
    // The counter and follow-up never happen.
    assert.equal(result.log.length, 1);
  },

  'Resire heals the user for half the damage dealt': () => {
    const f = buildForecast({
      attacker: profile({ atk: 10, might: 6, group: 'light', tags: ['lifesteal:50'], currentHP: 10 }),
      defender: profile({ group: 'bow', def: 0, res: 0 }),
      distance: 1
    });
    const result = resolveCombat(f, { attacker: { hp: 10, maxHp: 30 }, defender: { hp: 60, maxHp: 60 } }, fixedRolls([20, 1]));
    assert.equal(result.hp.attacker, 10 + Math.floor(result.log[0].damage / 2));
  },

  'Post-combat damage and status land after the exchange': () => {
    const f = buildForecast({
      attacker: profile({ tags: ['effect:postCombatDamage:3', 'status:poisoned', 'requires:hit', 'requires:initiator'] }),
      defender: profile({ hp: 60, def: 0 }),
      distance: 1
    });
    const result = resolveCombat(f, { attacker: { hp: 30, maxHp: 30 }, defender: { hp: 60, maxHp: 60 } }, fixedRolls([20, 1]));
    assert.ok(result.postCombat.some(entry => entry.type === 'damage' && entry.amount === 3));
    assert.ok(result.postCombat.some(entry => entry.type === 'status' && entry.status === 'poisoned'));
  },

  'A missed attack cannot inflict a status that requires a hit': () => {
    const f = buildForecast({
      attacker: profile({ hit: 0, tags: ['status:silenced', 'requires:hit'] }),
      defender: profile({ avoid: 19, hp: 60 }),
      distance: 1
    });
    const result = resolveCombat(f, { attacker: { hp: 30, maxHp: 30 }, defender: { hp: 60, maxHp: 60 } }, fixedRolls([1, 1, 1, 1]));
    assert.equal(result.postCombat.some(entry => entry.type === 'status'), false);
  },

  'Half caps damage at the target remaining HP and cannot kill': () => {
    const f = buildForecast({
      attacker: profile({ group: 'curse', might: 0, tags: ['effect:replaceDamage:halveRemainingHP', 'limit:noLethal'] }),
      defender: profile({ group: 'sword', hp: 40 }),
      distance: 1
    });
    const result = resolveCombat(f, { attacker: { hp: 30, maxHp: 30 }, defender: { hp: 40, maxHp: 40 } }, fixedRolls([20, 1]));
    assert.equal(result.log[0].damage, 20);
    assert.equal(result.hp.defender, 20);
  },

  'Both combatants gain a Charge for fighting': () => {
    const f = buildForecast({ attacker: profile(), defender: profile(), distance: 1 });
    const result = resolveCombat(f, { attacker: { hp: 30, maxHp: 30 }, defender: { hp: 30, maxHp: 30 } }, fixedRolls([1, 1]));
    assert.deepEqual(result.chargeGained, { attacker: 1, defender: 1 });
  },

  /* ---------------------------------------------------------------- */
  /*  Skills                                                           */
  /* ---------------------------------------------------------------- */

  'Expertise adds flat Attack and Hit': () => {
    const f = buildForecast({
      attacker: profile({ atk: 10, might: 6, skillList: [skill('Expertise', ['grant:atk:+3', 'grant:hit:+1'])] }),
      defender: profile({ group: 'bow', def: 0 }),
      distance: 1
    });
    assert.equal(f.attacker.power, 19);
    assert.equal(f.attacker.hit, 3);
    assert.deepEqual(f.attacker.activeSkills, ['Expertise']);
  },

  'Quixotic trades Avoid for Hit on its owner only': () => {
    const quixotic = skill('Quixotic', ['grant:hit:+3', 'grant:avoid:-3']);
    const f = buildForecast({
      attacker: profile({ hit: 2, skillList: [quixotic] }),
      defender: profile({ avoid: 5, skillList: [quixotic] }),
      distance: 1
    });
    assert.equal(f.attacker.hit, 5);
    // The defender's own Quixotic lowers the Avoid the attacker must beat.
    assert.equal(f.attacker.avoid, 2);
  },

  'Breakers only fire against the named weapon': () => {
    const swordbreaker = skill('Swordbreaker', ['condition:foeWeapon:sword', 'grant:hit:+3', 'grant:avoid:+3']);
    const vsSword = buildForecast({
      attacker: profile({ group: 'lance', hit: 2, skillList: [swordbreaker] }),
      defender: profile({ group: 'sword' }),
      distance: 1
    });
    // Hit 2 + 3 from the skill, and +2 more because Lance beats Sword.
    assert.equal(vsSword.attacker.hit, 7);
    assert.deepEqual(vsSword.attacker.activeSkills, ['Swordbreaker']);

    const vsAxe = buildForecast({
      attacker: profile({ group: 'lance', hit: 2, skillList: [swordbreaker] }),
      defender: profile({ group: 'axe' }),
      distance: 1
    });
    assert.deepEqual(vsAxe.attacker.activeSkills, []);
  },

  'HP-threshold skills respect current HP': () => {
    const deathBlow = skill('Death Blow', ['condition:hp>=50%', 'requires:initiator', 'effect:bonusDamage:+3']);
    const healthy = buildForecast({
      attacker: profile({ hp: 30, currentHP: 30, def: 0, skillList: [deathBlow] }),
      defender: profile({ group: 'bow', def: 0 }),
      distance: 1
    });
    const wounded = buildForecast({
      attacker: profile({ hp: 30, currentHP: 10, def: 0, skillList: [deathBlow] }),
      defender: profile({ group: 'bow', def: 0 }),
      distance: 1
    });
    assert.equal(healthy.attacker.damage - wounded.attacker.damage, 3);
  },

  'requires:initiator skills do not fire on the counter': () => {
    const deathBlow = skill('Death Blow', ['condition:hp>=50%', 'requires:initiator', 'effect:bonusDamage:+3']);
    const f = buildForecast({
      attacker: profile({ group: 'bow' }),
      defender: profile({ group: 'sword', skillList: [deathBlow] }),
      distance: 1
    });
    assert.deepEqual(f.defender.activeSkills, []);
  },

  'Wrath lowers the foe Critical Avoid while wounded': () => {
    const wrath = skill('Wrath', ['condition:hp<=50%', 'mod:enemyCritAvoid:-5']);
    const f = buildForecast({
      attacker: profile({ hp: 30, currentHP: 9, skillList: [wrath] }),
      defender: profile({ critAvoid: 20 }),
      distance: 1
    });
    assert.equal(f.attacker.critAvoidTarget, 15);
  },

  'Vantage lets the defender strike first': () => {
    const f = buildForecast({
      attacker: profile(),
      defender: profile({ hp: 30, currentHP: 10, skillList: [skill('Vantage', ['condition:hp<=50%', 'priority:attackFirst'])] }),
      distance: 1
    });
    assert.equal(f.vantage, true);
    assert.deepEqual(f.order.map(e => `${e.side}:${e.label}`), ['defender:Vantage', 'attacker:Attack']);
  },

  'Desperation moves the follow-up ahead of the counter': () => {
    const f = buildForecast({
      attacker: profile({ spd: 9, hp: 30, currentHP: 10, skillList: [skill('Desperation', ['condition:hp<=50%', 'requires:initiator', 'priority:followupBeforeCounter'])] }),
      defender: profile({ spd: 4 }),
      distance: 1
    });
    assert.deepEqual(f.order.map(e => e.side), ['attacker', 'attacker', 'defender']);
  },

  'Quick Riposte grants a follow-up without the Speed lead': () => {
    const f = buildForecast({
      attacker: profile({ spd: 5 }),
      defender: profile({ spd: 5, skillList: [skill('Quick Riposte', ['condition:hp>=75%', 'requires:defender', 'effect:guaranteedFollowup'])] }),
      distance: 1
    });
    assert.equal(f.defenderFollowUp, true);
  },

  'Wary Fighter shuts off follow-ups for both sides': () => {
    const f = buildForecast({
      attacker: profile({ spd: 12 }),
      defender: profile({ spd: 4, skillList: [skill('Wary Fighter', ['condition:hp>=50%', 'deny:followup:both'])] }),
      distance: 1
    });
    assert.equal(f.attackerFollowUp, false);
  },

  'Hardy Bearing cancels priority skills on both sides': () => {
    const f = buildForecast({
      attacker: profile({ skillList: [skill('Hardy Bearing', ['disable:prioritySkills', 'disable:frequencySkills'])] }),
      defender: profile({ hp: 30, currentHP: 10, skillList: [skill('Vantage', ['condition:hp<=50%', 'priority:attackFirst'])] }),
      distance: 1
    });
    assert.equal(f.vantage, false);
    assert.deepEqual(f.order[0].side, 'attacker');
  },

  'Cancel Affinity switches the weapon triangle off': () => {
    const f = buildForecast({
      attacker: profile({ group: 'sword', hit: 2, skillList: [skill('Cancel Affinity', ['override:weaponTriangle'])] }),
      defender: profile({ group: 'axe' }),
      distance: 1
    });
    assert.equal(f.attacker.triangle, 'neutral');
    assert.equal(f.attacker.hit, 2);
  },

  'Triangle Adept turns WTA into full Advantage': () => {
    const adept = skill('Triangle Adept', ['amplify:weaponTriangle']);
    const plain = buildForecast({
      attacker: profile({ group: 'sword', hit: 0 }),
      defender: profile({ group: 'axe', avoid: 5 }),
      distance: 1
    });
    assert.equal(plain.attacker.mode, 'normal');

    const withAdept = buildForecast({
      attacker: profile({ group: 'sword', hit: 0, skillList: [adept] }),
      defender: profile({ group: 'axe', avoid: 5 }),
      distance: 1
    });
    assert.equal(withAdept.attacker.triangle, 'advantage');
    assert.equal(withAdept.attacker.mode, 'advantage');

    // WTD becomes outright Disadvantage for the Adept user.
    const disadvantaged = buildForecast({
      attacker: profile({ group: 'axe', hit: 2, skillList: [adept] }),
      defender: profile({ group: 'sword', avoid: 5 }),
      distance: 1
    });
    assert.equal(disadvantaged.attacker.triangle, 'disadvantage');
    assert.equal(disadvantaged.attacker.mode, 'disadvantage');
  },

  'Fortune negates the critical multiplier': () => {
    const f = buildForecast({
      attacker: profile({ hit: 2, tags: ['mod:enemyCritAvoid:-5'] }),
      defender: profile({ critAvoid: 20, skillList: [skill('Fortune', ['immune:critMultiplier'])] }),
      distance: 1
    });
    const result = resolveCombat(f, { attacker: { hp: 30, maxHp: 30 }, defender: { hp: 99, maxHp: 99 } }, fixedRolls([20, 1]));
    assert.equal(result.log[0].crit, true);
    assert.equal(result.log[0].damage, f.attacker.damage);
  },

  'Shield skills deny effective damage': () => {
    const base = { group: 'axe', atk: 10, might: 6, tags: ['effective:scaled'] };
    const unprotected = buildForecast({
      attacker: profile(base),
      defender: profile({ group: 'bow', def: 5, traits: ['Scaled'] }),
      distance: 1
    });
    const shielded = buildForecast({
      attacker: profile(base),
      defender: profile({ group: 'bow', def: 5, traits: ['Scaled'], skillList: [skill('Svalinn Shield', ['immune:effective:scalerending'])] }),
      distance: 1
    });
    assert.equal(unprotected.attacker.effective, true);
    assert.equal(shielded.attacker.effective, false);
    assert.equal(shielded.attacker.damage, 11);
  },

  'Stances reduce only the matching damage type': () => {
    const steady = skill('Steady Stance', ['condition:hp>=50%', 'requires:defender', 'mod:physicalDamageTaken:-3', 'min:1']);
    const vsPhysical = buildForecast({
      attacker: profile({ group: 'sword', damageType: 'physical', atk: 10, might: 6 }),
      defender: profile({ group: 'bow', def: 0, res: 0, skillList: [steady] }),
      distance: 1
    });
    const vsMagical = buildForecast({
      attacker: profile({ group: 'anima', damageType: 'magical', atk: 10, might: 6 }),
      defender: profile({ group: 'bow', def: 0, res: 0, skillList: [steady] }),
      distance: 1
    });
    assert.equal(vsPhysical.attacker.damage, 13);
    assert.equal(vsMagical.attacker.damage, 16);
  },

  'Natural Cover needs terrain and floors damage at 1': () => {
    const cover = skill('Natural Cover', ['condition:terrainEffectActive', 'mod:damageTaken:-3', 'min:1']);
    const inForest = buildForecast({
      attacker: profile({ atk: 10, might: 6 }),
      defender: profile({ group: 'bow', def: 0, terrain: { avoid: 2, def: 1 }, skillList: [cover] }),
      distance: 1
    });
    const onPlains = buildForecast({
      attacker: profile({ atk: 10, might: 6 }),
      defender: profile({ group: 'bow', def: 0, terrain: {}, skillList: [cover] }),
      distance: 1
    });
    assert.equal(inForest.attacker.damage, 13);
    assert.equal(onPlains.attacker.damage, 16);
  },

  'Blessed Strike targets the softer of Def and Res': () => {
    const f = buildForecast({
      attacker: profile({ group: 'shiftingStone', atk: 10, might: 6, skillList: [skill('Blessed Strike', ['damage:useLower:def|res'])] }),
      defender: profile({ group: 'bow', def: 12, res: 2 }),
      distance: 1
    });
    assert.equal(f.attacker.mitigationStat, 'res');
    assert.equal(f.attacker.damage, 14);
  },

  'Distant Counter answers from any range': () => {
    const f = buildForecast({
      attacker: profile({ group: 'bow', range: { min: 2, max: 2 } }),
      defender: profile({ group: 'sword', range: { min: 1, max: 1 }, skillList: [skill('Distant Counter', ['enable:counterAtAnyRange'])] }),
      distance: 2
    });
    assert.equal(f.defender.canAct, true);
  },

  'Distant Shot extends the equipped range': () => {
    const f = buildForecast({
      attacker: profile({ group: 'shiftingStone', range: { min: 1, max: 1 }, skillList: [skill('Distant Shot', ['grant:maxRange:+1'])] }),
      defender: profile(),
      distance: 2
    });
    assert.equal(f.attacker.range.max, 2);
    assert.equal(f.attacker.canAct, true);
  },

  'Guard denies the foe their Charge': () => {
    const f = buildForecast({
      attacker: profile(),
      defender: profile({ skillList: [skill('Guard', ['effect:denyChargeToFoe'])] }),
      distance: 1
    });
    const result = resolveCombat(f, { attacker: { hp: 30, maxHp: 30 }, defender: { hp: 30, maxHp: 30 } }, fixedRolls([1, 1]));
    assert.equal(result.chargeGained.attacker, 0);
    assert.equal(result.chargeGained.defender, 1);
  },

  'Flashing Blade grants an extra Charge when faster': () => {
    const flashing = skill('Flashing Blade', ['condition:spd>foeSpd', 'requires:initiator', 'effect:bonusCharge:+1']);
    const f = buildForecast({
      attacker: profile({ spd: 8, skillList: [flashing] }),
      defender: profile({ spd: 5 }),
      distance: 1
    });
    const result = resolveCombat(f, { attacker: { hp: 30, maxHp: 30 }, defender: { hp: 30, maxHp: 30 } }, fixedRolls([1, 1]));
    assert.equal(result.chargeGained.attacker, 2);
  },

  'Poison Body reverses enemy lifesteal': () => {
    const f = buildForecast({
      attacker: profile({ atk: 10, might: 6, group: 'light', damageType: 'magical', tags: ['lifesteal:50'] }),
      defender: profile({ group: 'bow', def: 0, res: 0, skillList: [skill('Poison Body', ['override:enemyLifesteal:reverse'])] }),
      distance: 1
    });
    const result = resolveCombat(f, { attacker: { hp: 20, maxHp: 30 }, defender: { hp: 60, maxHp: 60 } }, fixedRolls([20, 1]));
    assert.equal(result.hp.attacker, 20 - Math.trunc(result.log[0].damage / 2));
  },

  'Combat Arts never apply passively': () => {
    const f = buildForecast({
      attacker: profile({ skillList: [skill('Luna', ['combatArt', 'effect:foeDefOrRes:-0.5'], { requiredCharge: 3 })] }),
      defender: profile(),
      distance: 1
    });
    assert.deepEqual(f.attacker.activeSkills, []);
  },

  'Unknown conditions never fire a skill by accident': () => {
    const f = buildForecast({
      attacker: profile({ skillList: [skill('Mystery', ['condition:somethingUnmodelled', 'grant:hit:+99'])] }),
      defender: profile(),
      distance: 1
    });
    assert.deepEqual(f.attacker.activeSkills, []);
    assert.equal(f.attacker.hit, 2);
  },

  /* ---------------------------------------------------------------- */
  /*  Attack roll plumbing                                             */
  /* ---------------------------------------------------------------- */

  'The dice pool matches what the exchange consumes': () => {
    // Normal accuracy spends one die per strike.
    const even = buildForecast({ attacker: profile({ hit: 2 }), defender: profile({ avoid: 5 }), distance: 1 });
    assert.equal(even.attacker.mode, 'normal');
    assert.equal(diceNeeded(even), even.order.length);

    // Advantage and disadvantage spend two.
    const lopsided = buildForecast({ attacker: profile({ hit: 20 }), defender: profile({ avoid: 2 }), distance: 1 });
    assert.equal(lopsided.attacker.mode, 'advantage');
    const expected = lopsided.order.reduce(
      (n, e) => n + (lopsided[e.side].mode === 'normal' ? 1 : 2), 0);
    assert.equal(diceNeeded(lopsided), expected);
    assert.ok(diceNeeded(lopsided) > lopsided.order.length);
  },

  'Every strike in the order consumes a roll and is logged': () => {
    const f = buildForecast({
      attacker: profile({ spd: 9, atk: 3, might: 1 }),
      defender: profile({ spd: 4, def: 50, hp: 999 }),
      distance: 1
    });
    let used = 0;
    const counting = () => { used++; return 10; };
    const result = resolveCombat(f, { attacker: { hp: 999, maxHp: 999 }, defender: { hp: 999, maxHp: 999 } }, counting);

    assert.equal(result.log.length, f.order.length);
    assert.equal(used, diceNeeded(f));
    result.log.forEach((entry, i) => {
      assert.equal(entry.side, f.order[i].side);
      assert.equal(entry.dice.length, f[entry.side].mode === 'normal' ? 1 : 2);
      assert.equal(entry.total, entry.roll + f[entry.side].hit);
    });
  },

  'A real randomised exchange stays within legal bounds': () => {
    for (let seed = 0; seed < 200; seed++) {
      const f = buildForecast({
        attacker: profile({ atk: 12, spd: 9, might: 6, hp: 40 }),
        defender: profile({ group: 'axe', atk: 9, spd: 4, def: 4, hp: 40 }),
        distance: 1
      });
      const result = resolveCombat(f, { attacker: { hp: 40, maxHp: 40 }, defender: { hp: 40, maxHp: 40 } });

      for (const side of ['attacker', 'defender']) {
        assert.ok(result.hp[side] >= 0, 'HP never goes negative');
        assert.ok(result.hp[side] <= 40, 'HP never exceeds the maximum');
      }
      for (const entry of result.log) {
        assert.ok(entry.roll >= 1 && entry.roll <= 20, `d20 in range, got ${entry.roll}`);
        assert.ok(entry.damage >= 0);
        if (entry.hit) assert.ok(entry.damage >= 1, 'a hit always deals at least 1');
        else assert.equal(entry.damage, 0, 'a miss deals nothing');
        if (entry.crit) assert.ok(entry.hit, 'a crit is always a hit');
      }
      // Combat stops the moment someone falls.
      const fallIndex = result.log.findIndex(e => e.targetHp === 0);
      if (fallIndex !== -1) assert.equal(fallIndex, result.log.length - 1);
    }
  },

  'Running out of pooled dice falls back rather than crashing': () => {
    const f = buildForecast({ attacker: profile({ spd: 9 }), defender: profile({ spd: 4 }), distance: 1 });
    const stingy = [15];
    let i = 0;
    const result = resolveCombat(f, { attacker: { hp: 30, maxHp: 30 }, defender: { hp: 30, maxHp: 30 } },
      () => stingy[i++] ?? Math.ceil(Math.random() * 20));
    assert.equal(result.log.length, f.order.length);
    result.log.forEach(entry => assert.ok(entry.roll >= 1 && entry.roll <= 20));
  }
};

let failed = 0;
for (const [name, run] of Object.entries(tests)) {
  try {
    run();
    console.log(`  ok  ${name}`);
  } catch (error) {
    failed++;
    console.error(`  FAIL ${name}\n       ${error.message}`);
  }
}

console.log(`\n${Object.keys(tests).length - failed}/${Object.keys(tests).length} combat checks passed.`);
process.exit(failed ? 1 : 0);
