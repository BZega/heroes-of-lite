import { activateSheetTabs } from '../helpers.ts';

/**
 * Shared behaviour for every Heroes of Lite item sheet: identical window chrome,
 * compendium read-only handling, and tab switching that survives re-renders.
 */
export default class HolItemSheetBase extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.sheets.ItemSheetV2
) {
  static override DEFAULT_OPTIONS: Record<string, any> = {
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

  override async _prepareContext(options: Record<string, unknown>): Promise<Record<string, any>> {
    const context = await super._prepareContext(options);
    const item = this.document as Item;

    context['name'] = item.name;
    context['img'] = item.img;
    context['type'] = item.type;
    context['system'] ??= item.system;
    context['isFromCompendium'] = !!item.pack;

    return context;
  }

  override _onRender(context: Record<string, any>, options: Record<string, unknown>): void {
    super._onRender(context, options);
    this._applyCompendiumLock();
    activateSheetTabs(this);
  }

  /** Report a rejected edit rather than letting it become an unhandled rejection. */
  override _prepareSubmitData(
    event: Event | null,
    form: HTMLFormElement,
    formData: unknown,
    updateData?: Record<string, unknown>
  ): Record<string, any> {
    try {
      return super._prepareSubmitData(event, form, formData, updateData);
    } catch (error) {
      console.error('HoL | Rejected item update:', error);
      ui.notifications?.error(`Heroes of Lite: ${error instanceof Error ? error.message : String(error)}`);
      return {};
    }
  }

  /** Compendium documents are not editable in place, so disable every control. */
  _applyCompendiumLock(): void {
    if (!this.document.pack) return;
    const html = this.element;
    html.querySelectorAll<HTMLInputElement>('input, select, textarea, button[data-action]').forEach(el => {
      el.disabled = true;
    });
    html.classList.add('compendium-item-readonly');
  }
}
