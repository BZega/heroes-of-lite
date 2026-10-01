import HolItemSheetBase from './holItemSheetBase.js';
import { sheetTemplate } from '../constants.js';
import { findRefineById, getDragEventData, toNumber } from '../helpers.js';

const WEAPON_TYPE_NAMES = {
  sword: 'Sword',
  lance: 'Lance',
  axe: 'Axe',
  bow: 'Bow',
  dagger: 'Dagger',
  anima: 'Anima',
  light: 'Light',
  dark: 'Dark',
  staff: 'Heal',
  strike: 'Strike',
  talons: 'Talons',
  breath: 'Breath',
  shiftingStone: 'Shifting Stone',
  curse: 'Curse',
  siege: 'Siege'
};

export default class HolWeaponSheet extends HolItemSheetBase {
  static DEFAULT_OPTIONS = {
    classes: ['weapon-sheet'],
    window: { icon: 'fas fa-khanda' },
    position: { width: 720, height: 620 }
  };

  static PARTS = {
    form: { template: sheetTemplate('weapon-sheet.html') }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);

    context.system.attributes ??= {};
    context.system.details ??= {};
    context.system.details.range ??= { min: 1, max: 1 };
    context.system.details.refines ??= [{ id: '', name: '' }, { id: '', name: '' }];

    context.innateRefines = [];
    for (const refineId of context.system.details.innateAttributes ?? []) {
      const refine = await findRefineById(refineId);
      if (refine) context.innateRefines.push({ id: refine.id, name: refine.name });
    }

    return context;
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const html = this.element;

    html.querySelectorAll('.refine-name').forEach(el => {
      el.addEventListener('click', this._onRefineNameClick.bind(this));
    });
    html.querySelectorAll('.innate-attribute-tag').forEach(el => {
      el.addEventListener('click', this._onInnateAttributeClick.bind(this));
    });

    // Compendium documents are read-only, so skip the editing affordances entirely.
    if (this.document.pack) return;

    html.querySelectorAll('[data-dropzone="refine"]').forEach(slot => {
      slot.addEventListener('dragover', this._onDragOver.bind(this));
      slot.addEventListener('dragleave', this._onDragLeave.bind(this));
      slot.addEventListener('drop', this._onDropRefine.bind(this));
    });
    html.querySelectorAll('.remove-refine').forEach(button => {
      button.addEventListener('click', this._onRemoveRefine.bind(this));
    });
  }

  /* ---------------------------------------- */
  /*  Navigation                               */
  /* ---------------------------------------- */

  async _onInnateAttributeClick(event) {
    event.preventDefault();
    event.stopPropagation();
    const refine = await findRefineById(event.currentTarget.dataset.refineId);
    if (refine) refine.sheet.render(true);
    else console.warn('HoL | Could not resolve innate refine:', event.currentTarget.dataset.refineId);
  }

  async _onRefineNameClick(event) {
    event.preventDefault();
    event.stopPropagation();
    const slotIndex = Number(event.currentTarget.closest('.refine-slot')?.dataset.slot);
    if (!Number.isInteger(slotIndex)) return;
    const refine = await findRefineById(this.document.system.details.refines?.[slotIndex]?.id);
    if (refine) refine.sheet.render(true);
  }

  /* ---------------------------------------- */
  /*  Refine drag & drop                       */
  /* ---------------------------------------- */

  _onDragOver(event) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.classList.add('drag-over');
  }

  _onDragLeave(event) {
    event.currentTarget.classList.remove('drag-over');
  }

  async _onDropRefine(event) {
    event.preventDefault();
    event.stopPropagation();

    // `currentTarget` is cleared once the handler awaits, so capture it up front.
    const slot = event.currentTarget;
    slot.classList.remove('drag-over');

    if (this.document.pack) {
      ui.notifications.warn('Compendium items cannot be modified. Create a copy first.');
      return;
    }

    const slotIndex = Number(slot.dataset.slot);
    if (!Number.isInteger(slotIndex)) return;

    const dropData = getDragEventData(event);
    if (dropData.type !== 'Item') return;

    const droppedItem = await Item.implementation.fromDropData(dropData);
    if (!droppedItem || droppedItem.type !== 'refine') {
      ui.notifications.warn('Only Refine items can be dropped here.');
      return;
    }

    const details = this.document.system.details ?? {};
    const currentRefines = details.refines ?? [{}, {}];
    const weaponGroup = this.document.system.attributes?.weaponGroup ?? '';
    const validGroups = droppedItem.system?.appliesToWeaponGroups ?? [];

    if (validGroups.length && !validGroups.includes(weaponGroup)) {
      ui.notifications.warn(`This refine cannot be applied to ${weaponGroup || 'untyped'} weapons.`);
      return;
    }
    if (currentRefines.some(refine => refine?.name && refine.name === droppedItem.name)) {
      ui.notifications.warn('This refine is already applied to the weapon.');
      return;
    }

    const category = droppedItem.system?.category;
    const isAdvanced = category === 'advanced';
    const isGMOnly = category === 'gmOnly';

    if (isGMOnly && !game.user.isGM) {
      ui.notifications.warn('Only the Game Master can use GM-only refines.');
      return;
    }
    if (slotIndex === 0 && isAdvanced && !isGMOnly) {
      ui.notifications.warn('Slot 1 only accepts basic refines. Use Slot 2 for advanced refines.');
      return;
    }
    if (isAdvanced && !isGMOnly && await this._isAdvancedRefine(currentRefines[slotIndex === 0 ? 1 : 0])) {
      ui.notifications.warn('Only one advanced refine can be applied to a weapon.');
      return;
    }

    const refines = foundry.utils.deepClone(currentRefines);
    refines[slotIndex] = { id: droppedItem.id, name: droppedItem.name };

    const bonuses = droppedItem.system?.statBonuses ?? {};
    const range = weaponGroup === 'staff'
      ? await this._calculateStaffRange(refines)
      : {
        min: toNumber(details.range?.min) + toNumber(bonuses.minRange),
        max: toNumber(details.range?.max) + toNumber(bonuses.maxRange)
      };

    await this.document.update({
      name: this._generateWeaponName(refines),
      'system.details.refines': refines,
      'system.details.might': toNumber(details.might) + toNumber(bonuses.might),
      'system.details.range': range,
      'system.details.costG': toNumber(details.costG) + toNumber(droppedItem.system?.costG)
    });
  }

  async _onRemoveRefine(event) {
    event.preventDefault();
    event.stopPropagation();

    if (this.document.pack) {
      ui.notifications.warn('Compendium items cannot be modified. Create a copy first.');
      return;
    }

    const slotIndex = Number(event.currentTarget.dataset.slot);
    if (!Number.isInteger(slotIndex)) return;

    const details = this.document.system.details ?? {};
    const refineId = details.refines?.[slotIndex]?.id;
    if (!refineId) {
      ui.notifications.warn('No refine to remove in this slot.');
      return;
    }

    const refineItem = await findRefineById(refineId);
    const bonuses = refineItem?.system?.statBonuses ?? {};

    const refines = foundry.utils.deepClone(details.refines ?? [{}, {}]);
    refines[slotIndex] = { id: '', name: '' };

    const range = this.document.system.attributes?.weaponGroup === 'staff'
      ? await this._calculateStaffRange(refines)
      : {
        min: toNumber(details.range?.min) - toNumber(bonuses.minRange),
        max: toNumber(details.range?.max) - toNumber(bonuses.maxRange)
      };

    await this.document.update({
      name: this._generateWeaponName(refines),
      'system.details.refines': refines,
      'system.details.might': toNumber(details.might) - toNumber(bonuses.might),
      'system.details.range': range,
      'system.details.costG': toNumber(details.costG) - toNumber(refineItem?.system?.costG)
    });
  }

  /* ---------------------------------------- */
  /*  Derivations                              */
  /* ---------------------------------------- */

  /** @returns {Promise<boolean>} Whether the referenced refine is categorised as advanced. */
  async _isAdvancedRefine(refine) {
    if (!refine?.id) return false;
    const refineItem = await findRefineById(refine.id);
    return refineItem?.system?.category === 'advanced';
  }

  /** Staves take the single longest range among their refines rather than summing them. */
  async _calculateStaffRange(refines) {
    let best = { min: 1, max: 1 };
    for (const refine of refines) {
      if (!refine?.id) continue;
      const refineItem = await findRefineById(refine.id);
      if (!refineItem) continue;
      const max = toNumber(refineItem.system?.statBonuses?.maxRange);
      if (max > best.max) best = { min: toNumber(refineItem.system?.statBonuses?.minRange), max };
    }
    return best;
  }

  /**
   * Build the display name as `[Refine 1] [Refine 2] [Weapon Type]`.
   * Staves drop the type suffix once they carry a refine (a Mend staff is just "Mend").
   */
  _generateWeaponName(refines) {
    const weaponGroup = this.document.system.attributes?.weaponGroup ?? '';
    const refineNames = refines.map(refine => refine?.name).filter(Boolean);
    const hasRefines = refineNames.length > 0;

    let weaponType = WEAPON_TYPE_NAMES[weaponGroup];
    if (!weaponType) {
      weaponType = Object.values(WEAPON_TYPE_NAMES).find(name => this.document.name.includes(name)) ?? 'Weapon';
    }
    if (weaponGroup === 'dark' && !hasRefines) weaponType = 'Flux';

    const parts = [...refineNames];
    if (weaponGroup !== 'staff' || !hasRefines) parts.push(weaponType);
    return parts.join(' ');
  }
}
