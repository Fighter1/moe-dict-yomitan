// run with: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addEntry,
  div,
  isVariantStub,
  span,
  termsParent,
  withSpellingShown,
  type Editions,
  type StructuredContent,
  type StructuredContentNode,
} from "../content.ts";
import { lookupSpellings, simplifiedSpelling, standardSpelling } from "../spellings.ts";

test("a headword is also spelled the Hong Kong way and the way of OpenCC's standard", () => {
  assert.deepEqual(lookupSpellings("裡面", "lǐ miàn"), ["裏面"]); // the same in both
  assert.deepEqual(lookupSpellings("群眾", "qún zhòng"), ["羣衆", "羣眾"]);
  assert.deepEqual(lookupSpellings("為", "wéi"), ["爲"]); // Hong Kong writes 為 too
  assert.deepEqual(lookupSpellings("說明", "shuō míng"), ["説明"]); // only Hong Kong differs
  assert.deepEqual(lookupSpellings("臺灣", "tái wān"), ["台灣"]);
  assert.deepEqual(lookupSpellings("床", "chuáng"), ["牀"]);
  assert.deepEqual(lookupSpellings("學習", "xué xí"), []);
  // a word is converted as a word: 麵 alone is 麪, in this name Hong Kong keeps 麵
  assert.deepEqual(lookupSpellings("麵", "miàn"), ["麪"]);
});

test("著 becomes 着 except where it is read zhù", () => {
  assert.equal(standardSpelling("看著", "kàn zhe"), "看着");
  assert.equal(standardSpelling("著急", "zháo jí"), "着急");
  assert.equal(standardSpelling("著名", "zhù míng"), "著名"); // one of the words tw2t knows
  assert.equal(standardSpelling("編著", "biān zhù"), "編著"); // one it does not know
  assert.equal(standardSpelling("見微知著", "jiàn wéi zhī zhù"), "見微知著");
  assert.deepEqual(lookupSpellings("著", "zhe"), ["着"]);
  assert.deepEqual(lookupSpellings("著", "zhù"), []);
  // the reading has no syllable of its own for 兒: any zhù keeps 著, none lets it change
  assert.equal(standardSpelling("著兒", "zhùr"), "著兒");
  assert.equal(standardSpelling("挨著兒", "āi zhàor"), "挨着兒");
  assert.equal(standardSpelling("不著家人，弄不得家鬼", "bù zháo jiā rén, nòng bù dé jiā guǐ"), "不着家人，弄不得家鬼");
});

test("the simplified form keeps the 著 that is read zhù", () => {
  for (const [headword, pinyin, simplified] of [
    ["編著", "biān zhù", "编著"], // tw2s alone says 编着
    ["見微知著", "jiàn wéi zhī zhù", "见微知著"],
    ["土著", "tǔ zhù", "土著"],
    ["著", "zhù", "著"],
    ["著名", "zhù míng", "著名"], // one of the words tw2s knows
    ["看著", "kàn zhe", "看着"],
    ["著急", "zháo jí", "着急"],
    ["著", "zhe", "着"],
    ["不著家人，弄不得家鬼", "bù zháo jiā rén, nòng bù dé jiā guǐ", "不着家人，弄不得家鬼"],
    ["裡面", "lǐ miàn", "里面"],
    ["群眾", "qún zhòng", "群众"],
  ] as const)
    assert.equal(simplifiedSpelling(headword, pinyin), simplified, headword);
});

test("吃 becomes 喫 except where it is read jí", () => {
  assert.deepEqual(lookupSpellings("吃", "chī"), ["喫"]); // Hong Kong writes 吃
  assert.deepEqual(lookupSpellings("吃", "jí"), []);
  assert.equal(standardSpelling("吃口", "chī kǒu"), "喫口");
  assert.equal(standardSpelling("吃口", "jí kǒu"), "吃口");
  assert.equal(standardSpelling("口吃", "kǒu jí"), "口吃");
  assert.equal(standardSpelling("大吃一驚", "dà chī yì jīng"), "大喫一驚");
});

test("a character Taiwan uses for two is changed only in the words listed for the other one", () => {
  for (const [headword, pinyin, standard] of [
    ["剛才", "gāng cái", "剛纔"],
    ["人才", "rén cái", "人才"],
    ["天生我才必有用", "tiān shēng wǒ cái bì yǒu yòng", "天生我才必有用"],
    ["考核", "kǎo hé", "考覈"],
    ["核反應", "hé fǎn yìng", "核反應"],
    ["針灸", "zhēn jiǔ", "鍼灸"],
    ["鐵杵磨成針", "tiě chǔ mó chéng zhēn", "鐵杵磨成針"],
    ["人參", "rén shēn", "人蔘"],
    ["參加", "cān jiā", "參加"],
    ["棟梁", "dòng liáng", "棟樑"],
    ["逼上梁山", "bī shàng liáng shān", "逼上梁山"],
    ["才", "cái", "才"],
  ] as const)
    assert.equal(standardSpelling(headword, pinyin), standard, headword);
  // the other characters of such a word still change
  assert.equal(standardSpelling("逸群之才", "yì qún zhī cái"), "逸羣之才");
  // 剛纔 is 剛才 again in Hong Kong, which is the headword
  assert.deepEqual(lookupSpellings("剛才", "gāng cái"), ["剛纔"]);
});

test("a compatibility ideograph is not replaced by the ordinary character", () => {
  const variant = String.fromCodePoint(0x2fa1c); // the variant of 鼻 that 修訂本 has as a headword
  assert.deepEqual(lookupSpellings(variant, "bí"), []);
});

/** Two editions that keep the rows added to them. */
function fakeEditions() {
  const rows = { zhuyin: [] as unknown[][], pinyin: [] as unknown[][] };
  const edition = (system: "zhuyin" | "pinyin") => ({ addTerm: async (row: unknown[]) => void rows[system].push(row) });
  return { rows, editions: { zhuyin: edition("zhuyin"), pinyin: edition("pinyin") } as unknown as Editions };
}

/** What a parser hands to addEntry: the row of boxes with the headword, then the definitions. */
const contentOf = (term: string, simplified: string | undefined, definition = "釋義。"): StructuredContent => [
  span("first-row-parent", [termsParent(term, simplified)]),
  div("meanings-parent", [div("definition-entry", [span("definition-entry-content", definition)])]),
];

type AnyNode = { content?: StructuredContentNode; data?: Record<string, string> };
/** The text of the first node carrying `data-sc-moedict="<moedict>"`, undefined when there is none. */
function boxText(node: StructuredContentNode | undefined, moedict: string): string | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = boxText(child, moedict);
      if (found !== undefined) return found;
    }
  } else if (node && typeof node === "object") {
    const n = node as AnyNode;
    if (n.data?.moedict === moedict) return typeof n.content === "string" ? n.content : JSON.stringify(n.content);
    return boxText(n.content, moedict);
  }
  return undefined;
}
/** The content a row carries: what addEntry was given, or its copy for a lookup-only spelling. */
const contentOfRow = (row: unknown[]) => (row[5] as [{ content: { content: StructuredContent } }])[0].content.content;
/** The row with the headword box put back to `headword`, to compare everything else. */
const withBox = (row: unknown[], headword: string) =>
  JSON.parse(JSON.stringify(row.slice(1)).replace(`"${boxText(contentOfRow(row), "traditional-term")}"`, `"${headword}"`));

test("every spelling gets a row of the entry, in both editions", async () => {
  const { rows, editions } = fakeEditions();
  await addEntry(editions, {
    term: "群眾",
    simplified: "群众",
    zhuyin: "ㄑㄩㄣˊㄓㄨㄥˋ",
    pinyin: "qún zhòng",
    sequence: 7,
    score: 99,
    content: contentOf("群眾", "群众", "許多人。"),
  });
  for (const [system, reading] of [
    ["zhuyin", "ㄑㄩㄣˊㄓㄨㄥˋ"],
    ["pinyin", "qún zhòng"],
  ] as const) {
    const edition = rows[system];
    // the headword, the simplified form, OpenCC's standard, Hong Kong
    assert.deepEqual(edition.map((row) => row[0]), ["群眾", "群众", "羣衆", "羣眾"], system);
    const [own, ...others] = edition as [unknown[], ...unknown[][]];
    assert.equal(own[1], reading);
    assert.equal(own[4], 99); // score
    assert.equal(own[6], 7); // sequence
    // apart from the term and the headword box, the other rows are the entry's own row
    for (const row of others) assert.deepEqual(withBox(row, "群眾"), own.slice(1), `${system} ${row[0]}`);
  }
});

test("the row of a lookup-only spelling shows that spelling after the headword", async () => {
  const { rows, editions } = fakeEditions();
  const content = contentOf("裡面", "里面", "內部。");
  const before = structuredClone(content);
  await addEntry(editions, { term: "裡面", simplified: "里面", zhuyin: "ㄌㄧˇㄇㄧㄢˋ", pinyin: "lǐ miàn", sequence: 3, score: 100, content });
  for (const system of ["zhuyin", "pinyin"] as const) {
    const [headword, simplified, lookup, ...more] = rows[system] as [unknown[], unknown[], unknown[]];
    assert.equal(more.length, 0);
    assert.deepEqual([headword[0], simplified[0], lookup[0]], ["裡面", "里面", "裏面"]);
    // what a lookup of 裡面 or 里面 shows is what the parser built
    assert.deepEqual(contentOfRow(headword), before, system);
    assert.deepEqual(contentOfRow(simplified), before, system);
    assert.equal(boxText(contentOfRow(headword), "traditional-term"), "裡面");
    // a lookup of 裏面 shows both; the simplified box and the definition are the same
    assert.equal(boxText(contentOfRow(lookup), "traditional-term"), "裡面、裏面", system);
    assert.equal(boxText(contentOfRow(lookup), "simplified-term"), "里面");
    assert.equal(boxText(contentOfRow(lookup), "definition-entry-content"), "內部。");
    assert.deepEqual(withBox(lookup, "裡面"), headword.slice(1), system);
    // its content is a copy: nothing done to it can reach the other rows
    assert.notEqual(contentOfRow(lookup), contentOfRow(headword));
  }
  // the content the parser passed in was not changed either
  assert.deepEqual(content, before);
});

test("the rows of the headword and of the simplified form keep carrying the same content", async () => {
  const { rows, editions } = fakeEditions();
  const content = contentOf("群眾", "群众");
  await addEntry(editions, { term: "群眾", simplified: "群众", zhuyin: "ㄑㄩㄣˊㄓㄨㄥˋ", pinyin: "qún zhòng", sequence: 1, score: 0, content });
  for (const system of ["zhuyin", "pinyin"] as const) {
    const [headword, simplified] = rows[system] as [unknown[], unknown[]];
    assert.deepEqual(simplified.slice(1), headword.slice(1), system);
    // whether or not the builder writes a row out at once, they can share the object: no row changes it
    assert.equal(contentOfRow(headword), content);
    assert.equal(contentOfRow(simplified), content);
  }
  // changing a lookup row afterwards (as a builder that keeps references could) reaches nothing else
  const lookup = rows.pinyin[2]!;
  (contentOfRow(lookup) as unknown[]).length = 0;
  for (const system of ["zhuyin", "pinyin"] as const) {
    assert.equal(boxText(contentOfRow(rows[system][0]!), "traditional-term"), "群眾", system);
    assert.equal(boxText(contentOfRow(rows[system][1]!), "traditional-term"), "群眾", system);
    assert.equal(boxText(contentOfRow(rows[system][3]!), "traditional-term"), "群眾、羣眾", system); // the other spelling
  }
  assert.deepEqual(content, contentOf("群眾", "群众"));
});

test("an entry with two lookup-only spellings shows each on its own row", async () => {
  const { rows, editions } = fakeEditions();
  await addEntry(editions, {
    term: "群眾",
    simplified: "群众",
    zhuyin: "ㄑㄩㄣˊㄓㄨㄥˋ",
    pinyin: "qún zhòng",
    sequence: 1,
    score: 0,
    content: contentOf("群眾", "群众"),
  });
  for (const system of ["zhuyin", "pinyin"] as const)
    assert.deepEqual(
      rows[system].map((row) => [row[0], boxText(contentOfRow(row), "traditional-term"), boxText(contentOfRow(row), "simplified-term")]),
      [
        ["群眾", "群眾", "群众"],
        ["群众", "群眾", "群众"],
        ["羣衆", "群眾、羣衆", "群众"],
        ["羣眾", "群眾、羣眾", "群众"],
      ],
      system,
    );
});

test("showing a spelling needs the headword box, and leaves an entry without a simplified box without one", () => {
  const shown = withSpellingShown(contentOf("床", undefined), "牀");
  assert.equal(boxText(shown, "traditional-term"), "床、牀");
  assert.equal(boxText(shown, "simplified-term"), undefined);
  assert.throws(() => withSpellingShown([{ tag: "span", content: "沒有字詞框" }], "牀"));
});

/** The terms an entry is filed under, which must be the same in both editions. */
async function terms(term: string, simplified: string | undefined, pinyin: string, variantStub = false) {
  const { rows, editions } = fakeEditions();
  await addEntry(editions, { term, simplified, zhuyin: "", pinyin, sequence: 1, score: 0, content: contentOf(term, simplified), variantStub });
  assert.deepEqual(rows.zhuyin.map((row) => row[0]), rows.pinyin.map((row) => row[0]));
  return rows.pinyin.map((row) => row[0]);
}

test("a spelling is not added twice", async () => {
  // Hong Kong's spelling is the headword again
  assert.deepEqual(await terms("為", "为", "wéi"), ["為", "为", "爲"]);
  // Hong Kong's spelling is the simplified form
  assert.deepEqual(await terms("臺", "台", "tái"), ["臺", "台"]);
  // Hong Kong's spelling is the standard one
  assert.deepEqual(await terms("裡面", "里面", "lǐ miàn"), ["裡面", "里面", "裏面"]);
  // nothing differs, and a simplified form equal to the headword adds nothing either
  assert.deepEqual(await terms("人口", "人口", "rén kǒu"), ["人口"]);
  assert.deepEqual(await terms("人口", undefined, "rén kǒu"), ["人口"]);
  // 著名 keeps its 著, so no 着名
  assert.deepEqual(await terms("著名", "著名", "zhù míng"), ["著名"]);
});

test("a spelling that is a headword of its own is still added, but not for a variant stub", async () => {
  // 裏 has a stub entry of its own in 修訂本; the entry of 裡 is filed under it all the same
  assert.deepEqual(await terms("裡", "里", "lǐ"), ["裡", "里", "裏"]);
  // 爲, "「為」的異體字", would be filed under 為 itself, which is how Hong Kong writes it
  assert.deepEqual(await terms("爲", "为", "wéi"), ["爲", "为", "為"]);
  assert.deepEqual(await terms("爲", "为", "wéi", true), ["爲", "为"]);
  assert.equal(isVariantStub("「為」的異體字。"), true);
  assert.equal(isVariantStub(" 「裡」的異體字 "), true);
  assert.equal(isVariantStub("「為」的異體字。又作動詞。"), false);
  assert.equal(isVariantStub("做、行。"), false);
});
