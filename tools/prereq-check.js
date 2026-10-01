/**
 * Skill prerequisite checks, exercised against the real seed data.
 * Run with: npm run test:prereq
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const skills = JSON.parse(await readFile(new URL('../data/seed/skills.json', import.meta.url), 'utf8'));
const byId = new Map(skills.map(entry => [entry.id, entry]));

/**
 * Mirror of the sheet's prerequisite grammar: `|` separates alternatives, a bare
 * alternative inherits the preceding kind, and a valueless clause is its own kind.
 */
function parseAlternatives(raw) {
  const alternatives = [];
  let kind = '';
  for (const segment of String(raw).split('|')) {
    const idx = segment.indexOf(':');
    if (idx !== -1) {
      kind = segment.slice(0, idx);
      alternatives.push({ kind, value: segment.slice(idx + 1) });
    } else if (kind) {
      alternatives.push({ kind, value: segment });
    } else {
      alternatives.push({ kind: segment, value: '' });
    }
  }
  return alternatives;
}

/** Can `unit` satisfy every prerequisite on the skill? */
function qualifies(skillId, unit) {
  const skill = byId.get(skillId);
  assert.ok(skill, `seed data is missing ${skillId}`);

  const effectiveLevel = unit.level + (unit.movementType === 'armor' ? 5 : 0);

  const check = ({ kind, value }) => {
    switch (kind) {
      case 'level': return effectiveLevel >= (Number(value) || 0);
      case 'movement': return unit.movementType === value;
      case 'skill': return unit.skills.has(value);
      case 'weapon': return unit.weaponProficiency === value;
      case 'trait': return unit.trait.toLowerCase().includes(value.toLowerCase());
      case 'exclusive': return !unit.skills.has(value);
      case 'requires': return value !== 'combatArt' || unit.hasCombatArt;
      case 'gmOnly':
      case 'gmApproval': return unit.isGM;
      default: return true;
    }
  };

  return (skill.prereq ?? []).every(prereq => parseAlternatives(prereq).some(check));
}

const unit = (overrides = {}) => ({
  level: 30,
  movementType: 'infantry',
  weaponProficiency: 'sword',
  trait: '',
  skills: new Set(),
  hasCombatArt: true,
  isGM: false,
  ...overrides
});

const tests = {
  'Cross-kind alternation accepts either branch': () => {
    const fiendSkills = ['skill.vengeful-cry', 'skill.coral-cover', 'skill.shadow-gambit', 'skill.anathema', 'skill.dark-spikes'];
    for (const id of fiendSkills) {
      assert.ok(
        qualifies(id, unit({ weaponProficiency: 'curse' })),
        `${id} should be learnable with a Curse proficiency`
      );
      assert.ok(
        qualifies(id, unit({ skills: new Set(['monstrous']) })),
        `${id} should be learnable with the Monstrous skill`
      );
      assert.equal(
        qualifies(id, unit()),
        false,
        `${id} should be refused without Monstrous or Curse`
      );
    }
  },

  'Same-kind alternation still works': () => {
    assert.ok(qualifies('skill.quixotic', unit({ weaponProficiency: 'axe' })));
    assert.ok(qualifies('skill.quixotic', unit({ weaponProficiency: 'lance' })));
    assert.equal(qualifies('skill.quixotic', unit({ weaponProficiency: 'bow' })), false);

    assert.ok(qualifies('skill.canter', unit({ movementType: 'flier' })));
    assert.ok(qualifies('skill.canter', unit({ movementType: 'cavalry' })));
    assert.equal(qualifies('skill.canter', unit({ movementType: 'infantry' })), false);
  },

  'Valueless prerequisites still gate on the GM': () => {
    const gmGated = skills.filter(entry =>
      (entry.prereq ?? []).some(prereq => prereq === 'gmOnly' || prereq === 'gmApproval'));
    assert.ok(gmGated.length >= 10, 'expected the GM-only skill set to be present');

    // Vary everything except GM status so only that clause can decide the outcome.
    const shapes = [
      { movementType: 'armor', weaponProficiency: 'curse' },
      { movementType: 'cavalry', weaponProficiency: 'sword' },
      { movementType: 'flier', weaponProficiency: 'lance' },
      { movementType: 'infantry', weaponProficiency: 'staff' }
    ];

    for (const skill of gmGated) {
      const asPlayer = shapes.some(shape => qualifies(skill.id, unit({ ...shape, isGM: false })));
      const asGM = shapes.some(shape => qualifies(skill.id, unit({ ...shape, isGM: true })));
      assert.equal(asPlayer, false, `${skill.id} must stay locked for players`);
      assert.ok(asGM, `${skill.id} should be assignable by the GM`);
    }
  },

  'Level gates respect the Armor five-level discount': () => {
    assert.equal(qualifies('skill.expertise', unit({ level: 19 })), false);
    assert.ok(qualifies('skill.expertise', unit({ level: 20 })));
    // Armour reaches level-20 skills at level 15 (rules p.12).
    assert.ok(qualifies('skill.expertise', unit({ level: 15, movementType: 'armor' })));
  },

  'Exclusive prerequisites block conflicting skills': () => {
    const exclusives = skills.filter(entry =>
      (entry.prereq ?? []).some(prereq => prereq.startsWith('exclusive:')));
    assert.ok(exclusives.length, 'expected exclusive prerequisites in the seed data');

    for (const skill of exclusives) {
      const blocked = skill.prereq
        .filter(prereq => prereq.startsWith('exclusive:'))
        .map(prereq => prereq.slice('exclusive:'.length));
      assert.equal(
        qualifies(skill.id, unit({ skills: new Set(blocked), weaponProficiency: 'sword', movementType: 'armor' })),
        false,
        `${skill.id} should be refused when the excluded skill is known`
      );
    }
  },

  'Every prerequisite in the seed data is reachable by some unit': () => {
    const unreachable = [];
    const candidates = [
      unit(), unit({ isGM: true }),
      ...['sword', 'lance', 'axe', 'bow', 'dagger', 'anima', 'light', 'dark', 'staff',
        'strike', 'talons', 'breath', 'shiftingStone', 'curse']
        .map(weaponProficiency => unit({ weaponProficiency, isGM: true })),
      ...['infantry', 'cavalry', 'flier', 'armor']
        .map(movementType => unit({ movementType, isGM: true })),
      unit({ isGM: true, skills: new Set(['monstrous', 'perform']), trait: 'fiend' })
    ];

    for (const skill of skills) {
      if (!candidates.some(candidate => qualifies(skill.id, candidate))) unreachable.push(skill.id);
    }
    assert.deepEqual(unreachable, [], 'no skill should be impossible to learn');
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

console.log(`\n${Object.keys(tests).length - failed}/${Object.keys(tests).length} prerequisite checks passed.`);
process.exit(failed ? 1 : 0);
