// 兩岸詞典: dict/liangancidian.xlsx, the sheet published in g0v/moedict-data-csld as it is.
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
import { htmlToContent, inlineHtml } from "./parse_html.ts";
import { toneMismatches, zhuyinReading, zhuyinToPinyin } from "./pinyin.ts";
import { hasReading, readingSpans, type SystemReadings } from "./readings.ts";
import { parsePinyin } from "./utils.ts";

// Pinyin cells that are truncated or garbled in the sheet itself. The zhuyin cell of the same row is intact,
// so they are corrected from it. (All of them show up in the "disagree with the zhuyin cell" report of the build.)
const PINYIN_TYPOS: Record<string, string> = {
  "wánní-fēngguā": "wánní-fēngguān", // 丸泥封關 ㄍㄨㄢ
  "chúguānxī": "chúguāngxī", // 儲光羲 ㄍㄨㄤ
  "hòutǔniángniɑg": "hòutǔniángniang", // 后土娘娘 ˙ㄋㄧㄤ
  "hūniú-hūm": "hūniú-hūmǎ", // 呼牛呼馬 ㄇㄚˇ
  "wécí": "wéicí", // 微辭 ㄨㄟˊ
  "uānpí-chūyǔ": "zuānpí-chūyǔ", // 鑽皮出羽 ㄗㄨㄢ
  "jīnjiùyuàn diào mǎshǒuzhēn wén bìngxù": "jīngjiùyuàn diào mǎshǒuzhēn wén bìngxù", // 經舊苑弔馬守貞文並序 ㄐㄧㄥ
  "qiānr-bābǎ": "qiānr-bābǎi", // 千兒八百 (大陸) ㄅㄞˇ
  "mùyǔ-zhìfēn": "mùyǔ-zhìfēng", // 沐雨櫛風 (大陸) ㄈㄥ
};

// Definition cells that are wrong in the sheet itself: 正體字形 -> [text in the sheet, corrected text].
const DEFINITION_FIXES: Record<string, [string, string]> = {
  // the 也作 / [例] part is there twice
  拖後腿: [
    "也作「拉後腿」、「扯後腿」、「扯腿」。[例]前線打斷腿，後方～。也作「拉後腿」、「扯後腿」、「扯腿」。[例]前線打斷腿，後方～。",
    "也作「拉後腿」、「扯後腿」、「扯腿」。[例]前線打斷腿，後方～。",
  ],
};

const REQUIRED_COLUMNS = [
  "正體字形",
  "簡化字形",
  "音序",
  "臺／陸特有詞",
  "臺／陸特有音",
  "臺灣音讀",
  "臺灣漢拼",
  "大陸音讀",
  "大陸漢拼",
  "釋義1",
];
const MAX_DEFINITIONS = 30; // 釋義1 … 釋義30

/** The sheet numbers its definition columns with full-width digits (釋義１ … 釋義３０). */
const asciiDigits = (title: string) =>
  title.replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0));

// 簡化字形 cells nobody can look up: a character described by its parts ("并（艹+带）"), or one
// that only exists as a private-use glyph.
const NOT_A_HEADWORD = /[（(].*[+＋].*[)）]|[\uE000-\uF8FF]/u;

/**
 * The lines of a definition cell. A few cells hold several lines: a heading with the first of
 * its numbered items (三吳), a list of examples (破折號). A line break in the middle of a
 * sentence (月牙泉) is not a new line.
 */
export function definitionLines(cell: string): string[] {
  const lines: string[] = [];
  for (const line of cell.split(/\r?\n/).map((l) => l.trim()).filter(Boolean))
    if (lines.length && !/[。：；！？」』）)]$/.test(lines.at(-1)!)) lines[lines.length - 1] += line;
    else lines.push(line);
  return lines;
}

/** "3.量詞：" heads the "(1) …", "(2) …" lines that follow it. */
const HEADING = /^\d+\..*：$/;
const HEADING_ITEM = /^[(（]\d+[)）]/;

/**
 * The definitions of an entry, from the lines of its definition cells (a cell with a table is
 * one line). As in the online dictionary, a heading is a line of text that ends in its colon;
 * the numbered items that follow go below it, indented.
 */
export function getDefinitions(lines: string[], term: string): StructuredContentNode[] {
  const definitions: StructuredContentNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.includes("<table")) {
      definitions.push(div("meaning-parent", htmlToContent(line)));
      continue;
    }
    const items: StructuredContentNode[] = [];
    if (HEADING.test(line)) while (HEADING_ITEM.test(lines[i + 1] ?? "")) items.push(getContent(lines[++i]!, term));
    definitions.push(getContent(line, term, items));
  }
  return definitions;
}

/**
 * One line of a definition: its text, a note after ∥, the examples after each [例] and, for a
 * heading, its items.
 */
export function getContent(line: string, term: string, items: StructuredContentNode[] = []): StructuredContentNode {
  let note: StructuredContentNode = "";
  const noteMatch = line.match(/[∥‖](.*)$/);
  if (noteMatch) {
    note = span("definition-entry-note", inlineHtml(noteMatch[1]!));
    line = line.replace(noteMatch[0], "").trim();
  }
  // "[例]" starts an example; a few cells have it twice, repeat the example or lost the "]"
  const [text = "", ...rest] = line.split(/\[例\]?/);
  const examples = [...new Set(rest.map((example) => example.trim()).filter(Boolean))];
  return div("definition-entry", [
    span("definition-entry-content", inlineHtml(text)),
    note,
    ...examples.map((example) =>
      labelled("definition-entry-example", "例", [
        span("definition-entry-example-content", inlineHtml(example.replace(/[〜～]/g, term))),
      ]),
    ),
    ...(items.length ? [div("definition-entry-items", items, { numbered: "true" })] : []),
  ]);
}

function getAdditionalInfo(
  mainlandReading?: SystemReadings,
  taiwanOrChinaTerm?: string,
  taiwanOrChinaReading?: string,
): StructuredContentNode[] {
  const info: StructuredContentNode[] = [];
  if (hasReading(mainlandReading))
    info.push(
      labelled("mainland-reading", "大陸音讀", readingSpans(mainlandReading, "mainland-reading-content"), {
        data: { altReadingType: "大陸音讀" },
      }),
    );
  if (taiwanOrChinaTerm) info.push(labelled("word-belong", "詞", [span("word-belong-content", taiwanOrChinaTerm)]));
  if (taiwanOrChinaReading)
    info.push(labelled("sound-belong", "音", [span("sound-belong-content", taiwanOrChinaReading)]));
  return info;
}

/** Adds every entry of the sheet to the two editions of the dictionary. */
export async function addTermsLiangAn(editions: Editions, path: string, popularityBoost = 100) {
  const { rows } = readSheet(path, REQUIRED_COLUMNS, asciiDigits);
  // every cell: script ɡ (U+0261) to g, trimmed
  const text = (row: Row, title: string) =>
    row[title] === undefined ? undefined : String(row[title]).replaceAll("ɡ", "g").trim();

  let sequence = 0;
  for (const row of rows) {
    const termTrad = text(row, "正體字形") ?? "";

    // One reading (臺灣 or 大陸) in both systems. The zhuyin cell as typed still has its
    // per-syllable spacing, which parsePinyin uses to check where the joined pinyin has to be cut.
    const reading = (zhuyinTitle: string, pinyinTitle: string, where: string): SystemReadings => {
      const zhuyinCell = text(row, zhuyinTitle);
      const pinyinCell = text(row, pinyinTitle);
      let pinyin = pinyinCell && parsePinyin(PINYIN_TYPOS[pinyinCell] ?? pinyinCell, zhuyinCell);
      if (zhuyinCell && !pinyin) {
        // the pinyin cell is empty (憱)
        pinyin = zhuyinToPinyin(zhuyinCell);
        if (pinyin) buildNotes.pinyinFromZhuyin.push(`${termTrad}${where}: (empty) → ${pinyin}`);
      } else if (zhuyinCell && pinyin) {
        const tones = toneMismatches(pinyin, zhuyinCell);
        if (tones.length) buildNotes.toneMismatches.push(`${termTrad}${where}: ${tones.join(", ")}`);
      }
      return { zhuyin: zhuyinCell ? zhuyinReading(zhuyinCell) : undefined, pinyin: pinyin || undefined };
    };
    const taiwan = reading("臺灣音讀", "臺灣漢拼", "");
    const mainland = reading("大陸音讀", "大陸漢拼", " (大陸)");
    // A pronunciation that only the mainland has (嗎 má) leaves the 臺灣 cells empty.
    const main = hasReading(taiwan) ? taiwan : mainland;
    // The mainland reading block is shown when it differs in either system, and then carries
    // both systems, so the content is identical in the zhuyin and pinyin editions.
    const mainlandDiffers =
      (!!mainland.zhuyin && mainland.zhuyin !== main.zhuyin) || (!!mainland.pinyin && mainland.pinyin !== main.pinyin);

    // the sheet leaves 簡化字形 empty when it equals 正體字形, and writes 兒 as ㄦ in three erhua words
    const simplified = text(row, "簡化字形")?.replaceAll("ㄦ", "儿");

    const lines: string[] = [];
    for (let i = 1; i <= MAX_DEFINITIONS; i++) {
      let definition = text(row, `釋義${i}`)?.replaceAll("丨", "ㄧ"); // ㄧ as typed for vertical text
      if (!definition) break;
      const fix = DEFINITION_FIXES[termTrad];
      if (fix) definition = definition.replace(fix[0], fix[1]);
      if (definition.includes("<table")) lines.push(definition);
      else lines.push(...definitionLines(definition));
    }

    const info = getAdditionalInfo(
      mainlandDiffers ? mainland : undefined,
      // star is Mainland, triangle is Taiwan
      text(row, "臺／陸特有詞"),
      text(row, "臺／陸特有音"),
    );
    const content: StructuredContent = [
      span("first-row-parent", [termsParent(termTrad, simplified)]),
      // 大陸音讀, 詞 and 音 go on a row of their own, below the headword
      ...(info.length ? [div("info-row-parent", info)] : []),
      div("meanings-parent", getDefinitions(lines, termTrad)),
    ];
    await addEntry(editions, {
      term: termTrad,
      simplified: simplified && !NOT_A_HEADWORD.test(simplified) ? simplified : undefined,
      zhuyin: main.zhuyin ?? "",
      pinyin: main.pinyin ?? "",
      sequence: ++sequence,
      // 音序 is empty for a headword with one reading and "1.", "2.", … for the readings of one with several
      score: popularityBoost - (parseInt(text(row, "音序") ?? "") || 0),
      content,
    });
    if (sequence % 10000 === 0) console.log(`Processed ${sequence} entries`);
  }
  if (buildNotes.unresolvedPinyin.length)
    console.log(
      `${buildNotes.unresolvedPinyin.length} pinyin cells disagree with the zhuyin cell of their row (typos in the sheet):\n  ` +
        buildNotes.unresolvedPinyin.join("\n  "),
    );
}
