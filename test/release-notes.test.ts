// run with: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_LISTED_COMMITS, changesSince, delta, type Commit, type PreviousRelease } from "../scripts/changes-since.ts";

const SOURCES = "`dict_concised_2014_20260929`, `g0v/moedict-data-csld@871bb1f20362`";
/** The notes of a release as release-notes.ts writes them: the table of zips and the Sources line. */
const notes = (rows: [file: string, entries: string, terms: string][], sources = SOURCES) =>
  [
    "MOE dictionaries for Yomitan, revision 2026.11.16.2.",
    "",
    "| file | dictionary | entries | terms | size |",
    "|---|---|---:|---:|---:|",
    ...rows.map(([file, entries, terms]) => `| \`${file}\` | 辭典 注音 | ${entries} | ${terms} | 18.8 MB |`),
    "",
    `Sources: ${sources}.`,
    "",
    "**Import:** Yomitan → Settings → Dictionaries → Import → pick a zip.",
  ].join("\n");
const STATS = [
  { file: "moe-concised-zhuyin.zip", entries: 45178, terms: 72847 },
  { file: "moe-revised-zhuyin.zip", entries: 163909, terms: 269298 },
];
const previous = (body: string) => ({ tagName: "v2026.11.16.2", body });
/** The section for a release v2026.11.17.5 of someone/their-fork. */
const section = (before: PreviousRelease, commits: Commit[] | undefined, sources = SOURCES) =>
  changesSince(before, STATS, sources, commits, { repo: "someone/their-fork", tag: "v2026.11.17.5" });
// the link every section ends with, after a blank line
const LINK =
  "**Full Changelog**: [v2026.11.16.2...v2026.11.17.5](https://github.com/someone/their-fork/compare/v2026.11.16.2...v2026.11.17.5)";

test("a count is shown next to its change", () => {
  assert.equal(delta(269298, 264911), "269,298 (+4,387)");
  assert.equal(delta(163909, 163909), "163,909 (same)");
  assert.equal(delta(988, 1000), "988 (-12)");
  assert.equal(delta(72847, undefined), "72,847 (new)");
});

test("changes since: the counts, the sources, the commits and the changelog link", () => {
  const body = notes([
    ["moe-concised-zhuyin.zip", "45,178", "71,884"],
    ["moe-revised-zhuyin.zip", "163,921", "264,911"],
  ]);
  const commits = [
    { sha: "a1", message: "Lay out labels and headings more like the online dictionary\n\n- a body line" },
    { sha: "b2", message: "Merge pull request #7 from someone/branch\n\nUpdate the sheets" },
    { sha: "c3", message: "  Find entries by their Hong Kong spellings  " },
  ];
  assert.deepEqual(section(previous(body), commits), [
    "## Changes since v2026.11.16.2",
    "",
    "| file | entries | terms |",
    "|---|---:|---:|",
    "| `moe-concised-zhuyin.zip` | 45,178 (same) | 72,847 (+963) |",
    "| `moe-revised-zhuyin.zip` | 163,909 (-12) | 269,298 (+4,387) |",
    "",
    "**Sources:** the same source sheets as the previous release.",
    "",
    "**Code:** 2 commits.", // oldest first, subjects only, without the merge commit
    "- Lay out labels and headings more like the online dictionary",
    "- Find entries by their Hong Kong spellings",
    "",
    LINK,
  ]);
});

test("changes since: a new zip, one that is no longer built, other sources", () => {
  const body = notes(
    [
      ["moe-concised-zhuyin.zip", "45,178", "72,847"],
      ["moe-old-zhuyin.zip", "1,000", "2,000"],
    ],
    "`dict_concised_2014_20250101`",
  );
  assert.deepEqual(section(previous(body), [{ message: "One commit" }]), [
    "## Changes since v2026.11.16.2",
    "",
    "| file | entries | terms |",
    "|---|---:|---:|",
    "| `moe-concised-zhuyin.zip` | 45,178 (same) | 72,847 (same) |",
    "| `moe-revised-zhuyin.zip` | 163,909 (new) | 269,298 (new) |",
    "",
    "- `moe-old-zhuyin.zip`: no longer built",
    "",
    "**Sources:** the previous release was built from `dict_concised_2014_20250101`.",
    "",
    "**Code:** 1 commit.",
    "- One commit",
    "",
    LINK,
  ]);
});

test("changes since: commits that could not be listed are left out; none is said", () => {
  const body = notes([
    ["moe-concised-zhuyin.zip", "45,178", "72,847"],
    ["moe-revised-zhuyin.zip", "163,909", "269,298"],
  ]);
  const unknown = section(previous(body), undefined);
  assert.equal(unknown.some((line) => line.includes("**Code:**")), false);
  assert.deepEqual(unknown.slice(-3), ["**Sources:** the same source sheets as the previous release.", "", LINK]);
  // the same section with the Code part before the link
  assert.deepEqual(section(previous(body), []), [
    ...unknown.slice(0, -1),
    "**Code:** no commits; the same code as the previous release.",
    "",
    LINK,
  ]);
});

test("changes since: a long list of commits is cut", () => {
  const commits = Array.from({ length: MAX_LISTED_COMMITS + 3 }, (_, i) => ({ message: `commit ${i + 1}` }));
  const lines = section(previous("written by hand"), commits);
  assert.equal(lines[2], `**Code:** ${MAX_LISTED_COMMITS + 3} commits.`);
  assert.equal(lines[3], "- commit 1");
  assert.deepEqual(lines.slice(-4), [`- commit ${MAX_LISTED_COMMITS}`, "- … and 3 more", "", LINK]);
  assert.equal(lines.length, 3 + MAX_LISTED_COMMITS + 1 + 2);
});

test("changes since: no previous release, no section", () => {
  assert.deepEqual(section({}, undefined), []);
  assert.deepEqual(section({}, [{ message: "A commit" }]), []);
  assert.deepEqual(section({ body: "notes without a tag" }, []), []);
});

test("changes since: a part that cannot be worked out is left out; the link is always there", () => {
  // notes written by hand have no table and no Sources line; with the commits unknown, the
  // section is its heading and the link
  assert.deepEqual(section(previous("Written by hand."), undefined), ["## Changes since v2026.11.16.2", "", LINK]);
  assert.deepEqual(section({ tagName: "v2026.11.16.2" }, undefined), ["## Changes since v2026.11.16.2", "", LINK]);
  assert.deepEqual(section(previous("Written by hand."), [{ message: "A fix" }]), [
    "## Changes since v2026.11.16.2",
    "",
    "**Code:** 1 commit.",
    "- A fix",
    "",
    LINK,
  ]);
  assert.deepEqual(section({ tagName: "v2026.11.16.2" }, []), [
    "## Changes since v2026.11.16.2",
    "",
    "**Code:** no commits; the same code as the previous release.",
    "",
    LINK,
  ]);
});

test("changes since: the link names the two tags and the repository it is given", () => {
  const lines = changesSince({ tagName: "v1.2.3.4" }, STATS, SOURCES, undefined, { repo: "Fighter1/moe-dict-yomitan", tag: "v2026.11.17.5" });
  assert.equal(
    lines.at(-1),
    "**Full Changelog**: [v1.2.3.4...v2026.11.17.5](https://github.com/Fighter1/moe-dict-yomitan/compare/v1.2.3.4...v2026.11.17.5)",
  );
});

test("changes since: the previous release's own section is not read as its table of zips", () => {
  // a previous release that already has this section: its rows have no size column, and its
  // Sources and Full Changelog lines are not the ones under the table of zips
  const body = [
    notes([
      ["moe-concised-zhuyin.zip", "45,178", "72,847"],
      ["moe-revised-zhuyin.zip", "163,909", "269,000"],
    ]),
    "",
    "## Changes since v2026.11.16.1",
    "",
    "| file | entries | terms |",
    "|---|---:|---:|",
    "| `moe-concised-zhuyin.zip` | 45,178 (same) | 72,847 (+963) |",
    "| `moe-revised-zhuyin.zip` | 163,909 (same) | 269,000 (+4,089) |",
    "| `moe-gone-zhuyin.zip` | 5 (new) | 9 (new) |",
    "",
    "**Sources:** the previous release was built from `something_else`.",
    "",
    "**Full Changelog**: [v2026.11.16.1...v2026.11.16.2](https://github.com/someone/their-fork/compare/v2026.11.16.1...v2026.11.16.2)",
  ].join("\n");
  assert.deepEqual(section(previous(body), undefined), [
    "## Changes since v2026.11.16.2",
    "",
    "| file | entries | terms |",
    "|---|---:|---:|",
    "| `moe-concised-zhuyin.zip` | 45,178 (same) | 72,847 (same) |",
    "| `moe-revised-zhuyin.zip` | 163,909 (same) | 269,298 (+298) |",
    "",
    "**Sources:** the same source sheets as the previous release.",
    "",
    LINK,
  ]);
});
