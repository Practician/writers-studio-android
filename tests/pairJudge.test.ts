import test from "node:test";
import assert from "node:assert/strict";
import {
  createPairJudgeStats,
  filterByPairJudge,
  judgePairs,
  stripEditorNoise,
  type PairJudgeConfig,
} from "../server/pairJudge";
import { extractRewrittenBlocks, rewriteDetectorAiSegments } from "../server/chapterGenerate";

type Params = { contents: string };

/** Судья по подстроке: «человеком» считается тот из двух текстов, где есть маркер. */
function markerJudge(marker: string, opts: { biasA?: boolean; broken?: boolean } = {}): PairJudgeConfig {
  const calls: string[] = [];
  const config: PairJudgeConfig = {
    model: "judge",
    stats: createPairJudgeStats(),
    generate: async (params: Params) => {
      calls.push(params.contents);
      if (opts.broken) throw new Error("gateway down");
      const match = params.contents.match(/<DATA role="pairs">\n([\s\S]*?)\n<\/DATA>/);
      const data = JSON.parse(match![1]) as Array<{ i: number; A: string; B: string }>;
      const human = data.map((pair) => {
        if (opts.biasA) return "A"; // судья с позиционной предвзятостью
        return pair.A.includes(marker) ? "A" : "B";
      });
      return JSON.stringify({ human });
    },
  } as unknown as PairJudgeConfig;
  (config as any).calls = calls;
  return config;
}

test("judgePairs: кандидат принимается, только если побеждает в обоих порядках", async () => {
  const judge = markerJudge("ЖИВОЕ");
  const verdicts = await judgePairs(
    [
      { original: "Волна ужаса накрыла его.", candidate: "ЖИВОЕ: он замер у стены." },
      { original: "ЖИВОЕ: старый абзац.", candidate: "Гладкая машинная версия." },
    ],
    judge,
  );
  assert.deepEqual(verdicts, ["candidate", "original"]);
  // два порядка = два вызова на чанк
  assert.equal((judge as any).calls.length, 2);
});

test("judgePairs: судья, всегда отвечающий «A», даёт ничью и оригинал остаётся", async () => {
  const verdicts = await judgePairs(
    [{ original: "старое", candidate: "новое" }],
    markerJudge("x", { biasA: true }),
  );
  assert.deepEqual(verdicts, ["split"]);
});

test("filterByPairJudge: недоступный судья не блокирует локальную приёмку", async () => {
  const judge = markerJudge("x", { broken: true });
  const accepted = await filterByPairJudge([{ key: 7, original: "а", candidate: "б" }], judge);
  assert.ok(accepted.has(7));
  assert.equal(judge.stats.unavailable, 1);
  assert.equal(judge.stats.kept, 0);
});

test("filterByPairJudge: без судьи принимает всё, что прошло локальный аудит", async () => {
  const accepted = await filterByPairJudge([{ key: 1, original: "а", candidate: "б" }], undefined);
  assert.ok(accepted.has(1));
});

test("filterByPairJudge: отклонённые и ничьи попадают в статистику", async () => {
  const judge = markerJudge("ЖИВОЕ");
  const accepted = await filterByPairJudge(
    [
      { key: "a", original: "плохо", candidate: "ЖИВОЕ хорошо" },
      { key: "b", original: "ЖИВОЕ было", candidate: "машина" },
    ],
    judge,
  );
  assert.deepEqual([...accepted], ["a"]);
  assert.equal(judge.stats.kept, 1);
  assert.equal(judge.stats.rejected, 1);
  assert.equal(judge.stats.judged, 2);
});

test("stripEditorNoise: убирает вступление и хвостовое примечание, но не диалог", () => {
  assert.equal(
    stripEditorNoise("Вот переработанный вариант:\n\nОн замер у стены."),
    "Он замер у стены.",
  );
  assert.equal(
    stripEditorNoise("Он замер у стены.\n\nПримечание: убрал штамп про время."),
    "Он замер у стены.",
  );
  assert.equal(stripEditorNoise("```\nОн замер.\n```"), "Он замер.");
  const dialogue = "— Вот, держи: ключ.\nОн замер.";
  assert.equal(stripEditorNoise(dialogue), dialogue);
  assert.equal(stripEditorNoise("Конечно, он не пришёл."), "Конечно, он не пришёл.");
});

test("extractRewrittenBlocks: чистит вступительную реплику модели внутри JSON", () => {
  const raw = JSON.stringify({ blocks: ["Вот вариант:\n\nОн замер у стены."] });
  assert.deepEqual(extractRewrittenBlocks(raw, 1), ["Он замер у стены."]);
});

test("rewriteDetectorAiSegments: правка, которую судья отверг, не попадает в текст", async () => {
  const segments = [
    { text: "Человеческий кусок без формул. Я сел и выпил воды.", label: "HUMAN" },
    { text: "Волна ужаса накрыла его, и время словно остановилось перед лицом тьмы.", label: "AI" },
  ];
  const generate = async (params: { contents: string; responseMimeType?: string }) => {
    const match = params.contents.match(/<DATA role="ai-segments">\n([\s\S]*?)\n<\/DATA>/)
      || params.contents.match(/<DATA role="priority-blocks">\n([\s\S]*?)\n<\/DATA>/);
    if (match) {
      const targets = JSON.parse(match[1]) as Array<{ text: string }>;
      return JSON.stringify({
        blocks: targets.map((target) =>
          target.text
            .replace(/Волна ужаса накрыла его,?\s*/iu, "")
            .replace(/время словно остановилось[^.]*\.?/iu, "Он замер у стене.")
            .replace(/перед лицом тьмы\.?/iu, ""),
        ),
      });
    }
    return segments.map((s) => s.text).join("");
  };

  // Судья, который всегда предпочитает оригинал: маркер есть только в оригинале.
  const rejecting = markerJudge("Волна ужаса");
  const rejected = await rewriteDetectorAiSegments(segments, generate as any, {
    model: "mock",
    personaBlock: "",
    humanizeDepth: "fast",
    pairJudge: rejecting,
  });
  assert.equal(rejected.blocks[1], segments[1].text);
  assert.equal(rejected.rewrittenCount, 0);
  assert.ok(rejected.humanizeReport.pairJudge);
  assert.ok(rejected.humanizeReport.pairJudge!.rejected >= 1);
  assert.ok(rejected.text.includes("выпил воды"));

  // Без судьи поведение прежнее: правка принимается локальным аудитом.
  const baseline = await rewriteDetectorAiSegments(segments, generate as any, {
    model: "mock",
    personaBlock: "",
    humanizeDepth: "fast",
  });
  assert.ok(baseline.rewrittenCount >= 1);
  assert.equal(baseline.humanizeReport.pairJudge, undefined);
});

// --- сборка 105: стаккато-проход тоже под судьёй ---

/** Рубленый AI-сегмент: доля ≤6 слов 0,625, цепочка 5 при пороге 4. */
const HOT = "Он медленно огляделся вокруг. Пыль лежала на бетоне ровным слоем. "
  + "Дверь в конце коридора была приоткрыта. Свет из щели ложился полосой. Он прислушался и не расслышал ничего. "
  + "Потом шагнул вперёд и почти сразу замер, потому что пол под ногой хрустнул, будто под ним рассыпалось что-то "
  + "старое и сухое, а звук этот ушёл вглубь коридора и вернулся эхом. Он стоял и ждал, пока тишина снова не сомкнётся "
  + "над ним, и думал, что если двинуться дальше, то будет только хуже. Он сел на корточки и стал ждать.";

const MERGED = "Он медленно огляделся вокруг: пыль лежала на бетоне ровным слоем, "
  + "дверь в конце коридора была приоткрыта, свет из щели ложился полосой. Он прислушался и не расслышал ничего, "
  + "потом шагнул вперёд и почти сразу замер, потому что пол под ногой хрустнул, будто под ним рассыпалось что-то "
  + "старое и сухое, а звук этот ушёл вглубь коридора и вернулся эхом. Он стоял и ждал, пока тишина снова не сомкнётся "
  + "над ним, и думал, что если двинуться дальше, то будет только хуже. Он сел на корточки и стал ждать.";

test("rewriteDetectorAiSegments: склейку стаккато, отвергнутую судьёй, не несёт в blocks", async () => {
  const segments = [
    { text: "Человеческий кусок без формул. Я сел и выпил воды.", label: "HUMAN" },
    { text: HOT, label: "AI" },
  ];
  const generate = async (params: { contents: string; responseMimeType?: string }) => {
    const match = params.contents.match(/<DATA role="ai-staccato">\n([\s\S]*?)\n<\/DATA>/)
      || params.contents.match(/<DATA role="ai-segments">\n([\s\S]*?)\n<\/DATA>/)
      || params.contents.match(/<DATA role="priority-blocks">\n([\s\S]*?)\n<\/DATA>/);
    if (match) {
      const targets = JSON.parse(match[1]) as Array<{ text: string }>;
      const rewrite = params.contents.includes('role="ai-staccato"');
      return JSON.stringify({ blocks: targets.map((target) => (rewrite ? MERGED : target.text)) });
    }
    if (params.responseMimeType === "application/json") return JSON.stringify({ blocks: [HOT] });
    return segments.map((segment) => segment.text).join("");
  };

  // Маркер есть только в оригинале: судья всегда оставит оригинал.
  const rejecting = markerJudge("Дверь в конце коридора");
  const rejected = await rewriteDetectorAiSegments(segments, generate as any, {
    model: "mock",
    personaBlock: "",
    humanizeDepth: "fast",
    pairJudge: rejecting,
  });
  assert.equal(rejected.humanizeReport.staccatoMergedSegments, 0, "судья отверг склейку");
  assert.equal(rejected.blocks[1], HOT);
  assert.ok(rejected.humanizeReport.pairJudge!.rejected >= 1);

  // Без судьи склейка принимается и попадает в blocks.
  const accepted = await rewriteDetectorAiSegments(segments, generate as any, {
    model: "mock",
    personaBlock: "",
    humanizeDepth: "fast",
  });
  assert.equal(accepted.humanizeReport.staccatoMergedSegments, 1);
  assert.equal(accepted.blocks[1], MERGED);
});

// --- строгий режим кнопки «переписать только AI-сегменты» ---

import { keepEdgeWhitespace } from "../server/chapterGenerate";

test("keepEdgeWhitespace: правка несёт краевые переводы строк оригинала", () => {
  assert.equal(keepEdgeWhitespace("Старый.\n\n", "  Новый. "), "Новый.\n\n");
  assert.equal(keepEdgeWhitespace("\n\nСтарый.", "Новый."), "\n\nНовый.");
});

test("rewriteDetectorAiSegments: HUMAN дословно, полный текст модели не отправляется, абзацы не слипаются", async () => {
  const human = "Человеческий кусок без формул. Я сел и выпил воды, а потом долго смотрел в стену.\n\n";
  const ai = "Волна ужаса накрыла его, и время словно остановилось перед лицом тьмы.\n\n";
  const tail = "Потом я встал и пошёл дальше по коридору, считая шаги.";
  const segments = [
    { text: human, label: "HUMAN" },
    { text: ai, label: "AI" },
    { text: tail, label: "LIKELY_HUMAN" },
  ];
  const seenPrompts: string[] = [];
  const generate = async (params: { contents: string }) => {
    seenPrompts.push(params.contents);
    const match = params.contents.match(/<DATA role="ai-segments">\n([\s\S]*?)\n<\/DATA>/);
    if (!match) {
      // Любой другой вызов — это прогон по всему тексту: в строгом режиме его быть не должно.
      return "ПОЛНЫЙ ТЕКСТ ПЕРЕПИСАН";
    }
    const targets = JSON.parse(match[1]) as Array<{ text: string }>;
    return JSON.stringify({
      blocks: targets.map((target) =>
        target.text
          .replace(/Волна ужаса накрыла его,?\s*/iu, "")
          .replace(/время словно остановилось[^.]*\.?/iu, "Он замер у стены.")
          .replace(/перед лицом тьмы\.?/iu, ""),
      ),
    });
  };

  const result = await rewriteDetectorAiSegments(segments, generate as any, {
    model: "mock",
    personaBlock: "",
    humanizeDepth: "maximum",
    strictHuman: true,
  });

  assert.ok(result.rewrittenCount >= 1);
  assert.equal(result.blocks[0], human);
  assert.equal(result.blocks[2], tail);
  assert.ok(result.text.startsWith(human));
  assert.ok(result.text.endsWith(tail));
  // Правленый сегмент не склеился со следующим: переводы строк оригинала сохранены.
  assert.ok(result.blocks[1].endsWith("\n\n"));
  assert.ok(!result.text.includes("ПОЛНЫЙ ТЕКСТ"));
  assert.ok(seenPrompts.every((prompt) => prompt.includes('role="ai-segments"')));
  assert.deepEqual(result.humanizeReport.phasesExecuted, []);
});

test("rewriteDetectorAiSegments: по умолчанию работает прежний конвейер (sepia по склейке), strictHuman выключен", async () => {
  const segments = [
    { text: "Человеческий кусок без формул. Я сел и выпил воды, а потом долго смотрел в стену.\n\n", label: "HUMAN" },
    { text: "Волна ужаса накрыла его, и время словно остановилось перед лицом тьмы.\n\n", label: "AI" },
  ];
  let fullTextCalls = 0;
  const generate = async (params: { contents: string }) => {
    const match = params.contents.match(/<DATA role="ai-segments">\n([\s\S]*?)\n<\/DATA>/);
    if (match) {
      const targets = JSON.parse(match[1]) as Array<{ text: string }>;
      return JSON.stringify({ blocks: targets.map((t) => t.text.replace(/Волна ужаса накрыла его,?\s*/iu, "")) });
    }
    fullTextCalls += 1;
    return segments.map((s) => s.text).join("");
  };
  const result = await rewriteDetectorAiSegments(segments, generate as any, {
    model: "mock",
    personaBlock: "",
    humanizeDepth: "maximum",
  });
  assert.ok(fullTextCalls >= 1, "глобальные фазы по склейке должны запускаться");
  assert.equal(result.humanizeReport.note?.includes("дословно") ?? false, false);
});
