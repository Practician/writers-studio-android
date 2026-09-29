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
