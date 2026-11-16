# moe-dict-yomitan

Yomitan dictionaries built from Taiwan's Ministry of Education dictionaries, each in a 注音 and a 拼音 edition:

| dictionary | 注音 | 拼音 |
|---|---|---|
| 國語辭典簡編本 | [moe-concised-zhuyin.zip](https://github.com/Fighter1/moe-dict-yomitan/releases/latest/download/moe-concised-zhuyin.zip) | [moe-concised-pinyin.zip](https://github.com/Fighter1/moe-dict-yomitan/releases/latest/download/moe-concised-pinyin.zip) |
| 重編國語辭典修訂本 | [moe-revised-zhuyin.zip](https://github.com/Fighter1/moe-dict-yomitan/releases/latest/download/moe-revised-zhuyin.zip) | [moe-revised-pinyin.zip](https://github.com/Fighter1/moe-dict-yomitan/releases/latest/download/moe-revised-pinyin.zip) |
| 兩岸詞典 | [liangancidian-zhuyin.zip](https://github.com/Fighter1/moe-dict-yomitan/releases/latest/download/liangancidian-zhuyin.zip) | [liangancidian-pinyin.zip](https://github.com/Fighter1/moe-dict-yomitan/releases/latest/download/liangancidian-pinyin.zip) |

Import a zip in Yomitan → Settings → Dictionaries → Import. The zips are self-updating: *Check for updates* on the same page offers the newest release. A zip installed from an older source of these dictionaries has to be imported again once, because it asks a different address for updates.

# Build

Needs Node 22.18 or newer (the workflows use the version in `.nvmrc`). Run everything from the repository root.

```
npm ci
npm test
npm run build
npm run validate
```

- `npm test` runs the unit tests in `test/` (the parsers and the pinyin handling, no sheets needed).
- `npm run build` writes the six zips and their `index-*.json` files to `build/` (or `OUT_DIR`), and what it noticed about the sheets to `reports/build.json`.
- `npm run validate` checks the zips against Yomitan's schemas (`schemas/`, copied from the [Yomitan repository](https://github.com/yomidevs/yomitan/tree/master/ext/data/schemas)), checks the update URLs, that the golden words in `dict/golden_words.tsv` are present with their readings, and that every referenced image is in the zip. With `--dir` it checks another folder than `build/`.
- `npm run typecheck` runs TypeScript. The files themselves are run by Node, which only strips the types.

Two environment variables change what is stamped into each `index.json`:

| variable | default | meaning |
|---|---|---|
| `REVISION` | UTC date + `.0`, e.g. `2026.11.15.0` | the dictionary revision; four dot-separated integers, which Yomitan compares number by number |
| `GITHUB_REPOSITORY` | the `origin` remote | the repository whose latest release Yomitan asks for updates (GitHub Actions sets it) |

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
| `scripts/` | `validate.ts`, `release-notes.ts`, `upstream-check.ts` |

The sheets in `dict/` are the upstream files as they are. Corrections to them live in the code: `PINYIN_TYPOS` and `DEFINITION_FIXES` in `liangan.ts`. The build reports the readings it could not reconcile (pinyin that disagrees with the zhuyin of its row, pinyin it had to derive from zhuyin); the lists are in `reports/build.json` and in the release notes.

# Release

Run the **Build and release** workflow from the Actions tab. It builds, validates and publishes the zips as the latest release, tagged `v<revision>`, where the revision is the UTC date plus the run number. It has two inputs: `publish` (off: build only, the zips are kept as a workflow artifact) and `revision` (to choose the revision yourself). It refuses a revision that is not newer than the latest release, because Yomitan would not offer it. Nothing is released on a push; pushes and pull requests only run **Build and check**.

# Source

Dictionary files from [here (moe)](https://language.moe.gov.tw/001/Upload/Files/site_content/M0001/respub/index.html) and [here (liang'an)](https://github.com/g0v/moedict-data-csld/blob/master/%E5%85%A9%E5%B2%B8%E8%A9%9E%E5%85%B8.xlsx).

`dict/sources.json` records which version of each sheet is in `dict/` and where the build reads it. The weekly **Upstream check** workflow compares it with the two sites. When a newer sheet is offered it downloads it into `dict/`, updates `dict/sources.json` and opens a pull request, on which **Build and check** runs. `npm run upstream-check -- --update` does the same replacement locally.
