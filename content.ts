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

import { lookupSpellings } from "./spellings.ts";

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

/** The first node of `content` that carries `data-sc-moedict="<moedict>"`. */
function findNode(content: StructuredContentNode, moedict: string): { content?: StructuredContentNode } | undefined {
  if (Array.isArray(content)) {
    for (const child of content) {
      const found = findNode(child, moedict);
      if (found) return found;
    }
  } else if (content && typeof content === "object") {
    const node = content as { content?: StructuredContentNode; data?: Record<string, string> };
    return node.data?.moedict === moedict ? node : node.content === undefined ? undefined : findNode(node.content, moedict);
  }
  return undefined;
}

/**
 * A copy of the content of an entry whose headword box (termsParent) also shows `spelling`:
 * 裡面、裏面. Nothing else differs, and `content` itself is left as it is.
 */
export function withSpellingShown(content: StructuredContent, spelling: string): StructuredContent {
  const copy = structuredClone(content);
  const box = findNode(copy, "traditional-term");
  if (typeof box?.content !== "string") throw new Error(`cannot show ${spelling}: the entry has no headword box`);
  box.content = `${box.content}、${spelling}`;
  return copy;
}

/** Is this definition only a pointer from a variant character to its entry: "「為」的異體字。"? */
export const isVariantStub = (definition: string) => /^「[^」]+」的異體字。?$/.test(definition.trim());

/**
 * Adds one source entry to both editions: a row under the headword and a row under every other
 * spelling it should be found by. Those are the simplified headword, which the entry shows next
 * to the headword, and the spellings of Hong Kong and of OpenCC's standard (spellings.ts). A
 * spelling that is a headword of its own still gets a row: 裏 finds the entry of 裡 as well as
 * "「裡」的異體字". All rows of an entry share its sequence number, in both editions, so consumers
 * can group them back together.
 *
 * The rows of the headword and of the simplified form carry `content` as it is. The row of
 * another spelling carries a copy that shows this spelling after the headword (裡面、裏面), so
 * whoever looks it up sees the word they searched for, and nobody else does.
 *
 * `variantStub` is for an entry that only points at another one. It gets no spellings beyond its
 * simplified form: 爲, "「為」的異體字", is 為 in Hong Kong and would be filed under 為 itself.
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
    variantStub?: boolean;
  },
) {
  /** The row of `spelling` in both editions. Every call builds its rows from scratch. */
  const addRows = async (spelling: string, content: StructuredContent) => {
    for (const system of ["zhuyin", "pinyin"] as const)
      await editions[system].addTerm(
        new TermEntry(spelling)
          .setReading(entry[system])
          .setSequenceNumber(entry.sequence)
          .setPopularity(entry.score)
          .addDetailedDefinition({ type: "structured-content", content: { tag: "span", content, lang: "zh-TW" } })
          .build(),
      );
  };
  const added = new Set<string>();
  const isNew = (spelling: string | undefined): spelling is string => {
    if (!spelling || added.has(spelling)) return false;
    added.add(spelling);
    return true;
  };

  for (const shown of [entry.term, entry.simplified]) if (isNew(shown)) await addRows(shown, entry.content);
  // A lookup-only spelling gets a copy of the content, made from `entry.content` and never
  // touched again: no row can change what another one carries, whenever the rows are written out.
  const lookupOnly = entry.variantStub ? [] : lookupSpellings(entry.term, entry.pinyin);
  for (const spelling of lookupOnly) if (isNew(spelling)) await addRows(spelling, withSpellingShown(entry.content, spelling));
}
