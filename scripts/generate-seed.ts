import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { generateDemoSeedSql } from "@/db/demo-seed";
import { getDemoRecords } from "@/features/opportunities/demo-data";

// Run with `npm run db:seed:generate` (vite-node resolves the "@/" alias).
const out = fileURLToPath(new URL("../supabase/seed.sql", import.meta.url));
writeFileSync(out, generateDemoSeedSql(getDemoRecords()));
console.log(`wrote ${out}`);
