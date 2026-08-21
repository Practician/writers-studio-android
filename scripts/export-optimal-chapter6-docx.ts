import fs from "node:fs";
import path from "node:path";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  Header,
  Footer,
  PageNumber,
  BorderStyle,
} from "docx";

const src = path.join("test-artifacts", "chapter6-optimal", "глава-6-optimal.txt");
const text = fs.readFileSync(src, "utf8");
const words = text.split(/\s+/).filter(Boolean).length;
const outDir = path.join("test-artifacts", "chapter6-optimal");
const outPath = path.join(outDir, "Лабиринт-Глава-6-Число-20-optimal.docx");
const copyPath = path.join("test-artifacts", "chapter6", "Лабиринт-Глава-6-Число-20-optimal.docx");
const parentCopy = path.join(path.resolve(".."), "Главы", "Лабиринт-Глава-6-Число-20-optimal.docx");

const body = text
  .split(/\n+/)
  .map((line) => line.trim())
  .filter(Boolean)
  .map(
    (line) =>
      new Paragraph({
        spacing: { after: 200, line: 360 },
        indent: /^[—–\-]/.test(line) ? {} : { firstLine: 708 },
        children: [new TextRun({ text: line, font: "Times New Roman", size: 24 })],
      }),
  );

const doc = new Document({
  styles: {
    default: { document: { run: { font: "Times New Roman", size: 24 } } },
    paragraphStyles: [
      {
        id: "Heading1",
        name: "Heading 1",
        basedOn: "Normal",
        next: "Normal",
        quickFormat: true,
        run: { size: 32, bold: true, font: "Times New Roman" },
        paragraph: { spacing: { before: 240, after: 240 }, outlineLevel: 0 },
      },
    ],
  },
  sections: [
    {
      properties: {
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: 1134, right: 850, bottom: 1134, left: 1134 },
        },
      },
      headers: {
        default: new Header({
          children: [
            new Paragraph({
              children: [
                new TextRun({
                  text: "Лабиринт. Путь домой — Глава 6",
                  font: "Times New Roman",
                  size: 16,
                  color: "888888",
                }),
              ],
            }),
          ],
        }),
      },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({ text: "стр. ", font: "Times New Roman", size: 16, color: "888888" }),
                new TextRun({
                  children: [PageNumber.CURRENT],
                  font: "Times New Roman",
                  size: 16,
                  color: "888888",
                }),
              ],
            }),
          ],
        }),
      },
      children: [
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({
              text: "Лабиринт. Путь домой",
              font: "Times New Roman",
              size: 32,
              bold: true,
            }),
          ],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
          children: [
            new TextRun({
              text: "Глава 6. Число 20",
              font: "Times New Roman",
              size: 28,
              bold: true,
            }),
          ],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 400 },
          border: {
            bottom: { style: BorderStyle.SINGLE, size: 6, color: "666666", space: 1 },
          },
          children: [
            new TextRun({
              text: `Оптимальный текст · ${words} слов · Yandex ~0% AI · ${new Date().toISOString().slice(0, 10)}`,
              font: "Times New Roman",
              size: 18,
              italics: true,
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
fs.mkdirSync(path.dirname(copyPath), { recursive: true });
fs.writeFileSync(outPath, buf);
fs.writeFileSync(copyPath, buf);
try {
  fs.mkdirSync(path.dirname(parentCopy), { recursive: true });
  fs.writeFileSync(parentCopy, buf);
  console.log("PARENT", parentCopy);
} catch {
  /* optional */
}
console.log("DOCX", path.resolve(outPath));
console.log("COPY", path.resolve(copyPath));
console.log("words", words);
