/**
 * Куда встать карточке метки внутри поля редактора.
 *
 * Поле редактора обрезает всё, что вылезло за его край (`overflow-hidden`),
 * поэтому карточка обязана помещаться внутрь целиком: иначе её нижние кнопки
 * — в том числе «В личный словарь» — оказываются за границей поля, остаются
 * невидными, и нажатие по ним не проходит (палец попадает в текст под ними).
 *
 * Расчёт здесь чистой функцией: в приложении в него передаются настоящие
 * прямоугольники с экрана, в тестах — числа. Так геометрию видно без WebView.
 */

/** Прямоугольник слова в координатах поля редактора. */
export interface WordBox {
  top: number;
  bottom: number;
  left: number;
}

export interface BoxSize {
  width: number;
  height: number;
}

/** Просвет между карточкой и краем поля. */
export const MARK_CARD_MARGIN = 6;
/** Отступ карточки от подчёркнутого слова. */
export const MARK_CARD_GAP = 8;
/**
 * Оценка карточки, пока её собственная высота не измерена. Намеренно с запасом:
 * недооценённая высота и была причиной обрезанных кнопок.
 */
export const MARK_CARD_FALLBACK: BoxSize = { width: 304, height: 280 };

/**
 * Место карточки: под словом, а если снизу не помещается — над словом.
 * В обоих случаях результат прижат так, чтобы карточка не вышла за поле.
 */
export function placeMarkCard(word: WordBox, area: BoxSize, card: BoxSize): { top: number; left: number } {
  const height = fit(card.height, area.height, MARK_CARD_FALLBACK.height);
  const width = fit(card.width, area.width, MARK_CARD_FALLBACK.width);

  const below = word.bottom + MARK_CARD_GAP;
  const above = word.top - MARK_CARD_GAP - height;
  const top = below + height <= area.height - MARK_CARD_MARGIN ? below : above;

  const bottomLimit = Math.max(MARK_CARD_MARGIN, area.height - height - MARK_CARD_MARGIN);
  const rightLimit = Math.max(MARK_CARD_MARGIN, area.width - width - MARK_CARD_MARGIN);
  return {
    top: Math.min(Math.max(top, MARK_CARD_MARGIN), bottomLimit),
    left: Math.min(Math.max(word.left, MARK_CARD_MARGIN), rightLimit),
  };
}

/**
 * Размер карточки, ужатый до размеров поля: выше или шире поля она быть не может.
 * Неизмеренная сторона берётся из запаса — по своей мерке, а не по чужой.
 */
function fit(value: number, available: number, fallback: number): number {
  const size = value > 0 ? value : fallback;
  return Math.min(size, Math.max(0, available - MARK_CARD_MARGIN * 2));
}
