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
            height: 475
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

        return context;
    }

    _onRender(context, options) {
        super._onRender(context, options);

        // Don't allow editing of compendium items
        if (this.document.pack) {
            const html = this.element;
            const inputs = html.querySelectorAll('input, select, textarea');
            inputs.forEach(input => {
                input.disabled = true;
            });
            html.classList.add('compendium-item-readonly');
            return;
        }

        // Handle drag and drop for refine slots
        const html = this.element;
        
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

        const newName = this._generateWeaponName(refines);

        await this.document.update({
            'name': newName,
            'system.details.refines': refines
        });

        console.log(`HoL | Added ${droppedItem.name} to refine slot ${slotIndex}, updated name to ${newName}`);
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
            'staff': 'Staff',
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

        const newName = this._generateWeaponName(refines);

        await this.document.update({
            'name': newName,
            'system.details.refines': refines
        });

        console.log(`HoL | Removed refine from slot ${slotIndex}, updated name to ${newName}`);
    }
}
