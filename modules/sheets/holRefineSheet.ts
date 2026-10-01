import HolItemSheetBase from './holItemSheetBase.ts';
import { sheetTemplate } from '../constants.ts';

export default class HolRefineSheet extends HolItemSheetBase {
  static override DEFAULT_OPTIONS = {
    classes: ['refine-sheet'],
    window: { icon: 'fas fa-gem' },
    position: { width: 720, height: 620 }
  };

  static override PARTS = {
    form: { template: sheetTemplate('refine-sheet.html') }
  };
}
