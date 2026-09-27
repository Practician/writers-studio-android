/**
 * Где стоять каретке и куда прокрутить поле после правки.
 *
 * Замена приходит из карточки метки: React переписывает значение поля сам, а поле
 * от этого уводит каретку в конец текста и показывает автору последнюю строку главы
 * вместо исправленного слова. Поэтому место правки считается здесь, заранее,
 * и восстанавливается сразу после того, как значение попало в поле.
 */

/** Куда вернуть каретку: сразу за вставленным текстом, внутри границ текста. */
export function caretAfterReplace(start: number, replacement: string, textLength: number): number {
  if (!Number.isFinite(start) || start < 0) return 0;
  const position = start + (replacement || "").length;
  if (!Number.isFinite(textLength) || textLength < 0) return Math.max(0, position);
  return Math.min(Math.max(0, position), textLength);
}

/** Номер строки, в которой стоит смещение. Строки считаем по переводу строки, с нуля. */
export function lineIndexOfOffset(text: string, offset: number): number {
  if (!text) return 0;
  if (!Number.isFinite(offset) || offset <= 0) return 0;
  const limit = Math.min(Math.floor(offset), text.length);
  let line = 0;
  for (let index = 0; index < limit; index += 1) {
    if (text.charCodeAt(index) === 10) line += 1;
  }
  return line;
}

/**
 * Прокрутка, при которой строка встаёт посередине поля.
 * Больше максимума прокрутки не бывает: прежний расчёт умножал номер строки на
 * постоянные 28 px, промахивался на больших главах, и поле уезжало в самый конец —
 * найденное место оставалось за экраном.
 */
export function scrollTopToReveal(
  lineIndex: number,
  lineHeight: number,
  clientHeight: number,
  maxScroll: number,
): number {
  const height = Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight : 28;
  const view = Number.isFinite(clientHeight) && clientHeight > 0 ? clientHeight : 0;
  const limit = Number.isFinite(maxScroll) && maxScroll > 0 ? maxScroll : 0;
  const wanted = Math.max(0, Number.isFinite(lineIndex) ? lineIndex : 0) * height - view / 2;
  return Math.min(Math.max(0, wanted), limit);
}
