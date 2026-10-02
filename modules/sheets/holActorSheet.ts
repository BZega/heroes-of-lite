import { sheetTemplate, WEAPON_GROUP_LABELS } from '../constants.ts';
import { activateSheetTabs, getDragEventData } from '../helpers.ts';
import { buildUnitProfile, terrainChoices, STAT_FLOOR, STAT_LABELS } from '../rules.ts';
import {
    checkSkillEligibility, nextSkillLevel, proficiencyAllowance, skillCapForLevel, slugForSkill,
    type SkillCandidate, type SkillContext
} from '../skills.ts';
import { weaponTags, weaponRefines } from '../refineIndex.ts';
import { STATUS_DEFS, STATUS_KEYS, statusEffects, statusFlags, applyStatus, removeStatus } from '../effects/statuses.ts';
import { syncRefineEffects, supportBonusFrom } from '../effects/buffs.ts';
import type { StatBlock, StatKey, StatusKey, SupportRank } from '../../types/hol.ts';

export default class HolActorSheet extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.sheets.ActorSheetV2) {
    private _inventoryCleaned = false;
    private _battleModeActive = false;
    _activeTabId?: string;

    static override DEFAULT_OPTIONS: Record<string, any> = {
        classes: ["heroes-of-lite", "hol-sheet", "actor-sheet", "character-sheet"],
        window: {
            icon: "fas fa-user",
            resizable: true,
            contentClasses: ["standard-form"]
        },
        position: {
            width: 1100,
            height: 920
        },
        form: {
            submitOnChange: true,
            closeOnSubmit: false
        },
        actions: {
            adjustField: this._onAdjustField,
            incrementCharge: this._onIncrementCharge,
            decrementCharge: this._onDecrementCharge,
            equipWeapon: this._onEquipWeapon,
            removeItem: this._onRemoveItem,
            toggleBattleMode: this._onToggleBattleMode,
            openEmbeddedItem: this._onOpenEmbeddedItem,
            toggleStatus: this._onToggleStatus,
            setActiveSupport: this._onSetActiveSupport
        }
    };

    static override PARTS = {
        form: {
            template: sheetTemplate("character-sheet.html")
        }
    };

    override async _prepareContext(options: Record<string, unknown>): Promise<Record<string, any>> {
        const context = await super._prepareContext(options);
        const actor = this.document as Actor;

        context['name'] = actor.name;
        context['img'] = actor.img;
        context['type'] = actor.type;

        // Work against a copy so writes in this method do NOT mutate the live actor.
        const sourceSystem = context['system'] || actor.system;
        const system = foundry.utils.deepClone(sourceSystem);
        context['system'] = system;

        // Derivation already happened in the DataModel; the sheet only presents it.
        const profile = buildUnitProfile(actor, { weaponTags });
        const combatStats: Partial<StatBlock> = system.stats || {};
        const bonusStats: Partial<StatBlock>  = system.bonuses  || {};
        const tempStats: Partial<StatBlock>   = system.temp   || {};

        context['profile']                 = profile;
        context['currentHP']               = profile.currentHP;
        context['derived']                 = profile.derived;
        context['nonCombat']               = profile.nonCombatStats;
        context['combatStatTotals']        = profile.totals;
        context['traits']                  = profile.traits;
        context['isTransformed']           = profile.isTransformed;
        context['showGauge']               = profile.isShifter;
        context['statusList']              = this._statusRows(actor);
        context['statusSummary']           = profile.status.label;
        context['terrainName']             = profile.terrainKey;
        context['terrainHpStart']          = profile.terrainHpStart;
        context['unallocatedPoints']       = profile.unallocatedPoints;
        context['unallocatedCombatPoints'] = profile.unallocatedCombatPoints;
        context['statCaps']                = profile.caps;
        context['terrainOptions']          = terrainChoices();

        const statKeys = Object.keys(STAT_FLOOR) as StatKey[];
        const overCapStats = statKeys.filter(key =>
            (Number(combatStats[key]) || 0) > (key === 'hp' ? profile.caps.hp : profile.caps.stat));
        context['overCapStats'] = overCapStats;

        context['combatStatRows'] = (Object.entries(STAT_LABELS) as [StatKey, string][]).map(([key, label]) => ({
            key,
            label,
            total:   profile.totals[key],
            base:    Number(combatStats[key] ?? STAT_FLOOR[key]) || 0,
            temp:    Number(tempStats[key] ?? 0) || 0,
            bonus:   Number(bonusStats[key] ?? 0) || 0,
            min:     STAT_FLOOR[key],
            max:     key === 'hp' ? profile.caps.hp : profile.caps.stat,
            overCap: overCapStats.includes(key)
        }));

        // Get inventory items
        const inventory = system.inventory || { weapons: [], items: [], equipped: null };
        const weaponIds = Array.from(new Set<string>(inventory.weapons || []));
        const itemIds   = Array.from(new Set<string>(inventory.items   || []));
        const weaponSlots: { item: Item | null; equipped: boolean }[] = [];
        const itemSlots: { item: Item | null }[] = [];
        context['weaponSlots'] = weaponSlots;
        context['itemSlots'] = itemSlots;

        // Get equipped weapon first
        if (inventory.equipped) {
            const equippedWeapon = actor.items.get(inventory.equipped);
            if (equippedWeapon) {
                weaponSlots.push({ item: equippedWeapon, equipped: true });
            }
        }

        // Add remaining weapons (skip equipped, skip duplicates)
        const seenWeapons = new Set<string>(inventory.equipped ? [inventory.equipped] : []);
        for (const weaponId of weaponIds) {
            if (seenWeapons.has(weaponId)) continue;
            seenWeapons.add(weaponId);
            const weapon = actor.items.get(weaponId);
            if (weapon && weapon.type === 'weapon') {
                weaponSlots.push({ item: weapon, equipped: false });
            }
        }

        // Fill remaining weapon slots
        while (weaponSlots.length < 5) {
            weaponSlots.push({ item: null, equipped: false });
        }

        // Add items (dedupe by id)
        const seenItems = new Set<string>();
        for (const itemId of itemIds) {
            if (seenItems.has(itemId)) continue;
            seenItems.add(itemId);
            const item = actor.items.get(itemId);
            if (item && (item.type === 'consumable' || item.type === 'item')) {
                itemSlots.push({ item });
            }
        }

        // Fill remaining item slots
        while (itemSlots.length < 4) {
            itemSlots.push({ item: null });
        }

        // Get skills
        const skills: (string | null)[] = system.skills || [];
        const skillCap = skillCapForLevel(Number(system.level) || 1);
        const skillSlots: { item: Item | null; overCap: boolean; unlockLevel: number; issue: string }[] = [];

        // Only render the slots the level has unlocked, plus any stragglers above the
        // cap so leftover skills stay visible and removable.
        const lastOccupied = skills.reduce((last, id, index) => (id ? index : last), -1);
        const slotCount = Math.min(8, Math.max(skillCap, lastOccupied + 1));

        for (let i = 0; i < slotCount; i++) {
            const id = skills[i];
            const skill = id ? actor.items.get(id) ?? null : null;
            // A skill can stop qualifying after a level, movement or proficiency change.
            const verdict = skill
                ? checkSkillEligibility(skill as SkillCandidate, this._skillContext({ ignoreSkillId: id }))
                : { ok: true as const };
            skillSlots.push({
                item: skill,
                overCap: i >= skillCap,
                // Slot i needs level 5*(i-1), the inverse of the cap formula.
                unlockLevel: Math.max(1, (i - 1) * 5),
                issue: verdict.ok ? '' : `No longer qualifies: it ${verdict.reason}.`
            });
        }
        context['skillSlots'] = skillSlots;
        context['skillCap'] = skillCap;
        context['skillCount'] = skills.filter(Boolean).length;
        context['skillsOverCap'] = skillSlots.some(slot => slot.overCap);
        context['skillIssues'] = skillSlots.some(slot => slot.issue);
        context['nextSkillLevel'] = nextSkillLevel(Number(system.level) || 1);

        // One dropdown per proficiency a skill has granted beyond the starting one.
        const knownSkills = skillSlots.map(slot => slot.item).filter((item): item is Item => !!item);
        const extraAllowed = proficiencyAllowance(knownSkills) - 1;
        const storedExtras = (system.extraProficiencies || []) as string[];
        context['weaponGroupOptions'] = WEAPON_GROUP_LABELS;
        context['extraProficiencySlots'] = Array.from({ length: extraAllowed }, (_unused, index) => ({
            index,
            value: storedExtras[index] ?? ''
        }));

        // Get supports
        const supports: Record<string, SupportRank> = system.supports || {};
        context['supports'] = supports;
        context['isInfantry'] = system.movementType === 'infantry';

        const activeSupportId: string = system.activeSupport || '';
        context['supportList'] = Object.entries(supports).map(([actorId, level]) => {
            const partner = game.actors?.get(actorId) ?? null;
            const bonus = partner ? supportBonusFrom(partner, level) : null;
            return {
                id: actorId,
                level,
                name: partner?.name ?? actorId,
                isActive: actorId === activeSupportId,
                mutual: partner?.system?.activeSupport === actor.id,
                bonusText: bonus
                    ? Object.entries(bonus).map(([key, value]) => `${key.toUpperCase()} +${value}`).join(', ')
                    : 'No bonus line set'
            };
        });

        // Calculate HP percentage for battle mode HP bar
        const maxHP = profile.totals.hp;
        context['hpPercent'] = maxHP > 0 ? Math.round((profile.currentHP / maxHP) * 100) : 0;

        return context;
    }

    override _onRender(context: Record<string, any>, options: Record<string, unknown>): void {
        super._onRender(context, options);
        activateSheetTabs(this);
        this._activateDragDrop();
        this._updateBattleHPBar();
        this._restoreBattleMode();
        this._cleanupDuplicateInventory().catch(error => console.error('HoL | Inventory cleanup failed:', error));
    }

    /**
     * Report a rejected edit instead of letting it surface as an unhandled promise
     * rejection, which left the sheet looking broken with no explanation.
     */
    override _prepareSubmitData(
        event: Event | null,
        form: HTMLFormElement,
        formData: unknown,
        updateData?: Record<string, unknown>
    ): Record<string, any> {
        try {
            return super._prepareSubmitData(event, form, formData, updateData);
        } catch (error) {
            console.error('HoL | Rejected sheet update:', error);
            ui.notifications?.error(`Heroes of Lite: ${error instanceof Error ? error.message : String(error)}`);
            return {};
        }
    }

    /**
     * One-shot heal for actors whose inventory arrays accumulated duplicate IDs
     * from the previous (buggy) drop handler. Quietly rewrites the arrays so the
     * underlying data matches what we already render.
     */
    async _cleanupDuplicateInventory(): Promise<void> {
        if (this._inventoryCleaned) return;
        this._inventoryCleaned = true;
        const actor = this.document as Actor;
        if (!actor?.isOwner) return;
        const inv = actor.system?.inventory;
        if (!inv) return;
        const weapons = Array.from(inv.weapons || []) as string[];
        const items   = Array.from(inv.items   || []) as string[];
        const dedupWeapons = Array.from(new Set(weapons));
        const dedupItems   = Array.from(new Set(items));
        const update: Record<string, unknown> = {};
        if (dedupWeapons.length !== weapons.length) update['system.inventory.weapons'] = dedupWeapons;
        if (dedupItems.length   !== items.length)   update['system.inventory.items']   = dedupItems;
        if (Object.keys(update).length) {
            await actor.update(update, { diff: false });
        }
    }

    /** Update the battle mode HP bar colour and width based on current HP percentage. */
    _updateBattleHPBar(): void {
        const html = this.element;
        const hpFill = html.querySelector<HTMLElement>('.battle-hp-fill');
        if (!hpFill) return;
        const percent = parseFloat(hpFill.dataset['hpPercent'] ?? '') || 0;
        hpFill.style.width = Math.min(100, Math.max(0, percent)) + '%';
        if (percent > 50) {
            hpFill.style.backgroundColor = '#27ae60';
        } else if (percent > 25) {
            hpFill.style.backgroundColor = '#f39c12';
        } else {
            hpFill.style.backgroundColor = '#e74c3c';
        }
    }

    /** Restore battle mode state after re-render. */
    _restoreBattleMode(): void {
        if (this._battleModeActive) {
            this.element.classList.add('battle-active');
        }
    }

    _activateDragDrop(): void {
        const html = this.element;

        // Make slots droppable
        const dropZones = html.querySelectorAll<HTMLElement>('.weapon-slot, .item-slot, .skill-slot, .support-slot');
        dropZones.forEach(zone => {
            zone.addEventListener('dragover', (event: Event) => {
                event.preventDefault();
                zone.classList.add('drag-over');
            });

            zone.addEventListener('dragleave', () => {
                zone.classList.remove('drag-over');
            });

            zone.addEventListener('drop', (event: Event) => {
                event.preventDefault();
                event.stopPropagation();
                zone.classList.remove('drag-over');
                void this._onDrop(event as DragEvent);
            });
        });
    }

    override async _onDrop(event: DragEvent): Promise<void> {
        // `currentTarget` is nulled out as soon as this handler awaits, so read the
        // slot metadata synchronously before resolving the dropped document.
        const target = event.currentTarget as HTMLElement | null;
        const slotType = target?.dataset['slotType'];
        const slotIndex = Number.parseInt(target?.dataset['slotIndex'] ?? '', 10);

        const data = getDragEventData(event);

        if (data['type'] === 'Item') {
            const item = await fromUuid(data['uuid']) as Item | null;
            if (!item) return;

            if (slotType === 'weapon' && item.type === 'weapon') {
                await this._addWeaponToInventory(item, slotIndex);
            } else if (slotType === 'item' && (item.type === 'consumable' || item.type === 'item')) {
                await this._addItemToInventory(item, slotIndex);
            } else if (slotType === 'skill' && item.type === 'skill') {
                await this._addSkillToActor(item, slotIndex);
            }
        } else if (data['type'] === 'Actor' && target?.classList.contains('support-slot')) {
            const supportActor = await fromUuid(data['uuid']) as Actor | null;
            if (supportActor && supportActor.type === 'unit') {
                await this._addSupport(supportActor);
            }
        }
    }

    async _addWeaponToInventory(item: Item, slotIndex: number): Promise<void> {
        const actor = this.document as Actor;
        const inv   = actor.system.inventory || { weapons: [], items: [], equipped: '' };
        const currentWeapons = Array.from(inv.weapons || []) as string[];

        // If an embedded copy already exists, just make sure it's tracked once.
        const sourceUuid    = item.uuid || '';
        const existingItem  = actor.items.find(i =>
            i.type === 'weapon' &&
            (i.name === item.name || i._stats?.compendiumSource === sourceUuid)
        );
        if (existingItem) {
            if (!currentWeapons.includes(existingItem.id)) {
                const next = Array.from(new Set([...currentWeapons, existingItem.id]));
                await actor.update({ 'system.inventory.weapons': next });
            }
            return;
        }

        const [created] = await actor.createEmbeddedDocuments('Item', [item.toObject()]);
        if (!created) return;

        // Re-read inventory in case anything raced; dedupe by id.
        const after = Array.from(new Set([
            ...Array.from(actor.system.inventory?.weapons || []) as string[],
            created.id
        ]));
        await actor.update({ 'system.inventory.weapons': after });
    }

    async _addItemToInventory(item: Item, slotIndex: number): Promise<void> {
        const actor = this.document as Actor;
        const inv   = actor.system.inventory || { weapons: [], items: [], equipped: '' };
        const currentItems = Array.from(inv.items || []) as string[];

        const sourceUuid   = item.uuid || '';
        const existingItem = actor.items.find(i =>
            (i.type === 'consumable' || i.type === 'item') &&
            (i.name === item.name || i._stats?.compendiumSource === sourceUuid)
        );
        if (existingItem) {
            if (!currentItems.includes(existingItem.id)) {
                const next = Array.from(new Set([...currentItems, existingItem.id]));
                await actor.update({ 'system.inventory.items': next });
            }
            return;
        }

        const [created] = await actor.createEmbeddedDocuments('Item', [item.toObject()]);
        if (!created) return;

        const after = Array.from(new Set([
            ...Array.from(actor.system.inventory?.items || []) as string[],
            created.id
        ]));
        await actor.update({ 'system.inventory.items': after });
    }

    async _addSkillToActor(item: Item, slotIndex: number): Promise<void> {
        const actor = this.document as Actor;
        const skills = ((actor.system.skills || []) as (string | null)[]).slice();
        if (!Number.isInteger(slotIndex) || slotIndex < 0) return;

        const level = Number(actor.system.level) || 1;
        const cap = skillCapForLevel(level);
        const replacingSkillId = skills[slotIndex] || null;

        // 1) Slots unlock with level: 2 at L1, one more every 5 levels (rules p.15, p.17).
        if (slotIndex >= cap) {
            const next = nextSkillLevel(level);
            ui.notifications.warn(
                `Slot ${slotIndex + 1} is locked. This unit has ${cap} skill slot(s) at level ${level}`
                + (next ? `; the next unlocks at level ${next}.` : '.')
            );
            return;
        }

        const currentCount = skills.filter(Boolean).length;
        if (!replacingSkillId && currentCount >= cap) {
            ui.notifications.warn(`This unit can only have ${cap} skill(s) at level ${level}.`);
            return;
        }

        // 2) Duplicate check — each skill can only be taken once (rules p.15)
        const dup = actor.items.find(i =>
            i.type === 'skill' &&
            i.name === item.name &&
            i.id !== replacingSkillId
        );
        if (dup) {
            ui.notifications.warn(`${item.name} is already known by this unit. A skill can only be taken once.`);
            return;
        }

        // 3) Group restriction and prerequisites.
        const context = this._skillContext({ ignoreSkillId: replacingSkillId });
        const verdict = checkSkillEligibility(item as SkillCandidate, context);
        if (!verdict.ok) {
            ui.notifications.warn(`Cannot learn ${item.name}: it ${verdict.reason}.`);
            return;
        }

        // ---- All checks passed: embed and assign ----
        let skillId: string;
        const existingItem = actor.items.find(i => i.type === 'skill' && i.name === item.name);
        if (existingItem) {
            skillId = existingItem.id;
        } else {
            const created = await actor.createEmbeddedDocuments('Item', [item.toObject()]);
            const first = created[0];
            if (!first) return;
            skillId = first.id;
        }

        skills[slotIndex] = skillId;
        await actor.update({ 'system.skills': skills });
        ui.notifications.info(`Learned skill: ${item.name}.`);
    }

    /** The unit facts skill eligibility depends on, optionally ignoring one slot. */
    _skillContext({ ignoreSkillId = null }: { ignoreSkillId?: string | null } = {}): SkillContext {
        const actor = this.document as Actor;
        const assigned = (actor.system.skills || []) as (string | null)[];

        const knownSlugs = new Set<string>();
        const known: Item[] = [];
        let hasCombatArt = false;
        for (const id of assigned) {
            if (!id || id === ignoreSkillId) continue;
            const skill = actor.items.get(id);
            if (!skill) continue;
            known.push(skill);
            knownSlugs.add(slugForSkill(skill));
            if (skill.system?.requiredCharge) hasCombatArt = true;
        }

        return {
            level: Number(actor.system.level) || 1,
            movementType: actor.system.movementType || '',
            weaponProficiencies: this._proficiencies(known),
            trait: String(actor.system.trait || ''),
            knownSlugs,
            hasCombatArt,
            isGM: game.user.isGM
        };
    }

    /**
     * Every proficiency in effect. Extras beyond what the unit's skills grant are
     * ignored, so losing Dual Wield immediately revokes the proficiency it gave.
     */
    _proficiencies(knownSkills: Item[]): Set<string> {
        const actor = this.document as Actor;
        const extraAllowed = proficiencyAllowance(knownSkills) - 1;
        const extras = ((actor.system.extraProficiencies || []) as string[]).slice(0, extraAllowed);
        return new Set([actor.system.weaponProficiency || '', ...extras].filter(Boolean));
    }

    async _addSupport(supportActor: Actor): Promise<void> {
        const actor = this.document as Actor;
        const supports: Record<string, SupportRank> = actor.system.supports || {};

        if (!supports[supportActor.id]) {
            supports[supportActor.id] = 'C';
            await actor.update({ 'system.supports': supports });
        }
    }

    /** One row per status, showing who inflicted it and how long it has left. */
    _statusRows(actor: Actor): Record<string, unknown>[] {
        const active = new Map<string, ReturnType<typeof statusFlags>>();
        for (const effect of statusEffects(actor)) {
            const status = statusFlags(effect);
            if (status && !effect.disabled) active.set(status.key, status);
        }

        return STATUS_KEYS.map(key => {
            const status = active.get(key);
            return {
                key,
                label: STATUS_DEFS[key].label,
                img: STATUS_DEFS[key].img,
                description: STATUS_DEFS[key].description,
                active: !!status,
                remaining: status?.remaining ?? 0,
                sourceName: status?.sourceName ?? ''
            };
        });
    }

    static async _onToggleStatus(this: HolActorSheet, event: Event, target: HTMLElement): Promise<void> {
        const actor = this.document as Actor;
        const key = target.dataset['status'];
        if (!key) return;

        if (target.dataset['active'] === 'true') await removeStatus(actor, key as StatusKey);
        else await applyStatus(actor, key, { profile: buildUnitProfile(actor, { weaponTags }) });
    }

    static async _onSetActiveSupport(this: HolActorSheet, event: Event, target: HTMLElement): Promise<void> {
        const actor = this.document as Actor;
        const partnerId = target.dataset['supportId'];
        if (!partnerId) return;

        // Only one support may be active per map, so this replaces any previous choice.
        const next = target.dataset['active'] === 'true' ? '' : partnerId;
        await actor.update({ 'system.activeSupport': next });

        const partner = game.actors?.get(partnerId);
        if (next && partner && partner.system?.activeSupport !== actor.id) {
            ui.notifications.info(`${partner.name} must also set ${actor.name} as their active support for the bonus to apply.`);
        }
    }

    /**
     * Step any numeric field up or down. The button carries the document path plus
     * the bounds to clamp to, so one handler serves every stepper on the sheet.
     */
    static async _onAdjustField(this: HolActorSheet, _event: Event, target: HTMLElement): Promise<void> {
        const field = target.dataset['field'];
        if (!field) return;

        const actor = this.document as Actor;
        const delta = Number(target.dataset['delta']) || 0;
        const min = target.dataset['min'] === undefined ? Number.NEGATIVE_INFINITY : Number(target.dataset['min']);
        const max = target.dataset['max'] === undefined ? Number.POSITIVE_INFINITY : Number(target.dataset['max']);

        const current = Number(foundry.utils.getProperty(actor, field)) || 0;
        const next = Math.min(max, Math.max(min, current + delta));
        if (next === current) return;

        await actor.update({ [field]: next });
    }

    static async _onIncrementCharge(this: HolActorSheet): Promise<void> {
        const actor = this.document as Actor;
        await actor.update({ 'system.charge': (actor.system.charge || 0) + 1 });
    }

    static async _onDecrementCharge(this: HolActorSheet): Promise<void> {
        const actor = this.document as Actor;
        const currentCharge = actor.system.charge || 0;
        if (currentCharge > 0) {
            await actor.update({ 'system.charge': currentCharge - 1 });
        }
    }

    static async _onEquipWeapon(this: HolActorSheet, event: Event, target: HTMLElement): Promise<void> {
        const actor = this.document as Actor;
        const weaponId = target.dataset['weaponId'] ?? '';
        await actor.update({ 'system.inventory.equipped': weaponId });

        // Refines that buff the wielder only apply while the weapon is held.
        const weapon = actor.items.get(weaponId) ?? null;
        await syncRefineEffects(actor, weapon, weapon ? weaponRefines(weapon) : []);
    }

    /** Open the sheet for an embedded item (weapon, consumable, skill) on this actor. */
    static _onOpenEmbeddedItem(this: HolActorSheet, event: Event, target: HTMLElement): void {
        event.preventDefault();
        event.stopPropagation();
        const itemId = target.dataset['itemId'];
        if (!itemId) return;
        const item = (this.document as Actor).items.get(itemId);
        item?.sheet?.render(true);
    }

    static async _onRemoveItem(this: HolActorSheet, event: Event, target: HTMLElement): Promise<void> {
        const actor = this.document as Actor;
        const itemId = target.dataset['itemId'];
        const itemType = target.dataset['itemType'];
        if (!itemId) return;

        const inventory = actor.system.inventory || {};

        if (itemType === 'weapon') {
            const weapons = ((inventory.weapons || []) as string[]).filter(id => id !== itemId);
            const update: Record<string, unknown> = { 'system.inventory.weapons': weapons };
            if (inventory.equipped === itemId) update['system.inventory.equipped'] = '';
            await actor.update(update);
        } else if (itemType === 'item') {
            const items = ((inventory.items || []) as string[]).filter(id => id !== itemId);
            await actor.update({ 'system.inventory.items': items });
        } else if (itemType === 'skill') {
            const skills = ((actor.system.skills || []) as (string | null)[]).map(id => id === itemId ? null : id);
            await actor.update({ 'system.skills': skills });
        } else {
            return;
        }

        if (actor.items.get(itemId)) await actor.deleteEmbeddedDocuments('Item', [itemId]);
    }

    /** Toggle between normal mode and battle mode. */
    static _onToggleBattleMode(this: HolActorSheet): void {
        const form = this.element;
        const isActive = form.classList.toggle('battle-active');
        this._battleModeActive = isActive;
        const btn = form.querySelector('.battle-toggle');
        if (btn) {
            btn.innerHTML = isActive
                ? '<i class="fas fa-scroll"></i> Normal Mode'
                : '<i class="fas fa-khanda"></i> Battle Mode';
        }
    }
}
