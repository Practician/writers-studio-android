import assert from "node:assert/strict";
import { test } from "node:test";
import { anchorRangesToText } from "../src/lib/proofreadHighlights";

const WORD = "сметаллический";

function spellMark(text: string, word = WORD) {
  const start = text.indexOf(word);
  return { start, end: start + word.length, kind: "spelling" as const, id: "spelling:0", expected: word };
}

test("метка остаётся на месте, пока под ней тот же текст", () => {
  const text = "По поверхности булыжник проехался сметаллический звук.";
  const [mark] = anchorRangesToText(text, [spellMark(text)]);
  assert.equal(text.slice(mark.start, mark.end), WORD);
});

test("метка переезжает за словом, если автор дописал текст выше", () => {
  const older = "Илья шагнул внутрь укрытия. По поверхности булыжник проехался сметаллический звук.";
  const fresh =
    "Илья шагнул внутрь укрытия, пиная мелкие камни и носком кроссовка. По поверхности булыжник проехался сметаллический звук.";
  const stale = spellMark(older);
  const [mark] = anchorRangesToText(fresh, [stale]);
  assert.notEqual(mark.start, stale.start);
  assert.equal(fresh.slice(mark.start, mark.end), WORD);
  assert.equal(mark.id, "spelling:0");
});

test("из двух одинаковых слов выбирается ближайшее к прежнему месту", () => {
  const text = "сметаллический звук и потом сметаллический гул";
  const second = text.lastIndexOf(WORD);
  const [mark] = anchorRangesToText(text, [
    { start: second, end: second + WORD.length, kind: "spelling", expected: WORD },
  ]);
  assert.equal(mark.start, second);
});

test("метка выбрасывается, если слова в тексте больше нет", () => {
  const text = "По поверхности булыжник проехался тяжёлый звук.";
  assert.deepEqual(anchorRangesToText(text, [spellMark("звук и сметаллический звук")]), []);
});

test("диапазон без ожидаемого текста остаётся, если он внутри главы", () => {
  const text = "Илья присел и вытащил на свет плоский брусок.";
  const ranges = anchorRangesToText(text, [{ start: 0, end: 4, kind: "punctuation" }]);
  assert.equal(ranges.length, 1);
  assert.deepEqual(ranges[0], { start: 0, end: 4, kind: "punctuation", id: undefined });
});

test("диапазон за пределами текста выбрасывается", () => {
  const text = "Короткая глава.";
  assert.deepEqual(anchorRangesToText(text, [{ start: 40, end: 60, kind: "plot" }]), []);
});
