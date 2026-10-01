import HolItemSheetBase from './holItemSheetBase.js';
import { sheetTemplate } from '../constants.js';

/** Split the comma separated prerequisite input back into the array the data model expects. */
const parsePrerequisites = value => {
  if (Array.isArray(value)) return value;
  return String(value ?? '')
    .split(',')
    .map(entry => entry.trim())
    .filter(Boolean);
};

export default class HolSkillSheet extends HolItemSheetBase {
  static DEFAULT_OPTIONS = {
    classes: ['skill-sheet'],
    window: { icon: 'fas fa-bolt' },
    position: { width: 720, height: 620 }
  };

  static PARTS = {
    form: { template: sheetTemplate('skill-sheet.html') }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.system.attributes ??= {};
    context.system.details ??= {};
    context.system.details.prerequisite = parsePrerequisites(context.system.details.prerequisite);
    return context;
  }

  _prepareSubmitData(event, form, formData, updateData) {
    const submitData = super._prepareSubmitData(event, form, formData, updateData);
    const prerequisite = foundry.utils.getProperty(submitData, 'system.details.prerequisite');
    if (prerequisite !== undefined) {
      foundry.utils.setProperty(submitData, 'system.details.prerequisite', parsePrerequisites(prerequisite));
    }
    return submitData;
  }
}
