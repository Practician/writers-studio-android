import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MIRROR_TEXT_INVARIANTS,
  applyMirrorStyle,
  mirrorMetricsFrom,
  type MirrorMetricSource,
} from "../src/lib/mirrorMetrics";

const source: MirrorMetricSource = {
  fontFamily: 'Roboto, "Noto Sans", sans-serif',
  fontSize: "15px",
  fontWeight: "400",
  fontStyle: "normal",
  fontStretch: "100%",
  fontKerning: "auto",
  fontVariant: "normal",
  fontVariantLigatures: "normal",
  fontFeatureSettings: "normal",
  letterSpacing: "normal",
  wordSpacing: "0px",
  lineHeight: "28px",
  textIndent: "0px",
  textTransform: "none",
  textAlign: "start",
  textAlignLast: "auto",
  direction: "ltr",
  unicodeBidi: "normal",
  whiteSpace: "pre-wrap",
  overflowWrap: "break-word",
  wordBreak: "normal",
  tabSize: "8",
  padding: "16px",
};

test("зеркало получает с поля всё, что двигает строки", () => {
  const metrics = mirrorMetricsFrom(source, 326);
  assert.equal(metrics.fontFamily, source.fontFamily);
  assert.equal(metrics.fontSize, "15px");
  assert.equal(metrics.lineHeight, "28px");
  assert.equal(metrics.padding, "16px");
  assert.equal(metrics.whiteSpace, "pre-wrap");
  assert.equal(metrics.overflowWrap, "break-word");
  assert.equal(metrics.letterSpacing, "normal");
  assert.equal(metrics.fontKerning, "auto");
  assert.equal(metrics.direction, "ltr");
});

test("ширина берётся по рамке поля и считается так же", () => {
  const metrics = mirrorMetricsFrom(source, 326);
  assert.equal(metrics.width, "326px");
  assert.equal(metrics.boxSizing, "border-box");
  assert.equal(metrics.borderWidth, "0");
});

test("поле ещё не разложено — ширина не уходит в минус", () => {
  assert.equal(mirrorMetricsFrom(source, -5).width, "0px");
});

test("системное увеличение текста погашено, иначе метки уезжают", () => {
  const metrics = mirrorMetricsFrom(source, 300);
  assert.equal(metrics.WebkitTextSizeAdjust, "100%");
  assert.equal(metrics.textSizeAdjust, "100%");
});

test("правила переноса одни и те же для поля и для слоя", () => {
  // Эти же правила уходят в style поля ввода: разойтись раскладке не с чем.
  assert.equal(MIRROR_TEXT_INVARIANTS.whiteSpace, "pre-wrap");
  assert.equal(MIRROR_TEXT_INVARIANTS.overflowWrap, "break-word");
  assert.equal(MIRROR_TEXT_INVARIANTS.wordBreak, "normal");
  assert.equal(MIRROR_TEXT_INVARIANTS.hyphens, "none");
  assert.equal(MIRROR_TEXT_INVARIANTS.WebkitTextSizeAdjust, "100%");
  const metrics = mirrorMetricsFrom(source, 300);
  for (const [property, value] of Object.entries(MIRROR_TEXT_INVARIANTS)) {
    assert.equal(metrics[property], value, `слой потерял правило ${property}`);
  }
});

test("стиль ставится на элемент как CSS, а не как поле объекта", () => {
  const element = { style: { properties: {}, setProperty(name: string, value: string) { this.properties[name] = value; } } };
  applyMirrorStyle(element as unknown as HTMLElement, { WebkitTextSizeAdjust: "100%", boxSizing: "border-box" });
  assert.equal(element.style.properties["-webkit-text-size-adjust"], "100%");
  assert.equal(element.style.properties["box-sizing"], "border-box");
});

test("пустые значения не затирают раскладку поля", () => {
  const element = { style: { properties: {}, setProperty(name: string, value: string) { this.properties[name] = value; } } };
  applyMirrorStyle(element as unknown as HTMLElement, { fontFeatureSettings: "", tabSize: "8" });
  assert.deepEqual(Object.keys(element.style.properties), ["tab-size"]);
});
