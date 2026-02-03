export default class HolItemSheet extends ItemSheet {
    get template() {
        return `systems/heroes-of-lite/templates/sheets/weapon-sheet.html`;
    }

    static get defaultOptions() {
        return mergeObject(super.defaultOptions, {
            classes: ["heroes-of-lite", "sheet", "item"],
            width: 500,
            height: 600
        });
    }
}