# moe-dict-yomitan

Yomitan dictionaries built from Taiwan's Ministry of Education dictionaries, each in a 注音 and a 拼音 edition:

| dictionary | 注音 | 拼音 |
|---|---|---|
| 國語辭典簡編本 | [moe-concised-zhuyin.zip](https://github.com/Fighter1/moe-dict-yomitan/releases/latest/download/moe-concised-zhuyin.zip) | [moe-concised-pinyin.zip](https://github.com/Fighter1/moe-dict-yomitan/releases/latest/download/moe-concised-pinyin.zip) |
| 重編國語辭典修訂本 | [moe-revised-zhuyin.zip](https://github.com/Fighter1/moe-dict-yomitan/releases/latest/download/moe-revised-zhuyin.zip) | [moe-revised-pinyin.zip](https://github.com/Fighter1/moe-dict-yomitan/releases/latest/download/moe-revised-pinyin.zip) |
| 兩岸詞典 | [liangancidian-zhuyin.zip](https://github.com/Fighter1/moe-dict-yomitan/releases/latest/download/liangancidian-zhuyin.zip) | [liangancidian-pinyin.zip](https://github.com/Fighter1/moe-dict-yomitan/releases/latest/download/liangancidian-pinyin.zip) |

Import a zip in Yomitan → Settings → Dictionaries → Import. The zips are self-updating: *Check for updates* on the same page offers the newest release.

# Build

Needs Node 22.18 or newer (the release workflow uses the version in `.nvmrc`).

```
npm ci
npm run build
npm run validate
```

`npm run build` writes the six zips and their `index-*.json` files to `build/`. `npm run validate` checks them against Yomitan's schemas (`schemas/`, copied from the [Yomitan repository](https://github.com/yomidevs/yomitan/tree/master/ext/data/schemas)), checks the update URLs, that the golden words in `dict/golden_words.tsv` are present with their readings, and that every referenced image is in the zip.

Two environment variables change what is stamped into each `index.json`:

| variable | default | meaning |
|---|---|---|
| `REVISION` | UTC date + `.0`, e.g. `2026.11.15.0` | the dictionary revision; four dot-separated integers, which Yomitan compares number by number |
| `GITHUB_REPOSITORY` | the `origin` remote | the repository whose latest release Yomitan asks for updates (GitHub Actions sets it) |

# Release

Run the **Build and release** workflow from the Actions tab. It builds, validates and publishes the zips as the latest release, tagged `v<revision>`, where the revision is the UTC date plus the run number. Nothing is released on a push; pushes and pull requests only run **Build and check**.

# Source

Dictionary files from [here (moe)](https://language.moe.gov.tw/001/Upload/Files/site_content/M0001/respub/index.html) and [here (liang'an)](https://github.com/g0v/moedict-data-csld/blob/master/%E5%85%A9%E5%B2%B8%E8%A9%9E%E5%85%B8.xlsx).

`dict/sources.json` records which version of each sheet is in `dict/` and where the build reads it. The weekly **Upstream check** workflow compares it with the two sites. When a newer sheet is offered it downloads it into `dict/`, updates `dict/sources.json` and opens a pull request, on which **Build and check** runs. The sheets in `dict/` are the upstream files as they are; corrections to them live in the code. `npm run upstream-check -- --update` does the same replacement locally.
