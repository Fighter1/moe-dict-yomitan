import { findSyllableBoundaries } from "pinyin-tone-tool";
import { buildNotes } from "./notes.ts";
import { alignWithZhuyin, normalizePinyin } from "./pinyin.ts";

const splitPinyinSyllables = (s: string) => findSyllableBoundaries(s).map((b) => s.slice(b.start, b.end));

function splitWithLibrary(s: string) {
  // the library does not know the erhua spelling "huěr" (會兒)
  if (s.includes("huěr"))
    return splitPinyinSyllables(s.replaceAll("huěr", "huǐr")).map((syllable) => syllable.replaceAll("huǐr", "huěr"));
  return splitPinyinSyllables(s);
}

/**
 * "yìshí-liǎnɡniǎo" -> "yì shí liǎng niǎo"
 * @param zhuyin the zhuyin cell of the same row WITH its original spacing; used to check (and if needed place) the syllable boundaries
 */
export function parsePinyin(raw: string, zhuyin?: string) {
  const s = normalizePinyin(raw).replace(/[-,]/g, " ");
  const { syllables, status } = alignWithZhuyin(s, splitWithLibrary(s), zhuyin);
  // the library could not split the cell cleanly and the zhuyin cell of the row could not settle it either
  if (status === "unresolved") buildNotes.unresolvedPinyin.push(`${raw}  /  ${zhuyin}`);
  return syllables.join(" ");
}
