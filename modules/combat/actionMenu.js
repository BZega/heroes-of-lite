/**
 * The per-unit action picker. One window, one click per decision: pick an action,
 * the system works out whether it is legal and rolls whatever it needs.
 */

import { appTemplate } from '../constants.js';
import { buildUnitProfile } from '../rules.js';
import { weaponTags } from '../refineIndex.js';
import HolCombatForecast from './forecast.js';
import { tokenDistance } from './apply.js';
import { useConsumable, useStaffEffect, toggleTransform, rescueTarget, waitAction } from './actions.js';

export default class HolActionMenu extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
) {
  static DEFAULT_OPTIONS = {
    id: 'hol-action-menu',
    classes: ['heroes-of-lite', 'hol-sheet', 'action-menu'],
    tag: 'div',
    window: { title: 'Actions', icon: 'fas fa-bolt', resizable: false },
    position: { width: 420, height: 'auto' },
    actions: {
      attack: HolActionMenu._onAttack,
      useItem: HolActionMenu._onUseItem,
      staffEffect: HolActionMenu._onStaffEffect,
      transform: HolActionMenu._onTransform,
      rescue: HolActionMenu._onRescue,
      wait: HolActionMenu._onWait,
      openSheet: HolActionMenu._onOpenSheet
    }
  };

  static PARTS = {
    body: { template: appTemplate('action-menu.html') }
  };

  constructor(token, options = {}) {
    super(options);
    this.token = token;
  }

  /** Open for the controlled token, or the user's own character. */
  static async open(token = null) {
    const resolved = token
      ?? canvas?.tokens?.controlled?.[0]
      ?? game.user.character?.getActiveTokens()?.[0];

    if (!resolved) {
      ui.notifications.warn('Select one of your tokens first.');
      return null;
    }
    if (!resolved.actor?.isOwner) {
      ui.notifications.warn('You do not control that unit.');
      return null;
    }
    return new this(resolved).render({ force: true });
  }

  /** The single targeted token, if exactly one is targeted. */
  get target() {
    const targets = Array.from(game.user.targets);
    return targets.length === 1 ? targets[0] : null;
  }

  async _prepareContext() {
    const actor = this.token.actor;
    const profile = buildUnitProfile(actor, { weaponTags });
    const target = this.target;
    const distance = target ? tokenDistance(this.token, target) : null;

    const weapon = profile.equipped;
    const inRange = weapon && distance !== null
      && distance >= weapon.range.min && distance <= weapon.range.max;

    const consumables = (actor.system.inventory?.items ?? [])
      .map(id => actor.items.get(id))
      .filter(item => item?.type === 'consumable')
      .map(item => ({
        id: item.id,
        name: item.name,
        uses: item.system?.details?.uses ?? 0,
        spent: (item.system?.details?.uses ?? 0) <= 0
      }));

    const isStaffUser = weapon?.group === 'staff';

    return {
      name: this.token.name,
      img: this.token.document?.texture?.src ?? actor.img,
      hp: profile.currentHP,
      maxHp: profile.totals.hp,
      hpPercent: profile.totals.hp > 0 ? Math.round((profile.currentHP / profile.totals.hp) * 100) : 0,
      status: profile.status.label,
      terrain: profile.terrain.label,
      charge: profile.derived.charge,
      move: profile.derived.move,
      weaponName: weapon?.name ?? 'None',
      traits: profile.traits,
      targetName: target?.name ?? null,
      distance,
      consumables,
      isShifter: profile.isShifter,
      isTransformed: profile.isTransformed,
      isStaffUser,
      canAttack: !!weapon && !!target && inRange && (weapon.group !== 'staff' || profile.skills.has('wrathful-staff')),
      canRescue: !!target && profile.derived.aid > (buildUnitProfile(target.actor ?? {}, { weaponTags }).derived.con ?? 99),
      attackHint: !weapon ? 'No weapon equipped'
        : !target ? 'Target an enemy to attack'
        : !inRange ? `Out of range (${distance} away, weapon reaches ${weapon.range.min}-${weapon.range.max})`
        : weapon.group === 'staff' && !profile.skills.has('wrathful-staff') ? 'Staves cannot initiate combat'
        : `${distance} tile${distance === 1 ? '' : 's'} away`
    };
  }

  static async _onAttack() {
    const target = this.target;
    if (!target) {
      ui.notifications.warn('Target an enemy first (click the target icon on their token).');
      return;
    }
    await HolCombatForecast.open(this.token, target);
    this.close();
  }

  static async _onUseItem(event, element) {
    const itemId = element.dataset.itemId;
    await useConsumable(this.token, itemId, this.target ?? this.token);
    this.render();
  }

  static async _onStaffEffect() {
    await useStaffEffect(this.token, this.target);
    this.render();
  }

  static async _onTransform() {
    await toggleTransform(this.token);
    this.render();
  }

  static async _onRescue() {
    await rescueTarget(this.token, this.target);
    this.render();
  }

  static async _onWait() {
    await waitAction(this.token);
    this.close();
  }

  static _onOpenSheet() {
    this.token.actor?.sheet?.render(true);
  }

  /** Keep the menu in step with the user's current target selection. */
  _onRender(context, options) {
    super._onRender(context, options);
    if (this._targetHook) return;
    this._targetHook = Hooks.on('targetToken', () => this.render());
  }

  _onClose(options) {
    if (this._targetHook) Hooks.off('targetToken', this._targetHook);
    this._targetHook = null;
    super._onClose(options);
  }
}
