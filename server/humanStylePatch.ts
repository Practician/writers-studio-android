const FUSABLE_CONJUNCTIONS =
  /^(?:и|а|но|да|или|зато|однако|причём|притом|хотя|будто|словно|точно|пока|едва|когда|если|чтобы|потому что|так что|отчего|почему)\b/iu;

const PROTECTED_PROPER_PREFIXES =
  /^(?:Вас(?:я|ьк[аеиуой]|ёк)|Иль(?:я|и|е|ю|ёй|ей)|Илюх[аеиуой]|Илюш[аеиуой]|Лиз[аеыуой]|Гур[ауом]?|Паш[аеиуой]|Пень|Колод[аеыу]|Старши[ехм]|Тарр[ыов]|Росси[ияю]|Ок[аеиу]|Рязан[ьи])\b/u;

export function isProtectedCapitalStart(
  sentence: string,
  extraProperNames: string[] = []
): boolean {
  const trimmed = sentence.trim();
  if (!trimmed) return false;
  if (/^[«"—–\-]/.test(trimmed)) return true;
  if (/^[А-ЯЁA-Z]{2,}/u.test(trimmed)) return true;
  if (PROTECTED_PROPER_PREFIXES.test(trimmed)) return true;
  for (const rawName of extraProperNames) {
    const clean = rawName.trim();
    if (clean.length >= 2 && trimmed.startsWith(clean)) return true;
  }
  return false;
}

export function safeLowerFirst(
  sentence: string,
  extraProperNames: string[] = []
): string {
  const trimmed = sentence.trim();
  if (!trimmed) return trimmed;
  if (isProtectedCapitalStart(trimmed, extraProperNames)) return trimmed;
  return `${trimmed.charAt(0).toLowerCase()}${trimmed.slice(1)}`;
}

export function canSafelyFusePair(
  a: string,
  b: string,
  extraProperNames: string[] = []
): boolean {
  const cleanA = a.trim();
  const cleanB = b.trim();
  if (!cleanA || !cleanB) return false;
  if (/^[—–\-«"]/.test(cleanA) || /^[—–\-«"]/.test(cleanB)) return false;
  if (/[?!…]$/.test(cleanA) || /[?!…]$/.test(cleanB)) return false;
  if (isProtectedCapitalStart(cleanB, extraProperNames)) return false;
  return true;
}

export function joinPairSafe(
  a: string,
  b: string,
  extraProperNames: string[] = []
): string {
  const clean = a.trim().replace(/\.+$/u, "");
  const next = b.trim();
  if (!canSafelyFusePair(a, b, extraProperNames)) {
    return `${clean}. ${next}`;
  }
  if (FUSABLE_CONJUNCTIONS.test(next)) {
    return `${clean}, ${safeLowerFirst(next, extraProperNames)}`;
  }
  const wordsA = clean.split(/\s+/).length;
  const wordsB = next.split(/\s+/).length;
  if (wordsA <= 7 && wordsB <= 8) {
    return `${clean} — ${safeLowerFirst(next, extraProperNames)}`;
  }
  return `${clean}; ${safeLowerFirst(next, extraProperNames)}`;
}

export function detectRussianAndCanonDefects(
  text: string,
  worldBible = ""
): string[] {
  const issues: string[] = [];
  const latinMatches = text.match(/[А-ЯЁа-яё]+-[A-Za-z]+|[A-Za-z]+-[А-ЯЁа-яё]+/g);
  if (latinMatches && latinMatches.length > 0) {
    issues.push(
      `Англоязычные вкрапления в русском тексте (${latinMatches.slice(0, 3).join(", ")}) — заменить на чистый русский язык.`
    );
  }
  const genderMatches = text.match(
    /\b(?:Вася|Васька|Илья|Илюха|Никита|Паша|дядька|дедушка)\s+(?:уже\s+|снова\s+|вдруг\s+|тихо\s+)?[а-яё]{2,}ла(?:сь)?\b/giu
  );
  if (genderMatches && genderMatches.length > 0) {
    issues.push(
      `Ошибка грамматического рода у мужского имени (${genderMatches.slice(0, 3).join(", ")}) — использовать мужской род глагола.`
    );
  }
  if (/;\s+(?:вася|васька|илья|илюха|лиза|гур)\b/u.test(text)) {
    issues.push(
      "Имена собственные написаны со строчной буквы после точки с запятой (; васька / ; илья)."
    );
  }
  if (/(?<=[.!?])\s+(?:Прикинул|Решил|Подумал|Осознал)\.(?=\s*(?:\n|$))/u.test(text)) {
    issues.push(
      "Искусственные однословные предложения-обрубки («Прикинул.», «Решил.») в конце абзацев — убрать."
    );
  }
  const bibleLower = worldBible.toLowerCase();
  if (bibleLower.includes("каменно-органическ") || bibleLower.includes("не строили города из стекла и бетона")) {
    const industrialStamps = text.match(
      /\b(?:бетон[а-яё]*|солидол[а-яё]*|верет[её]нн[а-яё]+\s+масл[а-яё]*|токарн[а-яё]+\s+цех[а-яё]*|автосервис[а-яё]*|трансформаторн[а-яё]+\s+будк[а-яё]*|протектор[а-яё]*\s+шин)\b/giu
    );
    if (industrialStamps && industrialStamps.length > 0) {
      issues.push(
        `Нарушение канона Старших: техногенные/советские штампы (${Array.from(new Set(industrialStamps)).slice(0, 4).join(", ")}) противоречат каменно-органической культуре Древних.`
      );
    }
  }
  if (bibleLower.includes("банан") && bibleLower.includes("бамбук")) {
    const temperateTrees = text.match(
      /\b(?:бер[её]зов[а-яё]+\s+(?:веточк|комл|полен)[а-яё]*|просмоленн[а-яё]+\s+ветк[а-яё]+\s+сосн[а-яё]*|дикого\s+орешника)\b/giu
    );
    if (temperateTrees && temperateTrees.length > 0) {
      issues.push(
        `Ботанический ляп: деревья средней полосы (${Array.from(new Set(temperateTrees)).slice(0, 3).join(", ")}) посреди бамбуково-банановых джунглей.`
      );
    }
  }
  return issues;
}

export type TimeOfDayPhase = 0 | 1 | 2 | 3;

export function detectTimeOfDayPhase(text: string): TimeOfDayPhase | null {
  const lower = text.toLowerCase();
  if (/(?:утренний свет|до рассвета|на рассвете|утром разберёмся|к утру)/u.test(lower)) {
    if (/пробиваться мутный утренний свет|наступило утро|с рассветом/u.test(lower)) {
      return 3;
    }
  }
  if (/(?:без двадцати полночь|в два ночи|среди ночи|глубокой ночью|первый я сижу, ты дрыхнешь)/u.test(lower)) {
    return 2;
  }
  if (/(?:садилось солнце|солнце уже почти за гору село|темнота тут падает быстро)/u.test(lower)) {
    return 0;
  }
  return null;
}

export function isPlotRestartOrDuplicateScene(
  existingScenes: string[],
  candidateScene: string
): { rejected: boolean; reason?: string } {
  if (existingScenes.length === 0) return { rejected: false };
  const firstScene = existingScenes[0];
  const candLower = candidateScene.toLowerCase();
  const firstLower = firstScene.toLowerCase();
  const openingMarkers = [
    "вязанки дров",
    "вязанки давили на плечи",
    "скинули дрова возле входа",
    "сбросив тяжелый груз у самого входа",
    "шевели поршнями, темнота тут падает быстро",
  ];
  const candHasOpening = openingMarkers.some((m) => candLower.includes(m));
  const firstHasOpening = openingMarkers.some((m) => firstLower.includes(m));
  if (existingScenes.length >= 2 && firstHasOpening && candHasOpening) {
    return {
      rejected: true,
      reason:
        "Кандидат сцены повторно генерирует зачин главы (возвращение с дровами к пещере) вместо продолжения финала.",
    };
  }
  let maxPhaseSoFar: TimeOfDayPhase = 0;
  for (const scene of existingScenes) {
    const phase = detectTimeOfDayPhase(scene);
    if (phase !== null && phase > maxPhaseSoFar) {
      maxPhaseSoFar = phase;
    }
  }
  const candPhase = detectTimeOfDayPhase(candidateScene);
  if (maxPhaseSoFar >= 2 && candPhase === 0) {
    return {
      rejected: true,
      reason:
        "Нарушение хронологии: в главе уже наступила глубокая ночь или рассвет, но новая сцена возвращает сюжет к закату.",
    };
  }
  return { rejected: false };
}

export function extractNextChapterBoundary(
  bookPlan: string,
  currentChapterTitle: string
): string {
  if (!bookPlan || !currentChapterTitle) return "";
  const lines = bookPlan
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  let foundCurrent = false;
  let nextHeader = "";
  const nextBody: string[] = [];
  for (const line of lines) {
    const isChapterHeader = /^Глава\s+\d+/iu.test(line);
    if (!foundCurrent) {
      if (
        isChapterHeader &&
        (line.toLowerCase().includes(currentChapterTitle.toLowerCase()) ||
          currentChapterTitle.toLowerCase().includes(line.toLowerCase()))
      ) {
        foundCurrent = true;
      }
      continue;
    }
    if (isChapterHeader && !nextHeader) {
      nextHeader = line;
      continue;
    }
    if (nextHeader) {
      if (isChapterHeader) break;
      nextBody.push(line);
    }
  }
  if (!nextHeader) return "";
  return `${nextHeader}: ${nextBody.join(" ")}`.trim();
}

export function buildCanonAndBoundaryBlock(params: {
  worldBible: string;
  bookPlan: string;
  currentChapterTitle: string;
  currentChapterSummary: string;
  completedBeatSummaries: string[];
  isTopUpScene?: boolean;
}): string {
  const nextChapterBoundary = extractNextChapterBoundary(
    params.bookPlan,
    params.currentChapterTitle
  );
  const completedList =
    params.completedBeatSummaries.length > 0
      ? params.completedBeatSummaries
          .map((b, idx) => `  ${idx + 1}. [УЖЕ НАПИСАНО — НЕ ПОВТОРЯТЬ]: ${b}`)
          .join("\n")
      : "  (Это первая сцена главы)";
  const topUpDirective = params.isTopUpScene
    ? `\nВАЖНО (ДОБОР ОБЪЁМА): Все основные события главы уже произошли. Категорически ЗАПРЕЩЕНО начинать главу заново, повторно описывать приход с дровами, повторно разводить костёр или возвращать время суток назад к закату. Углуби только текущую финальную сцену (диалог братьев, тактильные детали, осмотр найденного знака) с сохранением текущего времени суток.`
    : "";
  return [
    `=== ЖЁСТКИЕ ГРАНИЦЫ ГЛАВЫ И КАНОНА МИРА ===`,
    `ТЕКУЩАЯ ГЛАВА: ${params.currentChapterTitle}`,
    `ПЛАН ТОЛЬКО ЭТОЙ ГЛАВЫ: ${params.currentChapterSummary}`,
    nextChapterBoundary
      ? `СОБЫТИЯ СЛЕДУЮЩЕЙ ГЛАВЫ (СТРОГО ЗАПРЕЩЕНО забегать вперёд и раскрывать их сейчас): ${nextChapterBoundary}`
      : "",
    `УЖЕ ПРОЙДЕННЫЕ ЭПИЗОДЫ ЭТОЙ ГЛАВЫ (НЕ ДУБЛИРОВАТЬ):\n${completedList}`,
    `ОГРАНИЧЕНИЯ СЕТТИНГА И ЯЗЫКА:`,
    `- Культура Старших — каменно-органическая (обработанный монолит, кость, кристаллы, живые материалы, барельефы). ЗАПРЕЩЕНЫ штампы советской промзоны и бункеров: бетон, солидол, веретённое масло, токарный цех, автосервис, трансформаторная будка, автомобильные шины.`,
    `- Флора вокруг пещеры и реки — древний влажный лес (древовидные папоротники, бамбук, дикие бананы, магнолии, железное дерево). ЗАПРЕЩЕНО упоминать берёзу, сосну и лесной орешник средней полосы.`,
    `- Оружие и снаряжение героев — строго по описи рюкзаков (ножи, самодельная бамбуковая пика с ножом на паракорде, стамески Ильи, зажигалка, 14 спичек, налобный фонарик, солнечная зарядка, вейп). ЗАПРЕЩЕНО выдумывать огнестрельное оружие и патроны.`,
    `- Пиши живым, естественным русским литературным языком без англоязычных вкраплений, без однословных обрубков («Прикинул.», «Решил.») в конце абзацев и с правильным мужским родом глаголов для имён Васька, Вася, Илья, Илюха.`,
    topUpDirective,
  ]
    .filter(Boolean)
    .join("\n");
}
