import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LABYRINTH_AUTHOR_SAMPLE,
  LABYRINTH_AUTHOR_SAMPLE_MARKER,
  LABYRINTH_CANON_MARKER,
  LABYRINTH_STORY_ID,
  LABYRINTH_VOICE_SHEET,
  buildLabyrinthAuthorProfile,
  buildLabyrinthStory,
  ensureLabyrinthChapterSlots,
  mergeLabyrinthCanonIntoStories,
  shouldSeedLabyrinthAuthorProfile,
} from "../src/data/labyrinthCanon";
import type { Story } from "../src/types";

describe("labyrinthCanon", () => {
  it("seed has bible marker, plan, rings rule, ch5–8 content", () => {
    const story = buildLabyrinthStory(1);
    assert.equal(story.id, LABYRINTH_STORY_ID);
    assert.ok(story.worldBible?.includes(LABYRINTH_CANON_MARKER));
    assert.ok(story.bookPlan?.includes("Глава 20. Не случайный участник"));
    assert.equal(story.chapters.length, 20);
    assert.ok(story.worldRules.some((r) => r.id === "lr-rings-puzzle"));
    assert.ok(story.worldRules.some((r) => r.id === "lr-detector-yandex"));
    assert.ok(story.worldRules.some((r) => r.id === "lr-style-patterns-ch6"));
    assert.ok(story.worldRules.some((r) => r.id === "lr-continuity-7-8"));
    assert.ok(!/минимум местоимения «я»/i.test(story.worldBible || ""));
    assert.ok(/умеренно/i.test(story.worldRules.find((r) => r.id === "lr-style")?.content || ""));
    const ch5 = story.chapters.find((c) => /глава\s*5/i.test(c.title));
    const ch6 = story.chapters.find((c) => /глава\s*6/i.test(c.title));
    const ch7 = story.chapters.find((c) => /глава\s*7/i.test(c.title));
    const ch8 = story.chapters.find((c) => /глава\s*8/i.test(c.title));
    assert.ok(ch5?.content && ch5.content.length > 500);
    assert.ok(ch6?.content && ch6.content.length > 500);
    assert.ok(ch6?.summary.includes("источник заряда"));
    assert.ok(/2%/.test(ch5?.content || ""));
    assert.ok(ch6?.content.includes("Правый коридор был темнее"));
    assert.ok(ch6?.content.includes("три кольца"));
    assert.ok(ch6?.content.includes("Не сейчас"));
    assert.ok(ch7?.content && ch7.content.length > 800);
    assert.ok(/отпечаток|ладон/i.test(ch7!.content));
    assert.ok(/уровень\s*2/i.test(ch7!.content));
    assert.ok(/двадцат/i.test(ch7!.content));
    assert.ok(ch8?.content && ch8.content.length > 800);
    assert.ok(/зелён|риск/i.test(ch8!.content));
    assert.ok(/карт/i.test(ch8!.content));
    assert.ok(/не\s+откатился\s+к\s+двум|двадцат/i.test(ch8!.content));
    assert.ok(!/начну снова/i.test(ch7!.content + ch8!.content));
  });

  it("author sample and voice sheet come from the HUMAN chapter 1 reference", () => {
    assert.ok(LABYRINTH_AUTHOR_SAMPLE.length >= 1000);
    assert.ok(LABYRINTH_AUTHOR_SAMPLE.includes("Ярчайшая вспышка"));
    assert.ok(LABYRINTH_VOICE_SHEET.voiceRules.length >= 3);
    assert.ok(LABYRINTH_VOICE_SHEET.avoid.some((a) => /Начну снова/i.test(a)));
    const profile = buildLabyrinthAuthorProfile(1);
    assert.equal(profile.storyId, LABYRINTH_STORY_ID);
    assert.equal(profile.sampleFileName, LABYRINTH_AUTHOR_SAMPLE_MARKER);
    assert.ok(profile.sample.includes("Ярчайшая вспышка"));
    assert.equal(shouldSeedLabyrinthAuthorProfile(undefined), true);
    assert.equal(shouldSeedLabyrinthAuthorProfile(profile), false);
    assert.equal(
      shouldSeedLabyrinthAuthorProfile({
        ...profile,
        sampleFileName: "user:my-style.txt",
        sample: "x".repeat(400),
      }),
      false,
    );
  });

  it("merge prepends labyrinth when missing", () => {
    const other: Story = {
      id: "story-1",
      title: "Other",
      genre: "x",
      description: "",
      characters: [],
      chapters: [{ id: "c1", title: "Глава 1", summary: "", content: "hi" }],
      worldRules: [],
      updatedAt: 1,
    };
    const merged = mergeLabyrinthCanonIntoStories([other]);
    assert.equal(merged[0].id, LABYRINTH_STORY_ID);
    assert.equal(merged[1].id, "story-1");
  });

  it("merge patches existing labyrinth ch5–6 stubs and bible", () => {
    const existing: Story = {
      id: LABYRINTH_STORY_ID,
      title: "Лабиринт. Путь домой",
      genre: "t",
      description: "old",
      characters: [],
      chapters: [
        {
          id: "x5",
          title: "Глава 5. Первый круг",
          summary: "old",
          content: "устаревший конец",
        },
        {
          id: "x6",
          title: "Глава 6. Число 20",
          summary: "old",
          content: "Начну снова. Свет вдали.",
        },
        {
          id: "x7",
          title: "Глава 7. Отпечаток ладони",
          summary: "old",
          content: "уже написанный текст седьмой",
        },
      ],
      worldRules: [],
      worldBible: "old bible",
      bookPlan: "old plan",
      updatedAt: 1,
    };
    const merged = mergeLabyrinthCanonIntoStories([existing]);
    const s = merged[0];
    assert.ok(s.worldBible?.includes(LABYRINTH_CANON_MARKER));
    assert.ok(s.bookPlan?.includes("Глава 20. Не случайный участник"));
    const ch6 = s.chapters.find((c) => /глава\s*6/i.test(c.title))!;
    const ch7 = s.chapters.find((c) => /глава\s*7/i.test(c.title))!;
    // короткий stub → seed канона
    assert.ok(!ch6.content.includes("Начну снова"));
    assert.ok(ch6.summary.includes("источник заряда"));
    assert.equal(ch7.content, "уже написанный текст седьмой");
    assert.ok(ch7.summary.includes("20%"));
  });

  it("merge keeps substantive manual edits of chapter 6", () => {
    const manual =
      "Правый коридор. Моя ручная правка главы шесть. ".repeat(40)
      + "Не сейчас. Заряд двадцать процентов. Голод и жажда ушли. Кольца почти погасли.";
    const existing: Story = {
      id: LABYRINTH_STORY_ID,
      title: "Лабиринт. Путь домой",
      genre: "t",
      description: "",
      characters: [],
      chapters: [
        { id: "x6", title: "Глава 6. Число 20", summary: "old", content: manual },
      ],
      worldRules: [],
      worldBible: "no marker",
      bookPlan: "",
      updatedAt: 1,
    };
    const merged = mergeLabyrinthCanonIntoStories([existing]);
    const ch6 = merged[0].chapters.find((c) => /глава\s*6/i.test(c.title))!;
    assert.ok(ch6.content.includes("Моя ручная правка главы шесть"));
    assert.ok(ch6.summary.includes("источник заряда"), "summary всё равно из канона");
    assert.ok(!ch6.content.includes("Правый коридор был темнее") || ch6.content.includes("ручная правка"));
  });

  it("merge restores deleted chapters and orders all 20 slots", () => {
    const existing: Story = {
      id: LABYRINTH_STORY_ID,
      title: "Лабиринт",
      genre: "t",
      description: "",
      characters: [],
      chapters: [
        { id: "a", title: "Глава 1. X", summary: "", content: "1" },
        { id: "b", title: "Глава 6. Число 20", summary: "old", content: "старый текст 6" },
        { id: "c", title: "Глава 5. Первый круг", summary: "", content: "5" },
      ],
      worldRules: [],
      worldBible: "no marker",
      bookPlan: "",
      updatedAt: 1,
    };
    const merged = mergeLabyrinthCanonIntoStories([existing]);
    const s = merged[0];
    const titles = s.chapters.map((c) => c.title);
    assert.ok(titles.some((t) => /глава\s*7/i.test(t)), "глава 7 должна появиться");
    assert.ok(titles.some((t) => /глава\s*20/i.test(t)), "глава 20 должна появиться");
    const nums = s.chapters
      .map((c) => c.title.match(/(?:глава|chapter)\s*(\d+)/iu)?.[1])
      .filter(Boolean)
      .map(Number);
    // все 20 слотов по возрастанию
    assert.deepEqual(nums.slice(0, 20), Array.from({ length: 20 }, (_, index) => index + 1));
    const ch6 = s.chapters.find((c) => /глава\s*6/i.test(c.title))!;
    assert.ok(ch6.content.includes("Правый коридор"), "гл.6 из канона, не старый текст");
    assert.ok(!ch6.content.includes("старый текст 6"));
  });

  it("ensureLabyrinthChapterSlots restores ch7–8 on renamed book", () => {
    const story: Story = {
      id: "custom-id",
      title: "Моя книга (копия)",
      genre: "t",
      description: "",
      characters: [],
      chapters: [
        { id: "x", title: "Глава 6. Число 20", summary: "", content: "old6" },
      ],
      worldRules: [],
      updatedAt: 1,
    };
    const fixed = ensureLabyrinthChapterSlots(story);
    assert.ok(fixed.chapters.some((c) => /глава\s*7/i.test(c.title)));
    assert.ok(fixed.chapters.some((c) => /глава\s*8/i.test(c.title)));
    assert.equal(fixed.chapters.length, 20);
    assert.ok(fixed.chapters.some((c) => /глава\s*20/i.test(c.title)));
    assert.ok(fixed.chapters.find((c) => /глава\s*6/i.test(c.title))!.content.includes("Правый коридор"));
    const ch8 = fixed.chapters.find((c) => /глава\s*8/i.test(c.title))!;
    assert.ok(ch8.content.length > 500, "пустой слот 8 заполняется seed");
    assert.ok(/Уровень\s*2|риск|карт/i.test(ch8.content));
  });

  it("merge fills empty chapter 8 from seed without wiping user ch7", () => {
    const existing: Story = {
      id: LABYRINTH_STORY_ID,
      title: "Лабиринт. Путь домой",
      genre: "t",
      description: "",
      characters: [],
      chapters: [
        {
          id: "x7",
          title: "Глава 7. Отпечаток ладони",
          summary: "old",
          content: "мой черновик седьмой главы достаточно длинный ".repeat(20),
        },
        {
          id: "x8",
          title: "Глава 8. Уровень 2",
          summary: "old",
          content: "",
        },
      ],
      worldRules: [],
      worldBible: "no marker",
      bookPlan: "",
      updatedAt: 1,
    };
    const merged = mergeLabyrinthCanonIntoStories([existing]);
    const ch7 = merged[0].chapters.find((c) => /глава\s*7/i.test(c.title))!;
    const ch8 = merged[0].chapters.find((c) => /глава\s*8/i.test(c.title))!;
    assert.ok(ch7.content.includes("мой черновик седьмой"));
    assert.ok(ch8.content.length > 500);
    assert.ok(/карт|риск/i.test(ch8.content));
  });
});
