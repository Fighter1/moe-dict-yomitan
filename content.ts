// What the dictionary parsers share: reading a sheet, the structured-content builders and adding
// an entry to the 注音 and 拼音 editions of a dictionary.
import { readFileSync } from "fs";
import { read, utils, type CellObject } from "xlsx";
import { type Dictionary, TermEntry } from "yomichan-dict-builder";
import type {
  StructuredContent,
  StructuredContentNode,
  StructuredContentStyle,
} from "yomichan-dict-builder/dist/types/yomitan/termbank";

export type { StructuredContent, StructuredContentNode, StructuredContentStyle };

/** The 注音 and the 拼音 edition of one dictionary. */
export type Editions = { zhuyin: Dictionary; pinyin: Dictionary };

/** A row of a sheet, by column title. Empty cells are missing. */
export type Row = Record<string, string | number | undefined>;

/**
 * The rows of the first sheet of a workbook.
 * @param required titles the caller reads; a renamed column would otherwise silently empty a field
 * @param fixTitle applied to every column title before anything else
 */
export function readSheet(
  path: string,
  required: string[],
  fixTitle: (title: string) => string = (title) => title,
): { rows: Row[]; titles: string[] } {
  // dense + no cached HTML/text: about half the parsing time of the default, same cell values
  const workbook = read(readFileSync(path), { dense: true, cellHTML: false, cellText: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]!]!;
  const header = (sheet["!data"]?.[utils.decode_range(sheet["!ref"]!).s.r] ?? []) as (CellObject | undefined)[];
  const titles: string[] = [];
  for (const cell of header) {
    if (!cell) continue;
    const title = fixTitle(String(cell.v ?? "").trim());
    cell.v = title;
    delete cell.w; // the cached display text, which sheet_to_json would use instead
    titles.push(title);
  }
  const missing = required.filter((title) => !titles.some((t) => t === title || (title.endsWith("…") && t.startsWith(title.slice(0, -1)))));
  if (missing.length)
    throw new Error(`${path} has no column ${missing.join(", ")}; its columns are: ${titles.join(" | ")}`);
  return { rows: utils.sheet_to_json(sheet) as Row[], titles };
}

/** A span carrying `data-sc-moedict="<moedict>"`, which styles.css selects on. */
export const span = (
  moedict: string,
  content: StructuredContentNode,
  data: Record<string, string> = {},
): StructuredContentNode => ({ tag: "span", content, data: { moedict, ...data } });

/** The same as a div. */
export const div = (
  moedict: string,
  content: StructuredContentNode,
  data: Record<string, string> = {},
): StructuredContentNode => ({ tag: "div", content, data: { moedict, ...data } });

/** `<kind>-parent` holding a `<kind>-label` followed by `content`. */
export const labelled = (
  kind: string,
  label: string,
  content: StructuredContentNode[],
  { tag = "span", data = {} }: { tag?: "span" | "div"; data?: Record<string, string> } = {},
): StructuredContentNode => ({
  tag,
  content: [span(`${kind}-label`, label), ...content],
  data: { moedict: `${kind}-parent`, ...data },
});

/** The headword as the first thing in an entry, with its simplified form when that differs. */
export function termsParent(traditional: string, simplified?: string): StructuredContentNode {
  const terms = [span("traditional-term", traditional)];
  if (simplified && simplified !== traditional)
    terms.push({ tag: "span", content: simplified, data: { moedict: "simplified-term" }, lang: "zh-CN" });
  return span("terms-parent", terms);
}

/**
 * Adds one source entry to both editions: a row under the headword and, when it differs, the
 * same row under the simplified headword. All rows of an entry share its sequence number, in both
 * editions, so consumers can group them back together.
 */
export async function addEntry(
  editions: Editions,
  entry: {
    term: string;
    simplified?: string;
    zhuyin: string;
    pinyin: string;
    sequence: number;
    score: number;
    content: StructuredContent;
  },
) {
  const rows = (["zhuyin", "pinyin"] as const).map((system) => ({
    dictionary: editions[system],
    termEntry: new TermEntry(entry.term)
      .setReading(entry[system])
      .setSequenceNumber(entry.sequence)
      .setPopularity(entry.score)
      .addDetailedDefinition({
        type: "structured-content",
        content: { tag: "span", content: entry.content, lang: "zh-TW" },
      }),
  }));
  for (const { dictionary, termEntry } of rows) await dictionary.addTerm(termEntry.build());
  if (entry.simplified && entry.simplified !== entry.term)
    for (const { dictionary, termEntry } of rows) await dictionary.addTerm(termEntry.setTerm(entry.simplified).build());
}
