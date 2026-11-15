// Compares dict/sources.json with what the upstream sites offer now:
//   - the MOE download pages list dict_<name>_<year>_<yyyymmdd>.zip; a later date is a new version
//   - 兩岸詞典.xlsx in g0v/moedict-data-csld is identified by its git blob id
// Downloads nothing. Writes reports/upstream.md and, in GitHub Actions, the `changed` output.
//
// usage: node scripts/upstream-check.ts
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "fs";

const MOE_BASE = "https://language.moe.gov.tw/001/Upload/Files/site_content/M0001/respub/";
const MOE_PAGES = ["dict_concised_download.html", "dict_reviseddict_download.html"];

type Source = { upstream?: string; version?: string; repo?: string; file?: string; blobSha?: string };
const sources = JSON.parse(readFileSync("dict/sources.json", "utf-8")) as Record<string, Source>;

async function get(url: string, headers: Record<string, string> = {}) {
  const response = await fetch(url, { headers: { "user-agent": "moe-dict-yomitan upstream check", ...headers } });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response;
}

// family ("dict_revised_2015") -> the newest version listed and its link
const offered = new Map<string, { version: string; url: string }>();
for (const page of MOE_PAGES) {
  const html = await (await get(MOE_BASE + page)).text();
  for (const [, href, family, version] of html.matchAll(/href="(download\/(dict_[a-z_]+_\d{4})_(\d{8})\.zip)"/g))
    if (version! > (offered.get(family!)?.version ?? "")) offered.set(family!, { version: version!, url: MOE_BASE + href });
}
if (!offered.size) throw new Error("no dataset links found on the MOE download pages; has their layout changed?");

const findings: string[] = [];
for (const [name, source] of Object.entries(sources)) {
  if (source.upstream) {
    const latest = offered.get(source.upstream);
    if (!latest) findings.push(`- **${name}**: \`${source.upstream}\` is no longer listed on the MOE download pages.`);
    else if (latest.version > source.version!)
      findings.push(`- **${name}**: \`${source.upstream}\` ${source.version} → **${latest.version}** ([download](${latest.url}))`);
  } else if (source.repo) {
    const token = process.env.GITHUB_TOKEN;
    const listing = (await (
      await get(`https://api.github.com/repos/${source.repo}/contents/`, token ? { authorization: `Bearer ${token}` } : {})
    ).json()) as { name: string; sha: string }[];
    const sha = listing.find((entry) => entry.name === source.file)?.sha;
    if (!sha) findings.push(`- **${name}**: \`${source.file}\` is no longer in ${source.repo}.`);
    else if (sha !== source.blobSha)
      findings.push(`- **${name}**: \`${source.file}\` in ${source.repo} changed (blob ${source.blobSha?.slice(0, 12)} → **${sha.slice(0, 12)}**)`);
  }
}

const report = findings.length
  ? [
      "The upstream sources have newer versions than `dict/sources.json`:",
      "",
      ...findings,
      "",
      "To update: put the new sheets (and the picture folder) into `dict/`, remove the old ones, point",
      "`dict/sources.json` at them, then check the build of the pull request before running **Build and release**.",
    ]
  : ["The sources in `dict/sources.json` are current."];
mkdirSync("reports", { recursive: true });
writeFileSync("reports/upstream.md", report.join("\n") + "\n");
console.log(report.join("\n"));
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `changed=${findings.length > 0}\n`);
