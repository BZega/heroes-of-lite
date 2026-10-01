import { SYSTEM_ID } from '../constants.ts';
import type { DerivedStats, EquippedWeapon, StatBlock } from '../../types/hol.ts';

/**
 * Actor subclass for Heroes of Lite.
 *
 * Derivation lives in the DataModel's `prepareDerivedData`, so these helpers are
 * read-only conveniences that spare callers from reaching into `system` directly.
 */
export default class HeroesOfLiteActor extends Actor {
  /** Combat stat totals including bonuses, temporary gains and terrain. */
  get totals(): StatBlock {
    return this.system.totals ?? {};
  }

  /** Calculated combat figures. Never edit these. */
  get derived(): DerivedStats {
    return this.system.derived ?? {};
  }

  /** Traits from movement type, equipped weapon and free text. */
  get traits(): string[] {
    return this.system.traits ?? [];
  }

  /** The weapon this unit fights with. */
  get equippedWeapon(): Item | null {
    const id = this.system.inventory?.equipped;
    const item = id ? this.items.get(id) : null;
    return item?.type === 'weapon' ? item : null;
  }

  /** Skills in slot order, with empty slots removed. */
  get skills(): Item[] {
    return ((this.system.skills ?? []) as (string | null)[])
      .map(id => (id ? this.items.get(id) : null))
      .filter((item): item is Item => item?.type === 'skill');
  }

  /** Combat Arts this unit could pay for right now. */
  get affordableCombatArts(): Item[] {
    return this.skills.filter(skill =>
      skill.system.isCombatArt && skill.system.requiredCharge <= this.system.charge);
  }

  /** Hit points remaining. */
  get hp(): number {
    return this.system.resources.hp.value;
  }

  /** Apply damage or healing, clamped to the unit's maximum. */
  async applyDamage(amount: number): Promise<this> {
    const max = this.totals.hp ?? this.system.stats.hp;
    const value = Math.clamp(this.hp - amount, 0, max);
    return this.update({ 'system.resources.hp.value': value });
  }

  /** Spend Charge, refusing if the unit cannot afford it. */
  async spendCharge(cost: number): Promise<boolean> {
    if (cost > this.system.charge) return false;
    await this.update({ 'system.charge': this.system.charge - cost });
    return true;
  }

  /** Seeded documents carry the authored id so references survive re-imports. */
  get sourceId(): string | null {
    return (this.getFlag(SYSTEM_ID, 'sourceId') as string | undefined) ?? null;
  }
}

export type { EquippedWeapon };
