import test from "node:test";
import assert from "node:assert/strict";
import { aiTellScore, pickBestChapterCandidate, rankChapterCandidate, resolveHumanizeDepth } from "../server/humanStyle";
import {
  fallbackBeatsFromSynopsis,
  humanizeProseDraft,
  rewriteDetectorAiSegments,
  runTouchupPipeline,
  type ChapterGenerateInput,
} from "../server/chapterGenerate";

function baseInput(partial: Partial<ChapterGenerateInput>): ChapterGenerateInput {
  return {
    title: "Лабиринт. Путь домой",
    genre: "survival",
    description: "тест",
    currentChapterTitle: "Глава 7",
    currentChapterSummary: "",
    previousChapter: "",
    worldBible: "",
    bookPlan: "",
    canonDossier: "",
    customPrompt: "",
    model: "mock",
    ...partial,
  };
}

test("fallback beats for ch7/ch8 are not chapter-6 rings plot", () => {
  const ch7 = fallbackBeatsFromSynopsis(baseInput({
    currentChapterTitle: "Глава 7. Отпечаток ладони",
    currentChapterSummary: "Сон, ладонь, щель, Уровень 2. Не 2%. Не кольца с нуля.",
  }));
  const joined7 = ch7.map((b) => `${b.title} ${b.goal} ${b.hook}`).join(" ");
  assert.ok(ch7.length >= 5);
  assert.match(joined7, /сон|ладонь|щель|отпечат/i);
  assert.ok(!/мятно-медов|поймать.*двадцат|спуск.*пандус/i.test(joined7));

  const ch8 = fallbackBeatsFromSynopsis(baseInput({
    currentChapterTitle: "Глава 8. Уровень 2",
    currentChapterSummary: "Уже на Ур.2: риски, карта, датчики. Не ладонь.",
  }));
  const joined8 = ch8.map((b) => `${b.title} ${b.goal} ${b.hook}`).join(" ");
  assert.match(joined8, /риск|карт|датчик|уровн/i);
  assert.ok(!/мятно-медов|число тает|поймать яркую/i.test(joined8));

  const ch6 = fallbackBeatsFromSynopsis(baseInput({
    currentChapterTitle: "Глава 6. Число 20",
    currentChapterSummary: "Кольца, еда, 20%, отпечаток не активирован.",
  }));
  assert.ok(ch6.some((b) => /кольц|заряд|еда|отпечат/i.test(`${b.title} ${b.goal}`)));
});

test("touchup pipeline removes catalog stamps via mock model", async () => {
  const source = [
    "Я шёл вдоль стены и считал шаги.",
    "",
    "Это был не просто коридор. Волна ужаса накрыла меня, и время словно остановилось. Сердце пропустило удар.",
    "",
    "Я достал ключ и вырезал метку на стене. Синий свет заполнил борозду.",
  ].join("\n");

  const before = aiTellScore(source);
  assert.ok(before.score >= 20, `expected dirty source, got ${before.score}`);
  assert.ok(before.hits.length >= 2);

  const generate = async (params: {
    contents: string;
    responseMimeType?: string;
  }) => {
    // Mock returns cleaned blocks for JSON touchup requests.
    if (params.responseMimeType === "application/json" || params.contents.includes("priority-blocks")) {
      const match = params.contents.match(/<DATA role="priority-blocks">\n([\s\S]*?)\n<\/DATA>/);
      assert.ok(match, "expected priority-blocks payload");
      const targets = JSON.parse(match![1]) as Array<{ text: string }>;
      const blocks = targets.map((target) =>
        target.text
          .replace(/Это был не просто коридор\./iu, "Коридор был узкий и сухой.")
          .replace(/Волна ужаса накрыла меня,?\s*/iu, "")
          .replace(/время словно остановилось\.?/iu, "Я перестал слышать собственное дыхание.")
          .replace(/Сердце пропустило удар\.?/iu, "Пальцы сами сжали ключ."),
      );
      return JSON.stringify({ blocks });
    }
    return source;
  };

  const result = await runTouchupPipeline(source, generate as any, {
    model: "mock",
    personaBlock: "сухо",
    depth: resolveHumanizeDepth("balanced"),
  });

  const after = aiTellScore(result.text);
  assert.ok(result.refinedBlocks >= 1, "should refine at least one block");
  assert.ok(after.score < before.score, `score should drop: ${before.score} -> ${after.score}`);
  assert.equal(after.hits.filter((hit) => hit.id === "volna-chuvstva").length, 0);
  assert.equal(after.hits.filter((hit) => hit.id === "vremya-zamerlo").length, 0);
});

test("humanizeProseDraft report includes gate fields", async () => {
  // Связная бытовая фраза без стаккато (Yandex v2 штрафует цепочки «Шаг. Ещё.»)
  const clean = "Я шёл вдоль стены и слушал, как ключ тихо звенит в кармане. Воздух был тёплым, но сырости уже не было.";
  const generate = async () => JSON.stringify({ blocks: [clean] });
  const result = await humanizeProseDraft(clean, generate as any, {
    model: "mock",
    personaBlock: "",
    humanizeDepth: "fast",
  });
  assert.equal(typeof result.humanizeReport.gatePassed, "boolean");
  assert.equal(result.humanizeReport.depth, "fast");
  assert.equal(result.humanizeReport.mode, "single");
  assert.ok(result.humanizeReport.scoreAfter <= 20);
});

test("pickBestChapterCandidate prefers lower AI-tell and higher burstiness", () => {
  const dirty = {
    text: "a",
    score: aiTellScore("Это был не просто страх. Волна ужаса накрыла его, и время словно остановилось."),
    index: 0,
  };
  const clean = {
    text: "b",
    score: aiTellScore("Я шёл вдоль тёплой стены и считал сорок один шаг, пока ключ не перестал звенеть."),
    index: 1,
  };
  const best = pickBestChapterCandidate([dirty, clean], 12, 0.45);
  assert.equal(best.index, 1);
  assert.ok(rankChapterCandidate(clean.score) < rankChapterCandidate(dirty.score));
});

test("rewriteDetectorAiSegments rewrites only AI labels", async () => {
  const segments = [
    { text: "Человеческий кусок без формул. Я сел и выпил воды.", label: "HUMAN" },
    { text: "Волна ужаса накрыла его, и время словно остановилось перед лицом тьмы.", label: "AI" },
    { text: "Потом я встал и пошёл дальше по коридору.", label: "LIKELY_HUMAN" },
  ];
  const generate = async (params: { contents: string; responseMimeType?: string }) => {
    if (params.contents.includes("ai-segments") || params.responseMimeType === "application/json") {
      const match = params.contents.match(/<DATA role="ai-segments">\n([\s\S]*?)\n<\/DATA>/)
        || params.contents.match(/<DATA role="priority-blocks">\n([\s\S]*?)\n<\/DATA>/);
      if (match) {
        const targets = JSON.parse(match[1]) as Array<{ text: string }>;
        return JSON.stringify({
          blocks: targets.map((target) =>
            target.text
              .replace(/Волна ужаса накрыла его,?\s*/iu, "")
              .replace(/время словно остановилось[^.]*\.?/iu, "Он замер у стены.")
              .replace(/перед лицом тьмы\.?/iu, ""),
          ),
        });
      }
      return JSON.stringify({ blocks: ["Он замер у стены. Пальцы сжали ключ."] });
    }
    return segments.map((s) => s.text).join("");
  };

  const result = await rewriteDetectorAiSegments(segments, generate as any, {
    model: "mock",
    personaBlock: "сухо",
    humanizeDepth: "fast",
  });
  assert.ok(result.rewrittenCount >= 1);
  assert.ok(result.humanizeReport.detectorSegmentsRewritten! >= 1);
  // HUMAN-фрагмент должен сохраниться
  assert.ok(result.text.includes("выпил воды") || result.text.includes("Человеческий"));
  assert.ok(!result.text.includes("Волна ужаса") || result.humanizeReport.scoreAfter <= result.humanizeReport.scoreBefore);
});

// --- сборка 78: добор сцен до цели, замок лица повествования, повтор по трём сценам, латиница после аудита ---

import {
  beatPlanSchema,
  buildAntiRepeatNotes,
  buildBeatPlanPrompt,
  countWordsRu,
  detectNarrationPerson,
  generateHumanizedChapter,
  MAX_SCENE_BEATS,
  MIN_SCENE_BEATS,
  narrationPersonMismatch,
  povDirectiveFor,
  repairForeignWords,
  russianLanguageIssues,
  SCENE_TARGET_WORDS,
  topupBeatFor,
} from "../server/chapterGenerate";

const TEST_WORDS = ["коридор", "стена", "фонарь", "шаг", "поворот", "метка", "холод", "пыль", "дверь", "ключ", "провод", "экран", "ладонь", "шорох", "потолок", "пол", "щель", "тень", "влага", "гул"];

/** Ровный поток слов без латиницы: 5-граммы разных сцен не совпадают (шаг 3 и период 20 взаимно просты). */
function mockSceneText(index: number, words = 350): string {
  // Сцены обязаны быть различимыми: сходство по 5-граммам ≥0,18 — брак. Прежний
  // генератор давал почти одинаковые строки, и тест «10 сцен» проходил только потому,
  // что забракованный фрагмент всё равно приклеивался к главе.
  const stride = 1 + index;
  const offset = (index * 13) % TEST_WORDS.length;
  const parts: string[] = [];
  for (let i = 0; i < words; i += 1) {
    if (i % 25 === 0) parts.push(index % 2 === 0 ? "Он" : "Илья");
    if (i % 40 === 0) parts.push(`место${index}`);
    parts.push(TEST_WORDS[(offset + i * stride) % TEST_WORDS.length]);
  }
  return parts.join(" ");
}

test("detectNarrationPerson ignores dialogue lines", () => {
  const third = "Илья шёл вдоль стены. Он держал фонарь низко. Васька отстал и кашлял. Он остановился у поворота.\n— Слышь, Вась, — сказал Илья. — У нас воды почти не осталось, я проверял.\nОн ждал ответа и смотрел на щель в стене.";
  assert.equal(detectNarrationPerson(third), "third");
  const first = "Я шёл вдоль стены. Мне было холодно. Я держал фонарь низко. Мой шаг сбился.";
  assert.equal(detectNarrationPerson(first), "first");
});

test("narration person switch is a defect", () => {
  const scene = "Я протёр лоб тыльной стороной ладони. Я слышал собственное дыхание. Меня вело в сторону.";
  assert.equal(narrationPersonMismatch(scene, "third"), true);
  assert.equal(narrationPersonMismatch(scene, "first"), false);
  assert.equal(narrationPersonMismatch(scene, "unknown"), false);
});

test("pov directive locks the person for later scenes", () => {
  assert.match(povDirectiveFor("third"), /третье лицо/);
  assert.match(povDirectiveFor("first"), /первое лицо/);
  assert.equal(povDirectiveFor("unknown"), "");
});

test("beat plan asks for scenes enough to fill the chapter", () => {
  assert.equal(beatPlanSchema.properties.beats.minItems, MIN_SCENE_BEATS);
  assert.equal(beatPlanSchema.properties.beats.maxItems, MAX_SCENE_BEATS);
  const prompt = buildBeatPlanPrompt(baseInput({ currentChapterTitle: "Глава 4" }));
  assert.ok(prompt.includes(String(SCENE_TARGET_WORDS)));
  assert.ok(prompt.includes(`${MIN_SCENE_BEATS}–${MAX_SCENE_BEATS}`));
});

test("topup beat continues the chapter when the plan runs out", () => {
  const beats = fallbackBeatsFromSynopsis(baseInput({ currentChapterTitle: "Глава 4. Ночь у чужого входа" }));
  const beat = topupBeatFor(beats, beats.length, 2_000);
  assert.match(beat.title, /Добор 1/);
  assert.match(beat.goal, new RegExp(String(SCENE_TARGET_WORDS - 2_000)));
});

test("anti-repeat notes cover the last three scenes, not only the previous one", () => {
  const scenes = [
    "Первый кусок с уникальной репликой про котелок и воду.",
    "Второй кусок про фонарь и метку на стене.",
    "Третий кусок про поворот и узкую щель.",
  ];
  const notes = buildAntiRepeatNotes(scenes);
  assert.ok(notes.includes("котелок"));
});

test("foreign words are replaced in place, without rewriting the text", async () => {
  const text = "Он потёр нос back-стороной ладони и шагнул в проём.";
  const generate = async () => JSON.stringify({ replacements: { back: "тыльной" } });
  const result = await repairForeignWords(text, generate, { model: "mock" });
  assert.equal(result.text, "Он потёр нос тыльной-стороной ладони и шагнул в проём.");
  assert.deepEqual(result.replaced, { back: "тыльной" });
  assert.equal(russianLanguageIssues(result.text).length, 0);
});

test("foreign word repair keeps the text when the model answers junk", async () => {
  const text = "Он потёр нос back-стороной ладони.";
  const generate = async () => "не json";
  const result = await repairForeignWords(text, generate, { model: "mock" });
  assert.equal(result.text, text);
  assert.deepEqual(result.replaced, {});
});

test("scene generation tops the chapter up to the target and locks narration person", async () => {
  const calls: Array<{ system: string; contents: string; timeoutMs?: number }> = [];
  const generate = async (params: any): Promise<string> => {
    calls.push({ system: params.systemInstruction, contents: params.contents, timeoutMs: params.timeoutMs });
    if (/сценарист-структуралист/i.test(params.systemInstruction)) {
      return JSON.stringify({
        beats: Array.from({ length: 6 }, (_, i) => ({ title: `Бит ${i + 1}`, goal: `Событие ${i + 1}`, hook: `Зацепка ${i + 1}`, endsWith: `Конец ${i + 1}` })),
      });
    }
    if (params.responseMimeType === "application/json") return JSON.stringify({ blocks: [] });
    if (params.contents.includes("Бит:")) {
      const sceneIndex = calls.filter((call) => call.contents.includes("Бит:")).length - 1;
      return mockSceneText(sceneIndex);
    }
    return "";
  };
  const sample = Array.from({ length: 40 }, (_, i) => `Он шёл вдоль стены и считал шаги, номер ${i}. Пыль лежала на полу ровным слоем.`).join(" ");
  const result = await generateHumanizedChapter(
    baseInput({
      currentChapterTitle: "Глава 4. Ночь у чужого входа",
      currentChapterSummary: "Герой ищет вход",
      authorSample: sample,
      humanizeDepth: "maximum",
      chapterCandidates: 1,
    }),
    generate,
  );
  assert.equal(result.humanizeReport.mode, "scenes");
  assert.equal(result.humanizeReport.narrationPerson, "third");
  // План вернул 6 битов — он добит структурными до нормы 8–12, поэтому сцен не меньше 8.
  assert.ok(result.humanizeReport.scenesGenerated >= 8, "план добит до нормы битов");
  assert.ok(result.humanizeReport.scenesGenerated <= 12);
  // Добор включился именно потому, что глава не доросла до цели по ОБЩЕМУ счётчику слов.
  assert.ok(result.humanizeReport.topupScenes >= 1, "добор шёл до цели главы");
  assert.ok(countWordsRu(result.text) >= SCENE_TARGET_WORDS, "глава дотянула до цели");
  const sceneCalls = calls.filter((call) => call.contents.includes("Бит:"));
  // Сценам выставлен короткий таймаут: зависший на 90 с шлюз не должен их держать.
  assert.equal(sceneCalls[0].timeoutMs, 45_000);
  // Лицо взято из ИСХОДНИКА, поэтому замок действует с первой же сцены, а не с той,
  // которая случайно задала лицо (живой прогон 20.09.2026: в 19:45 «третье», в 22:17 «первое»).
  assert.ok(sceneCalls[0].contents.includes("ЛИЦО ПОВЕСТВОВАНИЯ"));
  assert.ok(sceneCalls[0].contents.includes("третье лицо"));
  assert.ok(sceneCalls[1].contents.includes("ЛИЦО ПОВЕСТВОВАНИЯ"));
});

test("забракованная сцена не попадает в главу", async () => {
  const generate = async (params: any): Promise<string> => {
    if (/сценарист-структуралист/i.test(params.systemInstruction)) {
      return JSON.stringify({
        beats: Array.from({ length: 8 }, (_, i) => ({ title: `Бит ${i + 1}`, goal: `Событие ${i + 1}`, hook: `Зацепка ${i + 1}`, endsWith: `Конец ${i + 1}` })),
      });
    }
    if (params.responseMimeType === "application/json") return JSON.stringify({ blocks: [] });
    // Сцена всегда брак: латиница и обрыв. Раньше такой ответ становился сценой главы.
    if (params.contents.includes("Бит:")) return "back level phone wall corridor the and with that this chapter level";
    return mockSceneText(2);
  };
  const result = await generateHumanizedChapter(
    baseInput({
      currentChapterTitle: "Глава 5. Проба",
      currentChapterSummary: "Проба входа",
      humanizeDepth: "maximum",
      chapterCandidates: 1,
      authorSample: Array.from({ length: 40 }, (_, i) => `Он шёл вдоль стены и считал шаги, номер ${i}. Пыль лежала на полу ровным слоем.`).join(" "),
    }),
    generate,
  );
  assert.equal(russianLanguageIssues(result.text).length, 0);
  assert.ok(!result.text.includes("back"), "латиница в главу не попала");
  assert.ok(result.text.trim().length >= 200, "глава не пустая: сценовый маршрут уступил цельному проходу");
  assert.equal(result.humanizeReport.mode, "single");
});
