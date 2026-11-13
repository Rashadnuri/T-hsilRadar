import { existsSync } from "node:fs";
import { checkProductionEnv, hasErrors } from "@/lib/preflight";

// npm run preflight                      → checks the variables of the current shell
// npm run preflight -- .env.production   → loads that file first (e.g. from `vercel env pull`)
// Never prints a value, only variable names.
const file = process.argv[2];
if (file) {
  if (!existsSync(file)) {
    console.error(`preflight: file not found: ${file}`);
    process.exit(2);
  }
  process.loadEnvFile(file);
}

const findings = checkProductionEnv(process.env);
const icon = { error: "✖", warning: "▲", info: "·" } as const;
for (const severity of ["error", "warning", "info"] as const) {
  for (const f of findings.filter((x) => x.severity === severity)) console.log(`${icon[severity]} ${severity.toUpperCase().padEnd(7)} ${f.subject}\n    ${f.message}`);
}
const errors = findings.filter((f) => f.severity === "error").length;
const warnings = findings.filter((f) => f.severity === "warning").length;
console.log(`\n${errors} error(s), ${warnings} warning(s).${hasErrors(findings) ? " NOT ready for production." : " No blocking problems found."}`);
process.exit(hasErrors(findings) ? 1 : 0);
