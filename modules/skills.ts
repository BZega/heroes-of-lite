/**
 * Skill eligibility (rules p.12, p.15, p.37).
 *
 * The sheet enforces this on drop and re-runs it on render, and the prerequisite
 * test harness imports the same functions, so there is exactly one copy of the
 * grammar and the qualification rules.
 */

/** Strip the `skill.` prefix authored in the seed data. */
export const skillSlug = (value: unknown): string =>
  String(value || '').replace(/^skill\./, '');

/** The prerequisite key a skill is referred to by, preferring the authored id. */
export function slugForSkill(skill: { name?: string; flags?: Record<string, any> }): string {
  const flags = skill.flags?.['heroes-of-lite'] ?? {};
  return skillSlug(
    flags['skillKey']
    || flags['sourceId']
    || (skill.name || '').toLowerCase().replace(/\s+/g, '-')
  );
}

/** Prerequisites may be authored as an array or a comma separated string. */
export function toPrereqArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  return String(value ?? '').split(',').map(part => part.trim()).filter(Boolean);
}

/** The mechanical fields the rules care about, read off a skill's system data. */
export function readSkillFields(system: Record<string, any> | undefined): {
  typeGroup: string;
  prerequisite: string[];
  requiredCharge: number;
} {
  return {
    typeGroup: system?.['typeGroup'] ?? '',
    prerequisite: toPrereqArray(system?.['prerequisite']),
    requiredCharge: Number(system?.['requiredCharge']) || 0
  };
}

/** Weapon proficiencies each weapon-restricted skill group accepts (rules p.35-37). */
const WEAPON_GROUP_MAP: Record<string, string[]> = {
  'sword, lance, and axe': ['sword', 'lance', 'axe'],
  'dagger and bow': ['dagger', 'bow'],
  'anima, light, and dark': ['anima', 'light', 'dark'],
  'staff': ['staff'],
  'strike, talons, and breath': ['strike', 'talons', 'breath'],
  'shifting stone': ['shiftingStone']
};

const MOVE_GROUPS = ['infantry', 'cavalry', 'flier', 'armor'];

/** Heritor personals open a movement group's low-level skills (rules p.16). */
const HERITOR_SKILLS: Record<string, string> = {
  flier: 'heritor-of-feathers',
  cavalry: 'heritor-of-furs',
  armor: 'heritor-of-scales'
};

/** Everything about a unit that skill eligibility depends on. */
export interface SkillContext {
  level: number;
  movementType: string;
  /** Every proficiency the unit holds, starting one plus whatever skills granted. */
  weaponProficiencies: Set<string>;
  trait: string;
  /** Prerequisite slugs of the skills the unit already has. */
  knownSlugs: Set<string>;
  hasCombatArt: boolean;
  isGM: boolean;
}

/**
 * How many weapon proficiencies a unit may hold: one from character creation plus
 * whatever its skills grant via `grant:weaponProficiency:+N` (rules p.33, p.39).
 */
export function proficiencyAllowance(skills: Iterable<{ system?: Record<string, any> }>): number {
  let granted = 0;
  for (const skill of skills) {
    for (const tag of (skill?.system?.['tags'] ?? []) as string[]) {
      const match = /^grant:weaponProficiency:([+-]?\d+)$/.exec(String(tag));
      if (match) granted += Number(match[1]);
    }
  }
  return Math.max(1, 1 + granted);
}

/** Skill slots: 2 at level 1, one more every 5 levels, capped at 8 (rules p.15). */
export function skillCapForLevel(level: number): number {
  return Math.min(2 + Math.floor(Math.max(1, level) / 5), 8);
}

/** The next level at which a unit unlocks another skill slot, or null at the cap. */
export function nextSkillLevel(level: number): number | null {
  if (skillCapForLevel(level) >= 8) return null;
  return (Math.floor(Math.max(1, level) / 5) + 1) * 5;
}

/**
 * A prerequisite is a set of `kind:value` clauses joined by `|`, any one of which
 * satisfies it. A clause without its own kind inherits the previous one, so
 * `weapon:sword|lance` and `skill:monstrous|weapon:curse` both parse.
 */
export function parseAlternatives(raw: unknown): { kind: string; value: string }[] {
  const alternatives: { kind: string; value: string }[] = [];
  let kind = '';
  for (const segment of String(raw).split('|')) {
    const idx = segment.indexOf(':');
    if (idx !== -1) {
      kind = segment.slice(0, idx);
      alternatives.push({ kind, value: segment.slice(idx + 1) });
    } else if (kind) {
      alternatives.push({ kind, value: segment });
    } else {
      // A valueless prerequisite such as `gmOnly` is the kind itself.
      alternatives.push({ kind: segment, value: '' });
    }
  }
  return alternatives;
}

/** @returns True when the clause is satisfied, otherwise a human readable reason. */
function checkClause({ kind, value }: { kind: string; value: string }, context: SkillContext): true | string {
  // Armored units gain access to all skills 5 levels earlier (rules p.12).
  const armorBonus = context.movementType === 'armor' ? 5 : 0;
  const effectiveLevel = context.level + armorBonus;

  switch (kind) {
    case 'level': {
      const need = Number(value) || 0;
      if (effectiveLevel >= need) return true;
      return armorBonus
        ? `level ${need} (you are level ${context.level}; Armor counts as ${effectiveLevel})`
        : `level ${need} (you are level ${context.level})`;
    }
    case 'movement':
      return context.movementType === value || `movement type ${value}`;
    case 'skill':
      return context.knownSlugs.has(value) || `the skill ${value.replace(/-/g, ' ')}`;
    case 'weapon':
      return context.weaponProficiencies.has(value) || `weapon proficiency ${value}`;
    case 'trait':
      return context.trait.toLowerCase().includes(value.toLowerCase()) || `the trait ${value}`;
    case 'exclusive':
      return !context.knownSlugs.has(value) || `you already have the exclusive skill ${value.replace(/-/g, ' ')}`;
    case 'requires':
      if (value !== 'combatArt') return true;
      return context.hasCombatArt || 'at least one Combat Art';
    case 'gmOnly':
    case 'gmApproval':
      return context.isGM || 'the Game Master to assign it';
    default:
      // Unmodelled prerequisite kinds are not enforced.
      return true;
  }
}

/** Does the unit's movement type or proficiency open this skill's group? */
function checkTypeGroup(typeGroup: string, context: SkillContext, levelRequirement: number, slug: string): true | string {
  if (!typeGroup || typeGroup === 'all-access' || typeGroup === 'combat') return true;

  if (typeGroup === 'fiend') {
    // Fiend skills need the Monstrous skill or a Curse proficiency (rules p.37).
    const ok = context.trait.toLowerCase().includes('fiend')
      || context.weaponProficiencies.has('curse')
      || context.knownSlugs.has('monstrous');
    return ok || 'the Monstrous skill, a Curse proficiency, or the Fiendish trait';
  }

  if (MOVE_GROUPS.includes(typeGroup)) {
    if (context.movementType === typeGroup) return true;
    const heritor = HERITOR_SKILLS[typeGroup];
    const viaHeritor = !!heritor
      && context.knownSlugs.has(heritor)
      && slug !== 'canter'
      && levelRequirement <= 10;
    return viaHeritor || `${typeGroup} movement type`;
  }

  const allowed = WEAPON_GROUP_MAP[typeGroup];
  if (allowed) {
    return allowed.some(group => context.weaponProficiencies.has(group))
      || `weapon proficiency: ${allowed.join(' / ')}`;
  }
  return true;
}

/** The `level:N` clause on a skill, used to gate Heritor access. */
function levelRequirementOf(prerequisite: string[]): number {
  const raw = prerequisite.find(entry => String(entry).startsWith('level:'));
  return raw ? Number(String(raw).split(':')[1]) || 0 : 0;
}

/**
 * Check every prerequisite clause, ignoring the skill's group restriction.
 * @returns null when all are satisfied, otherwise why the first failure failed.
 */
export function checkPrerequisites(prerequisite: string[], context: SkillContext): string | null {
  for (const raw of prerequisite) {
    const reasons: string[] = [];
    let satisfied = false;
    for (const clause of parseAlternatives(raw)) {
      const outcome = checkClause(clause, context);
      if (outcome === true) { satisfied = true; break; }
      reasons.push(outcome);
    }
    if (!satisfied) return reasons.join(' or ');
  }
  return null;
}

export interface SkillCandidate {
  name?: string;
  system?: Record<string, any>;
  flags?: Record<string, any>;
}

/**
 * Can this unit hold this skill? Covers the group restriction and every
 * prerequisite clause. Slot count and duplicates are checked by the caller,
 * since they depend on which slot is being filled.
 */
export function checkSkillEligibility(skill: SkillCandidate, context: SkillContext): { ok: true } | { ok: false; reason: string } {
  const fields = readSkillFields(skill.system);
  const slug = slugForSkill(skill);

  const group = checkTypeGroup(fields.typeGroup, context, levelRequirementOf(fields.prerequisite), slug);
  if (group !== true) return { ok: false, reason: `requires ${group}` };

  const failure = checkPrerequisites(fields.prerequisite, context);
  return failure ? { ok: false, reason: `requires ${failure}` } : { ok: true };
}
