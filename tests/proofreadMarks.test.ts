import assert from "node:assert/strict";
import { test } from "node:test";
import { MIRROR_MARK_LIMIT, marksNotice } from "../src/lib/proofreadMarks";

const clean = {
  segmentCount: 1,
  dictionaryStatus: "ready" as const,
  dictionaryError: "",
  spellTruncated: false,
  hasText: true,
};

test("метки есть — объяснять нечего", () => {
  assert.equal(marksNotice(clean), null);
});

test("меток больше потолка — говорим прямо, но нажатие работает", () => {
  const notice = marksNotice({ ...clean, segmentCount: MIRROR_MARK_LIMIT + 1 });
  assert.ok(notice && notice.includes(String(MIRROR_MARK_LIMIT + 1)));
  assert.ok(notice && notice.includes("нажатием"));
});

test("словарь не загрузился — это тоже причина, и о ней видно", () => {
  const notice = marksNotice({ ...clean, dictionaryStatus: "error", dictionaryError: "network", segmentCount: 0 });
  assert.ok(notice && notice.includes("словарь не загрузился"));
  assert.ok(notice && notice.includes("network"));
  assert.ok(notice && notice.includes("пунктуации"));
});

test("глава обрезана по потолку проверки", () => {
  const notice = marksNotice({ ...clean, spellTruncated: true });
  assert.ok(notice && notice.includes("не все слова"));
});

test("проверка дошла до конца и ничего не нашла", () => {
  const notice = marksNotice({ ...clean, segmentCount: 0 });
  assert.ok(notice && notice.includes("меток нет"));
});

test("пустая глава — молчим, а не рапортуем о чистоте", () => {
  assert.equal(marksNotice({ ...clean, segmentCount: 0, hasText: false }), null);
});

test("пока словарь грузится, повода для объяснений нет", () => {
  assert.equal(marksNotice({ ...clean, dictionaryStatus: "loading", segmentCount: 0 }), null);
});
