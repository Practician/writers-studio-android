import assert from "node:assert/strict";
import { test } from "node:test";
import { mirrorMetricsFrom, type MirrorMetricSource } from "../src/lib/mirrorMetrics";

const source: MirrorMetricSource = {
  fontFamily: 'Roboto, "Noto Sans", sans-serif',
  fontSize: "15px",
  fontWeight: "400",
  fontStyle: "normal",
  letterSpacing: "normal",
  wordSpacing: "0px",
  lineHeight: "28px",
  textIndent: "0px",
  textTransform: "none",
  textAlign: "start",
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
});

test("ширина берётся по рамке поля и считается так же", () => {
  const metrics = mirrorMetricsFrom(source, 326);
  assert.equal(metrics.width, "326px");
  assert.equal(metrics.boxSizing, "border-box");
});

test("поле ещё не разложено — ширина не уходит в минус", () => {
  assert.equal(mirrorMetricsFrom(source, -5).width, "0px");
});

test("системное увеличение текста погашено, иначе метки уезжают", () => {
  const metrics = mirrorMetricsFrom(source, 300);
  assert.equal(metrics.webkitTextSizeAdjust, "100%");
  assert.equal(metrics.textSizeAdjust, "100%");
});
