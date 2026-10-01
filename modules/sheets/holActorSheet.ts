import { sheetTemplate } from '../constants.ts';
import { activateSheetTabs, getDragEventData } from '../helpers.ts';
import { buildUnitProfile, terrainChoices, STAT_FLOOR, STAT_LABELS } from '../rules.ts';
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
        const skillSlots: { item: Item | null }[] = [];
        for (let i = 0; i < 8; i++) {
            const id = skills[i];
            skillSlots.push({ item: id ? actor.items.get(id) ?? null : null });
        }
        context['skillSlots'] = skillSlots;

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
        void this._cleanupDuplicateInventory();
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

        // Skill mechanical fields live flat on `system.*` under the V14 DataModel.
        const toPrereqArray = (value: unknown): string[] => {
            if (Array.isArray(value)) return value;
            return String(value ?? '').split(',').map(p => p.trim()).filter(Boolean);
        };
        const readSkillFields = (sys: Record<string, any> | undefined) => ({
            typeGroup:      sys?.['typeGroup'] ?? '',
            prerequisite:   toPrereqArray(sys?.['prerequisite']),
            requiredCharge: sys?.['requiredCharge'] ?? 0
        });

        const newSkillData   = item.toObject();
        const newFields      = readSkillFields(newSkillData['system']);
        const skillSlug = (s: unknown): string => String(s || '').replace(/^skill\./, '');
        // The random document `_id` is never a prerequisite key, so prefer the
        // authored skill key and only fall back to a slug of the name.
        const newSlug = skillSlug(
            item.flags?.['heroes-of-lite']?.skillKey
            || item.flags?.['heroes-of-lite']?.sourceId
            || (item.name || '').toLowerCase().replace(/\s+/g, '-')
        );

        const level        = Number(actor.system.level) || 1;
        const movementType = actor.system.movementType || '';
        const weaponProf   = actor.system.weaponProficiency || '';
        const traitText    = String(actor.system.trait || '').toLowerCase();

        // 1) Skill cap: 2 at L1, +1 every 5 levels, max 8 (rules p.15)
        const cap = Math.min(2 + Math.floor(level / 5), 8);
        const currentCount  = skills.filter(Boolean).length;
        const replacingSkillId = skills[slotIndex] || null;
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

        // Collect currently-known skill slugs (excluding the slot we're replacing)
        const knownSlugs = new Set<string>();
        for (const sId of skills.filter((id): id is string => !!id)) {
            if (sId === replacingSkillId) continue;
            const it = actor.items.get(sId);
            if (!it) continue;
            knownSlugs.add(skillSlug(
                it.flags?.['heroes-of-lite']?.['skillKey']
                || it.flags?.['heroes-of-lite']?.['sourceId']
                || it.name.toLowerCase().replace(/\s+/g, '-')
            ));
        }

        // 3) typeGroup qualification
        const typeGroup: string = newFields.typeGroup;
        const WEAPON_GROUP_MAP: Record<string, string[]> = {
            'sword, lance, and axe':      ['sword', 'lance', 'axe'],
            'dagger and bow':             ['dagger', 'bow'],
            'anima, light, and dark':     ['anima', 'light', 'dark'],
            'staff':                      ['staff'],
            'strike, talons, and breath': ['strike', 'talons', 'breath'],
            'shifting stone':             ['shiftingStone']
        };
        const MOVE_GROUPS = ['infantry', 'cavalry', 'flier', 'armor'];
        const levelPrereqRaw = (newFields.prerequisite || []).find(p => String(p).startsWith('level:'));
        const skillLevelReq  = levelPrereqRaw ? (Number(String(levelPrereqRaw).split(':')[1]) || 0) : 0;

        let qualifies = false;
        let qualifyReason = '';

        if (typeGroup === 'all-access' || typeGroup === 'combat' || !typeGroup) {
            qualifies = true;
        } else if (typeGroup === 'fiend') {
            // Fiend skills need the Monstrous skill or a Curse proficiency (rules p.37).
            qualifies = traitText.includes('fiend') || weaponProf === 'curse' || knownSlugs.has('monstrous');
            qualifyReason = 'requires the Monstrous skill, a Curse proficiency, or the Fiendish trait';
        } else if (MOVE_GROUPS.includes(typeGroup)) {
            if (movementType === typeGroup) {
                qualifies = true;
            } else {
                const heritorMap: Record<string, string> = {
                    'flier':   'heritor-of-feathers',
                    'cavalry': 'heritor-of-furs',
                    'armor':   'heritor-of-scales'
                };
                const requiredHeritor = heritorMap[typeGroup];
                if (requiredHeritor && knownSlugs.has(requiredHeritor) && newSlug !== 'canter' && skillLevelReq <= 10) {
                    qualifies = true;
                } else {
                    qualifyReason = `requires ${typeGroup} movement type`;
                }
            }
        } else if (WEAPON_GROUP_MAP[typeGroup]) {
            const allowed = WEAPON_GROUP_MAP[typeGroup]!;
            if (allowed.includes(weaponProf)) {
                qualifies = true;
            } else {
                qualifyReason = `requires weapon proficiency: ${allowed.join(' / ')}`;
            }
        } else {
            qualifies = true;
        }

        if (!qualifies) {
            ui.notifications.warn(`Cannot learn ${item.name}: ${qualifyReason}.`);
            return;
        }

        // 4) Itemised prereq parsing.
        //    Armored units gain access to all skills 5 levels earlier (rules p.12).
        const armorBonus     = movementType === 'armor' ? 5 : 0;
        const effectiveLevel = level + armorBonus;

        /**
         * A prerequisite is a set of `kind:value` clauses joined by `|`, any one of
         * which satisfies it. A clause without its own kind inherits the previous one,
         * so `weapon:sword|lance` and `skill:monstrous|weapon:curse` both parse.
         */
        const parseAlternatives = (raw: unknown): { kind: string; value: string }[] => {
            const alternatives: { kind: string; value: string }[] = [];
            let kind = '';
            for (const segment of String(raw).split('|')) {
                const idx = segment.indexOf(':');
                if (idx !== -1) {
                    kind = segment.slice(0, idx);
                    alternatives.push({ kind, value: segment.slice(idx + 1) });
                } else if (kind) {
                    alternatives.push({ kind, value: segment });
                } else {
                    // A valueless prerequisite such as `gmOnly` is the kind itself.
                    alternatives.push({ kind: segment, value: '' });
                }
            }
            return alternatives;
        };

        /** @returns True when satisfied, otherwise a human readable reason. */
        const checkClause = ({ kind, value }: { kind: string; value: string }): true | string => {
            switch (kind) {
                case 'level': {
                    const need = Number(value) || 0;
                    if (effectiveLevel >= need) return true;
                    return armorBonus
                        ? `level ${need} (you are level ${level}; Armor counts as ${effectiveLevel})`
                        : `level ${need} (you are level ${level})`;
                }
                case 'movement':
                    return movementType === value || `movement type ${value}`;
                case 'skill':
                    return knownSlugs.has(value) || `the skill ${value.replace(/-/g, ' ')}`;
                case 'weapon':
                    return weaponProf === value || `weapon proficiency ${value}`;
                case 'trait':
                    return traitText.includes(value.toLowerCase()) || `the trait ${value}`;
                case 'exclusive':
                    return !knownSlugs.has(value) || `you already have the exclusive skill ${value.replace(/-/g, ' ')}`;
                case 'requires':
                    if (value !== 'combatArt') return true;
                    return actor.items.some(i =>
                        i.type === 'skill' && i.id !== replacingSkillId && i.system?.requiredCharge
                    ) || 'at least one Combat Art';
                case 'gmOnly':
                case 'gmApproval':
                    return game.user.isGM || 'the Game Master to assign it';
                default:
                    // Unmodelled prerequisite kinds are not enforced.
                    return true;
            }
        };

        for (const raw of newFields.prerequisite || []) {
            const alternatives = parseAlternatives(raw);
            const reasons = [];
            let satisfied = false;

            for (const clause of alternatives) {
                const outcome = checkClause(clause);
                if (outcome === true) { satisfied = true; break; }
                reasons.push(outcome);
            }

            if (!satisfied) {
                ui.notifications.warn(`${item.name} requires ${reasons.join(' or ')}.`);
                return;
            }
        }

        // ---- All checks passed: embed and assign ----
        let skillId: string;
        const existingItem = actor.items.find(i => i.type === 'skill' && i.name === item.name);
        if (existingItem) {
            skillId = existingItem.id;
        } else {
            const created = await actor.createEmbeddedDocuments('Item', [newSkillData]);
            const first = created[0];
            if (!first) return;
            skillId = first.id;
        }

        skills[slotIndex] = skillId;
        await actor.update({ 'system.skills': skills });
        ui.notifications.info(`Learned skill: ${item.name}.`);
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
