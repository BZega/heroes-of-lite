import { SYSTEM_ID } from './constants.ts';

/**
 * Read drag-and-drop payloads, tolerating a malformed payload from outside the system.
 * @returns Parsed drop data, or an empty object when the payload is unusable.
 */
export function getDragEventData(event: DragEvent): Record<string, any> {
  try {
    return foundry.applications.ux.TextEditor.implementation.getDragEventData(event) ?? {};
  } catch (error) {
    console.warn('HoL | Unreadable drag payload:', error);
    return {};
  }
}

/**
 * Locate a refine Item by document id or by its `heroes-of-lite.sourceId` flag.
 * Checks world items first, then every Item compendium.
 */
export async function findRefineById(refineId: string): Promise<Item | null> {
  if (!refineId) return null;

  const worldHit = game.items.get(refineId)
    ?? game.items.find(item => item.flags?.[SYSTEM_ID]?.sourceId === refineId);
  if (worldHit) return worldHit;

  for (const pack of game.packs) {
    if (pack.documentName !== 'Item') continue;
    const documents = await pack.getDocuments();
    const hit = documents.find(doc => doc.id === refineId || doc.flags?.[SYSTEM_ID]?.sourceId === refineId);
    if (hit) return hit as Item;
  }
  return null;
}

/** Coerce a possibly-missing value into a finite number. */
export const toNumber = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** A sheet that remembers which tab the user last looked at. */
interface TabbedSheet {
  element: HTMLElement;
  _activeTabId?: string;
}

/**
 * Wire a sheet's `.sheet-tabs` navigation to its `.tab` panels, remembering the
 * selection on the sheet instance so a re-render does not reset the view.
 */
export function activateSheetTabs(sheet: TabbedSheet): void {
  const html = sheet.element;
  const tabs = Array.from(html.querySelectorAll<HTMLElement>('.sheet-tabs .item'));
  const panels = Array.from(html.querySelectorAll<HTMLElement>('.tab'));
  if (!tabs.length || !panels.length) return;

  const known = new Set(tabs.map(tab => tab.dataset['tab']));
  const fallback = tabs[0]?.dataset['tab'] ?? '';
  const activeId = known.has(sheet._activeTabId) ? sheet._activeTabId! : fallback;

  const applyActive = (tabId: string): void => {
    sheet._activeTabId = tabId;
    tabs.forEach(tab => tab.classList.toggle('active', tab.dataset['tab'] === tabId));
    panels.forEach(panel => panel.classList.toggle('active', panel.dataset['tab'] === tabId));
  };

  applyActive(activeId);

  tabs.forEach(tab => {
    tab.addEventListener('click', event => {
      event.preventDefault();
      const target = event.currentTarget as HTMLElement;
      applyActive(target.dataset['tab'] ?? '');
    });
  });
}
