import test from "node:test";
import assert from "node:assert/strict";
import {
  AI_TELL_CATALOG,
  AI_TELL_CATALOG_V2_EXTRA,
  aiTellScore,
  authorIdiolectBlock,
  blockQualityIssues,
  changedBlockShare,
  detectAiTells,
  flagBlocksForTouchup,
  fuseShortSentencesForTail,
  humanStyleDirectives,
  humanizeGatePassed,
  isCleanBlock,
  longTailIssue,
  longTailStats,
  LONG_TAIL_MIN_SENTENCES,
  paragraphAiTellScore,
  pickBestVariant,
  positiveVoiceFewShots,
  quantitativeVoiceBlock,
  rankChapterCandidate,
  repeatedNgramShare,
  repeatedOpenerShare,
  openerClassShare,
  OPENER_SHARE_LIMIT,
  WORD_REPEAT_TTR_LIMIT,
  EXCLAMATION_RATE_LIMIT,
  STYLE_DEFECT_RANK_COST,
  segmentStyle,
  segmentStyleWindows,
  styleIssues,
  styleIssuesByWindows,
  speechFormattingStats,
  speechMarkingRegressed,
  staccatoBlocks,
  staccatoIssue,
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

test("opener class share sees pronoun and name openers even without adjacent repeats", () => {
  // Так выглядела глава 4: «он / Илья / Васька» в трети предложений, но не подряд —
  // соседних повторов здесь почти нет, и прежняя метрика давала 1 %.
  const machine = [
    "Он поднялся и пошёл к стене, где Илья уже ждал с ножом.",
    "Илья увидел ровный шов и остановился, а Васька подался вперёд.",
    "Васька присел, прислушался и замер, пока Илья смотрел в темноту.",
    "Он достал нож из ножен и передал его Ваське.",
    "Илья обернулся к брату, но тот уже ушёл к спуску.",
    "Васька отшатнулся и вытер руки о штаны.",
    "Он снова приложил ухо к камню, и Илья не стал его одёргивать.",
    "Илья потянулся к плите, на ходу соображая, куда ведёт щель.",
    "Васька вытер нож о штанину, а Илья уже спускался по ступеням.",
  ].join(" ");
  assert.ok(repeatedOpenerShare(machine) < 0.2, "соседних повторов почти нет");
  assert.ok(openerClassShare(machine) > 0.6, `класс зачинов должен быть высоким, получено ${openerClassShare(machine)}`);

  const varied = [
    "Марта пнула калитку.",
    "Заскрипело, и из сеней потянуло сыростью.",
    "Кто-то откашлялся за забором.",
    "До вечера оставалось часа четыре.",
    "Табуретка поехала с пола.",
    "В огороде бухнуло ведро.",
    "Скрипнул забор, и лёгкий ветер обогнул крыльцо.",
  ].join(" ");
  assert.ok(openerClassShare(varied) <= 0.25);

  const machineScore = aiTellScore(machine).score;
  const variedScore = aiTellScore(varied).score;
  assert.ok(machineScore > variedScore, "однородные зачины должны понижать оценку текста");
});

test("прямая речь без кавычек и тире считается браком", () => {
  // Случай главы 4: 18 речевых тегов, 17 реплик без разметки.
  const unmarked = [
    "Ну, теперь хотя бы с голоду не помрем, буркнул Илья, выуживая нож.",
    "Слышал, шепотом спросил он, глядя в темноту.",
    "Не природа, тут ты прав, пробормотал Илья, потирая затылок.",
    "Иль, тут покрытие, прошептал Васька, ведя лучом по стене.",
    "Ну, приплыли, буркнул Илья, не опуская ножа.",
  ].join(" ");
  const stats = speechFormattingStats(unmarked);
  assert.equal(stats.tagged, 5);
  assert.equal(stats.unmarked, 5);
  assert.equal(stats.markedShare, 0);

  const marked = [
    "— Слышал? — шепотом спросил он, глядя в темноту.",
    "«Не природа, — пробормотал Илья, — тут ты прав».",
    "— Ну, приплыли, — буркнул Илья, не опуская ножа.",
    "— Иль, тут покрытие, — прошептал Васька.",
  ].join(" ");
  const markedStats = speechFormattingStats(marked);
  assert.equal(markedStats.unmarked, 0);
  assert.equal(markedStats.markedShare, 1);

  // Нарратив без речи проверку не трогает — иначе штраф был бы всюду.
  const narration = "Пещера встретила их сырым запахом камня. Илья сбросил вязанку дров.";
  assert.equal(speechFormattingStats(narration).tagged, 0);

  assert.ok(aiTellScore(unmarked).score > aiTellScore(marked).score);
});

test("ai-tell score is bounded and orders texts sensibly", () => {  const robotic = "Это был не просто дом. Волна страха накрыла её с пугающей скоростью. Время словно остановилось в тот самый момент. Повисла гробовая тишина перед лицом опасности.";
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
    // Ритм спрашиваем только на измеримом объёме: объявляем его явно, иначе
    // короткий текст (burstiness — шум) проходил бы gate мимо проверки ритма.
    assert.equal(humanizeGatePassed({ ...score, words: 500 }, 18, 0.45), false);
    assert.equal(humanizeGatePassed({ ...score, words: 500 }, 18, 0), true);
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

test("ни один штамп каталога не содержит мёртвого якоря \\b после кириллицы", () => {
  // `\b` опирается на `\w`, а `\w` в JS — только ASCII. Якорь вплотную к русскому
  // слову не срабатывает НИКОГДА: запись видна в UI, но не приносит попаданий.
  // В каталоге так были 24 записи из 186: «Между тем», «вдруг», «правда была
  // проста», «силой воли», «считал шаги» и другие. Границы слова задаются
  // явным lookahead (?![а-яёa-z]).
  const dead = [...AI_TELL_CATALOG, ...AI_TELL_CATALOG_V2_EXTRA].filter((entry) => {
    const source = entry.pattern.source;
    return /[а-яё][а-яё]{2,}\)?\\b/iu.test(source) || (/\\b/u.test(source) && /[а-яё]\]/u.test(source));
  });
  assert.deepEqual(dead.map((entry) => entry.id), []);
});

test("починенные штампы действительно ловят свой текст", () => {
  // Регрессия на конкретные записи: якорь починен, но сама альтернатива могла
  // при этом отвалиться — проверяем попадание, а не только source.
  const probes: Array<[string, string]> = [
    ["mezhdu-tem", "Между тем он молчал."],
    ["tem-vremenem", "Тем временем свет погас."],
    ["vmeste-s-tem", "Он вместе с тем ушёл."],
    ["ne-daleko-ot", "Неподалёку показалась стена."],
    ["chto-kasaetsya", "Это, что касается его, не помогло."],
    ["pravda-byla-prosta", "Правда была проста."],
    ["stalo-ochevidno", "Стало очевидно, что он прав."],
    ["sila-voli", "Силой воли он поднялся."],
    ["vo-vsyom-vinom", "Во всём виноват был он."],
    ["on-on-on-chain", "Он молчал. Он кивнул. Он вышел."],
    ["vdrug-vnezapno", "Вдруг он оглянулся."],
    ["counting-steps", "Он шёл, шаг считал на автомате."],
    ["eto-bylo-ne", "Это было не просто письмо. Это был вызов."],
  ];
  const all = [...AI_TELL_CATALOG, ...AI_TELL_CATALOG_V2_EXTRA];
  for (const [id, text] of probes) {
    const entry = all.find((item) => item.id === id);
    assert.ok(entry, `запись ${id} должна существовать в каталоге`);
    const live = new RegExp(entry!.pattern.source, entry!.pattern.flags.includes("g") ? entry!.pattern.flags : `${entry!.pattern.flags}g`);
    assert.ok(live.test(text), `«${id}» должен ловить: ${text}`);
  }
});

// --- стаккато: метрика приёмки, откалиброванная по внешнему нейродетектору ---

const CHOPPY_BLOCK = [
  "Вода в бочке стояла холодная.",
  "Он налил в ладони.",
  "Попробовал.",
  "Горько.",
  "Потом вытер руки о штаны и посмотрел на дверь.",
  "Створка не двигалась.",
  "Давил.",
  "Не поддалось.",
  "Тогда он обошёл бочку с другой стороны и нашёл щель между досками, в которую помещался конец ножа.",
  "Поддел.",
  "Дёрнул.",
  "Доска треснула и упала на пол, подняв пыль.",
].join(" ");

const LIVING_BLOCK = [
  "Он налил воды в ладони и попробовал каплю — горько на вкус.",
  "Вытер руки о штаны и подошёл к дверной створке.",
  "Створка не поддавалась, сколько он ни давил на неё всей спиной.",
  "Тогда он обошёл бочку с другой стороны.",
  "Там между досками виднелась щель, куда свободно помещался конец ножа.",
  "Поддел ножом и дёрнул — доска треснула и упала на пол, подняв пыль.",
  "Вода в бочке стояла холодная, и пахло сырой землёй из-под камней.",
  "Он огляделся, но в помещении кроме бочки и полки ничего не было.",
  "Полка шаталась под ладонью, едва держась на одном гвозде.",
  "Гвоздь он вытащил и положил в карман, чтобы не потерять.",
].join(" ");

test("staccatoIssue ловит цепочки рубленых фраз и молчит на живом тексте", () => {
  const note = staccatoIssue(CHOPPY_BLOCK);
  assert.ok(note, "цепочка из четырёх рубленых фраз обязана дать замечание");
  assert.match(note!, /стаккато/u);
  assert.match(note!, /склей/u);
  assert.match(note!, /цепочка до 4/u);

  assert.equal(staccatoIssue(LIVING_BLOCK), null, "длинные фразы без цепочек — не стаккато");
  // Маленький фрагмент не оцениваем: доля на трёх предложениях — шум.
  assert.equal(staccatoIssue("Он шагнул. Встал. Пошёл."), null);
});

/** Одиннадцать рубленых фраз без единой длинной — как сегмент главы 4 до правок. */
const TAILLESS_SEGMENT = [
  "Он вошёл в коридор и остановился.",
  "Стены здесь были сырые на ощупь.",
  "Где-то в глубине капала вода.",
  "Он прислушался и не расслышал ничего.",
  "Потом шагнул вперёд по коридору.",
  "Свет мигнул и погас на мгновение.",
  "Он достал фонарь из кармана.",
  "Фонарь не зажёгся с первого раза.",
  "Он постучал им о ладонь.",
  "Лампа дрогнула и засветилась тускло.",
  "И коридор снова стал тёмным.",
].join(" ");

/** Те же фразы, где две растянуты до человеческой длины (25+ слов). */
const WITH_TAIL_SEGMENT = [
  "Он медленно огляделся вокруг: пыль лежала на бетоне ровным слоем, дверь в конце коридора была приоткрыта, "
  + "свет из щели ложился полосой на мокрый пол, не двигаясь с места.",
  "Стены здесь были сырые на ощупь.",
  "Где-то в глубине капала вода.",
  "Он прислушался к тишине, которая повисла между стенами, и понял, что шум этот — не вода, а что-то живое, "
  + "что давно привыкло ждать в темноте и не собиралось показываться.",
  "Потом шагнул вперёд по коридору.",
  "Свет мигнул и погас на мгновение.",
  "Он достал фонарь из кармана.",
  "Фонарь не зажёгся с первого раза.",
  "Он постучал им о ладонь.",
  "Лампа дрогнула и засветилась тускло.",
  "И коридор снова стал тёмным.",
].join(" ");

test("longTailIssue ловит отсутствие длинного хвоста и молчит на человеческом тексте", () => {
  const empty = longTailStats(TAILLESS_SEGMENT);
  assert.equal(empty.total, 11, "все одиннадцать фраз вне реплик");
  assert.equal(empty.count, 0, "длинных нет");
  assert.equal(empty.share, 0);

  const note = longTailIssue(TAILLESS_SEGMENT);
  assert.ok(note, "одиннадцать рубленых фраз без длинной — обязаны дать замечание");
  assert.match(note!, /нет хвоста длинных предложений/u);
  assert.match(note!, /25\+ слов/u);
  assert.match(note!, /15–30%/u);

  assert.equal(longTailIssue(WITH_TAIL_SEGMENT), null, "две длинные из одиннадцати — хвост есть");
  assert.equal(longTailStats(WITH_TAIL_SEGMENT).count, 2);

  // Маленький фрагмент не оцениваем: доля на трёх предложениях — шум.
  assert.equal(longTailIssue("Он шагнул. Встал. Пошёл."), null);
  // Ниже человеческого минимума (0,186) замечание не срабатывает.
  assert.ok(longTailIssue(TAILLESS_SEGMENT, LONG_TAIL_MIN_SENTENCES, 0.01), "порог сцены 0.01 = «ни одного длинного»");
  assert.equal(longTailIssue(WITH_TAIL_SEGMENT, LONG_TAIL_MIN_SENTENCES, 0.01), null);
});

test("rhythm issues дополняются замечанием о монотонном длинном абзаце", () => {
  const issues = rhythmIssues(TAILLESS_SEGMENT);
  assert.ok(issues.some((issue) => issue.startsWith("нет хвоста длинных предложений")), JSON.stringify(issues));
  // Абзац из пяти фраз ещё не меряем: главная мера хвоста — сцена и сегмент отчёта.
  const five = TAILLESS_SEGMENT.split(". ").slice(0, 5).join(". ") + ".";
  assert.ok(!rhythmIssues(five).some((issue) => issue.startsWith("нет хвоста длинных предложений")));
});

test("staccatoBlocks отдаёт худшие абзацы в пределах лимита", () => {
  assert.deepEqual(staccatoBlocks([LIVING_BLOCK, CHOPPY_BLOCK, LIVING_BLOCK], 8), [1]);
  assert.deepEqual(staccatoBlocks([CHOPPY_BLOCK, LIVING_BLOCK, CHOPPY_BLOCK], 8), [0, 2]);
  assert.deepEqual(staccatoBlocks([CHOPPY_BLOCK, CHOPPY_BLOCK], 1), [0]);
  assert.deepEqual(staccatoBlocks([CHOPPY_BLOCK], 0), [], "лимит 0 — ничего не берём");
});

// --- Сборка 108: оформление и повторность (эталон: 32 сегмента книги, 100% HUMAN) ---

/** Кусок без единого дефекта: разные зачины, слова повторяются, длинный хвост есть, «!» есть. */
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

/** Тот же кусок, но реплика взята в кавычки: единственный дефект — «». */
const QUOTED_STYLE_SEGMENT = CLEAN_STYLE_SEGMENT.replace(
  "- Видишь что-нибудь там? -",
  "«Видишь что-нибудь там?»",
);

/** Реплики в дефисах, как в книге: «Васька спросил: - Видишь что-нибудь там? -». */
const DEPHRASED_STYLE_SEGMENT = CLEAN_STYLE_SEGMENT;

test("styleIssues: четыре левера сборки 108 отмерены по эталону книги", () => {
  const quoted = styleIssues(QUOTED_STYLE_SEGMENT);
  assert.deepEqual(quoted.map((issue) => issue.split(":")[0]), ["кавычки"], JSON.stringify(quoted));
  assert.deepEqual(styleIssues(DEPHRASED_STYLE_SEGMENT), [], "эталонный кусок без дефектов");
  // Короткий фрагмент не меряем: на трёх предложениях и TTR, и зачины — шум.
  assert.deepEqual(styleIssues("Он долго смотрел на медленно оседающую пыль."), []);

  const clean = segmentStyle(DEPHRASED_STYLE_SEGMENT);
  assert.ok(clean.openerShare <= OPENER_SHARE_LIMIT, `зачин ${clean.openerShare}`);
  assert.ok(clean.ttr <= WORD_REPEAT_TTR_LIMIT, `TTR ${clean.ttr}`);
  assert.ok(clean.exclamationRate >= EXCLAMATION_RATE_LIMIT, `восклицания ${clean.exclamationRate}`);
  assert.equal(clean.quoteSentences, 0);
});

test("styleIssues ловит однотипные зачины, повторность и отсутствие восклицаний", () => {
  const stampy = [
    "Он стоял у края обрыва и смотрел вниз.",
    "Он не решался сделать шаг ближе.",
    "Он помнил, как вчера здесь была вода.",
    "Он услышал шорох за спиной.",
    "Он обернулся и не увидел ничего.",
    "Он сел на камень и стал ждать.",
    "Он достал флягу из-за пазухи и сделал долгий глоток.",
    "Ветер поднимал пыль над тропой и уносил её к дальнему лесу, где уже темнело.",
    "Камни под ногой зыблись, словно их подкапывало чем-то давним и терпеливым.",
    "Где-то внизу по камню стучало неровно и долго, откликаясь в скале.",
    "Луна вышла из-за туч и залила склон холодным светом.",
    "Кто-то крикнул ему со стороны дороги дважды, и голос был незнакомый, короткий.",
  ].join(" ");
  const issues = styleIssues(stampy);
  assert.ok(issues.some((issue) => issue.startsWith("зачины:")), JSON.stringify(issues));
  assert.ok(issues.some((issue) => issue.startsWith("повтор слов:")), JSON.stringify(issues));
  assert.ok(issues.some((issue) => issue.startsWith("восклицания:")), JSON.stringify(issues));
  assert.ok(!issues.some((issue) => issue.startsWith("кавычки:")), "кавычек нет");
  const style = segmentStyle(stampy);
  assert.ok(style.words >= 100, `TTR меряется от 100 слов, тут ${style.words}`);
  assert.ok(style.openerShare > OPENER_SHARE_LIMIT);
  assert.ok(style.ttr > WORD_REPEAT_TTR_LIMIT);
  assert.ok(style.exclamationRate < EXCLAMATION_RATE_LIMIT);
});

test("styleIssuesByWindows: калибровочная нарезка и одно замечание на левер", () => {
  // Порог TTR 0,83 отмерен на окнах ≈1050 знаков — на сцене целиком повторность
  // из-за длины ниже, и левер почти не срабатывал бы. Сцена из четырёх копий куска
  // с «» даёт несколько окон, но замечание про кавычки ровно одно.
  const scene = Array.from({ length: 4 }, () => QUOTED_STYLE_SEGMENT).join(" ");
  const windows = segmentStyleWindows(scene);
  assert.ok(windows.length >= 2, `окон ${windows.length}`);
  assert.ok(windows.filter((window) => window.includes("«")).length >= 2, "«» должны быть в двух окнах");
  const issues = styleIssuesByWindows(scene);
  assert.equal(issues.filter((issue) => issue.startsWith("кавычки:")).length, 1, JSON.stringify(issues));
  // Короткий кусок без окон мерится как есть, и чистый эталон замечаний не даёт.
  assert.ok(styleIssuesByWindows(QUOTED_STYLE_SEGMENT).some((issue) => issue.startsWith("кавычки:")));
  assert.ok(!styleIssuesByWindows(DEPHRASED_STYLE_SEGMENT).some((issue) => issue.startsWith("кавычки:")));
});

test("ранг черновика главы штрафует дефекты стиля (сборка 110)", () => {
  // Выбор между черновиками — тоже «при написании», но до сборки 110 стиль в ранг
  // не входил: кавычечный черновик выигрывал у чистого при равных штампах.
  const cleanScore = aiTellScore(CLEAN_STYLE_SEGMENT);
  const quotedScore = aiTellScore(QUOTED_STYLE_SEGMENT);
  assert.equal(styleIssuesByWindows(CLEAN_STYLE_SEGMENT).length, 0, "эталонный кусок без дефектов");
  const quotedDefects = styleIssuesByWindows(QUOTED_STYLE_SEGMENT).length;
  assert.ok(quotedDefects >= 1, `кавычки должны давать дефект, тут ${quotedDefects}`);
  // Штампы и ритм у двух кусков одинаковы — разница только в оформлении реплики.
  assert.equal(
    rankChapterCandidate(cleanScore, 8, 0.5, 0),
    rankChapterCandidate(quotedScore, 8, 0.5, 0),
    "без учёта стиля куски неразличимы",
  );
  assert.ok(
    rankChapterCandidate(quotedScore, 8, 0.5, quotedDefects)
      > rankChapterCandidate(cleanScore, 8, 0.5, 0),
    "с учётом стиля чистый черновик выигрывает",
  );
  assert.equal(
    rankChapterCandidate(quotedScore, 8, 0.5, quotedDefects)
      - rankChapterCandidate(quotedScore, 8, 0.5, 0),
    quotedDefects * STYLE_DEFECT_RANK_COST,
  );
});

// --- Сборка 112: гейт видит настоящие маркеры (калибровка на главе 4 против эталона) ---

/** Машинный стиль главы 4: короткие фразы ~12 слов, треть зачинов «он/имена», ни одной длинной, реплики без «!». */
const MACHINE_CHAPTER_STYLE = [
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
  "Илья ответил ему, что ждать осталось совсем недолго.",
].join(" ");

/** Живой стиль эталона: разные зачины, длинный хвост, «!» в репликах с тегами. */
const LIVING_CHAPTER_STYLE = [
  "Вечер пятницы не задался с самого начала, и завертелось всё после того, как он опоздал на автобус в райцентр, где его уже ждали друзья с гитарой и дешёвым лимонадом.",
  "Стоя под куцым козырьком загаженной остановки, Васька обдумывал сложившуюся ситуацию!",
  "На автобус он опоздал, и планы развеялись, как развеивается пар от электронной сигареты — медленно, но неотвратимо.",
  "Ветер усилился, заморосил мелкий дождь.",
  "— Давай быстрее, — буркнул он, выкладывая листья широким веером.",
  "— Успеется! — ответил Илья, полоснув ножом по жабрам.",
  "Мокрая футболка липла к спине, кроссовки хлюпали, а настроение испортилось окончательно и бесповоротно.",
  "Затянувшись, он выпустил клуб густого пара и решил двинуть к брату.",
  "Танька уедет без него, да и не особо-то он туда хотел.",
  "Рюкзак давил на плечи, лямки врезались в кожу, и каждый шаг отдавался глухой болью в натёртых ногах.",
  "До дома он добрался уже в сумерках.",
  "В окнах горел тёплый свет, пахло жареной картошкой и чужим уютом.",
].join(" ");

test("гейт различает машинный и живой стиль главы (сборка 112)", () => {
  // До сборки 112 глава 4 давала score 7 при эталоне 9 — перевёрнутая шкала:
  // гейт пропускал машинный текст и не видел настоящих маркеров.
  const machine = aiTellScore(MACHINE_CHAPTER_STYLE);
  const living = aiTellScore(LIVING_CHAPTER_STYLE);
  assert.ok((machine.longTailComponent ?? 0) > 0, "у машинного нет хвоста — должны быть баллы");
  assert.ok((machine.exclamationComponent ?? 0) > 0, "реплики без «!» — должны быть баллы");
  assert.ok(
    (machine.openerClassShare ?? 0) > 0.2,
    `однородные зачины: ${machine.openerClassShare}`,
  );
  assert.ok(
    machine.score > living.score + 10,
    `машинный (${machine.score}) обязан заметно проигрывать живому (${living.score})`,
  );
  assert.ok(!humanizeGatePassed(machine, 12, 0.45), "машинный стиль gate не проходит");
});

test("живой эталон не штрафуется новыми компонентами", () => {
  const living = aiTellScore(LIVING_CHAPTER_STYLE);
  assert.ok(
    (living.longTailComponent ?? 1) <= 3,
    `у живого хвост есть: ${living.longTailShare}`,
  );
  assert.equal(living.exclamationComponent ?? 0, 0, "«!» в репликах есть — штрафа нет");
});

test("fuseShortSentencesForTail растит хвост без потери слов и без касания реплик", () => {
  const withSpeech = `${MACHINE_CHAPTER_STYLE} — Ты видел? — спросил Васька. — Видел, — коротко отозвался брат.`;
  const before = longTailStats(withSpeech);
  assert.equal(before.count, 0, "длинных нет");
  const fused = fuseShortSentencesForTail(withSpeech);
  assert.ok(fused.fused >= 1, "склейка обязана сработать");
  assert.ok(fused.share >= 0.12, `доля 25+ слов ${fused.share} — цель 0.12`);
  // Слова сохранены один в один (меняется только пунктуация и регистр союза).
  const wordsOfText = (text: string) =>
    (text.match(/[а-яёa-z]+(?:-[а-яёa-z]+)*/giu) ?? []).map((word) => word.toLowerCase()).sort();
  assert.deepEqual(wordsOfText(fused.text), wordsOfText(withSpeech), "ни одно слово не потеряно и не добавлено");
  // Реплики не тронуты.
  assert.ok(fused.text.includes("— Ты видел? — спросил Васька."), "реплика цела");
  assert.ok(fused.text.includes("— Видел, — коротко отозвался брат."), "реплика цела");
  // Штампов не добавляем.
  assert.ok(
    detectAiTells(fused.text).length <= detectAiTells(withSpeech).length,
    "склейка не плодит штампы",
  );
  // Короткий фрагмент — не трогаем (шум вместо ремонта).
  const tiny = fuseShortSentencesForTail("Он шагнул. Встал. Пошёл.");
  assert.equal(tiny.fused, 0, "три фразы склеивать не во что");
  assert.equal(tiny.text, "Он шагнул. Встал. Пошёл.");
});

test("speechMarkingRegressed ловит снос тире правкой (сборка 113)", () => {
  const marked = "— Слушай, — сказал Васька, усаживаясь на камень. — Пошли к реке, пока не стемнело, — ответил он.";
  const stripped = "Слушай, сказал Васька, усаживаясь на камень. Пошли к реке, пока не стемнело, ответил он.";
  assert.ok(speechMarkingRegressed(marked, stripped), "снятые тире — регресс");
  assert.ok(!speechMarkingRegressed(stripped, marked), "возврат тире — не регресс");
  assert.ok(!speechMarkingRegressed(marked, marked), "тот же текст — не регресс");
  assert.ok(
    !speechMarkingRegressed("Он шёл вдоль стены и считал шаги.", "Он шёл вдоль стены. Он считал шаги."),
    "без речи регресса нет",
  );
});

test("authorIdiolectBlock майнит словарь голоса из образца (сборка 113)", () => {
  const sample = [
    "Вечер пятницы не задался с самого начала. Стоя под козырьком остановки, Васька обдумывал ситуацию.",
    "Рюкзак давил на плечи, лямки врезались в кожу. До дома Ильи он добрался уже в сумерках.",
    "— Илюха, ты дома? — крикнул Васька, барабаня в дверь. — Васька, заходи, — ответил Илья.",
    "Рюкзак полетел в угол, Васька сбросил кроссовки. Блин, ну и денёк, подумал он.",
    "Илюха выглянул из кухни с полотенцем. Короче, рассказывай, сказал Илья, пододвигая табуретку.",
    "Васька ел молча. Рюкзак лежал у стены, напоминая о дороге через лес и горы.",
  ].join("\n");
  const block = authorIdiolectBlock(sample.repeat(4));
  assert.ok(block.includes("СЛОВАРЬ ГОЛОСА АВТОРА"), "заголовок блока");
  assert.ok(block.includes("васька"), "имя героя из образца");
  assert.ok(block.includes("рюкзак"), "характерное слово из образца");
  assert.equal(authorIdiolectBlock("Он шагнул. Встал."), "", "короткий образец — пусто");
  assert.equal(authorIdiolectBlock(""), "", "пустой образец — пусто");
});
