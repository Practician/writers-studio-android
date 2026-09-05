/**
 * humanStyleEnhanced.ts
 * 
 * РАСШИРЕНИЕ server/humanStyle.ts — drop-in улучшения системы очеловечивания.
 * 
 * Логика и навыки, заимствованные из коннекторов Writers Studio:
 *  - OpenRouter (ox-alpha, deepseek): подходы к «stealth» генерации и literary profile
 *  - NVIDIA NIM (nemotron-4-340b): техники контроля ритма и темпа нарратива
 *  - Groq (llama-3.3-70b): низкая предсказуемость токенов, diversity sampling
 *  - Yandex Detector: обратная инженерия из LOO-калибровки (src/data/labyrinth/adaptive-detector-seed.ts)
 * 
 * НЕ подключается к приложению напрямую. Все экспорты — чистые функции,
 * совместимые с интерфейсами server/humanStyle.ts.
 */

import type { AiTellPattern, AiTellCategory } from "./humanStyle";

// ─────────────────────────────────────────────────────────────────────────────
// БЛОК A: РАСШИРЕННЫЙ КАТАЛОГ (+50 паттернов к существующим 80+)
// Источники: smixs/humanizer-ru 1.2, Aboudjem-43, harshaneel-9-levers,
// ручной анализ главы 7 «Лабиринт» (Yandex AI-сегменты 2026-07)
// ─────────────────────────────────────────────────────────────────────────────

export const AI_TELL_CATALOG_EXTENDED: AiTellPattern[] = [

  // ── НОВАЯ КАТЕГОРИЯ: temporal fillers (временны́е вводные) ─────────────────
  { id: "proshlo-mgnovenie",       category: "lexical",      pattern: /прошло (?:несколько |долгих |долгое |мучительное )?мгновени/iu,  label: "«прошло мгновение»",          weight: 2 },
  { id: "minuty-tyanutsia",        category: "lexical",      pattern: /минуты тянул[ио]сь как/iu,                                        label: "«минуты тянулись как»",        weight: 3 },
  { id: "kazalos-vechnostyu",      category: "lexical",      pattern: /казало[сь]+ (?:целой )?вечностью/iu,                              label: "«казалось вечностью»",          weight: 2 },
  { id: "dolgo-molchal",          category: "structural",   pattern: /(?:долго |несколько секунд )?молч[ал]{2}[аои]?[,.](?:\s|$)/iu,   label: "«долго молчал» пауза-клише",    weight: 2 },
  { id: "v-tishine-komnaty",       category: "sensational",  pattern: /в тишине (?:комнаты|зала|коридора|помещения)/iu,                  label: "«в тишине комнаты»",            weight: 2 },

  // ── emotion-naming (называние вместо показа) ──────────────────────────────
  { id: "prochuvstvoval-priliw",   category: "sensational",  pattern: /(?:почувствовал|ощутил)[ао]? прилив/iu,                           label: "«почувствовал прилив»",         weight: 3 },
  { id: "strannuyu-smes",          category: "sensational",  pattern: /(?:испытал|ощутил|почувствовал)[аои]? странную смесь/iu,           label: "«испытал странную смесь»",      weight: 3 },
  { id: "nakhlynulo-chuvstvo",     category: "sensational",  pattern: /нахлынуло (?:чувство|ощущение)/iu,                               label: "«нахлынуло чувство»",           weight: 2 },
  { id: "chuvstvo-pустоты",        category: "sensational",  pattern: /чувство (?:пустоты|потерянности|одиночества) (?:охватило|наполнило)/iu, label: "шаблон чувства пустоты", weight: 2 },
  { id: "ego-охватил-uzhas",       category: "sensational",  pattern: /(?:его|её|меня|нас) охватил[ао]? (?:ужас|страх|паника|тревога)/iu, label: "«охватил ужас»",              weight: 3 },
  { id: "vnutri-chego-to",         category: "sensational",  pattern: /(?:где-то )?внутри (?:него|неё|меня|нас) что-то/iu,               label: "«внутри что-то» (тело-рефлекс)", weight: 2 },

  // ── body-tells (тело как детектор эмоций) ────────────────────────────────
  { id: "ruki-neproisvolno",       category: "sensational",  pattern: /руки (?:непроизвольно|сами) (?:сжались|разжались|дрожали)/iu,    label: "непроизвольное сжатие кулаков", weight: 3 },
  { id: "koleni-podognulis",       category: "sensational",  pattern: /колени (?:подогнулись|подкосились|стали ватными)/iu,              label: "«колени подогнулись»",          weight: 3 },
  { id: "dykhanije-uchashchilos",  category: "sensational",  pattern: /дыхание (?:участилось|сперло|перехватило|остановилось)/iu,        label: "дыхание-клише",                 weight: 2 },
  { id: "gorlo-szhalos",           category: "sensational",  pattern: /(?:горло|глотка) (?:сжало[сь]|сдавило|пересохло)/iu,             label: "«горло сжалось»",               weight: 2 },
  { id: "visok-zastuchal",         category: "sensational",  pattern: /виск(?:и|а) (?:застучали|стучали|пульсировали)/iu,               label: "«виски застучали»",             weight: 2 },
  { id: "nogi-sami-poshli",        category: "sensational",  pattern: /ноги (?:сами (?:понесли|пошли|двинулись)|отказывали)/iu,          label: "«ноги сами понесли»",           weight: 2 },

  // ── transition clichés ────────────────────────────────────────────────────
  { id: "mezhdu-tem",              category: "bureaucratic", pattern: /(?:^|[.!?]\s+)Между тем\b/u,                                     label: "нарративный «Между тем»",       weight: 2 },
  { id: "tem-vremenem",            category: "bureaucratic", pattern: /(?:^|[.!?]\s+)Тем временем\b/u,                                  label: "нарративный «Тем временем»",    weight: 2 },
  { id: "vmeste-s-tem",            category: "bureaucratic", pattern: /вместе с тем\b/iu,                                               label: "«вместе с тем»",                weight: 2 },
  { id: "v-to-zhe-mgnovenie",      category: "structural",   pattern: /в то (?:самое |же )?мгновение/iu,                                label: "«в то же мгновение»",           weight: 2 },
  { id: "ne-daleko-ot",            category: "structural",   pattern: /(?:^|[.!?…]\s+)Неподалёку\b|неподалеку от/iu,                   label: "нарративный «Неподалёку»",      weight: 1 },

  // ── LLM hedging (самоограничение ИИ в тексте) ────────────────────────────
  { id: "mozhno-predpolozhit",     category: "rlhf",         pattern: /можно (?:с уверенностью )?предположить/iu,                       label: "«можно предположить»",          weight: 2 },
  { id: "veroyatno-stoit",         category: "rlhf",         pattern: /вероятно(?:,)? стоит отметить/iu,                               label: "«вероятно стоит отметить»",     weight: 3 },
  { id: "lyubopytnyy-fakt",        category: "rlhf",         pattern: /любопытн(?:ый|ый факт)/iu,                                      label: "«любопытный факт»",             weight: 2 },
  { id: "nesmotria-na-eto",        category: "rlhf",         pattern: /(?:^|[.!?]\s+)Несмотря на (?:это|всё|всё это)/u,                label: "зачин «Несмотря на это»",       weight: 2 },
  { id: "chto-kasaetsya",          category: "rlhf",         pattern: /что касается\b/iu,                                              label: "«что касается»",                weight: 1 },

  // ── English leaks в русском тексте ────────────────────────────────────────
  { id: "english-the-leak",        category: "interface",    pattern: /(?<!\w)the\s+[a-zA-Z]/u,                                        label: "английский артикль the в русском тексте", weight: 2 },
  { id: "english-and-but",         category: "interface",    pattern: /(?<!\w)(?:and|but|so|also|however)\s+[a-zA-Z]/u,                label: "английские союзы в русском тексте", weight: 2 },
  { id: "etc-abbrev",              category: "interface",    pattern: /\betc\.|i\.e\.|e\.g\./u,                                        label: "латинские сокращения etc./i.e.", weight: 1 },

  // ── repetition chains (анафора-клише) ────────────────────────────────────
  { id: "on-on-on-chain",          category: "structural",
    pattern: /(?:^|[.!?…]\s+)(?:Он|Она|Они|Оно) [^.!?]{3,80}[.!?]\s+(?:Он|Она|Они|Оно) [^.!?]{3,80}[.!?]\s+(?:Он|Она|Они|Оно)\b/u,
    label: "три предложения подряд с одним подлежащим «Он/Она»", weight: 3 },
  { id: "ya-ya-ya-chain",          category: "structural",
    pattern: /(?:^|[.!?…]\s+)Я [^.!?]{3,80}[.!?]\s+Я [^.!?]{3,80}[.!?]\s+Я\b/u,
    label: "три «Я»-предложения подряд", weight: 2 },

  // ── false profundity (псевдофилософия) ────────────────────────────────────
  { id: "v-glubine-dushi",         category: "lexical",      pattern: /в глубине (?:души|сердца|себя) (?:знал|знала|понимал|чувствовал)/iu, label: "«в глубине души знал»",    weight: 3 },
  { id: "na-samom-dele",           category: "structural",   pattern: /(?:но )?на самом деле всё (?:было |оказалось )?иначе/iu,          label: "«на самом деле всё иначе»", weight: 3 },
  { id: "pravda-byla-prosta",      category: "structural",   pattern: /правда (?:же )?была проста\b/iu,                                  label: "«правда была проста»",       weight: 3 },
  { id: "vo-vsyom-vinom",          category: "rlhf",         pattern: /во всём (?:был |была )?виноват[а]?\b/iu,                         label: "«во всём виноват»",          weight: 2 },
  { id: "odin-v-etom-mire",        category: "rlhf",         pattern: /один(?:а)? (?:во всём мире|в этом мире|среди всех)/iu,            label: "«один в этом мире»",         weight: 2 },

  // ── sensory inventory (инвентарь локации) ─────────────────────────────────
  { id: "zapakh-tleniya",          category: "sensational",  pattern: /запах (?:тлени|гнили|сырости|застоявш)/iu,                       label: "клишейный запах локации",    weight: 1 },
  { id: "tikhiy-zvon-v-ushakh",    category: "sensational",  pattern: /(?:тихий )?звон (?:в ушах|в голове)/iu,                         label: "«звон в ушах»",              weight: 2 },
  { id: "svet-bil-tuskly",         category: "sensational",  pattern: /свет (?:был )?(?:тусклым|слабым|мерцал|дрожал)/iu,              label: "клишейный свет локации",     weight: 1 },

  // ── narrative meta-tells (нарративная мета) ──────────────────────────────
  { id: "etot-moment-izmenil",     category: "structural",   pattern: /(?:этот|тот) момент (?:навсегда )?изменил/iu,                    label: "«этот момент изменил»",      weight: 3 },
  { id: "nikogda-ne-zabуду",       category: "rlhf",         pattern: /(?:я )?никогда (?:не )?забуд[у]/iu,                              label: "«никогда не забуду»",         weight: 2 },
  { id: "zhizn-uzhe-ne-budet",     category: "structural",   pattern: /жизнь (?:уже )?(?:никогда )?не буд(?:ет|ет прежней)/iu,         label: "«жизнь не будет прежней»",   weight: 3 },
  { id: "vse-tochno-znal",         category: "rlhf",         pattern: /(?:всё|он|она) (?:вдруг )?(?:точно |ясно )?понял[ао]?,? что (?:именно )?так и есть/iu, label: "ложная уверенность «точно знал»", weight: 2 },

  // ── connector logic (из OpenRouter ox-alpha literary profile research) ─────
  // Ox Alpha / stealth-модели избегают конструкций, которые детекторы ловят через bigrams
  { id: "chego-stoit-ozhidat",     category: "rlhf",         pattern: /чего стоит (?:ожидать|ждать) от/iu,                              label: "лекторское «чего стоит ожидать»", weight: 2 },
  { id: "stalo-ochevidno",         category: "rlhf",         pattern: /(?:стало|было) (?:очевидно|ясно|понятно),? что\b/iu,             label: "«стало очевидно, что»",       weight: 2 },
  { id: "nichego-ne-ostalos",      category: "structural",   pattern: /не осталось (?:ничего|выбора|пути|надежды|шанса)/iu,              label: "«не осталось выбора»",        weight: 2 },

  // ── DeepSeek V3/V4 prose tells (из OpenRouter research 2026-08) ─────────
  { id: "nachalo-novoy-ery",       category: "bureaucratic", pattern: /начало новой эр[ыа]|новая глава (?:в|истории)/iu,                label: "«начало новой эры»",          weight: 3 },
  { id: "nevozmozhnoe-vozmozhno",  category: "structural",   pattern: /(?:невозможное|невозможно) (?:стало|оказалось) (?:возможным|реальным)/iu, label: "«невозможное стало возможным»", weight: 3 },
  { id: "sila-voli",               category: "sensational",  pattern: /(?:силой|усилием) воли\b/iu,                                    label: "«силой воли»",                weight: 2 },
];

// ─────────────────────────────────────────────────────────────────────────────
// БЛОК B: КОНТЕКСТНО-ЗАВИСИМЫЕ ВЕСА ПАТТЕРНОВ
// Логика заимствована из подхода OpenRouter literary-profile (разные модели
// хуже/лучше для разных жанров; вес штампа зависит от контекста)
// ─────────────────────────────────────────────────────────────────────────────

export type GenreContext = "fantasy" | "scifi" | "thriller" | "romance" | "literary" | "horror" | "general";

/** 
 * Мультипликаторы веса паттерна по жанру.
 * В фэнтези некоторые «воздух сгустился» — норма; в реализме — AI-штамп.
 */
const GENRE_WEIGHT_MULTIPLIERS: Record<string, Partial<Record<GenreContext, number>>> = {
  "vozdukh-sgustilsya":    { fantasy: 0.3, horror: 0.5, literary: 1.5, general: 1.0 },
  "vremya-zamerlo":        { fantasy: 0.5, thriller: 0.7, literary: 1.5, general: 1.0 },
  "kholodok-po-spine":     { horror: 0.4, thriller: 0.6, literary: 1.8, romance: 0.7, general: 1.0 },
  "grobovaya-tishina":     { horror: 0.3, thriller: 0.5, literary: 1.5, general: 1.0 },
  "edinstvennyi-yakor":    { romance: 0.6, fantasy: 0.7, literary: 1.5, general: 1.0 },
  "ruki-neproisvolno":     { thriller: 0.5, horror: 0.5, literary: 1.5, general: 1.0 },
  "v-glubine-dushi":       { romance: 0.5, fantasy: 0.6, literary: 1.8, general: 1.0 },
};

/**
 * Позиционная коррекция: штамп в начале главы (первые 500 зн.) весит ×1.5.
 * AI чаще начинает с клише, устанавливая «атмосферу».
 */
function positionalMultiplier(matchIndex: number, textLength: number): number {
  if (textLength < 200) return 1.0;
  const position = matchIndex / textLength;
  // Первые 15% текста: ×1.5; последние 10% (концовка): ×1.3
  if (position < 0.15) return 1.5;
  if (position > 0.9)  return 1.3;
  return 1.0;
}

/**
 * Плотностная деградация: если паттернов много, не штрафуем каждый одинаково.
 * Предотвращает over-flagging при плотном AI-тексте.
 */
function densityDegradation(patternCount: number): number {
  if (patternCount <= 3) return 1.0;
  if (patternCount <= 7) return 0.85;
  if (patternCount <= 12) return 0.7;
  return 0.55;
}

export interface EnhancedTellHit {
  id: string;
  label: string;
  category: AiTellCategory;
  match: string;
  index: number;
  rawWeight: number;
  adjustedWeight: number;
  genre?: GenreContext;
}

/**
 * Расширенный детектор AI-tells с контекстно-зависимыми весами.
 * Совместим с detectAiTells() из humanStyle.ts, но добавляет
 * positional adjustment и genre modifiers.
 */
export function detectAiTellsEnhanced(
  text: string,
  allPatterns: AiTellPattern[],
  genre: GenreContext = "general",
): EnhancedTellHit[] {
  const hits: EnhancedTellHit[] = [];

  for (const pat of allPatterns) {
    const globalPattern = new RegExp(
      pat.pattern.source,
      pat.pattern.flags.includes("g") ? pat.pattern.flags : pat.pattern.flags + "g",
    );
    for (const match of text.matchAll(globalPattern)) {
      const idx = match.index ?? 0;
      const genreMult = GENRE_WEIGHT_MULTIPLIERS[pat.id]?.[genre] ?? 1.0;
      const posMult = positionalMultiplier(idx, text.length);
      hits.push({
        id: pat.id,
        label: pat.label,
        category: pat.category,
        match: match[0],
        index: idx,
        rawWeight: pat.weight,
        adjustedWeight: pat.weight * genreMult * posMult,
        genre,
      });
    }
  }

  hits.sort((a, b) => a.index - b.index);

  // Применяем плотностную деградацию глобально
  const degradation = densityDegradation(hits.length);
  for (const hit of hits) {
    hit.adjustedWeight *= degradation;
  }

  return hits;
}

/**
 * Итоговый AI-tell score с учётом контекста.
 * Замена aiTellScore() из humanStyle.ts — обратно совместима.
 */
export function aiTellScoreEnhanced(
  text: string,
  allPatterns: AiTellPattern[],
  genre: GenreContext = "general",
): number {
  const hits = detectAiTellsEnhanced(text, allPatterns, genre);
  const words = text.split(/\s+/u).filter(Boolean).length;
  if (words === 0) return 0;
  const totalWeight = hits.reduce((sum, h) => sum + h.adjustedWeight, 0);
  return Math.round(Math.min(100, (totalWeight / words) * 1000 * 4));
}

// ─────────────────────────────────────────────────────────────────────────────
// БЛОК C: 4 НОВЫЕ МЕТРИКИ СТИЛЯ (расширение AdaptiveFeature)
// Заимствованы из styleProfiler.ts (server/agent/styleProfiler.ts)
// и подхода NVIDIA NIM к оценке ритма нарратива
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Коэффициент вариации длин абзацев (paragraphLengthCV).
 * AI генерирует абзацы равной длины — CV будет близко к 0.
 * Человек — CV > 0.5.
 */
export function paragraphLengthCV(text: string): number {
  const paragraphs = text.split(/\n{2,}/u).map(p => p.trim()).filter(Boolean);
  if (paragraphs.length < 3) return 1; // мало данных — не штрафуем
  const lengths = paragraphs.map(p => p.split(/\s+/u).filter(Boolean).length);
  const mean = lengths.reduce((s, l) => s + l, 0) / lengths.length;
  if (mean === 0) return 0;
  const variance = lengths.reduce((s, l) => s + (l - mean) ** 2, 0) / lengths.length;
  return Math.sqrt(variance) / mean;
}

/**
 * Доля предложений в пассивном залоге (passiveVoiceShare).
 * Признак: глагол «быть/стать» + краткое/полное причастие на -н/-т.
 * AI злоупотребляет пассивом. Норма для художественной прозы: < 12%.
 */
export function passiveVoiceShare(text: string): number {
  const sentences = text.split(/[.!?…]+\s+/u).filter(s => s.trim().length > 0);
  if (sentences.length === 0) return 0;
  const passivePattern = /(?<![\p{L}\p{N}])(?:был[аои]?|было|были|является|стало)\s+[а-яё]+(?:[нт][аоыеи]?|[нт]ым|[нт]ой|[нт]ых|[нт]ому|[нт])(?![\p{L}\p{N}])/iu;
  const passiveCount = sentences.filter(s => passivePattern.test(s)).length;
  return passiveCount / sentences.length;
}

/**
 * Type-Token Ratio на скользящем окне 200 слов (uniqueWordRatio200).
 * AI повторяет ограниченный словарь. Норма > 0.6 в художественной прозе.
 * Метрика: среднее TTR по окнам.
 */
export function uniqueWordRatio200(text: string): number {
  const words = text.match(/[\p{L}\p{N}]+/giu) ?? [];
  if (words.length < 50) return 1;
  const windowSize = Math.min(200, words.length);
  const step = Math.max(1, Math.floor(windowSize / 2));
  const ttrs: number[] = [];
  for (let i = 0; i + windowSize <= words.length; i += step) {
    const window = words.slice(i, i + windowSize).map(w => w.toLowerCase());
    const unique = new Set(window);
    ttrs.push(unique.size / window.length);
  }
  return ttrs.length > 0
    ? ttrs.reduce((s, t) => s + t, 0) / ttrs.length
    : 1;
}

/**
 * Diversity коннекторов (connectorDiversity).
 * AI циклично чередует «однако», «тем не менее», «вместе с тем».
 * Метрика: unique_connectors / total_connector_uses (выше = лучше).
 */
export function connectorDiversity(text: string): number {
  const connectorPattern = /(?<![\p{L}\p{N}])(?:однако|тем не менее|вместе с тем|несмотря на|в то же время|при этом|кроме того|с другой стороны|впрочем|между тем|тем временем|в связи с этим|следует отметить|стоит подчеркнуть)(?![\p{L}\p{N}])/giu;
  const matches = [...text.matchAll(connectorPattern)];
  if (matches.length === 0) return 1;
  const unique = new Set(matches.map(m => m[0].toLowerCase()));
  return unique.size / matches.length;
}

export interface ExtendedStyleMetrics {
  // Существующие 8 метрик (из adaptiveDetector.ts) — передаются как есть
  averageSentenceWords: number;
  sentenceLengthDeviation: number;
  shortSentenceShare: number;
  exclamationsPerThousandWords: number;
  ellipsesPerThousandWords: number;
  dialogueLineShare: number;
  particlesPerThousandWords: number;
  similesPerThousandWords: number;
  // Новые 4 метрики
  paragraphLengthCV: number;
  passiveVoiceShare: number;
  uniqueWordRatio200: number;
  connectorDiversity: number;
}

/**
 * Вычисляет расширенный вектор стиля из текста.
 * Требует передачи результата computeStyleStats() для совместимости.
 */
export function computeExtendedMetrics(
  text: string,
  baseMetrics: Record<string, number>,
): ExtendedStyleMetrics {
  return {
    // Базовые метрики из authorAudit.computeStyleStats()
    averageSentenceWords:         baseMetrics.averageSentenceWords ?? 0,
    sentenceLengthDeviation:      baseMetrics.sentenceLengthDeviation ?? 0,
    shortSentenceShare:           baseMetrics.shortSentenceShare ?? 0,
    exclamationsPerThousandWords: baseMetrics.exclamationsPerThousandWords ?? 0,
    ellipsesPerThousandWords:     baseMetrics.ellipsesPerThousandWords ?? 0,
    dialogueLineShare:            baseMetrics.dialogueLineShare ?? 0,
    particlesPerThousandWords:    baseMetrics.particlesPerThousandWords ?? 0,
    similesPerThousandWords:      baseMetrics.similesPerThousandWords ?? 0,
    // Новые 4 метрики
    paragraphLengthCV:            paragraphLengthCV(text),
    passiveVoiceShare:            passiveVoiceShare(text),
    uniqueWordRatio200:           uniqueWordRatio200(text),
    connectorDiversity:           connectorDiversity(text),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// БЛОК D: 3-ФАЗНЫЙ HUMANIZER PIPELINE
// Логика заимствована из:
//  - server/chapterGenerate.ts (humanizeProseDraft, rewriteDetectorAiSegments)
//  - server/agent/selfLearner.ts (editPattern analysis)
//  - NVIDIA NIM: rhythm control через prompt engineering
//  - Groq llama-3.3-70b: diversity sampling (топ-p=0.95, top-k=40)
// ─────────────────────────────────────────────────────────────────────────────

export interface HumanizerPhaseConfig {
  /** Целевые модели LLM для каждой фазы. Берутся из llmProvider.ts. */
  phase1Model: string; // rhythm-breaker
  phase2Model: string; // lexical-diversifier
  phase3Model: string; // micro-imperfections
  /** Максимальное число итераций gate-check */
  maxGateIterations: number;
  /** Порог AI-tell score для прохождения gate */
  gateScoreThreshold: number;
  genre: GenreContext;
}

export const DEFAULT_HUMANIZER_CONFIG: HumanizerPhaseConfig = {
  phase1Model:          "gemini-2.5-flash",
  phase2Model:          "deepseek/deepseek-v3.2",   // из OpenRouter research
  phase3Model:          "gemini-2.5-flash",
  maxGateIterations:    3,
  gateScoreThreshold:   15,
  genre:                "general",
};

/**
 * ФАЗА 1: Rhythm Breaker
 * 
 * Цель: разбить монотонные серии предложений одной длины.
 * 
 * Логика коннектора NVIDIA NIM (nemotron-4-340b):
 * Модель лучше справляется с ритмом, когда промпт явно указывает
 * target буrstiness-диапазон вместо абстрактного «разнообрази ритм».
 */
export function buildRhythmBreakerPrompt(
  text: string,
  voiceGuidance: string,
  targetBurstiness: [number, number] = [0.45, 0.75],
): string {
  return `Ты — опытный редактор художественной прозы. Тебе дан текст с монотонным ритмом.

ЗАДАЧА ФАЗЫ 1 — ТОЛЬКО ритм. НЕ меняй:
- смысл, факты, имена, топонимы
- диалоги и реплики персонажей
- порядок событий

ЧТО МЕНЯТЬ:
1. Разбей или объедини предложения, чтобы длинные чередовались с короткими
2. Целевой диапазон burstiness (std/mean длин предложений): ${targetBurstiness[0].toFixed(2)}–${targetBurstiness[1].toFixed(2)}
3. Если идут 3+ предложения одинаковой длины — разбей или объедини
4. Вставь 1–2 очень коротких «стаккато» предложения в напряжённых местах
5. Длинные описания разрежь парентетикой или диалоговой вставкой

${voiceGuidance ? `ГОЛОС АВТОРА:\n${voiceGuidance}\n` : ""}

ТЕКСТ:
${text}

Верни ТОЛЬКО переработанный текст. Без комментариев.`;
}

/**
 * ФАЗА 2: Lexical Diversifier
 * 
 * Логика коннектора DeepSeek V3.2 (из OpenRouter research 2026-08):
 * Эта модель хорошо справляется с синонимизацией при указании
 * «лексических зон запрета» и частиц разговорного регистра.
 */
export function buildLexicalDiversifierPrompt(
  text: string,
  authorSample: string,
  negativeProfile: string[],
  hitLabels: string[],
): string {
  const forbiddenVerbs = [
    "обнаружил", "заметил", "почувствовал", "осознал", "понял",
    "произнёс", "прошептал", "воскликнул", "уставился", "окинул взглядом",
  ];
  const targetParticles = ["же", "ведь", "вон", "ну", "мол", "-то", "-ка", "что ли", "дескать"];
  
  const foundTells = hitLabels.slice(0, 5).join("; ");

  return `Ты — редактор, специализирующийся на замене AI-клише живым авторским языком.

ЗАДАЧА ФАЗЫ 2 — ТОЛЬКО лексика. НЕ меняй ритм (он уже отредактирован на фазе 1).

НАЙДЕННЫЕ AI-ШТАМПЫ В ТЕКСТЕ: ${foundTells || "нет данных"}.

ЧТО МЕНЯТЬ:
1. Замени «глаголы восприятия» (${forbiddenVerbs.slice(0, 4).join(", ")}…) на КОНКРЕТНЫЕ действия:
   - "заметил нож" → "нож лежал поперёк стола"
   - "почувствовал страх" → "пальцы застыли на дверной ручке"
   - "осознал, что опоздал" → "часы показывали четыре; поезд ушёл в три"

2. Добавь разговорные частицы там, где это естественно: ${targetParticles.join(", ")}

3. Замени абстрактные эмоции на физические проявления (Show, Don't Tell)

4. Убери конструкции из «негативного профиля»: ${negativeProfile.slice(0, 5).join("; ")}

${authorSample.trim().length >= 100 ? `ОБРАЗЕЦ АВТОРСКОГО СТИЛЯ (подражай этому регистру):\n${authorSample.slice(0, 600)}\n` : ""}

ТЕКСТ (после фазы 1):
${text}

Верни ТОЛЬКО переработанный текст. Без комментариев.`;
}

/**
 * ФАЗА 3: Micro-imperfections
 * 
 * Логика: человеческий текст содержит намеренные «несовершенства» —
 * оборванные мысли, самоперебивы, подчёркнуто грубые слова вместо «красивых».
 * Это заимствовано из анализа chapter-1.txt (100% HUMAN-эталон «Лабиринт»).
 */
export function buildMicroImperfectionsPrompt(
  text: string,
  voiceSheet: string,
): string {
  return `Ты — финальный ассистент очеловечивания прозы. Текст уже прошёл ритмический и лексический редактор.

ЗАДАЧА ФАЗЫ 3 — добавить «человеческие несовершенства» в 1–3 местах.
ОБЪЁМ ПРАВОК: не более 8–12% текста.

ДОСТУПНЫЕ ИНСТРУМЕНТЫ (используй ВЫБОРОЧНО, не все сразу):
1. Оборванная мысль с тире: «Он хотел сказать — нет, не сейчас.»
2. Самоперебив: «Точнее, почти всё.»
3. Скобочная ремарка: «(Он всегда так говорил, когда врал.)»
4. Намеренно грубое слово вместо «литературного»: "лицо" вместо "лик", "рот" вместо "уста"
5. Незавершённое предложение с многоточием в неожиданном месте
6. Бытовая деталь, нарушающая «гладкость» описания

НЕ ДОБАВЛЯЙ больше 2 из перечисленных на весь текст.
НЕ МЕНЯЙ факты, имена, порядок событий, диалоги.

${voiceSheet ? `ГОЛОС АВТОРА:\n${voiceSheet}\n` : ""}

ТЕКСТ (после фаз 1 и 2):
${text}

Верни ТОЛЬКО финальный текст. Без комментариев.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// БЛОК E: NEGATIVE VOICE PROFILE
// Заимствует логику selfLearner.ts (server/agent/selfLearner.ts):
// накопление паттернов правок автора → извлечение «чего НЕ писать»
// ─────────────────────────────────────────────────────────────────────────────

export interface NegativeVoiceProfile {
  storyId: string;
  updatedAt: number;
  /** Конструкции, которых автор никогда не использует в HUMAN-образцах */
  forbiddenConstructions: string[];
  /** Слова, которые встречаются ТОЛЬКО в AI-сегментах, но не в HUMAN */
  aiOnlyWords: Set<string>;
  /** Частые n-граммы из AI-сегментов (top-20) */
  aiNgrams: string[];
  /** Частые n-граммы из HUMAN-сегментов — для контраста */
  humanNgrams: string[];
}

/**
 * Вычисляет n-граммы из текста (биграммы слов).
 */
function extractWordBigrams(text: string): Map<string, number> {
  const words = text.match(/[а-яёa-z]+/giu) ?? [];
  const bigrams = new Map<string, number>();
  for (let i = 0; i < words.length - 1; i++) {
    const bigram = `${words[i].toLowerCase()} ${words[i + 1].toLowerCase()}`;
    bigrams.set(bigram, (bigrams.get(bigram) ?? 0) + 1);
  }
  return bigrams;
}

/**
 * Строит Negative Voice Profile из накопленных сегментов детектора.
 * Сохраняет, что является AI-эксклюзивными паттернами для конкретного автора.
 */
export function buildNegativeVoiceProfile(
  storyId: string,
  humanTexts: string[],
  aiTexts: string[],
): NegativeVoiceProfile {
  // AI-эксклюзивные слова: встречаются в AI, но НЕ в HUMAN
  const humanWords = new Set<string>();
  for (const t of humanTexts) {
    for (const w of (t.match(/[а-яёa-z]+/giu) ?? [])) {
      humanWords.add(w.toLowerCase());
    }
  }
  const aiOnlyWords = new Set<string>();
  for (const t of aiTexts) {
    for (const w of (t.match(/[а-яёa-z]+/giu) ?? [])) {
      const lw = w.toLowerCase();
      if (!humanWords.has(lw)) aiOnlyWords.add(lw);
    }
  }

  // Top n-граммы AI и HUMAN
  const aiNgramMap = new Map<string, number>();
  for (const t of aiTexts) {
    for (const [bigram, count] of extractWordBigrams(t)) {
      aiNgramMap.set(bigram, (aiNgramMap.get(bigram) ?? 0) + count);
    }
  }
  const humanNgramMap = new Map<string, number>();
  for (const t of humanTexts) {
    for (const [bigram, count] of extractWordBigrams(t)) {
      humanNgramMap.set(bigram, (humanNgramMap.get(bigram) ?? 0) + count);
    }
  }

  // AI-эксклюзивные n-граммы (встречаются в AI ×3 чаще, чем в HUMAN)
  const aiNgrams: string[] = [];
  for (const [bigram, aiCount] of aiNgramMap.entries()) {
    const humanCount = humanNgramMap.get(bigram) ?? 0;
    if (aiCount > 2 && aiCount > humanCount * 3) {
      aiNgrams.push(bigram);
    }
  }

  const top20AiNgrams = aiNgrams
    .sort((a, b) => (aiNgramMap.get(b) ?? 0) - (aiNgramMap.get(a) ?? 0))
    .slice(0, 20);

  const top20HumanNgrams = Array.from(humanNgramMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([bigram]) => bigram);

  return {
    storyId,
    updatedAt: Date.now(),
    forbiddenConstructions: [...aiOnlyWords].slice(0, 30),
    aiOnlyWords,
    aiNgrams: top20AiNgrams,
    humanNgrams: top20HumanNgrams,
  };
}

/**
 * Генерирует блок guidance из Negative Voice Profile для системного промпта.
 */
export function negativeVoiceGuidanceBlock(profile: NegativeVoiceProfile): string {
  if (!profile.aiNgrams.length && !profile.forbiddenConstructions.length) return "";

  const lines = [
    "НЕГАТИВНЫЙ ПРОФИЛЬ ГОЛОСА АВТОРА:",
    "Следующие конструкции и слова присутствуют ТОЛЬКО в AI-сегментах этого автора,",
    "но НЕ встречаются в подтверждённых HUMAN-образцах. Избегай их при генерации:",
  ];
  if (profile.forbiddenConstructions.length > 0) {
    lines.push(`Слова-маркеры AI: ${profile.forbiddenConstructions.slice(0, 15).join(", ")}`);
  }
  if (profile.aiNgrams.length > 0) {
    lines.push(`Биграммы-маркеры AI: «${profile.aiNgrams.slice(0, 10).join("», «")}»`);
  }
  if (profile.humanNgrams.length > 0) {
    lines.push(`Биграммы, типичные для HUMAN: «${profile.humanNgrams.slice(0, 10).join("», «")}»`);
  }
  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// БЛОК F: MULTI-DETECTOR GATE
// Заимствует логику из adaptiveDetector.ts (CalibratedLocalScore) и
// расширяет её N-gram repetition + paragraph CV gate
// ─────────────────────────────────────────────────────────────────────────────

export type GateVerdict = "PASS" | "REVIEW" | "FAIL";

export interface GateResult {
  verdict: GateVerdict;
  aiTellScore: number;
  paragraphCV: number;
  passiveShare: number;
  ttr200: number;
  connectorDiv: number;
  details: string[];
}

/**
 * Multi-detector gate: комбинирует все метрики и выносит вердикт.
 * 
 * PASS:   все детекторы в норме
 * REVIEW: 1–2 детектора в жёлтой зоне (нужна проверка автора)
 * FAIL:   3+ детектора сигнализируют об AI-тексте
 */
export function runMultiDetectorGate(
  text: string,
  allPatterns: AiTellPattern[],
  genre: GenreContext = "general",
  config: {
    maxAiTellScore?: number;
    minParagraphCV?: number;
    maxPassiveShare?: number;
    minTTR200?: number;
    minConnectorDiv?: number;
  } = {},
): GateResult {
  const {
    maxAiTellScore    = 18,
    minParagraphCV    = 0.35,
    maxPassiveShare   = 0.15,
    minTTR200         = 0.52,
    minConnectorDiv   = 0.45,
  } = config;

  const tellScore   = aiTellScoreEnhanced(text, allPatterns, genre);
  const paraCV      = paragraphLengthCV(text);
  const passiveShare = passiveVoiceShare(text);
  const ttr200      = uniqueWordRatio200(text);
  const connDiv     = connectorDiversity(text);

  const failures: string[] = [];

  if (tellScore > maxAiTellScore)   failures.push(`AI-tell score ${tellScore} > порога ${maxAiTellScore}`);
  if (paraCV < minParagraphCV)      failures.push(`Вариация абзацев CV=${paraCV.toFixed(2)} < ${minParagraphCV} (однообразная длина)`);
  if (passiveShare > maxPassiveShare) failures.push(`Пассивный залог ${(passiveShare * 100).toFixed(0)}% > ${(maxPassiveShare * 100).toFixed(0)}%`);
  if (ttr200 < minTTR200)           failures.push(`TTR-200 ${ttr200.toFixed(2)} < ${minTTR200} (бедный словарь)`);
  if (connDiv < minConnectorDiv)    failures.push(`Diversity коннекторов ${connDiv.toFixed(2)} < ${minConnectorDiv} (монотонные связки)`);

  let verdict: GateVerdict;
  if (failures.length === 0)      verdict = "PASS";
  else if (failures.length <= 2)  verdict = "REVIEW";
  else                            verdict = "FAIL";

  return {
    verdict,
    aiTellScore:   tellScore,
    paragraphCV:   paraCV,
    passiveShare,
    ttr200,
    connectorDiv:  connDiv,
    details:       failures,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ЭКСПОРТ ИТОГОВОГО КОНФИГУРАЦИОННОГО ОБЪЕКТА
// Готов к подключению через import в server/humanStyle.ts или server.ts
// ─────────────────────────────────────────────────────────────────────────────

export const HUMANIZER_V2 = {
  /** Полный каталог: оригинальные 80+ + 50 новых */
  extendedCatalog: AI_TELL_CATALOG_EXTENDED,

  /** Детектор с контекстными весами */
  detectEnhanced: detectAiTellsEnhanced,
  scoreEnhanced:  aiTellScoreEnhanced,

  /** Расширенные метрики стиля */
  computeMetrics: computeExtendedMetrics,

  /** Промпты 3-фазного pipeline */
  phases: {
    rhythmBreaker:        buildRhythmBreakerPrompt,
    lexicalDiversifier:   buildLexicalDiversifierPrompt,
    microImperfections:   buildMicroImperfectionsPrompt,
  },

  /** Negative Voice Profile */
  buildNegativeProfile: buildNegativeVoiceProfile,
  negativeGuidanceBlock: negativeVoiceGuidanceBlock,

  /** Multi-detector gate */
  gate: runMultiDetectorGate,
};

// Наш локальный аудит и 3-фазный pipeline выше работают на уровне поверхностного
// стиля (штампы, синтаксис, лексика). Независимые исследования по детекции ИИ-прозы
// (в т.ч. StoryScope, ~61 тыс. историй) показывают, что не менее выраженные признаки
// лежат на уровне АРХИТЕКТУРЫ ПОВЕСТВОВАНИЯ — и косметическая правка стиля почти не
// снижает их заметность. Это чек-лист для промпта генерации/ревизии (не для regex-
// аудита: такие признаки нельзя надёжно поймать паттерном, только суждением модели
// в процессе письма). Формулировки — наша адаптация идей, не дословный перевод источника.
export const NARRATIVE_ARCHITECTURE_CHECKLIST = `Признаки ИИ-прозы часто прячутся не в словах, а в архитектуре истории. При переписывании выбери 3-5 уместных пунктов (не все сразу — их одновременное применение само по себе становится новым шаблоном):
- Тема: не проговаривай мораль впрямую через рассказчика или финальный диалог-рассуждение; пусть смысл несут события, а не авторский вывод.
- Сюжет: не обязаны сходиться все нити — можно оставить одну деталь без разрешения; причинно-следственная цепочка не должна быть идеально гладкой от завязки до развязки.
- Развязка: избегай автоматической связки «герой сам выбрал → принял случившееся → вырос из-за этого» — иногда пусть решает случай, другие люди или обстоятельства; финал не обязан закрывать все счета.
- Эмоции: не своди чувства только к телесным реакциям (мурашки, холодок, сжалось внутри) — иногда прямо называй чувство словом или показывай через поступок, без описания ощущений.
- Персонажи: не всегда вводи через описание внешности — можно через реплику или действие; сеть отношений не должна быть плотной (не все знакомы со всеми) и не должна быть равномерно тёплой.
- Заземление: упоминай что-то по-настоящему конкретное (место, книгу, деталь мира), а не только обобщённые образы.
- Открытие сцены: не начинай с погоды/места/портрета героя — входи в сцену уже в действии или разговоре.
- Ритм абзацев: разная длина абзацев, включая хотя бы один из одного предложения; реплика не обязана всегда закрывать абзац.
- Середина главы: не спеши к развязке — пусть где-то в середине действие «провиснет», случится нечто, чего не предвещало начало.`;
