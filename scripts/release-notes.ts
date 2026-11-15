// Writes the notes of a release from reports/stats.json (scripts/validate.ts) and
// reports/build.json (export.ts): one row per zip, the versions of the source sheets, what changed
// since the previous release (read back from the table in that release's notes) and the pinyin
// cells of the 兩岸詞典 sheet that could not be reconciled with their zhuyin cell.
//
// usage: node scripts/release-notes.ts [--previous previous.json] [--out reports/release-notes.md]
//   previous.json is `gh release view --json tagName,body`; left out for the first release.
import { existsSync, readFileSync, writeFileSync } from "fs";
import type { Stats } from "./validate.ts";

const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? undefined : args[i + 1];
};

type Source = { upstream?: string; version?: string; repo?: string; file?: string; blobSha?: string };
const stats = JSON.parse(readFileSync("reports/stats.json", "utf-8")) as Stats[];
const build = JSON.parse(readFileSync("reports/build.json", "utf-8")) as {
  revision: string;
  updateRepo: string;
  sources: Record<string, Source>;
  unresolvedPinyin: string[];
};
const previousPath = arg("previous");
const previous =
  previousPath && existsSync(previousPath)
    ? (JSON.parse(readFileSync(previousPath, "utf-8") || "{}") as { tagName?: string; body?: string })
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
  const changed = stats
    .map((s) => ({ ...s, was: before.get(s.file) }))
    .filter((s) => s.was !== s.entries)
    .map((s) => `- \`${s.file}\`: ${s.was === undefined ? "new" : `${count(s.was)} → ${count(s.entries)} entries (${s.entries > s.was ? "+" : ""}${count(s.entries - s.was)})`}`);
  const oldSources = previous.body.match(/^Sources: (.*)\.$/m)?.[1];
  lines.push("", `## Changes since ${previous.tagName}`, "");
  lines.push(...(changed.length ? changed : before.size ? ["- Entry counts are unchanged."] : []));
  if (oldSources && oldSources !== sourceLine) lines.push(`- Sources were ${oldSources}.`);
  else if (oldSources) lines.push("- Same source sheets.");
}

if (build.unresolvedPinyin.length)
  lines.push(
    "",
    `<details><summary>${build.unresolvedPinyin.length} 兩岸詞典 pinyin cells disagree with the zhuyin cell of their row</summary>`,
    "",
    "```",
    ...build.unresolvedPinyin,
    "```",
    "",
    "</details>",
  );

lines.push(
  "",
  "**Import:** Yomitan → Settings → Dictionaries → Import → pick a zip. " +
    "**Update:** the zips are self-updating: Yomitan → Settings → Dictionaries → *Check for updates*.",
);

const out = arg("out") ?? "reports/release-notes.md";
writeFileSync(out, lines.join("\n") + "\n");
console.log(`wrote ${out}`);
