// Compares dict/sources.json with what the upstream sites offer now:
//   - the MOE download pages list dict_<name>_<year>_<yyyymmdd>.zip; a later date is a new version
//   - 兩岸詞典.xlsx in g0v/moedict-data-csld is identified by its git blob id
// Without --update it downloads nothing and only reports. With --update it downloads each newer
// MOE zip, puts its sheet (and picture folder) into dict/, removes the old ones and points
// dict/sources.json at the new files; a changed 兩岸詞典.xlsx is downloaded over the old one.
// Writes reports/upstream.md and, in GitHub Actions, the outputs `updated` (files in dict/ were
// replaced) and `manual` (a source is no longer offered, which needs a person).
//
// usage: node scripts/upstream-check.ts [--update]
import { createHash } from "crypto";
import JSZip from "jszip";
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { basename } from "path";

const MOE_BASE = "https://language.moe.gov.tw/001/Upload/Files/site_content/M0001/respub/";
const MOE_PAGES = ["dict_concised_download.html", "dict_reviseddict_download.html"];
const SOURCES_FILE = "dict/sources.json";
const update = process.argv.includes("--update");

type Source = { upstream?: string; version?: string; path: string; index?: string; repo?: string; file?: string; blobSha?: string };
const sources = JSON.parse(readFileSync(SOURCES_FILE, "utf-8")) as Record<string, Source>;

async function get(url: string, headers: Record<string, string> = {}) {
  const response = await fetch(url, { headers: { "user-agent": "moe-dict-yomitan upstream check", ...headers } });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response;
}

/** Replaces the files of one MOE source with those of the zip at `url`. */
async function replaceFromZip(source: Source, version: string, url: string) {
  const stem = `${source.upstream}_${version}`;
  const zip = await JSZip.loadAsync(Buffer.from(await (await get(url)).arrayBuffer()));
  const sheet = zip.file(`${stem}.xlsx`);
  if (!sheet) throw new Error(`${url} has no ${stem}.xlsx`);
  // the picture set is a folder of images next to its index sheet; names are taken as plain
  // file names, so nothing in the zip can be written outside dict/
  const pictures = Object.values(zip.files).filter((f) => !f.dir && f.name.startsWith(`${stem}/`) && /^[\w.-]+$/.test(basename(f.name)));
  const isPictureSet = source.index !== undefined;
  if (isPictureSet && !pictures.length) throw new Error(`${url} has no ${stem}/ picture folder`);

  for (const old of [source.path, source.index]) if (old?.startsWith("dict/")) rmSync(old, { recursive: true, force: true });
  writeFileSync(`dict/${stem}.xlsx`, await sheet.async("nodebuffer"));
  if (isPictureSet) {
    mkdirSync(`dict/${stem}`, { recursive: true });
    for (const picture of pictures) writeFileSync(`dict/${stem}/${basename(picture.name)}`, await picture.async("nodebuffer"));
    source.path = `dict/${stem}`;
    source.index = `dict/${stem}.xlsx`;
  } else source.path = `dict/${stem}.xlsx`;
  source.version = version;
}

/** Replaces a sheet kept in a GitHub repository; `sha` is the git blob id its listing reports. */
async function replaceFromRepo(source: Source, sha: string) {
  const url = `https://raw.githubusercontent.com/${source.repo}/HEAD/${encodeURIComponent(source.file!)}`;
  const bytes = Buffer.from(await (await get(url)).arrayBuffer());
  // a git blob id is the SHA-1 of "blob <size>\0" followed by the content
  const downloaded = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
  if (downloaded !== sha) throw new Error(`${url}: downloaded blob ${downloaded}, the listing says ${sha}`);
  writeFileSync(source.path, bytes);
  source.blobSha = sha;
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
for (const [name, source] of Object.entries(sources)) {
  if (source.upstream) {
    const latest = offered.get(source.upstream);
    if (!latest) manual.push(`- **${name}**: \`${source.upstream}\` is no longer listed on the MOE download pages.`);
    else if (latest.version > source.version!) {
      newer.push(`- **${name}**: \`${source.upstream}\` ${source.version} → **${latest.version}** ([download](${latest.url}))`);
      if (update) {
        await replaceFromZip(source, latest.version, latest.url);
        console.log(`replaced ${name} with ${source.upstream}_${latest.version}`);
      }
    }
  } else if (source.repo) {
    const token = process.env.GITHUB_TOKEN;
    const listing = (await (
      await get(`https://api.github.com/repos/${source.repo}/contents/`, token ? { authorization: `Bearer ${token}` } : {})
    ).json()) as { name: string; sha: string }[];
    const sha = listing.find((entry) => entry.name === source.file)?.sha;
    if (!sha) manual.push(`- **${name}**: \`${source.file}\` is no longer in ${source.repo}.`);
    else if (sha !== source.blobSha) {
      newer.push(`- **${name}**: \`${source.file}\` in ${source.repo} changed (blob ${source.blobSha?.slice(0, 12)} → **${sha.slice(0, 12)}**)`);
      if (update) {
        await replaceFromRepo(source, sha);
        console.log(`replaced ${name} with ${source.file} ${sha.slice(0, 12)}`);
      }
    }
  }
}
const updated = update && newer.length > 0;
if (updated) writeFileSync(SOURCES_FILE, JSON.stringify(sources, null, 2) + "\n");

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
