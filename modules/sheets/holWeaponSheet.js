export default class HolWeaponSheet extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.sheets.ItemSheetV2) {
    static DEFAULT_OPTIONS = {
        classes: ["heroes-of-lite", "item-sheet", "weapon-sheet"],
        window: {
            icon: "fas fa-sword",
            resizable: true,
            contentClasses: ["standard-form"]
        },
        position: {
            width: 800,
            height: 560
        },
        actions: {
            removeRefine: HolWeaponSheet.onRemoveRefine,
            dropRefine: HolWeaponSheet.onDropRefine
        }
    };

    static PARTS = {
        form: {
            template: "systems/heroes-of-lite/templates/sheets/weapon-sheet.html"
        }
    };

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const item = this.document;

        // Add item properties to context for template access
        context.name = item.name;
        context.img = item.img;
        context.type = item.type;
        
        // Ensure system data is accessible
        if (!context.system) {
            context.system = item.system;
        }

        // Check if this item is from a compendium (read-only)
        context.isFromCompendium = !!item.pack;

        // Ensure system structure exists
        if (!context.system.details) {
            context.system.details = {};
        }
        if (!context.system.attributes) {
            context.system.attributes = {};
        }

        // Ensure refines array exists
        if (!context.system.details.refines) {
            context.system.details.refines = [{id: '', name: ''}, {id: '', name: ''}];
        }

        context.innateRefines = [];
        if (context.system.details.innateAttributes && Array.isArray(context.system.details.innateAttributes)) {
            for (const refineId of context.system.details.innateAttributes) {
                const refineItem = await this._getRefineById(refineId);
                if (refineItem) {
                    context.innateRefines.push({
                        id: refineItem.id,
                        name: refineItem.name,
                        _document: refineItem // Keep reference to full document
                    });
                }
            }
        }

        return context;
    }

    _onRender(context, options) {
        super._onRender(context, options);

        console.log('HoL | _onRender called');
        console.log('HoL | this.element:', this.element);

        const html = this.element;

        // Make refine names clickable to open refine sheet (allow for both compendium and non-compendium)
        const refineNames = html.querySelectorAll('.refine-name');
        refineNames.forEach(nameEl => {
            nameEl.addEventListener('click', this._onRefineNameClick.bind(this));
        });

        // Make innate attribute tags clickable to open refine sheet (allow for both compendium and non-compendium)
        const innateAttributeTags = html.querySelectorAll('.innate-attribute-tag');
        console.log('HoL | Found innate attribute tags:', innateAttributeTags.length);
        innateAttributeTags.forEach((tag, index) => {
            console.log(`HoL | Attaching click listener to tag ${index}:`, tag);
            tag.addEventListener('click', this._onInnateAttributeClick.bind(this));
        });

        // Don't allow editing of compendium items
        if (this.document.pack) {
            const inputs = html.querySelectorAll('input, select, textarea');
            inputs.forEach(input => {
                input.disabled = true;
            });
            html.classList.add('compendium-item-readonly');
            return;
        }

        // Handle drag and drop for refine slots (only for non-compendium items)
        const refineSlots = html.querySelectorAll('[data-dropzone="refine"]');
        refineSlots.forEach(slot => {
            slot.addEventListener('dragover', this._onDragOver.bind(this));
            slot.addEventListener('drop', this._onDropRefine.bind(this));
        });

        const removeButtons = html.querySelectorAll('.remove-refine');
        removeButtons.forEach(btn => {
            btn.addEventListener('click', this._onRemoveRefine.bind(this));
        });
    }

    async _onInnateAttributeClick(event) {
        event.preventDefault();
        event.stopPropagation();

        const refineId = event.currentTarget.dataset.refineId;
        console.log('HoL | Innate attribute clicked, refineId:', refineId);
        
        if (!refineId) {
            console.warn('HoL | No refineId found on clicked element');
            return;
        }

        // Find the refine item
        const refineItem = await this._getRefineById(refineId);
        console.log('HoL | Found refine item:', refineItem);
        
        if (refineItem) {
            refineItem.sheet.render(true);
        } else {
            console.warn('HoL | Could not find refine item with ID:', refineId);
        }
    }

    async _onRefineNameClick(event) {
        event.preventDefault();
        event.stopPropagation();

        const slotIndex = parseInt(event.currentTarget.closest('.refine-slot')?.dataset.slot);
        const refineId = this.document.system.details.refines?.[slotIndex]?.id;

        if (!refineId) return;

        // Find the refine item
        let refineItem = game.items.get(refineId);
        
        if (!refineItem) {
            for (const pack of game.packs) {
                if (pack.documentName === 'Item') {
                    refineItem = await pack.getDocument(refineId);
                    if (refineItem) break;
                }
            }
        }

        if (refineItem) {
            refineItem.sheet.render(true);
        }
    }

    _onDragOver(event) {
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.classList.add('drag-over');
    }

    async _onDropRefine(event) {
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.classList.remove('drag-over');

        if (this.document.pack) {
            ui.notifications.warn('Compendium items cannot be modified. Create a copy first.');
            return;
        }

        const data = event.dataTransfer.getData('text/plain');
        let dropData;
        
        try {
            dropData = JSON.parse(data);
        } catch (e) {
            console.error('Invalid drop data:', e);
            return;
        }

        if (dropData.type !== 'Item') return;

        const droppedItem = await Item.implementation.fromDropData(dropData);
        if (!droppedItem || droppedItem.type !== 'refine') {
            ui.notifications.warn('Only Refine items can be dropped here');
            return;
        }

        const weaponGroup = this.document.system.attributes?.weaponGroup;
        const validGroups = droppedItem.system?.appliesToWeaponGroups || [];
        if (validGroups.length > 0 && !validGroups.includes(weaponGroup)) {
            ui.notifications.warn(`This refine cannot be applied to ${weaponGroup} weapons.`);
            return;
        }

        const currentRefines = this.document.system.details.refines || [{}, {}];
        if (currentRefines.some(r => r.name === droppedItem.name)) {
            ui.notifications.warn('This refine is already applied to the weapon.');
            return;
        }

        const slotIndex = parseInt(event.currentTarget.dataset.slot);
        let refines = foundry.utils.deepClone(this.document.system.details.refines || [{}, {}]);
        
        refines[slotIndex] = {
            id: droppedItem.id,
            name: droppedItem.name
        };

        const newName = this._generateWeaponName(refines);

        console.log('HoL | Dropped refine stat bonuses:', droppedItem);
        console.log('Hol | Current weapon stats:', this.document);

        const mightModifier = droppedItem.system?.statBonuses.might || 0;
        const rangeMinModifier = droppedItem.system?.statBonuses.minRange || 0;
        const rangeMaxModifier = droppedItem.system?.statBonuses.maxRange || 0;
        const costModifier = droppedItem.system?.costG || 0;

        let newMight = this.document.system.details.might + mightModifier;
        let newRange;
        
        // Staff weapons use highest range from all refines, not additive
        if (this.document.system.attributes.weaponGroup === 'staff') {
            newRange = await this._calculateStaffRange(refines);
        } else {
            // Other weapons add range bonuses
            let newRangeMin = this.document.system.details.range.min + rangeMinModifier;
            let newRangeMax = this.document.system.details.range.max + rangeMaxModifier;
            newRange = {
                min: newRangeMin,
                max: newRangeMax
            };
        }
        
        let newCostG = this.document.system.details.costG + costModifier;

        await this.document.update({
            'name': newName,
            'system.details.refines': refines,
            'system.details.might': newMight,
            'system.details.range': newRange,
            'system.details.costG': newCostG
        });

        console.log(`HoL | Added ${droppedItem.name} to refine slot ${slotIndex}, updated name to ${newName}`);
    }

    async _calculateStaffRange(refines) {
        // For staffs, range is based on highest range from all refines
        let maxRangeMin = 1;
        let maxRangeMax = 1;

        for (const refine of refines) {
            if (!refine.id) continue;

            let refineItem = game.items.get(refine.id);
            if (!refineItem) {
                for (const pack of game.packs) {
                    if (pack.documentName === 'Item') {
                        refineItem = await pack.getDocument(refine.id);
                        if (refineItem) break;
                    }
                }
            }

            if (refineItem) {
                const minRange = refineItem.system?.statBonuses?.minRange || 0;
                const maxRange = refineItem.system?.statBonuses?.maxRange || 0;
                
                if (maxRange > maxRangeMax) {
                    maxRangeMin = minRange;
                    maxRangeMax = maxRange;
                }
            }
        }

        return { min: maxRangeMin, max: maxRangeMax };
    }

    _generateWeaponName(refines) {
        const weaponGroup = this.document.system.attributes?.weaponGroup;
        
        const weaponTypeMap = {
            'sword': 'Sword',
            'lance': 'Lance',
            'axe': 'Axe',
            'bow': 'Bow',
            'dagger': 'Dagger',
            'anima': 'Anima',
            'light': 'Light',
            'dark': 'Dark',
            'staff': 'Heal',
            'strike': 'Strike',
            'talons': 'Talons',
            'breath': 'Breath',
            'shiftingStone': 'Shifting Stone',
            'curse': 'Curse'
        };
        
        let weaponType = weaponTypeMap[weaponGroup] || 'Weapon';
        
        const baseName = this.document.name;
        for (const [key, displayName] of Object.entries(weaponTypeMap)) {
            if (baseName.includes(displayName)) {
                weaponType = displayName;
                break;
            }
        }
        if (weaponGroup === 'staff' && refines[0]?.name === '' && refines[1]?.name === '') {
            weaponType = 'Heal';
        } else if (weaponGroup === 'dark' && refines[0]?.name === '' && refines[1]?.name === '') {
            weaponType = 'Flux';
        }
        
        const parts = [];
        
        if (refines[0]?.name) {
            parts.push(refines[0].name);
        }
        
        if (refines[1]?.name) {
            parts.push(refines[1].name);
        }
        
        console.log('HoL | Generating weapon name with refines:', refines);
        console.log('HoL | Weapon group:', weaponGroup);


        if ((weaponGroup !== 'staff' || (refines[0]?.name === '' && refines[1]?.name === '' && weaponGroup === 'staff')) || (refines[0]?.name === '' && refines[1]?.name === '' && weaponGroup === 'dark')) {
            parts.push(weaponType);
        }
        return parts.join(' ');
    }

    async _onRemoveRefine(event) {
        event.preventDefault();
        event.stopPropagation();

        if (this.document.pack) {
            ui.notifications.warn('Compendium items cannot be modified. Create a copy first.');
            return;
        }

        const slotIndex = parseInt(event.currentTarget.dataset.slot);
        const refineId = this.document.system.details.refines[slotIndex]?.id;

        if (!refineId) {
            ui.notifications.warn('No refine to remove in this slot.');
            return;
        }
        
        let refineItem = game.items.get(refineId);
        
        if (!refineItem) {
            for (const pack of game.packs) {
                if (pack.documentName === 'Item'){
                    refineItem = await pack.getDocument(refineId);
                    if (refineItem) break;
                }
            }
        }
        console.log('HoL | Removing refine:', refineId);
        console.log('HoL | Refine item data:', refineItem);

        const mightModifier = refineItem?.system?.statBonuses.might || 0;
        const rangeMinModifier = refineItem?.system?.statBonuses.minRange || 0;
        const rangeMaxModifier = refineItem?.system?.statBonuses.maxRange || 0;
        const costModifier = refineItem?.system?.costG || 0;

        let newMight = this.document.system.details.might - mightModifier;
        let newCostG = this.document.system.details.costG - costModifier;

        // Clone and remove the refine first
        let refines = foundry.utils.deepClone(this.document.system.details.refines || [{}, {}]);
        refines[slotIndex] = {
            id: '',
            name: ''
        };

        // Calculate range based on remaining refines
        let newRange;
        if (this.document.system.attributes.weaponGroup === 'staff') {
            // For staffs, recalculate from remaining refines
            newRange = await this._calculateStaffRange(refines);
        } else {
            // For other weapons, subtract the range modifier
            let newRangeMin = this.document.system.details.range.min - rangeMinModifier;
            let newRangeMax = this.document.system.details.range.max - rangeMaxModifier;
            newRange = {
                min: newRangeMin,
                max: newRangeMax
            };
        }

        const newName = this._generateWeaponName(refines);



        await this.document.update({
            'name': newName,
            'system.details.refines': refines,
            'system.details.might': newMight,
            'system.details.range': newRange,
            'system.details.costG': newCostG
        });

        console.log(`HoL | Removed refine from slot ${slotIndex}, updated name to ${newName}`);
    }

    async _getRefineById(refineId) {
        let refineItem = game.items.get(refineId);
        console.log('HoL | Looking up refine by ID:', refineId);
        console.log('HoL | Found refine in world items:', refineItem);
        if (!refineItem) {
            for (const pack of game.packs) {
                if (pack.documentName === 'Item') {
                    console.log('HoL | Searching pack for refine:', pack.collection);
                    const items = await pack.getDocuments();
                    console.log('HoL | Pack items:', items.length, 'items');
                    refineItem = items.find(i => {
                        const matchesId = i.id === refineId;
                        const matchesSourceId = i.flags?.['heroes-of-lite']?.sourceId === refineId;
                        console.log(`HoL | Checking item ${i.name}: id=${i.id}, sourceId=${i.flags?.['heroes-of-lite']?.sourceId}, matchesId=${matchesId}, matchesSourceId=${matchesSourceId}`);
                        return matchesId || matchesSourceId;
                    });
                    console.log('HoL | Found refine in pack:', refineItem);
                    if (refineItem) break;
                }
            }
        }
        return refineItem;
    }
}
