/**
 * Зеркальный слой обязан раскладывать текст ровно так же, как поле ввода: иначе
 * волна уезжает под соседнее слово. Классы Tailwind держат метрики вместе лишь
 * пока браузер считает их одинаково для div и для textarea — на телефоне это не
 * так (система подставляет полю свой шрифт и свою высоту строки). Поэтому
 * метрики не задаём ещё раз классами, а переносим с живого поля напрямую.
 */
export interface MirrorMetricSource {
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  fontStyle: string;
  letterSpacing: string;
  wordSpacing: string;
  lineHeight: string;
  textIndent: string;
  textTransform: string;
  textAlign: string;
  whiteSpace: string;
  overflowWrap: string;
  wordBreak: string;
  tabSize: string;
  padding: string;
}

/**
 * @param paddingBoxWidth ширина рамки поля (clientWidth): у зеркала
 *        box-sizing тоже border-box, поэтому содержимое совпадёт с полем.
 */
export function mirrorMetricsFrom(
  source: MirrorMetricSource,
  paddingBoxWidth: number,
): Record<string, string> {
  return {
    boxSizing: "border-box",
    width: `${Math.max(0, Math.round(paddingBoxWidth))}px`,
    fontFamily: source.fontFamily,
    fontSize: source.fontSize,
    fontWeight: source.fontWeight,
    fontStyle: source.fontStyle,
    letterSpacing: source.letterSpacing,
    wordSpacing: source.wordSpacing,
    lineHeight: source.lineHeight,
    textIndent: source.textIndent,
    textTransform: source.textTransform,
    textAlign: source.textAlign,
    whiteSpace: source.whiteSpace,
    overflowWrap: source.overflowWrap,
    wordBreak: source.wordBreak,
    tabSize: source.tabSize,
    padding: source.padding,
    margin: "0",
    // Системное «увеличение текста» тянет буквы в div и не трогает поле ввода.
    webkitTextSizeAdjust: "100%",
    textSizeAdjust: "100%",
  };
}

/** Читает метрики из вычисленного стиля поля ввода. */
export function readMirrorMetricSource(style: CSSStyleDeclaration): MirrorMetricSource {
  return {
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    fontStyle: style.fontStyle,
    letterSpacing: style.letterSpacing,
    wordSpacing: style.wordSpacing,
    lineHeight: style.lineHeight,
    textIndent: style.textIndent,
    textTransform: style.textTransform,
    textAlign: style.textAlign,
    whiteSpace: style.whiteSpace,
    overflowWrap: style.overflowWrap,
    wordBreak: style.wordBreak,
    tabSize: style.tabSize,
    padding: style.padding,
  };
}
