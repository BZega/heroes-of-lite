export default class HolActorSheet extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.sheets.ActorSheetV2) {
    static DEFAULT_OPTIONS = {
        classes: ["heroes-of-lite", "actor-sheet", "character-sheet"],
        window: {
            icon: "fas fa-user",
            resizable: true,
            contentClasses: ["standard-form"]
        },
        position: {
            width: 800,
            height: 700
        },
        actions: {
            incrementCharge: this._onIncrementCharge,
            decrementCharge: this._onDecrementCharge,
            equipWeapon: this._onEquipWeapon,
            removeItem: this._onRemoveItem
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

        // Calculate combat stat totals (Base + Bonus + Temp)
        context.combatStatTotals = {
            hp: (combatStats.hp || 15),
            atk: (combatStats.atk || 3),
            spd: (combatStats.spd || 3),
            dex: (combatStats.dex || 3),
            def: (combatStats.def || 3),
            res: (combatStats.res || 3),
            luck: (combatStats.luck || 3)
        };

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

        return context;
    }

    _onRender(context, options) {
        super._onRender(context, options);
        this._activateTabs();
        this._activateDragDrop();
    }

    _activateTabs() {
        const html = this.element;
        const tabs = html.querySelectorAll('.sheet-tabs .item');
        const tabContents = html.querySelectorAll('.tab-content');

        if (tabs.length > 0 && tabContents.length > 0) {
            tabs[0].classList.add('active');
            tabContents[0].classList.add('active');
        }

        tabs.forEach(tab => {
            tab.addEventListener('click', (event) => {
                event.preventDefault();
                const targetTab = event.currentTarget.dataset.tab;

                tabs.forEach(t => t.classList.remove('active'));
                tabContents.forEach(content => content.classList.remove('active'));

                event.currentTarget.classList.add('active');
                const targetContent = html.querySelector(`.tab-content[data-tab="${targetTab}"]`);
                if (targetContent) {
                    targetContent.classList.add('active');
                }
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
        const skills = actor.system.skills || [];
        
        const existingItem = actor.items.find(i => i.name === item.name && i.type === item.type);
        let skillId;
        
        if (existingItem) {
            skillId = existingItem.id;
        } else {
            const newItem = await actor.createEmbeddedDocuments('Item', [item.toObject()]);
            skillId = newItem[0].id;
        }
        
        skills[slotIndex] = skillId;
        await actor.update({ 'system.skills': skills });
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
}
