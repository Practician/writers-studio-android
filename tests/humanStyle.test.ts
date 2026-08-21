import test from "node:test";
import assert from "node:assert/strict";
import {
  aiTellScore,
  blockQualityIssues,
  changedBlockShare,
  detectAiTells,
  flagBlocksForTouchup,
  humanStyleDirectives,
  humanizeGatePassed,
  isCleanBlock,
  paragraphAiTellScore,
  pickBestVariant,
  positiveVoiceFewShots,
  quantitativeVoiceBlock,
  repeatedNgramShare,
  repeatedOpenerShare,
  resolveHumanizeDepth,
  rhythmIssues,
  sentenceBurstiness,
  shortSentenceStats,
  voicePresetById,
  HUMANIZE_DEPTHS,
  VOICE_PRESETS,
  YANDEX_DETECTOR_STYLE,
  YANDEX_LOCAL_GAP,
  interfaceTellShare,
} from "../server/humanStyle";
import { priorityStyleBlockIndexes } from "../server/authorPipeline";
import {
  buildAntiRepeatNotes,
  buildBeatPlanPrompt,
  buildScenePrompt,
  buildSingleChapterPrompt,
} from "../server/chapterGenerate";

test("catalog detects both legacy and new generative clichés", () => {
  const text = "Это было не просто утро. Волна ужаса накрыла его, и время словно остановилось. Повисла гробовая тишина.";
  const hits = detectAiTells(text);
  const ids = hits.map((hit) => hit.id);
  assert.ok(ids.includes("ne-prosto"));
  assert.ok(ids.includes("vremya-zamerlo"));
  assert.ok(ids.includes("grobovaya-tishina"));
});

test("humanStyleDirectives include Yandex detector style patterns", () => {
  const block = humanStyleDirectives();
  assert.ok(YANDEX_DETECTOR_STYLE.includes("телеграф"));
  assert.ok(YANDEX_DETECTOR_STYLE.includes("квест-лог") || YANDEX_DETECTOR_STYLE.includes("не найдено"));
  assert.ok(block.includes("ПАТТЕРНЫ НЕЙРОДЕТЕКТОРА"));
  assert.ok(block.includes("умеренно"));
  assert.ok(block.includes("Начну снова") || block.includes("дневн"));
  // не требуем «минимум я» как единственный режим
  assert.ok(block.includes("не вычищай до нуля") || block.includes("умеренно"));
});

test("interface UI-log patterns are flagged (ch7 vs ch6 lesson)", () => {
  const uiLog =
    "На экране NFC. 1. касание / база. 2. CW / CCW. не найдено: 14. обнаружена новая метка. УР. 2. система дышит.";
  const hits = detectAiTells(uiLog);
  const ids = new Set(hits.map((h) => h.id));
  assert.ok(ids.has("nfc-eng"), "NFC");
  assert.ok(ids.has("cw-ccw-eng") || ids.has("slash-ui-label"), "CW or slash labels");
  assert.ok(ids.has("ne-najdeno-counter"), "counter");
  assert.ok(ids.has("numbered-log-item"), "numbered log");
  const body =
    "Я крутил кольцо медленно и смотрел. Число стало ярче. Заряд около двадцати процентов. Мята ещё чувствовалась.";
  assert.ok(aiTellScore(uiLog).score > aiTellScore(body).score);
});

test("Yandex structural patterns: staccato, space inventory, status UI", () => {
  const staccato =
    "Сел. Встал. Пошёл. Пол твёрже. Стены гладкие. Риски шли ровно. На линии загорелась точка. статус: ок. шаги: 41.";
  const hits = detectAiTells(staccato);
  const ids = new Set(hits.map((h) => h.id));
  assert.ok(ids.has("one-word-sentence") || ids.has("space-inventory") || ids.has("status-colon-ui"), "structural/UI");
  assert.ok(ids.has("steps-colon-ui") || ids.has("status-colon-ui") || ids.has("on-line-map"), "map/status UI");
  const stats = shortSentenceStats(staccato, 4);
  assert.ok(stats.share >= 0.3 || stats.maxChain >= 3, "staccato stats");
  const diary =
    "Я подумал и решил не торопиться. Однако телефон показывал около двадцати процентов, и мята ещё чувствовалась во рту.";
  assert.ok(aiTellScore(staccato).score > aiTellScore(diary).score, "staccato should score higher than diary");
});

test("YANDEX_LOCAL_GAP documents why local detector is not 100% Yandex", () => {
  assert.ok(YANDEX_LOCAL_GAP.reasonsNot100.length >= 3);
  assert.ok(YANDEX_LOCAL_GAP.stats.looAccuracyApprox < 1);
  assert.ok(humanStyleDirectives().includes("стаккато") || humanStyleDirectives().includes("СТАККАТО"));
});

test("local detector catches generic abstraction clusters learned from Yandex AI samples", () => {
  const generic = [
    "Время казалось замершим. Воздух был густым от тревоги.",
    "В этом мире такие вещи казались невозможными. Но здесь всё было по-другому.",
    "Внутри меня оставалось странное чувство. В своих мыслях я осознал: это должно было значить что-то конкретное.",
  ].join(" ");
  const hits = detectAiTells(generic).map((hit) => hit.id);
  assert.ok(hits.includes("vremya-zamerlo"));
  assert.ok(hits.includes("vozdukh-sgustilsya"));
  assert.ok(hits.includes("impossible-here-contrast"));
  assert.ok(hits.includes("strannoe-chuvstvo"));
  assert.ok(hits.includes("meta-realization"));
  assert.ok(hits.includes("forced-meaning"));
});

test("a single numbered chapter heading is not mistaken for a UI log", () => {
  const chapter = "Лабиринт.\n1.\nЯрчайшая вспышка! И далее темнота. Это последнее, что помню.";
  assert.ok(!detectAiTells(chapter).some((hit) => hit.id === "numbered-log-item"));
});

test("bureaucratic language is flagged", () => {
  const hits = detectAiTells("Данный лес является местом силы и представляет собой аномалию.");
  const categories = new Set(hits.map((hit) => hit.category));
  assert.ok(categories.has("bureaucratic"));
  assert.ok(hits.length >= 3);
});

test("burstiness is low for uniform sentences and high for varied ones", () => {
  const uniform = "Он вошёл в тёмный зал и осмотрелся вокруг. Она сидела у окна и читала старую книгу. Ветер стучал в раму и гнул сухие ветки. Лампа мигала над столом и чертила тени.";
  const varied = "Тихо. Он вошёл в зал, где под потолком, среди пыльных знамён и обрывков паутины, ещё жила память о былых праздниках, и остановился. Шаг. Ещё один.";
  assert.ok(sentenceBurstiness(uniform) < sentenceBurstiness(varied));
});

test("repeated sentence openers are measured", () => {
  const monotone = "Он встал. Он оделся. Он вышел. Он закурил.";
  const varied = "Он встал. Утро не обещало ничего. Сигарета нашлась в кармане.";
  assert.ok(repeatedOpenerShare(monotone) > 0.9);
  assert.equal(repeatedOpenerShare(varied), 0);
});

test("ai-tell score is bounded and orders texts sensibly", () => {
  const robotic = "Это был не просто дом. Волна страха накрыла её с пугающей скоростью. Время словно остановилось в тот самый момент. Повисла гробовая тишина перед лицом опасности.";
  const human = "Дом стоял косо, как забытая на веранде табуретка. Марта пнула калитку. Заскрипело. Где-то внизу, под террасой, завозилась соседская такса, и ей вдруг стало смешно от собственного страха.";
  const roboticScore = aiTellScore(robotic);
  const humanScore = aiTellScore(human);
  assert.ok(roboticScore.score > humanScore.score);
  assert.ok(roboticScore.score <= 100 && humanScore.score >= 0);
  assert.ok(humanScore.score < 30);
});

test("priority blocks derive from the shared catalog", () => {
  const blocks = [
    "Обычный абзац про завтрак и дорогу до станции.",
    "Сердце пропустило удар, и волна паники захлестнула его.",
  ];
  assert.deepEqual(priorityStyleBlockIndexes(blocks), [1]);
});

test("block quality guard catches inflation and duplicated draft variants", () => {
  const source = "Я вышел на перрон и огляделся по сторонам.";
  const inflated = source + " " + "Очень длинное продолжение с массой лишних деталей и повторов. ".repeat(8);
  assert.ok(blockQualityIssues(source, inflated).some((issue) => issue.includes("раздут")));

  const duplicated = "Я вышел на пустой перрон и огляделся по сторонам вокзала. Я вышел на пустой перрон и осмотрелся по сторонам вокзала.";
  assert.ok(blockQualityIssues(duplicated, duplicated).some((issue) => issue.includes("одинаковых")));

  assert.deepEqual(blockQualityIssues(source, "Я вышел на перрон. Пусто."), []);
});

test("rhythm issues flag flat cadence and repeated openers", () => {
  const flat = "Он вошёл в тёмный зал и осмотрелся вокруг себя. Он сел на скамью у стены и достал сигареты. Он закурил быстро и глубоко затянулся дымом. Он ждал начала собрания уже очень долго.";
  const issues = rhythmIssues(flat);
  assert.ok(issues.some((issue) => issue.includes("ритм")) || issues.some((issue) => issue.includes("зачины")));
  const lively = "Тихо. Он вошёл в зал, где под потолком среди пыльных знамён ещё жила память о праздниках, и замер у двери. Шаг. Куда теперь?";
  assert.deepEqual(rhythmIssues(lively), []);
});

test("changed block share distinguishes cosmetic and substantive edits", () => {
  const source = ["Первый абзац текста.", "Второй абзац текста.", "Третий абзац текста."];
  const cosmetic = ["Первый абзац текста!", "Второй абзац — текста.", "Третий абзац текста…"];
  assert.equal(changedBlockShare(source, cosmetic), 0);
  const substantive = ["Совсем другой первый абзац.", "Второй абзац текста.", "И новый третий."];
  assert.ok(changedBlockShare(source, substantive) > 0.6);
});

test("quantitative voice block reports measurable stats for long samples", () => {
  const sample = ("Я шёл домой. Дождь лил как из ведра, и вода неслась по проспекту, закручиваясь спиралями. Ну что ж… Придётся бежать! ".repeat(20));
  const block = quantitativeVoiceBlock(sample);
  assert.ok(block.includes("средняя длина предложения"));
  assert.ok(block.includes("многоточия"));
  assert.equal(quantitativeVoiceBlock("Мало текста."), "");
});

test("voice presets are unique and resolvable", () => {
  const ids = VOICE_PRESETS.map((preset) => preset.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(voicePresetById("terse")?.title, "Резкий, рубленый");
  assert.equal(voicePresetById("nope"), undefined);
  assert.equal(voicePresetById(42), undefined);
});

test("RLHF and new structural patterns are flagged", () => {
  const text = "Важно понять: с одной стороны он боялся, с другой надеялся. Таким образом выбора не было. Подводя итог, он шагнул.";
  const ids = detectAiTells(text).map((hit) => hit.id);
  assert.ok(ids.includes("vazhno-ponyat"));
  assert.ok(ids.includes("s-odnoy-storony"));
  assert.ok(ids.includes("podvodya-itog"));
});

test("humanizer-ru 1.2 clusters are detected without banning normal Russian punctuation", () => {
  const text = [
    "Давайте разберёмся, почему это знаменует собой ключевой этап.",
    "По мнению экспертов, будущее выглядит ярким.",
    "Информация ограничена, но, вероятно, он вырос в семье среднего класса.",
    "Внимание — валюта нового века.",
    "Без симметрии. Без эстетики. Только результат.",
  ].join(" ");
  const ids = new Set(detectAiTells(text).map((hit) => hit.id));
  assert.ok(ids.has("announces-instead-of-acts"));
  assert.ok(ids.has("inflated-significance"));
  assert.ok(ids.has("vague-attribution"));
  assert.ok(ids.has("generic-positive-ending"));
  assert.ok(ids.has("speculative-filler"));
  assert.ok(ids.has("aphorism-formula"));
  assert.ok(ids.has("fragment-stack"));

  const natural = detectAiTells("— Ты придёшь? — спросила Лена. Я не знал. Наверное, да.");
  assert.equal(natural.length, 0, "диалоговое тире и обычный вопрос не должны считаться AI-признаком");
});

test("human style guidance preserves factual texture and uses clustered evidence", () => {
  const guidance = humanStyleDirectives();
  assert.match(guidance, /Режь воду, а не фактуру/);
  assert.match(guidance, /сочетания признаков/);
  assert.match(guidance, /не выдумывай/);
});

test("flagBlocksForTouchup ranks dirty paragraphs first and respects limit", () => {
  const blocks = [
    "Обычный спокойный абзац про дорогу домой без всяких формул.",
    "Волна ужаса накрыла его, и время словно остановилось перед лицом тьмы.",
    "Ещё один нейтральный абзац с конкретным ключом в кармане и сухим воздухом.",
    "Это был не просто коридор. Сердце пропустило удар с пугающей скоростью.",
  ];
  const flagged = flagBlocksForTouchup(blocks, 2);
  assert.equal(flagged.length, 2);
  assert.ok(flagged.includes(1));
  assert.ok(flagged.includes(3));
  // Чистые абзацы 0 и 2 не должны попасть в touchup
  assert.ok(!flagged.includes(0));
  assert.ok(!flagged.includes(2));
  assert.ok(isCleanBlock(blocks[0]));
});

test("gate requires burstiness when minBurstiness set", () => {
  const uniform = "Он вошёл в тёмный зал и осмотрелся вокруг. Она сидела у окна и читала старую книгу. Ветер стучал в раму и гнул сухие ветки. Лампа мигала над столом и чертила тени. Собака лежала у двери и тихо дышала.";
  const score = aiTellScore(uniform);
  // без штампов, но ровный ритм — gate по score может пройти, по burstiness — нет
  if (score.burstiness < 0.45 && score.score <= 18) {
    assert.equal(humanizeGatePassed(score, 18, 0.45), false);
    assert.equal(humanizeGatePassed(score, 18, 0), true);
  }
  const lively = aiTellScore("Тихо. Он вошёл в зал, где под потолком ещё жила пыль праздников, и замер. Шаг. Ещё один. Ключ звенит.");
  assert.ok(lively.burstiness >= 0.45 || lively.score < 5);
});

test("repeated n-grams detect scene overlap", () => {
  const a = "Я шёл вдоль стены и считал шаги. Ключ светился синим. Заряд три процента.";
  const b = "Я шёл вдоль стены и считал шаги. Ключ светился синим. Дальше поворот.";
  const c = "Совсем другой кусок: жажда сушила губы, и я сел на пол.";
  assert.ok(repeatedNgramShare(a, b, 4) > repeatedNgramShare(a, c, 4));
});

test("pickBestVariant prefers lower AI-tell and rejects inflated rewrites", () => {
  const source = "Волна страха накрыла его, и время словно остановилось.";
  const better = "Он остановился. Пальцы сами сжали ключ.";
  const worse = "Волна ледяного ужаса накрыла его с пугающей скоростью, и время словно остановилось перед лицом тьмы.";
  const inflated = better + " " + "Лишние детали и повторы. ".repeat(40);
  assert.equal(pickBestVariant(source, [worse, better, inflated]), better);
  assert.equal(pickBestVariant(source, [inflated]), source);
});

test("humanize gate and depth resolution", () => {
  const clean = aiTellScore("Я шёл вдоль стены и считал шаги. Ключ грел ладонь. Сорок один.");
  assert.equal(humanizeGatePassed(clean, 18), true);
  const dirty = aiTellScore("Это был не просто страх. Волна ужаса накрыла его, и время словно остановилось.");
  assert.equal(humanizeGatePassed(dirty, 8), false);
  assert.equal(resolveHumanizeDepth("maximum").id, "maximum");
  assert.equal(resolveHumanizeDepth("nope").id, "balanced");
  assert.ok(HUMANIZE_DEPTHS.maximum.sceneGeneration);
  assert.ok(HUMANIZE_DEPTHS.maximum.minAuthorSampleChars >= 300);
});

test("paragraph score boosts short stamped blocks", () => {
  const short = paragraphAiTellScore("Волна ужаса накрыла его.");
  assert.ok(short.score >= 25);
});

test("positive voice few-shots extract sample paragraphs", () => {
  const sample = [
    "Я вышел на остановку. Дождь лил стеной, и автобус опаздывал уже минут двадцать.",
    "",
    "В кармане вибрировал телефон. На экране горела странная надпись, и я не сразу понял, что делать.",
    "",
    "Коротко.",
  ].join("\n");
  const block = positiveVoiceFewShots(sample, 2);
  assert.ok(block.includes("Эталонные абзацы"));
  assert.ok(block.includes("автобус"));
});

test("chapter prompt builders include canon and beat focus", () => {
  const input = {
    title: "Лабиринт",
    genre: "триллер",
    description: "тест",
    currentChapterTitle: "Глава 2",
    currentChapterSummary: "Герой размечает коридор",
    previousChapter: "Конец первой главы. Шаг в темноту.",
    worldBible: "Правило левой руки",
    bookPlan: "Глава 2 — метки",
    canonDossier: "Заряд 3%",
    customPrompt: "Без магии",
    model: "gemini-2.5-flash",
  };
  const plan = buildBeatPlanPrompt(input);
  assert.ok(plan.includes("Глава 2"));
  assert.ok(plan.includes("Заряд 3%"));
  const scene = buildScenePrompt(
    input,
    { title: "Метка", goal: "Вырезать I", hook: "ключ", endsWith: "синий свет" },
    0,
    4,
    "Хвост.",
    "стиль",
    "не повторяй 3%",
  );
  assert.ok(scene.includes("бит 1 из 4"));
  assert.ok(scene.includes("ключ"));
  assert.ok(scene.includes("не повторяй 3%"));
  assert.ok(scene.includes("Продвинь сюжет"));
  const notes = buildAntiRepeatNotes(["Шаг. Заряд 3%. Я шёл вдоль стены."]);
  assert.ok(notes.includes("3%"));
  const full = buildSingleChapterPrompt(input, "few-shot");
  assert.ok(full.includes("few-shot"));
  assert.ok(full.includes("Правило левой руки"));
});
