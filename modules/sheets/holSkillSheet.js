export default class HolSkillSheet extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.sheets.ItemSheetV2) {
    static DEFAULT_OPTIONS = {
        classes: ["heroes-of-lite", "item-sheet", "skill-sheet"],
        window: {
            icon: "fas fa-bolt",
            resizable: true,
            contentClasses: ["standard-form"]
        },
        position: {
            width: 600,
            height: 500
        },
        form: {
            submitOnChange: true,
            closeOnSubmit: false
        }
    };

    static PARTS = {
        form: {
            template: "systems/heroes-of-lite/templates/sheets/skill-sheet.html"
        }
    };

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const item = this.document;

        context.name = item.name;
        context.img = item.img;
        context.type = item.type;

        if (!context.system) context.system = item.system;
        if (!context.system.attributes) context.system.attributes = {};
        if (!context.system.details) context.system.details = {};

        context.isFromCompendium = !!item.pack;

        return context;
    }

    _onRender(context, options) {
        super._onRender(context, options);

        if (this.document.pack) {
            const html = this.element;
            const inputs = html.querySelectorAll('input, select, textarea');
            inputs.forEach(input => { input.disabled = true; });
            html.classList.add('compendium-item-readonly');
        }
    }
}
