// Other traditional spellings of a headword, for lookup only. The headwords are in Taiwan's
// forms (裡面, 群眾, 為); a text may be written in Hong Kong's (裏面, 羣眾) or in the forms a
// conversion with OpenCC's default settings produces (裏面, 羣衆, 爲). addEntry in content.ts
// files an entry under those as well. An entry looked up by its headword or its simplified form
// does not show them; looked up by one of them, it shows that one after the headword (裡面、裏面).
//
// Also here, because it needs the same knowledge about 著: the simplified form of a headword.
import { OpenCC } from "opencc";

/** An OpenCC conversion, loaded when it is first used. */
const converter = (config: string) => {
  let opencc: OpenCC | undefined;
  return (text: string) => (opencc ??= new OpenCC(`${config}.json`)).convertSync(text);
};
const toStandard = converter("tw2t"); // Taiwan's forms to OpenCC's standard: 裡 → 裏, 為 → 爲
const toHongKong = converter("t2hk"); // OpenCC's standard to Hong Kong's forms: 衆 → 眾, 說 → 説
const toSimplified = converter("tw2s");
const fromSimplified = converter("s2t");

// Taiwan writes each of these where OpenCC's standard has two characters: 才 (才能) and 纔 (剛纔),
// 核 (核心) and 覈 (考覈), 針 and 鍼 (鍼灸), 參 and 蔘 (人蔘), 梁 and 樑 (棟樑), 吃 (口吃) and 喫,
// 么 and 幺, 著 (著名) and 着. tw2t turns every one it does not know as part of a listed word into
// the second character: 核反應 → 覈反應, 天生我才必有用 → 天生我纔必有用. The tables that go from
// simplified to traditional work the other way round: the first character, and the second one
// only in the words listed for it. So such a character is only changed when those tables agree.
// (That does not help with 著: simplified has both 著 and 着, and tw2s decides like tw2t.)
const MERGED = new Set("才核針參梁吃么");

// Two of them differ by their reading, and there the reading decides first: 著 is 着 in the
// standard except where it is read zhù (著名, 編著), which tw2t only knows for a few words, and
// 吃 stays 吃 where it is read jí (口吃).
const KEPT_READING: Record<string, string> = { 著: "zhù", 吃: "jí" };

// 修訂本 has variant characters whose headword is a compatibility ideograph (U+2FA1C for 鼻).
// OpenCC replaces those with the ordinary character, which would file "「鼻」的異體字" under 鼻.
const COMPATIBILITY_IDEOGRAPH = /[\u{F900}-\u{FAFF}\u{2F800}-\u{2FA1F}]/u;

const HAN = /\p{Script=Han}/u;

/**
 * Is the `index`-th character of `chars` read `reading`? `pinyin` has a syllable per Han
 * character. Where it does not (erhua: "tóur" for 頭兒), that syllable anywhere in it counts.
 */
function isRead(chars: string[], index: number, pinyin: string, reading: string): boolean {
  const syllables = pinyin
    .normalize("NFC")
    .split(/\s+/)
    .map((syllable) => syllable.replace(/[^\p{L}\p{M}]/gu, ""))
    .filter(Boolean);
  const han = chars.flatMap((char, i) => (HAN.test(char) ? [i] : []));
  if (syllables.length !== han.length) return syllables.some((syllable) => syllable === reading || syllable === `${reading}r`);
  return syllables[han.indexOf(index)] === reading;
}

/** `converted`, with the compatibility ideographs of `source` put back. */
function keepCompatibilityIdeographs(source: string, converted: string): string {
  if (!COMPATIBILITY_IDEOGRAPH.test(source)) return converted;
  const chars = [...source];
  const result = [...converted];
  if (result.length !== chars.length) return source;
  return result.map((char, i) => (COMPATIBILITY_IDEOGRAPH.test(chars[i]!) ? chars[i]! : char)).join("");
}

/** `headword` in the forms of OpenCC's standard: tw2t, without the changes it gets wrong. */
export function standardSpelling(headword: string, pinyin: string): string {
  const chars = [...headword];
  const converted = [...toStandard(headword)];
  if (converted.length !== chars.length) return headword; // cannot be compared character by character
  let viaSimplified: string[] | undefined;
  return chars
    .map((char, i) => {
      const standard = converted[i]!;
      if (standard === char || COMPATIBILITY_IDEOGRAPH.test(char)) return char;
      const kept = KEPT_READING[char];
      if (kept && isRead(chars, i, pinyin, kept)) return char;
      if (MERGED.has(char)) {
        viaSimplified ??= [...fromSimplified(toSimplified(headword))];
        return viaSimplified.length === chars.length && viaSimplified[i] === standard ? standard : char;
      }
      return standard;
    })
    .join("");
}

/**
 * The spellings of `headword` in OpenCC's standard and in Hong Kong's forms, where they differ
 * from it: 群眾 → 羣衆, 羣眾. `pinyin` is the reading of the entry, a syllable per character.
 */
export function lookupSpellings(headword: string, pinyin: string): string[] {
  const standard = standardSpelling(headword, pinyin);
  const hongKong = keepCompatibilityIdeographs(standard, toHongKong(standard));
  return [...new Set([standard, hongKong])].filter((spelling) => spelling !== headword);
}

/**
 * `headword` in simplified characters, for the dictionaries whose sheet does not give it: tw2s,
 * with the 著 that is read zhù put back. Simplified writes 編著 as 编著 and 看著 as 看着, and tw2s
 * tells the two apart the way tw2t does: by a short list of words, 着 for every other one.
 */
export function simplifiedSpelling(headword: string, pinyin: string): string {
  const simplified = toSimplified(headword);
  if (!headword.includes("著")) return simplified;
  const chars = [...headword];
  const converted = [...simplified];
  if (converted.length !== chars.length) return simplified; // cannot be compared character by character
  return converted
    .map((char, i) => (chars[i] === "著" && char === "着" && isRead(chars, i, pinyin, KEPT_READING["著"]!) ? "著" : char))
    .join("");
}
