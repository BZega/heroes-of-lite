import HolItemSheetBase from './holItemSheetBase.ts';
import { sheetTemplate } from '../constants.ts';

export default class HolConsumableSheet extends HolItemSheetBase {
  static override DEFAULT_OPTIONS = {
    classes: ['consumable-sheet'],
    window: { icon: 'fas fa-flask' },
    position: { width: 720, height: 620 }
  };

  static override PARTS = {
    form: { template: sheetTemplate('consumable-sheet.html') }
  };
}
