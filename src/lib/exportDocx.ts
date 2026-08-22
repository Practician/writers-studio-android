/**
 * Настоящий Word OOXML (.docx) через пакет docx.
 * Раньше экспорт отдавал HTML с MIME application/msword и расширением .doc —
 * Word открывал, но это не современный .docx.
 */
import { Capacitor } from "@capacitor/core";
import type { Chapter, Story } from "../types";

export type DocxExportResult = {
  filename: string;
  savedNatively: boolean;
  openedInDocumentApp: boolean;
};

function downloadBlob(blob: Blob, filename: string): DocxExportResult {
  const element = document.createElement("a");
  const url = URL.createObjectURL(blob);
  element.href = url;
  element.download = filename;
  document.body.appendChild(element);
  element.click();
  document.body.removeChild(element);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return { filename, savedNatively: false, openedInDocumentApp: false };
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

/**
 * Ссылка <a download> не передаёт файл в Android WebView. В APK сохраняем настоящий
 * DOCX непосредственно в общую папку Downloads через MediaStore, затем передаём его
 * штатному приложению для просмотра. В браузере остаётся обычное скачивание.
 */
async function saveDocx(blob: Blob, filename: string): Promise<DocxExportResult> {
  if (!Capacitor.isNativePlatform()) return downloadBlob(blob, filename);

  const [{ FileOpener }, { WriterStudioDownloads }] = await Promise.all([
    import("@capawesome-team/capacitor-file-opener"),
    import("./writerStudioDownloads"),
  ]);
  const file = await WriterStudioDownloads.saveDocx({
    filename,
    data: await blobToBase64(blob),
  });

  try {
    await FileOpener.openFile({
      path: file.uri,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    return { filename, savedNatively: true, openedInDocumentApp: true };
  } catch (error) {
    console.warn("DOCX сохранён, но не удалось открыть его через системное приложение", error);
    return { filename, savedNatively: true, openedInDocumentApp: false };
  }
}

function sanitizeFilename(name: string): string {
  return name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim() || "document";
}

type DocxModule = typeof import("docx");

/** Разбить текст на абзацы (пустые строки = разделитель). */
function textToParagraphs(
  text: string,
  { Paragraph, TextRun, AlignmentType }: Pick<DocxModule, "Paragraph" | "TextRun" | "AlignmentType">,
) {
  const blocks = text.split(/\n\n+/);
  const out: InstanceType<DocxModule["Paragraph"]>[] = [];

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    // Одиночные переносы внутри абзаца — пробел (как в типичном Word-наборе)
    const plain = trimmed.replace(/\n+/g, " ");
    out.push(
      new Paragraph({
        spacing: { after: 200, line: 360 },
        indent: { firstLine: 708 },
        alignment: AlignmentType.BOTH,
        children: [
          new TextRun({
            text: plain,
            font: "Times New Roman",
            size: 24, // 12pt
          }),
        ],
      }),
    );
  }

  if (out.length === 0) {
    out.push(
      new Paragraph({
        children: [new TextRun({ text: "", font: "Times New Roman", size: 24 })],
      }),
    );
  }
  return out;
}

export async function exportChapterDocx(storyTitle: string, chapter: Chapter): Promise<DocxExportResult> {
  const docx = await import("docx");
  const { Document, Packer, Paragraph, TextRun, AlignmentType, HeadingLevel, BorderStyle } = docx;

  const bodyParas = textToParagraphs(chapter.content || "", { Paragraph, TextRun, AlignmentType });

  const children: InstanceType<typeof Paragraph>[] = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      children: [
        new TextRun({
          text: storyTitle,
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
          text: `Глава: ${chapter.title}`,
          italics: true,
          font: "Times New Roman",
          size: 22,
          color: "555555",
        }),
      ],
    }),
  ];

  if (chapter.summary?.trim()) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 360 },
        border: {
          bottom: { style: BorderStyle.SINGLE, size: 6, color: "EEEEEE", space: 8 },
        },
        children: [
          new TextRun({
            text: `Синопсис: ${chapter.summary}`,
            italics: true,
            font: "Times New Roman",
            size: 20,
            color: "666666",
          }),
        ],
      }),
    );
  } else {
    children.push(new Paragraph({ spacing: { after: 360 }, children: [] }));
  }

  children.push(...bodyParas);

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: "Times New Roman", size: 24 },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
          },
        },
        children,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  return saveDocx(blob, sanitizeFilename(`${storyTitle} - ${chapter.title}.docx`));
}

export async function exportStoryDocx(story: Story): Promise<DocxExportResult> {
  const docx = await import("docx");
  const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    AlignmentType,
    HeadingLevel,
    PageBreak,
    BorderStyle,
  } = docx;

  const children: InstanceType<typeof Paragraph>[] = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      children: [
        new TextRun({
          text: story.title,
          bold: true,
          font: "Times New Roman",
          size: 36,
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
      children: [
        new TextRun({
          text: `Жанр: ${story.genre || "—"}`,
          italics: true,
          font: "Times New Roman",
          size: 20,
          color: "666666",
        }),
      ],
    }),
  ];

  if (story.description?.trim()) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 400 },
        border: {
          bottom: { style: BorderStyle.SINGLE, size: 6, color: "EEEEEE", space: 12 },
        },
        children: [
          new TextRun({
            text: story.description,
            italics: true,
            font: "Times New Roman",
            size: 20,
            color: "666666",
          }),
        ],
      }),
    );
  }

  story.chapters.forEach((ch) => {
    // Каждая глава с новой страницы (как в прежнем HTML-экспорте)
    children.push(
      new Paragraph({
        children: [new PageBreak()],
      }),
    );

    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { after: 120 },
        children: [
          new TextRun({
            text: ch.title,
            bold: true,
            font: "Times New Roman",
            size: 28,
            color: "1D4ED8",
          }),
        ],
      }),
    );

    if (ch.summary?.trim()) {
      children.push(
        new Paragraph({
          spacing: { after: 200 },
          children: [
            new TextRun({
              text: `Синопсис главы: ${ch.summary}`,
              italics: true,
              font: "Times New Roman",
              size: 20,
              color: "555555",
            }),
          ],
        }),
      );
    }

    children.push(...textToParagraphs(ch.content || "", { Paragraph, TextRun, AlignmentType }));
  });

  if (story.characters.length > 0) {
    children.push(
      new Paragraph({ children: [new PageBreak()] }),
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { after: 200 },
        children: [
          new TextRun({
            text: "Действующие лица",
            bold: true,
            font: "Times New Roman",
            size: 28,
            color: "1D4ED8",
          }),
        ],
      }),
    );

    for (const char of story.characters) {
      const lines = [
        `Имя: ${char.name}`,
        `Роль: ${char.role}`,
        `Черты: ${char.traits || "не указаны"}`,
        `Цель: ${char.goals || "не указана"}`,
        `Биография:`,
        char.description || "",
      ];
      for (const line of lines) {
        children.push(
          new Paragraph({
            spacing: { after: 80 },
            children: [
              new TextRun({
                text: line,
                font: "Times New Roman",
                size: 22,
              }),
            ],
          }),
        );
      }
      children.push(new Paragraph({ spacing: { after: 200 }, children: [] }));
    }
  }

  if (story.worldRules.length > 0) {
    children.push(
      new Paragraph({ children: [new PageBreak()] }),
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { after: 200 },
        children: [
          new TextRun({
            text: "Правила мира и Лор",
            bold: true,
            font: "Times New Roman",
            size: 28,
            color: "1D4ED8",
          }),
        ],
      }),
    );

    for (const rule of story.worldRules) {
      children.push(
        new Paragraph({
          spacing: { before: 200, after: 100 },
          children: [
            new TextRun({
              text: rule.title,
              bold: true,
              font: "Times New Roman",
              size: 24,
              color: "1D4ED8",
            }),
          ],
        }),
      );
      children.push(...textToParagraphs(rule.content || "", { Paragraph, TextRun, AlignmentType }));
    }
  }

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: "Times New Roman", size: 24 },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
          },
        },
        children,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  return saveDocx(blob, sanitizeFilename(`${story.title}.docx`));
}
