// Builds the six zips and their index files into build/ (or OUT_DIR). Run from the repository root.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { Dictionary, DictionaryIndex } from "yomichan-dict-builder";
import type { Editions } from "./content.ts";
import { addTermsLiangAn } from "./liangan.ts";
import { addTermsMoe } from "./moe_dics.ts";
import { buildNotes } from "./notes.ts";
import { hideOtherReadingSystemCss } from "./readings.ts";
import {
  DICTIONARIES,
  EDITIONS,
  OUTPUTS,
  indexName,
  releaseBaseUrl,
  resolveRepo,
  resolveRevision,
  zipName,
  type BuildReport,
  type Sources,
} from "./release.ts";

// JSZip re-encodes string inputs to UTF-8 in 16 KiB chunks, so a surrogate pair (an astral CJK
// character) that straddles a chunk boundary turns into two U+FFFD characters. Hand it bytes.
const dictionaryPrototype = Dictionary.prototype as unknown as {
  saveJsonToZip(this: Dictionary, fileName: string, data: unknown): Promise<void>;
};
if (typeof dictionaryPrototype.saveJsonToZip !== "function")
  throw new Error("yomichan-dict-builder no longer has Dictionary.saveJsonToZip; the byte-safe replacement would do nothing");
dictionaryPrototype.saveJsonToZip = async function (fileName, data) {
  this.zip.file(fileName, Buffer.from(JSON.stringify(data), "utf8"));
};

// Output directory for the zips and index files (the release workflow publishes build/*).
const OUT_DIR = process.env.OUT_DIR ?? "build";
// Ranks these dictionaries first in the search results; within a headword the readings keep the
// order the dictionary gives them (多音排序).
const POPULARITY_BOOST = 100;

const revision = resolveRevision();
const updateRepo = resolveRepo();
const sources = JSON.parse(readFileSync("dict/sources.json", "utf-8")) as Sources;

// Content is identical in both editions and carries both reading systems; each edition's
// styles.css hides the other system (see readings.ts).
// (line endings normalised, so a Windows checkout builds the same zips as the release workflow)
const baseCss = readFileSync("styles.css", "utf-8").replaceAll("\r\n", "\n");

mkdirSync(OUT_DIR, { recursive: true });
// A build that stops half-way must not leave zips of an earlier build next to new index files.
for (const output of OUTPUTS) for (const file of [output.zip, output.index]) rmSync(join(OUT_DIR, file), { force: true });

for (const info of DICTIONARIES) {
  const editions = {} as Editions;
  for (const edition of EDITIONS) {
    const dictionary = new Dictionary({ fileName: zipName(info, edition.id) });
    const index = new DictionaryIndex()
      .setTitle(`${info.title} ${edition.label}`)
      .setRevision(revision)
      .setAuthor("shadow")
      .setSequenced(true)
      .setAttribution(info.attribution)
      .setDescription(info.description)
      .setIsUpdatable(true)
      .setIndexUrl(releaseBaseUrl(updateRepo) + indexName(info, edition.id))
      .setDownloadUrl(releaseBaseUrl(updateRepo) + zipName(info, edition.id))
      .setSourceLanguage("zh")
      .setTargetLanguage("zh");
    await dictionary.setIndex(index.build(), OUT_DIR, indexName(info, edition.id));
    dictionary.zip.file("styles.css", Buffer.from(baseCss + hideOtherReadingSystemCss(edition.id), "utf8"));
    editions[edition.id] = dictionary;
  }

  const started = Date.now();
  if (info.id === "liangan") await addTermsLiangAn(editions, sources.liangan.path, POPULARITY_BOOST);
  else if (info.id === "concised")
    await addTermsMoe(
      editions,
      "Concised",
      sources.concised.path,
      { index: sources.concisedPics.index!, folder: sources.concisedPics.path },
      POPULARITY_BOOST,
    );
  else await addTermsMoe(editions, "Revised", sources.revised.path, undefined, POPULARITY_BOOST);

  const parsed = Date.now();
  for (const edition of EDITIONS) await editions[edition.id].export(OUT_DIR);
  const seconds = (from: number, to: number) => ((to - from) / 1000).toFixed(0);
  console.log(`Exported ${info.title} (parsed in ${seconds(started, parsed)} s, zipped in ${seconds(parsed, Date.now())} s)`);
}

// Read by scripts/validate.ts and scripts/release-notes.ts.
mkdirSync("reports", { recursive: true });
const report: BuildReport = { revision, updateRepo, sources, ...buildNotes };
writeFileSync("reports/build.json", JSON.stringify(report, null, 2) + "\n");
console.log(`revision ${revision}, update URLs under ${releaseBaseUrl(updateRepo)}`);
