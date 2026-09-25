import test from "node:test";
import assert from "node:assert/strict";
import { buildStyleReport, sentenceSpans } from "../src/lib/styleObservations";
import { buildHighlightSegments } from "../src/lib/proofreadHighlights";

test("повтор слова в соседних предложениях попадает в наблюдения", () => {
  const report = buildStyleReport("Комната пахла пылью. Комната была пуста.");
  const repeats = report.observations.filter((item) => item.category === "Повтор слова");
  assert.equal(repeats.length, 1);
  assert.equal(repeats[0].quote.toLowerCase(), "комната");
  assert.equal(report.metrics.lexicalRepeats, 1);
});

test("шаблонные обороты и абстрактные действующие лица дают наблюдения со смещениями", () => {
  const text = "В тот самый момент всё исчезло. Паника навалилась на него.";
  const report = buildStyleReport(text);
  const phrase = report.observations.find((item) => item.category === "Шаблонные обороты");
  assert.ok(phrase);
  assert.equal(text.slice(phrase.start, phrase.end).toLowerCase(), "в тот самый момент");
  assert.ok(report.observations.some((item) => item.category === "Абстрактные действующие лица"));
});

test("длинное предложение помечается, короткий чистый текст — нет", () => {
  const long = `Он ${Array.from({ length: 50 }, (_, index) => `шаг${index}`).join(" ")}.`;
  const report = buildStyleReport(long);
  const longOnes = report.observations.filter((item) => item.category === "Длинное предложение");
  assert.equal(longOnes.length, 1);
  assert.equal(longOnes[0].start, 0);

  const clean = buildStyleReport("Он вошёл в дом.");
  assert.equal(clean.observations.length, 0);
  assert.equal(clean.signals.length, 0);
  assert.equal(clean.calibration, null);
});

test("разбиение на предложения сохраняет смещения", () => {
  const text = "Первое предложение. Второе предложение!";
  const spans = sentenceSpans(text);
  assert.equal(spans.length, 2);
  assert.equal(text.slice(spans[0].start, spans[0].end), "Первое предложение.");
  assert.equal(text.slice(spans[1].start, spans[1].end), "Второе предложение!");
});

test("сравнение с авторским образцом включается только на длинном образце", () => {
  const reference = "Ну, что ж! Я пошёл дальше, хотя ноги гудели... Однако выбора не было. Так и шёл. ".repeat(2);
  const report = buildStyleReport("Я двинулся дальше. Вот ведь дорога.", reference);
  assert.ok(report.calibration);
  assert.ok(report.calibration.similarity > 0 && report.calibration.similarity <= 100);
  assert.equal(report.calibration.weakest.length, 3);
  assert.equal(buildStyleReport("Коротко.", "Мало.").calibration, null);
});

test("подсветка склеивает куски и не пересекается", () => {
  const text = "Он вошёл в комнатуи , и замер.";
  const segments = buildHighlightSegments(text, [
    { start: 11, end: 19, kind: "spelling" },
    { start: 12, end: 14, kind: "punctuation" },
    { start: 20, end: 21, kind: "punctuation" },
  ]);
  assert.equal(segments.map((segment) => segment.kind).join(","), "plain,spelling,plain,punctuation,plain");
  assert.equal(segments.map((segment) => segment.text).join(""), text);
  const spelling = segments.find((segment) => segment.kind === "spelling");
  assert.equal(spelling?.text, "комнатуи");
});
