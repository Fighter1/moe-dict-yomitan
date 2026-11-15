import { Dictionary, DictionaryIndex } from "yomichan-dict-builder";
import { addTermsMoe } from "./moe_dics.ts";
import { addTermsLiangAn } from "./liangan.ts";
import { hideOtherReadingSystemCss } from "./readings.ts";
import { execFileSync } from "child_process";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { unresolvedPinyin } from "./utils.ts";

// JSZip re-encodes string inputs to UTF-8 in 16 KiB chunks, so a surrogate pair (an astral CJK
// character) that straddles a chunk boundary turns into two U+FFFD characters. Hand it bytes.
(Dictionary.prototype as any).saveJsonToZip = async function (
  fileName: string,
  data: unknown,
) {
  this.zip.file(fileName, Buffer.from(JSON.stringify(data), "utf8"));
};


// Output directory for the zips and index files (the release workflow publishes build/*).
const OUT_DIR = process.env.OUT_DIR ?? "build";

// Revision of every dictionary in this build. The release workflow passes the UTC date plus its run
// number ("2026.11.15.7"); a local build gets ".0", so it never outranks a release of the same day.
// Yomitan compares revisions number by number only when both are dot-separated integers with the
// same number of segments (anything else is compared as text), so the shape is enforced here.
const revision =
  process.env.REVISION ||
  `${new Date().toISOString().slice(0, 10).replaceAll("-", ".")}.0`;
if (!/^\d{4}\.\d{2}\.\d{2}\.\d+$/.test(revision))
  throw new Error(
    `REVISION "${revision}" must be four dot-separated integers, e.g. 2026.11.15.7`,
  );

// owner/name of the repository whose latest release Yomitan asks for updates: GITHUB_REPOSITORY
// in GitHub Actions, else whatever the `origin` remote points at, so a fork's zips point at the fork.
function originRepo() {
  try {
    const url = execFileSync("git", ["remote", "get-url", "origin"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return url.trim().match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?\/?$/)?.[1];
  } catch {
    return undefined; // not a git checkout
  }
}
const updateRepo =
  process.env.GITHUB_REPOSITORY || originRepo() || "Fighter1/moe-dict-yomitan";
const releaseUrl = (asset: string) =>
  `https://github.com/${updateRepo}/releases/latest/download/${asset}`;

// Where the source sheets live and which upstream version they are (see dict/sources.json).
const sources = JSON.parse(readFileSync("dict/sources.json", "utf-8")) as Record<
  "concised" | "concisedPics" | "revised" | "liangan",
  { path: string; index?: string; version?: string }
>;

// for the concised and revised moe dictionaries
const addSynonymsAntonyms = true;
// makes it so these dictionaries are prioritized in the search results (because they have some sort of frequency sort for the 多音字)
const popularityBoost = 100;

const [
  zhuyinConcisedDic,
  pinyinConcisedDic,
  zhuyinRevisedDic,
  pinyinRevisedDic,
  liangAnDicZhuyin,
  liangAnDicPinyin,
] = await initDics();

await addTermsMoe(
  [zhuyinConcisedDic, pinyinConcisedDic, zhuyinRevisedDic, pinyinRevisedDic],
  [
    sources.concised.path,
    sources.revised.path,
    sources.concisedPics.index!,
    sources.concisedPics.path,
  ],
  addSynonymsAntonyms,
  popularityBoost,
);

// Content is identical in both editions and carries both reading systems; each edition's
// styles.css hides the other system (see readings.ts).
// (line endings normalised, so a Windows checkout builds the same zips as the release workflow)
const baseCss = readFileSync("./styles.css", "utf-8").replaceAll("\r\n", "\n");
writeFileSync("./styles-zhuyin.css", baseCss + hideOtherReadingSystemCss("zhuyin"));
writeFileSync("./styles-pinyin.css", baseCss + hideOtherReadingSystemCss("pinyin"));
for (const f of [zhuyinConcisedDic, zhuyinRevisedDic, liangAnDicZhuyin]) {
  await f.addFile("./styles-zhuyin.css", "styles.css");
}
for (const f of [pinyinConcisedDic, pinyinRevisedDic, liangAnDicPinyin]) {
  await f.addFile("./styles-pinyin.css", "styles.css");
}
console.log("Exporting MOE dictionaries...");
await zhuyinConcisedDic.export(OUT_DIR);
console.log("Exported 國語辭典簡編本 注音");
await pinyinConcisedDic.export(OUT_DIR);
console.log("Exported 國語辭典簡編本 拼音");
await zhuyinRevisedDic.export(OUT_DIR);
console.log("Exported 重編國語辭典修訂本 注音");
await pinyinRevisedDic.export(OUT_DIR);
console.log("Exported 重編國語辭典修訂本 拼音");

await addTermsLiangAn(
  [liangAnDicZhuyin, liangAnDicPinyin],
  sources.liangan.path,
  popularityBoost,
);

console.log("Exporting LiangAn dictionary...");
await liangAnDicZhuyin.export(OUT_DIR);
console.log("Exported 兩岸詞典 注音");
await liangAnDicPinyin.export(OUT_DIR);
console.log("Exported 兩岸詞典 拼音");

// Read by scripts/validate.ts and scripts/release-notes.ts.
mkdirSync("reports", { recursive: true });
writeFileSync(
  "reports/build.json",
  JSON.stringify({ revision, updateRepo, sources, unresolvedPinyin }, null, 2) + "\n",
);
console.log(`revision ${revision}, update URLs under ${releaseUrl("")}`);

export async function initDics(): Promise<
  [Dictionary, Dictionary, Dictionary, Dictionary, Dictionary, Dictionary]
> {
  const zhuyinConcisedDic = new Dictionary({
    fileName: "moe-concised-zhuyin.zip",
  });
  const pinyinConcisedDic = new Dictionary({
    fileName: "moe-concised-pinyin.zip",
  });
  const zhuyinRevisedDic = new Dictionary({
    fileName: "moe-revised-zhuyin.zip",
  });
  const pinyinRevisedDic = new Dictionary({
    fileName: "moe-revised-pinyin.zip",
  });
  const zhuyinIndexConcised = new DictionaryIndex()
    .setTitle("國語辭典簡編本 注音")
    .setRevision(revision)
    .setAuthor("shadow")
    .setSequenced(true)
    .setAttribution("國語辭典簡編本 (2014)")
    .setDescription(
      "A monolingual dictionary made for learners of Mandarin Chinese. 主要適用對象：國中、小學生及學習華語人士。",
    )
    .setIsUpdatable(true)
    .setIndexUrl(
      releaseUrl("index-concised-zhuyin.json"),
    )
    .setDownloadUrl(
      releaseUrl("moe-concised-zhuyin.zip"),
    );
  zhuyinIndexConcised.index.sourceLanguage = "zh";
  zhuyinIndexConcised.index.targetLanguage = "zh";
  const pinyinIndexConcised = new DictionaryIndex()
    .setTitle("國語辭典簡編本 拼音")
    .setRevision(revision)
    .setAuthor("shadow")
    .setSequenced(true)
    .setAttribution("國語辭典簡編本 (2014)")
    .setDescription(
      "A monolingual dictionary made for learners of Mandarin Chinese. 主要適用對象：國中、小學生及學習華語人士。",
    )
    .setIsUpdatable(true)
    .setIndexUrl(
      releaseUrl("index-concised-pinyin.json"),
    )
    .setDownloadUrl(
      releaseUrl("moe-concised-pinyin.zip"),
    );
  pinyinIndexConcised.index.sourceLanguage = "zh";
  pinyinIndexConcised.index.targetLanguage = "zh";
  await zhuyinConcisedDic.setIndex(
    zhuyinIndexConcised.build(),
    OUT_DIR,
    "index-concised-zhuyin.json",
  );
  await pinyinConcisedDic.setIndex(
    pinyinIndexConcised.build(),
    OUT_DIR,
    "index-concised-pinyin.json",
  );
  await zhuyinRevisedDic.setIndex(
    zhuyinIndexConcised
      .setTitle("重編國語辭典修訂本 注音")
      .setRevision(revision)
      .setDescription(
        "A monolingual dictionary made for Mandarin Chinese. 主要適用對象：對歷史語言有興趣的研究者。",
      )
      .setAttribution("重編國語辭典修訂本 (2015)")
      .setIsUpdatable(true)
      .setIndexUrl(
        releaseUrl("index-revised-zhuyin.json"),
      )
      .setDownloadUrl(
        releaseUrl("moe-revised-zhuyin.zip"),
      )
      .build(),
    OUT_DIR,
    "index-revised-zhuyin.json",
  );
  await pinyinRevisedDic.setIndex(
    pinyinIndexConcised
      .setTitle("重編國語辭典修訂本 拼音")
      .setRevision(revision)
      .setDescription(
        "A monolingual dictionary made for Mandarin Chinese. 主要適用對象：對歷史語言有興趣的研究者。",
      )
      .setIsUpdatable(true)
      .setIndexUrl(
        releaseUrl("index-revised-pinyin.json"),
      )
      .setDownloadUrl(
        releaseUrl("moe-revised-pinyin.zip"),
      )
      .setAttribution("重編國語辭典修訂本 (2015)")
      .build(),
    OUT_DIR,
    "index-revised-pinyin.json",
  );

  const liangAnDicZhuyin = new Dictionary({
    fileName: "liangancidian-zhuyin.zip",
  });
  const liangAnDicPinyin = new Dictionary({
    fileName: "liangancidian-pinyin.zip",
  });
  const zhuyinIndexLiangAn = new DictionaryIndex()
    .setTitle("兩岸詞典 注音")
    .setRevision(revision)
    .setAuthor("shadow")
    .setSequenced(true)
    .setAttribution("兩岸詞典 (2015)")
    .setDescription("A monolingual dictionary of Mandarin Chinese.")
    .setIsUpdatable(true)
    .setIndexUrl(
      releaseUrl("index-liangancidian-zhuyin.json"),
    )
    .setDownloadUrl(
      releaseUrl("liangancidian-zhuyin.zip"),
    );
  zhuyinIndexLiangAn.index.sourceLanguage = "zh";
  zhuyinIndexLiangAn.index.targetLanguage = "zh";
  const pinyinIndexLiangAn = new DictionaryIndex()
    .setTitle("兩岸詞典 拼音")
    .setRevision(revision)
    .setAuthor("shadow")
    .setSequenced(true)
    .setAttribution("兩岸詞典 (2015)")
    .setDescription("A monolingual dictionary of Mandarin Chinese.")
    .setIsUpdatable(true)
    .setIndexUrl(
      releaseUrl("index-liangancidian-pinyin.json"),
    )
    .setDownloadUrl(
      releaseUrl("liangancidian-pinyin.zip"),
    );
  pinyinIndexLiangAn.index.sourceLanguage = "zh";
  pinyinIndexLiangAn.index.targetLanguage = "zh";
  await liangAnDicZhuyin.setIndex(
    zhuyinIndexLiangAn.build(),
    OUT_DIR,
    "index-liangancidian-zhuyin.json",
  );
  await liangAnDicPinyin.setIndex(
    pinyinIndexLiangAn.build(),
    OUT_DIR,
    "index-liangancidian-pinyin.json",
  );

  return [
    zhuyinConcisedDic,
    pinyinConcisedDic,
    zhuyinRevisedDic,
    pinyinRevisedDic,
    liangAnDicZhuyin,
    liangAnDicPinyin,
  ];
}
