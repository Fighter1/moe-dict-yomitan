// What a build and its checks have to agree on: which zips there are, what they are called, the
// shape of a revision and the repository whose releases Yomitan asks for updates.
import { execFileSync } from "child_process";
import type { BuildNotes } from "./notes.ts";

export const EDITIONS = [
  { id: "zhuyin", label: "注音" },
  { id: "pinyin", label: "拼音" },
] as const;
export type EditionId = (typeof EDITIONS)[number]["id"];

export const DICTIONARIES = [
  {
    id: "concised",
    stem: "moe-concised",
    index: "concised",
    title: "國語辭典簡編本",
    attribution: "國語辭典簡編本 (2014)",
    description:
      "A monolingual dictionary made for learners of Mandarin Chinese. 主要適用對象：國中、小學生及學習華語人士。",
  },
  {
    id: "revised",
    stem: "moe-revised",
    index: "revised",
    title: "重編國語辭典修訂本",
    attribution: "重編國語辭典修訂本 (2015)",
    description: "A monolingual dictionary made for Mandarin Chinese. 主要適用對象：對歷史語言有興趣的研究者。",
  },
  {
    id: "liangan",
    stem: "liangancidian",
    index: "liangancidian",
    title: "兩岸詞典",
    attribution: "兩岸詞典 (2015)",
    description: "A monolingual dictionary of Mandarin Chinese.",
  },
] as const;
export type DictionaryInfo = (typeof DICTIONARIES)[number];

/** "moe-concised-zhuyin.zip" */
export const zipName = (dictionary: DictionaryInfo, edition: EditionId): `${string}.zip` =>
  `${dictionary.stem}-${edition}.zip`;
/** "index-concised-zhuyin.json": the copy of the zip's index.json that Yomitan fetches (indexUrl). */
export const indexName = (dictionary: DictionaryInfo, edition: EditionId) =>
  `index-${dictionary.index}-${edition}.json`;
/** Every zip a build produces, with its sidecar index file. */
export const OUTPUTS = DICTIONARIES.flatMap((dictionary) =>
  EDITIONS.map((edition) => ({
    dictionary,
    edition,
    zip: zipName(dictionary, edition.id),
    index: indexName(dictionary, edition.id),
  })),
);

// Yomitan compares revisions number by number only when both are dot-separated integers with the
// same number of segments (anything else is compared as text, where "….10" < "….9"). So a revision
// is always date + build number: "2026.11.15.7".
export const REVISION_PATTERN = /^\d{4}\.\d{2}\.\d{2}\.\d+$/;

export function checkRevision(revision: string): string {
  if (!REVISION_PATTERN.test(revision))
    throw new Error(`revision "${revision}" must be four dot-separated integers, e.g. 2026.11.15.7`);
  return revision;
}

/**
 * REVISION from the environment (the release workflow passes the UTC date plus its run number),
 * else the UTC date plus ".0", so a local build never outranks a release of the same day.
 */
export function resolveRevision(fromEnv = process.env.REVISION, now = new Date()): string {
  return checkRevision(fromEnv?.trim() || `${now.toISOString().slice(0, 10).replaceAll("-", ".")}.0`);
}

/** Is `a` a later revision than `b`? Both must match REVISION_PATTERN. */
export function isNewerRevision(a: string, b: string): boolean {
  const [x, y] = [a, b].map((revision) => revision.split(".").map(Number));
  for (let i = 0; i < x!.length; i++) if (x![i] !== y![i]) return x![i]! > y![i]!;
  return false;
}

export const DEFAULT_REPO = "Fighter1/moe-dict-yomitan";

/** "owner/name" of a GitHub remote URL (https, scp-style or ssh://, with or without a port). */
export function repoFromRemoteUrl(url: string): string | undefined {
  return url
    .trim()
    .match(
      /^(?:https?:\/\/(?:[^@/]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@(?:ssh\.)?github\.com(?::\d+)?\/)([^/]+\/[^/]+?)(?:\.git)?\/?$/,
    )?.[1];
}

/**
 * The repository whose latest release Yomitan asks for updates: GITHUB_REPOSITORY in GitHub
 * Actions, else whatever the `origin` remote points at, so a fork's zips point at the fork.
 */
export function resolveRepo(): string {
  const fromEnv = process.env.GITHUB_REPOSITORY?.trim();
  if (fromEnv) return fromEnv;
  try {
    const url = execFileSync("git", ["remote", "get-url", "origin"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const repo = repoFromRemoteUrl(url);
    if (repo) return repo;
    console.warn(`origin (${url.trim()}) is not a GitHub repository; the update URLs point at ${DEFAULT_REPO}`);
  } catch {
    // not a git checkout
  }
  return DEFAULT_REPO;
}

/** `releases/latest/download/<asset>` always redirects to that asset of the newest release. */
export const releaseBaseUrl = (repo: string) => `https://github.com/${repo}/releases/latest/download/`;

/** dict/sources.json: where each source sheet is and which upstream version it is. */
export type Source = {
  path: string;
  /** MOE sheets: the dataset name on the download pages and the date in its file name */
  upstream?: string;
  version?: string;
  /** the picture set: the sheet that maps entries to the pictures in `path` */
  index?: string;
  /** sheets kept in a GitHub repository: where, and the git blob id of the copy in `path` */
  repo?: string;
  file?: string;
  blobSha?: string;
};
export type Sources = Record<"concised" | "concisedPics" | "revised" | "liangan", Source>;

/** reports/build.json, written by export.ts. */
export type BuildReport = { revision: string; updateRepo: string; sources: Sources } & BuildNotes;
