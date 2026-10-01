import HolItemSheetBase from './holItemSheetBase.ts';
import { sheetTemplate } from '../constants.ts';

/** Split the comma separated prerequisite input back into the array the data model expects. */
const parsePrerequisites = (value: unknown): string[] => {
  if (Array.isArray(value)) return value;
  return String(value ?? '')
    .split(',')
    .map(entry => entry.trim())
    .filter(Boolean);
};

export default class HolSkillSheet extends HolItemSheetBase {
  static override DEFAULT_OPTIONS = {
    classes: ['skill-sheet'],
    window: { icon: 'fas fa-bolt' },
    position: { width: 720, height: 620 }
  };

  static override PARTS = {
    form: { template: sheetTemplate('skill-sheet.html') }
  };

  override async _prepareContext(options: Record<string, unknown>): Promise<Record<string, any>> {
    const context = await super._prepareContext(options);
    context['system'].prerequisite = parsePrerequisites(context['system'].prerequisite);
    return context;
  }

  override _prepareSubmitData(
    event: Event | null,
    form: HTMLFormElement,
    formData: unknown,
    updateData?: Record<string, unknown>
  ): Record<string, any> {
    const submitData = super._prepareSubmitData(event, form, formData, updateData);
    const prerequisite = foundry.utils.getProperty(submitData, 'system.prerequisite');
    if (prerequisite !== undefined) {
      foundry.utils.setProperty(submitData, 'system.prerequisite', parsePrerequisites(prerequisite));
    }
    return submitData;
  }
}
