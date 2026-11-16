// Writes the notes of a release from reports/stats.json (scripts/validate.ts) and
// reports/build.json (export.ts): one row per zip, the versions of the source sheets, what changed
// since the previous release (scripts/changes-since.ts) and what the build noticed about the
// readings in the sheets. The counts and sources of the previous release are read back from its
// notes; the commits since then come from GitHub.
//
// usage: node scripts/release-notes.ts [--previous previous.json] [--commits commits.json]
//                                      [--out reports/release-notes.md]
//   previous.json is `gh release view --json tagName,body`; left out for the first release.
//   commits.json is `gh api repos/OWNER/REPO/compare/PREVIOUS_TAG...HEAD
//     --jq '[.commits[] | {sha, message: .commit.message}]'`, oldest first. Left out, or naming a
//     file that is not there, when the commits could not be listed.
import { existsSync, readFileSync, writeFileSync } from "fs";
import { parseArgs } from "util";
import type { BuildReport, Source } from "../release.ts";
import { changesSince, type Commit, type PreviousRelease } from "./changes-since.ts";
import type { Stats } from "./validate.ts";

const { values: args } = parseArgs({
  options: { previous: { type: "string" }, commits: { type: "string" }, out: { type: "string" } },
});
/** The JSON in a file; `fallback` when no file was named, it is not there or it is empty. */
function readJson<T>(path: string | undefined, fallback: T): T {
  if (!path || !existsSync(path)) return fallback;
  return (JSON.parse(readFileSync(path, "utf-8") || "null") as T | null) ?? fallback;
}

const stats = JSON.parse(readFileSync("reports/stats.json", "utf-8")) as Stats[];
const build = JSON.parse(readFileSync("reports/build.json", "utf-8")) as BuildReport;
const previous = readJson<PreviousRelease>(args.previous, {});
// undefined: the commits could not be listed, which is not the same as there being none
const commits = readJson<Commit[] | undefined>(args.commits, undefined);

const count = (n: number) => n.toLocaleString("en");
const sourceLabel = (s: Source) => (s.upstream ? `${s.upstream}_${s.version}` : `${s.repo}@${s.blobSha?.slice(0, 12)}`);
const sourceLine = Object.values(build.sources)
  .map((s) => `\`${sourceLabel(s)}\``)
  .join(", ");

const lines = [
  `MOE dictionaries for Yomitan, revision ${build.revision}.`,
  "",
  "| file | dictionary | entries | terms | size |",
  "|---|---|---:|---:|---:|",
  ...stats.map((s) => `| \`${s.file}\` | ${s.title} | ${count(s.entries)} | ${count(s.terms)} | ${(s.bytes / 1e6).toFixed(1)} MB |`),
  "",
  `Sources: ${sourceLine}.`,
];

// the repository is the one the build put into the update URLs of the zips
const section = changesSince(previous, stats, sourceLine, commits, { repo: build.updateRepo, tag: `v${build.revision}` });
if (section.length) lines.push("", ...section);

const details = (summary: string, items: string[]) =>
  items.length ? ["", `<details><summary>${items.length} ${summary}</summary>`, "", "```", ...items, "```", "", "</details>"] : [];
lines.push(
  ...details("readings whose pinyin was taken from the zhuyin cell (the pinyin cell is empty, cut short or not pinyin)", build.pinyinFromZhuyin),
  ...details("pinyin cells with a different tone than the zhuyin cell of their row (left as they are)", build.toneMismatches),
  ...details("兩岸詞典 pinyin cells that disagree with the zhuyin cell of their row", build.unresolvedPinyin),
);

lines.push(
  "",
  "**Import:** Yomitan → Settings → Dictionaries → Import → pick a zip. " +
    "**Update:** the zips are self-updating: Yomitan → Settings → Dictionaries → *Check for updates*.",
);

const out = args.out ?? "reports/release-notes.md";
writeFileSync(out, lines.join("\n") + "\n");
console.log(`wrote ${out}`);
