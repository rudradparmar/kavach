import { validateCorpus } from "../corpus/validate.js";
import { loadCorpus } from "../corpus/loader.js";

const c = loadCorpus();
const issues = validateCorpus();
const errors = issues.filter((i) => i.level === "error");
const warns = issues.filter((i) => i.level === "warn");

console.log(`corpus ${c.meta.corpusVersion}  status=${c.meta.status}`);
console.log(`  ${c.scenarios.size} scenarios, ${c.provisions.size} provisions, ${c.rules.length} rules\n`);
for (const i of errors) console.log(`  ERROR  ${i.where}: ${i.message}`);
for (const i of warns) console.log(`  warn   ${i.where}: ${i.message}`);
console.log(`\n${errors.length} error(s), ${warns.length} warning(s)`);
process.exit(errors.length > 0 ? 1 : 0);
