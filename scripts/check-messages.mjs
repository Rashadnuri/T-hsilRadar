// Verifies translation dictionaries (INTERNATIONALIZATION.md §4):
//  - identical key sets across az / ru / en
//  - no empty values
//  - ICU placeholders ({name}) match the Azerbaijani source for every key
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "messages");
const locales = ["az", "ru", "en"];
const data = Object.fromEntries(locales.map((l) => [l, JSON.parse(readFileSync(join(dir, `${l}.json`), "utf8"))]));

function flatten(obj, prefix = "") {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === "object" && v !== null ? flatten(v, `${prefix}${k}.`) : [[`${prefix}${k}`, v]],
  );
}
// Top-level ICU arguments only ({name}, {count, plural, …}); text inside plural branches is ignored.
function placeholders(s) {
  const names = [];
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "{") {
      if (depth === 0) {
        const match = /^\{\s*(\w+)/.exec(s.slice(i));
        if (match) names.push(match[1]);
      }
      depth++;
    } else if (s[i] === "}") depth--;
  }
  return names.sort().join(",");
}

const flat = Object.fromEntries(locales.map((l) => [l, new Map(flatten(data[l]))]));
const errors = [];
const source = flat.az;

for (const l of locales) {
  for (const [key, value] of flat[l]) {
    if (typeof value !== "string" || value.trim() === "") errors.push(`${l}: empty or non-string value at "${key}"`);
  }
  for (const key of source.keys()) {
    if (!flat[l].has(key)) errors.push(`${l}: missing key "${key}"`);
  }
  for (const key of flat[l].keys()) {
    if (!source.has(key)) errors.push(`${l}: extra key "${key}" not present in az`);
  }
}
for (const l of locales.slice(1)) {
  for (const [key, value] of source) {
    const other = flat[l].get(key);
    if (typeof value === "string" && typeof other === "string" && placeholders(value) !== placeholders(other)) {
      errors.push(`${l}: placeholders differ from az at "${key}"`);
    }
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  console.error(`\ni18n check failed (${errors.length} problem${errors.length > 1 ? "s" : ""}).`);
  process.exit(1);
}
console.log(`i18n check passed: ${source.size} keys × ${locales.length} locales.`);
