import test from "node:test";
import assert from "node:assert/strict";
import { buildActiveMark, findMarkAtOffset, visibleMarkOrder } from "../src/lib/proofreadTap";
import { buildHighlightSegments, DEFAULT_MARK_VISIBILITY, markId, type MarkKind } from "../src/lib/proofreadHighlights";
import type { PunctuationIssue } from "../src/lib/punctuationRules";
import type { PlotCheckIssue } from "../src/lib/plotCheck";
import type { SpellIssue } from "../src/lib/spellRu";

const SPELL: SpellIssue[] = [{ word: "ббанановых", start: 10, end: 20 }];
const PUNCT: PunctuationIssue[] = [
  {
    rule: "double-space",
    message: "Двойной пробел",
    found: "  ",
    replacement: " ",
    start: 30,
    end: 32,
    severity: "note",
  },
];
const PLOT: PlotCheckIssue[] = [
  { kind: "continuity", quote: "замер у двери", explanation: "В прошлой главе он уже ушёл.", start: 8, end: 22 },
];

const LISTS = { spelling: SPELL, punctuation: PUNCT, plot: PLOT };

test("нажатие внутри слова открывает метку правописания", () => {
  assert.deepEqual(findMarkAtOffset(15, LISTS), { kind: "spelling", index: 0 });
});

test("границы метки полуоткрытые: начало входит, конец — нет", () => {
  assert.deepEqual(findMarkAtOffset(10, { spelling: SPELL }), { kind: "spelling", index: 0 });
  assert.equal(findMarkAtOffset(20, { spelling: SPELL }), null);
});

test("нажатие по пустому месту не открывает карточку", () => {
  assert.equal(findMarkAtOffset(25, { spelling: SPELL, punctuation: PUNCT, plot: [{ start: 40, end: 44 }] }), null);
});

test("мелкая метка важнее длинной цитаты стыковки", () => {
  // 15 попадает и в слово (10..20), и в цитату (8..22): показываем правописание.
  assert.deepEqual(findMarkAtOffset(15, LISTS), { kind: "spelling", index: 0 });
  // 21..22 — уже только внутри цитаты.
  assert.deepEqual(findMarkAtOffset(21, LISTS), { kind: "plot", index: 0 });
});

test("выключенный вид меток не открывается нажатием", () => {
  const order = visibleMarkOrder({ spelling: false, punctuation: true, plot: true });
  assert.deepEqual(order, ["punctuation", "plot"]);
  assert.deepEqual(findMarkAtOffset(15, LISTS, order), { kind: "plot", index: 0 });
  assert.equal(findMarkAtOffset(31, LISTS, visibleMarkOrder({ spelling: false, punctuation: false, plot: false })), null);
});

test("порядок опроса меток можно задать явно", () => {
  const order: MarkKind[] = ["plot", "punctuation", "spelling"];
  assert.deepEqual(findMarkAtOffset(15, LISTS, order), { kind: "plot", index: 0 });
});

test("карточка орфографии: слово, причина, без замены", () => {
  const mark = buildActiveMark({ kind: "spelling", index: 0 }, LISTS);
  assert.ok(mark);
  assert.equal(mark.quote, "ббанановых");
  assert.equal(mark.replacement, "");
  assert.equal(mark.kind, "spelling");
  assert.match(mark.message, /словаре/);
});

test("карточка пунктуации: правило и готовая замена", () => {
  const mark = buildActiveMark({ kind: "punctuation", index: 0 }, LISTS);
  assert.ok(mark);
  assert.equal(mark.label, "Двойной пробел");
  assert.equal(mark.replacement, " ");
  assert.equal(mark.start, 30);
});

test("карточка стыковки: цитата и объяснение модели", () => {
  const mark = buildActiveMark({ kind: "plot", index: 0 }, LISTS);
  assert.ok(mark);
  assert.equal(mark.quote, "замер у двери");
  assert.match(mark.message, /прошлой главе/);
  assert.equal(mark.replacement, "");
});

test("битый индекс — null, а не пустая карточка", () => {
  assert.equal(buildActiveMark({ kind: "spelling", index: 7 }, LISTS), null);
  assert.equal(buildActiveMark({ kind: "plot", index: 3 }, LISTS), null);
});

test("зеркальный слой: выключенный вид в текст не попадает", () => {
  const text = "abcdefghijббанановых  конец";
  const ranges = [
    { start: 10, end: 20, kind: "spelling" as const, id: markId("spelling", 0) },
    { start: 21, end: 23, kind: "punctuation" as const, id: markId("punctuation", 0) },
  ];
  const all = buildHighlightSegments(text, ranges);
  assert.deepEqual(
    all.filter((segment) => segment.kind !== "plain").map((segment) => segment.kind),
    ["spelling", "punctuation"],
  );
  assert.equal(all.find((segment) => segment.kind === "spelling")?.id, "spelling:0");
  assert.equal(all.map((segment) => segment.text).join(""), text);

  const withoutPunctuation = buildHighlightSegments(text, ranges, { ...DEFAULT_MARK_VISIBILITY, punctuation: false });
  assert.deepEqual(
    withoutPunctuation.filter((segment) => segment.kind !== "plain").map((segment) => segment.kind),
    ["spelling"],
  );
});

test("зеркальный слой: фраза стыковки уступает слову внутри неё", () => {
  // Тап внутри цитаты открыл бы правописание, поэтому violet-волны там не рисуем.
  const text = "0123456789абвгд";
  const segments = buildHighlightSegments(text, [
    { start: 10, end: 15, kind: "plot" as const, id: markId("plot", 0) },
    { start: 11, end: 14, kind: "spelling" as const, id: markId("spelling", 0) },
  ]);
  const marked = segments.filter((segment) => segment.kind !== "plain");
  assert.deepEqual(
    marked.map((segment) => [segment.kind, segment.text, segment.id]),
    [["spelling", "бвг", "spelling:0"]],
  );
  assert.equal(segments.map((segment) => segment.text).join(""), text);
});

test("зеркальный слой: стыковка без пересечений рисуется рядом со словом", () => {
  const text = "0123456789абвгд";
  const marked = buildHighlightSegments(text, [
    { start: 3, end: 6, kind: "plot" as const, id: markId("plot", 0) },
    { start: 11, end: 14, kind: "spelling" as const, id: markId("spelling", 0) },
  ]).filter((segment) => segment.kind !== "plain");
  assert.deepEqual(
    marked.map((segment) => segment.kind),
    ["plot", "spelling"],
  );
});
