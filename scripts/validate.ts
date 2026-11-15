// Checks the zips in build/ the way Yomitan will when it imports and updates them:
//   - index.json and every term/tag bank against Yomitan's JSON schemas (schemas/)
//   - isUpdatable + indexUrl/downloadUrl point at this repository's latest release, the sidecar
//     index file next to the zip is the zip's own index.json, the revision has the shape Yomitan
//     compares number by number and is the same in every zip
//   - the golden words (dict/golden_words.tsv) are there with their readings
//   - every image a definition refers to is in the zip, no U+FFFD (mangled astral characters)
//   - the 注音 and 拼音 editions of a dictionary have the same number of entries and terms
// Writes reports/stats.json (read by scripts/release-notes.ts) and, in GitHub Actions, a job summary.
//
// usage: node scripts/validate.ts [--dir build] [--repo owner/name] [--revision 2026.11.15.7]
import { Ajv, type ValidateFunction } from "ajv";
import JSZip from "jszip";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { basename, join } from "path";
import { isDeepStrictEqual } from "util";

const GOLDEN_WORDS_FILE = "dict/golden_words.tsv";
const MAX_PROBLEMS_SHOWN = 40;

const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? undefined : args[i + 1];
};
const dir = arg("dir") ?? "build";
const build = existsSync("reports/build.json")
  ? (JSON.parse(readFileSync("reports/build.json", "utf-8")) as { revision?: string; updateRepo?: string })
  : {};
const repo = arg("repo") ?? process.env.GITHUB_REPOSITORY ?? build.updateRepo ?? "Fighter1/moe-dict-yomitan";
const expectedRevision = arg("revision") ?? build.revision;
const releaseBase = `https://github.com/${repo}/releases/latest/download/`;

const ajv = new Ajv({ allowUnionTypes: true, strict: false });
const schema = (name: string) =>
  ajv.compile(JSON.parse(readFileSync(join("schemas", `dictionary-${name}-schema.json`), "utf-8")));
const validators: Record<"index" | "term" | "tag", ValidateFunction> = {
  index: schema("index"),
  term: schema("term-bank-v3"),
  tag: schema("tag-bank-v3"),
};
const schemaErrors = (validate: ValidateFunction) =>
  (validate.errors ?? [])
    .slice(0, 3)
    .map((e) => `${e.instancePath || "/"} ${e.message}`)
    .join("; ");

/** zip name without .zip -> the `term\treading` pairs that zip must contain. */
function readGoldenWords() {
  const golden = new Map<string, string[]>();
  for (const line of readFileSync(GOLDEN_WORDS_FILE, "utf-8").split(/\r?\n/)) {
    if (!line.trim() || line.startsWith("#")) continue;
    const [stem, term, reading] = line.split("\t");
    if (!stem || !term || reading === undefined) throw new Error(`${GOLDEN_WORDS_FILE}: cannot parse "${line}"`);
    golden.set(stem, [...(golden.get(stem) ?? []), `${term}\t${reading}`]);
  }
  return golden;
}

/** Paths of the images a glossary refers to. */
function imagePaths(node: unknown, out: Set<string>) {
  if (Array.isArray(node)) for (const child of node) imagePaths(child, out);
  else if (node && typeof node === "object") {
    const n = node as Record<string, unknown>;
    if ((n.tag === "img" || n.type === "image") && typeof n.path === "string") out.add(n.path);
    imagePaths(n.content, out);
  }
}

// entries: distinct sequence numbers (one per dictionary entry); terms: rows, which also include
// the rows filed under the simplified spelling and under each reading
export type Stats = { file: string; title: string; revision: string; entries: number; terms: number; termBanks: number; files: number; bytes: number };
const stats: Stats[] = [];
const problems: string[] = [];

const golden = readGoldenWords();
const zips = readdirSync(dir).filter((f) => f.endsWith(".zip")).sort();
if (!zips.length) problems.push(`no zips in ${dir}/`);
for (const stem of golden.keys())
  if (!zips.includes(`${stem}.zip`)) problems.push(`${GOLDEN_WORDS_FILE} names ${stem}.zip, which is not in ${dir}/`);

for (const file of zips) {
  const fail = (message: string) => problems.push(`${file}: ${message}`);
  const path = join(dir, file);
  const zip = await JSZip.loadAsync(readFileSync(path));
  const names = new Set(Object.keys(zip.files).filter((name) => !zip.files[name]!.dir));
  // JSZip's own string decoding has the same chunk-boundary problem as its encoding; take bytes.
  const text = async (name: string) => (await zip.file(name)!.async("nodebuffer")).toString("utf-8");

  // index.json
  if (!names.has("index.json")) {
    fail("no index.json");
    continue;
  }
  const index = JSON.parse(await text("index.json")) as Record<string, unknown>;
  if (!validators.index(index)) fail(`index.json: ${schemaErrors(validators.index)}`);
  const revision = String(index.revision ?? "");
  if (!/^\d{4}\.\d{2}\.\d{2}\.\d+$/.test(revision))
    fail(`revision "${revision}" is not four dot-separated integers, so Yomitan would compare it as text`);
  if (expectedRevision && revision !== expectedRevision) fail(`revision is ${revision}, expected ${expectedRevision}`);
  if (index.isUpdatable !== true) fail("index.json has no isUpdatable: true");
  if (index.downloadUrl !== releaseBase + file) fail(`downloadUrl is ${index.downloadUrl}, expected ${releaseBase + file}`);
  const indexUrl = String(index.indexUrl ?? "");
  if (!indexUrl.startsWith(releaseBase)) fail(`indexUrl is ${indexUrl}, expected it under ${releaseBase}`);
  else {
    // Yomitan fetches indexUrl to learn the newest revision, so the sidecar must be this index.
    const sidecar = join(dir, basename(indexUrl));
    if (!existsSync(sidecar)) fail(`${sidecar} (the indexUrl asset) is missing`);
    else if (!isDeepStrictEqual(JSON.parse(readFileSync(sidecar, "utf-8")), index)) fail(`${sidecar} differs from the zip's index.json`);
  }

  // term and tag banks
  let terms = 0;
  let termBanks = 0;
  const present = new Set<string>();
  const sequences = new Set<unknown>();
  const images = new Set<string>();
  for (const name of [...names].sort()) {
    const kind = /^term_bank_\d+\.json$/.test(name) ? "term" : /^tag_bank_\d+\.json$/.test(name) ? "tag" : undefined;
    if (!kind) continue;
    const raw = await text(name);
    if (raw.includes("�")) fail(`${name} contains U+FFFD (a character was mangled on the way into the zip)`);
    const bank = JSON.parse(raw) as unknown[][];
    if (!validators[kind](bank)) {
      fail(`${name}: ${schemaErrors(validators[kind])}`);
      continue;
    }
    if (kind === "term") {
      termBanks++;
      terms += bank.length;
      for (const row of bank) {
        present.add(`${row[0]}\t${row[1]}`);
        sequences.add(row[6]);
        imagePaths(row[5], images);
      }
    }
  }
  if (!terms) fail("no term entries");
  for (const word of golden.get(file.replace(/\.zip$/, "")) ?? [])
    if (!present.has(word)) fail(`golden word missing: ${word.replace("\t", " [")}]`);
  const missing = [...images].filter((image) => !names.has(image));
  if (missing.length) fail(`${missing.length} images are referenced but not in the zip, e.g. ${missing.slice(0, 3).join(", ")}`);
  if (!names.has("styles.css")) fail("no styles.css");
  else if ((await text("styles.css")).includes("\r")) fail("styles.css has CRLF line endings");

  stats.push({ file, title: String(index.title ?? ""), revision, entries: sequences.size, terms, termBanks, files: names.size, bytes: statSync(path).size });
  console.log(
    `${file}: ${sequences.size.toLocaleString("en")} entries, ${terms.toLocaleString("en")} terms in ${termBanks} term banks, ${images.size} images, revision ${revision}`,
  );
}

// The 注音 and 拼音 editions of a dictionary are the same rows with different readings.
for (const pinyin of stats.filter((s) => s.file.endsWith("-pinyin.zip"))) {
  const zhuyin = stats.find((s) => s.file === pinyin.file.replace("-pinyin.zip", "-zhuyin.zip"));
  if (!zhuyin) problems.push(`${pinyin.file} has no 注音 edition next to it`);
  else if (zhuyin.entries !== pinyin.entries || zhuyin.terms !== pinyin.terms)
    problems.push(`${pinyin.file} and ${zhuyin.file} have different entry or term counts`);
}
if (new Set(stats.map((s) => s.revision)).size > 1) problems.push("the zips do not all carry the same revision");

mkdirSync("reports", { recursive: true });
writeFileSync("reports/stats.json", JSON.stringify(stats, null, 2) + "\n");

if (process.env.GITHUB_STEP_SUMMARY) {
  const lines = [
    `### Dictionaries (${problems.length ? `${problems.length} problems` : "valid"})`,
    "",
    "| file | dictionary | revision | entries | terms | size |",
    "|---|---|---|---:|---:|---:|",
    ...stats.map(
      (s) =>
        `| \`${s.file}\` | ${s.title} | ${s.revision} | ${s.entries.toLocaleString("en")} | ${s.terms.toLocaleString("en")} | ${(s.bytes / 1e6).toFixed(1)} MB |`,
    ),
    "",
    ...problems.slice(0, MAX_PROBLEMS_SHOWN).map((p) => `- ❌ ${p}`),
  ];
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n");
}

if (problems.length) {
  console.error(`\n${problems.length} problems:`);
  for (const p of problems.slice(0, MAX_PROBLEMS_SHOWN)) console.error(`  ${p}`);
  if (problems.length > MAX_PROBLEMS_SHOWN) console.error(`  … and ${problems.length - MAX_PROBLEMS_SHOWN} more`);
  process.exit(1);
}
console.log(`\n${zips.length} zips valid; update URLs under ${releaseBase}`);
