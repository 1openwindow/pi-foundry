#!/usr/bin/env node
// Regenerate .agents/skills/pi-foundry/references/contract.json from src/contract.mjs.
// Run this whenever src/contract.mjs changes so the skill stays in sync with the runtime image.

import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { contract } from "../src/contract.mjs";

const out = resolve(dirname(fileURLToPath(import.meta.url)), "../.agents/skills/pi-foundry/references/contract.json");
writeFileSync(out, `${JSON.stringify(contract, null, 2)}\n`);
console.log(`wrote ${out}`);
