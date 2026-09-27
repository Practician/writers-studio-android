import test from "node:test";
import assert from "node:assert/strict";

import { caretAfterReplace, lineIndexOfOffset, scrollTopToReveal } from "../src/lib/editorView";

test("каретка встаёт сразу за вставленным словом", () => {
  assert.equal(caretAfterReplace(120, "нужный", 400), 126);
});

test("каретка не уезжает за конец текста", () => {
  assert.equal(caretAfterReplace(398, "ошибка", 400), 400);
});

test("пустая замена оставляет каретку на месте", () => {
  assert.equal(caretAfterReplace(50, "", 400), 50);
});

test("смещение меньше нуля — каретка в начале", () => {
  assert.equal(caretAfterReplace(-5, "слово", 400), 0);
});

test("номер строки считается по переводам строки", () => {
  const text = "первая\nвторая\nтретья";
  assert.equal(lineIndexOfOffset(text, 0), 0);
  assert.equal(lineIndexOfOffset(text, 5), 0);
  assert.equal(lineIndexOfOffset(text, 6), 0);
  assert.equal(lineIndexOfOffset(text, 7), 1);
  assert.equal(lineIndexOfOffset(text, 13), 1);
  assert.equal(lineIndexOfOffset(text, 14), 2);
});

test("смещение за концом текста — последняя строка", () => {
  assert.equal(lineIndexOfOffset("один\nдва", 999), 1);
});

test("пустой текст — нулевая строка", () => {
  assert.equal(lineIndexOfOffset("", 10), 0);
});

test("строка встаёт посередине поля", () => {
  assert.equal(scrollTopToReveal(10, 28, 300, 5000), 130);
});

test("первая строка не прокручивает поле выше начала", () => {
  assert.equal(scrollTopToReveal(0, 28, 300, 5000), 0);
});

test("прокрутка не уходит за максимум: конец главы не подменяет найденное место", () => {
  assert.equal(scrollTopToReveal(118, 28, 300, 3060), 3060);
  assert.equal(scrollTopToReveal(118, 22.75, 300, 2130), 2130);
});

test("неизвестная высота строки берёт запас 28 px", () => {
  assert.equal(scrollTopToReveal(10, Number.NaN, 300, 5000), scrollTopToReveal(10, 28, 300, 5000));
});

test("неизвестная высота поля — строка встаёт в начало, без выравнивания по середине", () => {
  assert.equal(scrollTopToReveal(3, 28, 0, 1000), 84);
});
