import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, "../data");
const SEED_DIR = path.join(DATA_DIR, "seed");
const PACKS_DIR = path.join(__dirname, "../packs");

/**
 * Convert seed data into Foundry Item documents
 */
function convertRefineToFoundryItem(refineData) {
  return {
    _id: refineData.id,
    name: refineData.name,
    type: "loot", // Generic item type for refines
    system: {
      description: {
        value: refineData.description,
      },
      cost: {
        value: refineData.costG,
      },
      // Store additional properties in a custom field
      customData: {
        category: refineData.category,
        appliesToWeaponGroups: refineData.appliesToWeaponGroups,
        ...(refineData.statBonuses && {
          statBonuses: refineData.statBonuses,
        }),
        ...(refineData.tags && { tags: refineData.tags }),
      },
    },
    img: "icons/svg/item-bag.svg",
    effects: [],
    folder: null,
    sort: 0,
    permission: {
      default: 0,
    },
    flags: {
      "heroes-of-lite": {
        refineKey: refineData.id,
      },
    },
  };
}

/**
 * Read and parse seed JSON file
 */
function readSeedFile(filename) {
  const filePath = path.join(SEED_DIR, filename);
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content);
  } catch (error) {
    console.error(`Error reading ${filename}:`, error.message);
    return [];
  }
}

/**
 * Write items to a compendium pack database
 */
function writePackDatabase(packName, items) {
  const packDir = path.join(PACKS_DIR, packName);

  // Ensure pack directory exists
  if (!fs.existsSync(packDir)) {
    fs.mkdirSync(packDir, { recursive: true });
  }

  // Write each item as a separate YAML-like text file (Foundry's pack format)
  items.forEach((item) => {
    const filename = `${item._id}.yaml`;
    const filepath = path.join(packDir, filename);

    // Simple YAML representation (Foundry uses YAML format for pack storage)
    const yamlContent = convertToYaml(item);
    fs.writeFileSync(filepath, yamlContent, "utf-8");
  });

  console.log(`✓ Wrote ${items.length} items to ${packName}`);
}

/**
 * Convert object to YAML format (simplified)
 */
function convertToYaml(obj, indent = 0) {
  const spaces = " ".repeat(indent);
  let yaml = "";

  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) {
      continue;
    }

    if (typeof value === "object" && !Array.isArray(value)) {
      yaml += `${spaces}${key}:\n`;
      yaml += convertToYaml(value, indent + 2);
    } else if (Array.isArray(value)) {
      if (value.length === 0) {
        yaml += `${spaces}${key}: []\n`;
      } else if (typeof value[0] === "string") {
        yaml += `${spaces}${key}:\n`;
        value.forEach((item) => {
          yaml += `${spaces}  - ${item}\n`;
        });
      } else {
        yaml += `${spaces}${key}:\n`;
        value.forEach((item) => {
          yaml += convertToYaml(item, indent + 2).split("\n").join("\n  ");
        });
      }
    } else if (typeof value === "string") {
      const escaped = value.replace(/'/g, "''");
      yaml += `${spaces}${key}: '${escaped}'\n`;
    } else {
      yaml += `${spaces}${key}: ${value}\n`;
    }
  }

  return yaml;
}

/**
 * Main build function
 */
function buildPacks() {
  console.log("🔨 Building Foundry VTT packs from seed data...\n");

  // Build refines
  console.log("Building refines...");
  const refinesData = readSeedFile("refines.json");
  const refineItems = refinesData.map(convertRefineToFoundryItem);
  writePackDatabase("hol-refines.db", refineItems);

  console.log("\n✨ Build complete!");
}

buildPacks();
