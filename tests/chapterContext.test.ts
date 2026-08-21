import test from "node:test";
import assert from "node:assert/strict";
import {
  canonDossier,
  chapterOrdinal,
  extractContinuityAnchors,
  findPreviousCanonChapter,
} from "../src/lib/chapterContext";
import type { Chapter, Story } from "../src/types";

const chapter = (id: string, title: string, content = "текст"): Chapter => ({ id, title, summary: "", content });

test("chapter ordinal recognizes Russian and English titles", () => {
  assert.equal(chapterOrdinal("Глава 6: Медовый коридор"), 6);
  assert.equal(chapterOrdinal("Chapter 12 — Return"), 12);
  assert.equal(chapterOrdinal("Эпилог"), null);
  assert.equal(chapterOrdinal("Глава 7. Отпечаток", "lab-ch-7"), 7);
  assert.equal(chapterOrdinal("без номера", "lab-ch-7"), 7);
  assert.equal(chapterOrdinal("7. Число 20"), 7);
});

test("semantic predecessor wins over stale array order", () => {
  const chapters = [
    chapter("five", "Глава 5: Петля"),
    chapter("demo", "Глава 2: Демонстрационная глава"),
    chapter("six", "Глава 6: Медовый коридор", ""),
  ];
  assert.equal(findPreviousCanonChapter(chapters, chapters[2])?.id, "five");
});

test("canon dossier pins continuity and named characters", () => {
  const current = chapter("six", "Глава 6", "");
  current.summary = "Герой входит в правый проход";
  const previous = chapter("five", "Глава 5: Петля", "Алексей вошёл в правый проход.");
  const story = { characters: [{ name: "Алексей", role: "герой", traits: "ироничный", goals: "выбраться" }] } as Story;
  const dossier = canonDossier(story, current, previous);
  assert.match(dossier, /Не меняй героя/);
  assert.match(dossier, /Алексей/);
  assert.match(dossier, /правый проход/);
});

test("continuity anchors from chapter 6 ending block rollback", () => {
  const prev =
    "Я снова подошел к отпечатку, но не прижал руку. Тепло от стены было слабым. Не сейчас. "
    + "Заряд двадцать процентов. Голод и жажда ушли. Кольца почти погасли. Отпечаток никуда не денется — им займусь, когда буду готов.";
  const anchors = extractContinuityAnchors(prev, "Глава 6. Число 20");
  assert.match(anchors, /20%/);
  assert.match(anchors, /не сбрасывать/i);
  assert.match(anchors, /Кольца/i);
  assert.match(anchors, /Отпечаток/i);

  const current = chapter("seven", "Глава 7. Отпечаток ладони", "");
  current.summary = "Сон и активация ладони";
  const dossier = canonDossier(
    { characters: [] } as Story,
    current,
    chapter("six", "Глава 6. Число 20", prev),
  );
  assert.match(dossier, /Хвост предыдущей главы/);
  assert.match(anchors, /Не сейчас|займусь/i);
});
