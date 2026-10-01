/**
 * Fire Emblem style combat forecast. Shows both combatants side by side with the
 * numbers that matter, then rolls the whole exchange on confirmation.
 */

import { appTemplate } from '../constants.js';
import { buildUnitProfile } from '../rules.js';
import { weaponTags } from '../refineIndex.js';
import { buildForecast, resolveCombat } from './engine.js';
import { applyCombatResult, diceNeeded, rollDicePool, tokenDistance } from './apply.js';

const percent = value => `${Math.round(value * 100)}%`;

export default class HolCombatForecast extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
) {
  static DEFAULT_OPTIONS = {
    id: 'hol-combat-forecast',
    classes: ['heroes-of-lite', 'hol-sheet', 'combat-forecast'],
    tag: 'div',
    window: { title: 'Combat Forecast', icon: 'fas fa-khanda', resizable: false },
    position: { width: 620, height: 'auto' },
    actions: {
      fight: HolCombatForecast._onFight,
      cancel: HolCombatForecast._onCancel
    }
  };

  static PARTS = {
    body: { template: appTemplate('combat-forecast.html') }
  };

  /**
   * @param {Token} attackerToken
   * @param {Token} defenderToken
   */
  constructor(attackerToken, defenderToken, options = {}) {
    super(options);
    this.attackerToken = attackerToken;
    this.defenderToken = defenderToken;
  }

  /** Open a forecast for the given tokens, validating the pairing first. */
  static async open(attackerToken, defenderToken) {
    if (!attackerToken || !defenderToken) {
      ui.notifications.warn('Select your unit and target an enemy first.');
      return null;
    }
    if (attackerToken.id === defenderToken.id) {
      ui.notifications.warn('A unit cannot attack itself.');
      return null;
    }
    if (!attackerToken.actor?.isOwner) {
      ui.notifications.warn('You do not control that unit.');
      return null;
    }
    const app = new this(attackerToken, defenderToken);
    return app.render({ force: true });
  }

  /** Recompute the forecast from the live documents. */
  computeForecast() {
    const attacker = buildUnitProfile(this.attackerToken.actor, { weaponTags });
    const defender = buildUnitProfile(this.defenderToken.actor, { weaponTags });
    const distance = tokenDistance(this.attackerToken, this.defenderToken);
    return { attacker, defender, distance, forecast: buildForecast({ attacker, defender, distance }) };
  }

  async _prepareContext() {
    const { attacker, defender, distance, forecast } = this.computeForecast();
    this._lastForecast = { attacker, defender, forecast };
    const sideContext = (token, profile, side) => ({
      name: token.name,
      img: token.document?.texture?.src ?? token.actor?.img,
      hp: profile.currentHP,
      maxHp: profile.totals.hp,
      hpPercent: profile.totals.hp > 0 ? Math.round((profile.currentHP / profile.totals.hp) * 100) : 0,
      weapon: side.weaponName,
      canAct: side.canAct,
      damage: side.damage,
      attackCount: side.attackCount,
      hitChance: percent(side.hitChance),
      critChance: percent(side.critChance),
      mode: side.mode,
      triangle: side.triangle,
      effective: side.effective,
      effectiveNegated: side.effectiveNegated,
      staffCounter: side.staffCounter,
      skills: side.activeSkills ?? [],
      // The total swing this side can deal if every strike connects.
      potential: side.damage * side.attackCount
    });

    const weapons = (this.attackerToken.actor.system.inventory?.weapons ?? [])
      .map(id => this.attackerToken.actor.items.get(id))
      .filter(item => item?.type === 'weapon')
      .map(item => ({
        id: item.id,
        name: item.name,
        equipped: item.id === this.attackerToken.actor.system.inventory?.equipped
      }));

    return {
      distance,
      spdDiff: forecast.spdDiff,
      vantage: forecast.vantage,
      desperation: forecast.desperation,
      attacker: sideContext(this.attackerToken, attacker, forecast.attacker),
      defender: sideContext(this.defenderToken, defender, forecast.defender),
      order: forecast.order,
      weapons,
      outOfRange: !forecast.attacker.canAct,
      rangeHint: forecast.attacker.armed
        ? `Range ${forecast.attacker.range.min}-${forecast.attacker.range.max}, target is ${distance} away`
        : 'No weapon equipped'
    };
  }

  /** Swapping weapons re-runs the whole forecast, so listen for `change` not `click`. */
  _onRender(context, options) {
    super._onRender(context, options);
    this.element.querySelector('.forecast-weapon-select')?.addEventListener('change', async event => {
      await this.attackerToken.actor.update({ 'system.inventory.equipped': event.currentTarget.value });
      this.render();
    });
  }

  static async _onCancel() {
    this.close();
  }

  static async _onFight() {
    const { attacker, defender, forecast } = this._lastForecast ?? this.computeForecast();
    if (!forecast.attacker.canAct) {
      ui.notifications.warn('That target is out of range for the equipped weapon.');
      return;
    }

    const state = {
      attacker: { hp: attacker.currentHP, maxHp: attacker.totals.hp },
      defender: { hp: defender.currentHP, maxHp: defender.totals.hp }
    };

    // Roll the whole exchange as one pool so the engine stays synchronous and the
    // dice still land in the chat log.
    const { next, roll } = await rollDicePool(diceNeeded(forecast));
    const result = resolveCombat(forecast, state, next);

    await applyCombatResult({
      attackerToken: this.attackerToken,
      defenderToken: this.defenderToken,
      forecast,
      result,
      roll
    });
    this.close();
  }
}
