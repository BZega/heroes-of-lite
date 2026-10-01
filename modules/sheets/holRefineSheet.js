import HolItemSheetBase from './holItemSheetBase.js';
import { sheetTemplate } from '../constants.js';

export default class HolRefineSheet extends HolItemSheetBase {
  static DEFAULT_OPTIONS = {
    classes: ['refine-sheet'],
    window: { icon: 'fas fa-gem' },
    position: { width: 720, height: 620 }
  };

  static PARTS = {
    form: { template: sheetTemplate('refine-sheet.html') }
  };
}
