/**
 * Postbuild gate: the public build must not contain placeholder law.
 *
 * Fails if site/dist contains
 *   - a provision id, or a provision's section number in a citation form
 *     ("s.207", "section 207", "§ 207"), taken from corpus/provisions.json
 *   - any quotable line (every language) from the scenario files and fallback
 *   - a <script src> that is not on the waitlist embed's domain
 *   - a stylesheet/font/script pulled from another origin
 *   - copy that CLAUDE.md or SITE-PLAN forbids outright
 *
 * It reads the corpus at check time, so a corpus change that introduces new
 * wording is caught by the next build rather than by a reader.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(HERE, "../dist");
const CORPUS = path.resolve(HERE, "../../kavach-engine/corpus");

/** Only the waitlist embed's domain may serve a script. */
const SCRIPT_HOSTS = new Set(["tally.so"]);

const FORBIDDEN_PHRASES = [
  "continuous recording",
  "always on",
  "always-on",
  "cannot be deleted",
  "can't be deleted",
  "the officer cannot",
  "officer cannot",
];

const TEXT_EXT = new Set([".html", ".json", ".txt", ".xml", ".css", ".js", ".mjs", ".svg", ".webmanifest"]);

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

function decode(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}
const norm = (s: string) => decode(s).replace(/\s+/g, " ").toLowerCase();
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

if (!fs.existsSync(DIST)) {
  console.error("check-dist: site/dist does not exist — run the build first.");
  process.exit(1);
}

const provisions = JSON.parse(fs.readFileSync(path.join(CORPUS, "provisions.json"), "utf8")) as Array<{ id: string; section: string }>;
const ids = provisions.map((p) => p.id);
const sections = [...new Set(provisions.map((p) => p.section))];

const lines = new Set<string>();
const addLines = (q: Record<string, unknown> | undefined) => {
  for (const v of Object.values(q ?? {})) if (typeof v === "string" && v.trim().length >= 12) lines.add(norm(v));
};
for (const f of fs.readdirSync(path.join(CORPUS, "scenarios"))) {
  addLines(JSON.parse(fs.readFileSync(path.join(CORPUS, "scenarios", f), "utf8")).quotableLine);
}
addLines(JSON.parse(fs.readFileSync(path.join(CORPUS, "fallback.json"), "utf8")).quotableLine);

// "s.207", "sec 207", "section 207", "sections 207", "§207". Bare numbers are not
// matched: they are everywhere (prices, years) and say nothing about law.
const sectionRe = sections.map((s) => ({
  s,
  re: new RegExp(`(?:\\bsections?\\s*|\\bsec\\.?\\s*|\\bs\\.\\s*|§\\s*)${esc(s)}(?![\\w])`, "i"),
}));

const problems: string[] = [];
const files = walk(DIST);
let scanned = 0;

for (const file of files) {
  const rel = path.relative(DIST, file).replace(/\\/g, "/");
  if (!TEXT_EXT.has(path.extname(file).toLowerCase())) continue;
  scanned++;
  const raw = fs.readFileSync(file, "utf8");
  const text = norm(raw);

  for (const id of ids) if (text.includes(id.toLowerCase())) problems.push(`${rel}: provision id "${id}"`);
  for (const { s, re } of sectionRe) if (re.test(decode(raw))) problems.push(`${rel}: section citation for "${s}"`);
  for (const l of lines) if (text.includes(l)) problems.push(`${rel}: quotable line "${l.slice(0, 50)}…"`);
  if (rel.endsWith(".html") || rel.endsWith(".json")) {
    for (const p of FORBIDDEN_PHRASES) if (text.includes(p)) problems.push(`${rel}: forbidden phrase "${p}"`);
  }

  if (rel.endsWith(".html")) {
    for (const m of raw.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) {
      const src = m[1]!;
      let host = "";
      try { host = new URL(src, "https://self.invalid").hostname; } catch { /* leave empty */ }
      if (!SCRIPT_HOSTS.has(host)) problems.push(`${rel}: <script src="${src}"> is not on an allowed domain`);
    }
    for (const m of raw.matchAll(/<(?:link|img|source|video|audio)\b[^>]*\b(?:href|src)\s*=\s*["'](https?:\/\/[^"']+)["']/gi)) {
      problems.push(`${rel}: external resource ${m[1]}`);
    }
    for (const m of raw.matchAll(/<iframe\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) {
      const host = new URL(m[1]!, "https://self.invalid").hostname;
      if (!SCRIPT_HOSTS.has(host)) problems.push(`${rel}: <iframe src="${m[1]}"> is not on an allowed domain`);
    }
  }
  if (rel.endsWith(".css") && /fonts\.(googleapis|gstatic)\.com|@import\s+url\(\s*["']?https?:/i.test(raw)) {
    problems.push(`${rel}: stylesheet loads from another origin`);
  }
}

if (problems.length) {
  console.error(`\ncheck-dist FAILED — ${problems.length} problem(s) in site/dist:\n`);
  for (const p of problems) console.error("  ✗ " + p);
  process.exit(1);
}

console.log(
  `check-dist OK — ${scanned} text files scanned; ${ids.length} provision ids, ${sections.length} section numbers, ` +
    `${lines.size} quotable lines, script/iframe hosts and forbidden phrases checked.`,
);
