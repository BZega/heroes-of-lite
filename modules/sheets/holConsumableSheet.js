import HolItemSheetBase from './holItemSheetBase.js';
import { sheetTemplate } from '../constants.js';

export default class HolConsumableSheet extends HolItemSheetBase {
  static DEFAULT_OPTIONS = {
    classes: ['consumable-sheet'],
    window: { icon: 'fas fa-flask' },
    position: { width: 720, height: 620 }
  };

  static PARTS = {
    form: { template: sheetTemplate('consumable-sheet.html') }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.system.details ??= {};
    return context;
  }
}
