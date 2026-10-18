import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  extractYoMapFromSample,
  clearAuthorYoSample,
  restoreYo,
} from "../server/yoRestore.ts";
import {
  calibrateProseRegisterBounds,
  measureNoraGal,
  noraGalIssues,
  authorQuotePolicy,
  quotesDirective,
} from "../server/proseRegister.ts";
import {
  calibrateSegmentStyleBounds,
  aiTellScore,
  mineAuthorIdiolect,
  positiveVoiceFewShots,
  selectCrossFamilyRewriteModel,
} from "../server/humanStyle.ts";
import { buildRhythmBreakerPrompt } from "../server/humanStyleEnhanced.ts";
import {
  measureDialogueDifferentiation,
  dialogueSwapFinding,
  deterministicCriticism,
  CRITIC_QUESTIONS,
} from "../server/criticAgent.ts";
import {
  RARITY_MOVE_CATALOG,
  OBLIQUE_DIALOGUE_DIRECTIVE,
} from "../server/sepiaMoves.ts";
import {
  computeEditDiff,
  extractDeterministicLessons,
  recordAuthorEditLesson,
  learnedRulesPromptBlock,
} from "../server/agent/selfLearner.ts";
import {
  createAdaptiveProfile,
  extractExtendedAdaptiveFeatures,
  learnFromDetectorReport,
  scoreWithAdaptiveProfile,
} from "../src/lib/adaptiveDetector.ts";
import {
  buildCharacterNotes,
  buildScenePrompt,
} from "../server/chapterGenerate.ts";

describe("Variant 3 Humanization Upgrades", () => {
  it("extracts ё words from authorSample and restores them without touching homographs", () => {
    clearAuthorYoSample();
    const authorSample = "Чёрный клён шумел у решётки, а тёплый ветер нёс запах мёда и полыни.";
    const map = extractYoMapFromSample(authorSample);
    assert.equal(map["клен"], "клён");
    assert.equal(map["решетки"], "решётки");
    assert.equal(map["меда"], "мёда");

    const restored = restoreYo("Старый клен у решетки и запах меда. Все небо было чистым.", authorSample);
    assert.ok(restored.text.includes("клён"));
    assert.ok(restored.text.includes("решётки"));
    assert.ok(restored.text.includes("мёда"));
    // Homographs "Все" and "небо" must remain untouched
    assert.ok(restored.text.includes("Все небо"));
    clearAuthorYoSample();
  });

  it("calibrates proseRegister and segment style bounds dynamically from authorSample", () => {
    const defaultBounds = calibrateProseRegisterBounds();
    assert.equal(defaultBounds.bodilyLimit, 9);
    assert.equal(defaultBounds.filterLimit, 62);

    const filterHeavySample = Array.from({ length: 14 }, (_, idx) =>
      `Казалось, будто старый дом у пристани словно затаил дыхание перед бурей, и вроде бы ветер стих, но наверное в темноте всё ещё прятались тени (${idx}). ` +
      `Павел осторожно шагнул через порог, прислушиваясь к скрипу половиц, и подумал, что сегодня ему точно придётся остаться здесь до самого рассвета.`
    ).join("\n\n");

    const customBounds = calibrateProseRegisterBounds(filterHeavySample);
    assert.ok(customBounds.filterLimit > defaultBounds.filterLimit, "should raise filterLimit for filter-heavy author");

    const segBounds = calibrateSegmentStyleBounds(filterHeavySample);
    assert.ok(segBounds.openerShareLimit >= 0.16);
    assert.ok(segBounds.ttrLimit >= 0.83);
  });

  it("detects Nora Gal anti-patterns (genitive chains, verbal nouns, English calques)", () => {
    const bureaucraticText =
      "Процесс формирования ощущения безопасности привёл к появлению чувства тревоги. " +
      "Он взял секунду, чтобы собраться, и это имело смысл.";
    const metrics = measureNoraGal(bureaucraticText);
    assert.ok(metrics.genitiveChains >= 1, "should detect 3+ genitive chain");
    assert.ok(metrics.verbalNounClutter >= 1, "should detect verbal noun clutter");
    assert.ok(metrics.translationCalques >= 2, "should detect English translationese calques");

    const issues = noraGalIssues(bureaucraticText);
    assert.ok(issues.length >= 2);

    const tellScore = aiTellScore(bureaucraticText);
    assert.ok(tellScore.hits.some((h) => h.id.startsWith("nora-")));
  });

  it("adapts quote policy («…») dynamically to authorSample", () => {
    const noQuotesSample = Array.from({ length: 12 }, () =>
      "Он молча шагал по сырой траве вдоль старого забора и слушал ночной ветер."
    ).join(" ");
    assert.equal(authorQuotePolicy(noQuotesSample).allowQuotes, false);
    assert.ok(quotesDirective(noQuotesSample).includes("НЕ использовать вообще"));

    const quotesSample = Array.from({ length: 12 }, () =>
      "Он посмотрел на вывеску «Старый маяк» и вспомнил газету «Вечерний курьер»."
    ).join(" ");
    const policy = authorQuotePolicy(quotesSample);
    assert.equal(policy.allowQuotes, true);
    assert.ok(quotesDirective(quotesSample).includes("допустимы ТОЛЬКО"));
  });

  it("separates narrator markers from dialogue markers in mineAuthorIdiolect", () => {
    const sample =
      "Над рекой расстилался густой туман. Паромщик угрюмо смотрел на воду. Паромщик медленно курил трубку. Паромщик ждал рассвета.\n" +
      "— Короче, слушай меня внимательно! — крикнул Матвей.\n" +
      "— Короче, ничего я слушать не стану, — отрезал Илья.\n" +
      "— Короче, решайте сами, — махнул рукой старик.";
    const idiolect = mineAuthorIdiolect(sample);
    const narratorWords = idiolect.narratorMarkers.map((m) => m.word);
    const dialogueWords = idiolect.dialogueMarkers.map((m) => m.word);
    assert.ok(narratorWords.includes("паромщик"), "narratorMarkers should include 'паромщик'");
    assert.ok(!narratorWords.includes("короче"), "narratorMarkers must not leak dialogue-only 'короче'");
    assert.ok(dialogueWords.includes("короче"), "dialogueMarkers should capture 'короче'");
  });

  it("selects context-aware few-shot passages and guarantees a long-tail sentence", () => {
    const sample = [
      "В комнате стояла тишина, только старые ходики мерно стучали над дверью, отсчитывая секунды до полуночи.",
      "На улице моросил мелкий дождь, и редкие прохожие спешили укрыться под козырьками закрытых лавок.",
      "— Ты правда думаешь, что они вернутся до рассвета? — тихо спросила Вера, не поднимая глаз от чашки.\n— Если бы я знал, не сидел бы тут с фонарём у окна, — ответил Григорий и потёр замёрзшие пальцы.",
      "Он резко рванул тяжёлую железную скобу на себя, прыгнул через сгнивший порог прямо в мокрую глину и, пригибаясь под низкими ветками старой яблони, побежал к оврагу, где за чёрными кустами смородины уже мигал тусклый жёлтый фонарь сторожа.",
    ].join("\n\n");

    const shotsBlock = positiveVoiceFewShots(sample, 2, "острый спор и диалог на кухне");
    assert.ok(shotsBlock.includes("— Ты правда думаешь"), "should pick dialogue passage for dialogue beat");
    assert.ok(shotsBlock.includes("пригибаясь под низкими ветками старой яблони"), "should guarantee a long-tail paragraph");
  });

  it("eliminates staccato instructions in buildRhythmBreakerPrompt and selects cross-family rewrite models", () => {
    const prompt = buildRhythmBreakerPrompt("Тестовый абзац.", "", [0.5, 0.8]);
    assert.ok(!prompt.includes("очень короткое предложение (2–4 слова)"));
    assert.ok(prompt.includes("25–40 слов"));
    assert.ok(prompt.includes("НЕ добавляй новых рубленых стаккато-фраз"));

    const geminiAlt = selectCrossFamilyRewriteModel("gemini-2.5-flash");
    assert.equal(geminiAlt.family, "deepseek");

    const deepseekAlt = selectCrossFamilyRewriteModel("deepseek-ai/deepseek-v4-flash-0731");
    assert.equal(deepseekAlt.family, "gemini");
  });

  it("flags uniform cloned dialogue in Dialogue Swap Test (criticAgent)", () => {
    const clonedDialogue = [
      "— Я считаю, что мы должны немедленно отправиться в старый архив и проверить документы.",
      "— Я уверен, что нам следует сначала обсудить этот важный вопрос с нашим командиром.",
      "— Я полагаю, что без точной карты подземных переходов мы просто потеряем время.",
      "— Я думаю, что каждый из нас прекрасно понимает всю опасность сегодняшней вылазки.",
      "— Я знаю, что в северном крыле здания дежурит охрана со сторожевыми собаками.",
      "— Я надеюсь, что мы успеем вернуться на базу до начала утреннего обхода.",
    ].join("\n");

    const diff = measureDialogueDifferentiation(clonedDialogue);
    assert.equal(diff.undifferentiated, true);

    const finding = dialogueSwapFinding(clonedDialogue);
    assert.ok(finding !== null);
    assert.equal(finding!.id, "dialogue-swap");
    assert.ok(finding!.label.includes("тест подмены реплик"));

    const criticFindings = deterministicCriticism(clonedDialogue);
    assert.ok(criticFindings.some((f) => f.id === "dialogue-swap"));
    assert.ok(CRITIC_QUESTIONS.some((q) => q.includes("подтекст")));
  });

  it("includes oblique dialogue directives and character voice profiles in chapterGenerate prompts", () => {
    assert.ok(RARITY_MOVE_CATALOG.some((m) => m.id === "rarity:subtext"));
    assert.ok(OBLIQUE_DIALOGUE_DIRECTIVE.includes("ПОДТЕКСТ В ДИАЛОГАХ"));

    const input = {
      title: "Книга",
      genre: "проза",
      description: "Описание",
      currentChapterTitle: "Ночной разговор",
      currentChapterSummary: "Игнат чинит примус",
      previousChapter: "",
      worldBible: "",
      bookPlan: "",
      canonDossier: "",
      customPrompt: "",
      model: "gemini-2.5-flash",
      characters: [
        {
          id: "c1",
          name: "Игнат",
          role: "механик",
          description: "хмурый старик",
          traits: "упрямый",
          goals: "починить примус",
          voiceProfile: {
            speechRegister: "отрывистый, рубленый мастеровой говор",
            avgReplicaWords: 6,
            favoriteParticles: ["шайтан-труба", "едрить"],
            tabooWords: ["великолепно"],
            sampleLines: ["Ключ подай, не стой над душой."],
          },
        },
      ],
      codexEntries: [
        {
          id: "x1",
          type: "lore" as const,
          name: "Латунный ключ",
          description: "Ключ от старой водонапорной башни.",
          tags: ["ключ", "башня"],
          createdAt: "2026-01-01",
          updatedAt: "2026-01-01",
        },
      ],
      authorSample: Array.from({ length: 12 }, () =>
        "Он зашёл в мастерскую и молча положил тяжёлый гаечный ключ на старый деревянный верстак."
      ).join(" "),
    };

    const notes = buildCharacterNotes(input);
    assert.ok(notes.includes("Игнат"));
    assert.ok(notes.includes("шайтан-труба"));
    assert.ok(notes.includes("ПОДТЕКСТ В ДИАЛОГАХ"));

    const scenePrompt = buildScenePrompt(
      input,
      {
        title: "В мастерской",
        goal: "Игнат ищет Латунный ключ от башни и спорит с гостем.",
        hook: "запах керосина и Латунный ключ",
        endsWith: "Игнат выгоняет гостя",
      },
      0,
      4,
      "Он шагнул в дверь мастерской.",
      ""
    );
    assert.ok(scenePrompt.includes("Латунный ключ"));
    assert.ok(scenePrompt.includes("Кавычки-ёлочки «…» не ставь нигде"));
  });

  it("extracts deterministic selfLearner lessons from edits and computes 12D Mahalanobis adaptive score", () => {
    const before =
      "Он стоял у окна, чувствуя глубокую печаль и думая о том, что прошлое никогда не вернётся в этот старый дом на берегу.";
    const after =
      "Он стоял у окна, прижавшись лбом к стеклу и думая о том, что прошлое никогда не вернётся в этот старый дом на берегу.";
    const lessons = extractDeterministicLessons(computeEditDiff(before, after));
    assert.ok(lessons.length >= 1);

    const storyId = `test-story-${Date.now()}`;
    const saved = recordAuthorEditLesson(storyId, before, after);
    assert.ok(saved.length >= 1);
    const block = learnedRulesPromptBlock(storyId);
    assert.ok(block.includes("УРОКИ ИЗ ПРЕДЫДУЩИХ ПРАВОК АВТОРА"));

    const vec = extractExtendedAdaptiveFeatures(after);
    assert.equal(Object.keys(vec).length, 12);

    const humanSegmentText = Array.from({ length: 5 }, () =>
      "Старый клён за сараем глухо скрипел на ветру, и Павел долго искал в кармане промокшего ватника спички, " +
      "чтобы наконец поджечь бересту в железной печке и согреть озябшие на реке пальцы."
    ).join(" ");
    const aiSegmentText = Array.from({ length: 5 }, () =>
      "Процесс формирования ощущения безопасности привёл к появлению чувства тревоги. " +
      "Он стоял у окна, чувствуя глубокую печаль и понимая, что это меняет всё его будущее навсегда."
    ).join(" ");

    const learned = learnFromDetectorReport(createAdaptiveProfile(storyId), {
      time: "2026-10-19T00:00:00Z",
      filename: "test.json",
      short_text_warning: false,
      text_length: aiSegmentText.length + humanSegmentText.length + 1,
      fullText: `${aiSegmentText}\n${humanSegmentText}`,
      stats: {
        segments_count: 2,
        AI_count: 1,
        LIKELY_AI_count: 0,
        HUMAN_count: 1,
        LIKELY_HUMAN_count: 0,
      },
      segments: [
        {
          start: 0,
          end: aiSegmentText.length,
          len: aiSegmentText.length,
          label: "AI",
          text: aiSegmentText,
        },
        {
          start: aiSegmentText.length + 1,
          end: aiSegmentText.length + 1 + humanSegmentText.length,
          len: humanSegmentText.length,
          label: "HUMAN",
          text: humanSegmentText,
        },
      ],
    });
    assert.ok(learned.profile.humanExtended);
    assert.ok(learned.profile.aiExtended);
    assert.equal(learned.learnedHuman, 1);
    assert.equal(learned.learnedAi, 1);

    const humanScore = scoreWithAdaptiveProfile(humanSegmentText, learned.profile);
    const aiScore = scoreWithAdaptiveProfile(aiSegmentText, learned.profile);
    assert.ok(humanScore !== null && aiScore !== null);
    assert.ok(
      humanScore.humanProbability >= aiScore.humanProbability,
      `Expected humanProbability (${humanScore.humanProbability}) >= ai (${aiScore.humanProbability})`
    );
    assert.ok(typeof humanScore.mahalanobisHumanDistance === "number");
  });
});
