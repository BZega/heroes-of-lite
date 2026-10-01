/**
 * Status effect and buff checks.
 * Run with: npm run test:effects
 *
 * These cover the rules that the old single-string status field could not
 * express: several statuses at once, per-inflicter countdown, and the
 * no-refresh rule.
 */

import assert from 'node:assert/strict';

const {
  STATUS_DEFS, DEFAULT_STATUS_TURNS,
  statusEffectData, statusFlags, activeStatusKeys, tickStatusEffects, isStatusKey,
  applyStatus, removeStatus, cureStatuses, clearStatusesOnKO
} = await import('../modules/effects/statuses.ts');

const { aggregateStatuses } = await import('../modules/rules.ts');

const {
  bonusChanges, tonicEffectData, refineEffectData,
  supportBonusFrom, supportEffectData, SUPPORT_BONUSES, MODE_ADD
} = await import('../modules/effects/buffs.ts');

const SYSTEM_ID = 'heroes-of-lite';

/** A stand-in for an actor carrying the given status effects. */
const actorWith = (...effects) => ({ system: {}, effects });

const effect = (key, overrides = {}) => {
  const data = statusEffectData(key, overrides);
  return { id: `eff-${key}`, disabled: false, ...data };
};

/** Enough of an Actor to exercise the embedded-document calls. */
class FakeActor {
  constructor(system = {}) {
    this.id = 'actor-1';
    this.name = 'Test Unit';
    this.system = system;
    this.effects = [];
    this.nextId = 0;
  }

  async createEmbeddedDocuments(type, data) {
    const created = data.map(entry => ({ id: `fx-${this.nextId++}`, disabled: false, ...entry }));
    this.effects.push(...created);
    return created;
  }

  async deleteEmbeddedDocuments(type, ids) {
    this.effects = this.effects.filter(entry => !ids.includes(entry.id));
  }

  async updateEmbeddedDocuments(type, updates) {
    for (const update of updates) {
      const target = this.effects.find(entry => entry.id === update._id);
      if (!target) continue;
      const remaining = update[`flags.${SYSTEM_ID}.status.remaining`];
      if (remaining !== undefined) target.flags[SYSTEM_ID].status.remaining = remaining;
    }
  }
}

/**
 * Two units that know about each other, registered in a stubbed `game.actors`.
 * `aPick`/`bPick` are who each one nominates as their active support.
 */
function supportPair({ aPick, bPick, ranks = { a: { b: 'B' }, b: { a: 'B' } } }) {
  const a = { id: 'a', name: 'A', type: 'unit', system: { movementType: 'armor', activeSupport: aPick, supports: ranks.a ?? {} } };
  const b = { id: 'b', name: 'B', type: 'unit', system: { movementType: 'cavalry', activeSupport: bPick, supports: ranks.b ?? {} } };
  const c = { id: 'c', name: 'C', type: 'unit', system: { movementType: 'flier', activeSupport: '', supports: {} } };

  const byId = new Map([['a', a], ['b', b], ['c', c]]);
  globalThis.game = { actors: { get: id => byId.get(id) ?? null } };
  return { a, b, c };
}

const { activeSupportFor } = await import('../modules/automation/supports.ts');

const tests = {
  /* ---------- definitions ---------- */

  'Every status in the table is a known key': () => {
    for (const key of Object.keys(STATUS_DEFS)) assert.ok(isStatusKey(key), key);
    assert.equal(isStatusKey('healthy'), false, 'healthy is the absence of a status, not one');
  },

  'Statuses last three turns by default': () => {
    assert.equal(DEFAULT_STATUS_TURNS, 3);
    assert.equal(statusEffectData('poisoned').flags[SYSTEM_ID].status.remaining, 3);
  },

  /* ---------- multiple statuses ---------- */

  'A unit can carry several statuses at once': () => {
    const actor = actorWith(effect('poisoned'), effect('broken'));
    assert.deepEqual([...activeStatusKeys(actor)].sort(), ['broken', 'poisoned']);
  },

  'Penalties from several statuses combine': () => {
    const status = aggregateStatuses(new Set(['poisoned', 'broken', 'injured']));
    assert.equal(status.hpStart, -4);
    assert.equal(status.blocksCounter, true);
    assert.equal(status.combatPenalty, -3);
    assert.equal(status.unhealable, true);
  },

  'An unafflicted unit reads as Healthy with no penalties': () => {
    const status = aggregateStatuses(new Set());
    assert.equal(status.label, 'Healthy');
    assert.equal(status.hpStart, 0);
    assert.equal(status.combatPenalty, 0);
    assert.equal(status.blocksCounter, false);
    assert.equal(status.blocksMove, false);
  },

  'Unknown status keys are ignored rather than throwing': () => {
    const status = aggregateStatuses(new Set(['poisoned', 'cursed']));
    assert.deepEqual(status.keys, ['poisoned']);
  },

  'Disabled status effects do not afflict the unit': () => {
    const disabled = { ...effect('shocked'), disabled: true };
    assert.equal(activeStatusKeys(actorWith(disabled)).size, 0);
  },

  'A pre-migration actor still reads its legacy status string': () => {
    const legacy = { system: { status: 'silenced' }, effects: [] };
    assert.deepEqual([...activeStatusKeys(legacy)], ['silenced']);
    assert.equal(activeStatusKeys({ system: { status: 'healthy' }, effects: [] }).size, 0);
  },

  /* ---------- countdown ---------- */

  'Statuses only tick on the phase of whoever inflicted them': () => {
    const fromEnemy = effect('poisoned', { phaseOwner: -1 });
    const fromAlly = effect('broken', { phaseOwner: 1 });

    const enemyPhase = tickStatusEffects([fromEnemy, fromAlly], -1);
    assert.equal(enemyPhase.ticked.length, 1);
    assert.equal(enemyPhase.ticked[0].key, 'poisoned');
    assert.equal(enemyPhase.ticked[0].remaining, 2);

    const playerPhase = tickStatusEffects([fromEnemy, fromAlly], 1);
    assert.equal(playerPhase.ticked.length, 1);
    assert.equal(playerPhase.ticked[0].key, 'broken');
  },

  'A status wears off after three of its owner phases': () => {
    let remaining = DEFAULT_STATUS_TURNS;
    let expired = [];

    for (let phase = 0; phase < 3; phase += 1) {
      const current = effect('poisoned', { phaseOwner: -1, turns: remaining });
      const result = tickStatusEffects([current], -1);
      expired = result.expired;
      remaining = result.ticked[0]?.remaining ?? 0;
    }

    assert.equal(remaining, 0);
    assert.equal(expired.length, 1);
    assert.equal(expired[0].label, 'Poisoned');
  },

  'A status with no recorded owner never ticks on its own': () => {
    const orphan = effect('silenced', { phaseOwner: null });
    for (const phase of [-1, 0, 1]) {
      const result = tickStatusEffects([orphan], phase);
      assert.equal(result.ticked.length, 0, `phase ${phase}`);
      assert.equal(result.expired.length, 0, `phase ${phase}`);
    }
  },

  'A shortened status expires in a single phase': () => {
    const quick = effect('poisoned', { phaseOwner: -1, turns: 1 });
    const result = tickStatusEffects([quick], -1);
    assert.equal(result.expired.length, 1);
    assert.equal(result.ticked.length, 0);
  },

  /* ---------- provenance ---------- */

  'A status records who inflicted it': () => {
    const data = statusEffectData('berserk', { sourceActorId: 'abc', sourceName: 'Boss', phaseOwner: -1 });
    const status = statusFlags(data);
    assert.equal(status.sourceActorId, 'abc');
    assert.equal(status.sourceName, 'Boss');
    assert.equal(status.phaseOwner, -1);
  },

  'Only Injured is flagged unhealable': () => {
    for (const key of Object.keys(STATUS_DEFS)) {
      assert.equal(statusFlags(statusEffectData(key)).unhealable, key === 'injured', key);
    }
  },

  'Non-status effects are not mistaken for statuses': () => {
    assert.equal(statusFlags({ flags: {} }), null);
    assert.equal(statusFlags({ flags: { [SYSTEM_ID]: { status: { key: 'nonsense' } } } }), null);
    assert.equal(statusEffectData('nonsense'), null);
  },

  /* ---------- applying and curing ---------- */

  'A status already active cannot be re-applied to extend it': async () => {
    const actor = new FakeActor();
    assert.equal(await applyStatus(actor, 'silenced', { phaseOwner: -1 }), true);

    // Tick it down first, so a successful re-apply would visibly refresh it.
    actor.effects[0].flags[SYSTEM_ID].status.remaining = 1;
    assert.equal(await applyStatus(actor, 'silenced', { phaseOwner: -1 }), false);

    assert.equal(actor.effects.length, 1);
    assert.equal(actor.effects[0].flags[SYSTEM_ID].status.remaining, 1);
  },

  'Different statuses can be stacked onto the same unit': async () => {
    const actor = new FakeActor();
    await applyStatus(actor, 'poisoned', { phaseOwner: -1 });
    await applyStatus(actor, 'broken', { phaseOwner: -1 });
    assert.deepEqual([...activeStatusKeys(actor)].sort(), ['broken', 'poisoned']);
  },

  'Fortified Heart makes a unit immune to status effects': async () => {
    const actor = new FakeActor();
    const profile = { skillTags: new Set(['immune:statusEffects']) };
    assert.equal(await applyStatus(actor, 'poisoned', { profile }), false);
    assert.equal(actor.effects.length, 0);
  },

  'Steady Heart shortens incoming statuses': async () => {
    const actor = new FakeActor();
    const profile = { skillTags: new Set(['mod:statusDuration:1']) };
    await applyStatus(actor, 'poisoned', { phaseOwner: -1, profile });
    assert.equal(statusFlags(actor.effects[0]).remaining, 1);
  },

  'A duration modifier only ever shortens, never extends': async () => {
    const actor = new FakeActor();
    const profile = { skillTags: new Set(['mod:statusDuration:5']) };
    await applyStatus(actor, 'poisoned', { phaseOwner: -1, profile });
    assert.equal(statusFlags(actor.effects[0]).remaining, DEFAULT_STATUS_TURNS);
  },

  'Curing spares Injured, which no item or skill can heal': async () => {
    const actor = new FakeActor();
    await applyStatus(actor, 'poisoned', { phaseOwner: -1 });
    await applyStatus(actor, 'injured', { phaseOwner: -1 });

    const cured = await cureStatuses(actor);
    assert.deepEqual(cured, ['Poisoned']);
    assert.deepEqual([...activeStatusKeys(actor)], ['injured']);
  },

  'Being reduced to 0 HP sheds every status, Injured included': async () => {
    const actor = new FakeActor();
    await applyStatus(actor, 'poisoned', { phaseOwner: -1 });
    await applyStatus(actor, 'injured', { phaseOwner: -1 });

    const shed = await clearStatusesOnKO(actor);
    assert.equal(shed.length, 2);
    assert.equal(activeStatusKeys(actor).size, 0);
  },

  'Curing a named status leaves the others alone': async () => {
    const actor = new FakeActor();
    await applyStatus(actor, 'poisoned', { phaseOwner: -1 });
    await applyStatus(actor, 'silenced', { phaseOwner: -1 });

    await cureStatuses(actor, { keys: ['poisoned'] });
    assert.deepEqual([...activeStatusKeys(actor)], ['silenced']);
  },

  'Removing a status that is not present is a no-op': async () => {
    const actor = new FakeActor();
    assert.equal(await removeStatus(actor, 'poisoned'), false);
  },

  'An unknown status key is never applied': async () => {
    const actor = new FakeActor();
    assert.equal(await applyStatus(actor, 'cursed'), false);
    assert.equal(actor.effects.length, 0);
  },

  /* ---------- buffs ---------- */

  'Stat and modifier bonuses are routed to different blocks': () => {
    const changes = bonusChanges({ atk: 2, hit: 1 });
    assert.deepEqual(changes, [
      { key: 'system.bonuses.atk', mode: MODE_ADD, value: 2 },
      { key: 'system.modifiers.hit', mode: MODE_ADD, value: 1 }
    ]);
  },

  'Zero and unknown bonuses produce no changes': () => {
    assert.deepEqual(bonusChanges({ atk: 0, nonsense: 4, spd: null }), []);
  },

  'A tonic adds to the temporary block so it can be cleared at map end': () => {
    const data = tonicEffectData({
      name: 'Attack Tonic', img: '', system: { temporaryStatBonuses: { atk: 2 } }, flags: {}
    });
    assert.deepEqual(data.changes, [{ key: 'system.temp.atk', mode: MODE_ADD, value: 2 }]);
  },

  'Two different tonics are separate effects, so they stack': () => {
    const atk = tonicEffectData({ name: 'Attack Tonic', img: '', system: { temporaryStatBonuses: { atk: 2 } }, flags: {} });
    const spd = tonicEffectData({ name: 'Speed Tonic', img: '', system: { temporaryStatBonuses: { spd: 2 } }, flags: {} });
    assert.notEqual(atk.flags[SYSTEM_ID].buff.key, spd.flags[SYSTEM_ID].buff.key);
  },

  'A consumable with no stat bonuses makes no tonic effect': () => {
    assert.equal(tonicEffectData({ name: 'Herb', system: { temporaryStatBonuses: {} }, flags: {} }), null);
  },

  'Enchanted refines grant their bonus to the wielder': () => {
    const data = refineEffectData(
      { id: 'w1', name: 'Iron Sword', img: '' },
      [{ statBonuses: { atk: 2 } }, { statBonuses: { might: 3 } }]
    );
    // `might` belongs to the weapon and is baked in on attach, so it is not a wielder bonus.
    assert.deepEqual(data.changes, [{ key: 'system.bonuses.atk', mode: MODE_ADD, value: 2 }]);
  },

  'Refines with only weapon-level bonuses make no wielder effect': () => {
    assert.equal(refineEffectData({ id: 'w1', name: 'Steel Sword' }, [{ statBonuses: { might: 3, maxRange: 1 } }]), null);
  },

  /* ---------- supports ---------- */

  'Support bonuses come from the partner movement type and rank': () => {
    assert.deepEqual(supportBonusFrom({ system: { movementType: 'cavalry' } }, 'C'), { atk: 1 });
    assert.deepEqual(supportBonusFrom({ system: { movementType: 'armor' } }, 'B'), { def: 1, res: 1 });
    assert.deepEqual(supportBonusFrom({ system: { movementType: 'flier' } }, 'S'), { spd: 3, avoid: 1 });
  },

  'An Infantry partner gives the line they chose at character creation': () => {
    const infantry = { system: { movementType: 'infantry', supportLine: 'flier' } };
    assert.deepEqual(supportBonusFrom(infantry, 'A'), { spd: 2, avoid: 1 });
    assert.equal(supportBonusFrom({ system: { movementType: 'infantry' } }, 'A'), null);
  },

  'The worked example from the rules holds': () => {
    // An Armor and a Cavalry at B support: Armor gains Attack+2, Cavalry gains Defense+1 and Resistance+1.
    const armor = { system: { movementType: 'armor' } };
    const cavalry = { system: { movementType: 'cavalry' } };
    assert.deepEqual(supportBonusFrom(cavalry, 'B'), { atk: 2 });
    assert.deepEqual(supportBonusFrom(armor, 'B'), { def: 1, res: 1 });
  },

  'Every support rank is defined for every providing movement type': () => {
    for (const [type, ranks] of Object.entries(SUPPORT_BONUSES)) {
      for (const rank of ['C', 'B', 'A', 'S']) {
        assert.ok(Object.keys(ranks[rank] ?? {}).length, `${type} ${rank}`);
      }
    }
  },

  'A support effect names its partner and rank': () => {
    const data = supportEffectData({ id: 'p1', name: 'Lyn', system: { movementType: 'cavalry' } }, 'A');
    assert.equal(data.name, 'Support: Lyn (A)');
    assert.equal(data.flags[SYSTEM_ID].buff.rank, 'A');
    assert.deepEqual(data.changes, [
      { key: 'system.bonuses.atk', mode: MODE_ADD, value: 2 },
      { key: 'system.modifiers.hit', mode: MODE_ADD, value: 1 }
    ]);
  },

  /* ---------- active support pairing ---------- */

  'An active support must be nominated by both sides': () => {
    const { a, b } = supportPair({ aPick: 'b', bPick: 'a' });
    assert.equal(activeSupportFor(a).partner.id, 'b');
    assert.equal(activeSupportFor(a).rank, 'B');
    assert.equal(activeSupportFor(b).partner.id, 'a');
  },

  'A one-sided nomination grants nothing': () => {
    const { a } = supportPair({ aPick: 'b', bPick: '' });
    assert.equal(activeSupportFor(a), null);
  },

  'Nominating someone who picked a third party grants nothing': () => {
    const { a } = supportPair({ aPick: 'b', bPick: 'c' });
    assert.equal(activeSupportFor(a), null);
  },

  'A nomination without a support rank grants nothing': () => {
    const { a } = supportPair({ aPick: 'b', bPick: 'a', ranks: {} });
    assert.equal(activeSupportFor(a), null);
  },

  'A unit cannot support itself': () => {
    const { a } = supportPair({ aPick: 'a', bPick: 'a' });
    assert.equal(activeSupportFor(a), null);
  },

  'No nomination means no active support': () => {
    const { a } = supportPair({ aPick: '', bPick: '' });
    assert.equal(activeSupportFor(a), null);
  }
};

let passed = 0;
const failures = [];
for (const [name, run] of Object.entries(tests)) {
  try {
    await run();
    console.log(`  ok  ${name}`);
    passed += 1;
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
    console.log(`  FAIL  ${name}`);
  }
}

console.log(`\n${passed}/${Object.keys(tests).length} effect checks passed.`);
if (failures.length) {
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
