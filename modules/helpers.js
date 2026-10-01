import { SYSTEM_ID } from './constants.js';

/**
 * Read drag-and-drop payloads without relying on the deprecated global `TextEditor`.
 * @param {DragEvent} event
 * @returns {object} Parsed drop data, or an empty object when the payload is unusable.
 */
export function getDragEventData(event) {
  const textEditor = foundry.applications?.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
  try {
    return textEditor.getDragEventData(event) ?? {};
  } catch (error) {
    console.warn('HoL | Unreadable drag payload:', error);
    return {};
  }
}

/**
 * Locate a refine Item by document id or by its `heroes-of-lite.sourceId` flag.
 * Checks world items first, then every Item compendium.
 * @param {string} refineId
 * @returns {Promise<Item|null>}
 */
export async function findRefineById(refineId) {
  if (!refineId) return null;

  const worldHit = game.items.get(refineId)
    ?? game.items.find(item => item.flags?.[SYSTEM_ID]?.sourceId === refineId);
  if (worldHit) return worldHit;

  for (const pack of game.packs) {
    if (pack.documentName !== 'Item') continue;
    const documents = await pack.getDocuments();
    const hit = documents.find(doc => doc.id === refineId || doc.flags?.[SYSTEM_ID]?.sourceId === refineId);
    if (hit) return hit;
  }
  return null;
}

/** Coerce a possibly-missing value into a finite number. */
export const toNumber = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * Wire a sheet's `.sheet-tabs` navigation to its `.tab` panels, remembering the
 * selection on the sheet instance so a re-render does not reset the view.
 * @param {ApplicationV2} sheet
 */
export function activateSheetTabs(sheet) {
  const html = sheet.element;
  const tabs = Array.from(html.querySelectorAll('.sheet-tabs .item'));
  const panels = Array.from(html.querySelectorAll('.tab'));
  if (!tabs.length || !panels.length) return;

  const known = new Set(tabs.map(tab => tab.dataset.tab));
  const activeId = known.has(sheet._activeTabId) ? sheet._activeTabId : tabs[0].dataset.tab;

  const applyActive = tabId => {
    sheet._activeTabId = tabId;
    tabs.forEach(tab => tab.classList.toggle('active', tab.dataset.tab === tabId));
    panels.forEach(panel => panel.classList.toggle('active', panel.dataset.tab === tabId));
  };

  applyActive(activeId);

  tabs.forEach(tab => {
    tab.addEventListener('click', event => {
      event.preventDefault();
      applyActive(event.currentTarget.dataset.tab);
    });
  });
}
