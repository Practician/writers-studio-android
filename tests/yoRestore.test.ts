/**
 * Сборка 120: буква ё возвращается однозначным словам.
 *
 * Живой случай 06.10.2026: в главе 4 на 21 700 знаков было 2 буквы ё против
 * 138 в `Вася.txt` и 97 в v19. Модель ё почти не пишет, для автора это норма
 * орфографии — её отсутствие чужой отпечаток.
 *
 * Карта — из текстов самого автора: каждое слово с ё, чья е-форма не живёт
 * в тех же текстах отдельным словом. Поэтому здесь нет омографов «все/всё»
 * и «небо/нёбо»: их е-форма у автора встречается сама по себе.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { restoreYo, YO_WORD_MAP } from "../server/yoRestore";

test("карта не содержит омографов и мусора", () => {
  for (const banned of ["все", "небо", "осел", "мел", "сел", "входакостер", "далекиедетские"]) {
    assert.equal(YO_WORD_MAP[banned], undefined, `в карте не должно быть «${banned}»`);
  }
  assert.ok(Object.keys(YO_WORD_MAP).length >= 100, "карта должна покрывать основной словарь");
  // Якорные слова автора — на месте.
  assert.equal(YO_WORD_MAP["костер"], "костёр");
  assert.equal(YO_WORD_MAP["еще"], "ещё");
  assert.equal(YO_WORD_MAP["ее"], "её");
  assert.equal(YO_WORD_MAP["трех"], "трёх");
});

test("restoreYo возвращает ё и считает замены", () => {
  const result = restoreYo("Костер развели не сразу. Еще было темно.");

  assert.equal(result.text, "Костёр развели не сразу. Ещё было темно.");
  assert.equal(result.restored, 2);
  assert.deepEqual(result.samples, ["Костер→Костёр", "Еще→Ещё"]);
});

test("restoreYo не трогает омографы и слова с ё", () => {
  assert.equal(restoreYo("Все молчали. Небо было чистым.").text, "Все молчали. Небо было чистым.");
  assert.equal(restoreYo("Костёр уже догорал.").restored, 0);
  assert.equal(restoreYo("").text, "");
});

test("restoreYo держит регистр первой буквы", () => {
  assert.equal(restoreYo("Трех дней хватило.").text, "Трёх дней хватило.");
});

test("restoreYo не правит внутри других слов", () => {
  // «костер» внутри составного слова без границ — не чиним: лучше недопоставить.
  assert.equal(restoreYo("электрокостер").text, "электрокостер");
});
