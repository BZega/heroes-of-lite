const HOL = {
  MODULE_ID: "heroes-of-lite",
  FLAG_SCOPE: "heroes-of-lite",

  IMPORTS: [
    {
      key: "refines",
      label: "Refines",
      seedPath: "data/seed/refines.json",
      packName: "hol-refines",
      docType: "Item",
      itemType: "loot" 
    },
    {
      key: "weapons",
      label: "Weapons",
      seedPath: "data/seed/weapons.json",
      packName: "hol-weapons",
      docType: "Item",
      itemType: "loot"
    },
    {
      key: "skills",
      label: "Skills",
      seedPath: "data/seed/skills.json",
      packName: "hol-skills",
      docType: "Item",
      itemType: "loot"
    },
    {
      key: "consumables",
      label: "Consumables",
      seedPath: "data/seed/consumables.json",
      packName: "hol-consumables",
      docType: "Item",
      itemType: "loot"
    },
    {
      key: "key-items",
      label: "Key Items",
      seedPath: "data/seed/key-items.json",
      packName: "hol-key-items",
      docType: "Item",
      itemType: "loot"
    },
    {
      key: "statuses",
      label: "Statuses",
      seedPath: "data/seed/statuses.json",
      packName: "hol-statuses",
      docType: "Item",
      itemType: "loot"
    }
  ]
};

Hooks.once("init", () => {
  console.log("Heroes of Lite | module init");
});

Hooks.once("ready", () => {
  // Make a simple global helper you can call from the console if you want:
  // game.HOL.importAll({ clear: true })
  game.HOL = game.HOL ?? {};
  game.HOL.importAll = (opts = {}) => importAll(opts);
  game.HOL.importOne = (key, opts = {}) => importOne(key, opts);

  console.log("Heroes of Lite | ready. Use the Compendium sidebar 'HoL Tools' button to import seeds.");
});

Hooks.on("renderCompendiumDirectory", (app, html) => {
  const header = html.closest(".sidebar-tab").find(".directory-header");
  if (!header.length) return;

  if (header.find(`button[data-hol-tools="1"]`).length) return;

  const btn = $(
    `<button type="button" class="hol-tools" data-hol-tools="1" title="Heroes of Lite Tools">
       <i class="fas fa-hammer"></i> HoL Tools
     </button>`
  );

  btn.on("click", () => showToolsDialog());

  header.append(btn);
});

function showToolsDialog() {
  const importList = HOL.IMPORTS.map((x) => {
    return `<div style="display:flex; align-items:center; justify-content:space-between; gap:8px; margin:6px 0;">
      <div><b>${escapeHtml(x.label)}</b><br><span style="opacity:.8; font-size:.9em;">${escapeHtml(x.seedPath)} → ${escapeHtml(x.packName)}</span></div>
      <button type="button" data-import="${escapeHtml(x.key)}">Import</button>
    </div>`;
  }).join("");

  const content = `
    <div>
      <p style="margin-top:0;">
        Import seed data into HoL compendiums. This runs in Foundry (browser-safe) and does not use Node fs.
      </p>

      <hr/>

      <div style="margin:8px 0;">
        <label style="display:flex; gap:8px; align-items:center;">
          <input type="checkbox" id="hol-clear-pack" />
          <span><b>Clear packs before import</b> (dangerous)</span>
        </label>
      </div>

      <hr/>
      ${importList}

      <hr/>
      <div style="display:flex; gap:8px; justify-content:flex-end;">
        <button type="button" id="hol-import-all"><i class="fas fa-download"></i> Import All</button>
      </div>
    </div>
  `;

  const dlg = new Dialog({
    title: "Heroes of Lite Tools",
    content,
    buttons: {
      close: { label: "Close" }
    },
    render: (html) => {
      html.find("button[data-import]").on("click", async (ev) => {
        const key = ev.currentTarget.getAttribute("data-import");
        const clear = html.find("#hol-clear-pack").is(":checked");
        await importOne(key, { clear });
      });

      html.find("#hol-import-all").on("click", async () => {
        const clear = html.find("#hol-clear-pack").is(":checked");
        await importAll({ clear });
      });
    }
  });

  dlg.render(true);
}

async function importAll({ clear = false } = {}) {
  assertGM();

  for (const entry of HOL.IMPORTS) {
    await importEntry(entry, { clear });
  }

  ui.notifications.info("HoL import complete.");
}

async function importOne(key, { clear = false } = {}) {
  assertGM();

  const entry = HOL.IMPORTS.find((x) => x.key === key);
  if (!entry) {
    ui.notifications.error(`HoL import: unknown key "${key}"`);
    return;
  }
  await importEntry(entry, { clear });
}

async function importEntry(entry, { clear = false } = {}) {
  const { label, seedPath, packName, docType } = entry;

  ui.notifications.info(`HoL: Importing ${label}...`);

  const seed = await fetchSeedJson(seedPath);
  if (!Array.isArray(seed)) {
    ui.notifications.error(`HoL: ${label} seed file must be a JSON array: ${seedPath}`);
    return;
  }

  const pack = await getOrCreatePack(entry);
  if (!pack) return;

  if (clear) {
    await clearPack(pack);
  }

  const existing = await indexPackByHolId(pack);
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const raw of seed) {
    if (!raw || typeof raw !== "object") {
      skipped++;
      continue;
    }

    const holId = raw.id;
    if (!holId || typeof holId !== "string") {
      console.warn(`HoL: Skipping entry without string id in ${label}`, raw);
      skipped++;
      continue;
    }

    const docData = convertSeedToDoc(entry, raw);

    const existingId = existing.get(holId);
    if (existingId) {
      docData._id = existingId;
      await docTypeClass(docType).updateDocuments([docData], { pack: pack.collection });
      updated++;
    } else {
      await docTypeClass(docType).createDocuments([docData], { pack: pack.collection });
      created++;
    }
  }

  ui.notifications.info(`HoL: ${label} imported. Created ${created}, updated ${updated}, skipped ${skipped}.`);
}

function convertSeedToDoc(entry, raw) {
  const holId = raw.id;

  const img = raw.img || "icons/svg/item-bag.svg";

  const customData = {
    ...raw
  };

  delete customData.name;
  delete customData.img;

  if (entry.docType === "Item") {
    return {
      name: raw.name ?? holId,
      type: entry.itemType,
      img,
      system: {
        description: { value: raw.description ?? "" },
        customData
      },
      flags: {
        [HOL.FLAG_SCOPE]: {
          id: holId
        }
      }
    };
  }

  return {
    name: raw.name ?? holId,
    img,
    system: { customData },
    flags: { [HOL.FLAG_SCOPE]: { id: holId } }
  };
}

async function fetchSeedJson(seedPath) {
  const url = new URL(seedPath, import.meta.url).toString();
  const res = await fetch(url);
  if (!res.ok) {
    ui.notifications.error(`HoL: Failed to fetch seed file ${seedPath} (${res.status})`);
    return null;
  }
  return await res.json();
}

async function getOrCreatePack(entry) {
  const pack = game.packs.get(`${HOL.MODULE_ID}.${entry.packName}`) || game.packs.get(entry.packName);
  if (pack) return pack;

  try {
    const created = await CompendiumCollection.createCompendium({
      label: `HoL - ${entry.label}`,
      name: entry.packName,
      type: entry.docType,
      package: "world"
    });
    return created;
  } catch (err) {
    console.error("HoL: Failed to create compendium", err);
    ui.notifications.error(`HoL: Failed to create compendium "${entry.packName}". Check console.`);
    return null;
  }
}


async function clearPack(pack) {
  await pack.getIndex(); 
  const ids = pack.index.map((d) => d._id);
  if (!ids.length) return;

  const Doc = docTypeClass(pack.metadata.type);
  await Doc.deleteDocuments(ids, { pack: pack.collection });
}

async function indexPackByHolId(pack) {
  await pack.getIndex();
  const map = new Map();

  for (const row of pack.index) {
    // index doesn't always include flags, so we have to load documents when needed.
    // We'll load lazily only if we can't find it in indexed fields.
    // For now, do a simple fetch per row if pack is small (OK for testing).
  }

  const docs = await pack.getDocuments();
  for (const d of docs) {
    const holId = d.getFlag(HOL.FLAG_SCOPE, "id");
    if (holId) map.set(holId, d.id);
  }
  return map;
}

function assertGM() {
  if (!game.user?.isGM) {
    throw new Error("HoL: GM only action.");
  }
}

function docTypeClass(docType) {
  const cls =
    (docType === "Item" && CONFIG.Item.documentClass) ||
    (docType === "Actor" && CONFIG.Actor.documentClass);

  if (!cls) throw new Error(`HoL: Unsupported docType ${docType}`);
  return cls;
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}