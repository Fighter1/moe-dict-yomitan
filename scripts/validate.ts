// Checks the zips in build/ the way Yomitan will when it imports and updates them:
//   - the six zips of release.ts are there, and nothing else
//   - index.json and every term/tag bank against Yomitan's JSON schemas (schemas/)
//   - isUpdatable + indexUrl/downloadUrl point at this repository's latest release, the sidecar
//     index file next to the zip is the zip's own index.json, the revision has the shape Yomitan
//     compares number by number and is the same in every zip
//   - the golden words (dict/golden_words.tsv) are there with their readings, the lookup-only
//     spellings among them as rows of the right entry that show the spelling after the headword,
//     and the words it rules out are not
//   - every image a definition refers to is in the zip, no U+FFFD (mangled astral characters)
//   - the 注音 and 拼音 editions of a dictionary have the same number of entries and terms
// Writes reports/stats.json (read by scripts/release-notes.ts) and, in GitHub Actions, a job summary.
//
// usage: node scripts/validate.ts [--dir build] [--repo owner/name] [--revision 2026.11.15.7] [--after v2026.11.14.3]
//   --revision  the revision every zip must have (default: the one in reports/build.json)
//   --after     a released revision or tag these zips must be newer than, so Yomitan offers them
import { Ajv, type ValidateFunction } from "ajv";
import JSZip from "jszip";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import { isDeepStrictEqual, parseArgs } from "util";
import { OUTPUTS, REVISION_PATTERN, isNewerRevision, releaseBaseUrl, resolveRepo, type BuildReport } from "../release.ts";

const GOLDEN_WORDS_FILE = "dict/golden_words.tsv";
const MAX_PROBLEMS_SHOWN = 40;
const REPLACEMENT_CHARACTER = String.fromCharCode(0xfffd);

const { values: args } = parseArgs({
  options: { dir: { type: "string" }, repo: { type: "string" }, revision: { type: "string" }, after: { type: "string" } },
});
const dir = args.dir ?? "build";
const build: Partial<BuildReport> = existsSync("reports/build.json")
  ? JSON.parse(readFileSync("reports/build.json", "utf-8"))
  : {};
const repo = args.repo ?? process.env.GITHUB_REPOSITORY ?? build.updateRepo ?? resolveRepo();
const expectedRevision = args.revision ?? build.revision;
const after = args.after?.replace(/^v/, "");
const releaseBase = releaseBaseUrl(repo);

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

type GoldenWords = {
  /** rows the zip must contain; with `entryOf`, as a row of the entry that headword has under the same reading */
  present: { term: string; reading: string; entryOf?: string }[];
  /** terms the zip must have no row for */
  absent: string[];
};

/** zip name -> what dict/golden_words.tsv says about that zip. */
function readGoldenWords() {
  const golden = new Map<string, GoldenWords>();
  for (const line of readFileSync(GOLDEN_WORDS_FILE, "utf-8").split(/\r?\n/)) {
    if (!line.trim() || line.startsWith("#")) continue;
    const [stem, term, reading, entryOf] = line.split("\t");
    const words = golden.get(`${stem}.zip`) ?? { present: [], absent: [] };
    if (stem && term?.startsWith("!") && term.length > 1 && reading === undefined) words.absent.push(term.slice(1));
    else if (stem && term && !term.startsWith("!") && reading !== undefined) words.present.push({ term, reading, entryOf: entryOf || undefined });
    else throw new Error(`${GOLDEN_WORDS_FILE}: cannot parse "${line}"`);
    golden.set(`${stem}.zip`, words);
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

/** What the headword box of a glossary shows: "裡面", or "裡面、裏面" on the row of 裏面. */
function headwordBox(node: unknown): string | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = headwordBox(child);
      if (found !== undefined) return found;
    }
  } else if (node && typeof node === "object") {
    const n = node as { content?: unknown; data?: Record<string, unknown> };
    if (n.data?.moedict === "traditional-term") return typeof n.content === "string" ? n.content : "";
    return headwordBox(n.content);
  }
  return undefined;
}

// entries: distinct sequence numbers (one per dictionary entry); terms: rows, which also include
// the rows filed under the simplified spelling, the lookup-only spellings and each reading
export type Stats = { file: string; title: string; revision: string; entries: number; terms: number; termBanks: number; files: number; bytes: number };
const stats: Stats[] = [];
const problems: string[] = [];

const golden = readGoldenWords();
const expected = new Set<string>(OUTPUTS.map((output) => output.zip));
for (const file of readdirSync(dir).filter((f) => f.endsWith(".zip")))
  if (!expected.has(file)) problems.push(`${join(dir, file)} is not one of the dictionaries this repository builds`);
for (const file of golden.keys()) if (!expected.has(file)) problems.push(`${GOLDEN_WORDS_FILE} names ${file}, which is not built`);

for (const output of OUTPUTS) {
  const file = output.zip;
  const fail = (message: string) => problems.push(`${file}: ${message}`);
  const path = join(dir, file);
  if (!existsSync(path)) {
    fail(`not in ${dir}/`);
    continue;
  }
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
  if (!REVISION_PATTERN.test(revision))
    fail(`revision "${revision}" is not four dot-separated integers, so Yomitan would compare it as text`);
  else if (after && REVISION_PATTERN.test(after) && !isNewerRevision(revision, after))
    fail(`revision ${revision} is not newer than ${after}, so Yomitan would not offer it as an update`);
  if (expectedRevision && revision !== expectedRevision) fail(`revision is ${revision}, expected ${expectedRevision}`);
  // What Yomitan's "Check for updates" needs: it fetches indexUrl, compares revisions and, if
  // the published one is newer, downloads downloadUrl.
  if (index.isUpdatable !== true) fail("index.json has no isUpdatable: true");
  if (index.downloadUrl !== releaseBase + file) fail(`downloadUrl is ${index.downloadUrl}, expected ${releaseBase + file}`);
  if (index.indexUrl !== releaseBase + output.index) fail(`indexUrl is ${index.indexUrl}, expected ${releaseBase + output.index}`);
  const sidecar = join(dir, output.index);
  if (!existsSync(sidecar)) fail(`${sidecar} (the indexUrl asset) is missing`);
  else if (!isDeepStrictEqual(JSON.parse(readFileSync(sidecar, "utf-8")), index)) fail(`${sidecar} differs from the zip's index.json`);

  // term and tag banks
  let terms = 0;
  let termBanks = 0;
  const present = new Map<string, Set<unknown>>(); // "term\treading" -> the sequence numbers of its rows
  const presentTerms = new Set<unknown>();
  const goldenWords = golden.get(file) ?? { present: [], absent: [] };
  // the rows of the lookup-only spellings among the golden words: their entry and what they show
  const lookupRows = new Map<string, { sequence: unknown; shows: string | undefined }[]>(
    goldenWords.present.filter((word) => word.entryOf).map((word) => [`${word.term}\t${word.reading}`, []]),
  );
  const sequences = new Set<unknown>();
  const images = new Set<string>();
  for (const name of [...names].sort()) {
    const kind = /^term_bank_\d+\.json$/.test(name) ? "term" : /^tag_bank_\d+\.json$/.test(name) ? "tag" : undefined;
    if (!kind) continue;
    const raw = await text(name);
    if (raw.includes(REPLACEMENT_CHARACTER)) fail(`${name} contains U+FFFD (a character was mangled on the way into the zip)`);
    const bank = JSON.parse(raw) as unknown[][];
    if (!validators[kind](bank)) {
      fail(`${name}: ${schemaErrors(validators[kind])}`);
      continue;
    }
    if (kind === "term") {
      termBanks++;
      terms += bank.length;
      for (const row of bank) {
        const key = `${row[0]}\t${row[1]}`;
        const rowSequences = present.get(key) ?? new Set();
        present.set(key, rowSequences.add(row[6]));
        presentTerms.add(row[0]);
        lookupRows.get(key)?.push({ sequence: row[6], shows: headwordBox(row[5]) });
        sequences.add(row[6]);
        imagePaths(row[5], images);
      }
    }
  }
  if (!terms) fail("no term entries");
  if (!goldenWords.present.length) fail(`${GOLDEN_WORDS_FILE} has no word for this zip`);
  for (const { term, reading, entryOf } of goldenWords.present) {
    const key = `${term}\t${reading}`;
    if (!present.has(key)) fail(`golden word missing: ${term} [${reading}]`);
    else if (entryOf) {
      // a lookup-only spelling: one of its rows must be a row of the headword's entry, and that
      // row must show the spelling after the headword
      const entry = present.get(`${entryOf}\t${reading}`);
      const rows = (lookupRows.get(key) ?? []).filter((row) => entry?.has(row.sequence));
      if (!entry) fail(`golden word missing: ${entryOf} [${reading}], whose entry ${term} should be filed under`);
      else if (!rows.length) fail(`${term} [${reading}] is not a row of the entry of ${entryOf}`);
      else if (!rows.some((row) => row.shows === `${entryOf}、${term}`))
        fail(`the row of ${term} [${reading}] shows ${rows.map((row) => `"${row.shows}"`).join(", ")}, expected "${entryOf}、${term}"`);
    }
  }
  for (const term of goldenWords.absent) if (presentTerms.has(term)) fail(`has a row for ${term}, which ${GOLDEN_WORDS_FILE} says it must not`);
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
const dictionaryOf = (file: string) => file.replace(/-(zhuyin|pinyin)\.zip$/, "");
for (const [i, a] of stats.entries())
  for (const b of stats.slice(i + 1))
    if (dictionaryOf(a.file) === dictionaryOf(b.file) && (a.entries !== b.entries || a.terms !== b.terms))
      problems.push(`${a.file} and ${b.file} have different entry or term counts`);
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
console.log(`\n${stats.length} zips valid; update URLs under ${releaseBase}`);
