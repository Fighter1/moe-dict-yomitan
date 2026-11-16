// 國語辭典簡編本 ("Concised") and 重編國語辭典修訂本 ("Revised"): one sheet each, same columns.
import { readdirSync } from "fs";
import { OpenCC } from "opencc";
import {
  addEntry,
  div,
  labelled,
  readSheet,
  span,
  termsParent,
  type Editions,
  type Row,
  type StructuredContent,
  type StructuredContentNode,
} from "./content.ts";
import { buildNotes } from "./notes.ts";
import { toneMismatches, zhuyinReading, zhuyinToPinyin } from "./pinyin.ts";
import { hasReading, readingSpans, type SystemReadings } from "./readings.ts";

export type Kind = "Concised" | "Revised";

const ALT_READING_TYPES = ["變", "又音", "語音", "讀音", "或讀"] as const;
type AltReadingType = (typeof ALT_READING_TYPES)[number];

// The columns this file reads. The title of the 變體類型 column lists its values and grows with
// them ("變體類型 1:變 2:又音 3:語音 4:讀音 5:或讀"), so it is found by its beginning.
const REQUIRED_COLUMNS = [
  "字詞名",
  "字詞號",
  "多音排序",
  "注音一式",
  "變體注音",
  "漢語拼音",
  "變體漢語拼音",
  "釋義",
  "相似詞",
  "相反詞",
  "多音參見訊息",
  "變體類型…",
];

// Zero-width characters scattered through the sheets. They are invisible but stop "如" from
// being recognised as "如" and "：「" from being adjacent.
const INVISIBLE = /[\u200B\uFEFF]/g;

/**
 * The alternative-reading block. Both reading systems are emitted (tagged `reading-tag`) so the
 * content is identical in the zhuyin and pinyin editions; each edition hides the other via CSS.
 */
function getAltReadingContent(altReadingType: string, readings: SystemReadings): StructuredContentNode {
  const type = altReadingType as AltReadingType;
  if (!ALT_READING_TYPES.includes(type)) return "";
  const present = hasReading(readings);
  if (type === "變" && !present) return "";
  return labelled(
    "alt-reading",
    type === "變" ? "本音" : type,
    present ? readingSpans(readings, "alt-reading-content") : [],
    { data: { altReadingType } },
  );
}

const getExample = (label: string, content: string, kind: Kind) =>
  labelled("definition-entry-example", label, [span("definition-entry-example-content", content)], {
    data: { type: kind === "Concised" || label === "如" ? "例" : "書" },
  });

// 修訂本: "。<source>：「quotation」" after a definition, where the source is 如 or a work.
// One quotation, or several joined by 、.
const CITATION = /。(?![」』])([^\n。]+?)：((?:、?(?:「.+?」|〈.+?〉))+)/;

/** 修訂本: takes the citations out of a definition, in the order they are written (如 first). */
function extractCitations(definition: string): { definition: string; examples: StructuredContentNode[] } {
  const examples: StructuredContentNode[] = [];
  // One citation at a time, always the leftmost: after it is cut out, the next one starts at
  // the same "。". Matching them all in one pass would start a match inside a quotation.
  for (let match; (match = CITATION.exec(definition)); ) {
    let [whole, label, content] = match as unknown as [string, string, string];
    // the sheet sometimes leaves out the ： before the quotation: 《史記…太史公曰》「仲尼有言：「…」
    if (label.includes("「") && !label.includes("」")) {
      const at = label.indexOf("「");
      [label, content] = [label.slice(0, at), `${label.slice(at)}：${content}`];
    }
    const example = getExample(label, content, "Revised");
    label === "如" ? examples.unshift(example) : examples.push(example);
    definition = definition.slice(0, match.index) + "。" + definition.slice(match.index + whole.length);
  }
  return { definition: definition.replace(/。{2,}/g, "。"), examples };
}

/** 簡編本: "△甲、乙" after a definition lists other ways to write the word. */
function extractAlso(definition: string): { definition: string; also: StructuredContentNode } {
  const match = definition.match(/△(.*?)(?=\[例\]|$)/);
  if (!match) return { definition, also: "" };
  const forms = match[1]!
    .trim()
    .replace(/。$/, "")
    .split("、")
    .map((form) => `「${form}」`)
    .join("、");
  return {
    definition: definition.replace(match[0], "").trim(),
    also: labelled("definition-entry-also", "也作", [span("definition-entry-also-content", forms), "。"]),
  };
}

/** Is position `at` of `text` inside a （…） that is still open there? */
function isInsideBrackets(text: string, at: number): boolean {
  const before = text.slice(0, at);
  return before.split("（").length > before.split("）").length;
}

/** The definitions of one part of speech (or of the whole entry), one per line. */
function getContent(lines: string[], kind: Kind): StructuredContentNode {
  const definitions = lines.map((line) => {
    let definition = line;
    let examples: StructuredContentNode[] = [];
    let also: StructuredContentNode = "";
    if (kind === "Revised") ({ definition, examples } = extractCitations(definition));
    else ({ definition, also } = extractAlso(definition.replaceAll("◎", "").trim()));

    // 簡編本 closes a few entries with a remark in brackets that has an example of its own
    // (八: "（原「八」字…讀成陽平。[例]八號、八拜。今多不變調。）"). That example is part of the
    // sentence around it, not the example of a definition.
    const marker = definition.indexOf("[例]");
    if (marker >= 0 && isInsideBrackets(definition, marker)) definition = definition.replace("[例]", "例：");

    const [beforeExample = "", example] = definition.split(/\[例\](.*)/s);
    const text = beforeExample.trim();
    let content: StructuredContentNode = text;
    // "人名：(1)…" - the part before the colon heads the numbered items that follow
    const heading = text.match(/^(.*)：(\(\d\).*)$/);
    if (heading) content = [span("pos-label", heading[1]!), span("pos-first-content", [{ tag: "br" }, heading[2]!])];
    if (kind === "Concised" && example) examples.push(getExample("例", example, "Concised"));
    return div("definition-entry", [span("definition-entry-content", content), also, examples]);
  });
  return div("meaning-parent", definitions);
}

/**
 * 修訂本 groups its definitions by part of speech: a line that is just "[名]" starts a group.
 * A "[" anywhere else (a cross-reference like "(一)[動]2.4.之讀音") is ordinary text.
 */
export function getMeaning(meaning: string, kind: Kind): StructuredContentNode {
  const groups: { pos?: string; lines: string[] }[] = [];
  for (const line of meaning.split("\n")) {
    const header = line.match(/^\[([^\[\]]+)\]$/);
    if (header) groups.push({ pos: header[1]!, lines: [] });
    else if (groups.length) groups.at(-1)!.lines.push(line);
    else groups.push({ lines: [line] });
  }
  if (!groups.some((group) => group.pos)) return div("meanings-parent", getContent(groups[0]?.lines ?? [], kind));
  return div(
    "meanings-parent",
    div(
      "pos-parent",
      groups.map(({ pos, lines }) =>
        div("pos-entry-parent", [
          ...(pos ? [span("pos-label", pos)] : []),
          div("pos-content", getContent(lines, kind)),
        ]),
      ),
    ),
  );
}

/** Puts the items of a "(1) …　(2) …　(3) …" run on separate lines (like 為, 于, 波耳). */
function splitNumberedItems(line: string): string {
  let next = 0; // the number the next item of the run has; 0 before a "(1)"
  return line.replace(/[ 　]*\((\d+)\)/g, (match, digits: string) => {
    const n = Number(digits);
    if (n === 1) next = 2;
    else if (n === next) return next++, `\n(${n})`;
    return match;
  });
}

/** The 釋義 cell as the lines to parse: trimmed, numbered runs split, "[例]" kept with its definition. */
export function normalizeMeaning(cell: string): string {
  const lines: string[] = [];
  for (const line of cell.split("\n").map((l) => l.trim()).filter(Boolean))
    // 簡編本 sometimes starts a new line for the example of the definition above it
    if (line.startsWith("[例]") && lines.length && !lines.at(-1)!.includes("[例]")) lines[lines.length - 1] += line;
    else lines.push(line);
  return lines.map(splitNumberedItems).join("\n");
}

/**
 * 多音參見訊息, the other readings of the headword: "(二)ㄆㄚˊ　　pá（0297）", several in a row,
 * some with a note: "(二)（又音）ㄅㄚˋ bà（00029）". The entry number in the last bracket is dropped.
 */
export function getOtherReadings(cell: string): StructuredContentNode {
  const items: StructuredContentNode[] = [];
  const text = cell.replace(/\s*\n\s*/g, "");
  for (const [, number, note = "", body] of text.matchAll(
    /\(([一二三四五六七八九十]+)\)\s*(（[^）]*）)?\s*([^（(]*?)\s*（[^）]*）/g,
  )) {
    const [, zhuyin = "", pinyin = ""] = body!.match(/^([ㄅ-ㄩˊˇˋ˙．\s]*)(.*)$/s)!;
    items.push(
      span("other-readings-content", [
        `(${number})${note}`,
        ...readingSpans(
          {
            zhuyin: zhuyinReading(zhuyin.replaceAll("．", "˙")),
            pinyin: pinyin.normalize("NFKC").replace(/\s+/g, " ").trim(),
          },
          "other-readings-reading",
        ),
      ]),
    );
  }
  if (!items.length) items.push(span("other-readings-content", text.replace(/（[^）]*）/g, "").trim()));
  return labelled("other-readings", "多音", items, { tag: "div" });
}

/** 字詞號 -> the pictures of that entry (簡編本 only). */
function readPictureIndex(path: string) {
  const pictures: Record<string, { title: string; fileName: string }[]> = {};
  for (const row of readSheet(path, ["字詞號", "圖片題名", "檔案名稱"]).rows) {
    const id = String(row.字詞號 ?? "").trim();
    (pictures[id] ??= []).push({ title: String(row.圖片題名 ?? "").trim(), fileName: String(row.檔案名稱 ?? "").trim() });
  }
  return pictures;
}

/**
 * The pinyin of a reading. The cell is used as it is, except when it cannot be the reading of
 * the zhuyin cell next to it (empty, cut short, or zhuyin typed into it): then the pinyin is
 * derived from the zhuyin. Both cases that touch the sheet's value are noted for the report.
 */
function pinyinReading(term: string, pinyinCell: string | undefined, zhuyinCell: string | undefined): string | undefined {
  const pinyin = pinyinCell?.replace(/\s*[，；]\s*/g, " ").replace(/\s+/g, " ").trim();
  const derived = zhuyinCell === undefined ? undefined : zhuyinToPinyin(zhuyinCell);
  if (derived === undefined || derived === pinyin) return pinyin;
  if (!pinyin || /[ㄅ-ㄩ]/.test(pinyin) || pinyin.split(" ").length !== derived.split(" ").length) {
    buildNotes.pinyinFromZhuyin.push(`${term}: ${pinyin || "(empty)"} → ${derived}`);
    return derived;
  }
  const tones = toneMismatches(pinyin, zhuyinCell!);
  if (tones.length) buildNotes.toneMismatches.push(`${term}: ${tones.join(", ")}`);
  return pinyin;
}

/** What one row of the sheet says about its headword's readings. */
function getReadings(row: Row, term: string, altReadingType: string) {
  const cell = (title: string) => (row[title] === undefined ? undefined : String(row[title]).replace(INVISIBLE, ""));
  const zhuyin = cell("注音一式") === undefined ? undefined : zhuyinReading(cell("注音一式")!);
  const altZhuyin = cell("變體注音") === undefined ? undefined : zhuyinReading(cell("變體注音")!);
  const pinyin = pinyinReading(term, cell("漢語拼音"), cell("注音一式"));
  const altPinyin = pinyinReading(term, cell("變體漢語拼音"), cell("變體注音"));
  // For 變 the variant reading becomes the main reading and the original one is shown as 本音.
  const isBian = altReadingType === "變";
  const main = isBian ? { zhuyin: altZhuyin || zhuyin, pinyin: altPinyin || pinyin } : { zhuyin, pinyin };
  // Show the alternative-reading block when it differs in either system; then emit both
  // systems' readings so the content stays identical between editions.
  const alt: SystemReadings = isBian
    ? zhuyin !== main.zhuyin || pinyin !== main.pinyin
      ? { zhuyin, pinyin }
      : {}
    : { zhuyin: altZhuyin, pinyin: altPinyin };
  return { main, alt };
}

/**
 * Adds every entry of one MOE sheet to the two editions of its dictionary.
 * @param pictures 簡編本 only: its picture index sheet and the folder with the pictures
 */
export async function addTermsMoe(
  editions: Editions,
  kind: Kind,
  path: string,
  pictures?: { index: string; folder: string },
  popularityBoost = 100,
) {
  if (pictures)
    for (const file of readdirSync(pictures.folder))
      for (const dictionary of [editions.zhuyin, editions.pinyin])
        await dictionary.addFile(`${pictures.folder}/${file}`, `img/${file}`);
  const pictureIndex = pictures ? readPictureIndex(pictures.index) : {};

  const { rows, titles } = readSheet(path, REQUIRED_COLUMNS);
  const altReadingTypeColumn = titles.find((title) => title.startsWith("變體類型"))!;
  const text = (row: Row, title: string) =>
    row[title] === undefined ? undefined : String(row[title]).replace(INVISIBLE, "").trim();

  const entries = rows.map((row) => {
    const term = text(row, "字詞名") ?? "";
    const altReadingType = text(row, altReadingTypeColumn) ?? "";
    return { row, term, id: text(row, "字詞號") ?? "", altReadingType, readings: getReadings(row, term, altReadingType) };
  });
  // 修訂本 lists variant characters as entries of their own ("「罷」的異體字。", 字詞號 00031-1)
  // without a reading; they are read like the entry they point at (00031).
  const readingsById = new Map(entries.filter((e) => hasReading(e.readings.main)).map((e) => [e.id, e.readings.main]));

  const simplifiedConverter = new OpenCC("tw2s.json");
  // One sequence number per source entry, shared by its traditional and simplified rows and
  // identical in both editions, so consumers can group them back together.
  let sequence = 0;
  for (const { row, term, id, altReadingType, readings } of entries) {
    const main: SystemReadings = hasReading(readings.main) ? readings.main : (readingsById.get(id.replace(/-\d+$/, "")) ?? {});

    const additionalFields: StructuredContentNode[] = [];
    const synonyms = text(row, "相似詞");
    const antonyms = text(row, "相反詞");
    const otherReadings = text(row, "多音參見訊息");
    if (synonyms)
      additionalFields.push(
        labelled("synonyms", "似", [span("synonyms-content", synonyms.replace("[似]", "").trim())], { tag: "div" }),
      );
    if (antonyms)
      additionalFields.push(
        labelled("antonyms", "反", [span("antonyms-content", antonyms.replace("[反]", "").trim())], { tag: "div" }),
      );
    if (otherReadings) additionalFields.push(getOtherReadings(otherReadings));

    const simplified = simplifiedConverter.convertSync(term);
    const content: StructuredContent = [
      span("first-row-parent", [termsParent(term, simplified), getAltReadingContent(altReadingType, readings.alt)]),
      additionalFields.length ? div("additional-fields-parent", additionalFields) : "",
      getMeaning(normalizeMeaning(text(row, "釋義") ?? ""), kind),
    ];
    const entryPictures = (id && pictureIndex[id]) || [];
    for (const { title, fileName } of entryPictures.toSorted((a, b) => a.title.localeCompare(b.title, "zh-Hant-TW")))
      content.push({
        tag: "details",
        style: { cursor: "pointer" },
        content: [
          { tag: "summary", content: `圖片: ${title}` },
          { tag: "img", path: "img/" + fileName, collapsed: false, collapsible: false, background: false },
        ],
      });

    await addEntry(editions, {
      term,
      simplified,
      zhuyin: main.zhuyin ?? "",
      pinyin: main.pinyin ?? "",
      sequence: ++sequence,
      // 多音排序 is 0 for a headword with one reading and 1, 2, … for the readings of one with several
      score: popularityBoost - (Number(row.多音排序) || 0),
      content,
    });
    if (sequence % 10000 === 0) console.log(`Processed ${sequence} entries`);
  }
}
