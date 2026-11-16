// The "Changes since <tag>" section of the release notes (scripts/release-notes.ts): the counts
// of every zip next to their change, whether the source sheets changed, the commits, and a link
// to GitHub's comparison of the two tags. The same layout as the notes of mdx-yomitan and Baidu-Baike-Yomitan. In a file of its own so that
// the tests can call it: release-notes.ts reads and writes files as soon as it is loaded.
import type { Stats } from "./validate.ts";

export const MAX_LISTED_COMMITS = 40;

/** `gh release view --json tagName,body` of the release before this one. */
export type PreviousRelease = { tagName?: string; body?: string };
/** One commit of `gh api repos/OWNER/REPO/compare/PREVIOUS_TAG...HEAD`, as release.yml stores it. */
export type Commit = { sha?: string; message: string };

const count = (n: number) => n.toLocaleString("en");

/** A count next to what it was in the previous release: "269,298 (+1,234)", "163,909 (same)". */
export function delta(now: number, was: number | undefined): string {
  if (was === undefined) return `${count(now)} (new)`;
  if (now === was) return `${count(now)} (same)`;
  return `${count(now)} (${now > was ? "+" : "-"}${count(Math.abs(now - was))})`;
}

/**
 * The lines of the section, heading first; none when there is no previous release. A part that
 * cannot be worked out is left out; the link at the end is always there, so after notes written
 * by hand, with the commits unknown, the section is its heading and the link.
 *
 * @param stats the zips of this release
 * @param sources the source sheets of this release, worded as in the "Sources:" line under the
 *   table of zips; the previous release's line is read back from its notes
 * @param commits the commits since the previous release's tag, oldest first; undefined when
 *   they could not be listed, which is not the same as there being none
 * @param release this release: the repository its zips ask for updates and its tag
 */
export function changesSince(
  previous: PreviousRelease,
  stats: Pick<Stats, "file" | "entries" | "terms">[],
  sources: string,
  commits: Commit[] | undefined,
  release: { repo: string; tag: string },
): string[] {
  if (!previous.tagName) return [];
  const body = previous.body ?? "";
  const parts: string[][] = [];

  // The rows of the table of zips, as written into the previous release: file, dictionary,
  // entries, terms, size. (The table of this section has no size column, so its rows in the
  // previous notes are not taken for them.) Notes written by hand have no such table.
  const number = (text: string) => Number(text.replaceAll(",", ""));
  const before = new Map(
    [...body.matchAll(/^\| `([^`]+)` \|[^|]*\| ([\d,]+) \| ([\d,]+) \| [\d.,]+ MB \|$/gm)].map((m) => [
      m[1]!,
      { entries: number(m[2]!), terms: number(m[3]!) },
    ]),
  );
  if (before.size) {
    // entries are what a dictionary defines; terms are the spellings and readings they are found
    // by, which is where a change like added lookup spellings shows
    const table = [
      "| file | entries | terms |",
      "|---|---:|---:|",
      ...stats.map((s) => {
        const was = before.get(s.file);
        return `| \`${s.file}\` | ${delta(s.entries, was?.entries)} | ${delta(s.terms, was?.terms)} |`;
      }),
    ];
    const gone = [...before.keys()].filter((file) => !stats.some((s) => s.file === file));
    parts.push(gone.length ? [...table, "", ...gone.map((file) => `- \`${file}\`: no longer built`)] : table);
  }

  const oldSources = body.match(/^Sources: (.*)\.$/m)?.[1];
  if (oldSources)
    parts.push([
      oldSources === sources
        ? "**Sources:** the same source sheets as the previous release."
        : `**Sources:** the previous release was built from ${oldSources}.`,
    ]);

  if (commits) {
    // without merge commits, which only repeat what the merged commits say
    const subjects = commits
      .map(({ message }) => message.split("\n")[0]!.trim())
      .filter((subject) => subject && !/^Merge (branch|pull request|remote-tracking) /.test(subject));
    const shown = subjects.slice(0, MAX_LISTED_COMMITS);
    parts.push(
      subjects.length
        ? [
            `**Code:** ${subjects.length} commit${subjects.length === 1 ? "" : "s"}.`,
            ...shown.map((subject) => `- ${subject}`),
            ...(subjects.length > shown.length ? [`- … and ${subjects.length - shown.length} more`] : []),
          ]
        : ["**Code:** no commits; the same code as the previous release."],
    );
  }

  // GitHub's comparison of the two tags. Written here and not by `gh release create
  // --generate-notes`, which also lists merged pull requests and new contributors, repeating
  // the commits above, and puts its link at the very end of the notes.
  const span = `${previous.tagName}...${release.tag}`;
  parts.push([`**Full Changelog**: [${span}](https://github.com/${release.repo}/compare/${span})`]);

  return [`## Changes since ${previous.tagName}`, ...parts.flatMap((part) => ["", ...part])];
}
