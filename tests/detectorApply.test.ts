import test from "node:test";
import assert from "node:assert/strict";
import { findDetectorSegmentRange, mergeBlockIntoRange } from "../src/lib/detectorApply";

/** Глава с настоящими абзацами; сегмент отчёта — те же буквы, но без `\n`, ё→е и без тире. */
const TITLE = "Глава 4. Ночь у чужого входа";
const PARAGRAPHS = [
  TITLE,
  "Вязанки дров чертовски копали в плечи. Васька шёл впереди, то и дело перехватывая мокрый бечевочный узел и сутулясь под тяжестью сырых сучьев.",
  "— Слушай, Илюха, а если тут ночью кто-нибудь припрётся? — Васька сбросил дрова у самого входа и вытер пот со лба тыльной стороной ладони.",
  "Илья подпёр шестом скалу и шагнул внутрь. Каменный свод над головой был ровным, без привычных для диких пещер натёков и трещин.",
];
const CHAPTER = PARAGRAPHS.join("\n\n");

function segmentOf(paragraphs: string[]): string {
  // Нейродетектор нормализует типографику: ё→е, тире реплик убраны, переносов нет.
  return paragraphs.join(" ").replace(/ё/gu, "е").replace(/—\s*/gu, "");
}

test("findDetectorSegmentRange: диапазон охватывает абзацы и пунктуацию, но не переносы", () => {
  const segment = segmentOf(PARAGRAPHS.slice(1));
  // Хвостовой абзац нужен, чтобы проверить правую границу: после сегмента не должно
  // ни теряться переноса, ни прилипать лишняя точка.
  const chapter = `${CHAPTER}\n\n— Тишина. Ничего.`;
  const range = findDetectorSegmentRange(chapter, segment);
  assert.ok(range, "сегмент обязан найтись в главе");
  const inside = chapter.slice(range!.start, range!.end);
  assert.ok(inside.startsWith("Вязанки дров"), `диапазон начинается с ${JSON.stringify(inside.slice(0, 30))}`);
  assert.ok(inside.endsWith("трещин."), "конечная точка сегмента входит в диапазон — иначе будет двойная");
  assert.ok(inside.includes("\n"), "диапазон охватывает внутренние абзацы главы");
  assert.equal(chapter[range!.end] ?? "", "\n", "перенос строки после сегмента должен сохраниться");
  assert.equal(chapter[range!.start - 1] ?? "", "\n", "перенос строки перед сегментом должен сохраниться");
  assert.ok(chapter.slice(range!.end).includes("Тишина"), "текст после сегмента не тронут");
});

test("mergeBlockIntoRange: абзацы главы сохраняются", () => {
  const segment = segmentOf(PARAGRAPHS.slice(1));
  const range = findDetectorSegmentRange(CHAPTER, segment)!;
  const original = CHAPTER.slice(range.start, range.end);
  const block = "Вязанки дров жгли плечи. Васька шёл впереди, перехватывая мокрый узел и сутулясь под тяжестью сучьев. "
    + "Слушай, Илюха, а если тут ночью кто-нибудь припрётся? — Васька сбросил дрова у самого входа. "
    + "Илья подпёр шестом скалу и шагнул внутрь. Каменный свод был ровным, без привычных натёков и трещин.";

  const merged = mergeBlockIntoRange(original, block);
  const before = original.split(/\n{2,}/u).length;
  const after = merged.split(/\n{2,}/u).length;
  assert.equal(after, before, `абзацев должно быть ${before}, получили ${after}`);
  assert.ok(!merged.includes(".."), "двойная точка на границе блока недопустима");
  assert.ok(merged.includes("жгли плечи"), "содержание правки в главе");
});

test("mergeBlockIntoRange: заголовок остаётся отдельным абзацем", () => {
  const segment = segmentOf(PARAGRAPHS);
  const range = findDetectorSegmentRange(CHAPTER, segment)!;
  const original = CHAPTER.slice(range.start, range.end);
  const block = segmentOf(PARAGRAPHS)
    .replace("Вязанки дров чертовски копали", "Вязанки дров жгли")
    .replace("шёл", "шел");
  const merged = mergeBlockIntoRange(original, block);
  const firstLine = merged.split(/\n{2,}/u)[0];
  assert.equal(firstLine, TITLE, `заголовок должен остаться своим абзацем, получили ${JSON.stringify(firstLine)}`);
  assert.ok(merged.includes("жгли"), "проза после заголовка");
  assert.ok(merged.split(/\n{2,}/u).length >= PARAGRAPHS.length - 1, "абзацы прозы не схлопнуты");
});

test("mergeBlockIntoRange: блок без заголовка не теряет заголовок главы", () => {
  const segment = segmentOf(PARAGRAPHS);
  const range = findDetectorSegmentRange(CHAPTER, segment)!;
  const original = CHAPTER.slice(range.start, range.end);
  // Модель «проглотила» заголовок — он всё равно должен сохраниться.
  const block = segmentOf(PARAGRAPHS.slice(1));
  const merged = mergeBlockIntoRange(original, block);
  assert.ok(merged.startsWith(TITLE), "заголовок берётся из оригинала, а не из блока");
});

test("mergeBlockIntoRange: одноабзацный диапазон и пустой блок", () => {
  const oneParagraph = PARAGRAPHS[1];
  assert.equal(mergeBlockIntoRange(oneParagraph, "Вязанки дров жгли плечи."), "Вязанки дров жгли плечи.");
  assert.equal(mergeBlockIntoRange(CHAPTER, "   "), CHAPTER, "пустой блок не должен ничего трогать");
});

test("mergeBlockIntoRange: фраз меньше, чем абзацев — пустых абзацев не остаётся", () => {
  const original = ["Первый абзац из двух предложений. Второе предложение здесь.", "Второй абзац.", "Третий абзац."].join("\n\n");
  const merged = mergeBlockIntoRange(original, "Одно предложение на весь кусок.");
  assert.ok(!/\n{3,}/u.test(merged), "пустых абзацев не должно быть");
  assert.equal(merged, "Одно предложение на весь кусок.");
});
