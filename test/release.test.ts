// run with: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { OUTPUTS, isNewerRevision, repoFromRemoteUrl, resolveRevision } from "../release.ts";

test("a revision is the UTC date plus a build number", () => {
  assert.equal(resolveRevision("2026.11.15.7"), "2026.11.15.7");
  assert.equal(resolveRevision(" 2026.11.15.7\n"), "2026.11.15.7");
  // no REVISION: ".0", below any release of that day
  assert.equal(resolveRevision(undefined, new Date("2026-11-15T23:59:00Z")), "2026.11.15.0");
  assert.equal(resolveRevision("", new Date("2026-01-02T00:00:00Z")), "2026.01.02.0");
  // anything else would be compared as text by Yomitan
  assert.throws(() => resolveRevision("2026/11/15.1"));
  assert.throws(() => resolveRevision("2026.11.15"));
  assert.throws(() => resolveRevision("v2026.11.15.1"));
});

test("revisions are compared number by number", () => {
  assert.equal(isNewerRevision("2026.11.15.10", "2026.11.15.9"), true);
  assert.equal(isNewerRevision("2026.11.16.1", "2026.11.15.9"), true);
  assert.equal(isNewerRevision("2026.11.15.9", "2026.11.15.9"), false);
  assert.equal(isNewerRevision("2026.11.15.0", "2026.11.15.1"), false);
  assert.equal(isNewerRevision("2025.12.31.99", "2026.01.01.1"), false);
});

test("the repository is read from a GitHub remote URL", () => {
  for (const url of [
    "https://github.com/Fighter1/moe-dict-yomitan.git",
    "https://github.com/Fighter1/moe-dict-yomitan",
    "https://github.com/Fighter1/moe-dict-yomitan/\n",
    "git@github.com:Fighter1/moe-dict-yomitan.git",
    "ssh://git@github.com/Fighter1/moe-dict-yomitan.git",
    "ssh://git@github.com:22/Fighter1/moe-dict-yomitan.git",
    "ssh://git@ssh.github.com:443/Fighter1/moe-dict-yomitan.git",
  ])
    assert.equal(repoFromRemoteUrl(url), "Fighter1/moe-dict-yomitan", url);
  assert.equal(repoFromRemoteUrl("https://gitlab.com/someone/moe-dict-yomitan.git"), undefined);
  assert.equal(repoFromRemoteUrl("https://notgithub.com/someone/thing.git"), undefined);
});

test("a build has six zips, each with its index file", () => {
  assert.deepEqual(
    OUTPUTS.map((output) => `${output.zip} ${output.index}`),
    [
      "moe-concised-zhuyin.zip index-concised-zhuyin.json",
      "moe-concised-pinyin.zip index-concised-pinyin.json",
      "moe-revised-zhuyin.zip index-revised-zhuyin.json",
      "moe-revised-pinyin.zip index-revised-pinyin.json",
      "liangancidian-zhuyin.zip index-liangancidian-zhuyin.json",
      "liangancidian-pinyin.zip index-liangancidian-pinyin.json",
    ],
  );
});
