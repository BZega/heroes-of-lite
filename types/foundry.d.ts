/**
 * Minimal ambient declarations for the Foundry VTT V14 surface this system uses.
 *
 * The community `fvtt-types` package is deliberately not used: its latest release
 * targets V13 and is still in beta, so it would type against the wrong namespaces
 * and bury real errors. This file covers only what Heroes of Lite actually calls,
 * and is accurate for V14.368.
 */

declare global {
  /* -------------------------------------------- */
  /*  Core documents                               */
  /* -------------------------------------------- */

  interface DocumentFlags {
    [scope: string]: Record<string, unknown> | undefined;
  }

  class FoundryDocument {
    readonly id: string;
    name: string;
    img: string;
    readonly uuid: string;
    readonly pack: string | null;
    readonly isOwner: boolean;
    readonly isEmbedded: boolean;
    readonly _stats?: { compendiumSource?: string | null };
    flags: DocumentFlags;
    update(data: Record<string, unknown>, operation?: Record<string, unknown>): Promise<this>;
    updateSource(changes: Record<string, unknown>, options?: Record<string, unknown>): Record<string, unknown>;
    delete(): Promise<this>;
    toObject(): Record<string, any>;
    _preCreate(data: Record<string, any>, options: Record<string, unknown>, user: unknown): Promise<boolean | void>;
    getFlag(scope: string, key: string): unknown;
    setFlag(scope: string, key: string, value: unknown): Promise<this>;
    unsetFlag(scope: string, key: string): Promise<this>;
    sheet?: { render(force?: boolean): unknown } | null;
  }

  /** An embedded collection behaves like a Map with array helpers bolted on. */
  interface EmbeddedCollection<T> extends Iterable<T> {
    readonly size: number;
    get(id: string): T | undefined;
    find(predicate: (value: T) => boolean): T | undefined;
    filter(predicate: (value: T) => boolean): T[];
    some(predicate: (value: T) => boolean): boolean;
    map<U>(transform: (value: T) => U): U[];
    contents: T[];
  }

  class ActiveEffect extends FoundryDocument {
    disabled: boolean;
    origin: string;
    statuses: Set<string>;
    changes: EffectChange[];
    duration: { rounds?: number | null };
  }

  interface EffectChange {
    key: string;
    mode: number;
    value: string | number;
    priority?: number;
  }

  class Actor extends FoundryDocument {
    readonly type: string;
    system: any;
    static createDocuments(data: object[], operation?: Record<string, unknown>): Promise<Actor[]>;
    readonly items: EmbeddedCollection<Item>;
    readonly effects: EmbeddedCollection<ActiveEffect>;
    readonly statuses: Set<string>;
    /** Present only on a token's synthetic actor. */
    readonly token: TokenDocument | null;
    readonly prototypeToken: TokenDocument;
    getActiveTokens(linked?: boolean, document?: false): Token[];
    getActiveTokens(linked: boolean, document: true): TokenDocument[];
    createEmbeddedDocuments(name: 'ActiveEffect', data: object[]): Promise<ActiveEffect[]>;
    createEmbeddedDocuments(name: 'Item', data: object[]): Promise<Item[]>;
    createEmbeddedDocuments(name: string, data: object[]): Promise<FoundryDocument[]>;
    updateEmbeddedDocuments(name: string, updates: object[]): Promise<FoundryDocument[]>;
    deleteEmbeddedDocuments(name: string, ids: string[]): Promise<FoundryDocument[]>;
  }

  class Item extends FoundryDocument {
    readonly type: string;
    system: any;
    readonly actor: Actor | null;
    static createDocuments(data: object[], operation?: Record<string, unknown>): Promise<Item[]>;
    static implementation: {
      fromDropData(data: Record<string, any>): Promise<Item | null>;
    };
  }

  class TokenDocument extends FoundryDocument {
    x: number;
    y: number;
    width: number;
    height: number;
    elevation: number;
    disposition: number;
    readonly actor: Actor | null;
    readonly actorLink: boolean;
    readonly parent: Scene | null;
    readonly object: { center: Point } | null;
    texture: { src: string };
  }

  class Scene extends FoundryDocument {
    readonly tokens: EmbeddedCollection<TokenDocument>;
    readonly regions: EmbeddedCollection<RegionDocument>;
    readonly grid: { size: number; distance: number };
  }

  class RegionDocument extends FoundryDocument {
    readonly tokens: Set<TokenDocument>;
    readonly object: RegionObject | null;
    readonly parent: Scene | null;
  }

  interface RegionObject {
    testPoint(point: Point, elevation?: number): boolean;
  }

  interface Point {
    x: number;
    y: number;
  }

  /* -------------------------------------------- */
  /*  Chat, rolls and combat                       */
  /* -------------------------------------------- */

  class Roll {
    constructor(formula: string, data?: Record<string, unknown>);
    readonly total: number;
    readonly terms: RollTerm[];
    readonly dice: RollTerm[];
    evaluate(options?: Record<string, unknown>): Promise<this>;
    toMessage(data?: Record<string, unknown>): Promise<ChatMessage>;
  }

  interface RollTerm {
    results?: { result: number; active?: boolean }[];
  }

  class ChatMessage extends FoundryDocument {
    static create(data: Record<string, unknown>): Promise<ChatMessage>;
    static getSpeaker(options?: { actor?: Actor; token?: TokenDocument }): Record<string, unknown>;
  }

  class Combatant extends FoundryDocument {
    readonly actor: Actor | null;
    readonly token: TokenDocument | null;
  }

  class Combat extends FoundryDocument {
    readonly combatants: EmbeddedCollection<Combatant>;
    readonly round: number;
  }

  /* -------------------------------------------- */
  /*  Compendiums and collections                  */
  /* -------------------------------------------- */

  interface CompendiumCollection<T = FoundryDocument> {
    readonly collection: string;
    readonly documentName: string;
    readonly locked: boolean;
    readonly index: Iterable<{ _id: string; name: string }>;
    metadata: { id: string; packageName: string; name: string };
    getDocuments(): Promise<T[]>;
    getIndex(options?: { fields?: string[] }): Promise<Iterable<Record<string, any>>>;
    configure(options: Record<string, unknown>): Promise<unknown>;
  }

  interface WorldCollection<T> extends Iterable<T> {
    get(id: string): T | undefined;
    find(predicate: (value: T) => boolean): T | undefined;
    filter(predicate: (value: T) => boolean): T[];
    readonly contents: T[];
    readonly size: number;
  }

  /* -------------------------------------------- */
  /*  Globals                                      */
  /* -------------------------------------------- */

  interface GameSettings {
    register(namespace: string, key: string, data: Record<string, unknown>): void;
    get(namespace: string, key: string): any;
    set(namespace: string, key: string, value: unknown): Promise<unknown>;
  }

  interface GameKeybindings {
    register(namespace: string, key: string, data: Record<string, unknown>): void;
  }

  interface GameUser {
    readonly isGM: boolean;
    readonly isSelf: boolean;
    readonly targets: Set<Token>;
    readonly character: Actor | null;
  }

  interface Game {
    actors: WorldCollection<Actor>;
    items: WorldCollection<Item>;
    scenes: WorldCollection<Scene>;
    packs: WorldCollection<CompendiumCollection> & { get(id: string): CompendiumCollection | undefined };
    users: { activeGM: GameUser | null };
    user: GameUser;
    settings: GameSettings;
    keybindings: GameKeybindings;
    i18n: { localize(key: string): string; format(key: string, data?: Record<string, unknown>): string };
    system: { id: string; version: string };
    /** The system's own API surface, assigned at ready. */
    heroesOfLite?: Record<string, unknown>;
  }

  const game: Game;

  class Token {
    readonly id: string;
    readonly name: string;
    readonly document: TokenDocument;
    readonly actor: Actor | null;
    readonly center: Point;
    readonly x: number;
    readonly y: number;
    readonly scene: Scene | null;
  }

  interface Canvas {
    grid: { size: number; distance: number } | null;
    tokens: { controlled: Token[]; placeables: Token[] } | null;
    scene: Scene | null;
  }

  const canvas: Canvas | null;

  interface Notifications {
    info(message: string, options?: Record<string, unknown>): void;
    warn(message: string, options?: Record<string, unknown>): void;
    error(message: string, options?: Record<string, unknown>): void;
  }

  /** Always present by the time system code runs. */
  const ui: { notifications: Notifications };

  interface HooksStatic {
    on(hook: string, callback: (...args: any[]) => unknown): number;
    once(hook: string, callback: (...args: any[]) => unknown): number;
    off(hook: string, id: number): void;
    call(hook: string, ...args: unknown[]): boolean;
    callAll(hook: string, ...args: unknown[]): boolean;
  }

  const Hooks: HooksStatic;

  interface StatusEffectConfig {
    id: string;
    name: string;
    img: string;
  }

  interface Config {
    Actor: { documentClass: unknown; dataModels: Record<string, unknown> };
    Item: { documentClass: unknown; dataModels: Record<string, unknown> };
    statusEffects: StatusEffectConfig[];
    specialStatusEffects: Record<string, string>;
    [key: string]: any;
  }

  const CONFIG: Config;

  const CONST: {
    ACTIVE_EFFECT_MODES: Record<string, number>;
    TOKEN_DISPOSITIONS: Record<string, number>;
    [key: string]: any;
  };

  const Handlebars: {
    registerHelper(name: string, fn: (...args: any[]) => unknown): void;
    compile(template: string): (context: unknown) => string;
  };

  /* -------------------------------------------- */
  /*  foundry namespace                            */
  /* -------------------------------------------- */

  interface DataFieldOptions {
    required?: boolean;
    nullable?: boolean;
    blank?: boolean;
    initial?: unknown;
    integer?: boolean;
    min?: number;
    max?: number;
    choices?: readonly string[] | Record<string, string>;
    label?: string;
  }

  class DataField {
    constructor(options?: DataFieldOptions);
  }

  class SchemaFieldClass extends DataField {
    constructor(fields: Record<string, DataField>, options?: DataFieldOptions);
  }

  class ArrayFieldClass extends DataField {
    constructor(element: DataField, options?: DataFieldOptions);
  }

  class TypeDataModelBase {
    static defineSchema(): Record<string, DataField>;
    readonly parent: any;
    readonly schema: unknown;
    prepareBaseData(): void;
    prepareDerivedData(): void;
    updateSource(changes: Record<string, unknown>): Record<string, unknown>;
    toObject(source?: boolean): Record<string, any>;
  }

  /** Base class for ApplicationV2 sheets; typed loosely since we only subclass it. */
  class ApplicationV2Base {
    constructor(options?: Record<string, unknown>);
    static DEFAULT_OPTIONS: Record<string, any>;
    static PARTS: Record<string, { template: string }>;
    readonly element: HTMLElement;
    readonly document: any;
    options: Record<string, any>;
    render(options?: boolean | Record<string, unknown>): Promise<this>;
    close(options?: Record<string, unknown>): Promise<this>;
    _prepareContext(options?: Record<string, unknown>): Promise<Record<string, any>>;
    _onRender(context: Record<string, any>, options: Record<string, unknown>): void;
    _onClose(options: Record<string, unknown>): void;
    _prepareSubmitData(
      event: Event | null,
      form: HTMLFormElement,
      formData: unknown,
      updateData?: Record<string, unknown>
    ): Record<string, any>;
    _onDrop(event: DragEvent): Promise<unknown> | unknown;
  }

  namespace foundry {
    namespace abstract {
      /** Base class for system DataModels. */
      class TypeDataModel extends TypeDataModelBase {}
    }

    namespace data {
      const fields: {
        SchemaField: typeof SchemaFieldClass;
        ArrayField: typeof ArrayFieldClass;
        StringField: new (options?: DataFieldOptions) => DataField;
        NumberField: new (options?: DataFieldOptions) => DataField;
        BooleanField: new (options?: DataFieldOptions) => DataField;
        ObjectField: new (options?: DataFieldOptions) => DataField;
        HTMLField: new (options?: DataFieldOptions) => DataField;
        FilePathField: new (options?: DataFieldOptions) => DataField;
      };
    }

    namespace documents {
      const collections: {
        Actors: { registerSheet(scope: string, sheet: unknown, options: Record<string, unknown>): void };
        Items: { registerSheet(scope: string, sheet: unknown, options: Record<string, unknown>): void };
      };
    }

    namespace applications {
      namespace api {
        /** Base class for ApplicationV2 windows. */
        class ApplicationV2 extends ApplicationV2Base {}
        function HandlebarsApplicationMixin<T extends abstract new (...args: any[]) => any>(Base: T): T;
        class DialogV2 {
          static confirm(options: Record<string, unknown>): Promise<boolean>;
          static prompt(options: Record<string, unknown>): Promise<unknown>;
          static wait(options: Record<string, unknown>): Promise<unknown>;
        }
      }

      namespace sheets {
        class ActorSheetV2 extends ApplicationV2Base {}
        class ItemSheetV2 extends ApplicationV2Base {}
      }

      namespace ux {
        const TextEditor: {
          implementation: {
            getDragEventData(event: DragEvent): Record<string, any> | null;
            enrichHTML(content: string, options?: Record<string, unknown>): Promise<string>;
          };
        };
      }

      namespace handlebars {
        function renderTemplate(path: string, data: unknown): Promise<string>;
        function loadTemplates(paths: string[]): Promise<unknown>;
      }
    }

    namespace utils {
      function deepClone<T>(value: T): T;
      function mergeObject<T extends object>(original: T, other?: object, options?: Record<string, unknown>): T;
      function getProperty(object: object, key: string): any;
      function setProperty(object: object, key: string, value: unknown): boolean;
      function expandObject(object: Record<string, unknown>): Record<string, any>;
      function flattenObject(object: object): Record<string, any>;
      function randomID(length?: number): string;
      function fromUuid(uuid: string): Promise<FoundryDocument | null>;
    }
  }

  function fromUuid(uuid: string): Promise<FoundryDocument | null>;

  /** Foundry extends the Math global. */
  interface Math {
    clamp(value: number, min: number, max: number): number;
  }
}

export {};
