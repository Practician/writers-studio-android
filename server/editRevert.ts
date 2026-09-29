import { detectAiTells } from "./humanStyle";

/**
 * Локальный аналог двух закрывающих тестов sepia для правки моделью (v0.8.0,
 * style-pass §4): «тест удаления» и «тест возврата». Правка модели, которая не убрала
 * ни одного штампа и не сделала фразу короче, ничего не заработала: по данным Shan,
 * Lee, Hao 2026 машинная правка сама оставляет след (лексическая плотность падает),
 * поэтому лишние замены откатываем к оригиналу. Вызовов модели не требует.
 *
 * Работает только когда правка сохранила число предложений (так соответствие
 * «было → стало» однозначно). Ритм-фаза режет и склеивает фразы — её результат
 * целиком не трогаем.
 */

function wordCount(text: string): number {
  return (text.match(/[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*/gu) ?? []).length;
}

/** [фраза, разделитель, фраза, ...] — разделители (пробелы и переводы строк) сохраняются. */
function splitKeepingSeparators(text: string): string[] {
  return text.split(/((?<=[.!?…]["»”)]*)\s+)/u);
}

export interface RevertResult {
  text: string;
  /** Сколько замен откачено к оригиналу. */
  reverted: number;
  /** Сколько пар фраз реально сравнивалось (0 — число предложений не совпало). */
  compared: number;
}

export function revertUnearnedEdits(original: string, candidate: string): RevertResult {
  const originalParts = splitKeepingSeparators(original);
  const candidateParts = splitKeepingSeparators(candidate);
  if (originalParts.length !== candidateParts.length || originalParts.length < 3) {
    return { text: candidate, reverted: 0, compared: 0 };
  }
  let reverted = 0;
  let compared = 0;
  const merged = candidateParts.map((part, index) => {
    // Чётные индексы — предложения, нечётные — разделители: берём разделитель кандидата.
    if (index % 2 === 1) return part;
    const before = originalParts[index];
    if (before === part) return part;
    compared += 1;
    const tellsBefore = detectAiTells(before).length;
    const tellsAfter = detectAiTells(part).length;
    const earned = tellsAfter < tellsBefore || wordCount(part) < wordCount(before);
    if (earned) return part;
    reverted += 1;
    return before;
  });
  return { text: merged.join(""), reverted, compared };
}

/**
 * Тест сохранения смысла (третий закрывающий тест).
 *
 * «Тест удаления» и «тест возврата» отвечают на вопрос «заработала ли правка»,
 * но не отвечают на вопрос «не потеряла ли она содержание». Между тем потеря
 * содержания — самая частая беда автоматической правки: модель, переписывая абзац
 * про «Бирюсу», из которой пахнет жжёной проводкой, спокойно убирает и «Бирюсу»,
 * и запах, и проводку, а отчёт показывает улучшение по штампам. Числа и имена
 * в правке prose обязаны выжить: их читатель помнит.
 *
 * Возвращает список пропавших элементов. Пустой список — тест пройден.
 */
export function meaningLossIssues(original: string, candidate: string): string[] {
  const issues: string[] = [];

  // 1. Числа: «1978», «300», «42». Любое исчезнувшее число — потеря факта.
  const numbers = (text: string) => [...new Set(text.match(/\d+(?:[.,]\d+)?/gu) ?? [])];
  const originalNumbers = new Set(numbers(original));
  const candidateNumbers = new Set(numbers(candidate));
  const lostNumbers = [...originalNumbers].filter((value) => !candidateNumbers.has(value));
  if (lostNumbers.length) {
    issues.push(`потеряны числа: ${lostNumbers.slice(0, 6).join(", ")}`);
  }

  // 2. Имена собственные: заглавные слова, встречающиеся в тексте дважды и чаще
  //    (в начале предложения заглавной начинается любое слово, поэтому фильтруем
  //    те, что встречаются и внутри фразы).
  // Сравнение по основе, а не по словоформе: по-русски имя склоняется, и правка
  // «из «Бирюсы»» против исходного ««Бирюса»» — это тот же факт, а не пропажа.
  const stemOf = (name: string) => name.toLowerCase().replace(/(?:а|я|ы|и|у|ю|е|ом|ем|ах|ях|ей|ой|ий|ая|яя|ое|ее|ыи|ии|ов|ев|ью)$/u, "").slice(0, Math.max(4, name.length - 2));
  // Начало предложения само по себе не доказывает имя: с заглавной там начинается
  // любое слово. Поэтому имена выявляются по оригиналу, где они стоят ВНУТРИ фразы
  // («и Васька съел»), а проверяются по кандидату как основы среди всех его слов —
  // так склонение («из «Бирюсы»») и перестановка («Васька доел банку») считаются
  // сохранением факта, а не его пропажей.
  const stemsOfAllWords = (text: string) => {
    const stems = new Set<string>();
    for (const word of text.match(/[\p{L}]{4,}/gu) || []) stems.add(stemOf(word));
    return stems;
  };
  const namesInsidePhrases = (text: string) => {
    const names = new Set<string>();
    for (const sentence of text.split(/(?<=[.!?…])\s+/u)) {
      const tokens = sentence.split(/\s+/u);
      for (let index = 1; index < tokens.length; index += 1) {
        const clean = tokens[index].replace(/^[«"(—–-]+|[,.;:!?)»"]+$/gu, "");
        if (/^[А-ЯЁ][а-яё]{2,}$/u.test(clean)) names.add(stemOf(clean));
      }
    }
    return names;
  };
  const originalNames = namesInsidePhrases(original);
  const candidateWords = stemsOfAllWords(candidate);
  const lostNames = [...originalNames].filter((name) => !candidateWords.has(name));
  if (lostNames.length) {
    issues.push(`потеряны имена: ${lostNames.slice(0, 6).join(", ")}`);
  }

  return issues;
}

/** Токены правки: слова без учёта регистра и пунктуации. */
function editTokens(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+(?:[-'][\p{L}\p{N}]+)*/gu) ?? [];
}

function lcsLength(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  // Две строки DP: на куске в 7–14 тысяч знаков это сотни тысяч операций, а память
  // остаётся линейной. Полная таблица на такие куски — лишние мегабайты.
  const width = b.length + 1;
  let previous = new Uint32Array(width);
  let current = new Uint32Array(width);
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j < width; j += 1) {
      current[j] = a[i - 1] === b[j - 1] ? previous[j - 1] + 1 : Math.max(previous[j], current[j - 1]);
    }
    const swap = previous;
    previous = current;
    current = swap;
  }
  return previous[b.length];
}

export interface EditMix {
  /** Доли операций среди ВСЕХ правок: replace + delete + insert = 1. */
  replace: number;
  delete: number;
  insert: number;
  /** Число правок относительно длины оригинала: 0 — правки нет. */
  intensity: number;
}

/**
 * Доли операций правки — локальный замер правила sepia «Deletion beats addition»:
 * измеренное соотношение редакторских правок 74% замены / 18% удаления / 8% вставки.
 * Текст, который модель не переписала, а дописала, набирает вставки и выдаёт себя:
 * рост — это не ремонт (repair is not growth).
 *
 * Считается по LCS слов: общая префиксно-суффиксная часть вычитается сразу, дальше
 * динамика только по изменившейся середине.
 */
export function editMixRatios(original: string, candidate: string): EditMix {
  const a = editTokens(original);
  const b = editTokens(candidate);
  if (!a.length || !b.length) {
    // Один из текстов без слов: правка либо целиком вставка, либо целиком удаление.
    return {
      replace: 0,
      delete: a.length ? 1 : 0,
      insert: b.length ? 1 : 0,
      intensity: (a.length + b.length) / Math.max(1, a.length),
    };
  }
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const removed = midA.length;
  const added = midB.length;
  if (!removed && !added) return { replace: 1, delete: 0, insert: 0, intensity: 0 };
  const common = lcsLength(midA, midB);
  const deleted = removed - common;
  const inserted = added - common;
  const replaced = Math.min(deleted, inserted);
  const totalOps = replaced + (deleted - replaced) + (inserted - replaced);
  if (!totalOps) return { replace: 1, delete: 0, insert: 0, intensity: 0 };
  return {
    replace: replaced / totalOps,
    delete: (deleted - replaced) / totalOps,
    insert: (inserted - replaced) / totalOps,
    intensity: totalOps / Math.max(1, a.length),
  };
}
