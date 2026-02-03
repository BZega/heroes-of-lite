export default class HolItemSheet extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.sheets.ItemSheetV2) {
    static DEFAULT_OPTIONS = {
        classes: ["heroes-of-lite", "item-sheet"],
        window: {
            icon: "fas fa-scroll",
            resizable: true,
            contentClasses: ["standard-form"]
        },
        position: {
            width: 800,
            height: 475
        },
        actions: {
            removeRefine: HolItemSheet.onRemoveRefine,
            dropRefine: HolItemSheet.onDropRefine
        }
    };

    static PARTS = {
        form: {
            template: "systems/heroes-of-lite/templates/sheets/weapon-sheet.html"
        }
    };

    _configureRenderOptions(options) {
        super._configureRenderOptions(options);
        
        // Dynamically set the template based on item type
        const itemType = this.document.type;
        options.parts = ["form"];
        this.constructor.PARTS.form.template = `systems/heroes-of-lite/templates/sheets/${itemType}-sheet.html`;
        
        return options;
    }

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

        // Ensure system structure exists for weapons
        if (item.type === 'weapon') {
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
        }

        console.log('HolItemSheet - Item context:', {
            name: context.name,
            type: context.type,
            system: context.system,
            isFromCompendium: context.isFromCompendium
        });

        return context;
    }

    _onRender(context, options) {
        super._onRender(context, options);

        // Don't allow editing of compendium items
        if (this.document.pack) {
            const html = this.element;
            // Disable all form inputs
            const inputs = html.querySelectorAll('input, select, textarea');
            inputs.forEach(input => {
                input.disabled = true;
            });
            // Add visual indicator
            html.classList.add('compendium-item-readonly');
            return;
        }

        // Handle drag and drop for refine slots (only for non-compendium items)
        const html = this.element;
        
        // Use native DOM methods instead of jQuery
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

    _onDragOver(event) {
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.classList.add('drag-over');
    }

    async _onDropRefine(event) {
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.classList.remove('drag-over');

        // Don't allow editing compendium items
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

        // Only accept refine items
        if (dropData.type !== 'Item') return;

        const droppedItem = await foundry.documents.BaseItem.fromDropData(dropData);
        if (!droppedItem || droppedItem.type !== 'refine') {
            ui.notifications.warn('Only Refine items can be dropped here');
            return;
        }

        const slotIndex = parseInt(event.currentTarget.dataset.slot);
        let refines = foundry.utils.deepClone(this.document.system.details.refines || [{}, {}]);
        
        refines[slotIndex] = {
            id: droppedItem.id,
            name: droppedItem.name
        };

        // Update the weapon name based on refines
        const newName = this._generateWeaponName(refines);

        await this.document.update({
            'name': newName,
            'system.details.refines': refines
        });

        console.log(`HoL | Added ${droppedItem.name} to refine slot ${slotIndex}, updated name to ${newName}`);
    }

    /**
     * Generate weapon name from refines
     * Format: [Refine 1] + [Refine 2] [Weapon Type]
     * Example: "Steel Long Axe"
     */
    _generateWeaponName(refines) {
        // Get the base weapon type from the current name
        // Strip out known refine prefixes to get the base type
        let baseName = this.document.name;
        
        // Get current weapon type (last word typically, but could be multi-word like "Shifting Stone")
        // We'll use the weapon group to determine the base type
        const weaponGroup = this.document.system.attributes?.weaponGroup;
        
        // Map weapon groups to their display names
        const weaponTypeMap = {
            'sword': 'Sword',
            'lance': 'Lance',
            'axe': 'Axe',
            'bow': 'Bow',
            'dagger': 'Dagger',
            'anima': 'Anima',
            'light': 'Light',
            'dark': 'Dark',
            'staff': 'Staff',
            'strike': 'Strike',
            'talons': 'Talons',
            'breath': 'Breath',
            'shiftingStone': 'Shifting Stone',
            'curse': 'Curse'
        };
        
        // Try to extract the weapon type from the current name
        // Look for common patterns like "Iron Sword", "Steel Axe", etc.
        let weaponType = weaponTypeMap[weaponGroup] || 'Weapon';
        
        // Try to find the base type in the current name
        for (const [key, displayName] of Object.entries(weaponTypeMap)) {
            if (baseName.includes(displayName)) {
                weaponType = displayName;
                break;
            }
        }
        
        // Build the new name: [Refine1] [Refine2] [WeaponType]
        const parts = [];
        
        if (refines[0]?.name) {
            parts.push(refines[0].name);
        }
        
        if (refines[1]?.name) {
            parts.push(refines[1].name);
        }
        
        parts.push(weaponType);
        
        return parts.join(' ');
    }

    async _onRemoveRefine(event) {
        event.preventDefault();
        event.stopPropagation();

        // Don't allow editing compendium items
        if (this.document.pack) {
            ui.notifications.warn('Compendium items cannot be modified. Create a copy first.');
            return;
        }

        const slotIndex = parseInt(event.currentTarget.dataset.slot);
        let refines = foundry.utils.deepClone(this.document.system.details.refines || [{}, {}]);
        
        refines[slotIndex] = {
            id: '',
            name: ''
        };

        // Update the weapon name based on remaining refines
        const newName = this._generateWeaponName(refines);

        await this.document.update({
            'name': newName,
            'system.details.refines': refines
        });

        console.log(`HoL | Removed refine from slot ${slotIndex}, updated name to ${newName}`);
    }
}