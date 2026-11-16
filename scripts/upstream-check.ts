// Compares dict/sources.json with what the upstream sites offer now:
//   - the MOE download pages list dict_<name>_<year>_<yyyymmdd>.zip; a later date is a new version
//   - 兩岸詞典.xlsx in g0v/moedict-data-csld is identified by its git blob id
// Without --update it downloads nothing and only reports. With --update it downloads each newer
// MOE zip, puts its sheet (and picture folder) into dict/, removes the old ones and points
// dict/sources.json at the new files; a changed 兩岸詞典.xlsx is downloaded over the old one.
// Everything is downloaded and checked before anything in dict/ is touched, so a failed
// download leaves dict/ and dict/sources.json as they were.
// Writes reports/upstream.md and, in GitHub Actions, the outputs `newer` (upstream offers
// something newer), `updated` (files in dict/ were replaced) and `manual` (a source is no longer
// offered, which needs a person).
//
// usage: node scripts/upstream-check.ts [--update]
import { createHash } from "crypto";
import JSZip from "jszip";
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { basename } from "path";
import type { Source } from "../release.ts";

const MOE_BASE = "https://language.moe.gov.tw/001/Upload/Files/site_content/M0001/respub/";
const MOE_PAGES = ["dict_concised_download.html", "dict_reviseddict_download.html"];
const SOURCES_FILE = "dict/sources.json";
const PICTURE = /^[\w.-]+\.(?:jpe?g|gif|png|bmp|webp)$/i;
const IGNORED_FILES = new Set(["Thumbs.db", ".DS_Store", "desktop.ini"]);
const update = process.argv.includes("--update");

const sources = JSON.parse(readFileSync(SOURCES_FILE, "utf-8")) as Record<string, Source>;

async function get(url: string, headers: Record<string, string> = {}) {
  const response = await fetch(url, { headers: { "user-agent": "moe-dict-yomitan upstream check", ...headers } });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response;
}
const githubHeaders = (): Record<string, string> =>
  process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {};

/** What replacing one source means on disk; nothing is written until all of them are known. */
type Replacement = { files: Map<string, Buffer>; remove: string[]; apply(): void };

/** The files of the newer MOE zip at `url` and the changes to `source` that go with them. */
async function fromMoeZip(source: Source, version: string, url: string): Promise<Replacement> {
  const stem = `${source.upstream}_${version}`;
  const zip = await JSZip.loadAsync(Buffer.from(await (await get(url)).arrayBuffer()));
  const sheet = zip.file(`${stem}.xlsx`);
  if (!sheet) throw new Error(`${url} has no ${stem}.xlsx`);
  const files = new Map([[`dict/${stem}.xlsx`, await sheet.async("nodebuffer")]]);
  const isPictureSet = source.index !== undefined;
  if (isPictureSet) {
    // The picture set is a folder of images next to its index sheet. Names are taken as plain
    // file names, so nothing in the zip can be written outside dict/.
    for (const entry of Object.values(zip.files).filter((f) => !f.dir && f.name.startsWith(`${stem}/`))) {
      const name = basename(entry.name);
      if (IGNORED_FILES.has(name)) continue;
      const path = `dict/${stem}/${name}`;
      if (!PICTURE.test(name) || files.has(path)) throw new Error(`${url}: unexpected file ${entry.name} in the picture folder`);
      files.set(path, await entry.async("nodebuffer"));
    }
    if (files.size === 1) throw new Error(`${url} has no ${stem}/ picture folder`);
  }
  return {
    files,
    remove: [source.path, source.index].filter((path): path is string => !!path?.startsWith("dict/")),
    apply() {
      source.version = version;
      source.path = isPictureSet ? `dict/${stem}` : `dict/${stem}.xlsx`;
      if (isPictureSet) source.index = `dict/${stem}.xlsx`;
    },
  };
}

/** A sheet kept in a GitHub repository, fetched by the git blob id its listing reports. */
async function fromRepo(source: Source, sha: string): Promise<Replacement> {
  const url = `https://api.github.com/repos/${source.repo}/git/blobs/${sha}`;
  const bytes = Buffer.from(await (await get(url, { accept: "application/vnd.github.raw", ...githubHeaders() })).arrayBuffer());
  // a git blob id is the SHA-1 of "blob <size>\0" followed by the content
  const downloaded = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
  if (downloaded !== sha) throw new Error(`${url}: the download has blob id ${downloaded}`);
  return { files: new Map([[source.path, bytes]]), remove: [], apply: () => void (source.blobSha = sha) };
}

// family ("dict_revised_2015") -> the newest version listed and its link
const offered = new Map<string, { version: string; url: string }>();
for (const page of MOE_PAGES) {
  const html = await (await get(MOE_BASE + page)).text();
  for (const [, href, family, version] of html.matchAll(/href="(download\/(dict_[a-z_]+_\d{4})_(\d{8})\.zip)"/g))
    if (version! > (offered.get(family!)?.version ?? "")) offered.set(family!, { version: version!, url: MOE_BASE + href });
}
if (!offered.size) throw new Error("no dataset links found on the MOE download pages; has their layout changed?");

const newer: string[] = []; // sources with a later version (replaced when --update)
const manual: string[] = []; // changes this script does not apply
const replacements: Replacement[] = [];
for (const [name, source] of Object.entries(sources)) {
  if (source.upstream) {
    if (!/^\d{8}$/.test(source.version ?? "")) throw new Error(`${SOURCES_FILE}: ${name} has no version`);
    const latest = offered.get(source.upstream);
    if (!latest) manual.push(`- **${name}**: \`${source.upstream}\` is no longer listed on the MOE download pages.`);
    else if (latest.version > source.version!) {
      newer.push(`- **${name}**: \`${source.upstream}\` ${source.version} → **${latest.version}** ([download](${latest.url}))`);
      if (update) replacements.push(await fromMoeZip(source, latest.version, latest.url));
    }
  } else if (source.repo) {
    const listing = (await (await get(`https://api.github.com/repos/${source.repo}/contents/`, githubHeaders())).json()) as {
      name: string;
      sha: string;
    }[];
    const sha = listing.find((entry) => entry.name === source.file)?.sha;
    if (!sha) manual.push(`- **${name}**: \`${source.file}\` is no longer in ${source.repo}.`);
    else if (sha !== source.blobSha) {
      newer.push(`- **${name}**: \`${source.file}\` in ${source.repo} changed (blob ${source.blobSha?.slice(0, 12)} → **${sha.slice(0, 12)}**)`);
      if (update) replacements.push(await fromRepo(source, sha));
    }
  }
}

// Everything is downloaded: new files first, then the manifest, and the old files last.
const updated = replacements.length > 0;
if (updated) {
  const written = new Set<string>();
  for (const { files } of replacements)
    for (const [path, bytes] of files) {
      mkdirSync(path.slice(0, path.lastIndexOf("/")), { recursive: true });
      writeFileSync(path, bytes);
      written.add(path);
    }
  for (const replacement of replacements) replacement.apply();
  writeFileSync(SOURCES_FILE, JSON.stringify(sources, null, 2) + "\n");
  const kept = new Set(Object.values(sources).flatMap((source) => [source.path, source.index]));
  for (const { remove } of replacements)
    for (const path of remove) if (!kept.has(path) && !written.has(path)) rmSync(path, { recursive: true, force: true });
  console.log(`replaced ${written.size} files in dict/`);
}

const report: string[] = [];
if (newer.length)
  report.push(
    updated ? "The source sheets in `dict/` were replaced with the versions now offered upstream:" : "The upstream sources have newer versions than `dict/sources.json`:",
    "",
    ...newer,
    "",
    ...(updated
      ? ["`dict/sources.json` points at the new files. Check the build of this change before running **Build and release**."]
      : ["Run `node scripts/upstream-check.ts --update` to download them into `dict/` and update `dict/sources.json`."]),
  );
if (manual.length)
  report.push(...(report.length ? [""] : []), "These changes are not applied automatically and need a look:", "", ...manual);
if (!report.length) report.push("The sources in `dict/sources.json` are current.");

mkdirSync("reports", { recursive: true });
writeFileSync("reports/upstream.md", report.join("\n") + "\n");
console.log(report.join("\n"));
if (process.env.GITHUB_OUTPUT)
  appendFileSync(process.env.GITHUB_OUTPUT, `updated=${updated}\nnewer=${newer.length > 0}\nmanual=${manual.length > 0}\n`);
