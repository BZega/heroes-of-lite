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

const { default: HolActorSheet } = await import('../modules/sheets/holActorSheet.js');

/** Build a sheet bound to a stub actor with the given system data. */
function sheetFor(system, items = []) {
  const itemMap = new Map(items.map(item => [item.id, item]));
  const document = {
    name: 'Test Unit',
    img: '',
    type: 'unit',
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
      currentHP: 15,
      combatStats: { hp: 15, atk: 3, spd: 3, dex: 3, def: 3, res: 3, luck: 3 },
      tempStats: {}, bonusStats: {}, bonuses: {},
      nonCombatStats: { strength: 0, intellect: 0, perception: 0, charisma: 0 },
      derivedStats: { charge: 0, gauge: 0 },
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
  id, type: 'weapon', system: { details: { might }, attributes: { weaponGroup } }
});

const tests = {
  'Hit is floor(Dex / 4)': async () => {
    const ctx = await sheetFor({ combatStats: { hp: 15, atk: 3, spd: 3, dex: 6, def: 3, res: 3, luck: 3 } })._prepareContext({});
    assert.equal(ctx.system.derivedStats.hit, 1);
  },

  'Avoid is floor(Luck / 4) + 4, Crit Avoid is Avoid + 15': async () => {
    const ctx = await sheetFor({ combatStats: { hp: 15, atk: 3, spd: 3, dex: 6, def: 3, res: 3, luck: 4 } })._prepareContext({});
    assert.equal(ctx.system.derivedStats.avoid, 5);
    assert.equal(ctx.system.derivedStats.critAvoid, 20);
  },

  'Power is Atk + Might and Tri is floor(Power / 5)': async () => {
    const ctx = await sheetFor(
      { combatStats: { hp: 15, atk: 7, spd: 3, dex: 3, def: 3, res: 3, luck: 3 }, inventory: { weapons: ['w'], items: [], equipped: 'w' } },
      [weapon('w', 6)]
    )._prepareContext({});
    assert.equal(ctx.system.derivedStats.power, 13);
    assert.equal(ctx.system.derivedStats.tri, 2);
  },

  'Non-combat pool is 6 points': async () => {
    const ctx = await sheetFor({ nonCombatStats: { strength: 2, intellect: 1, perception: 0, charisma: 0 } })._prepareContext({});
    assert.equal(ctx.unallocatedPoints, 3);
  },

  'Derived non-combat stats cap at 3': async () => {
    const ctx = await sheetFor({ combatStats: { hp: 15, atk: 3, spd: 20, dex: 5, def: 3, res: 3, luck: 16 } })._prepareContext({});
    assert.equal(ctx.system.nonCombatStats.acrobatics, 3);
    assert.equal(ctx.system.nonCombatStats.finesse, 1);
    assert.equal(ctx.system.nonCombatStats.fate, 3);
  },

  'Combat pool is 12 at level 1 and +3 per level': async () => {
    const level1 = await sheetFor({})._prepareContext({});
    assert.equal(level1.unallocatedCombatPoints, 12);
    const mercenary = await sheetFor({
      combatStats: { hp: 18, atk: 6, spd: 4, dex: 6, def: 5, res: 3, luck: 3 }
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
      const ctx = await sheetFor({ movementType, nonCombatStats: { strength: 1 } })._prepareContext({});
      assert.equal(ctx.system.derivedStats.move, move, movementType);
      assert.equal(ctx.system.derivedStats.aid, baseAid + 1, movementType);
    }
  },

  'Armor units gain +2 Con': async () => {
    const ctx = await sheetFor({ movementType: 'armor', size: 'large' })._prepareContext({});
    assert.equal(ctx.system.derivedStats.con, 5);
  },

  'Injured applies -3 to Atk, Spd, Def and Res only': async () => {
    const ctx = await sheetFor({ status: 'injured', combatStats: { hp: 15, atk: 8, spd: 8, dex: 8, def: 8, res: 8, luck: 8 } })._prepareContext({});
    assert.deepEqual(ctx.combatStatTotals, { hp: 15, atk: 5, spd: 5, dex: 8, def: 5, res: 5, luck: 8 });
  },

  'Shocked zeroes Avoid and Move, and fixes Crit Avoid at 15': async () => {
    const ctx = await sheetFor({ status: 'shocked', combatStats: { hp: 15, atk: 3, spd: 3, dex: 3, def: 3, res: 3, luck: 16 } })._prepareContext({});
    assert.equal(ctx.system.derivedStats.avoid, 0);
    assert.equal(ctx.system.derivedStats.critAvoid, 15);
    assert.equal(ctx.system.derivedStats.move, 0);
  },

  'Terrain grants Avoid and Def': async () => {
    const ctx = await sheetFor({ terrain: 'water' })._prepareContext({});
    assert.equal(ctx.system.derivedStats.avoid, 8);
    assert.equal(ctx.combatStatTotals.def, 5);
  },

  'Fliers ignore terrain Avoid/Def but still gain or lose HP': async () => {
    const fort = await sheetFor({ movementType: 'flier', terrain: 'fort' })._prepareContext({});
    assert.equal(fort.system.derivedStats.avoid, 4);
    assert.equal(fort.terrainHpStart, 3);
    const miasma = await sheetFor({ movementType: 'flier', terrain: 'miasma' })._prepareContext({});
    assert.equal(miasma.terrainHpStart, -3);
  },

  'Transformed shifters add Gauge to Might and +2 Size': async () => {
    const system = { inventory: { weapons: ['w'], items: [], equipped: 'w' }, derivedStats: { charge: 0, gauge: 4 } };
    const ctx = await sheetFor(system, [weapon('w', 3, 'strike')])._prepareContext({});
    assert.equal(ctx.isTransformed, true);
    assert.equal(ctx.system.derivedStats.power, 10);
    assert.equal(ctx.system.derivedStats.size, 4);
    assert.ok(ctx.traits.includes('Furred'));

    const rested = await sheetFor({ ...system, derivedStats: { charge: 0, gauge: 0 } }, [weapon('w', 3, 'strike')])._prepareContext({});
    assert.equal(rested.isTransformed, false);
    assert.equal(rested.system.derivedStats.power, 6);
    assert.equal(rested.system.derivedStats.size, 2);
  },

  'Traits come from movement type, equipped weapon and free text': async () => {
    const ctx = await sheetFor(
      { movementType: 'cavalry', trait: 'Noble', inventory: { weapons: ['w'], items: [], equipped: 'w' } },
      [weapon('w', 0, 'curse')]
    )._prepareContext({});
    assert.deepEqual(ctx.traits.sort(), ['Fiendish', 'Furred', 'Noble']);
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
