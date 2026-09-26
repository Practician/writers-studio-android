import test from "node:test";
import assert from "node:assert/strict";
import { addPersonalWord, loadPersonalWords, mergeKnownWords, removePersonalWord, savePersonalWords } from "../src/lib/personalDictionary";
import { scanSpellIssues, type RuSpellChecker } from "../src/lib/spellRu";

/** Словарь, который не знает ни одного слова: любое слово без «своих» — ошибка. */
const empty: RuSpellChecker = { check: () => false, suggest: () => [] };

test("слово из личного словаря движок больше не помечает", () => {
  const before = scanSpellIssues(empty, "нажал на электронку и замер", {});
  assert.deepEqual(
    before.issues.map((issue) => issue.word),
    ["нажал", "на", "электронку", "замер"],
  );

  const words = addPersonalWord([], "электронку");
  const after = scanSpellIssues(empty, "нажал на электронку и замер", { extraWords: words });
  assert.deepEqual(
    after.issues.map((issue) => issue.word),
    ["нажал", "на", "замер"],
  );
});

test("ё и е в личном словаре не различимы, как и регистр", () => {
  const words = addPersonalWord([], "Ещё");
  assert.equal(scanSpellIssues(empty, "еще", { extraWords: words }).issues.length, 0);
});

test("повторное добавление не меняет список — состояние остаётся прежним", () => {
  const first = addPersonalWord([], "электронку");
  const second = addPersonalWord(first, " электронку ");
  assert.equal(second, first);
  assert.equal(second.length, 1);
});

test("пустое слово в личный словарь не уходит", () => {
  const words = addPersonalWord(["электронку"], "   ");
  assert.deepEqual(words, ["электронку"]);
});

test("удаление убирает слово с любой записью", () => {
  assert.deepEqual(removePersonalWord(["Ещё", "электронку"], "еще"), ["электронку"]);
});

test("свои слова, имена героев и термины складываются без повторов", () => {
  const merged = mergeKnownWords(["электронку", "Вейпер"], ["вейпер", "Вася"], ["Правило"]);
  assert.deepEqual(merged, ["электронку", "Вейпер", "Вася", "Правило"]);
});

test("личный словарь переживает запись и чтение хранилища", () => {
  const store = new Map<string, string>();
  const host = globalThis as unknown as { localStorage?: unknown };
  const previous = host.localStorage;
  host.localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  };
  try {
    savePersonalWords(["электронку", "Вейпер"]);
    assert.deepEqual(loadPersonalWords(), ["электронку", "Вейпер"]);
  } finally {
    if (previous === undefined) delete host.localStorage;
    else host.localStorage = previous;
  }
});
