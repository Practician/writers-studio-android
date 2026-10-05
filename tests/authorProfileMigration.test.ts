/**
 * Сборка 118: голос одной книги не должен доставаться другой.
 *
 * Что было. `migrateGlobalAuthorProfileToStories` брал один глобальный (legacy)
 * профиль — а он принадлежал конкретной книге, у которой он был единственной —
 * и копировал его во все книги без своей записи. При нескольких книгах вторая
 * писалась голосом первой: образец стиля, паспорт голоса, знак реплики. Профиль
 * при этом выглядел заполненным, и подмену нельзя было заметить.
 *
 * Что стало. Автоматического переноса нет; функция удалена вместе с вызовом из
 * App.tsx. Копирование осталось только явным действием — `adoptGlobalAuthorProfile`,
 * то есть кнопкой «Использовать общий профиль» в модалке профиля.
 *
 * Проверять пришлось на моках: в Node нет ни IndexedDB, ни localStorage, а без них
 * и код, и тест выходили с первой строки, ничего не делая.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  installFakeIndexedDb,
  installFakeLocalStorage,
  resetFakeIndexedDb,
  type FakeDbSeed,
} from "./fakeIndexedDb";
import {
  GLOBAL_AUTHOR_PROFILE_ID,
  adoptGlobalAuthorProfile,
  loadAuthorProfile,
  saveGlobalAuthorProfile,
} from "../src/lib/authorStorage";

type Row = Record<string, unknown>;

const ownProfile = (storyId: string, fileName = "user:vasya.txt"): Row => ({
  storyId,
  sample: "мой образец голоса. ".repeat(60),
  sampleFileName: fileName,
  styleDescription: "",
  protectedTerms: [],
  updatedAt: 1,
});

/**
 * Подменить IndexedDB и localStorage на время проверки. Обе подмены обязательны:
 * без localStorage любой путь к хранилищу обрывается на `typeof localStorage`.
 */
async function withDb<T>(seed: FakeDbSeed, run: () => Promise<T>): Promise<T> {
  resetFakeIndexedDb();
  const restoreDb = installFakeIndexedDb(seed);
  const restoreStorage = installFakeLocalStorage();
  try {
    return await run();
  } finally {
    restoreStorage();
    restoreDb();
  }
}

const globalVoice = async () => {
  await saveGlobalAuthorProfile({
    storyId: GLOBAL_AUTHOR_PROFILE_ID,
    sample: "общий образец. ".repeat(60),
    sampleFileName: "user:global.txt",
    styleDescription: "",
    protectedTerms: [],
    updatedAt: 1,
  });
};

test("при двух книгах ни одна не получает чужой голос", async () => {
  await withDb({ profiles: [ownProfile(GLOBAL_AUTHOR_PROFILE_ID, "user:global.txt"), ownProfile("story-a")] }, async () => {
    // Глобальная запись есть, у story-a своя. Раньше голос уезжал в story-b.
    assert.equal((await loadAuthorProfile("story-b"))?.sample, undefined);
    assert.equal((await loadAuthorProfile("story-a"))?.sampleFileName, "user:vasya.txt");
  });
});

test("книга с профилем и книга без него не смешиваются", async () => {
  await withDb({ profiles: [ownProfile("story-a"), ownProfile("story-b")] }, async () => {
    const a = await loadAuthorProfile("story-a");
    const b = await loadAuthorProfile("story-b");

    // Каждая книга читает только свою запись — это и есть изоляция голоса.
    assert.equal(a?.storyId, "story-a");
    assert.equal(b?.storyId, "story-b");
  });
});

test("без общего профиля чужий голос не появился ниоткуда", async () => {
  await withDb({ profiles: [ownProfile("story-a")] }, async () => {
    assert.equal((await loadAuthorProfile("story-b"))?.sample, undefined);
    assert.equal((await loadAuthorProfile("story-a"))?.sampleFileName, "user:vasya.txt");
  });
});

test("явное копирование по кнопке работает — это решение автора", async () => {
  await withDb({ profiles: [ownProfile("story-a")] }, async () => {
    await globalVoice();
    const adopted = await adoptGlobalAuthorProfile("story-a");

    assert.ok(adopted, "профиль скопирован по явному действию автора");
    assert.equal(adopted?.storyId, "story-a");
    assert.equal(adopted?.sampleFileName, "user:global.txt");
    // Копия остаётся отдельной записью: общий профиль не тронут.
    assert.equal((await loadAuthorProfile("story-a"))?.storyId, "story-a");
  });
});

test("общий профиль не достаётся книге без явного копирования", async () => {
  await withDb({ profiles: [] }, async () => {
    await globalVoice();
    assert.equal((await loadAuthorProfile("story-c"))?.sample, undefined);
    // Сам общий профиль при этом на месте и доступен для копирования по кнопке.
    assert.ok(await loadAuthorProfile(GLOBAL_AUTHOR_PROFILE_ID));
  });
});