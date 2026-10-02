import { SYSTEM_ID } from '../constants.ts';
import { weaponTags } from '../refineIndex.ts';
import { inferWeaponGroup, MAGICAL_WEAPON_GROUPS } from '../data/common.ts';

/** Item subclass for Heroes of Lite. */
export default class HeroesOfLiteItem extends Item {
  /**
   * A weapon created without a group has no Weapon Triangle, no refine
   * eligibility and no effectiveness, so guess it from the name instead of
   * leaving the item inert. An explicit group always wins.
   */
  override async _preCreate(data: Record<string, any>, options: Record<string, unknown>, user: unknown): Promise<boolean | void> {
    const result = await super._preCreate(data, options, user);
    if (result === false) return false;
    if (data.type !== 'weapon' || data.system?.weaponGroup) return;

    const group = inferWeaponGroup(String(data.name ?? ''));
    if (!group) return;

    const update: Record<string, unknown> = { 'system.weaponGroup': group };
    if (!data.system?.damageType) {
      update['system.damageType'] = MAGICAL_WEAPON_GROUPS.has(group) ? 'magical' : 'physical';
    }
    this.updateSource(update);
  }

  /** Refine tags in effect, innate attributes included. */
  get tags(): Set<string> {
    if (this.type === 'weapon') return weaponTags(this);
    return new Set<string>(this.system.tags ?? []);
  }

  /** Whether this skill costs Charge to activate. */
  get isCombatArt(): boolean {
    return this.type === 'skill' && this.system.isCombatArt;
  }

  /** The authored seed id, when this came from a compendium. */
  get sourceId(): string | null {
    return (this.getFlag(SYSTEM_ID, 'sourceId') as string | undefined) ?? null;
  }

  /** Slug that skill prerequisites reference. */
  get skillKey(): string {
    const flagged = (this.getFlag(SYSTEM_ID, 'skillKey') as string | undefined) ?? this.sourceId;
    const raw = flagged ?? this.name.toLowerCase().replace(/\s+/g, '-');
    return String(raw).replace(/^skill\./, '');
  }
}
