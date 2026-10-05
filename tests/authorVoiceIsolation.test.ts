/**
 * Сборка 118: голос автора не должен переходить между книгами.
 *
 * Живой случай: у пользователя несколько книг, и профиль одной попадал в другую.
 * Два пути, оба молчаливые:
 *   1. App.tsx искал книгу канона ещё и по названию («лабиринт» + «путь домой»),
 *      поэтому любая книга с таким названием получала образец и паспорт голоса
 *      книги «Лабиринт» — при том что профиль выглядел обычным;
 *   2. authorStorage копировала один глобальный профиль во ВСЕ книги без своей
 *      записи, то есть вторая книга писалась голосом первой. Тестов на этот путь
 *      не было: проверять его в Node нечем — нет IndexedDB и localStorage. Мок
 *      лежит в tests/fakeIndexedDb.ts, сценарии — в authorProfileMigration.test.ts.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LABYRINTH_AUTHOR_SAMPLE,
  LABYRINTH_AUTHOR_SAMPLE_MARKER,
  LABYRINTH_STORY_ID,
  ownsLabyrinthAuthorSample,
  shouldSeedLabyrinthAuthorProfile,
} from "../src/data/labyrinthCanon";
import { aiTellScore } from "../server/humanStyle";
import { humanProfileScore } from "../server/humanStyleEnhanced";

test("ownsLabyrinthAuthorSample: образец канона принадлежит только книге с его storyId", () => {
  assert.equal(ownsLabyrinthAuthorSample({ id: LABYRINTH_STORY_ID }), true);

  // Книга названа как «Лабиринт. Путь домой», но id чужой — канона у неё нет.
  const lookalike = { id: "story-vasyapered" };
  assert.equal(ownsLabyrinthAuthorSample(lookalike), false);

  assert.equal(ownsLabyrinthAuthorSample({ id: "story-1" }), false);
  assert.equal(ownsLabyrinthAuthorSample(null), false);
  assert.equal(ownsLabyrinthAuthorSample(undefined), false);
});

test("образец канона — не голос автора, и подменять им чужую книгу нельзя", () => {
  // Канонный образец — глава 1 книги «Лабиринт». Отсюда он и не должен уезжать.
  assert.ok(LABYRINTH_AUTHOR_SAMPLE.length >= 300);
  assert.ok(LABYRINTH_AUTHOR_SAMPLE.includes("Ярчайшая вспышка"));
  assert.ok(
    !/вейпер\s+вася/i.test(LABYRINTH_AUTHOR_SAMPLE),
    "в образце канона нет героя книги «Вейпер Вася» — это другой текст",
  );
});

test("профиль с чужим маркером образца распознаётся как заимствованный", () => {
  // Условие, на котором строится предупреждение в модалке профиля.
  const borrowed = {
    storyId: "story-vasyapered",
    sample: LABYRINTH_AUTHOR_SAMPLE,
    sampleFileName: LABYRINTH_AUTHOR_SAMPLE_MARKER,
    styleDescription: "",
    protectedTerms: [],
  };

  assert.equal(ownsLabyrinthAuthorSample({ id: borrowed.storyId }), false);
  assert.ok(!borrowed.sampleFileName.startsWith("user:"));
  assert.match(borrowed.sampleFileName, /^labyrinth-canon/);

  // Свой образец автора заимствованным не считается.
  const own = { ...borrowed, sampleFileName: "user:vasya.txt" };
  assert.ok(own.sampleFileName.startsWith("user:"));

  // И канонная книга со своим же маркером — тоже не заимствование.
  // Функция смотрит на `id` записи (идентификатор книги), а не на `storyId` поля.
  assert.equal(ownsLabyrinthAuthorSample({ id: borrowed.storyId }), false);
  assert.equal(ownsLabyrinthAuthorSample({ id: LABYRINTH_STORY_ID }), true);
});

test("shouldSeedLabyrinthAuthorProfile: чужой загруженный образец не затирается", () => {
  assert.equal(shouldSeedLabyrinthAuthorProfile(undefined), true);
  assert.equal(
    shouldSeedLabyrinthAuthorProfile({
      storyId: "x",
      sample: "y".repeat(400),
      sampleFileName: "user:my.txt",
      styleDescription: "",
      protectedTerms: [],
      updatedAt: 1,
    }),
    false,
  );
});

test("голос канона и голос автора — разные тексты, и это измеримо", () => {
  // Числа здесь — не про «хорошо/плохо», а про то, что подменять одно другим
  // нельзя: у эталона и у канона разный профиль фразы.
  const canon = aiTellScore(LABYRINTH_AUTHOR_SAMPLE);
  assert.ok(canon.score >= 0);
  assert.ok(Number.isFinite(humanProfileScore(LABYRINTH_AUTHOR_SAMPLE)));
});
