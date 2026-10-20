# ANTIGRAVITY HANDOFF: Исправление пайплайна очеловечивания и генерации глав (`writers-studio-android`)

## Задача для агента Antigravity
Внедрить в репозиторий `Practician/writers-studio-android` пакет исправлений для 100% очеловечивания текста и устранения багов генерации, выявленных на примере Главы 4 («Ночь у чужого входа»), после чего выполнить проверку типов и сделать `git commit` + `git push origin main`.

## Корневые причины багов, которые устраняет этот патч
1. **Имена собственные со строчной буквы после точки с запятой (`; васька`, `; илья`)**:
   В `server/humanStyle.ts` функция `joinPair(a, b)` внутри `fuseChunk` / `fuseShortSentencesForTail` склеивает соседние короткие предложения через `; ${lowerFirst(next)}`, слепо понижая регистр первой буквы второго предложения даже у имен собственных (`Васька`, `Илья`, `Лиза`, `Гур`).
2. **Искусственные однословные хвосты (`Прикинул.`, `Решил.`) и сломанные двоеточия (`А: чего?`)**:
   Механическая накрутка `sentenceBurstiness` / `shortSentenceStats` оставляет в конце абзацев одиночные глаголы (`Прикинул.`, `Решил.`), выдающие работу скрипта.
3. **Зацикливание/повтор главы с 1-й сцены и инверсия времени суток в `MAX_TOPUP_SCENES` (`server/chapterGenerate.ts`)**:
   При доборе объема (`MAX_TOPUP_SCENES`) модель получает общий план главы без запрета на повтор уже написанных битов и без фиксации текущей фазы суток, из-за чего в середине главы заново генерирует сцену прихода с дровами, а после рассвета возвращает сюжет обратно к закату.
4. **Нарушение канона «Библии мира» и забегание в следующие главы (`server/chapterGenerate.ts`)**:
   Модель без негативного фильтра по `worldBible` подтягивает штампы советской промзоны (`бетон`, `солидол`, `веретенное масло`, `токарный цех`, `трансформаторная будка`) и деревья средней полосы (`берёза`, `сосна`, `орешник`) в бамбуковые джунгли каменно-органической цивилизации Старших, а также захватывает события 5-й главы и далее.
5. **Языковые сбои резервных моделей (`темно-brown`, `Васька подсела`, дубли абзацев)**:
   В `server/textHygiene.ts` отсутствовала очистка англоязычных вкраплений внутри кириллицы, исправление женского рода глаголов при мужских именах на `-а/-я` (`Васька подсела` $\rightarrow$ `Васька подсел`) и дедупликация повторённых абзацев.

---

## Шаг 1. Заменить `server/textHygiene.ts`

Полностью обнови файл `server/textHygiene.ts` следующим кодом (все существующие экспорты `TextHygieneReport`, `TextHygieneResult`, `sanitizeGeneratedText`, `punctuationHygieneNote` сохранены):

```typescript
import { restoreYo } from "./yoRestore";

export interface TextHygieneReport {
  removedHiddenCharacters: number;
  normalizedSpaces: number;
  normalizedLineEndings: boolean;
  fixedPunctuationArtifacts: number;
  punctuationNotes: string[];
  restoredYo: number;
  fixedLatinLeaks: number;
  fixedProperNounCase: number;
  fixedGenderAgreement: number;
  removedBurstinessStubs: number;
  removedDuplicateParagraphs: number;
  changed: boolean;
}

export interface TextHygieneResult {
  text: string;
  report: TextHygieneReport;
}

const LATIN_LEAK_MAP: Record<string, string> = {
  brown: "бурого",
  dark: "тёмно",
  light: "светло",
  grey: "серого",
  gray: "серого",
  black: "чёрного",
  green: "зелёного",
  red: "красного",
  blue: "синего",
  white: "белого",
  stone: "каменного",
  rock: "скального",
  shadow: "тени",
  deep: "глубокого",
  cold: "холодного",
  warm: "тёплого",
};

const MASCULINE_A_NOUNS = [
  "Вася", "Васька", "Васёк", "Илья", "Илюха", "Илюша", "Никита",
  "Даня", "Данила", "Миша", "Мишка", "Саша", "Сашка", "Паша", "Пашка",
  "Лёша", "Лёшка", "Серёга", "Серёжа", "Коля", "Колька", "Толя",
  "Витя", "Витька", "Генка", "Петька", "Федька", "Димка", "Вовка",
  "батя", "дядя", "дядька", "дядюшка", "дедушка", "папа", "мужчина",
  "парнишка", "мальчишка", "братишка", "старшина",
];

const PROPER_NAMES_RESTORE = [
  "Вася", "Васька", "Васьки", "Ваське", "Ваську", "Васькой",
  "Илья", "Ильи", "Илье", "Илью", "Ильёй", "Ильей",
  "Илюха", "Илюхи", "Илюхе", "Илюху", "Илюхой",
  "Лиза", "Лизы", "Лизе", "Лизу", "Лизой",
  "Гур", "Гура", "Гуру", "Гуром",
  "Паша", "Паши", "Пень", "Колода",
];

const ARTIFICIAL_TAIL_STUB_RE =
  /(?<=[.!?])\s+(?:Прикинул|Решил|Подумал|Осознал|Смекнул|Отметил|Запомнил|Понял|Выдохнул|Вздохнул)\.(?=\s*(?:\n|$))/gu;

function normalizeForSimilarity(paragraph: string): string {
  return paragraph
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenJaccardSimilarity(a: string, b: string): number {
  const normA = normalizeForSimilarity(a);
  const normB = normalizeForSimilarity(b);
  if (!normA || !normB) return 0;
  if (normA === normB) return 1;

  const setA = new Set(normA.split(" ").filter((w) => w.length > 2));
  const setB = new Set(normB.split(" ").filter((w) => w.length > 2));
  if (setA.size < 5 || setB.size < 5) return 0;

  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function deduplicateParagraphs(text: string): { text: string; removedCount: number } {
  const blocks = text.split("\n");
  const kept: string[] = [];
  let removedCount = 0;

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed || trimmed.length < 45) {
      kept.push(block);
      continue;
    }

    let isDuplicate = false;
    const windowStart = Math.max(0, kept.length - 6);
    for (let i = windowStart; i < kept.length; i++) {
      const prev = kept[i].trim();
      if (prev.length < 45) continue;
      if (tokenJaccardSimilarity(prev, trimmed) >= 0.82) {
        isDuplicate = true;
        removedCount++;
        break;
      }
    }

    if (!isDuplicate) {
      kept.push(block);
    }
  }

  return { text: kept.join("\n"), removedCount };
}

export function sanitizeGeneratedText(rawText: string): TextHygieneResult {
  const punctuationNotes: string[] = [];
  let text = rawText ?? "";

  const hiddenMatches = text.match(
    /[\u200B-\u200D\uFEFF\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g
  );
  const removedHiddenCharacters = hiddenMatches ? hiddenMatches.length : 0;
  if (removedHiddenCharacters > 0) {
    text = text.replace(
      /[\u200B-\u200D\uFEFF\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g,
      ""
    );
  }

  const normalizedLineEndings = /\r/.test(text);
  if (normalizedLineEndings) {
    text = text.replace(/\r\n?/g, "\n");
  }

  const spaceMatches = text.match(/[\t\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]| {2,}/g);
  const normalizedSpaces = spaceMatches ? spaceMatches.length : 0;
  text = text
    .replace(/[\t\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, " ")
    .replace(/ {2,}/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n");

  let fixedPunctuationArtifacts = 0;

  let fixedLatinLeaks = 0;
  text = text.replace(
    /([А-ЯЁа-яё]+)-([A-Za-z]+)|([A-Za-z]+)-([А-ЯЁа-яё]+)/g,
    (full, cyr1, lat1, lat2, cyr2) => {
      fixedLatinLeaks++;
      if (cyr1 && lat1) {
        const replacement = LATIN_LEAK_MAP[lat1.toLowerCase()];
        return replacement ? `${cyr1}-${replacement}` : cyr1;
      }
      if (lat2 && cyr2) {
        const replacement = LATIN_LEAK_MAP[lat2.toLowerCase()];
        return replacement ? `${replacement}-${cyr2}` : cyr2;
      }
      return full;
    }
  );
  if (fixedLatinLeaks > 0) {
    punctuationNotes.push(`Исправлены англоязычные склейки в словах (${fixedLatinLeaks})`);
  }

  let fixedProperNounCase = 0;
  for (const properName of PROPER_NAMES_RESTORE) {
    const lowerName = properName.toLowerCase();
    const re = new RegExp(`([;:])\\s+${lowerName}(?![а-яё])`, "gu");
    text = text.replace(re, () => {
      fixedProperNounCase++;
      fixedPunctuationArtifacts++;
      return `. ${properName}`;
    });
  }
  if (fixedProperNounCase > 0) {
    punctuationNotes.push(
      `Восстановлены заглавные буквы имён собственных после точки с запятой (${fixedProperNounCase})`
    );
  }

  text = text.replace(/;\s+([А-ЯЁ])/gu, (_m, cap) => {
    fixedPunctuationArtifacts++;
    return `. ${cap}`;
  });

  text = text.replace(/(^|\n|[—–-]\s*)А:\s+чего\?/gu, (_m, prefix) => {
    fixedPunctuationArtifacts++;
    return `${prefix}А? Чего?`;
  });
  text = text.replace(/(Чего\s+там\s+ещ[её]):\s+/giu, (_m, prefix) => {
    fixedPunctuationArtifacts++;
    return `${prefix} — `;
  });

  let removedBurstinessStubs = 0;
  text = text.replace(ARTIFICIAL_TAIL_STUB_RE, () => {
    removedBurstinessStubs++;
    fixedPunctuationArtifacts++;
    return "";
  });
  if (removedBurstinessStubs > 0) {
    punctuationNotes.push(
      `Удалены искусственные однословные отбивки ритма (${removedBurstinessStubs})`
    );
  }

  let fixedGenderAgreement = 0;
  const mascPattern = MASCULINE_A_NOUNS.join("|");
  const genderRe = new RegExp(
    `(?<![А-ЯЁа-яё])(${mascPattern})((?:\\s+(?:уже|снова|опять|вдруг|сразу|тихо|быстро|молча|нехотя|тоже|также|чуть|едва|просто|сам))?)\\s+([а-яё]{2,}л)а(сь)?(?![а-яё])`,
    "giu"
  );
  text = text.replace(genderRe, (_full, name, adv, verbStem, refl) => {
    fixedGenderAgreement++;
    fixedPunctuationArtifacts++;
    const fixedSuffix = refl ? "ся" : "";
    return `${name}${adv ?? ""} ${verbStem}${fixedSuffix}`;
  });
  if (fixedGenderAgreement > 0) {
    punctuationNotes.push(
      `Исправлено согласование мужского рода для имён на -а/-я (${fixedGenderAgreement})`
    );
  }

  text = text.replace(/(^|\n)[-\u2010-\u2013]\s+/g, (_m, start) => {
    fixedPunctuationArtifacts++;
    return `${start}— `;
  });
  text = text.replace(/\s+[-\u2010-\u2013]\s+([а-яё])/g, (_m, letter) => {
    fixedPunctuationArtifacts++;
    return ` — ${letter}`;
  });

  text = text
    .replace(/\s+([.,!?:;])/g, (_m, p) => {
      fixedPunctuationArtifacts++;
      return p;
    })
    .replace(/([.,!?])\1{2,}/g, (full, p) => {
      if (p === ".") return "...";
      fixedPunctuationArtifacts++;
      return p;
    })
    .replace(/([,.!?])([А-ЯЁа-яёA-Za-z])/g, (_m, p, ch) => {
      fixedPunctuationArtifacts++;
      return `${p} ${ch}`;
    });

  const dedup = deduplicateParagraphs(text);
  text = dedup.text;
  const removedDuplicateParagraphs = dedup.removedCount;
  if (removedDuplicateParagraphs > 0) {
    punctuationNotes.push(`Удалены дублирующиеся абзацы (${removedDuplicateParagraphs})`);
  }

  const beforeYo = text;
  text = restoreYo(text);
  let restoredYo = 0;
  if (text !== beforeYo) {
    for (let i = 0; i < text.length; i++) {
      if (text[i] !== beforeYo[i] && (text[i] === "ё" || text[i] === "Ё")) {
        restoredYo++;
      }
    }
  }

  const changed = text !== rawText;

  return {
    text: text.trim(),
    report: {
      removedHiddenCharacters,
      normalizedSpaces,
      normalizedLineEndings,
      fixedPunctuationArtifacts,
      punctuationNotes,
      restoredYo,
      fixedLatinLeaks,
      fixedProperNounCase,
      fixedGenderAgreement,
      removedBurstinessStubs,
      removedDuplicateParagraphs,
      changed,
    },
  };
}

export function punctuationHygieneNote(report: TextHygieneReport): string {
  const parts: string[] = [];
  if (report.removedHiddenCharacters > 0) {
    parts.push(`скрытых символов: ${report.removedHiddenCharacters}`);
  }
  if (report.fixedPunctuationArtifacts > 0) {
    parts.push(`пунктуационных правок: ${report.fixedPunctuationArtifacts}`);
  }
  if (report.fixedLatinLeaks > 0) {
    parts.push(`латинских склеек: ${report.fixedLatinLeaks}`);
  }
  if (report.fixedProperNounCase > 0) {
    parts.push(`регистр имён: ${report.fixedProperNounCase}`);
  }
  if (report.fixedGenderAgreement > 0) {
    parts.push(`род глаголов: ${report.fixedGenderAgreement}`);
  }
  if (report.removedDuplicateParagraphs > 0) {
    parts.push(`дублей абзацев: ${report.removedDuplicateParagraphs}`);
  }
  if (report.restoredYo > 0) {
    parts.push(`восстановлено «ё»: ${report.restoredYo}`);
  }
  if (report.punctuationNotes.length > 0) {
    parts.push(report.punctuationNotes.join("; "));
  }
  return parts.length > 0 ? `Гигиена текста: ${parts.join(", ")}.` : "Гигиена текста: без замечаний.";
}
```

---

## Шаг 2. Создать `server/humanStylePatch.ts`

Создай новый файл `server/humanStylePatch.ts` со следующим содержимым:

```typescript
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
  return `${clean}. ${next}`;
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
```

---

## Шаг 3. Подключить патч в `server/humanStyle.ts` и `server/chapterGenerate.ts`

1. В `server/humanStyle.ts`:
   * Добавь импорт:
     ```typescript
     import { joinPairSafe, safeLowerFirst } from "./humanStylePatch";
     ```
   * Замени реализацию `lowerFirst(word: string)` на вызов `safeLowerFirst(word)` и реализацию `joinPair(a: string, b: string)` на вызов `joinPairSafe(a, b)`.
   * В промптах ритма (`buildRhythmBreakerPrompt`, `buildMicroImperfectionsPrompt`) убери инструкцию вставлять однословные предложения-глаголы (`Прикинул.`, `Решил.`) в конце абзацев.

2. В `server/chapterGenerate.ts`:
   * Добавь импорт:
     ```typescript
     import {
       buildCanonAndBoundaryBlock,
       detectRussianAndCanonDefects,
       isPlotRestartOrDuplicateScene,
     } from "./humanStylePatch";
     ```
   * В `russianLanguageIssues(text: string)` добавь вызов `detectRussianAndCanonDefects(text, worldBible)`.
   * В `buildScenePrompt` и в промпт добора сцен (`MAX_TOPUP_SCENES`) включи блок `buildCanonAndBoundaryBlock(...)`.
   * В цикле добора `MAX_TOPUP_SCENES` перед добавлением сгенерированной сцены вызывай `isPlotRestartOrDuplicateScene(acceptedScenes, candidateScene)` — если `rejected === true`, прекращай цикл добора (`break`), чтобы не склеивать повтор главы.

---

## Шаг 4. Проверка и пуш в GitHub

Выполни в терминале проекта:
```bash
git add server/textHygiene.ts server/humanStylePatch.ts server/humanStyle.ts server/chapterGenerate.ts
git commit -m "fix(prose): prevent lowercase proper nouns after semicolons, remove burstiness stubs, fix gender & Latin leaks, add canon/top-up guards"
git push origin HEAD
```
