/**
 * Structural integrity checks.
 *
 * Catches the wiring mistakes the unit tests cannot see: a manifest pointing at a
 * missing file, a sheet referencing a template that was renamed, an import that
 * does not resolve, or a template calling a Handlebars helper nobody registered.
 *
 * Run with: npm run test:integrity
 */

import { readFile, readdir, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const notes = [];

const exists = async relative => {
  try {
    await access(path.join(root, relative));
    return true;
  } catch {
    return false;
  }
};

/** Every source file under the project, excluding dependencies and generated output. */
async function sourceFiles(dir = '.', found = []) {
  for (const entry of await readdir(path.join(root, dir), { withFileTypes: true })) {
    const relative = path.posix.join(dir, entry.name);
    if (/^(\.|node_modules|dist|packs|tools\/preview\/out|tools\/preview\/screenshots)/.test(relative.replace('./', ''))) continue;
    if (entry.isDirectory()) await sourceFiles(relative, found);
    else if (/\.(js|ts)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) found.push(relative.replace('./', ''));
  }
  return found;
}

async function templateFiles() {
  const found = [];
  const walk = async dir => {
    for (const entry of await readdir(path.join(root, dir), { withFileTypes: true })) {
      const relative = path.posix.join(dir, entry.name);
      if (entry.isDirectory()) await walk(relative);
      else if (entry.name.endsWith('.html')) found.push(relative);
    }
  };
  await walk('templates');
  return found;
}

/* -------------------------------------------- */
/*  1. Manifest references                       */
/* -------------------------------------------- */

const manifest = JSON.parse(await readFile(path.join(root, 'system.json'), 'utf8'));

// The manifest points at compiled output, which only exists after a build. Check
// the TypeScript source instead so a clean checkout still passes.
const sourceOf = file => file.replace(/^dist\//, '').replace(/\.js$/, '.ts');

for (const file of manifest.esmodules ?? []) {
  if (!await exists(sourceOf(file))) failures.push(`system.json esmodule has no source: ${file} (expected ${sourceOf(file)})`);
}
for (const file of [...manifest.styles ?? [], ...manifest.scripts ?? []]) {
  if (!await exists(file)) failures.push(`system.json references missing file: ${file}`);
}
for (const language of manifest.languages ?? []) {
  if (!await exists(language.path)) failures.push(`system.json language file missing: ${language.path}`);
}
if (!manifest.languages?.length) failures.push('system.json registers no languages');

const declaredTypes = {
  Actor: Object.keys(manifest.documentTypes?.Actor ?? {}),
  Item: Object.keys(manifest.documentTypes?.Item ?? {})
};

// Subtypes are backed by DataModels now that template.json is gone, so every
// subtype the manifest declares must have a model registered in the entry point.
if (await exists('template.json')) {
  failures.push('template.json still exists; DataModels replaced it and Foundry will prefer the stale file');
}

const entryPoint = await readFile(path.join(root, 'hol.ts'), 'utf8');
for (const doc of ['Actor', 'Item']) {
  const block = entryPoint.match(new RegExp(`CONFIG\\.${doc}\\.dataModels\\s*=\\s*\\{([^}]*)\\}`, 's'));
  if (!block) {
    failures.push(`hol.ts never registers CONFIG.${doc}.dataModels`);
    continue;
  }
  const registered = [...block[1].matchAll(/(\w+)\s*:/g)].map(match => match[1]);
  const missing = declaredTypes[doc].filter(type => !registered.includes(type));
  const extra = registered.filter(type => !declaredTypes[doc].includes(type));
  if (missing.length) failures.push(`${doc} subtypes in system.json with no DataModel: ${missing.join(', ')}`);
  if (extra.length) failures.push(`${doc} DataModels with no system.json subtype: ${extra.join(', ')}`);
}

/* -------------------------------------------- */
/*  2. Import resolution                         */
/* -------------------------------------------- */

const sources = await sourceFiles();

// A stale compiled file beside its source silently shadows the TypeScript.
for (const file of sources) {
  if (!file.endsWith('.ts')) continue;
  const compiled = file.replace(/\.ts$/, '.js');
  if (sources.includes(compiled)) {
    failures.push(`stale build artifact shadows source: ${compiled} (build output belongs in dist/)`);
  }
}

for (const file of sources) {
  const code = await readFile(path.join(root, file), 'utf8');
  for (const match of code.matchAll(/^\s*import\s[^'"]*['"](\.[^'"]+)['"]/gm)) {
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1]));
    if (!await exists(target)) failures.push(`${file} imports missing module: ${match[1]}`);
  }
}

/* -------------------------------------------- */
/*  3. Template references from code             */
/* -------------------------------------------- */

const templateHelpers = { sheetTemplate: 'templates/sheets', appTemplate: 'templates/apps', chatTemplate: 'templates/chat' };
const referenced = new Set();

for (const file of sources) {
  const code = await readFile(path.join(root, file), 'utf8');
  for (const [helper, dir] of Object.entries(templateHelpers)) {
    for (const match of code.matchAll(new RegExp(`${helper}\\(\\s*['"]([^'"]+)['"]`, 'g'))) {
      const target = `${dir}/${match[1]}`;
      referenced.add(target);
      if (!await exists(target)) failures.push(`${file} references missing template: ${target}`);
    }
  }
}

const allTemplates = await templateFiles();
const orphans = allTemplates.filter(file => !referenced.has(file));
if (orphans.length) notes.push(`templates not referenced by any sheet or app: ${orphans.join(', ')}`);

/* -------------------------------------------- */
/*  4. Handlebars helpers used vs registered     */
/* -------------------------------------------- */

const holJs = await readFile(path.join(root, 'hol.ts'), 'utf8');
const registered = new Set(
  [...holJs.matchAll(/registerHelper\(\s*['"]([^'"]+)['"]/g)].map(match => match[1])
);
// Shipped with Foundry / Handlebars itself.
const builtIn = new Set([
  'if', 'unless', 'each', 'with', 'log', 'lookup', 'else',
  'selectOptions', 'localize', 'numberFormat', 'radioBoxes', 'checked', 'disabled',
  'editor', 'filePicker', 'formField', 'formGroup', 'colorPicker', 'rangePicker'
]);

for (const file of allTemplates) {
  const markup = await readFile(path.join(root, file), 'utf8');
  for (const expression of markup.matchAll(/\{\{\{?([^}]*)\}?\}\}/g)) {
    const body = expression[1];

    const block = /^[#>/]?\s*([a-zA-Z][\w-]*)\s+\S/.exec(body);
    if (block && !builtIn.has(block[1]) && !registered.has(block[1]) && !/^(this|\.\.|@)/.test(block[1])) {
      failures.push(`${file} uses unregistered helper: ${block[1]}`);
    }

    // Subexpressions only count inside a moustache, never in surrounding prose.
    for (const sub of body.matchAll(/\(\s*([a-zA-Z][\w-]*)\s+/g)) {
      if (!builtIn.has(sub[1]) && !registered.has(sub[1])) {
        failures.push(`${file} uses unregistered subexpression helper: ${sub[1]}`);
      }
    }
  }
}

/* -------------------------------------------- */
/*  5. Seed data integrity                       */
/* -------------------------------------------- */

const seedDir = 'data/seed';
for (const entry of await readdir(path.join(root, seedDir))) {
  if (!entry.endsWith('.json')) continue;
  let data;
  try {
    data = JSON.parse(await readFile(path.join(root, seedDir, entry), 'utf8'));
  } catch (error) {
    failures.push(`${seedDir}/${entry} is not valid JSON: ${error.message}`);
    continue;
  }
  if (!Array.isArray(data)) {
    failures.push(`${seedDir}/${entry} is not an array`);
    continue;
  }
  const ids = new Set();
  for (const record of data) {
    if (!record.id) failures.push(`${seedDir}/${entry} has a record with no id`);
    else if (ids.has(record.id)) failures.push(`${seedDir}/${entry} duplicate id: ${record.id}`);
    else ids.add(record.id);
  }
}

/* -------------------------------------------- */
/*  6. Skill prerequisites point at real skills  */
/* -------------------------------------------- */

const skills = JSON.parse(await readFile(path.join(root, seedDir, 'skills.json'), 'utf8'));
const skillKeys = new Set(skills.map(entry => entry.id.replace(/^skill\./, '')));
const KNOWN_PREREQ_KINDS = new Set([
  'level', 'movement', 'skill', 'weapon', 'trait', 'exclusive', 'requires', 'gmOnly', 'gmApproval'
]);

for (const entry of skills) {
  for (const prereq of entry.prereq ?? []) {
    // `|` separates alternatives; a bare alternative inherits the preceding kind,
    // and a valueless prerequisite such as `gmOnly` is the kind itself.
    let kind = '';
    for (const segment of String(prereq).split('|')) {
      const idx = segment.indexOf(':');
      let value = '';
      if (idx !== -1) {
        kind = segment.slice(0, idx);
        value = segment.slice(idx + 1);
      } else if (kind) {
        value = segment;
      } else {
        kind = segment;
      }

      if (!KNOWN_PREREQ_KINDS.has(kind)) {
        failures.push(`${entry.id} uses unknown prereq kind "${kind}" in "${prereq}"`);
        continue;
      }
      if ((kind === 'skill' || kind === 'exclusive') && value && !skillKeys.has(value)) {
        failures.push(`${entry.id} references unknown skill "${value}" in prereq "${prereq}"`);
      }
    }
  }
}

/* -------------------------------------------- */
/*  7. Pack declarations                         */
/* -------------------------------------------- */

const packTypes = new Set(['Actor', 'Item', 'JournalEntry', 'RollTable', 'Scene', 'Macro', 'Playlist', 'Adventure', 'Cards']);
for (const pack of manifest.packs ?? []) {
  if (!packTypes.has(pack.type)) failures.push(`pack ${pack.name} has invalid type: ${pack.type}`);
  if (!pack.path?.startsWith('packs/')) failures.push(`pack ${pack.name} has suspicious path: ${pack.path}`);
}

/* -------------------------------------------- */
/*  8. No pre-v14 API fallbacks                  */
/* -------------------------------------------- */

/** Globals Foundry removed; reaching for them masks a real breakage behind `??`. */
const REMOVED_GLOBALS = [
  'Actors', 'Items', 'Journal', 'Scenes', 'Macros', 'Playlists', 'RollTables',
  'renderTemplate', 'TextEditor', 'Dialog', 'FormApplication', 'Application'
];
const LEGACY_PATTERNS = [
  { pattern: /globalThis\.(\w+)/g, describe: match => REMOVED_GLOBALS.includes(match[1]) ? `globalThis.${match[1]}` : null },
  { pattern: /flags\??\.\s*core\s*\]?\??\.\s*sourceId/g, describe: () => 'flags.core.sourceId (use _stats.compendiumSource)' }
];

for (const file of sources) {
  if (file.startsWith('tools/')) continue;
  const code = await readFile(path.join(root, file), 'utf8');
  for (const { pattern, describe } of LEGACY_PATTERNS) {
    for (const match of code.matchAll(pattern)) {
      const label = describe(match);
      if (label) failures.push(`${file} uses removed pre-v14 API: ${label}`);
    }
  }
}

const minimum = Number.parseInt(manifest.compatibility?.minimum ?? '0', 10);
if (minimum < 14) failures.push(`system.json targets Foundry ${manifest.compatibility?.minimum}; this codebase requires 14+`);

/* -------------------------------------------- */

for (const note of notes) console.log(`  note  ${note}`);
if (!failures.length) {
  console.log(`\nIntegrity OK — ${sources.length} modules, ${allTemplates.length} templates, ${manifest.packs.length} packs.`);
  process.exit(0);
}

for (const failure of failures) console.error(`  FAIL  ${failure}`);
console.error(`\n${failures.length} integrity problem(s).`);
process.exit(1);
