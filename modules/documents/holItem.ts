import { SYSTEM_ID } from '../constants.ts';
import { weaponTags } from '../refineIndex.ts';

/** Item subclass for Heroes of Lite. */
export default class HeroesOfLiteItem extends Item {
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
