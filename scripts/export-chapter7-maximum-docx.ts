/**
 * npx tsx scripts/export-chapter7-maximum-docx.ts
 */
import fs from "node:fs";
import path from "node:path";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  AlignmentType,
  HeadingLevel,
  BorderStyle,
} from "docx";

const src = path.join("test-artifacts", "chapter7", "глава-7-maximum.txt");
const text = fs.readFileSync(src, "utf8");
const words = text.split(/\s+/).filter(Boolean).length;
const outDir = path.join("test-artifacts", "chapter7");
const outPath = path.join(outDir, "Лабиринт-Глава-7-Отпечаток-ладони-maximum.docx");
const downloads = path.join(
  process.env.USERPROFILE || "",
  "Downloads",
  "Лабиринт. Путь домой - Глава 7. Отпечаток ладони (maximum).docx",
);
const parentCopy = path.join(path.resolve(".."), "Главы", "Лабиринт-Глава-7-Отпечаток-ладони-maximum.docx");

const synopsis =
  "Старт: после гл. 6 — заряд ~20%, сытость, отпечаток на стене. Активация ладони, отклик узла, переход. Открывается путь/Уровень 2. Не откатывать заряд к 2%. Не решать кольца заново с нуля как будто гл. 6 не было.";

const body = text
  .split(/\n\n+/)
  .map((line) => line.trim())
  .filter(Boolean)
  .map(
    (block) =>
      new Paragraph({
        spacing: { after: 200, line: 360 },
        indent: { firstLine: 708 },
        alignment: AlignmentType.BOTH,
        children: [
          new TextRun({
            text: block.replace(/\n+/g, " "),
            font: "Times New Roman",
            size: 24,
          }),
        ],
      }),
  );

const doc = new Document({
  styles: {
    default: { document: { run: { font: "Times New Roman", size: 24 } } },
  },
  sections: [
    {
      properties: {
        page: {
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
        },
      },
      children: [
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
          children: [
            new TextRun({
              text: "Лабиринт. Путь домой",
              bold: true,
              font: "Times New Roman",
              size: 32,
            }),
          ],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 120 },
          children: [
            new TextRun({
              text: "Глава: Глава 7. Отпечаток ладони",
              italics: true,
              font: "Times New Roman",
              size: 22,
              color: "555555",
            }),
          ],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 360 },
          border: {
            bottom: { style: BorderStyle.SINGLE, size: 6, color: "EEEEEE", space: 8 },
          },
          children: [
            new TextRun({
              text: `Синопсис: ${synopsis}`,
              italics: true,
              font: "Times New Roman",
              size: 18,
              color: "666666",
            }),
          ],
        }),
        ...body,
      ],
    },
  ],
});

const buf = await Packer.toBuffer(doc);
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outPath, buf);
fs.writeFileSync(downloads, buf);
try {
  fs.mkdirSync(path.dirname(parentCopy), { recursive: true });
  fs.writeFileSync(parentCopy, buf);
  console.log("PARENT", parentCopy);
} catch {
  console.log("PARENT skip");
}
console.log("DOCX", path.resolve(outPath));
console.log("DOWNLOADS", downloads);
console.log("words", words);
