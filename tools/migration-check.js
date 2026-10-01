/**
 * Migration checks for the V14 DataModel schema change.
 * Run with: npm run test:migration
 *
 * These guard the three promises the migration makes: source data survives,
 * calculated data is discarded rather than carried over, and re-running the
 * migration on an already-migrated document is a no-op.
 */

import assert from 'node:assert/strict';

const { migrateUnit, migrateItem, migrateStatus, SCHEMA_VERSION } = await import('../modules/migration.ts');

/** A unit exactly as a pre-migration world stored it. */
const legacyUnit = () => ({
  level: 7,
  race: 'Human',
  money: 1250,
  size: 'medium',
  status: 'injured',
  terrain: 'forest',
  trait: 'Noble',
  movementType: 'cavalry',
  weaponProficiency: 'lance',
  currentHP: 21,
  combatStats: { hp: 31, atk: 12, spd: 11, dex: 10, def: 9, res: 6, luck: 8 },
  tempStats: { hp: 0, atk: 2, spd: 0, dex: 0, def: 0, res: 0, luck: 0 },
  bonusStats: { hp: 0, atk: 0, spd: 1, dex: 0, def: 0, res: 0, luck: 0 },
  bonuses: { power: 1, tri: 2, hit: 3, avoid: 4 },
  nonCombatStats: { strength: 2, intellect: 1, perception: 1, charisma: 2, fate: 1, finesse: 2, acrobatics: 2 },
  derivedStats: { hit: 99, avoid: 99, crit: 5, power: 99, tri: 99, size: 99, con: 99, aid: 99, move: 99, charge: 2, gauge: 1 },
  personalSkill: 'something',
  skills: ['s1', 's2'],
  inventory: { weapons: ['w1'], items: ['i1'], equipped: 'w1' },
  supports: { a1: 'B' }
});

const tests = {
  'Unit source data survives the move': () => {
    const result = migrateUnit(legacyUnit());
    assert.equal(result.level, 7);
    assert.equal(result.money, 1250);
    assert.equal(result.trait, 'Noble');
    assert.equal(result.movementType, 'cavalry');
    assert.deepEqual(result.stats, { hp: 31, atk: 12, spd: 11, dex: 10, def: 9, res: 6, luck: 8 });
    assert.deepEqual(result.temp, { hp: 0, atk: 2, spd: 0, dex: 0, def: 0, res: 0, luck: 0 });
    assert.deepEqual(result.bonuses, { hp: 0, atk: 0, spd: 1, dex: 0, def: 0, res: 0, luck: 0 });
    assert.deepEqual(result.skills, ['s1', 's2']);
    assert.deepEqual(result.inventory, { weapons: ['w1'], items: ['i1'], equipped: 'w1' });
    assert.deepEqual(result.supports, { a1: 'B' });
  },

  'Current HP becomes a resource rather than a loose field': () => {
    assert.equal(migrateUnit(legacyUnit()).resources.hp.value, 21);
  },

  'Flat combat bonuses become modifiers, carrying Crit across': () => {
    const result = migrateUnit(legacyUnit());
    assert.deepEqual(result.modifiers, { power: 1, tri: 2, hit: 3, avoid: 4, crit: 5 });
  },

  'Charge and Gauge are kept as source values, Gauge clamped to 0-4': () => {
    assert.equal(migrateUnit(legacyUnit()).charge, 2);
    assert.equal(migrateUnit(legacyUnit()).gauge, 1);

    const overflow = legacyUnit();
    overflow.derivedStats.gauge = 9;
    assert.equal(migrateUnit(overflow).gauge, 4);
  },

  'Calculated values are discarded, not carried over': () => {
    const result = migrateUnit(legacyUnit());
    // The legacy derived block held deliberately absurd figures; none may survive.
    // `size` is excluded: the unit's size category is a source value that merely
    // shares a name with the derived combat Size.
    for (const key of ['hit', 'avoid', 'power', 'tri', 'con', 'aid', 'move']) {
      assert.equal(result[key], undefined, `derived ${key} leaked into the new schema`);
    }
    assert.equal(result.size, 'medium');
    // Derived non-combat stats are recomputed from Luck, Dex and Spd.
    assert.deepEqual(result.nonCombat, { strength: 2, intellect: 1, perception: 1, charisma: 2 });
  },

  'Legacy keys are explicitly deleted so Foundry does not keep them': () => {
    const result = migrateUnit(legacyUnit());
    for (const key of ['combatStats', 'bonusStats', 'tempStats', 'nonCombatStats', 'derivedStats', 'currentHP', 'personalSkill']) {
      assert.equal(result[`-=${key}`], null, `${key} is never removed`);
    }
  },

  'A missing legacy unit field falls back to a sane default': () => {
    const result = migrateUnit({});
    assert.equal(result.level, 1);
    assert.equal(result.movementType, 'infantry');
    assert.equal(result.status, 'healthy');
    assert.deepEqual(result.stats, { hp: 15, atk: 3, spd: 3, dex: 3, def: 3, res: 3, luck: 3 });
    assert.equal(result.resources.hp.value, 15);
  },

  'Already-migrated units are left alone': () => {
    assert.equal(migrateUnit({ stats: { hp: 20 } }), null);
    assert.equal(migrateUnit(null), null);
  },

  'A legacy status string becomes a status Active Effect': () => {
    const effect = migrateStatus(legacyUnit());
    assert.equal(effect.name, 'Injured');
    assert.deepEqual(effect.statuses, ['injured']);
    assert.equal(effect.flags['heroes-of-lite'].status.key, 'injured');
    assert.equal(effect.flags['heroes-of-lite'].status.unhealable, true);
  },

  'A migrated status has no phase owner, since the inflicter was never recorded': () => {
    // Without an owner it will not count down on its own, which is safer than
    // guessing a side and silently expiring it early.
    assert.equal(migrateStatus(legacyUnit()).flags['heroes-of-lite'].status.phaseOwner, null);
  },

  'Healthy and unknown statuses produce no effect': () => {
    assert.equal(migrateStatus({ status: 'healthy' }), null);
    assert.equal(migrateStatus({ status: '' }), null);
    assert.equal(migrateStatus({ status: 'cursed' }), null);
    assert.equal(migrateStatus({}), null);
  },

  'The migrated unit no longer carries the status string': () => {
    assert.equal(migrateUnit(legacyUnit()).status, 'healthy');
  },

  'Weapons flatten out of attributes and details': () => {
    const result = migrateItem('weapon', {
      attributes: { weaponGroup: 'lance', damageType: 'physical' },
      details: {
        might: 11, costG: 3200, range: { min: 1, max: 2 },
        innateAttributes: ['refine.killer'],
        refines: [{ id: 'refine.steel', name: 'Steel' }, { id: '', name: '' }]
      }
    });
    assert.equal(result.weaponGroup, 'lance');
    assert.equal(result.damageType, 'physical');
    assert.equal(result.might, 11);
    assert.equal(result.costG, 3200);
    assert.deepEqual(result.range, { min: 1, max: 2 });
    assert.deepEqual(result.innateAttributes, ['refine.killer']);
    assert.deepEqual(result.refines, [{ id: 'refine.steel', name: 'Steel' }, { id: '', name: '' }]);
    assert.equal(result['-=attributes'], null);
    assert.equal(result['-=details'], null);
  },

  'A weapon with a malformed refine list gets two empty slots back': () => {
    const result = migrateItem('weapon', { attributes: {}, details: { refines: [{ id: 'refine.steel' }] } });
    assert.deepEqual(result.refines, [{ id: '', name: '' }, { id: '', name: '' }]);
  },

  'Skills flatten and their required Charge becomes a number': () => {
    const result = migrateItem('skill', {
      attributes: { type: 'technique' },
      details: { typeGroup: 'combat', requiredCharge: '2', prerequisite: 'level:10, weapon:sword', effect: 'Luna', tags: ['combatArt'] }
    });
    assert.equal(result.type, 'technique');
    assert.equal(result.typeGroup, 'combat');
    assert.strictEqual(result.requiredCharge, 2);
    assert.deepEqual(result.prerequisite, ['level:10', 'weapon:sword']);
    assert.deepEqual(result.tags, ['combatArt']);
  },

  'A skill prerequisite already stored as an array is left as-is': () => {
    const result = migrateItem('skill', { attributes: {}, details: { prerequisite: ['level:5'] } });
    assert.deepEqual(result.prerequisite, ['level:5']);
  },

  'Already-migrated items are left alone': () => {
    assert.equal(migrateItem('weapon', { weaponGroup: 'sword' }), null);
    assert.equal(migrateItem('skill', { typeGroup: 'combat' }), null);
    assert.equal(migrateItem('weapon', null), null);
  },

  'The schema version is set so the migration runs once': () => {
    assert.ok(Number.isInteger(SCHEMA_VERSION) && SCHEMA_VERSION >= 2);
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

console.log(`\n${passed}/${Object.keys(tests).length} migration checks passed.`);
if (failures.length) {
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
