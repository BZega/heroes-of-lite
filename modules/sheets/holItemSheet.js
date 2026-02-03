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

    get template() {
        return `systems/heroes-of-lite/templates/sheets/weapon-sheet.html`;
    }

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const item = this.document;

        // Ensure we have the item data
        context.name = item.name;
        context.type = item.type;
        context.img = item.img;
        context.system = foundry.utils.deepClone(item.system) || {};

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

        console.log('HolItemSheet - Item context:', {
            name: context.name,
            type: context.type,
            attributes: context.system.attributes,
            details: context.system.details
        });

        return context;
    }

    _onRender(context, options) {
        super._onRender(context, options);

        // Handle drag and drop for refine slots
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

        await this.document.update({
            'system.details.refines': refines
        });

        console.log(`HoL | Added ${droppedItem.name} to refine slot ${slotIndex}`);
    }

    async _onRemoveRefine(event) {
        event.preventDefault();
        event.stopPropagation();

        const slotIndex = parseInt(event.currentTarget.dataset.slot);
        let refines = foundry.utils.deepClone(this.document.system.details.refines || [{}, {}]);
        
        refines[slotIndex] = {
            id: '',
            name: ''
        };

        await this.document.update({
            'system.details.refines': refines
        });

        console.log(`HoL | Removed refine from slot ${slotIndex}`);
    }
}