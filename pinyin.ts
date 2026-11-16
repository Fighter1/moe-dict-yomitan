/**
 * Helpers around pinyin-tone-tool for the 兩岸詞典 pinyin columns.
 *
 * The sheet stores Hanyu Pinyin joined ("yìshí-liǎnɡniǎo", "wùniè", "fǎn’ér"); pinyin-tone-tool cuts it into
 * syllables. Two things go wrong if its output is used as is:
 *
 *   - it only keeps what it recognises, so anything else disappears without a trace. The sheet types a
 *     toneless a as ɑ (U+0251), which cost every neutral-tone -a syllable (媽媽 "mā", 嗎 "");
 *   - some cuts cannot be right: "hérú" -> "hér ú" (何如), and rows where the sheet forgot the apostrophe
 *     (南歐 "nánōu", 陳子昂 "chénzǐánɡ") or has a stray space ("wùj iānɡshān").
 *
 * So the input is normalised first, and the result is compared with the zhuyin cell of the same row, which
 * has explicit per-syllable spacing. When both cells spell the same letters, the zhuyin spacing decides where
 * the cuts go; when they do not, the row is reported instead of being silently wrong.
 */

const TONE_MARKS: Record<string, string> = { a: "āáǎà", e: "ēéěè", i: "īíǐì", o: "ōóǒò", u: "ūúǔù", ü: "ǖǘǚǜ" };
const TONED_TO_BASE = new Map<string, [base: string, tone: number]>();
for (const [base, marks] of Object.entries(TONE_MARKS))
  [...marks].forEach((m, i) => TONED_TO_BASE.set(m, [base, i + 1]));

const VOWELS = new Set([..."aeiouüê", ...TONED_TO_BASE.keys()]);

/**
 * The sheet is typeset the mainland way: script ɡ (U+0261) for g and - for a toneless a only - ɑ (U+0251).
 * Anything that does not know ɑ is a vowel loses every neutral-tone -a syllable (媽媽 māmɑ, 早上 zǎoshɑng).
 * The breves are typos for carons (做臉 "zuòliăn").
 */
const LOOKALIKES: Record<string, string> = { ɡ: "g", ɑ: "a", ă: "ǎ", ĕ: "ě", ĭ: "ǐ", ŏ: "ǒ", ŭ: "ǔ" };
const SEPARATORS = /[\s\-–—－,，、;；·‧・'’‘`/]+/u;

/** Call this BEFORE handing a cell to pinyin-tone-tool. */
export const normalizePinyin = (raw: string) =>
  [...raw.normalize("NFC")].map((c) => LOOKALIKES[c] ?? c).join("").trim();

const stripTones = (s: string) =>
  [...s.toLowerCase()].map((c) => TONED_TO_BASE.get(c)?.[0] ?? c).join("");

// ---------------------------------------------------------------------------------------------
// zhuyin -> toneless pinyin, only used to cross-check / place syllable boundaries

const ZHUYIN_INITIALS: Record<string, string> = {
  ㄅ: "b", ㄆ: "p", ㄇ: "m", ㄈ: "f", ㄉ: "d", ㄊ: "t", ㄋ: "n", ㄌ: "l", ㄍ: "g", ㄎ: "k", ㄏ: "h",
  ㄐ: "j", ㄑ: "q", ㄒ: "x", ㄓ: "zh", ㄔ: "ch", ㄕ: "sh", ㄖ: "r", ㄗ: "z", ㄘ: "c", ㄙ: "s",
};
const ZHUYIN_FINALS: Record<string, string> = {
  ㄚ: "a", ㄛ: "o", ㄜ: "e", ㄝ: "ê", ㄞ: "ai", ㄟ: "ei", ㄠ: "ao", ㄡ: "ou", ㄢ: "an", ㄣ: "en", ㄤ: "ang", ㄥ: "eng", ㄦ: "er",
};
// spelling of medial + final, without an initial (yi, wu, yu ...) and after one (-i-, -u-, -ü-)
// The e and (for ㄩ) a rows are not standard syllables; the sheets write erhua that way:
// ㄏㄨㄜˇㄦ huěr (會兒), ㄨㄜˋㄦ wèr (味兒), ㄩㄚˊㄦ yuár (圓兒).
const NO_INITIAL: Record<string, Record<string, string>> = {
  ㄧ: { "": "yi", a: "ya", o: "yo", e: "ye", ê: "ye", ai: "yai", ao: "yao", ou: "you", an: "yan", en: "yin", ang: "yang", eng: "ying" },
  ㄨ: { "": "wu", a: "wa", o: "wo", e: "we", ai: "wai", ei: "wei", an: "wan", en: "wen", ang: "wang", eng: "weng" },
  ㄩ: { "": "yu", a: "yua", e: "yue", ê: "yue", an: "yuan", en: "yun", eng: "yong" },
};
const AFTER_INITIAL: Record<string, Record<string, string>> = {
  ㄧ: { "": "i", a: "ia", o: "io", e: "ie", ê: "ie", ai: "iai", ao: "iao", ou: "iu", an: "ian", en: "in", ang: "iang", eng: "ing" },
  ㄨ: { "": "u", a: "ua", o: "uo", e: "ue", ai: "uai", ei: "ui", an: "uan", en: "un", ang: "uang", eng: "ong" },
  ㄩ: { "": "ü", a: "üa", e: "üe", ê: "üe", an: "üan", en: "ün", eng: "iong" },
};
// The sheets type ㄧ as a vertical bar (it is one in vertical text) and a few tone marks as lookalikes.
const ZHUYIN_VARIANTS: Record<string, string> = {
  "丨": "ㄧ", "｜": "ㄧ", "〡": "ㄧ",
  "‵": "ˋ", "′": "ˊ",
  "‧": "˙", "·": "˙", "•": "˙",
};
const ZHUYIN_SEPARATORS = /[\s，,﹐、；;。]+/gu;

/** A zhuyin cell with the variant characters replaced and private-use glyphs removed; spacing is kept. */
export const normalizeZhuyin = (raw: string) =>
  [...raw].map((c) => ZHUYIN_VARIANTS[c] ?? c).join("").replace(/[\uE000-\uF8FF]/gu, "");

/** A zhuyin cell as a reading: normalised and without the spacing between syllables. */
export const zhuyinReading = (raw: string) => normalizeZhuyin(raw).replace(ZHUYIN_SEPARATORS, "");

/** The syllables of a zhuyin cell that has its per-syllable spacing. */
const splitZhuyin = (zhuyin: string) => normalizeZhuyin(zhuyin).split(ZHUYIN_SEPARATORS).filter(Boolean);

export type Tone = 0 | 1 | 2 | 3 | 4;
const ZHUYIN_TONES: Record<string, Tone> = { "˙": 0, "ˊ": 2, "ˇ": 3, "ˋ": 4 };

/** The tone of a zhuyin syllable: the first tone has no mark, the neutral tone a dot. */
function zhuyinTone(syllable: string): Tone {
  for (const c of syllable) if (c in ZHUYIN_TONES) return ZHUYIN_TONES[c]!;
  return 1;
}

/** One zhuyin syllable -> toneless pinyin ("huar" style for erhua), or undefined if it is not standard zhuyin. */
function zhuyinSyllableToPinyin(syllable: string): string | undefined {
  let z = normalizeZhuyin(syllable).replace(/[ˊˇˋ˙]/gu, "");
  let erhua = "";
  if (z.length > 1 && z.endsWith("ㄦ")) {
    erhua = "r";
    z = z.slice(0, -1);
  }
  let initial = "";
  if (z[0] !== undefined && z[0] in ZHUYIN_INITIALS) {
    initial = ZHUYIN_INITIALS[z[0]]!;
    z = z.slice(1);
  }
  let medial = "";
  if (z[0] !== undefined && z[0] in NO_INITIAL) {
    medial = z[0];
    z = z.slice(1);
  }
  let final = "";
  if (z) {
    const f = ZHUYIN_FINALS[z];
    if (f === undefined) return undefined;
    final = f;
  }
  let pinyin: string | undefined;
  if (!initial) {
    pinyin = medial ? NO_INITIAL[medial]![final] : final;
  } else {
    let rest: string | undefined;
    if (medial) {
      rest = AFTER_INITIAL[medial]![final];
      if (rest !== undefined && medial === "ㄩ" && "jqx".includes(initial) && rest !== "iong") rest = rest.replace("ü", "u");
    } else rest = final || (["zh", "ch", "sh", "r", "z", "c", "s"].includes(initial) ? "i" : "");
    pinyin = rest === undefined ? undefined : initial + rest;
  }
  if (!pinyin) return undefined;
  return (pinyin === "ê" ? pinyin : pinyin.replace("ê", "e")) + erhua;
}

/** Expected toneless syllables; an entry is undefined where the zhuyin is non-standard (ㄏㄨㄜˇㄦ ...). */
function zhuyinToSyllables(zhuyin: string): (string | undefined)[] {
  return splitZhuyin(zhuyin).map(zhuyinSyllableToPinyin);
}

// ---------------------------------------------------------------------------------------------

/** A toneless syllable with the mark of `tone` on the vowel that carries it. */
function withToneMark(plain: string, tone: Tone): string {
  if (tone === 0) return plain;
  const letters = [...plain];
  // a and e always take the mark, then the o of "ou", otherwise the last vowel
  let at = plain.search(/[ae]/u);
  if (at < 0) at = plain.indexOf("ou");
  if (at < 0) at = Math.max(...[..."iouü"].map((v) => plain.lastIndexOf(v)));
  if (at < 0) return plain;
  letters[at] = TONE_MARKS[letters[at]!]![tone - 1]!;
  return letters.join("");
}

/** The tone a pinyin syllable is marked with (0: no mark), or undefined when it has several marks. */
export function pinyinTone(syllable: string): Tone | undefined {
  const marked = [...syllable].filter((c) => TONED_TO_BASE.has(c));
  if (marked.length > 1) return undefined;
  return marked.length ? (TONED_TO_BASE.get(marked[0]!)![1] as Tone) : 0;
}

/** Moves a tone mark that sits on the wrong vowel (the sheet has "shìdɑì", "toú", "hùi", "ɡǔo"). */
function fixToneMarkPlacement(syllable: string): string {
  const tone = pinyinTone(syllable);
  if (!tone) return syllable;
  const plain = [...syllable].map((c) => TONED_TO_BASE.get(c)?.[0] ?? c).join("");
  return withToneMark(plain, tone);
}

/**
 * Pinyin, one space per syllable, for a zhuyin cell that has its per-syllable spacing
 * ("ㄕㄣ　ㄘㄥˊ" -> "shēn céng"). Undefined when a syllable is not standard zhuyin.
 */
export function zhuyinToPinyin(zhuyin: string): string | undefined {
  const convert = (syllable: string) => {
    const plain = zhuyinSyllableToPinyin(syllable);
    return plain === undefined ? undefined : withToneMark(plain, zhuyinTone(syllable));
  };
  const syllables = splitZhuyin(zhuyin).flatMap((chunk) => {
    const whole = /[ˊˇˋ].*[ˊˇˋ]/u.test(chunk) ? undefined : convert(chunk);
    if (whole !== undefined) return [whole];
    // typed without spacing ("ㄏㄜˊㄕㄤˋ"): a tone mark ends a syllable, a neutral-tone dot starts one
    return (chunk.match(/˙?[^ˊˇˋ˙]+[ˊˇˋ]?/gu) ?? [chunk]).map(convert);
  });
  return syllables.length && !syllables.includes(undefined) ? syllables.join(" ") : undefined;
}

/**
 * Syllables whose tone differs between a pinyin reading (one space per syllable) and the zhuyin
 * cell of the same row, as "pinyin≠zhuyin" pairs. Empty when the two cannot be compared.
 */
export function toneMismatches(pinyin: string, zhuyin: string): string[] {
  const p = pinyin.split(" ").filter(Boolean);
  const z = splitZhuyin(zhuyin);
  if (p.length !== z.length) return [];
  return p.flatMap((syllable, i) => {
    const expected = zhuyinSyllableToPinyin(z[i]!);
    if (expected === undefined || expected !== stripTones(syllable)) return [];
    const tone = pinyinTone(syllable.toLowerCase());
    return tone === undefined || tone === zhuyinTone(z[i]!) ? [] : [`${syllable}≠${z[i]}`];
  });
}

export type SplitStatus =
  | "empty" // nothing pronounceable in the cell
  | "unchecked" // no zhuyin to compare with
  | "agree" // the library's split and the zhuyin column agree
  | "guided" // same letters as the zhuyin, but the library cut them differently: zhuyin spacing wins
  | "unresolved"; // the cells spell different things, or letters got lost and the zhuyin cannot settle it

/**
 * @param pinyin the NORMALISED pinyin cell (see normalizePinyin)
 * @param split what pinyin-tone-tool made of it
 * @param zhuyin the zhuyin cell of the same row, WITH its original spacing (optional)
 */
export function alignWithZhuyin(pinyin: string, split: string[], zhuyin?: string): { syllables: string[]; status: SplitStatus } {
  const done = (syllables: string[], status: SplitStatus) => ({ syllables: syllables.map(fixToneMarkPlacement), status });
  const letters = pinyin.split(SEPARATORS).join("");
  if (![...letters.toLowerCase()].some((c) => VOWELS.has(c))) return done([], "empty");
  const lostLetters = stripTones(split.join("")) !== stripTones(letters);
  const expected = zhuyin ? zhuyinToSyllables(zhuyin) : [];
  if (!expected.length) return done(split, lostLetters ? "unresolved" : "unchecked");
  if (!lostLetters && expected.length === split.length && expected.every((e, i) => e === undefined || e === stripTones(split[i]!)))
    return done(split, "agree");
  if (!expected.includes(undefined) && stripTones(letters) === expected.join("")) {
    let at = 0;
    return done(expected.map((e) => letters.slice(at, (at += e!.length))), "guided");
  }
  return done(split, "unresolved");
}
