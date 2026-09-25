import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRuSpellChecker, normalizeSpellKey, scanSpellIssues } from "../src/lib/spellRu";

const aff = readFileSync(new URL("../public/dictionaries/ru_RU.aff", import.meta.url), "utf8");
const dic = readFileSync(new URL("../public/dictionaries/ru_RU.dic", import.meta.url), "utf8");
const checker = createRuSpellChecker(aff, dic);

const TYPO_WORDS = ["прийдя", "комнатуи", "прекрастный", "Практициан", "сабака", "ашибка"];
const GOOD_WORDS = ["комнату", "замер", "Анна", "Практикант", "ежик", "ёжик"];

test("словарь находит опечатки", () => {
  for (const typo of TYPO_WORDS) {
    const scan = scanSpellIssues(checker, `Он ${typo} у двери.`);
    const words = scan.issues.map((issue) => issue.word);
    assert.ok(words.includes(typo), `не найдена опечатка: ${typo} (найдено: ${words.join(", ")})`);
  }
});

test("словарь не трогает верные слова и имена", () => {
  for (const good of GOOD_WORDS) {
    const scan = scanSpellIssues(checker, `Тут ${good} и всё.`);
    assert.equal(scan.issues.length, 0, `ложное срабатывание на «${good}»: ${scan.issues.map((i) => i.word).join(", ")}`);
  }
});

test("свои слова и составные слова не считаются ошибками", () => {
  const text = "Мглинск спал. Кто-то пришёл из-за угла.";
  const without = scanSpellIssues(checker, text);
  assert.ok(without.issues.some((issue) => issue.word === "Мглинск"));

  const withOwn = scanSpellIssues(checker, text, { extraWords: ["мглинск"] });
  assert.equal(withOwn.issues.length, 0, `своё слово не учтено: ${withOwn.issues.map((i) => i.word).join(", ")}`);
  assert.ok(normalizeSpellKey("МГЛИНСК") === normalizeSpellKey("мглинск"));
});

test("смещения указывают точно на слово", () => {
  const text = "Он вошёл в комнатуи и замер.";
  const scan = scanSpellIssues(checker, text);
  assert.equal(scan.issues.length, 1);
  const issue = scan.issues[0];
  assert.equal(text.slice(issue.start, issue.end), "комнатуи");
});

test("латиница, цифры и аббревиатуры не проверяются", () => {
  const scan = scanSpellIssues(checker, "Файл report.txt 2019 года, МЧС и СССР.");
  assert.equal(scan.issues.length, 0, `шум: ${scan.issues.map((i) => i.word).join(", ")}`);
});

test("подсказки замен выдаются по клику", () => {
  const suggestions = checker.suggest("прекрастный");
  assert.ok(suggestions.includes("прекрасный"), `нет подсказки: ${suggestions.join(", ")}`);
});

test("проверка длинной главы быстрая", () => {
  const paragraph = "Он вошёл в комнату и замер у окна, потому что шум за дверью стал громче. ";
  const text = paragraph.repeat(1400) + " Тут комнатуи и прекрастный вид.";
  assert.ok(text.length > 100000, `мало текста для замера: ${text.length}`);
  const started = Date.now();
  const scan = scanSpellIssues(checker, text);
  const elapsed = Date.now() - started;
  assert.ok(scan.checkedWords > 15000, `проверено слов: ${scan.checkedWords}`);
  assert.ok(elapsed < 500, `проверка заняла ${elapsed} мс`);
  console.log(`замер: ${text.length} знаков, ${scan.checkedWords} слов, ${elapsed} мс`);
});
