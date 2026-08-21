// Проверка совместимости отчётов Яндекс-нейродетектора с парсером приложения.
// Использование: npx tsx scripts/check-detector-reports.ts <отчёт.json|zip> [ещё...]
import fs from "node:fs";
import path from "node:path";
import { validateDetectorReport, extractJsonFromZip, isAiSegment } from "../src/lib/detectorReport";

async function main() {
  for (const file of process.argv.slice(2)) {
    const bytes = new Uint8Array(fs.readFileSync(file));
    const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
    const json = isZip ? await extractJsonFromZip(bytes) : new TextDecoder("utf-8").decode(bytes);
    const report = validateDetectorReport(JSON.parse(json));
    const aiSegments = report.segments.filter(isAiSegment).length;
    console.log(
      `${path.basename(file)} => сегментов: ${report.stats.segments_count} | AI/LIKELY_AI: ${aiSegments} | длина текста: ${report.text_length}`,
    );
  }
}
main().catch((error) => { console.error(error); process.exit(1); });
