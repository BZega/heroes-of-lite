export default class HolConsumableSheet extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.sheets.ItemSheetV2) {
    static DEFAULT_OPTIONS = {
        classes: ["heroes-of-lite", "item-sheet", "consumable-sheet"],
        window: {
            icon: "fas fa-flask",
            resizable: true,
            contentClasses: ["standard-form"]
        },
        position: {
            width: 600,
            height: 500
        }
    };

    static PARTS = {
        form: {
            template: "systems/heroes-of-lite/templates/sheets/consumable-sheet.html"
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
        }
    }
}
