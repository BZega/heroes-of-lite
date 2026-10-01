import HolItemSheetBase from './holItemSheetBase.ts';
import { sheetTemplate } from '../constants.ts';
import { findRefineById, getDragEventData, toNumber } from '../helpers.ts';
import { weaponRefines } from '../refineIndex.ts';
import { syncRefineEffects } from '../effects/buffs.ts';
import type { RefineSlot } from '../../types/hol.ts';

const WEAPON_TYPE_NAMES: Record<string, string> = {
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
  static override DEFAULT_OPTIONS = {
    classes: ['weapon-sheet'],
    window: { icon: 'fas fa-khanda' },
    position: { width: 720, height: 620 }
  };

  static override PARTS = {
    form: { template: sheetTemplate('weapon-sheet.html') }
  };

  override async _prepareContext(options: Record<string, unknown>): Promise<Record<string, any>> {
    const context = await super._prepareContext(options);

    context['system'].range ??= { min: 1, max: 1 };
    context['system'].refines ??= [{ id: '', name: '' }, { id: '', name: '' }];

    const innateRefines: { id: string; name: string }[] = [];
    for (const refineId of (context['system'].innateAttributes ?? []) as string[]) {
      const refine = await findRefineById(refineId);
      if (refine) innateRefines.push({ id: refine.id, name: refine.name });
    }
    context['innateRefines'] = innateRefines;

    return context;
  }

  override _onRender(context: Record<string, any>, options: Record<string, unknown>): void {
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

    html.querySelectorAll<HTMLElement>('[data-dropzone="refine"]').forEach(slot => {
      slot.addEventListener('dragover', this._onDragOver.bind(this) as EventListener);
      slot.addEventListener('dragleave', this._onDragLeave.bind(this) as EventListener);
      slot.addEventListener('drop', (event: Event) => { void this._onDropRefine(event as DragEvent); });
    });
    html.querySelectorAll('.remove-refine').forEach(button => {
      button.addEventListener('click', this._onRemoveRefine.bind(this));
    });
  }

  /* ---------------------------------------- */
  /*  Navigation                               */
  /* ---------------------------------------- */

  async _onInnateAttributeClick(event: Event): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget as HTMLElement;
    const refineId = target.dataset['refineId'] ?? '';
    const refine = await findRefineById(refineId);
    if (refine) refine.sheet?.render(true);
    else console.warn('HoL | Could not resolve innate refine:', refineId);
  }

  async _onRefineNameClick(event: Event): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget as HTMLElement;
    const slotIndex = Number(target.closest<HTMLElement>('.refine-slot')?.dataset['slot']);
    if (!Number.isInteger(slotIndex)) return;
    const refine = await findRefineById(this.document.system.refines?.[slotIndex]?.id);
    if (refine) refine.sheet?.render(true);
  }

  /* ---------------------------------------- */
  /*  Refine drag & drop                       */
  /* ---------------------------------------- */

  _onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as HTMLElement).classList.add('drag-over');
  }

  _onDragLeave(event: DragEvent): void {
    (event.currentTarget as HTMLElement).classList.remove('drag-over');
  }

  async _onDropRefine(event: DragEvent): Promise<void> {
    event.preventDefault();
    event.stopPropagation();

    // `currentTarget` is cleared once the handler awaits, so capture it up front.
    const slot = event.currentTarget as HTMLElement;
    slot.classList.remove('drag-over');

    if (this.document.pack) {
      ui.notifications?.warn('Compendium items cannot be modified. Create a copy first.');
      return;
    }

    const slotIndex = Number(slot.dataset['slot']);
    if (!Number.isInteger(slotIndex)) return;

    const dropData = getDragEventData(event);
    if (dropData['type'] !== 'Item') return;

    const droppedItem = await Item.implementation.fromDropData(dropData);
    if (!droppedItem || droppedItem.type !== 'refine') {
      ui.notifications?.warn('Only Refine items can be dropped here.');
      return;
    }

    const details = this.document.system ?? {};
    const currentRefines = details.refines ?? [{}, {}];
    const weaponGroup = this.document.system.weaponGroup ?? '';
    const validGroups = droppedItem.system?.appliesToWeaponGroups ?? [];

    if (validGroups.length && !validGroups.includes(weaponGroup)) {
      ui.notifications.warn(`This refine cannot be applied to ${weaponGroup || 'untyped'} weapons.`);
      return;
    }
    if (currentRefines.some((refine: RefineSlot) => refine?.name && refine.name === droppedItem.name)) {
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
      'system.refines': refines,
      'system.might': toNumber(details.might) + toNumber(bonuses.might),
      'system.range': range,
      'system.costG': toNumber(details.costG) + toNumber(droppedItem.system?.costG)
    });

    await this._refreshWielderBonuses();
  }

  async _onRemoveRefine(event: Event): Promise<void> {
    event.preventDefault();
    event.stopPropagation();

    if (this.document.pack) {
      ui.notifications.warn('Compendium items cannot be modified. Create a copy first.');
      return;
    }

    const slotIndex = Number((event.currentTarget as HTMLElement).dataset['slot']);
    if (!Number.isInteger(slotIndex)) return;

    const details = this.document.system ?? {};
    const refineId = details.refines?.[slotIndex]?.id;
    if (!refineId) {
      ui.notifications.warn('No refine to remove in this slot.');
      return;
    }

    const refineItem = await findRefineById(refineId);
    const bonuses = refineItem?.system?.statBonuses ?? {};

    const refines = foundry.utils.deepClone(details.refines ?? [{}, {}]);
    refines[slotIndex] = { id: '', name: '' };

    const range = this.document.system.weaponGroup === 'staff'
      ? await this._calculateStaffRange(refines)
      : {
        min: toNumber(details.range?.min) - toNumber(bonuses.minRange),
        max: toNumber(details.range?.max) - toNumber(bonuses.maxRange)
      };

    await this.document.update({
      name: this._generateWeaponName(refines),
      'system.refines': refines,
      'system.might': toNumber(details.might) - toNumber(bonuses.might),
      'system.range': range,
      'system.costG': toNumber(details.costG) - toNumber(refineItem?.system?.costG)
    });

    await this._refreshWielderBonuses();
  }

  /** Re-apply the owner's refine bonuses if this weapon is the one they have equipped. */
  async _refreshWielderBonuses() {
    const actor = this.document.actor;
    if (!actor || actor.system?.inventory?.equipped !== this.document.id) return;
    await syncRefineEffects(actor, this.document, weaponRefines(this.document));
  }

  /* ---------------------------------------- */
  /*  Derivations                              */
  /* ---------------------------------------- */

  /** Whether the referenced refine is categorised as advanced. */
  async _isAdvancedRefine(refine: RefineSlot | null | undefined): Promise<boolean> {
    if (!refine?.id) return false;
    const refineItem = await findRefineById(refine.id);
    return refineItem?.system?.category === 'advanced';
  }

  /** Staves take the single longest range among their refines rather than summing them. */
  async _calculateStaffRange(refines: RefineSlot[]): Promise<{ min: number; max: number }> {
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
  _generateWeaponName(refines: RefineSlot[]): string {
    const weaponGroup: string = this.document.system.weaponGroup ?? '';
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
