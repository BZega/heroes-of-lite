export const SYSTEM_ID = 'heroes-of-lite';

const templatePath = (sub: string): string => `systems/${SYSTEM_ID}/templates/${sub}`;

/** Absolute path to a sheet template bundled with the system. */
export const sheetTemplate = (name: string): string => templatePath(`sheets/${name}`);

/** Absolute path to an application template bundled with the system. */
export const appTemplate = (name: string): string => templatePath(`apps/${name}`);

/** Absolute path to a chat card template bundled with the system. */
export const chatTemplate = (name: string): string => templatePath(`chat/${name}`);

/** Display names for the weapon groups, in the order they appear in the rules. */
export const WEAPON_GROUP_LABELS: Record<string, string> = {
  sword: 'Sword',
  lance: 'Lance',
  axe: 'Axe',
  bow: 'Bow',
  dagger: 'Dagger',
  anima: 'Anima',
  light: 'Light',
  dark: 'Dark',
  staff: 'Staff',
  strike: 'Strike',
  talons: 'Talons',
  breath: 'Breath',
  shiftingStone: 'Shifting Stone',
  curse: 'Curse',
  siege: 'Siege'
};
