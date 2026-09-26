import type { SpellDictionaryStatus } from "./spellRuLoader";

/** Потолок волн в тексте: больше — слой начинает тормозить набор. */
export const MIRROR_MARK_LIMIT = 400;

export interface MarksNoticeInput {
  /** Сколько меток дал разбор. */
  segmentCount: number;
  dictionaryStatus: SpellDictionaryStatus;
  dictionaryError: string;
  spellTruncated: boolean;
  hasText: boolean;
}

/**
 * Почему волн в тексте может не быть. Гасим их только там, где волн физически
 * не нарисовать: слишком много меток или не загруженный словарь. Расхождение
 * раскладки слоя с полем причиной не считается — его чиним, а не прячем метки:
 * молча пропавшая вычитка выглядит как поломка.
 */
export function marksNotice(input: MarksNoticeInput): string | null {
  if (input.segmentCount > MIRROR_MARK_LIMIT) {
    return `Волн в тексте нет: меток слишком много (${input.segmentCount}). Причины всё равно открываются нажатием по слову.`;
  }
  if (input.dictionaryStatus === "error") {
    const reason = input.dictionaryError ? ` (${input.dictionaryError})` : "";
    return `Орфография не проверяется: словарь не загрузился${reason}. Правила пунктуации и наблюдения стиля работают.`;
  }
  if (input.spellTruncated) {
    return "Проверены не все слова: глава длинная, дальше проверка останавливается, чтобы набор не тормозил.";
  }
  if (input.hasText && input.segmentCount === 0 && input.dictionaryStatus === "ready") {
    return "Орфография и пунктуация чисты: меток нет.";
  }
  return null;
}
