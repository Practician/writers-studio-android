/**
 * Зеркальный слой обязан раскладывать текст ровно так же, как поле ввода: иначе
 * волна уезжает под соседнее слово. Метрики не задаём классами — классы считают
 * разметку по-разному для div и для textarea, — а переносим с живого поля
 * напрямую и сверху кладём общие правила, которые стоят на обоих элементах:
 * тогда раскладке просто не с чем разойтись.
 */
export interface MirrorMetricSource {
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  fontStyle: string;
  fontStretch: string;
  fontKerning: string;
  fontVariant: string;
  fontVariantLigatures: string;
  fontFeatureSettings: string;
  letterSpacing: string;
  wordSpacing: string;
  lineHeight: string;
  textIndent: string;
  textTransform: string;
  textAlign: string;
  textAlignLast: string;
  direction: string;
  unicodeBidi: string;
  whiteSpace: string;
  overflowWrap: string;
  wordBreak: string;
  tabSize: string;
  padding: string;
}

/**
 * Общие правила переноса и меры букв. Ставим на поле и на слой одинаково, чтобы
 * системные подстановки (увеличение текста, свои правила переноса) не могли
 * разложить один и тот же текст по-разному.
 */
export const MIRROR_TEXT_INVARIANTS: Record<string, string> = {
  boxSizing: "border-box",
  whiteSpace: "pre-wrap",
  overflowWrap: "break-word",
  wordBreak: "normal",
  hyphens: "none",
  WebkitHyphens: "none",
  WebkitTextSizeAdjust: "100%",
  textSizeAdjust: "100%",
};

/** Ставит стиль с именами вида `WebkitTextSizeAdjust` как CSS-свойство. */
export function applyMirrorStyle(element: HTMLElement, style: Record<string, string>): void {
  for (const [property, value] of Object.entries(style)) {
    if (!value) continue;
    element.style.setProperty(property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`), value);
  }
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
    ...MIRROR_TEXT_INVARIANTS,
    width: `${Math.max(0, Math.round(paddingBoxWidth))}px`,
    fontFamily: source.fontFamily,
    fontSize: source.fontSize,
    fontWeight: source.fontWeight,
    fontStyle: source.fontStyle,
    fontStretch: source.fontStretch,
    fontKerning: source.fontKerning,
    fontVariant: source.fontVariant,
    fontVariantLigatures: source.fontVariantLigatures,
    fontFeatureSettings: source.fontFeatureSettings,
    letterSpacing: source.letterSpacing,
    wordSpacing: source.wordSpacing,
    lineHeight: source.lineHeight,
    textIndent: source.textIndent,
    textTransform: source.textTransform,
    textAlign: source.textAlign,
    textAlignLast: source.textAlignLast,
    direction: source.direction,
    unicodeBidi: source.unicodeBidi,
    whiteSpace: source.whiteSpace,
    overflowWrap: source.overflowWrap,
    wordBreak: source.wordBreak,
    tabSize: source.tabSize,
    padding: source.padding,
    margin: "0",
    borderStyle: "none",
    borderWidth: "0",
  };
}

/** Читает метрики из вычисленного стиля поля ввода. */
export function readMirrorMetricSource(style: CSSStyleDeclaration): MirrorMetricSource {
  return {
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    fontStyle: style.fontStyle,
    fontStretch: style.fontStretch,
    fontKerning: style.fontKerning,
    fontVariant: style.fontVariant,
    fontVariantLigatures: style.fontVariantLigatures,
    fontFeatureSettings: style.fontFeatureSettings,
    letterSpacing: style.letterSpacing,
    wordSpacing: style.wordSpacing,
    lineHeight: style.lineHeight,
    textIndent: style.textIndent,
    textTransform: style.textTransform,
    textAlign: style.textAlign,
    textAlignLast: style.textAlignLast,
    direction: style.direction,
    unicodeBidi: style.unicodeBidi,
    whiteSpace: style.whiteSpace,
    overflowWrap: style.overflowWrap,
    wordBreak: style.wordBreak,
    tabSize: style.tabSize,
    padding: style.padding,
  };
}
