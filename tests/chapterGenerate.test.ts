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
