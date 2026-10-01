import { sheetTemplate } from '../constants.js';
import { activateSheetTabs, getDragEventData } from '../helpers.js';
import { buildUnitProfile, terrainChoices, STAT_FLOOR, STAT_LABELS } from '../rules.js';
import { weaponTags } from '../refineIndex.js';

export default class HolActorSheet extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.sheets.ActorSheetV2) {
    static DEFAULT_OPTIONS = {
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
            openEmbeddedItem: this._onOpenEmbeddedItem
        }
    };

    static PARTS = {
        form: {
            template: sheetTemplate("character-sheet.html")
        }
    };

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const actor = this.document;

        context.name = actor.name;
        context.img = actor.img;
        context.type = actor.type;

        // Work against a copy so writes in this method do NOT mutate the live actor.
        const sourceSystem = context.system || actor.system;
        context.system = foundry.utils.deepClone(sourceSystem);

        // Every derived number comes from the shared rules module so the sheet and
        // the combat automation can never disagree.
        const profile = buildUnitProfile(actor, { weaponTags });
        const combatStats = context.system.combatStats || {};
        const bonusStats  = context.system.bonusStats  || {};
        const tempStats   = context.system.tempStats   || {};

        context.profile                 = profile;
        context.system.currentHP        = profile.currentHP;
        context.system.derivedStats     = profile.derived;
        context.system.nonCombatStats   = profile.nonCombatStats;
        context.combatStatTotals        = profile.totals;
        context.traits                  = profile.traits;
        context.isTransformed           = profile.isTransformed;
        context.showGauge               = profile.isShifter;
        context.statusName              = profile.statusKey;
        context.terrainName             = profile.terrainKey;
        context.terrainHpStart          = profile.terrainHpStart;
        context.unallocatedPoints       = profile.unallocatedPoints;
        context.unallocatedCombatPoints = profile.unallocatedCombatPoints;
        context.statCaps                = profile.caps;
        context.terrainOptions          = terrainChoices();

        context.overCapStats = Object.keys(STAT_FLOOR).filter(key =>
            (Number(combatStats[key]) || 0) > (key === 'hp' ? profile.caps.hp : profile.caps.stat));

        context.combatStatRows = Object.entries(STAT_LABELS).map(([key, label]) => ({
            key,
            label,
            total:   profile.totals[key],
            base:    Number(combatStats[key] ?? STAT_FLOOR[key]) || 0,
            temp:    Number(tempStats[key] ?? 0) || 0,
            bonus:   Number(bonusStats[key] ?? 0) || 0,
            min:     STAT_FLOOR[key],
            max:     key === 'hp' ? profile.caps.hp : profile.caps.stat,
            overCap: context.overCapStats.includes(key)
        }));

        // Get inventory items
        const inventory = context.system.inventory || { weapons: [], items: [], equipped: null };
        const weaponIds = Array.from(new Set(inventory.weapons || []));
        const itemIds   = Array.from(new Set(inventory.items   || []));
        context.weaponSlots = [];
        context.itemSlots = [];

        // Get equipped weapon first
        if (inventory.equipped) {
            const equippedWeapon = actor.items.get(inventory.equipped);
            if (equippedWeapon) {
                context.weaponSlots.push({ item: equippedWeapon, equipped: true });
            }
        }

        // Add remaining weapons (skip equipped, skip duplicates)
        const seenWeapons = new Set(inventory.equipped ? [inventory.equipped] : []);
        for (const weaponId of weaponIds) {
            if (seenWeapons.has(weaponId)) continue;
            seenWeapons.add(weaponId);
            const weapon = actor.items.get(weaponId);
            if (weapon && weapon.type === 'weapon') {
                context.weaponSlots.push({ item: weapon, equipped: false });
            }
        }

        // Fill remaining weapon slots
        while (context.weaponSlots.length < 5) {
            context.weaponSlots.push({ item: null, equipped: false });
        }

        // Add items (dedupe by id)
        const seenItems = new Set();
        for (const itemId of itemIds) {
            if (seenItems.has(itemId)) continue;
            seenItems.add(itemId);
            const item = actor.items.get(itemId);
            if (item && (item.type === 'consumable' || item.type === 'item')) {
                context.itemSlots.push({ item: item });
            }
        }

        // Fill remaining item slots
        while (context.itemSlots.length < 4) {
            context.itemSlots.push({ item: null });
        }

        // Get skills
        const skills = context.system.skills || [];
        context.skillSlots = [];
        for (let i = 0; i < 8; i++) {
            if (skills[i]) {
                const skill = actor.items.get(skills[i]);
                context.skillSlots.push({ item: skill });
            } else {
                context.skillSlots.push({ item: null });
            }
        }

        // Get supports
        context.supports = context.system.supports || {};
        context.supportList = Object.entries(context.supports).map(([actorId, level]) => ({
            id: actorId,
            level,
            name: game.actors?.get(actorId)?.name ?? actorId
        }));

        // Calculate HP percentage for battle mode HP bar
        const maxHP = context.combatStatTotals.hp;
        context.hpPercent = maxHP > 0 ? Math.round((context.system.currentHP / maxHP) * 100) : 0;

        return context;
    }

    _onRender(context, options) {
        super._onRender(context, options);
        activateSheetTabs(this);
        this._activateDragDrop();
        this._updateBattleHPBar();
        this._restoreBattleMode();
        this._cleanupDuplicateInventory();
    }

    /**
     * One-shot heal for actors whose inventory arrays accumulated duplicate IDs
     * from the previous (buggy) drop handler. Quietly rewrites the arrays so the
     * underlying data matches what we already render.
     */
    async _cleanupDuplicateInventory() {
        if (this._inventoryCleaned) return;
        this._inventoryCleaned = true;
        const actor = this.document;
        if (!actor?.isOwner) return;
        const inv = actor.system?.inventory;
        if (!inv) return;
        const weapons = Array.from(inv.weapons || []);
        const items   = Array.from(inv.items   || []);
        const dedupWeapons = Array.from(new Set(weapons));
        const dedupItems   = Array.from(new Set(items));
        const update = {};
        if (dedupWeapons.length !== weapons.length) update['system.inventory.weapons'] = dedupWeapons;
        if (dedupItems.length   !== items.length)   update['system.inventory.items']   = dedupItems;
        if (Object.keys(update).length) {
            await actor.update(update, { diff: false });
        }
    }

    /**
     * Update the battle mode HP bar color and width based on current HP percentage
     */
    _updateBattleHPBar() {
        const html = this.element;
        const hpFill = html.querySelector('.battle-hp-fill');
        if (!hpFill) return;
        const percent = parseFloat(hpFill.dataset.hpPercent) || 0;
        hpFill.style.width = Math.min(100, Math.max(0, percent)) + '%';
        if (percent > 50) {
            hpFill.style.backgroundColor = '#27ae60';
        } else if (percent > 25) {
            hpFill.style.backgroundColor = '#f39c12';
        } else {
            hpFill.style.backgroundColor = '#e74c3c';
        }
    }

    /**
     * Restore battle mode state after re-render
     */
    _restoreBattleMode() {
        if (this._battleModeActive) {
            const form = this.element;
            form.classList.add('battle-active');
        }
    }

    _activateDragDrop() {
        const html = this.element;
        
        // Make slots droppable
        const dropZones = html.querySelectorAll('.weapon-slot, .item-slot, .skill-slot, .support-slot');
        dropZones.forEach(zone => {
            zone.addEventListener('dragover', (event) => {
                event.preventDefault();
                zone.classList.add('drag-over');
            });

            zone.addEventListener('dragleave', () => {
                zone.classList.remove('drag-over');
            });

            zone.addEventListener('drop', (event) => {
                event.preventDefault();
                event.stopPropagation();
                zone.classList.remove('drag-over');
                this._onDrop(event);
            });
        });
    }

    async _onDrop(event) {
        // `currentTarget` is nulled out as soon as this handler awaits, so read the
        // slot metadata synchronously before resolving the dropped document.
        const target = event.currentTarget;
        const slotType = target?.dataset.slotType;
        const slotIndex = Number.parseInt(target?.dataset.slotIndex ?? '', 10);

        const data = getDragEventData(event);

        if (data.type === 'Item') {
            const item = await fromUuid(data.uuid);
            if (!item) return;

            if (slotType === 'weapon' && item.type === 'weapon') {
                await this._addWeaponToInventory(item, slotIndex);
            } else if (slotType === 'item' && (item.type === 'consumable' || item.type === 'item')) {
                await this._addItemToInventory(item, slotIndex);
            } else if (slotType === 'skill' && item.type === 'skill') {
                await this._addSkillToActor(item, slotIndex);
            }
        } else if (data.type === 'Actor' && target?.classList.contains('support-slot')) {
            const supportActor = await fromUuid(data.uuid);
            if (supportActor && supportActor.type === 'unit') {
                await this._addSupport(supportActor);
            }
        }
    }

    async _addWeaponToInventory(item, slotIndex) {
        const actor = this.document;
        const inv   = actor.system.inventory || { weapons: [], items: [], equipped: '' };
        const currentWeapons = Array.from(inv.weapons || []);

        // If an embedded copy already exists, just make sure it's tracked once.
        const sourceUuid    = item.uuid || '';
        const existingItem  = actor.items.find(i =>
            i.type === 'weapon' &&
            (i.name === item.name || this.constructor._compendiumSource(i) === sourceUuid)
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
            ...Array.from(actor.system.inventory?.weapons || []),
            created.id
        ]));
        await actor.update({ 'system.inventory.weapons': after });
    }

    async _addItemToInventory(item, slotIndex) {
        const actor = this.document;
        const inv   = actor.system.inventory || { weapons: [], items: [], equipped: '' };
        const currentItems = Array.from(inv.items || []);

        const sourceUuid   = item.uuid || '';
        const existingItem = actor.items.find(i =>
            (i.type === 'consumable' || i.type === 'item') &&
            (i.name === item.name || this.constructor._compendiumSource(i) === sourceUuid)
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
            ...Array.from(actor.system.inventory?.items || []),
            created.id
        ]));
        await actor.update({ 'system.inventory.items': after });
    }

    async _addSkillToActor(item, slotIndex) {
        const actor = this.document;
        const skills = (actor.system.skills || []).slice();

        // Skill data may store its mechanical fields under either
        // `system.details.*` (current template.json layout) or directly
        // under `system.*` (legacy / seed shape). Normalise here.
        const toPrereqArray = (value) => {
            if (Array.isArray(value)) return value;
            return String(value ?? '').split(',').map(p => p.trim()).filter(Boolean);
        };
        const readSkillFields = (sys) => {
            const details = sys?.details || {};
            return {
                typeGroup:      details.typeGroup     ?? sys?.typeGroup     ?? '',
                prerequisite:   toPrereqArray(details.prerequisite ?? sys?.prereq),
                requiredCharge: details.requiredCharge ?? sys?.requiredCharge ?? ''
            };
        };

        const newSkillData   = item.toObject();
        const newFields      = readSkillFields(newSkillData.system);
        const skillSlug = (s) => String(s || '').replace(/^skill\./, '');
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
        const knownSlugs = new Set();
        for (const sId of skills.filter(Boolean)) {
            if (sId === replacingSkillId) continue;
            const it = actor.items.get(sId);
            if (!it) continue;
            knownSlugs.add(skillSlug(
                it.flags?.['heroes-of-lite']?.skillKey
                || it.flags?.['heroes-of-lite']?.sourceId
                || it.name.toLowerCase().replace(/\s+/g, '-')
            ));
        }

        // 3) typeGroup qualification
        const typeGroup = newFields.typeGroup;
        const WEAPON_GROUP_MAP = {
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
                const heritorMap = {
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
            if (WEAPON_GROUP_MAP[typeGroup].includes(weaponProf)) {
                qualifies = true;
            } else {
                qualifyReason = `requires weapon proficiency: ${WEAPON_GROUP_MAP[typeGroup].join(' / ')}`;
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

        for (const raw of newFields.prerequisite || []) {
            const p = String(raw);
            const idx = p.indexOf(':');
            const kind  = idx === -1 ? p : p.slice(0, idx);
            const value = idx === -1 ? '' : p.slice(idx + 1);

            if (kind === 'level') {
                const need = Number(value) || 0;
                if (effectiveLevel < need) {
                    const detail = armorBonus
                        ? `level ${need} (you are level ${level}; Armor counts as ${effectiveLevel})`
                        : `level ${need} (you are level ${level})`;
                    ui.notifications.warn(`${item.name} requires ${detail}.`);
                    return;
                }
            } else if (kind === 'movement') {
                const allowed = value.split('|').filter(Boolean);
                if (!allowed.includes(movementType)) {
                    ui.notifications.warn(`${item.name} requires movement type: ${allowed.join(' or ')} (you are ${movementType || 'unset'}).`);
                    return;
                }
            } else if (kind === 'skill') {
                if (!knownSlugs.has(value)) {
                    ui.notifications.warn(`${item.name} requires the prerequisite skill: ${value.replace(/-/g, ' ')}.`);
                    return;
                }
            } else if (kind === 'weapon') {
                const allowed = value.split('|').filter(Boolean);
                if (!allowed.includes(weaponProf)) {
                    ui.notifications.warn(`${item.name} requires weapon proficiency: ${allowed.join(' or ')}.`);
                    return;
                }
            } else if (kind === 'exclusive') {
                if (knownSlugs.has(value)) {
                    ui.notifications.warn(`${item.name} is exclusive with a skill you already have: ${value.replace(/-/g, ' ')}.`);
                    return;
                }
            } else if (kind === 'trait') {
                if (!traitText.includes(value.toLowerCase())) {
                    ui.notifications.warn(`${item.name} requires the trait: ${value}.`);
                    return;
                }
            } else if (kind === 'requires') {
                if (value === 'combatArt') {
                    const hasArt = actor.items.some(i =>
                        i.type === 'skill' && i.id !== replacingSkillId &&
                        (i.system?.details?.requiredCharge || i.system?.requiredCharge)
                    );
                    if (!hasArt) {
                        ui.notifications.warn(`${item.name} requires at least one Combat Art to be known.`);
                        return;
                    }
                }
            } else if (kind === 'gmOnly' || kind === 'gmApproval') {
                if (!game.user.isGM) {
                    ui.notifications.warn(`${item.name} requires the Game Master to assign it.`);
                    return;
                }
            }
            // unknown prereq kinds are ignored
        }

        // ---- All checks passed: embed and assign ----
        let skillId;
        const existingItem = actor.items.find(i => i.type === 'skill' && i.name === item.name);
        if (existingItem) {
            skillId = existingItem.id;
        } else {
            const created = await actor.createEmbeddedDocuments('Item', [newSkillData]);
            skillId = created[0].id;
        }

        skills[slotIndex] = skillId;
        await actor.update({ 'system.skills': skills });
        ui.notifications.info(`Learned skill: ${item.name}.`);
    }

    async _addSupport(supportActor) {
        const actor = this.document;
        const supports = actor.system.supports || {};
        
        if (!supports[supportActor.id]) {
            supports[supportActor.id] = 'C';
            await actor.update({ 'system.supports': supports });
        }
    }

    /** Resolve where an item was copied from, tolerating the pre-v12 `core.sourceId` flag. */
    static _compendiumSource(item) {
        return item._stats?.compendiumSource ?? item.flags?.core?.sourceId ?? '';
    }

    static async _onIncrementCharge(event, target) {
        const actor = this.document;
        const currentCharge = actor.system.derivedStats?.charge || 0;
        await actor.update({ 'system.derivedStats.charge': currentCharge + 1 });
    }

    static async _onDecrementCharge(event, target) {
        const actor = this.document;
        const currentCharge = actor.system.derivedStats?.charge || 0;
        if (currentCharge > 0) {
            await actor.update({ 'system.derivedStats.charge': currentCharge - 1 });
        }
    }

    static async _onEquipWeapon(event, target) {
        const actor = this.document;
        const weaponId = target.dataset.weaponId;
        await actor.update({ 'system.inventory.equipped': weaponId });
    }

    /**
     * Open the sheet for an embedded item (weapon, consumable, skill) on this actor.
     */
    static _onOpenEmbeddedItem(event, target) {
        event.preventDefault();
        event.stopPropagation();
        const itemId = target.dataset.itemId;
        if (!itemId) return;
        const item = this.document.items.get(itemId);
        if (item) item.sheet.render(true);
    }

    static async _onRemoveItem(event, target) {
        const actor = this.document;
        const itemId = target.dataset.itemId;
        const itemType = target.dataset.itemType;
        if (!itemId) return;

        const inventory = actor.system.inventory || {};

        if (itemType === 'weapon') {
            const weapons = (inventory.weapons || []).filter(id => id !== itemId);
            const update = { 'system.inventory.weapons': weapons };
            if (inventory.equipped === itemId) update['system.inventory.equipped'] = '';
            await actor.update(update);
        } else if (itemType === 'item') {
            const items = (inventory.items || []).filter(id => id !== itemId);
            await actor.update({ 'system.inventory.items': items });
        } else if (itemType === 'skill') {
            const skills = (actor.system.skills || []).map(id => id === itemId ? null : id);
            await actor.update({ 'system.skills': skills });
        } else {
            return;
        }

        if (actor.items.get(itemId)) await actor.deleteEmbeddedDocuments('Item', [itemId]);
    }

    /**
     * Toggle between normal mode and battle mode
     */
    static _onToggleBattleMode(event, target) {
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
