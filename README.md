# moe-dict-yomitan

Yomitan dictionaries built from Taiwan's Ministry of Education dictionaries, each in a 注音 and a 拼音 edition:

| dictionary | 注音 | 拼音 |
|---|---|---|
| 國語辭典簡編本 | [moe-concised-zhuyin.zip](https://github.com/Fighter1/moe-dict-yomitan/releases/latest/download/moe-concised-zhuyin.zip) | [moe-concised-pinyin.zip](https://github.com/Fighter1/moe-dict-yomitan/releases/latest/download/moe-concised-pinyin.zip) |
| 重編國語辭典修訂本 | [moe-revised-zhuyin.zip](https://github.com/Fighter1/moe-dict-yomitan/releases/latest/download/moe-revised-zhuyin.zip) | [moe-revised-pinyin.zip](https://github.com/Fighter1/moe-dict-yomitan/releases/latest/download/moe-revised-pinyin.zip) |
| 兩岸詞典 | [liangancidian-zhuyin.zip](https://github.com/Fighter1/moe-dict-yomitan/releases/latest/download/liangancidian-zhuyin.zip) | [liangancidian-pinyin.zip](https://github.com/Fighter1/moe-dict-yomitan/releases/latest/download/liangancidian-pinyin.zip) |

Import a zip in Yomitan → Settings → Dictionaries → Import. The zips are self-updating: *Check for updates* on the same page offers the newest release. A zip installed from an older source of these dictionaries has to be imported again once, because it asks a different address for updates.

# Build

Needs Node 22.18 or newer, except 23.0 to 23.5 (the workflows use the version in `.nvmrc`). Run everything from the repository root.

```
npm ci
npm test
npm run build
npm run validate
```

- `npm test` runs the unit tests in `test/`: the parsers, the pinyin handling and the revision rules. They need no sheets.
- `npm run build` writes the six zips and their `index-*.json` files to `build/`, and what it noticed about the sheets to `reports/build.json`.
- `npm run validate` checks the zips in `build/` and writes their entry counts to `reports/stats.json`. It checks that:
  - all six zips are there, with the same revision, and every zip, term bank and index passes Yomitan's schemas (`schemas/`, copied from the [Yomitan repository](https://github.com/yomidevs/yomitan/tree/master/ext/data/schemas));
  - the update URLs point at this repository and the `index-*.json` next to each zip is the zip's own index;
  - the golden words in `dict/golden_words.tsv` are present with their readings;
  - every referenced image is in the zip, and the 注音 and 拼音 editions of a dictionary have the same entries.
- `npm run typecheck` runs TypeScript. The files themselves are run by Node, which only strips the types.

`validate` takes `--dir` (another folder than `build/`), `--repo owner/name`, `--revision` (the revision every zip must have) and `--after` (a released revision the zips must be newer than).

Three environment variables change what a build produces:

| variable | default | meaning |
|---|---|---|
| `REVISION` | UTC date + `.0`, e.g. `2026.11.15.0` | the revision stamped into each `index.json`; four dot-separated integers, which Yomitan compares number by number |
| `GITHUB_REPOSITORY` | the `origin` remote, else `Fighter1/moe-dict-yomitan` | the repository whose latest release Yomitan asks for updates (GitHub Actions sets it) |
| `OUT_DIR` | `build` | where the zips and index files are written |

# Code

| file | what it does |
|---|---|
| `export.ts` | the build: one zip per dictionary and edition |
| `release.ts` | the list of zips, the shape of a revision, the update repository |
| `moe_dics.ts` | 國語辭典簡編本 and 重編國語辭典修訂本 |
| `liangan.ts` | 兩岸詞典 |
| `content.ts` | what the parsers share: reading a sheet, building structured content, adding an entry |
| `pinyin.ts`, `utils.ts` | splitting joined pinyin, checking it against zhuyin, zhuyin → pinyin |
| `parse_html.ts` | the tables and inline HTML in 兩岸詞典 definitions |
| `readings.ts` | both editions carry both reading systems; each edition's `styles.css` hides the other |
| `notes.ts` | what a build noticed about the sheets, for `reports/build.json` |
| `styles.css` | the styles every zip gets |
| `d.d.ts` | types of the `pinyin-tone-tool` package |
| `scripts/` | `validate.ts`, `release-notes.ts`, `upstream-check.ts` |
| `test/` | the unit tests |
| `dict/` | the source sheets, `sources.json` and `golden_words.tsv` |

The sheets in `dict/` are the upstream files as they are. Corrections to them live in the code: `PINYIN_TYPOS` and `DEFINITION_FIXES` in `liangan.ts`.

A build reports the readings it could not take from the sheets as they are. The lists are in `reports/build.json` and in the release notes:

- pinyin it derived from the zhuyin cell, because the pinyin cell is empty, cut short or not pinyin;
- pinyin whose tone differs from the zhuyin cell of its row (left as it is);
- 兩岸詞典 pinyin that could not be reconciled with the zhuyin cell of its row.

# Release

Run the **Build and release** workflow from the Actions tab. It tests, builds, validates and publishes the zips as the latest release, tagged `v<revision>`, where the revision is the UTC date plus the run number. Its notes list the dictionaries with their entry counts, the versions of the source sheets and what changed since the previous release.

It has two inputs: `publish` (off: build only, the zips are kept as a workflow artifact) and `revision` (to choose the revision yourself). It refuses to publish from another branch than the default one, a commit that is no longer the head of that branch, a tag that exists, and a revision that is not newer than the latest release, because Yomitan would not offer it.

Nothing is released on a push; pushes to `main` and pull requests only run **Build and check** (typecheck, tests, build, validate), which keeps the zips as a workflow artifact.

# Source

Dictionary files from [here (moe)](https://language.moe.gov.tw/001/Upload/Files/site_content/M0001/respub/index.html) and [here (liang'an)](https://github.com/g0v/moedict-data-csld/blob/master/%E5%85%A9%E5%B2%B8%E8%A9%9E%E5%85%B8.xlsx).

`dict/sources.json` records which version of each sheet is in `dict/` and where the build reads it. The weekly **Upstream check** workflow compares it with the two sites:

- When a newer sheet is offered, it downloads it into `dict/`, updates `dict/sources.json` and opens a pull request from the `upstream-sources` branch, on which it starts **Build and check**. This needs "Allow GitHub Actions to create and approve pull requests" in the repository's Actions settings.
- When a source is no longer offered, it opens an issue, which it closes again once everything is current.

`npm run upstream-check` reports the same locally, and `npm run upstream-check -- --update` does the replacement.

# Dependencies

Dependabot opens a pull request a week for npm packages (minor and patch updates together, each major on its own) and one for the GitHub Actions the workflows use. It leaves major versions of `@types/node` alone: that package follows the Node version in `.nvmrc`, and the two are raised together by hand. `xlsx` is installed from a tarball on cdn.sheetjs.com, which Dependabot does not track, so that one is updated by hand. `allowScripts` in `package.json` records that the install script of `opencc` may run.
