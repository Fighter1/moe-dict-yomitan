// run with: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildNotes } from "../notes.ts";
import { toneMismatches, zhuyinReading, zhuyinToPinyin } from "../pinyin.ts";
import { parsePinyin } from "../utils.ts";

const SPACE = String.fromCharCode(0x3000); // the ideographic space the sheets put between zhuyin syllables
const zhuyin = (...syllables: string[]) => syllables.join(SPACE);

test("joined pinyin is cut into syllables", () => {
  assert.equal(parsePinyin("wùniè"), "wù niè"); // 杌隉
  assert.equal(parsePinyin("nǐnǐ"), "nǐ nǐ"); // 薿薿
  assert.equal(parsePinyin("shàonǚ"), "shào nǚ"); // 少女
  assert.equal(parsePinyin("yìshí-liǎnɡniǎo"), "yì shí liǎng niǎo");
  assert.equal(parsePinyin("yìtóurchén"), "yì tóur chén"); // 一頭兒沉
  assert.equal(parsePinyin("yìjiér"), "yì jiér"); // 一節兒
  assert.equal(parsePinyin("yìhuěr", zhuyin("丨ˋ", "ㄏㄨㄜˇㄦ")), "yì huěr");
});

test("the sheet's ɑ (U+0251) is a toneless a, not something to drop", () => {
  assert.equal(parsePinyin("māmɑ"), "mā ma"); // 媽媽
  assert.equal(parsePinyin("zǎoshɑng"), "zǎo shang"); // 早上
  assert.equal(parsePinyin("rènɑo"), "rè nao"); // 熱鬧
  assert.equal(parsePinyin("gūniɑng"), "gū niang"); // 姑娘
  assert.equal(parsePinyin("mɑ"), "ma"); // 嗎
  assert.equal(parsePinyin("zuòliăn"), "zuò liǎn"); // a breve typed for a caron
});

test("the zhuyin cell corrects cuts the library gets wrong", () => {
  assert.equal(parsePinyin("hérú", zhuyin("ㄏㄜˊ", "ㄖㄨˊ")), "hé rú"); // 何如
  assert.equal(parsePinyin("nánōu", zhuyin("ㄋㄢˊ", "ㄡ")), "nán ōu"); // 南歐: no apostrophe in the sheet
  assert.equal(parsePinyin("chénzǐánɡ", zhuyin("ㄔㄣˊ", "ㄗˇ", "ㄤˊ")), "chén zǐ áng"); // 陳子昂
  assert.equal(
    parsePinyin("jiǔzuì wùj iānɡshān", zhuyin("ㄐ丨ㄡˇ", "ㄗㄨㄟˋ", "ㄨˋ", "ㄐ丨ㄤ", "ㄕㄢ")),
    "jiǔ zuì wù jiāng shān", // a stray space inside a syllable
  );
});

test("a cell that cannot be reconciled with its zhuyin is reported", () => {
  const before = buildNotes.unresolvedPinyin.length;
  parsePinyin("wùniè", zhuyin("ㄨˋ", "ㄋ丨ㄝˋ"));
  assert.equal(buildNotes.unresolvedPinyin.length, before);
  parsePinyin("wécí", zhuyin("ㄨㄟˊ", "ㄘˊ")); // 微辭: the two cells spell different things
  assert.equal(buildNotes.unresolvedPinyin.length, before + 1);
  assert.equal(parsePinyin("ɡ"), ""); // a lone letter is not a reading
});

test("a tone mark on the wrong vowel is moved", () => {
  assert.equal(parsePinyin("shìdɑì"), "shì dài"); // 世代
  assert.equal(parsePinyin("wǔtǐ-toúdì"), "wǔ tǐ tóu dì"); // 五體投地
  assert.equal(parsePinyin("hùhùi"), "hù huì"); // 互惠
  assert.equal(parsePinyin("liúshuǐ xuě nǚ lüè"), "liú shuǐ xuě nǚ lüè"); // already right
});

test("zhuyin is converted to pinyin", () => {
  assert.equal(zhuyinToPinyin(zhuyin("ㄕㄣ", "ㄘㄥˊ")), "shēn céng"); // 深層
  assert.equal(zhuyinToPinyin("˙ㄇㄚ"), "ma");
  assert.equal(zhuyinToPinyin("ㄋㄩˇ"), "nǚ");
  assert.equal(zhuyinToPinyin("ㄌㄩㄝˋ"), "lüè");
  assert.equal(zhuyinToPinyin("ㄒㄩㄝˊ"), "xué");
  assert.equal(zhuyinToPinyin("ㄐㄩㄥ"), "jiōng");
  assert.equal(zhuyinToPinyin("ㄧㄡˇ"), "yǒu");
  assert.equal(zhuyinToPinyin("ㄉㄧㄡ"), "diū");
  assert.equal(zhuyinToPinyin("ㄍㄨㄟˋ"), "guì");
  assert.equal(zhuyinToPinyin("ㄓ"), "zhī");
  assert.equal(zhuyinToPinyin("ㄦˊ"), "ér");
  assert.equal(zhuyinToPinyin("ㄅㄆ"), undefined);
  assert.equal(zhuyinToPinyin(""), undefined);
});

test("zhuyin: erhua as the sheets write it, and cells typed without spacing", () => {
  assert.equal(zhuyinToPinyin("ㄏㄡˋ ㄒㄩㄝˊㄦ"), "hòu xuér"); // 後學兒
  assert.equal(zhuyinToPinyin(zhuyin("ㄧˋ", "ㄏㄨㄜˇㄦ")), "yì huěr"); // 一會兒
  assert.equal(zhuyinToPinyin("ㄨㄜˋㄦ"), "wèr"); // 味兒
  assert.equal(zhuyinToPinyin("ㄅㄠ ㄩㄚˊㄦ"), "bāo yuár"); // 包圓兒
  assert.equal(zhuyinToPinyin("ㄏㄜˊㄕㄤˋ"), "hé shàng"); // 闔上
  assert.equal(zhuyinToPinyin("ㄓˊㄦˊ"), "zhí ér"); // 姪兒: two tone marks, so two syllables
});

test("tones that differ between pinyin and zhuyin are listed", () => {
  assert.deepEqual(toneMismatches("kēng rēn", zhuyin("ㄎㄥ", "ㄖㄣˊ")), ["rēn≠ㄖㄣˊ"]); // 坑人
  assert.deepEqual(toneMismatches("kēng rén", zhuyin("ㄎㄥ", "ㄖㄣˊ")), []);
  assert.deepEqual(toneMismatches("mā ma", zhuyin("ㄇㄚ", "˙ㄇㄚ")), []);
  assert.deepEqual(toneMismatches("kēng", zhuyin("ㄎㄥ", "ㄖㄣˊ")), []); // not comparable
});

test("a zhuyin cell becomes a reading", () => {
  assert.equal(zhuyinReading(zhuyin("ㄖㄣˊ", "ㄌ｜ˋ", "ㄔㄜ")), "ㄖㄣˊㄌㄧˋㄔㄜ"); // 人力車: a full-width bar for ㄧ
  assert.equal(zhuyinReading("ㄌㄟˊ﹐ㄅㄨˊ"), "ㄌㄟˊㄅㄨˊ");
  assert.equal(zhuyinReading("ㄉㄡˋ ‧ㄈㄨ"), "ㄉㄡˋ˙ㄈㄨ"); // a middle dot for the neutral tone
});
