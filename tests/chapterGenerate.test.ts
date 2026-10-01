import test from "node:test";
import assert from "node:assert/strict";
import { aiTellScore, humanizeGatePassed, longTailStats, rankChapterCandidate, resolveHumanizeDepth, staccatoIssue, STACCATO_BLOCK_MIN_SENTENCES } from "../server/humanStyle";
import {
  detectorSegmentIssues,
  enhancedPhaseNeeded,
  fallbackBeatsFromSynopsis,
  hasStyleDefect,
  humanizeProseDraft,
  isAcceptableDetectorSegmentRewrite,
  isAcceptableRewrite,
  isAcceptableStaccatoRewrite,
  isAcceptableStyleRewrite,
  longTailAdded,
  longTailRegressed,
  rewriteDetectorAiSegments,
  runTouchupPipeline,
  sceneStampIssues,
  staccatoRegressed,
  styleDefectFixed,
  styleDefectWorsened,
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

test("стаккато-доводка запускается даже при непройденном gate", async () => {
  // Телеграфный текст без единого штампа: gate его не пропускает (нет хвоста
  // длинных фраз + однородные зачины), но стаккато-проход обязан отработать —
  // иначе рубленые фразы не склеятся никогда. Раньше gate такой текст пропускал
  // (хвост в score не входил), и доводка срабатывала лишь по исключению.
  const source = [
    "Он налил воды в ладони и пробовал каплю на вкус.",
    "Руки вытерлись о штанину.",
    "Дверная створка стояла неподвижно.",
    "Он давил на неё плечом.",
    "Створка сдвинулась на палец.",
    "Тогда он обошёл бочку с другой стороны помещения.",
    "Между досками виднелась широкая щель.",
    "Конец ножа свободно туда помещался.",
    "Он поддел доску и дёрнул ножом.",
    "Доска треснула и упала на пол, подняв пыль.",
    "Пыль осела на бочке.",
    "Вода внутри стояла холодная.",
    "Он огляделся ещё раз вокруг.",
    "Больше в помещении ничего не было.",
  ].join(" ");

  const before = aiTellScore(source);
  // Сборка 112: телеграф без единой длинной фразы и с однородными зачинами gate
  // больше не пропускает (нет хвоста + openerClass) — и это правильно: такой
  // текст и есть машинный. Стаккато-проход при этом обязан отработать тем более.
  assert.ok(!humanizeGatePassed(before, 12, 0.45), `телеграф не должен проходить gate: score=${before.score}`);
  assert.ok((before.longTailComponent ?? 0) > 0, "отсутствие хвоста должно давать баллы");

  const merged = [
    "Он налил воды в ладони, вытер руки о штанину и подошёл к дверной створке, которая стояла неподвижно, сколько он ни давил на неё плечом и не переставал искать щель по краю.",
    "Тогда он обошёл бочку с боку и увидел щель.",
    "Между досками помещался конец ножа, и он поддел доску, дёрнул ножом — доска треснула, упала на пол и подняла пыль, осевшую на бочке с холодной водой.",
    "Он огляделся ещё раз, но пусто.",
  ].join(" ");

  const staccatoRequests: string[] = [];
  const generate = async (params: { contents: string; responseMimeType?: string }) => {
    if (params.responseMimeType === "application/json" || params.contents.includes("priority-blocks")) {
      const match = params.contents.match(/<DATA role="priority-blocks">\n([\s\S]*?)\n<\/DATA>/);
      assert.ok(match, "ожидался payload priority-blocks");
      const targets = JSON.parse(match![1]) as Array<{ text: string }>;
      if (params.contents.includes("убрать стаккато")) {
        staccatoRequests.push(params.contents);
        return JSON.stringify({ blocks: targets.map(() => merged) });
      }
      // Прочие проходы ничего не меняют: важен именно стаккато-проход.
      return JSON.stringify({ blocks: targets.map((target) => target.text) });
    }
    return source;
  };

  const result = await runTouchupPipeline(source, generate as any, {
    model: "mock",
    personaBlock: "сухо",
    depth: resolveHumanizeDepth("balanced"),
  });

  assert.equal(staccatoRequests.length, 1, "стаккато-проход должен отработать ровно один раз");
  assert.ok(result.passesRun >= 1, "проход должен попасть в счётчик");
  assert.ok(!result.text.includes("Дверная створка стояла неподвижно."), "рубленые фразы должны быть склеены");
  assert.ok(result.text.includes("подняла пыль"), "содержание и порядок действий сохраняются");
  assert.equal(staccatoIssue(result.text), null, "после доводки стаккато не должно остаться");
});

test("humanizeProseDraft report includes enhanced phases and gate fields", async () => {
  // Связная бытовая фраза без стаккато (Yandex v2 штрафует цепочки «Шаг. Ещё.»)
  const clean = "Я шёл вдоль стены и слушал, как ключ тихо звенит в кармане. Воздух был тёплым, но сырости уже не было.";
  const generate = async (params: { contents: string; responseMimeType?: string }) => {
    if (/ЗАДАЧА ФАЗЫ 1/iu.test(params.contents)) {
      return "Я шёл вдоль стены. Ключ тихо звенел в кармане. Воздух был тёплым, сырости уже не было.";
    }
    if (/ЗАДАЧА ФАЗЫ 3/iu.test(params.contents)) {
      return "Я шёл вдоль стены. Ключ тихо звенел в кармане. Воздух был тёплым — сырости уже не было.";
    }
    if (params.responseMimeType === "application/json") return JSON.stringify({ blocks: [clean] });
    return clean;
  };
  const result = await humanizeProseDraft(clean, generate as any, {
    model: "mock",
    personaBlock: "",
    humanizeDepth: "fast",
  });
  assert.equal(typeof result.humanizeReport.gatePassed, "boolean");
  assert.equal(result.humanizeReport.depth, "fast");
  assert.equal(result.humanizeReport.mode, "single");
  assert.equal(result.humanizeReport.enhancedScoreUsed, true);
  assert.ok((result.humanizeReport.phasesExecuted?.length ?? 0) >= 1);
  assert.ok(result.humanizeReport.scoreAfter <= 20);
});

test("rankChapterCandidate prefers lower AI-tell and penalizes telegraph rhythm", () => {
  const dirty = aiTellScore("Это был не просто страх. Волна ужаса накрыла его, и время словно остановилось.");
  const clean = aiTellScore("Я шёл вдоль тёплой стены и считал сорок один шаг, пока ключ не перестал звенеть.");
  const telegraph = aiTellScore("Он шагнул. Потом встал. Снова пошёл. Васька кивнул. Илья не ответил. Потом свернул.");
  assert.ok(rankChapterCandidate(clean) < rankChapterCandidate(dirty));
  assert.ok(rankChapterCandidate(clean) < rankChapterCandidate(telegraph));
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

// --- сборка 105: стаккато в целях батча, своя приёмка и пост-проход склейки ---

/** Рубленый сегмент отчёта детектора: доля ≤6 слов 0,625, цепочка 5 (порог 4). */
const STACCATO_HOT_SEGMENT = "Он медленно огляделся вокруг. Пыль лежала на бетоне ровным слоем. "
  + "Дверь в конце коридора была приоткрыта. Свет из щели ложился полосой. Он прислушался и не расслышал ничего. "
  + "Потом шагнул вперёд и почти сразу замер, потому что пол под ногой хрустнул, будто под ним рассыпалось что-то "
  + "старое и сухое, а звук этот ушёл вглубь коридора и вернулся эхом. Он стоял и ждал, пока тишина снова не сомкнётся "
  + "над ним, и думал, что если двинуться дальше, то будет только хуже. Он сел на корточки и стал ждать.";

/** Тот же кусок, склеенный: доля ≤6 слов 0, цепочка 0. */
const STACCATO_MERGED_SEGMENT = "Он медленно огляделся вокруг: пыль лежала на бетоне ровным слоем, "
  + "дверь в конце коридора была приоткрыта, свет из щели ложился полосой. Он прислушался и не расслышал ничего, "
  + "потом шагнул вперёд и почти сразу замер, потому что пол под ногой хрустнул, будто под ним рассыпалось что-то "
  + "старое и сухое, а звук этот ушёл вглубь коридора и вернулся эхом. Он стоял и ждал, пока тишина снова не сомкнётся "
  + "над ним, и думал, что если двинуться дальше, то будет только хуже. Он сел на корточки и стал ждать.";

test("detectorSegmentIssues и приёмка сегмента учитывают стаккато", () => {
  // Стаккато-замечание есть у рубленого сегмента и нет у связанного текста.
  const issues = detectorSegmentIssues(STACCATO_HOT_SEGMENT);
  assert.ok(issues.some((issue) => issue.startsWith("стаккато:")), `ожидали стаккато-issues, получили ${JSON.stringify(issues)}`);
  assert.ok(!detectorSegmentIssues("Он долго смотрел на медленно оседающую пыль на бетонный пол подвала.")
    .some((issue) => issue.startsWith("стаккато:")));

  // Общий критерий отвергает удачную склейку (burstiness падает, score растёт),
  // приёмка сегмента её принимает — иначе стаккато-проход никогда ничего не примет.
  assert.equal(isAcceptableRewrite(STACCATO_HOT_SEGMENT, STACCATO_MERGED_SEGMENT), false);
  assert.equal(isAcceptableStaccatoRewrite(STACCATO_HOT_SEGMENT, STACCATO_MERGED_SEGMENT), true);
  assert.equal(isAcceptableDetectorSegmentRewrite(STACCATO_HOT_SEGMENT, STACCATO_MERGED_SEGMENT), true);

  // Обратный случай: правка проходит по штампам, но включает стаккато — отвергается.
  const stampy = "Он шёл вдоль сырой стены, считая шаги, пока дыхание не выровнялось и сердце не замедлилось. "
    + "Потом он достал фонарь, поднял его к потолку и пошёл дальше по коридору, не оборачиваясь на скрип позади.";
  const choppy = "Он шёл вдоль сырой стены и прислушивался. Дыхание выровнялось, но сердце колотилось. "
    + "Свет дрожал на бетонной стене. Тень ползла по полу. Он шагнул вперёд. Пыль поднялась из щелей. "
    + "Скрипнуло что-то в глубине коридора. Он замер и прижался к стене.";
  assert.equal(isAcceptableRewrite(stampy, choppy), true, "правка убирает штамп — общий критерий доволен");
  assert.equal(staccatoRegressed(stampy, choppy), true, "чистый источник получил стаккато");
  assert.equal(isAcceptableDetectorSegmentRewrite(stampy, choppy), false);
});

// --- сборка 107: хвост длинных предложений (эталон Вася.txt, главы 1-3) ---

/** Сегмент без длинных фраз и без стаккато (все фразы 7–9 слов) — как глава 4. */
const TAILLESS_SEGMENT = [
  "Он вошёл в длинный коридор и остановился у стены.",
  "Стены здесь были сырые и холодные на ощупь.",
  "Где-то в глубине постоянно капала вода.",
  "Он прислушался, но не расслышал ничего интересного.",
  "Потом шагнул вперёд по коридору неуверенно.",
  "Свет мигнул разок и погас на мгновение.",
  "Он достал старый фонарь из кармана куртки.",
  "Фонарь не зажёгся совсем с первого раза.",
  "Он постучал крепко им о ладонь.",
  "Лампа слабо дрогнула и засветилась тускло.",
  "И длинный коридор снова стал совсем тёмным.",
].join(" ");

/** Правка без хвоста: те же фразы, сшитые попарно — до 20 слов, но не 25. */
const MERGED_WITHOUT_TAIL = [
  "Он вошёл в длинный коридор и остановился у стены, стены здесь были сырые и холодные на ощупь.",
  "Где-то в глубине постоянно капала вода, он прислушался, но не расслышал ничего интересного.",
  "Потом шагнул вперёд по коридору неуверенно, свет мигнул разок и погас на мгновение.",
  "Он достал старый фонарь из кармана куртки, фонарь не зажёгся совсем с первого раза.",
  "Он постучал крепко им о ладонь, лампа слабо дрогнула и засветилась тускло.",
  "И длинный коридор снова стал совсем тёмным.",
].join(" ");

/** Правка с хвостом: те же фразы, две растянуты до 25+ слов. */
const MERGED_WITH_TAIL = [
  "Он медленно вошёл в длинный коридор и остановился у сырой стены, прислушиваясь, как где-то в глубине гулко и "
  + "безжизненно капает вода, отражаясь от бетонных плит под низким сводом.",
  "Стены здесь были сырые и холодные на ощупь.",
  "Он прислушался, но не расслышал ничего интересного.",
  "Потом шагнул вперёд по коридору неуверенно, и свет мигнул разок и погас на мгновение.",
  "Он достал старый фонарь из кармана куртки, но тот не зажёгся совсем с первого раза, и пришлось постучать "
  + "им крепко о ладонь, прежде чем слабая лампа наконец дрогнула и засветилась тускло.",
  "И длинный коридор снова стал совсем тёмным.",
].join(" ");

test("detectorSegmentIssues и приёмка требуют хвост длинных предложений", () => {
  // Сегмент без длинных фраз получает замечание, с хвостом — нет.
  const issues = detectorSegmentIssues(TAILLESS_SEGMENT);
  assert.ok(
    issues.some((issue) => issue.startsWith("нет хвоста длинных предложений")),
    `ожидали замечание о хвосте, получили ${JSON.stringify(issues)}`,
  );
  assert.ok(!detectorSegmentIssues(MERGED_WITH_TAIL).some((issue) => issue.startsWith("нет хвоста")));

  // Правка, сшивающая фразы до 20 слов: общая приёмка её принимает
  // (разброс длин вырос, штампов не прибавилось), а приёмка сегмента — нет,
  // потому что хвост так и не появился. Именно это правило двигает метрику.
  assert.equal(isAcceptableRewrite(TAILLESS_SEGMENT, MERGED_WITHOUT_TAIL), true, "общая приёмка должна пропустить");
  assert.equal(longTailAdded(TAILLESS_SEGMENT, MERGED_WITHOUT_TAIL), false);
  assert.equal(isAcceptableDetectorSegmentRewrite(TAILLESS_SEGMENT, MERGED_WITHOUT_TAIL), false);

  // Правка с длинными фразами принимается, хотя burstiness у неё иной.
  assert.equal(longTailAdded(TAILLESS_SEGMENT, MERGED_WITH_TAIL), true);
  assert.equal(longTailRegressed(TAILLESS_SEGMENT, MERGED_WITH_TAIL), false);
  assert.equal(isAcceptableDetectorSegmentRewrite(TAILLESS_SEGMENT, MERGED_WITH_TAIL), true);

  // Отнять хвост у чистого сегмента нельзя ни одной правкой.
  assert.equal(longTailRegressed(MERGED_WITH_TAIL, TAILLESS_SEGMENT), true);
  assert.equal(isAcceptableDetectorSegmentRewrite(MERGED_WITH_TAIL, TAILLESS_SEGMENT), false);
});

test("rewriteDetectorAiSegments: пост-проход склейки кладёт результат в blocks", async () => {
  const segments = [
    { text: "Человеческий кусок без формул. Я сел и выпил воды.", label: "HUMAN" },
    { text: STACCATO_HOT_SEGMENT, label: "AI" },
  ];
  const batchRequests: string[] = [];
  const staccatoRequests: string[] = [];
  const generate = async (params: { contents: string; responseMimeType?: string }) => {
    if (params.contents.includes('role="ai-staccato"')) {
      staccatoRequests.push(params.contents);
      const match = params.contents.match(/<DATA role="ai-staccato">\n([\s\S]*?)\n<\/DATA>/)!;
      const targets = JSON.parse(match[1]) as Array<{ text: string }>;
      return JSON.stringify({ blocks: targets.map(() => STACCATO_MERGED_SEGMENT) });
    }
    const match = params.contents.match(/<DATA role="ai-segments">\n([\s\S]*?)\n<\/DATA>/)
      || params.contents.match(/<DATA role="priority-blocks">\n([\s\S]*?)\n<\/DATA>/);
    if (match) {
      batchRequests.push(params.contents);
      const targets = JSON.parse(match[1]) as Array<{ text: string }>;
      // Батч возвращает сегменты дословно: приёмка правку не принимает,
      // и склейку обязан сделать отдельный стаккато-проход.
      return JSON.stringify({ blocks: targets.map((target) => target.text) });
    }
    if (params.responseMimeType === "application/json") return JSON.stringify({ blocks: [STACCATO_HOT_SEGMENT] });
    return segments.map((segment) => segment.text).join("");
  };

  const result = await rewriteDetectorAiSegments(segments, generate as any, {
    model: "mock",
    personaBlock: "сухо",
    humanizeDepth: "fast",
  });

  assert.ok(batchRequests.length >= 1, "батч по AI-сегментам должен запускаться");
  assert.ok(batchRequests[0].includes("стаккато:"), "цели батча должны содержать стаккато-issues");
  assert.equal(staccatoRequests.length, 1, "пост-проход склейки должен отработать один раз");
  assert.equal(result.humanizeReport.staccatoMergedSegments, 1);
  assert.equal(result.humanizeReport.detectorSegmentsRewritten, 0, "дословный ответ батча не считается переписыванием");
  assert.equal(result.blocks[1], STACCATO_MERGED_SEGMENT, "склейка обязана попасть в blocks — панель вставляет в главу именно их");
  assert.equal(staccatoIssue(result.blocks[1], STACCATO_BLOCK_MIN_SENTENCES), null);
  assert.ok(result.blocks[0].includes("выпил воды"), "HUMAN-сегмент остаётся дословно");
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
  newNamesIssue,
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

test("стаккато в сцене перезапрашивается при написании, а не правится в конце", async () => {
  // Ритм-правило в промпте сцены просит не выравнивать фразы, но ничего не меряет:
  // сцена с цепочками рубленых фраз проходила все прежние проверки и попадала в
  // главу целиком — стаккато всплывал только во внешнем детекторе уже на собранной
  // главе (30.09.2026: 12 из 22 сегментов AI, доля коротких фраз 0.493 против 0.329).
  const shortVariants = [
    "Он ступил босиком и остановился.",
    "Темнота стояла густая и неподвижная.",
    "Где-то капнула вода.",
    "Он сглотнул и пошёл дальше.",
    "Воздух пахло сырой землёй.",
    "Пальцы нащупали холодный камень.",
    "Он оглянулся через плечо.",
  ];
  const staccatoScene = Array.from({ length: 60 }, (_, i) => (i % 5 === 4
    ? `Очерет шевельнулся у самой воды, и он прислушался к шороху под камнями, зовя этот путь тропой номер ${i}.`
    : shortVariants[i % shortVariants.length])).join(" ");
  const goodScene = Array.from({ length: 14 }, (_, i) =>
    `Он дошёл до края тропы, где голый камень сменялся багульником, и стал ждать, пока глаза привыкнут к темноте, зовя этот путь обходом номер ${i}.`,
  ).join(" ");

  const logs: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => { logs.push(args.map(String).join(" ")); };
  let sceneCalls = 0;
  try {
    const generate = async (params: any): Promise<string> => {
      if (/сценарист-структуралист/i.test(params.systemInstruction)) {
        return JSON.stringify({
          beats: Array.from({ length: 8 }, (_, i) => ({ title: `Бит ${i + 1}`, goal: `Событие ${i + 1}`, hook: `Зацепка ${i + 1}`, endsWith: `Конец ${i + 1}` })),
        });
      }
      if (params.responseMimeType === "application/json") return JSON.stringify({ blocks: [] });
      if (params.contents.includes("Бит:")) {
        sceneCalls += 1;
        if (sceneCalls === 1) return staccatoScene;
        if (sceneCalls === 2) return goodScene;
        return mockSceneText(sceneCalls);
      }
      return "";
    };

    const result = await generateHumanizedChapter(
      baseInput({
        currentChapterTitle: "Глава 6. Погода",
        currentChapterSummary: "Ночь у воды",
        authorSample: Array.from({ length: 40 }, (_, i) => `Он шёл вдоль стены и считал шаги, номер ${i}. Пыль лежала на полу ровным слоем.`).join(" "),
        humanizeDepth: "maximum",
        chapterCandidates: 1,
      }),
      generate,
    );

    assert.ok(
      logs.some((line) => /перезапрос — стаккато/u.test(line)),
      `перезапрос с замечанием про стаккато не был заявлен; журнал:\n${logs.slice(0, 25).join("\n")}`,
    );
    assert.ok(!result.text.includes("очерет"), "стаккато-сцена не должна остаться в главе");
    assert.ok(result.text.includes("багульник"), "перезапрос должен принять нормальную версию сцены");
  } finally {
    console.warn = originalWarn;
  }
});

/**
 * Калибровочно чистая сцена-коридор (20 предложений, 267 слов): разные зачины,
 * повторы на месте, «!» есть, длинный хвост есть, TTR 0,60. Опции подставляют ровно
 * один дефект — «» в реплике или тяжёлый штамп — чтобы перезапрос был назван одним
 * нарушением, а не списком из четырёх.
 */
function corridorScene(options: { quoted?: boolean; stamped?: boolean } = {}): string {
  let text = [
    "Он вошёл в длинный коридор и остановился у сырой стены, прислушиваясь, как где-то в глубине гулко и безжизненно капает вода, отражаясь от бетонных плит под низким сводом.",
    "Стены здесь были сырые и холодные на ощупь.",
    "Потом шагнул вперёд по коридору неуверенно, и свет мигнул разок и погас на мгновение, отчего в глубине снова сгустилась тьма.",
    "Старый фонарь он достал из кармана куртки, но тот не зажёгся совсем с первого раза, и пришлось постучать им крепко о ладонь, прежде чем слабая лампа наконец дрогнула и засветилась тускло.",
    "Вода капала в глубине коридора ровно и без торопливости.",
    "Фонарь лежал в ладони тяжёлый и холодный.",
    "Свет мигнул разок и погас на мгновение.",
    "Коридор кончился тупиком!",
    "И длинный коридор снова стал совсем тёмным.",
    "Лампа слабо дрогнула и засветилась тускло.",
    "Васька спросил: - Видишь что-нибудь там? -",
    "Илья не ответил сразу.",
    "Он поднял фонарь повыше и осветил стену, но за плитой была только пыль и старая проводка, висевшая кольцом.",
    "Коридор шёл дальше и поворачивал налево, и этот поворот они уже видели в прошлый раз.",
    "Вода всё так же капала в глубине, считая их шаги и не торопясь ни на секунду.",
    "Фонарь в ладони снова погас, и он постучал им о камень, и лампа дрогнула тусклым светом.",
    "Свет от лампы лёг узкой полосой на пол и дрогнул, и в этой полосе снова сгустилась тьма.",
    "Илья шёл позади и молча следил за стенами, и его шаги звучали ровно и без лишних слов.",
    "Стены здесь были сырые и холодные, и на ощупь камень казался мокрым от сырости.",
    "Он перевёл фонарь на другую руку и шагнул к повороту первым, считая шаги под ногой.",
  ].join(" ");
  if (options.quoted) {
    text = text.replace("- Видишь что-нибудь там? -", "«Видишь что-нибудь там?»");
  }
  if (options.stamped) {
    text = text.replace("Коридор кончился тупиком!", "И в тот самый момент коридор кончился тупиком!");
  }
  return text;
}

test("стиль автора меряется при написании: реплика в кавычках даёт перезапрос", async () => {
  // Сборка 109: четыре левера батча (кавычки, повторы, зачины, восклицания) проверяются
  // на первой попытке сцены, а не когда текст уже склеен в главу. Сцена калибровочно
  // чистая (267 слов, 20 предложений, TTR 0,60, зачины 15%, восклицания 5,0 на 100),
  // единственный дефект — реплика в «», и она же даёт замечание про кавычки.
  const quotedScene = corridorScene({ quoted: true });

  const logs: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => { logs.push(args.map(String).join(" ")); };
  let sceneCalls = 0;
  try {
    const generate = async (params: any): Promise<string> => {
      if (/сценарист-структуралист/i.test(params.systemInstruction)) {
        return JSON.stringify({
          beats: Array.from({ length: 8 }, (_, i) => ({ title: `Бит ${i + 1}`, goal: `Событие ${i + 1}`, hook: `Зацепка ${i + 1}`, endsWith: `Конец ${i + 1}` })),
        });
      }
      if (params.responseMimeType === "application/json") return JSON.stringify({ blocks: [] });
      if (params.contents.includes("Бит:")) {
        sceneCalls += 1;
        if (sceneCalls === 1) return quotedScene;
        return mockSceneText(sceneCalls + 40);
      }
      return "";
    };

    const result = await generateHumanizedChapter(
      baseInput({
        currentChapterTitle: "Глава 7. Капель",
        currentChapterSummary: "Ночной коридор",
        authorSample: Array.from({ length: 40 }, (_, i) => `Он шёл вдоль стены и считал шаги, номер ${i}. Пыль лежала на полу ровным слоем.`).join(" "),
        humanizeDepth: "maximum",
        chapterCandidates: 1,
      }),
      generate,
    );

    assert.ok(
      logs.some((line) => /перезапрос — .*кавычки/u.test(line)),
      `перезапрос с замечанием про кавычки не был заявлен; журнал:\n${logs.slice(0, 30).join("\n")}`,
    );
    assert.ok(!result.text.includes("Видишь что-нибудь там"), "сцена с кавычками не должна остаться в главе");
    assert.ok(result.text.includes("место"), "после перезапроса в главу идёт чистая версия сцены");
  } finally {
    console.warn = originalWarn;
  }
});

test("sceneStampIssues называет тяжёлый штамп и молчит, когда штампов нет", () => {
  const heavy = sceneStampIssues(corridorScene({ stamped: true }), 8);
  assert.equal(heavy.length, 1, JSON.stringify(heavy));
  assert.match(heavy[0], /штамп «в тот самый момент»/);
  assert.deepEqual(sceneStampIssues(corridorScene(), 1000), [], "чистая сцена без штампов — замечаний нет");
  // Мелкий штамп (weight 2) называем только при пробитом гейте: иначе перезапросы
  // пошли бы сплошь — мелкие штампы встречаются и в живой прозе.
  const lightText = "Он пошёл впереди по коридору, и мы перейдём к главному, когда доходим до поворота.";
  const light = sceneStampIssues(lightText, 0);
  assert.equal(light.length, 1, JSON.stringify(light));
  assert.match(light[0], /штамп «перейдём к главному»/);
  assert.deepEqual(sceneStampIssues(lightText, 1000), [], "при пройденном гейте мелкие штампы молчат");
});

test("штамп ловится при написании сцены, а не в touchup-проходе после", async () => {
  // Сборка 110: балл AI-штампов раньше считался только «после написания» — в
  // touchup-проходах и гейте. Теперь сцена с тяжёлым штампом уходит в один
  // перезапрос с названным попаданием, пока её ещё можно переписать целиком.
  const stampedScene = corridorScene({ stamped: true });
  const logs: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => { logs.push(args.map(String).join(" ")); };
  let sceneCalls = 0;
  try {
    const generate = async (params: any): Promise<string> => {
      if (/сценарист-структуралист/i.test(params.systemInstruction)) {
        return JSON.stringify({
          beats: Array.from({ length: 8 }, (_, i) => ({ title: `Бит ${i + 1}`, goal: `Событие ${i + 1}`, hook: `Зацепка ${i + 1}`, endsWith: `Конец ${i + 1}` })),
        });
      }
      if (params.responseMimeType === "application/json") return JSON.stringify({ blocks: [] });
      if (params.contents.includes("Бит:")) {
        sceneCalls += 1;
        if (sceneCalls === 1) return stampedScene;
        return mockSceneText(sceneCalls + 70);
      }
      return "";
    };

    const result = await generateHumanizedChapter(
      baseInput({
        currentChapterTitle: "Глава 8. Тупик",
        currentChapterSummary: "Коридор и штамп",
        authorSample: Array.from({ length: 40 }, (_, i) => `Он шёл вдоль стены и считал шаги, номер ${i}. Пыль лежала на полу ровным слоем.`).join(" "),
        humanizeDepth: "maximum",
        chapterCandidates: 1,
      }),
      generate,
    );

    assert.ok(
      logs.some((line) => /перезапрос — .*штамп «в тот самый момент»/u.test(line)),
      `перезапрос с замечанием про штамп не был заявлен; журнал:\n${logs.slice(0, 30).join("\n")}`,
    );
    assert.ok(!result.text.includes("в тот самый момент"), "сцена со штампом не должна остаться в главе");
    assert.ok(result.text.includes("место"), "после перезапроса в главу идёт чистая версия сцены");
  } finally {
    console.warn = originalWarn;
  }
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

test("сцена с превышением потолка молчаний или freeze не принимается даже на третьей попытке", async () => {
  let sceneCall = 0;
  const generate = async (params: any): Promise<string> => {
    if (/сценарист-структуралист/i.test(params.systemInstruction)) {
      return JSON.stringify({
        beats: Array.from({ length: 8 }, (_, i) => ({ title: `Бит ${i + 1}`, goal: `Событие ${i + 1}`, hook: `Зацепка ${i + 1}`, endsWith: `Конец ${i + 1}` })),
      });
    }
    if (params.responseMimeType === "application/json") return JSON.stringify({ blocks: [] });
    if (!params.contents.includes("Бит:")) return mockSceneText(99, 420);
    sceneCall += 1;
    if (sceneCall <= 3) return mockSceneText(0, 280) + " Он не ответил.";
    if (sceneCall <= 6) return mockSceneText(1, 280) + " Она промолчала.";
    if (sceneCall <= 9) return mockSceneText(2, 280) + " Илья замер.";
    if (sceneCall <= 12) return mockSceneText(3, 280) + " Васька застыл.";
    return mockSceneText(sceneCall, 320);
  };

  const result = await generateHumanizedChapter(
    baseInput({
      currentChapterTitle: "Глава 4. Ночь у чужого входа",
      currentChapterSummary: "Герой ищет вход и слышит работу механизма",
      humanizeDepth: "maximum",
      chapterCandidates: 1,
      authorSample: Array.from({ length: 40 }, (_, i) => `Он шёл вдоль стены и считал шаги, номер ${i}. Пыль лежала на полу ровным слоем.`).join(" "),
    }),
    generate,
  );

  assert.equal(result.humanizeReport.mode, "scenes");
  assert.ok(result.humanizeReport.topupScenes >= 1);
  const silentTotal = (result.text.match(/(?:не\s+ответил\p{L}*|промолчал\p{L}*)/giu) || []).length;
  const freezeTotal = (result.text.match(/(?:замер\p{L}*|застыл\p{L}*)/giu) || []).length;
  assert.ok(silentTotal <= 2, `молчаний должно остаться не больше 2, сейчас ${silentTotal}`);
  assert.ok(freezeTotal <= 3, `freeze-реакций должно остаться не больше 3, сейчас ${freezeTotal}`);
});

test("финальный rewrite не может вернуть молчание, freeze и первое лицо поверх принятой главы", async () => {
  const sample = Array.from({ length: 40 }, (_, i) => `Он шёл вдоль стены и считал шаги, номер ${i}. Пыль лежала на полу ровным слоем.`).join(" ");
  const sceneBase = `${mockSceneText(0, 320)} Это был не просто коридор. Волна ужаса накрыла его, и время словно остановилось.`;
  const generate = async (params: any): Promise<string> => {
    if (/сценарист-структуралист/i.test(params.systemInstruction)) {
      return JSON.stringify({
        beats: Array.from({ length: 8 }, (_, i) => ({ title: `Бит ${i + 1}`, goal: `Событие ${i + 1}`, hook: `Зацепка ${i + 1}`, endsWith: `Конец ${i + 1}` })),
      });
    }
    if (/ЗАДАЧА ФАЗЫ/iu.test(params.contents)) {
      return `${mockSceneText(40, 320)} Я шагнул на звук голоса. Илья не ответил. Васька замер у стены.`;
    }
    if (params.responseMimeType === "application/json") {
      return JSON.stringify({
        blocks: ["Я шагнул на звук голоса. Илья не ответил. Васька замер у стены."],
      });
    }
    if (params.contents.includes("Бит:")) return sceneBase;
    return sceneBase;
  };

  const result = await generateHumanizedChapter(
    baseInput({
      currentChapterTitle: "Глава 4. Ночь у чужого входа",
      currentChapterSummary: "Герой ищет вход и слышит работу механизма",
      previousChapter: sample,
      humanizeDepth: "maximum",
      chapterCandidates: 1,
      authorSample: sample,
    }),
    generate,
  );

  assert.equal(result.humanizeReport.mode, "scenes");
  assert.equal(result.humanizeReport.narrationPerson, "third");
  assert.ok(!/\bя\b/iu.test(result.text), "первое лицо не должно возвращаться после rewrite");
  assert.ok(!/не\s+ответил|промолчал/iu.test(result.text), "rewrite не должен возвращать молчание");
  assert.ok(!/замер|застыл/iu.test(result.text), "rewrite не должен возвращать freeze-штамп");
  assert.match(result.humanizeReport.note || "", /отклон(?:ен|ён|ена)/u);
});

// --- Сборка 108: приёмка по дефектам эталона книги (зачины, повторы, кавычки, восклицания) ---

/** Кусок без единого дефекта: реплика в дефисах, как в книге. */
const CLEAN_STYLE_SEGMENT = [
  "Он вошёл в длинный коридор и остановился у сырой стены, прислушиваясь, как где-то в глубине гулко и безжизненно капает вода, отражаясь от бетонных плит под низким сводом.",
  "Стены здесь были сырые и холодные на ощупь.",
  "Потом шагнул вперёд по коридору неуверенно, и свет мигнул разок и погас на мгновение, отчего в глубине снова сгустилась тьма.",
  "Старый фонарь он достал из кармана куртки, но тот не зажёгся совсем с первого раза, и пришлось постучать им крепко о ладонь, прежде чем слабая лампа наконец дрогнула и засветилась тускло.",
  "Вода капала в глубине коридора ровно и без торопливости.",
  "Фонарь лежал в ладони тяжёлый и холодный.",
  "Свет мигнул разок и погас на мгновение.",
  "Коридор кончился тупиком!",
  "И длинный коридор снова стал совсем тёмным.",
  "Лампа слабо дрогнула и засветилась тускло.",
  "Васька спросил: - Видишь что-нибудь там? -",
  "Илья не ответил сразу.",
].join(" ");

/** Тот же кусок, но реплика в кавычках: единственный дефект — «». */
const QUOTED_STYLE_SEGMENT = CLEAN_STYLE_SEGMENT.replace(
  "- Видишь что-нибудь там? -",
  "«Видишь что-нибудь там?»",
);

test("приёмка 108: снятие кавычек принимается, добавление в чистый кусок — нет", () => {
  const quotedIssues = detectorSegmentIssues(QUOTED_STYLE_SEGMENT);
  assert.ok(
    quotedIssues.some((issue) => issue.startsWith("кавычки:")),
    `ожидали замечание о кавычках, получили ${JSON.stringify(quotedIssues)}`,
  );
  assert.equal(quotedIssues.some((issue) => issue.startsWith("зачины:")), false, "зачины в порядке");
  assert.equal(quotedIssues.some((issue) => issue.startsWith("восклицания:")), false, "восклицания в порядке");

  assert.equal(hasStyleDefect(CLEAN_STYLE_SEGMENT), false, "эталонный кусок чист");
  assert.equal(hasStyleDefect(QUOTED_STYLE_SEGMENT), true);
  assert.equal(styleDefectFixed(QUOTED_STYLE_SEGMENT, CLEAN_STYLE_SEGMENT), true);
  assert.equal(styleDefectWorsened(QUOTED_STYLE_SEGMENT, CLEAN_STYLE_SEGMENT), false);
  assert.equal(isAcceptableStyleRewrite(QUOTED_STYLE_SEGMENT, CLEAN_STYLE_SEGMENT), true);
  assert.equal(
    isAcceptableDetectorSegmentRewrite(QUOTED_STYLE_SEGMENT, CLEAN_STYLE_SEGMENT),
    true,
    "правка, снимающая единственный дефект, принимается",
  );

  // Обратная правка — чистому куску добавили «»: новых дефектов мы не прощаем.
  assert.equal(styleDefectWorsened(CLEAN_STYLE_SEGMENT, QUOTED_STYLE_SEGMENT), true);
  assert.equal(
    isAcceptableDetectorSegmentRewrite(CLEAN_STYLE_SEGMENT, QUOTED_STYLE_SEGMENT),
    false,
    "новый дефект в чистый источник не принимается",
  );
});

test("topup beat forbids new characters and events", () => {
  const beats = fallbackBeatsFromSynopsis(baseInput({ currentChapterTitle: "Глава 4. Ночь у чужого входа" }));
  const beat = topupBeatFor(beats, beats.length, 2_100);
  assert.match(beat.goal, /НЕ вводи новых персонажей/);
  assert.match(beat.goal, new RegExp(String(SCENE_TARGET_WORDS - 2_100)));
});

test("newNamesIssue flags a character absent from plan and text, ignores known names and sentence starts", () => {
  const allowed = "Васька и Илья разожгли костёр. Потом они ели рыбу. Илья молчал.";
  const scene = "Тень двинулась. Потом Васька крикнул. — Гур меня звать, — буркнул гигант. Темнота. Пальцы дрожали. Илья кивнул, и обиделся Гур.";
  const issue = newNamesIssue(allowed, scene);
  assert.match(issue, /«Гур»/);
  for (const word of ["Васька", "Потом", "Илья", "Тень", "Темнота", "Пальцы"]) {
    assert.ok(!issue.includes(`«${word}»`), `${word} не должно быть в замечании: ${issue}`);
  }
  assert.equal(newNamesIssue(allowed, "Васька вздохнул. Темнота. Илья промолчал, а Васька встал. Потом они легли."), "");
  assert.match(newNamesIssue(allowed, "Васька встал и увидел Гура у воды."), /«Гура»/);
});

test("детерминированная склейка чинит хвост без помощи модели (сборка 112)", async () => {
  // Модель-пустышка возвращает блоки без изменений — как слабый flash-lite после
  // 503-фолбэка в живом прогоне главы 4. Хвост при этом обязан вырасти за счёт
  // детерминированной склейки, а не третьего круга перезапросов.
  const source = [
    "Он подошёл вплотную к холодной стене и медленно провёл рукой по камню.",
    "Он почувствовал странное тепло, идущее из глубины кладки.",
    "Васька замер на месте и внимательно посмотрел на старшего брата.",
    "Илья молчал и продолжал смотреть в густую темноту.",
    "Он шагнул вперёд через порог и настороженно огляделся по сторонам.",
    "Васька кивнул в ответ и подошёл ближе к догорающему костру.",
    "Илья поднял сухую ветку и подбросил её в самый центр углей.",
    "Он сел рядом на корточки и протянул озябшие руки к теплу.",
    "Васька тяжело вздохнул и посмотрел на тёмную стену леса.",
    "Илья медленно встал и подошёл к самому краю сырой пещеры.",
    "Он долго прислушивался к шуму холодного ветра за стеной.",
    "Васька спросил брата, долго ли им ещё ждать рассвета.",
  ].join(" ");
  assert.equal(longTailStats(source).count, 0, "длинных нет");

  const generate = async (params: { contents: string; responseMimeType?: string }) => {
    if (params.responseMimeType === "application/json" || params.contents.includes("priority-blocks")) {
      const match = params.contents.match(/<DATA role="priority-blocks">\n([\s\S]*?)\n<\/DATA>/);
      assert.ok(match, "ожидался payload priority-blocks");
      const targets = JSON.parse(match![1]) as Array<{ text: string }>;
      return JSON.stringify({ blocks: targets.map((target) => target.text) });
    }
    return source;
  };

  const result = await runTouchupPipeline(source, generate as any, {
    model: "mock",
    personaBlock: "сухо",
    depth: resolveHumanizeDepth("balanced"),
  });

  const after = longTailStats(result.text);
  assert.ok(after.count >= 1, `склейка обязана дать длинные фразы, тут ${after.count}`);
  assert.ok(
    (result.cleanNote ?? "").includes("детерминированная склейка"),
    `в отчёте должна быть склейка: ${result.cleanNote}`,
  );
});

test("enhanced-фазы пропускают чистые куски без запроса (сборка 112)", () => {
  const depth = resolveHumanizeDepth("balanced");
  // Короткий кусок — пропуск запрещён: метрики на нём шумят.
  const tiny = "Я шёл вдоль стены и слушал, как ключ тихо звенит в кармане.";
  assert.equal(countWordsForTest(tiny) < 150, true);
  // Длинный чистый кусок: ритм в норме, штампов нет, хвост есть.
  const cleanLong = [
    "Вечер пятницы не задался с самого начала, и завертелось всё после того, как он опоздал на автобус в райцентр, где его уже ждали друзья с гитарой и дешёвым лимонадом.",
    "Стоя под куцым козырьком загаженной остановки, он обдумывал сложившуюся ситуацию и перебирал в уме варианты, каждый из которых казался хуже предыдущего.",
    "Ветер усилился, заморосил мелкий дождь, а настроение испортилось окончательно и бесповоротно.",
    "Мокрая футболка липла к спине, кроссовки хлюпали, рюкзак давил на плечи и тянул назад, так что к концу пути руки гудели, а лямки, казалось, въелись в кожу навсегда.",
    "Он решил двинуть к брату, благо идти было недалеко, а дома ждали тепло, ужин и никакого хип-хопа, от которого его уже тошнило.",
    "Танька уедет без него, да и не особо-то он туда хотел попасть в такую погоду.",
    "Редкие прохожие смотрели на него с удивлением, но ему было всё равно: он уже привык, что в таком виде его принимают за настоящего городского сумасшедшего.",
    "До дома он добрался уже в сумерках, когда в окнах зажёгся свет.",
    "В прихожей пахло жареной картошкой, котом и чужим уютом.",
    "Он сбросил рюкзак. Сел на табуретку.",
    "Брат вышел из кухни с полотенцем через плечо и молча поставил перед ним тарелку.",
    "Ели молча, и это молчание, густое и тёплое, было лучшим разговором за весь этот бесконечный день.",
    "Потом они пили чай с вареньем, смотрели в окно на дождь и молчали о своём, потому что всё важное уже было сказано без слов.",
    "За окном шумели деревья, капли стучали по козырьку, а внутри было тепло.",
    "Он подумал, что вечер всё-таки удался, пусть и не так, как планировалось.",
  ].join(" ");
  assert.ok(countWordsForTest(cleanLong) >= 150, "кусок обязан быть измеримым");
  assert.equal(enhancedPhaseNeeded("rhythm-breaker", cleanLong, depth), false, "чистый ритм — пропуск");
  assert.equal(enhancedPhaseNeeded("lexical-diversifier", cleanLong, depth), false, "штампов нет — пропуск");

  const dirtyLong = `${cleanLong} Это был не просто вечер. Волна ужаса накрыла его, и время словно остановилось. Сердце пропустило удар.`;
  assert.equal(enhancedPhaseNeeded("lexical-diversifier", dirtyLong, depth), true, "штампы есть — фаза нужна");
});

function countWordsForTest(text: string): number {
  return (text.match(/[\p{L}\p{N}]+/gu) || []).length;
}
