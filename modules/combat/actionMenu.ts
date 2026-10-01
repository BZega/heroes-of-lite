/**
 * The per-unit action picker. One window, one click per decision: pick an action,
 * the system works out whether it is legal and rolls whatever it needs.
 */

import { appTemplate } from '../constants.ts';
import { buildUnitProfile, terrainMoveCost } from '../rules.ts';
import { weaponTags } from '../refineIndex.ts';
import HolCombatForecast from './forecast.ts';
import { tokenDistance } from './apply.ts';
import { useConsumable, useStaffEffect, toggleTransform, rescueTarget, waitAction } from './actions.ts';

export default class HolActionMenu extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
) {
  declare token: Token;
  private _targetHook: number | null = null;

  static override DEFAULT_OPTIONS = {
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

  static override PARTS = {
    body: { template: appTemplate('action-menu.html') }
  };

  constructor(token: Token, options: Record<string, unknown> = {}) {
    super(options);
    this.token = token;
  }

  /** Open for the controlled token, or the user's own character. */
  static async open(token: Token | null = null): Promise<HolActionMenu | null> {
    const resolved = token
      ?? canvas?.tokens?.controlled?.[0]
      ?? game.user.character?.getActiveTokens()?.[0];

    if (!resolved) {
      ui.notifications?.warn('Select one of your tokens first.');
      return null;
    }
    if (!resolved.actor?.isOwner) {
      ui.notifications?.warn('You do not control that unit.');
      return null;
    }
    return new this(resolved).render({ force: true }) as Promise<HolActionMenu>;
  }

  /** The single targeted token, if exactly one is targeted. */
  get target(): Token | null {
    const targets = Array.from(game.user.targets);
    return targets.length === 1 ? targets[0]! : null;
  }

  override async _prepareContext(): Promise<Record<string, any>> {
    const actor = this.token.actor!;
    const profile = buildUnitProfile(actor, { weaponTags });
    const target = this.target;
    const distance = target ? tokenDistance(this.token, target) : null;

    const weapon = profile.equipped;
    const inRange = !!weapon && distance !== null
      && distance >= weapon.range.min && distance <= weapon.range.max;

    const consumables = ((actor.system.inventory?.items ?? []) as string[])
      .map(id => actor.items.get(id))
      .filter((item): item is Item => item?.type === 'consumable')
      .map(item => ({
        id: item.id,
        name: item.name,
        uses: item.system?.uses ?? 0,
        spent: (item.system?.uses ?? 0) <= 0
      }));

    const isStaffUser = weapon?.group === 'staff';
    const footing = terrainMoveCost(profile.terrainKey, profile);
    const targetCon = target?.actor ? buildUnitProfile(target.actor, { weaponTags }).derived.con : null;

    return {
      name: this.token.name,
      img: this.token.document?.texture?.src ?? actor.img,
      hp: profile.currentHP,
      maxHp: profile.totals.hp,
      hpPercent: profile.totals.hp > 0 ? Math.round((profile.currentHP / profile.totals.hp) * 100) : 0,
      status: profile.status.label,
      terrain: profile.terrain.label,
      terrainCost: footing.cost,
      terrainRule: footing.rule,
      terrainNote: footing.note,
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
      canRescue: targetCon !== null && profile.derived.aid > targetCon,
      attackHint: !weapon ? 'No weapon equipped'
        : !target ? 'Target an enemy to attack'
        : !inRange ? `Out of range (${distance} away, weapon reaches ${weapon.range.min}-${weapon.range.max})`
        : weapon.group === 'staff' && !profile.skills.has('wrathful-staff') ? 'Staves cannot initiate combat'
        : `${distance} tile${distance === 1 ? '' : 's'} away`
    };
  }

  static async _onAttack(this: HolActionMenu): Promise<void> {
    const target = this.target;
    if (!target) {
      ui.notifications?.warn('Target an enemy first (click the target icon on their token).');
      return;
    }
    await HolCombatForecast.open(this.token, target);
    await this.close();
  }

  static async _onUseItem(this: HolActionMenu, event: Event, element: HTMLElement): Promise<void> {
    const itemId = element.dataset['itemId'] ?? '';
    await useConsumable(this.token, itemId, this.target ?? this.token);
    void this.render();
  }

  static async _onStaffEffect(this: HolActionMenu): Promise<void> {
    await useStaffEffect(this.token, this.target);
    void this.render();
  }

  static async _onTransform(this: HolActionMenu): Promise<void> {
    await toggleTransform(this.token);
    void this.render();
  }

  static async _onRescue(this: HolActionMenu): Promise<void> {
    await rescueTarget(this.token, this.target);
    void this.render();
  }

  static async _onWait(this: HolActionMenu): Promise<void> {
    await waitAction(this.token);
    await this.close();
  }

  static _onOpenSheet(this: HolActionMenu): void {
    this.token.actor?.sheet?.render(true);
  }

  /** Keep the menu in step with the user's current target selection. */
  override _onRender(context: Record<string, any>, options: Record<string, unknown>): void {
    super._onRender(context, options);
    if (this._targetHook) return;
    this._targetHook = Hooks.on('targetToken', () => this.render());
  }

  override _onClose(options: Record<string, unknown>): void {
    if (this._targetHook) Hooks.off('targetToken', this._targetHook);
    this._targetHook = null;
    super._onClose(options);
  }
}
