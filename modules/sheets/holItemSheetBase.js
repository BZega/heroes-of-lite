import { activateSheetTabs } from '../helpers.js';

/**
 * Shared behaviour for every Heroes of Lite item sheet: identical window chrome,
 * compendium read-only handling, and tab switching that survives re-renders.
 */
export default class HolItemSheetBase extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.sheets.ItemSheetV2
) {
  static DEFAULT_OPTIONS = {
    classes: ['heroes-of-lite', 'hol-sheet', 'item-sheet'],
    window: {
      icon: 'fas fa-scroll',
      resizable: true,
      contentClasses: ['standard-form']
    },
    position: {
      width: 720,
      height: 620
    },
    form: {
      submitOnChange: true,
      closeOnSubmit: false
    }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const item = this.document;

    context.name = item.name;
    context.img = item.img;
    context.type = item.type;
    context.system ??= item.system;
    context.isFromCompendium = !!item.pack;

    return context;
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this._applyCompendiumLock();
    activateSheetTabs(this);
  }

  /** Compendium documents are not editable in place, so disable every control. */
  _applyCompendiumLock() {
    if (!this.document.pack) return;
    const html = this.element;
    html.querySelectorAll('input, select, textarea, button[data-action]').forEach(el => {
      el.disabled = true;
    });
    html.classList.add('compendium-item-readonly');
  }
}
