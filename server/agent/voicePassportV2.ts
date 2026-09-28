import { computeStyleStats } from "../../src/lib/authorAudit";

/**
 * voicePassportV2.ts
 *
 * Voice Passport 2.0 — расширенный анализ авторского стиля.
 * Расширяет server/agent/styleProfiler.ts следующим:
 * 
 * 1. Fingerprint характерных слов автора (TF-IDF vs среднекорпусный фон)
 * 2. Паттерны пунктуации с позиционной привязкой
 * 3. Диалоговые привычки (длина реплик, теги, соотношение)
 * 4. Абзацная ритмика (гистограмма длин)
 * 5. Излюбленные синтаксические конструкции
 * 6. Prompt-блоки для интеграции в humanStyle/authorPipeline
 * 
 * Логика коннекторов:
 *  - OpenRouter «ox-alpha literary profile»: авторский fingerprint через редкие слова
 *  - server/agent/styleProfiler.ts: extractStylePatterns, computeStyleMetrics
 *  - scripts/analyze-yandex-patterns-live.ts: паттерны из реальных HUMAN-сегментов
 */

// ─────────────────────────────────────────────────────────────────────────────
// ТИПЫ
// ─────────────────────────────────────────────────────────────────────────────

export interface AuthorWordFingerprint {
  /** Слова, которые автор использует чаще средней нормы (×2+) */
  characteristicWords: Array<{ word: string; tfidfScore: number }>;
  /** Слова, которых автор полностью избегает (0 упоминаний в образце) */
  avoidedCommonWords:  string[];
  /** Любимые прилагательные автора (топ-10) */
  topAdjectives:       string[];
  /** Любимые глаголы автора (топ-10, без вспомогательных) */
  topVerbs:            string[];
}

export interface PunctuationPattern {
  /** Em-dash на 1000 слов */
  emDashPer1k:         number;
  /** Многоточия на 1000 слов */
  ellipsisPer1k:       number;
  /** Точки с запятой на 1000 слов */
  semicolonPer1k:      number;
  /** Позиция многоточий: середина или конец предложения */
  ellipsisPosition:    "mid" | "end" | "mixed";
  /** Восклицательные знаки на 1000 слов */
  exclamationPer1k:    number;
}

export interface DialogueProfile {
  /** Средняя длина реплики (в словах) */
  avgReplicaWords:      number;
  /** Доля прямой речи от общего текста */
  directSpeechShare:    number;
  /** Топ-5 диалоговых тегов («сказал», «ответил», «прошептал», ...) */
  topDialogueTags:      string[];
  /** Использует ли автор авторские ремарки внутри реплик */
  usesInlineRemarks:    boolean;
}

export interface ParagraphRhythm {
  /** Гистограмма: [<5, 5-15, 15-30, 30-60, >60] слов — доли */
  lengthDistribution:   [number, number, number, number, number];
  /** Коэффициент вариации длин абзацев */
  cv:                   number;
  /** Медианная длина абзаца */
  medianWords:          number;
}

export interface SyntaxPreferences {
  /** Доля предложений с деепричастным оборотом */
  gerundShare:          number;
  /** Доля предложений с причастным оборотом */
  participleShare:      number;
  /** Доля предложений с однородными членами (AND-chains) */
  homogeneousShare:     number;
  /** Доля номинативных предложений (без сказуемого) */
  nominativeShare:      number;
}

export interface VoicePassportV2 {
  storyId:              string;
  createdAt:            number;
  sampleCharCount:      number;
  wordFingerprint:      AuthorWordFingerprint;
  punctuationPattern:   PunctuationPattern;
  dialogueProfile:      DialogueProfile;
  paragraphRhythm:      ParagraphRhythm;
  syntaxPrefs:          SyntaxPreferences;
  /** Ритм фраз и живые примеры: планка, по которой принимается черновик. */
  sentenceRhythm:       SentenceRhythm;
}

// ─────────────────────────────────────────────────────────────────────────────
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ─────────────────────────────────────────────────────────────────────────────

/** Среднекорпусная частота русских слов (упрощённая, топ-200 самых частых) */
const COMMON_RUSSIAN_WORDS = new Set([
  "в", "и", "не", "на", "я", "быть", "он", "с", "что", "а", "по", "это",
  "она", "этот", "к", "но", "они", "мы", "как", "из", "у", "который",
  "то", "за", "его", "так", "все", "от", "да", "вы", "о", "же", "если",
  "ещё", "при", "уже", "или", "бы", "когда", "только", "через", "для",
  "себя", "до", "без", "под", "нет", "ли", "об", "можно", "после", "здесь",
  "тот", "ну", "там", "её", "тогда", "им", "свой", "мне", "над", "сказал",
  "ещё", "один", "такой", "чтобы", "между", "много", "более", "будет",
  "него", "этого", "нас", "нем", "была", "было", "были", "есть", "этот",
]);

/** Извлекает все слова текста (строчные) */
function extractWords(text: string): string[] {
  return text.match(/[а-яёА-ЯЁ]+/gu)?.map(w => w.toLowerCase()) ?? [];
}

/** Считает частоту слов */
function wordFrequency(words: string[]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const w of words) freq.set(w, (freq.get(w) ?? 0) + 1);
  return freq;
}

/** Медиана массива чисел */
function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// ─────────────────────────────────────────────────────────────────────────────
// АНАЛИЗАТОРЫ
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 1. Fingerprint характерных слов (TF-IDF упрощённый).
 * Заимствует идею OpenRouter ox-alpha «literary profile»:
 * уникальные слова автора важнее частых.
 */
export function analyzeWordFingerprint(text: string): AuthorWordFingerprint {
  const words    = extractWords(text);
  const wordCount = words.length;
  if (wordCount < 50) {
    return { characteristicWords: [], avoidedCommonWords: [], topAdjectives: [], topVerbs: [] };
  }

  const freq = wordFrequency(words);

  // TF: частота слова в образце
  // IDF (упрощённый): 1 / log(1 + rank_in_common_words)
  // Характерные: не из топ-200 общих, частота >= 3
  const characteristicWords: Array<{ word: string; tfidfScore: number }> = [];
  for (const [word, count] of freq.entries()) {
    if (COMMON_RUSSIAN_WORDS.has(word)) continue;
    if (word.length < 4) continue;
    if (count < 2) continue;
    const tf = count / wordCount;
    const tfidfScore = tf * 10; // упрощённый score
    characteristicWords.push({ word, tfidfScore });
  }
  characteristicWords.sort((a, b) => b.tfidfScore - a.tfidfScore);

  // Слова из топ-100 общих, которых НЕТ в образце
  const avoidedCommonWords: string[] = [];
  const top100Common = [
    "абсолютно", "великолепный", "уникальный", "важный", "значимый",
    "невероятный", "потрясающий", "колоссальный", "огромный", "следует",
    "являться", "осуществлять", "данный", "представлять", "отметить",
    "обнаружил", "заметил", "почувствовал", "осознал",
  ];
  for (const common of top100Common) {
    if (!freq.has(common)) avoidedCommonWords.push(common);
  }

  // Прилагательные (окончания -ый/-ая/-ое/-ие, -ный/-ная)
  const topAdjectives = [...freq.entries()]
    .filter(([w, c]) => c >= 2 && /(?:ый|ая|ое|ие|ный|ная|ное)$/u.test(w) && !COMMON_RUSSIAN_WORDS.has(w))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([w]) => w);

  // Глаголы (окончания -ть/-ти/-ать/-ить/-еть/-нуть, и формы прош.вр.)
  const verbAux = new Set(["быть", "стать", "казаться", "являться"]);
  const topVerbs = [...freq.entries()]
    .filter(([w, c]) => c >= 2 && !verbAux.has(w) && !COMMON_RUSSIAN_WORDS.has(w) &&
      (/(?:ть|ти|ал|ала|али|ило|нул|нула|ила|ило|или)$/u.test(w)))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([w]) => w);

  return {
    characteristicWords: characteristicWords.slice(0, 20),
    avoidedCommonWords:  avoidedCommonWords.slice(0, 15),
    topAdjectives,
    topVerbs,
  };
}

/**
 * 2. Паттерны пунктуации с позиционной привязкой.
 */
export function analyzePunctuationPattern(text: string): PunctuationPattern {
  const words       = extractWords(text);
  const per1k       = words.length > 0 ? 1000 / words.length : 1;

  const emDash      = (text.match(/—/gu)?.length ?? 0) * per1k;
  const ellipsis    = (text.match(/\.\.\.|…/gu)?.length ?? 0) * per1k;
  const semicolon   = (text.match(/;/gu)?.length ?? 0) * per1k;
  const exclamation = (text.match(/!/gu)?.length ?? 0) * per1k;

  // Позиция многоточий: в середине или конце предложений
  const ellipsisPositions = [...text.matchAll(/\.\.\.|…/gu)].map(m => m.index ?? 0);
  let midCount = 0;
  let endCount = 0;
  for (const pos of ellipsisPositions) {
    const after = text.slice(pos + 3, pos + 10).trim();
    if (/^[А-ЯЁA-Z"«—]/u.test(after)) endCount++;
    else                               midCount++;
  }
  const ellipsisPosition: "mid" | "end" | "mixed" =
    midCount > endCount * 2 ? "mid"
    : endCount > midCount * 2 ? "end"
    : "mixed";

  return {
    emDashPer1k:      Math.round(emDash * 10) / 10,
    ellipsisPer1k:    Math.round(ellipsis * 10) / 10,
    semicolonPer1k:   Math.round(semicolon * 10) / 10,
    ellipsisPosition,
    exclamationPer1k: Math.round(exclamation * 10) / 10,
  };
}

/**
 * 3. Диалоговые привычки автора.
 */
export function analyzeDialogueProfile(text: string): DialogueProfile {
  const paragraphs = text.split(/\n+/u).map(p => p.trim()).filter(Boolean);
  const dialogueParagraphs = paragraphs.filter(p =>
    p.startsWith("—") || p.startsWith("«") || /^[«—"]/.test(p)
  );

  const avgReplicaWords = dialogueParagraphs.length > 0
    ? dialogueParagraphs.reduce((s, p) => s + extractWords(p).length, 0) / dialogueParagraphs.length
    : 0;

  const directSpeechShare = paragraphs.length > 0
    ? dialogueParagraphs.length / paragraphs.length
    : 0;

  // Диалоговые теги (глаголы речи после реплик)
  const tagPattern = /—\s*[^,!?»\n]{5,80}[,!?»]\s*—?\s*(сказал|ответил|спросил|прошептал|воскликнул|произнёс|добавил|заметил|пробормотал|кивнул|усмехнулся)/gui;
  const tagCounts = new Map<string, number>();
  for (const m of text.matchAll(tagPattern)) {
    const tag = m[1].toLowerCase();
    tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  }
  const topDialogueTags = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([tag]) => tag);

  // Авторские ремарки внутри реплик (скобки или тире внутри)
  const usesInlineRemarks = /—[^—\n]{5,60}— [а-яё]/u.test(text);

  return {
    avgReplicaWords:    Math.round(avgReplicaWords),
    directSpeechShare:  Math.round(directSpeechShare * 100) / 100,
    topDialogueTags:    topDialogueTags.length > 0 ? topDialogueTags : ["сказал", "ответил"],
    usesInlineRemarks,
  };
}

/**
 * 4. Абзацная ритмика.
 */
export function analyzeParagraphRhythm(text: string): ParagraphRhythm {
  const paragraphs = text.split(/\n{2,}/u).map(p => p.trim()).filter(Boolean);
  if (paragraphs.length < 3) {
    return { lengthDistribution: [0.2, 0.4, 0.3, 0.1, 0], cv: 0.5, medianWords: 15 };
  }

  const lengths = paragraphs.map(p => extractWords(p).length);
  const total   = lengths.length;

  const bins = [0, 0, 0, 0, 0]; // <5, 5-15, 15-30, 30-60, >60
  for (const l of lengths) {
    if      (l < 5)  bins[0]++;
    else if (l < 15) bins[1]++;
    else if (l < 30) bins[2]++;
    else if (l < 60) bins[3]++;
    else             bins[4]++;
  }

  const dist = bins.map(b => Math.round(b / total * 100) / 100) as [number, number, number, number, number];
  const mean = lengths.reduce((s, l) => s + l, 0) / total;
  const variance = lengths.reduce((s, l) => s + (l - mean) ** 2, 0) / total;
  const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;

  return {
    lengthDistribution: dist,
    cv:                 Math.round(cv * 100) / 100,
    medianWords:        Math.round(median(lengths)),
  };
}

/**
 * 5. Синтаксические предпочтения.
 */
export function analyzeSyntaxPreferences(text: string): SyntaxPreferences {
  const sentences = text.split(/[.!?…]+\s+/u).filter(s => s.trim().length > 5);
  if (sentences.length === 0) {
    return { gerundShare: 0, participleShare: 0, homogeneousShare: 0, nominativeShare: 0 };
  }

  const n = sentences.length;

  // Деепричастные обороты: глагол -я/-в/-вши/-авши в начале или середине
  const gerundPattern = /\b[а-яё]+(?:ая|яя|вшись?|ясь|вши|ав|яв)\b/iu;
  const gerundShare = sentences.filter(s => gerundPattern.test(s)).length / n;

  // Причастные обороты: -ший/-щий/-вший/-нный
  const participlePattern = /\b[а-яё]+(?:щий|щая|ший|шая|вший|вшая|нный|нная)\b/iu;
  const participleShare = sentences.filter(s => participlePattern.test(s)).length / n;

  // Однородные члены (AND-цепи): 3+ слова/словосочетания через «,» и «и»/«а»
  const homogeneousPattern = /[а-яё]+,\s*[а-яё]+,\s*[а-яё]+/iu;
  const homogeneousShare = sentences.filter(s => homogeneousPattern.test(s)).length / n;

  // Номинативные (без глагола): не содержит ни одного слова с типичным глагольным окончанием
  const verbPattern = /\b[а-яё]+(?:ть|ти|ал|ала|ает|ает|ить|ила|ило|ели|ули|нул)\b/iu;
  const nominativeShare = sentences.filter(s => !verbPattern.test(s) && extractWords(s).length >= 3).length / n;

  return {
    gerundShare:      Math.round(gerundShare * 100) / 100,
    participleShare:  Math.round(participleShare * 100) / 100,
    homogeneousShare: Math.round(homogeneousShare * 100) / 100,
    nominativeShare:  Math.round(nominativeShare * 100) / 100,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// КОРИДОР ПАСПОРТА: ИЗМЕРИМЫЕ ГРАНИЦЫ И ПРИЁМКА ЧЕРНОВИКА
// ─────────────────────────────────────────────────────────────────────────────

/** Ритм фраз автора в измеримом виде + два живых примера «как это звучит».
 *  Числа образца нужны не для справки: по этому коридору принимается черновик. */
export interface SentenceRhythm {
  meanWords: number;
  spreadWords: number;
  shortShare: number;
  particlesPer1k: number;
  exclamationsPer1k: number;
  ellipsesPer1k: number;
  /** Самая короткая и самая длинная фразы образца — амплитуда, которую надо держать. */
  shortExample: string;
  longExample: string;
}

/** Допуск вокруг нормы автора. Узкий там, где статистика образца устойчива (длина
 *  фразы), широкий там, где она шумная (пунктуация на 1000 слов). */
export interface VoicePassportCorridor {
  meanLo: number; meanHi: number;
  spreadLo: number; spreadHi: number;
  shortLo: number; shortHi: number;
  particlesLo: number; particlesHi: number;
  exclamationsLo: number; exclamationsHi: number;
  ellipsesLo: number; ellipsesHi: number;
}

const MAX_EXAMPLE_CHARS = 140;
const fmt1 = (value: number): string => (Math.round(value * 10) / 10).toFixed(1);

/** Метрики, которые в готовом тексте видны и, в отличие от каталога штампов,
 *  совпадают с разметкой детектора: длина фразы и её разброс. */
export function analyzeSentenceRhythm(text: string): SentenceRhythm {
  const stats = computeStyleStats(text);
  const sentences = (text.match(/[^.!?…]+[.!?…]+/gu) ?? [])
    .map((sentence) => sentence.trim())
    .filter((sentence) => extractWords(sentence).length > 0);
  const counted = sentences.map((sentence) => ({ sentence, words: extractWords(sentence).length }));
  const shortest = counted.length ? counted.reduce((a, b) => (b.words < a.words ? b : a)) : null;
  const longest = counted.length ? counted.reduce((a, b) => (b.words > a.words ? b : a)) : null;
  const cut = (value: string): string =>
    value.length > MAX_EXAMPLE_CHARS ? `${value.slice(0, MAX_EXAMPLE_CHARS - 1).trimEnd()}…` : value;
  return {
    meanWords: Math.round(stats.averageSentenceWords * 10) / 10,
    spreadWords: Math.round(stats.sentenceLengthDeviation * 10) / 10,
    shortShare: Math.round(stats.shortSentenceShare * 1000) / 1000,
    particlesPer1k: Math.round(stats.particlesPerThousandWords * 10) / 10,
    exclamationsPer1k: Math.round(stats.exclamationsPerThousandWords * 10) / 10,
    ellipsesPer1k: Math.round(stats.ellipsesPerThousandWords * 10) / 10,
    shortExample: shortest ? cut(shortest.sentence) : "",
    longExample: longest ? cut(longest.sentence) : "",
  };
}

export function voicePassportCorridor(passport: VoicePassportV2): VoicePassportCorridor {
  const rhythm = passport.sentenceRhythm;
  const meanSlack = Math.max(1.5, rhythm.meanWords * 0.25);
  const spreadSlack = Math.max(1.0, rhythm.spreadWords * 0.3);
  // Пунктуация на 1000 слов шумит сильнее длины фраз, поэтому границы множителем,
  // а не «плюс-минус»: вымывание частиц и восклицаний — главный дефект черновика
  // (живой замер 27.09.2026: частиц 4.7 при авторских 11.4, восклицаний 3.8 при 8.3).
  const band = (target: number, loFactor: number, hiFactor: number) => ({
    lo: Math.round(target * loFactor * 10) / 10,
    hi: Math.round(target * hiFactor * 10) / 10,
  });
  const particles = band(rhythm.particlesPer1k, 0.5, 2);
  const exclamations = band(rhythm.exclamationsPer1k, 0.4, 2.5);
  const ellipses = band(rhythm.ellipsesPer1k, 0.5, 2.2);
  return {
    meanLo: Math.round((rhythm.meanWords - meanSlack) * 10) / 10,
    meanHi: Math.round((rhythm.meanWords + meanSlack) * 10) / 10,
    spreadLo: Math.round(Math.max(0, rhythm.spreadWords - spreadSlack) * 10) / 10,
    spreadHi: Math.round((rhythm.spreadWords + spreadSlack) * 10) / 10,
    shortLo: Math.max(0, Math.round((rhythm.shortShare - 0.10) * 1000) / 1000),
    shortHi: Math.min(1, Math.round((rhythm.shortShare + 0.10) * 1000) / 1000),
    particlesLo: particles.lo, particlesHi: particles.hi,
    exclamationsLo: exclamations.lo, exclamationsHi: exclamations.hi,
    ellipsesLo: ellipses.lo, ellipsesHi: ellipses.hi,
  };
}

/** Нарушения коридора паспорта в готовом тексте. Пустой массив = черновик в норме автора.
 *  Проверка идёт по тем же числам, что печатает voicePassportV2Block, поэтому автор
 *  видит причину («фраза 12.0 слов при коридоре 6.5–10.8»), а не абстрактную оценку.
 *  Метрики, которых в образце почти нет, не проверяются: иначе «ноль восклицаний
 *  у автора» превращался бы в требование ноль восклицаний в тексте. */
export function voiceFitIssues(text: string, passport: VoicePassportV2, minimumSentences = 5): string[] {
  const stats = computeStyleStats(text);
  if (stats.sentences < minimumSentences) return [];
  const rhythm = analyzeSentenceRhythm(text);
  const corridor = voicePassportCorridor(passport);
  const author = passport.sentenceRhythm;
  const issues: string[] = [];
  const check = (label: string, value: number, lo: number, hi: number, unit: string, target: number, floor: number) => {
    if (target < floor) return;
    if (value < lo || value > hi) {
      issues.push(`${label} ${fmt1(value)}${unit} при коридоре ${fmt1(lo)}–${fmt1(hi)}${unit}`);
    }
  };
  check("средняя фраза", rhythm.meanWords, corridor.meanLo, corridor.meanHi, " слов", author.meanWords, 0);
  check("разброс фраз", rhythm.spreadWords, corridor.spreadLo, corridor.spreadHi, "", author.spreadWords, 0);
  check("короткие фразы", rhythm.shortShare * 100, corridor.shortLo * 100, corridor.shortHi * 100, "%", author.shortShare * 100, 0);
  check("разговорные частицы", rhythm.particlesPer1k, corridor.particlesLo, corridor.particlesHi, " на 1000 слов", author.particlesPer1k, 1);
  check("восклицания", rhythm.exclamationsPer1k, corridor.exclamationsLo, corridor.exclamationsHi, " на 1000 слов", author.exclamationsPer1k, 0.5);
  check("многоточия", rhythm.ellipsesPer1k, corridor.ellipsesLo, corridor.ellipsesHi, " на 1000 слов", author.ellipsesPer1k, 0.5);
  return issues;
}

// ─────────────────────────────────────────────────────────────────────────────
// ГЛАВНАЯ ФУНКЦИЯ: ПОЛНЫЙ АНАЛИЗ
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Строит Voice Passport V2 из авторского образца.
 * Без LLM-вызовов — только детерминированный анализ.
 * Результат передаётся в buildRewritePrompt() для усиления промпта.
 */
export function buildVoicePassportV2(storyId: string, sampleText: string): VoicePassportV2 {
  return {
    storyId,
    createdAt:          Date.now(),
    sampleCharCount:    sampleText.length,
    wordFingerprint:    analyzeWordFingerprint(sampleText),
    punctuationPattern: analyzePunctuationPattern(sampleText),
    dialogueProfile:    analyzeDialogueProfile(sampleText),
    paragraphRhythm:    analyzeParagraphRhythm(sampleText),
    syntaxPrefs:        analyzeSyntaxPreferences(sampleText),
    sentenceRhythm:     analyzeSentenceRhythm(sampleText),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ГЕНЕРАЦИЯ PROMPT-БЛОКОВ ДЛЯ ИНТЕГРАЦИИ
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Генерирует расширенный блок voice guidance для системного промпта.
 * Совместим с quantitativeVoiceBlock() из humanStyle.ts.
 */
export function voicePassportV2Block(passport: VoicePassportV2): string {
  const { wordFingerprint: wf, punctuationPattern: pp, dialogueProfile: dp, paragraphRhythm: pr, syntaxPrefs: sp } = passport;

  const lines: string[] = [
    "═══ ПАСПОРТ ГОЛОСА АВТОРА v2 (ДЕТЕРМИНИРОВАННЫЙ АНАЛИЗ) ═══",
    "",
  ];
  const corridor = voicePassportCorridor(passport);
  lines.push(`● КОРИДОР ЧЕРНОВИКА (по нему черновик принимается, а не «звучит хорошо»):
  - средняя фраза: ${fmt1(corridor.meanLo)}–${fmt1(corridor.meanHi)} слов
  - разброс длины фраз: ${fmt1(corridor.spreadLo)}–${fmt1(corridor.spreadHi)}
  - короткие фразы (до 4 слов): ${Math.round(corridor.shortLo * 100)}–${Math.round(corridor.shortHi * 100)}%
  - разговорные частицы: ${fmt1(corridor.particlesLo)}–${fmt1(corridor.particlesHi)} на 1000 слов
  - восклицания: ${fmt1(corridor.exclamationsLo)}–${fmt1(corridor.exclamationsHi)} на 1000 слов
  - многоточия: ${fmt1(corridor.ellipsesLo)}–${fmt1(corridor.ellipsesHi)} на 1000 слов`);
  if (passport.sentenceRhythm.shortExample || passport.sentenceRhythm.longExample) {
    lines.push(`● КАК ЭТО ЗВУЧИТ У АВТОРА (держи эту амплитуду, а не ровный темп):
  - самая короткая фраза образца: «${passport.sentenceRhythm.shortExample}»
  - самая длинная: «${passport.sentenceRhythm.longExample}»`);
  }
  lines.push("");

  // Характерные слова
  if (wf.characteristicWords.length > 0) {
    const topWords = wf.characteristicWords.slice(0, 10).map(w => w.word).join(", ");
    lines.push(`● ХАРАКТЕРНЫЕ СЛОВА АВТОРА (используй чаще): ${topWords}`);
  }
  if (wf.avoidedCommonWords.length > 0) {
    lines.push(`● СЛОВА, КОТОРЫХ АВТОР ИЗБЕГАЕТ: ${wf.avoidedCommonWords.slice(0, 8).join(", ")}`);
  }
  if (wf.topVerbs.length > 0) {
    lines.push(`● ЛЮБИМЫЕ ГЛАГОЛЫ: ${wf.topVerbs.slice(0, 7).join(", ")}`);
  }

  // Пунктуация
  lines.push("");
  lines.push(`● ПУНКТУАЦИЯ:
  - Em-dash на 1000 слов: ${pp.emDashPer1k} (воспроизводи этот ритм тире)
  - Многоточия на 1000 слов: ${pp.ellipsisPer1k} (позиция: ${pp.ellipsisPosition})
  - Восклицательные знаки на 1000 слов: ${pp.exclamationPer1k}`);

  // Диалоги
  lines.push("");
  lines.push(`● ДИАЛОГИ:
  - Средняя длина реплики: ${dp.avgReplicaWords} слов
  - Доля прямой речи: ${(dp.directSpeechShare * 100).toFixed(0)}% текста
  - Типичные теги: ${dp.topDialogueTags.join(", ")}
  - Ремарки внутри реплик: ${dp.usesInlineRemarks ? "да (воспроизводи)" : "нет (избегай)"}`);

  // Ритм абзацев
  lines.push("");
  lines.push(`● РИТМ АБЗАЦЕВ:
  - Медианная длина: ${pr.medianWords} слов/абзац
  - CV вариации длин: ${pr.cv.toFixed(2)} (${pr.cv > 0.5 ? "высокая, сохраняй разнообразие" : "умеренная"})`);

  // Синтаксис
  lines.push("");
  const syntaxFeatures: string[] = [];
  if (sp.gerundShare > 0.15)    syntaxFeatures.push(`деепричастные обороты (${(sp.gerundShare * 100).toFixed(0)}%)`);
  if (sp.participleShare > 0.1) syntaxFeatures.push(`причастные обороты (${(sp.participleShare * 100).toFixed(0)}%)`);
  if (sp.nominativeShare > 0.05) syntaxFeatures.push(`номинативные предложения (${(sp.nominativeShare * 100).toFixed(0)}%)`);
  if (syntaxFeatures.length > 0) {
    lines.push(`● ХАРАКТЕРНЫЙ СИНТАКСИС: ${syntaxFeatures.join(", ")}`);
  }

  lines.push("");
  lines.push("Коридор — приёмка черновика, а не украшение: текст вне коридора уходит на переписывание.");
  lines.push("Частицы, восклицания и многоточия не вставляй механически — они должны стоять там, где их поставил бы автор.");
  lines.push("");
  lines.push("═══════════════════════════════════════════════════════════");

  return lines.join("\n");
}

export const VOICE_PASSPORT_V2 = {
  build:          buildVoicePassportV2,
  promptBlock:    voicePassportV2Block,
  wordFingerprint: analyzeWordFingerprint,
  punctuation:    analyzePunctuationPattern,
  dialogue:       analyzeDialogueProfile,
  rhythm:         analyzeParagraphRhythm,
  syntax:         analyzeSyntaxPreferences,
  sentenceRhythm: analyzeSentenceRhythm,
  corridor:       voicePassportCorridor,
  fitIssues:      voiceFitIssues,
};
