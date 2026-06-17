export default class HolActorSheet extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.sheets.ActorSheetV2) {
    static DEFAULT_OPTIONS = {
        classes: ["heroes-of-lite", "actor-sheet", "character-sheet"],
        window: {
            icon: "fas fa-user",
            resizable: true,
            contentClasses: ["standard-form"]
        },
        position: {
            width: 1100,
            height: 820
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
            template: "systems/heroes-of-lite/templates/sheets/character-sheet.html"
        }
    };

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const actor = this.document;

        context.name = actor.name;
        context.img = actor.img;
        context.type = actor.type;
        
        if (!context.system) {
            context.system = actor.system;
        }

        // Calculate derived stats
        const combatStats = context.system.combatStats || {};
        const derivedStats = context.system.derivedStats || {};
        
        // Ensure current HP exists
        if (context.system.currentHP === undefined) {
            context.system.currentHP = combatStats.hp || 15;
        }

        // ---- Rules-driven derivations (Heroes of Lite 4.0.3) ----
        const bonusStats = context.system.bonusStats || {};
        const tempStats  = context.system.tempStats  || {};
        const bonuses    = context.system.bonuses    || {};
        const nonCombat  = context.system.nonCombatStats || {};
        const inventory  = context.system.inventory || { equipped: '' };
        const movementType = context.system.movementType || 'infantry';
        const sizeCategory = context.system.size || 'medium';
        const statusName   = context.system.status || 'healthy';
        const terrainName  = context.system.terrain || '';

        // Status modifiers (rules p.28)
        // Injured: -3 atk/spd/def/res (cannot be healed by anything)
        // Shocked: Avoid = 0, CritAvoid = 15 (handled below)
        const isInjured = statusName === 'injured';
        const isShocked = statusName === 'shocked';
        const injuredMod = isInjured ? -3 : 0;

        const sumStat = (key, baseDefault, extra = 0) => {
            const base  = Number(combatStats[key] ?? baseDefault) || 0;
            const bonus = Number(bonusStats[key] ?? 0) || 0;
            const temp  = Number(tempStats[key]  ?? 0) || 0;
            return base + bonus + temp + extra;
        };

        context.combatStatTotals = {
            hp:   sumStat('hp', 15),
            atk:  sumStat('atk',  3, injuredMod),
            spd:  sumStat('spd',  3, injuredMod),
            dex:  sumStat('dex',  3),
            def:  sumStat('def',  3, injuredMod),
            res:  sumStat('res',  3, injuredMod),
            luck: sumStat('luck', 3)
        };

        // Movement type table
        const movementInfo = {
            infantry: { move: 5, baseAid: 2 },
            cavalry:  { move: 7, baseAid: 4 },
            flier:    { move: 6, baseAid: 4 },
            armor:    { move: 4, baseAid: 2 }
        }[movementType] || { move: 5, baseAid: 2 };

        // Size category → numeric size
        const sizeNumber = { small: 1, medium: 2, large: 3, extraLarge: 4 }[sizeCategory] || 2;

        // Terrain bonuses (rules p.27). Fliers ignore terrain bonuses and penalties.
        const terrainTable = {
            plain:    { avoid: 0, def: 0, hpStart: 0 },
            forest:   { avoid: 2, def: 1, hpStart: 0 },
            mountain: { avoid: 3, def: 3, hpStart: 0 },
            fort:     { avoid: 2, def: 0, hpStart: 3 },
            water:    { avoid: 4, def: 2, hpStart: 0 },
            desert:   { avoid: 0, def: 0, hpStart: 0 },
            bridge:   { avoid: 0, def: 0, hpStart: 0 },
            throne:   { avoid: 2, def: 0, hpStart: 3 },
            '':       { avoid: 0, def: 0, hpStart: 0 }
        };
        const terrainMod = terrainTable[terrainName] || terrainTable[''];
        const ignoresTerrain = movementType === 'flier';
        const terrainAvoid = ignoresTerrain ? 0 : terrainMod.avoid;
        const terrainDef   = ignoresTerrain ? 0 : terrainMod.def;
        // Add terrain Def into the displayed Def total
        context.combatStatTotals.def += terrainDef;

        // Equipped weapon for Power/Tri
        let weaponMight = 0;
        const equippedId = inventory.equipped;
        if (equippedId) {
            const eq = this.document.items.get(equippedId);
            if (eq && eq.type === 'weapon') {
                weaponMight = Number(eq.system?.details?.might ?? 0) || 0;
            }
        }

        // Hit / Avoid / CritAvoid / Power / Tri
        const dex  = context.combatStatTotals.dex;
        const luck = context.combatStatTotals.luck;
        const atk  = context.combatStatTotals.atk;

        const hitBase   = Math.floor(dex  / 4) + (Number(bonuses.hit)   || 0);
        const avoidBase = isShocked ? 0 : (Math.floor(luck / 4) + 4 + terrainAvoid + (Number(bonuses.avoid) || 0));
        const power     = atk + weaponMight + (Number(bonuses.power) || 0);
        const tri       = Math.floor(power / 5) + (Number(bonuses.tri) || 0);
        const critAvoid = isShocked ? 15 : (avoidBase + 15);

        // Size / Con / Aid / Move (rules p.13)
        const con = sizeNumber + (movementType === 'armor' ? 2 : 0);
        const strength = Number(nonCombat.strength ?? 0) || 0;
        const aid = strength + movementInfo.baseAid;
        const move = movementInfo.move;

        // Overwrite derivedStats on context so the template renders them
        // (we do NOT persist these — they are recomputed on every render).
        context.system.derivedStats = {
            ...derivedStats,
            hit:    hitBase,
            avoid:  avoidBase,
            crit:   Number(derivedStats.crit) || 0,
            critAvoid: critAvoid,
            power:  power,
            tri:    tri,
            size:   sizeNumber,
            con:    con,
            aid:    aid,
            move:   move,
            charge: Number(derivedStats.charge) || 0,
            gauge:  Number(derivedStats.gauge)  || 0
        };

        // Auto-derived non-combat stats from rules (display-only)
        context.system.nonCombatStats = {
            ...nonCombat,
            fate:       Math.min(3, Math.floor(luck / 5)),
            finesse:    Math.min(3, Math.floor(dex  / 5)),
            acrobatics: Math.min(3, Math.floor(context.combatStatTotals.spd / 5))
        };

        // Optional warnings exposed to template (not yet rendered, but available)
        context.statusName  = statusName;
        context.terrainName = terrainName;
        context.terrainHpStart = ignoresTerrain ? 0 : terrainMod.hpStart;

        // Calculate unallocated non-combat stat points
        const nonCombatStats = context.system.nonCombatStats || {};
        const totalAllocated = Object.values(nonCombatStats).reduce((sum, val) => sum + (val || 0), 0);
        context.unallocatedPoints = 12 - totalAllocated;

        // Get inventory items
        const inventory = context.system.inventory || { weapons: [], items: [], equipped: null };
        context.weaponSlots = [];
        context.itemSlots = [];

        // Get equipped weapon first
        if (inventory.equipped) {
            const equippedWeapon = actor.items.get(inventory.equipped);
            if (equippedWeapon) {
                context.weaponSlots.push({ item: equippedWeapon, equipped: true });
            }
        }

        // Add remaining weapons
        for (const weaponId of inventory.weapons || []) {
            if (weaponId !== inventory.equipped) {
                const weapon = actor.items.get(weaponId);
                if (weapon && weapon.type === 'weapon') {
                    context.weaponSlots.push({ item: weapon, equipped: false });
                }
            }
        }

        // Fill remaining weapon slots
        while (context.weaponSlots.length < 5) {
            context.weaponSlots.push({ item: null, equipped: false });
        }

        // Add items
        for (const itemId of inventory.items || []) {
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

        // Calculate HP percentage for battle mode HP bar
        const maxHP = context.combatStatTotals.hp;
        context.hpPercent = maxHP > 0 ? Math.round((context.system.currentHP / maxHP) * 100) : 0;

        return context;
    }

    _onRender(context, options) {
        super._onRender(context, options);
        this._activateTabs();
        this._activateDragDrop();
        this._updateBattleHPBar();
        this._restoreBattleMode();
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

    _activateTabs() {
        const html = this.element;
        const tabs = html.querySelectorAll('.sheet-tabs .item');
        const tabContents = html.querySelectorAll('.tab-content');
        if (tabs.length === 0 || tabContents.length === 0) return;

        // Restore previously active tab (or default to the first)
        const desired = this._activeTabId
            || Array.from(tabs).find(t => t.classList.contains('active'))?.dataset.tab
            || tabs[0].dataset.tab;

        const applyActive = (tabId) => {
            this._activeTabId = tabId;
            tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tabId));
            tabContents.forEach(c => c.classList.toggle('active', c.dataset.tab === tabId));
        };

        applyActive(desired);

        tabs.forEach(tab => {
            tab.addEventListener('click', (event) => {
                event.preventDefault();
                applyActive(event.currentTarget.dataset.tab);
            });
        });
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
                zone.classList.remove('drag-over');
                this._onDrop(event);
            });
        });
    }

    async _onDrop(event) {
        const data = TextEditor.getDragEventData(event);
        const actor = this.document;

        if (data.type === 'Item') {
            const item = await fromUuid(data.uuid);
            if (!item) return;

            const target = event.currentTarget;
            const slotType = target.dataset.slotType;
            const slotIndex = parseInt(target.dataset.slotIndex);

            if (slotType === 'weapon' && item.type === 'weapon') {
                await this._addWeaponToInventory(item, slotIndex);
            } else if (slotType === 'item' && (item.type === 'consumable' || item.type === 'item')) {
                await this._addItemToInventory(item, slotIndex);
            } else if (slotType === 'skill' && item.type === 'skill') {
                await this._addSkillToActor(item, slotIndex);
            }
        } else if (data.type === 'Actor' && event.currentTarget.classList.contains('support-slot')) {
            const supportActor = await fromUuid(data.uuid);
            if (supportActor && supportActor.type === 'unit') {
                await this._addSupport(supportActor);
            }
        }
    }

    async _addWeaponToInventory(item, slotIndex) {
        const actor = this.document;
        const inventory = actor.system.inventory || { weapons: [], items: [], equipped: null };
        
        const existingItem = actor.items.find(i => i.name === item.name && i.type === item.type);
        if (existingItem) return;

        const newItem = await actor.createEmbeddedDocuments('Item', [item.toObject()]);
        inventory.weapons.push(newItem[0].id);
        
        await actor.update({ 'system.inventory.weapons': inventory.weapons });
    }

    async _addItemToInventory(item, slotIndex) {
        const actor = this.document;
        const inventory = actor.system.inventory || { weapons: [], items: [], equipped: null };
        
        const existingItem = actor.items.find(i => i.name === item.name && i.type === item.type);
        if (existingItem) return;

        const newItem = await actor.createEmbeddedDocuments('Item', [item.toObject()]);
        inventory.items.push(newItem[0].id);
        
        await actor.update({ 'system.inventory.items': inventory.items });
    }

    async _addSkillToActor(item, slotIndex) {
        const actor = this.document;
        const skills = (actor.system.skills || []).slice();

        const newSkillData = item.toObject();
        const newSkillSys  = newSkillData.system || {};
        const skillSlug = (s) => String(s || '').replace(/^skill\./, '');
        const newSlug = skillSlug(newSkillSys.id || (item.name || '').toLowerCase().replace(/\s+/g, '-'));

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
            (i.system?.id === newSkillSys.id || i.name === item.name) &&
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
            if (it) knownSlugs.add(skillSlug(it.system?.id || ''));
        }

        // 3) typeGroup qualification
        const typeGroup = newSkillSys.typeGroup || '';
        const WEAPON_GROUP_MAP = {
            'sword, lance, and axe':      ['sword', 'lance', 'axe'],
            'dagger and bow':             ['dagger', 'bow'],
            'anima, light, and dark':     ['anima', 'light', 'dark'],
            'staff':                      ['staff'],
            'strike, talons, and breath': ['strike', 'talons', 'breath'],
            'shifting stone':             ['shiftingStone']
        };
        const MOVE_GROUPS = ['infantry', 'cavalry', 'flier', 'armor'];
        const levelPrereqRaw = (newSkillSys.prereq || []).find(p => p.startsWith('level:'));
        const skillLevelReq  = levelPrereqRaw ? (Number(levelPrereqRaw.split(':')[1]) || 0) : 0;

        let qualifies = false;
        let qualifyReason = '';

        if (typeGroup === 'all-access' || typeGroup === 'combat' || !typeGroup) {
            qualifies = true;
        } else if (typeGroup === 'fiend') {
            qualifies = traitText.includes('fiend');
            qualifyReason = 'requires the Fiend trait';
        } else if (MOVE_GROUPS.includes(typeGroup)) {
            if (movementType === typeGroup) {
                qualifies = true;
            } else {
                // Heritor passives (rules p.16) grant access to other movement-type skills
                // with a level prereq <= 10 (excluding Canter).
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

        for (const p of newSkillSys.prereq || []) {
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
            } else if (kind === 'requires') {
                if (value === 'combatArt') {
                    const hasArt = actor.items.some(i =>
                        i.type === 'skill' && i.id !== replacingSkillId && i.system?.requiredCharge
                    );
                    if (!hasArt) {
                        ui.notifications.warn(`${item.name} requires at least one Combat Art to be known.`);
                        return;
                    }
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
        
        if (itemType === 'weapon') {
            const weapons = actor.system.inventory.weapons.filter(id => id !== itemId);
            await actor.update({ 'system.inventory.weapons': weapons });
        } else if (itemType === 'item') {
            const items = actor.system.inventory.items.filter(id => id !== itemId);
            await actor.update({ 'system.inventory.items': items });
        }
        
        await actor.deleteEmbeddedDocuments('Item', [itemId]);
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
                : '<i class="fas fa-crossed-swords"></i> Battle Mode';
        }
    }
}
