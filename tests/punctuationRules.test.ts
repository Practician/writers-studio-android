import test from "node:test";
import assert from "node:assert/strict";
import { applyPunctuationFix, findPunctuationIssues } from "../src/lib/punctuationRules";

const rulesOf = (text: string) => findPunctuationIssues(text).map((issue) => issue.rule);

test("двойной пробел: находится, одиночный — нет", () => {
  assert.deepEqual(rulesOf("Он  вошёл в дом."), ["double-space"]);
  assert.deepEqual(rulesOf("Он вошёл в дом."), []);
  // Отступ в начале строки — не ошибка.
  assert.deepEqual(rulesOf("Первый абзац.\n    Второй абзац."), []);
});

test("пробел перед знаком препинания: находится, верный вариант — нет", () => {
  const issues = findPunctuationIssues("Он вошёл , и сел .");
  assert.equal(issues.length, 2);
  assert.equal(issues[0].rule, "space-before-punctuation");
  assert.equal(issues[0].replacement, ",");
  assert.deepEqual(rulesOf("Он вошёл, и сел."), []);
});

test("нет пробела после знака: находится, сокращения не трогаются", () => {
  const issues = findPunctuationIssues("Он вошёл,и сел!Тут же встал:");
  assert.equal(issues.filter((issue) => issue.rule === "missing-space-after-punctuation").length, 2);
  assert.deepEqual(rulesOf("Он вошёл, и сел! Тут же встал: да."), []);
  // «т.е.» и десятичные дроби не должны попадать в правило.
  assert.deepEqual(rulesOf("То есть т.е. примерно. Итого 5,5 метра."), []);
});

test("дефис вместо тире: находится, числовые диапазоны и дефис в слове — нет", () => {
  const issues = findPunctuationIssues("— Я пришёл - сказал он.");
  assert.deepEqual(issues.map((issue) => issue.rule), ["hyphen-as-dash"]);
  assert.equal(issues[0].replacement, " — ");
  assert.deepEqual(rulesOf("Он ждал 2 - 3 часа."), []);
  assert.deepEqual(rulesOf("Кто-то пришёл из-за угла."), []);
});

test("прямые кавычки превращаются в ёлочки", () => {
  const issues = findPunctuationIssues('"Стой", — сказал он.');
  const quoteIssues = issues.filter((issue) => issue.rule === "straight-quotes");
  assert.equal(quoteIssues.length, 2);
  assert.equal(quoteIssues[0].replacement, "«");
  assert.equal(quoteIssues[1].replacement, "»");
  assert.deepEqual(rulesOf("«Стой», — сказал он."), []);
});

test("сломанное многоточие: две точки и четыре, но не три", () => {
  assert.deepEqual(rulesOf("Он замолчал.."), ["broken-ellipsis"]);
  assert.deepEqual(rulesOf("Он замолчал...."), ["broken-ellipsis"]);
  assert.deepEqual(rulesOf("Он замолчал..."), []);
});

test("выдача отсортирована, замена применяется к одному месту", () => {
  const text = "Он  вошёл,и сказал : \"стой\"..";
  const issues = findPunctuationIssues(text);
  assert.ok(issues.length >= 4);
  for (let index = 1; index < issues.length; index += 1) {
    assert.ok(issues[index].start >= issues[index - 1].start);
  }
  const first = issues[0];
  const fixed = applyPunctuationFix(text, first);
  assert.ok(fixed.length < text.length);
  assert.equal(fixed.slice(0, first.start), text.slice(0, first.start));
});
