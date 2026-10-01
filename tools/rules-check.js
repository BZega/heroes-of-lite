/**
 * Rules conformance checks for the actor sheet derivations.
 * Run with: npm run test:rules
 *
 * `_prepareContext` is called against a minimal stub document so the maths can be
 * verified without a running Foundry instance.
 */

import assert from 'node:assert/strict';

// Minimal globals the sheet module touches at import/definition time.
globalThis.foundry = {
  applications: {
    api: { HandlebarsApplicationMixin: Base => Base },
    sheets: { ActorSheetV2: class { async _prepareContext() { return {}; } } }
  },
  utils: { deepClone: value => structuredClone(value) }
};
globalThis.game = { actors: new Map(), user: { isGM: true } };

const { default: HolActorSheet } = await import('../modules/sheets/holActorSheet.ts');
const { statusEffectData } = await import('../modules/effects/statuses.ts');

/** Build a sheet bound to a stub actor with the given system data. */
function sheetFor(system, items = [], statuses = []) {
  const itemMap = new Map(items.map(item => [item.id, item]));
  const document = {
    name: 'Test Unit',
    img: '',
    type: 'unit',
    effects: statuses.map(key => ({ id: `fx-${key}`, disabled: false, ...statusEffectData(key) })),
    system: {
      level: 1,
      race: '',
      money: 0,
      size: 'medium',
      status: 'healthy',
      trait: '',
      movementType: 'infantry',
      weaponProficiency: '',
      terrain: '',
      resources: { hp: { value: 15 } },
      stats: { hp: 15, atk: 3, spd: 3, dex: 3, def: 3, res: 3, luck: 3 },
      temp: {}, bonuses: {}, modifiers: {},
      nonCombat: { strength: 0, intellect: 0, perception: 0, charisma: 0 },
      charge: 0,
      gauge: 0,
      skills: [],
      inventory: { weapons: [], items: [], equipped: '' },
      supports: {},
      ...system
    },
    items: { get: id => itemMap.get(id) }
  };
  const sheet = Object.create(HolActorSheet.prototype);
  Object.defineProperty(sheet, 'document', { value: document });
  return sheet;
}

const weapon = (id, might, weaponGroup = 'sword') => ({
  id, type: 'weapon', system: { might, weaponGroup }
});

const tests = {
  'Hit is floor(Dex / 4)': async () => {
    const ctx = await sheetFor({ stats: { hp: 15, atk: 3, spd: 3, dex: 6, def: 3, res: 3, luck: 3 } })._prepareContext({});
    assert.equal(ctx.derived.hit, 1);
  },

  'Avoid is floor(Luck / 4) + 4, Crit Avoid is Avoid + 15': async () => {
    const ctx = await sheetFor({ stats: { hp: 15, atk: 3, spd: 3, dex: 6, def: 3, res: 3, luck: 4 } })._prepareContext({});
    assert.equal(ctx.derived.avoid, 5);
    assert.equal(ctx.derived.critAvoid, 20);
  },

  'Power is Atk + Might and Tri is floor(Power / 5)': async () => {
    const ctx = await sheetFor(
      { stats: { hp: 15, atk: 7, spd: 3, dex: 3, def: 3, res: 3, luck: 3 }, inventory: { weapons: ['w'], items: [], equipped: 'w' } },
      [weapon('w', 6)]
    )._prepareContext({});
    assert.equal(ctx.derived.power, 13);
    assert.equal(ctx.derived.tri, 2);
  },

  'Non-combat pool is 6 points': async () => {
    const ctx = await sheetFor({ nonCombat: { strength: 2, intellect: 1, perception: 0, charisma: 0 } })._prepareContext({});
    assert.equal(ctx.unallocatedPoints, 3);
  },

  'Derived non-combat stats cap at 3': async () => {
    const ctx = await sheetFor({ stats: { hp: 15, atk: 3, spd: 20, dex: 5, def: 3, res: 3, luck: 16 } })._prepareContext({});
    assert.equal(ctx.nonCombat.acrobatics, 3);
    assert.equal(ctx.nonCombat.finesse, 1);
    assert.equal(ctx.nonCombat.fate, 3);
  },

  'Combat pool is 12 at level 1 and +3 per level': async () => {
    const level1 = await sheetFor({})._prepareContext({});
    assert.equal(level1.unallocatedCombatPoints, 12);
    const mercenary = await sheetFor({
      stats: { hp: 18, atk: 6, spd: 4, dex: 6, def: 5, res: 3, luck: 3 }
    })._prepareContext({});
    assert.equal(mercenary.unallocatedCombatPoints, 0);
    const level5 = await sheetFor({ level: 5 })._prepareContext({});
    assert.equal(level5.unallocatedCombatPoints, 24);
  },

  'Stat caps follow the level bands': async () => {
    assert.deepEqual((await sheetFor({ level: 1 })._prepareContext({})).statCaps, { hp: 20, stat: 8 });
    assert.deepEqual((await sheetFor({ level: 10 })._prepareContext({})).statCaps, { hp: 30, stat: 12 });
    assert.deepEqual((await sheetFor({ level: 15 })._prepareContext({})).statCaps, { hp: 35, stat: 16 });
    assert.deepEqual((await sheetFor({ level: 26 })._prepareContext({})).statCaps, { hp: 50, stat: 30 });
  },

  'Movement and Base Aid follow the movement type table': async () => {
    const expected = { infantry: [5, 2], cavalry: [7, 4], flier: [6, 4], armor: [4, 2] };
    for (const [movementType, [move, baseAid]] of Object.entries(expected)) {
      const ctx = await sheetFor({ movementType, nonCombat: { strength: 1 } })._prepareContext({});
      assert.equal(ctx.derived.move, move, movementType);
      assert.equal(ctx.derived.aid, baseAid + 1, movementType);
    }
  },

  'Armor units gain +2 Con': async () => {
    const ctx = await sheetFor({ movementType: 'armor', size: 'large' })._prepareContext({});
    assert.equal(ctx.derived.con, 5);
  },

  'Injured applies -3 to Atk, Spd, Def and Res only': async () => {
    const stats = { hp: 15, atk: 8, spd: 8, dex: 8, def: 8, res: 8, luck: 8 };
    const ctx = await sheetFor({ stats }, [], ['injured'])._prepareContext({});
    assert.deepEqual(ctx.combatStatTotals, { hp: 15, atk: 5, spd: 5, dex: 8, def: 5, res: 5, luck: 8 });
  },

  'Shocked zeroes Avoid and Move, and fixes Crit Avoid at 15': async () => {
    const stats = { hp: 15, atk: 3, spd: 3, dex: 3, def: 3, res: 3, luck: 16 };
    const ctx = await sheetFor({ stats }, [], ['shocked'])._prepareContext({});
    assert.equal(ctx.derived.avoid, 0);
    assert.equal(ctx.derived.critAvoid, 15);
    assert.equal(ctx.derived.move, 0);
  },

  'A unit can suffer several statuses at once': async () => {
    const stats = { hp: 15, atk: 8, spd: 8, dex: 8, def: 8, res: 8, luck: 16 };
    const ctx = await sheetFor({ stats }, [], ['injured', 'shocked', 'broken'])._prepareContext({});

    // Injured still takes its -3, Shocked still zeroes Avoid and Move,
    // and Broken still blocks the counter. None of them cancel the others.
    assert.deepEqual(ctx.combatStatTotals, { hp: 15, atk: 5, spd: 5, dex: 8, def: 5, res: 5, luck: 16 });
    assert.equal(ctx.derived.avoid, 0);
    assert.equal(ctx.derived.move, 0);
    assert.equal(ctx.profile.status.blocksCounter, true);
    assert.equal(ctx.profile.status.label, 'Broken, Shocked, Injured');
  },

  'Poison damage accumulates with nothing else at phase start': async () => {
    const poisoned = await sheetFor({}, [], ['poisoned'])._prepareContext({});
    assert.equal(poisoned.profile.status.hpStart, -4);
    const healthy = await sheetFor({})._prepareContext({});
    assert.equal(healthy.profile.status.hpStart, 0);
  },

  'Terrain grants Avoid and Def': async () => {
    const ctx = await sheetFor({ terrain: 'water' })._prepareContext({});
    assert.equal(ctx.derived.avoid, 8);
    assert.equal(ctx.combatStatTotals.def, 5);
  },

  'Fliers ignore terrain Avoid/Def but still gain or lose HP': async () => {
    const fort = await sheetFor({ movementType: 'flier', terrain: 'fort' })._prepareContext({});
    assert.equal(fort.derived.avoid, 4);
    assert.equal(fort.terrainHpStart, 3);
    const miasma = await sheetFor({ movementType: 'flier', terrain: 'miasma' })._prepareContext({});
    assert.equal(miasma.terrainHpStart, -3);
  },

  'Transformed shifters add Gauge to Might and +2 Size': async () => {
    const system = { inventory: { weapons: ['w'], items: [], equipped: 'w' }, charge: 0, gauge: 4 };
    const ctx = await sheetFor(system, [weapon('w', 3, 'strike')])._prepareContext({});
    assert.equal(ctx.isTransformed, true);
    assert.equal(ctx.derived.power, 10);
    assert.equal(ctx.derived.size, 4);
    assert.ok(ctx.traits.includes('Furred'));

    const rested = await sheetFor({ ...system, gauge: 0 }, [weapon('w', 3, 'strike')])._prepareContext({});
    assert.equal(rested.isTransformed, false);
    assert.equal(rested.derived.power, 6);
    assert.equal(rested.derived.size, 2);
  },

  'Traits come from movement type, equipped weapon and free text': async () => {
    const ctx = await sheetFor(
      { movementType: 'cavalry', trait: 'Noble', inventory: { weapons: ['w'], items: [], equipped: 'w' } },
      [weapon('w', 0, 'curse')]
    )._prepareContext({});
    assert.deepEqual(ctx.traits.sort(), ['Fiendish', 'Furred', 'Noble']);
  },

  'Rough terrain costs 2 for foot, 3 for cavalry, 1 for fliers': async () => {
    const { terrainMoveCost } = await import('../modules/rules.ts');
    const expected = { infantry: 2, armor: 2, cavalry: 3, flier: 1 };
    for (const [movementType, cost] of Object.entries(expected)) {
      const result = terrainMoveCost('forest', { movementType, skills: new Set() });
      assert.equal(result.cost, cost, movementType);
      assert.equal(result.passable, true);
    }
  },

  'Only fliers cross difficult terrain': async () => {
    const { terrainMoveCost } = await import('../modules/rules.ts');
    for (const terrain of ['mountain', 'water']) {
      for (const movementType of ['infantry', 'armor', 'cavalry']) {
        assert.equal(terrainMoveCost(terrain, { movementType, skills: new Set() }).passable, false,
          `${movementType} should not cross ${terrain}`);
      }
      assert.equal(terrainMoveCost(terrain, { movementType: 'flier', skills: new Set() }).cost, 1);
    }
  },

  'Impassable terrain stops everyone including fliers': async () => {
    const { terrainMoveCost } = await import('../modules/rules.ts');
    for (const movementType of ['infantry', 'armor', 'cavalry', 'flier']) {
      assert.equal(terrainMoveCost('wall', { movementType, skills: new Set() }).passable, false, movementType);
    }
  },

  'Mountain Climber, Seafarer and Acrobat ease the going': async () => {
    const { terrainMoveCost } = await import('../modules/rules.ts');
    const climber = terrainMoveCost('mountain', { movementType: 'infantry', skills: new Set(['mountain-climber']) });
    assert.equal(climber.passable, true);
    assert.equal(climber.cost, 2);

    const seafarer = terrainMoveCost('water', { movementType: 'infantry', skills: new Set(['seafarer']) });
    assert.equal(seafarer.cost, 2);

    const acrobat = terrainMoveCost('forest', { movementType: 'infantry', skills: new Set(['acrobat']) });
    assert.equal(acrobat.cost, 1);
  },

  'Shadow Gambit ignores penalties, Coral Cover doubles them': async () => {
    const { terrainMoveCost } = await import('../modules/rules.ts');
    assert.equal(terrainMoveCost('forest', { movementType: 'cavalry', skills: new Set(['shadow-gambit']) }).cost, 1);
    assert.equal(terrainMoveCost('forest', { movementType: 'cavalry', skills: new Set(['coral-cover']) }).cost, 6);
    // Neither skill opens up genuinely impassable ground.
    assert.equal(terrainMoveCost('wall', { movementType: 'infantry', skills: new Set(['shadow-gambit']) }).passable, false);
  },

  'Magic-wielding infantry cross desert unhindered': async () => {
    const { terrainMoveCost } = await import('../modules/rules.ts');
    const mage = { movementType: 'infantry', skills: new Set(), equipped: { group: 'anima' } };
    const knight = { movementType: 'infantry', skills: new Set(), equipped: { group: 'sword' } };
    assert.equal(terrainMoveCost('desert', mage).cost, 1);
    assert.equal(terrainMoveCost('desert', knight).cost, 2);
    // The exception is for infantry only.
    assert.equal(terrainMoveCost('desert', { movementType: 'cavalry', skills: new Set(), equipped: { group: 'anima' } }).cost, 3);
  }
};

let failed = 0;
for (const [name, run] of Object.entries(tests)) {
  try {
    await run();
    console.log(`  ok  ${name}`);
  } catch (error) {
    failed++;
    console.error(`  FAIL ${name}\n       ${error.message}`);
  }
}

console.log(`\n${Object.keys(tests).length - failed}/${Object.keys(tests).length} rules checks passed.`);
process.exit(failed ? 1 : 0);
