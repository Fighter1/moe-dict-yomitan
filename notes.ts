// What a build noticed about its source sheets. export.ts writes it to reports/build.json and
// scripts/release-notes.ts lists it in the release notes.
export const buildNotes = {
  /** 兩岸詞典: pinyin cells that could not be reconciled with the zhuyin cell of their row */
  unresolvedPinyin: [] as string[],
  /** readings whose pinyin cell is empty, truncated or not pinyin, and was taken from the zhuyin cell */
  pinyinFromZhuyin: [] as string[],
  /** pinyin cells that spell the zhuyin cell of their row with a different tone (left as they are) */
  toneMismatches: [] as string[],
};
export type BuildNotes = typeof buildNotes;
