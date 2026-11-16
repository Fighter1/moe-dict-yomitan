// Writes the notes of a release from reports/stats.json (scripts/validate.ts) and
// reports/build.json (export.ts): one row per zip, the versions of the source sheets, what changed
// since the previous release (read back from the table in that release's notes) and what the
// build noticed about the readings in the sheets.
//
// usage: node scripts/release-notes.ts [--previous previous.json] [--out reports/release-notes.md]
//   previous.json is `gh release view --json tagName,body`; left out for the first release.
import { existsSync, readFileSync, writeFileSync } from "fs";
import { parseArgs } from "util";
import type { BuildReport, Source } from "../release.ts";
import type { Stats } from "./validate.ts";

const { values: args } = parseArgs({ options: { previous: { type: "string" }, out: { type: "string" } } });

const stats = JSON.parse(readFileSync("reports/stats.json", "utf-8")) as Stats[];
const build = JSON.parse(readFileSync("reports/build.json", "utf-8")) as BuildReport;
const previous =
  args.previous && existsSync(args.previous)
    ? (JSON.parse(readFileSync(args.previous, "utf-8") || "{}") as { tagName?: string; body?: string })
    : {};

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

if (previous.tagName && previous.body) {
  // Rows of the table above, as written into the previous release.
  const before = new Map(
    [...previous.body.matchAll(/^\| `([^`]+)` \|[^|]*\| ([\d,]+) \|/gm)].map((m) => [m[1]!, Number(m[2]!.replaceAll(",", ""))]),
  );
  const changes: string[] = [];
  // a release whose notes were written by hand has no table to compare with
  if (before.size) {
    for (const s of stats) {
      const was = before.get(s.file);
      if (was === undefined) changes.push(`- \`${s.file}\`: new`);
      else if (was !== s.entries)
        changes.push(`- \`${s.file}\`: ${count(was)} → ${count(s.entries)} entries (${s.entries > was ? "+" : ""}${count(s.entries - was)})`);
    }
    for (const file of before.keys()) if (!stats.some((s) => s.file === file)) changes.push(`- \`${file}\`: no longer built`);
    if (!changes.length) changes.push("- Entry counts are unchanged.");
  }
  const oldSources = previous.body.match(/^Sources: (.*)\.$/m)?.[1];
  if (oldSources && oldSources !== sourceLine) changes.push(`- Sources were ${oldSources}.`);
  else if (oldSources) changes.push("- Same source sheets.");
  if (changes.length) lines.push("", `## Changes since ${previous.tagName}`, "", ...changes);
}

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
