import test from "node:test";
import assert from "node:assert/strict";
import { extractJsonFromZip, isAiSegment, validateDetectorReport } from "../src/lib/detectorReport";

function storedZip(filename: string, content: string): Uint8Array {
  const encoder = new TextEncoder();
  const name = encoder.encode(filename);
  const data = encoder.encode(content);
  const localSize = 30 + name.length + data.length;
  const centralSize = 46 + name.length;
  const output = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(output.buffer);
  let cursor = 0;
  view.setUint32(cursor, 0x04034b50, true); cursor += 4;
  view.setUint16(cursor, 20, true); cursor += 2;
  view.setUint16(cursor, 0, true); cursor += 2;
  view.setUint16(cursor, 0, true); cursor += 2;
  cursor += 8;
  view.setUint32(cursor, data.length, true); cursor += 4;
  view.setUint32(cursor, data.length, true); cursor += 4;
  view.setUint16(cursor, name.length, true); cursor += 2;
  view.setUint16(cursor, 0, true); cursor += 2;
  output.set(name, cursor); cursor += name.length;
  output.set(data, cursor); cursor += data.length;
  const centralOffset = cursor;
  view.setUint32(cursor, 0x02014b50, true); cursor += 4;
  view.setUint16(cursor, 20, true); cursor += 2;
  view.setUint16(cursor, 20, true); cursor += 2;
  view.setUint16(cursor, 0, true); cursor += 2;
  view.setUint16(cursor, 0, true); cursor += 2;
  cursor += 8;
  view.setUint32(cursor, data.length, true); cursor += 4;
  view.setUint32(cursor, data.length, true); cursor += 4;
  view.setUint16(cursor, name.length, true); cursor += 2;
  view.setUint16(cursor, 0, true); cursor += 2;
  view.setUint16(cursor, 0, true); cursor += 2;
  view.setUint16(cursor, 0, true); cursor += 2;
  view.setUint16(cursor, 0, true); cursor += 2;
  view.setUint32(cursor, 0, true); cursor += 4;
  view.setUint32(cursor, 0, true); cursor += 4;
  output.set(name, cursor); cursor += name.length;
  const centralLength = cursor - centralOffset;
  view.setUint32(cursor, 0x06054b50, true); cursor += 4;
  view.setUint16(cursor, 0, true); cursor += 2;
  view.setUint16(cursor, 0, true); cursor += 2;
  view.setUint16(cursor, 1, true); cursor += 2;
  view.setUint16(cursor, 1, true); cursor += 2;
  view.setUint32(cursor, centralLength, true); cursor += 4;
  view.setUint32(cursor, centralOffset, true); cursor += 4;
  view.setUint16(cursor, 0, true);
  return output;
}

const reportValue = {
  time: "2026-07-11T00:00:00Z",
  filename: null,
  stats: { segments_count: 2, AI_count: 1, LIKELY_AI_count: 0, LIKELY_HUMAN_count: 0, HUMAN_count: 1 },
  segments: [
    { len: 4, text: "ИИ. ", label: "AI" },
    { len: 8, text: "Человек.", label: "HUMAN" },
  ],
  short_text_warning: true,
  text_length: 12,
};

test("detector report validation derives exact offsets", () => {
  const report = validateDetectorReport(reportValue);
  assert.equal(report.fullText, "ИИ. Человек.");
  assert.deepEqual(report.segments.map(({ start, end }) => [start, end]), [[0, 4], [4, 12]]);
  assert.equal(isAiSegment(report.segments[0]), true);
  assert.equal(isAiSegment(report.segments[1]), false);
});

test("detector report rejects inconsistent counters", () => {
  assert.throws(() => validateDetectorReport({ ...reportValue, text_length: 13 }), /text_length/u);
});

// Новые версии нейродетектора добавляют UNKNOWN-сегменты, не учитываемые в stats
test("detector report accepts UNKNOWN segments outside of stats", () => {
  const report = validateDetectorReport({
    ...reportValue,
    segments: [
      { len: 4, text: "ИИ. ", label: "AI" },
      { len: 3, text: "?? ", label: "UNKNOWN" },
      { len: 8, text: "Человек.", label: "HUMAN" },
    ],
    text_length: 15,
  });
  assert.equal(report.segments.length, 3);
  assert.equal(report.stats.segments_count, 2);
  assert.equal(isAiSegment(report.segments[1]), false);
});

test("JSON can be extracted from a ZIP without changing its content", async () => {
  const json = JSON.stringify(reportValue);
  assert.equal(await extractJsonFromZip(storedZip("report.json", json)), json);
});
