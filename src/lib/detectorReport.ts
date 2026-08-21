// UNKNOWN — новые версии нейродетектора помечают так короткие сегменты,
// не прошедшие классификацию; в stats они не учитываются.
export type DetectorLabel = "AI" | "LIKELY_AI" | "LIKELY_HUMAN" | "HUMAN" | "UNKNOWN";

export interface DetectorSegment {
  len: number;
  text: string;
  label: DetectorLabel;
  start: number;
  end: number;
}

export interface DetectorReport {
  time: string;
  filename: string | null;
  stats: {
    segments_count: number;
    AI_count: number;
    LIKELY_AI_count: number;
    LIKELY_HUMAN_count: number;
    HUMAN_count: number;
  };
  segments: DetectorSegment[];
  short_text_warning: boolean;
  text_length: number;
  fullText: string;
}

const LABELS = new Set<DetectorLabel>(["AI", "LIKELY_AI", "LIKELY_HUMAN", "HUMAN", "UNKNOWN"]);

function expectObject(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name}: ожидался объект`);
  }
  return value as Record<string, unknown>;
}

function expectInteger(value: unknown, name: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Error(`${name}: ожидалось неотрицательное целое число`);
  }
  return value as number;
}

export function validateDetectorReport(value: unknown): DetectorReport {
  const root = expectObject(value, "Отчёт");
  if (!Array.isArray(root.segments) || root.segments.length === 0) {
    throw new Error("Отчёт не содержит segments[]");
  }
  const statsInput = expectObject(root.stats, "stats");
  const stats = {
    segments_count: expectInteger(statsInput.segments_count, "stats.segments_count"),
    AI_count: expectInteger(statsInput.AI_count, "stats.AI_count"),
    LIKELY_AI_count: expectInteger(statsInput.LIKELY_AI_count, "stats.LIKELY_AI_count"),
    LIKELY_HUMAN_count: expectInteger(statsInput.LIKELY_HUMAN_count, "stats.LIKELY_HUMAN_count"),
    HUMAN_count: expectInteger(statsInput.HUMAN_count, "stats.HUMAN_count"),
  };

  let offset = 0;
  const counts: Record<DetectorLabel, number> = { AI: 0, LIKELY_AI: 0, LIKELY_HUMAN: 0, HUMAN: 0, UNKNOWN: 0 };
  const segments = root.segments.map((rawSegment, index): DetectorSegment => {
    const segment = expectObject(rawSegment, `segments[${index}]`);
    if (typeof segment.text !== "string" || !segment.text.length) {
      throw new Error(`segments[${index}].text: ожидалась непустая строка`);
    }
    if (typeof segment.label !== "string" || !LABELS.has(segment.label as DetectorLabel)) {
      throw new Error(`segments[${index}].label: неизвестная метка`);
    }
    const length = expectInteger(segment.len, `segments[${index}].len`);
    if (length !== segment.text.length) {
      throw new Error(`segments[${index}].len не совпадает с длиной текста`);
    }
    const start = offset;
    offset += segment.text.length;
    const label = segment.label as DetectorLabel;
    counts[label] += 1;
    return { len: length, text: segment.text, label, start, end: offset };
  });

  const textLength = expectInteger(root.text_length, "text_length");
  if (textLength !== offset) throw new Error("text_length не совпадает с суммой сегментов");
  // UNKNOWN-сегменты не входят в stats.segments_count
  const classifiedCount = segments.length - counts.UNKNOWN;
  if (stats.segments_count !== classifiedCount) throw new Error("stats.segments_count не совпадает с числом классифицированных сегментов");
  if (
    stats.AI_count !== counts.AI ||
    stats.LIKELY_AI_count !== counts.LIKELY_AI ||
    stats.LIKELY_HUMAN_count !== counts.LIKELY_HUMAN ||
    stats.HUMAN_count !== counts.HUMAN
  ) {
    throw new Error("Счётчики stats не совпадают с метками сегментов");
  }

  return {
    time: typeof root.time === "string" ? root.time : "",
    filename: typeof root.filename === "string" ? root.filename : null,
    stats,
    segments,
    short_text_warning: Boolean(root.short_text_warning),
    text_length: textLength,
    fullText: segments.map((segment) => segment.text).join(""),
  };
}

function findEndOfCentralDirectory(bytes: Uint8Array): number {
  const minimum = Math.max(0, bytes.length - 65_557);
  for (let index = bytes.length - 22; index >= minimum; index -= 1) {
    if (
      bytes[index] === 0x50 && bytes[index + 1] === 0x4b &&
      bytes[index + 2] === 0x05 && bytes[index + 3] === 0x06
    ) return index;
  }
  throw new Error("ZIP: не найдена центральная директория");
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("Этот браузер не поддерживает распаковку ZIP");
  }
  const input = new Uint8Array(bytes);
  const stream = new Blob([input]).stream().pipeThrough(new DecompressionStream("deflate-raw" as CompressionFormat));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function extractJsonFromZip(bytes: Uint8Array): Promise<string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEndOfCentralDirectory(bytes);
  const entries = view.getUint16(eocd + 10, true);
  let cursor = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder("utf-8");

  for (let index = 0; index < entries; index += 1) {
    if (view.getUint32(cursor, true) !== 0x02014b50) throw new Error("ZIP: повреждена центральная директория");
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const filenameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const filename = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + filenameLength));

    if (filename.toLowerCase().endsWith(".json")) {
      if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error("ZIP: повреждён локальный заголовок");
      const localNameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = bytes.subarray(dataStart, dataStart + compressedSize);
      const unpacked = method === 0 ? new Uint8Array(compressed) : method === 8 ? await inflateRaw(compressed) : null;
      if (!unpacked) throw new Error(`ZIP: метод сжатия ${method} не поддерживается`);
      return decoder.decode(unpacked);
    }
    cursor += 46 + filenameLength + extraLength + commentLength;
  }
  throw new Error("ZIP не содержит JSON-отчёт");
}

export async function readDetectorReport(file: File): Promise<DetectorReport> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isZip = file.name.toLowerCase().endsWith(".zip") || (bytes[0] === 0x50 && bytes[1] === 0x4b);
  const text = isZip ? await extractJsonFromZip(bytes) : new TextDecoder("utf-8").decode(bytes);
  try {
    return validateDetectorReport(JSON.parse(text));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("Файл не является корректным JSON");
    throw error;
  }
}

export function isAiSegment(segment: Pick<DetectorSegment, "label">): boolean {
  return segment.label === "AI" || segment.label === "LIKELY_AI";
}
