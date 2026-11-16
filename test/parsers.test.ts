// run with: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import type { StructuredContentNode } from "../content.ts";
import { definitionLines, getContent } from "../liangan.ts";
import { getMeaning, getOtherReadings, normalizeMeaning } from "../moe_dics.ts";
import { htmlToContent, inlineHtml } from "../parse_html.ts";

type AnyNode = { tag?: string; content?: StructuredContentNode; data?: Record<string, string>; style?: Record<string, string> };

/** Every node carrying `data-sc-moedict="<moedict>"`, in document order. */
function find(node: StructuredContentNode | undefined, moedict: string, out: AnyNode[] = []): AnyNode[] {
  if (Array.isArray(node)) for (const child of node) find(child, moedict, out);
  else if (node && typeof node === "object") {
    const n = node as AnyNode;
    if (n.data?.moedict === moedict) out.push(n);
    find(n.content, moedict, out);
  }
  return out;
}
/** The text of a node, without markup. */
function text(node: StructuredContentNode | AnyNode | undefined): string {
  if (node === undefined) return "";
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(text).join("");
  return text((node as AnyNode).content);
}
const texts = (node: StructuredContentNode, moedict: string) => find(node, moedict).map(text);

test("修訂本/簡編本: numbered runs go on separate lines", () => {
  assert.equal(normalizeMeaning("(1) 甲。　(2) 乙。 (3) 丙。"), "(1) 甲。\n(2) 乙。\n(3) 丙。");
  // a bracket that is not the next number does not end an item (波耳)
  assert.equal(
    normalizeMeaning("人名：(1) (Niels Bohr）丹麥物理學家。(2)（Aage Bohr）其子。"),
    "人名：(1) (Niels Bohr）丹麥物理學家。\n(2)（Aage Bohr）其子。",
  );
  assert.equal(normalizeMeaning("如：〔(X的二次方)乘(X的三次方)〕"), "如：〔(X的二次方)乘(X的三次方)〕");
  // an example on a line of its own belongs to the definition above it (地瘠人貧)
  assert.equal(normalizeMeaning("土地貧瘠。\n[例]由於農業技術進步"), "土地貧瘠。[例]由於農業技術進步");
});

test("修訂本: a part of speech is a line of its own; other brackets are text", () => {
  const meaning = getMeaning(
    normalizeMeaning("[動]\n1.(一)[動]2.4.之讀音。\n2.看守。如：「看門」、「看護」。\n[名]\n姓。"),
    "Revised",
  ); // 看
  assert.deepEqual(texts(meaning, "pos-label"), ["動", "名"]);
  assert.deepEqual(texts(meaning, "definition-entry-content"), ["1.(一)[動]2.4.之讀音。", "2.看守。", "姓。"]);
  assert.deepEqual(texts(meaning, "definition-entry-example-content"), ["「看門」、「看護」"]);
  assert.equal(find(meaning, "definition-entry").length, 3); // no empty definitions
});

test("修訂本: a chain of citations is taken apart in order", () => {
  const meaning = getMeaning(
    "1.行動。《說文解字．口部》：「吪，動也。」《詩經．王風．兔爰》：「我生之後，逢此百罹。尚寐無吪！」唐．郤昂〈頌碑〉：「如龍如彪，或寢或吪。」",
    "Revised",
  ); // 吪
  assert.deepEqual(texts(meaning, "definition-entry-content"), ["1.行動。"]);
  assert.deepEqual(texts(meaning, "definition-entry-example-label"), ["《說文解字．口部》", "《詩經．王風．兔爰》", "唐．郤昂〈頌碑〉"]);
  assert.deepEqual(texts(meaning, "definition-entry-example-content"), [
    "「吪，動也。」",
    "「我生之後，逢此百罹。尚寐無吪！」",
    "「如龍如彪，或寢或吪。」",
  ]);
  // 如 comes first and leaves one full stop behind
  const escape = getMeaning("1.離開、跑走。如：「逃跑」、「逃走」。《後漢書》：「抱樸而逃。」", "Revised"); // 逃
  assert.deepEqual(texts(escape, "definition-entry-content"), ["1.離開、跑走。"]);
  assert.deepEqual(texts(escape, "definition-entry-example-label"), ["如", "《後漢書》"]);
});

test("簡編本: △ lists other spellings, [例] an example", () => {
  const meaning = getMeaning("一種占卜的方法。　△扶鸞、扶箕[例]在民間的宮廟，有時可以看到乩童扶乩。", "Concised"); // 扶乩
  assert.deepEqual(texts(meaning, "definition-entry-content"), ["一種占卜的方法。"]);
  assert.deepEqual(texts(meaning, "definition-entry-also-content"), ["「扶鸞」、「扶箕」"]);
  assert.deepEqual(texts(meaning, "definition-entry-example-content"), ["在民間的宮廟，有時可以看到乩童扶乩。"]);
  const half = getMeaning("比喻國土的一部分。△半壁河山。", "Concised"); // 半壁江山
  assert.deepEqual(texts(half, "definition-entry-also-content"), ["「半壁河山」"]);
});

test("簡編本: an example inside a bracketed remark stays in the remark", () => {
  const meaning = getMeaning(
    normalizeMeaning("2.表示數量是八的。[例]八字、八方\r\n\r\n（原「八」字口語連用在去聲字前讀成陽平。[例]八號、八拜。今多不變調。）"),
    "Concised",
  ); // 八
  assert.deepEqual(texts(meaning, "definition-entry-content"), [
    "2.表示數量是八的。",
    "（原「八」字口語連用在去聲字前讀成陽平。例：八號、八拜。今多不變調。）",
  ]);
  assert.deepEqual(texts(meaning, "definition-entry-example-content"), ["八字、八方"]);
  // brackets that are closed before the marker do not count
  const closed = getMeaning("某物（俗稱）。[例]舉例", "Concised");
  assert.deepEqual(texts(closed, "definition-entry-example-content"), ["舉例"]);
});

test("修訂本/簡編本: the other readings of a headword", () => {
  const SPACE = String.fromCharCode(0x3000);
  assert.equal(text(getOtherReadings(`(二)ㄆㄚˊ${SPACE}${SPACE}pá（0297）`)), "多音(二)ㄆㄚˊpá");
  const two = getOtherReadings("(一)（語音）ㄅㄞˊ bái（00132）(三)ㄅㄛˊ bó\n（00060）");
  assert.deepEqual(texts(two, "other-readings-content"), ["(一)（語音）ㄅㄞˊbái", "(三)ㄅㄛˊbó"]);
});

test("兩岸詞典: the lines of a definition cell", () => {
  assert.deepEqual(definitionLines("1.地名：\n\n(1)晉代指吳興郡。"), ["1.地名：", "(1)晉代指吳興郡。"]); // 三吳
  assert.deepEqual(definitionLines("位於甘肅敦煌\n南7公里。"), ["位於甘肅敦煌南7公里。"]); // a break inside a sentence
});

test("兩岸詞典: examples, notes and headings", () => {
  const once = getContent("〈書〉天賜之幸運；僥倖。[例][例]孔子又再拜而起。", "天幸");
  assert.deepEqual(texts(once, "definition-entry-content"), ["〈書〉天賜之幸運；僥倖。"]);
  assert.deepEqual(texts(once, "definition-entry-example-content"), ["孔子又再拜而起。"]);
  // a marker that lost its bracket, and ～ standing for the headword
  assert.deepEqual(texts(getContent("4.指保證金。[例交～釋放。", "保"), "definition-entry-example-content"), ["交保釋放。"]);
  // the same example twice
  assert.equal(find(getContent("賀辭。[例]宜室宜家。[例]宜室宜家。", "桃灼呈祥"), "definition-entry-example-parent").length, 1);
  assert.deepEqual(texts(getContent("婉轉。∥也作「委婉」。", "婉轉"), "definition-entry-note"), ["也作「委婉」。"]);
  assert.deepEqual(texts(getContent("10.量詞：", "口"), "pos-label"), ["10.量詞"]);
});

test("兩岸詞典: inline HTML becomes structured content", () => {
  assert.equal(inlineHtml("沒有標籤"), "沒有標籤");
  assert.deepEqual(inlineHtml("記為2<sup>4</sup>。"), [
    "記為2",
    { tag: "span", content: ["4"], style: { verticalAlign: "super", fontSize: "0.75em" } },
    "。",
  ]);
  assert.deepEqual(htmlToContent("<u>孫中山</u>先生"), [
    { tag: "span", content: ["孫中山"], style: { textDecorationLine: "underline" } },
    "先生",
  ]);
  assert.deepEqual(htmlToContent('<font face="Arial">7</font>'), ["7"]);
});

test("兩岸詞典: tables", () => {
  const [table] = htmlToContent('<TABLE>\n  <tr>\n    <td style="text-align: center" colspan="2">方位<br>星宿</td>\n  </tr>\n</TABLE>') as [AnyNode];
  assert.equal(table.tag, "table"); // upper-case tags are tags too
  const [row] = table.content as [AnyNode];
  assert.equal(row.tag, "tr");
  assert.deepEqual(row.content, [
    {
      tag: "td",
      content: ["方位", { tag: "br" }, "星宿"],
      style: { textAlign: "center" },
      colSpan: 2,
      data: { moedict: "table-td" },
      lang: "zh-TW",
    },
  ]);
  // markup that cannot be parsed must not stop the build
  assert.doesNotThrow(() => htmlToContent("<table><tr><td>沒有結尾"));
});
