import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { exportChapterDocx, exportStoryDocx } from "../src/lib/exportDocx";
import type { Chapter, Story } from "../src/types";

type DownloadCapture = { blob: Blob; filename: string };

async function captureDocx(createDocument: () => Promise<unknown>): Promise<DownloadCapture> {
  const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
  const urlDescriptor = Object.getOwnPropertyDescriptor(globalThis, "URL");
  const timeoutDescriptor = Object.getOwnPropertyDescriptor(globalThis, "setTimeout");
  let capture: DownloadCapture | undefined;
  let createdBlob: Blob | undefined;

  const anchor: { href: string; download: string; click: () => void } = {
    href: "",
    download: "",
    click: () => {
      if (createdBlob) capture = { blob: createdBlob, filename: anchor.download };
    },
  };

  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      createElement: () => anchor,
      body: { appendChild: () => undefined, removeChild: () => undefined },
    },
  });
  Object.defineProperty(globalThis, "URL", {
    configurable: true,
    value: {
      createObjectURL: (blob: Blob) => {
        createdBlob = blob;
        return "blob:writers-studio-docx";
      },
      revokeObjectURL: () => undefined,
    },
  });
  Object.defineProperty(globalThis, "setTimeout", {
    configurable: true,
    value: (callback: () => void) => {
      callback();
      return 0;
    },
  });

  try {
    await createDocument();
    assert.ok(capture, "DOCX-экспорт должен создать файл для скачивания");
    return capture;
  } finally {
    if (documentDescriptor) Object.defineProperty(globalThis, "document", documentDescriptor);
    else delete (globalThis as { document?: unknown }).document;
    if (urlDescriptor) Object.defineProperty(globalThis, "URL", urlDescriptor);
    else delete (globalThis as { URL?: unknown }).URL;
    if (timeoutDescriptor) Object.defineProperty(globalThis, "setTimeout", timeoutDescriptor);
  }
}

async function documentXml(blob: Blob): Promise<string> {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const entry = zip.file("word/document.xml");
  assert.ok(entry, "DOCX должен содержать word/document.xml");
  return entry.async("string");
}

const firstChapter: Chapter = {
  id: "chapter-1",
  title: "Глава 1. Тёмная станция",
  summary: "Лера получает ключ от закрытого перехода.",
  content: "Над перроном дрожал жёлтый свет.\nПоезда не было.\n\nЛера сжала ключ в ладони и пошла к тоннелю.",
};

const secondChapter: Chapter = {
  id: "chapter-2",
  title: "Глава 2. Голос в тоннеле",
  summary: "Невидимый собеседник зовёт Леру по имени.",
  content: "В глубине тоннеля прозвучал знакомый голос.",
};

test("DOCX одной главы содержит русское название книги, главы, синопсис и все абзацы", async () => {
  const file = await captureDocx(() => exportChapterDocx("Лабиринт", firstChapter));
  const xml = await documentXml(file.blob);

  assert.equal(file.filename, "Лабиринт - Глава 1. Тёмная станция.docx");
  assert.equal(xml.includes("Лабиринт"), true);
  assert.equal(xml.includes("Глава: Глава 1. Тёмная станция"), true);
  assert.equal(xml.includes("Синопсис: Лера получает ключ от закрытого перехода."), true);
  assert.equal(xml.includes("Над перроном дрожал жёлтый свет. Поезда не было."), true);
  assert.equal(xml.includes("Лера сжала ключ в ладони и пошла к тоннелю."), true);
});

test("DOCX всей книги сохраняет порядок всех глав, включая пустой слот, персонажей и правила мира", async () => {
  const story: Story = {
    id: "labyrinth",
    title: "Лабиринт",
    genre: "Мистический роман",
    description: "История о городе под городом.",
    chapters: [
      firstChapter,
      secondChapter,
      { id: "chapter-3", title: "Глава 3. Пустой слот", summary: "", content: "" },
    ],
    characters: [{ id: "lera", name: "Лера", role: "Героиня", description: "Ищет брата.", traits: "Упрямая", goals: "Найти выход" }],
    worldRules: [{ id: "rule-1", title: "Правило ключа", content: "Ключ открывает только один переход." }],
    updatedAt: 0,
  };
  const file = await captureDocx(() => exportStoryDocx(story));
  const xml = await documentXml(file.blob);

  assert.equal(file.filename, "Лабиринт.docx");
  assert.equal(xml.includes("Лабиринт"), true);
  assert.equal(xml.includes("Жанр: Мистический роман"), true);
  assert.equal(xml.includes("Глава 1. Тёмная станция"), true);
  assert.equal(xml.includes("Глава 2. Голос в тоннеле"), true);
  assert.equal(xml.includes("Глава 3. Пустой слот"), true);
  assert.equal(xml.indexOf("Глава 1. Тёмная станция") < xml.indexOf("Глава 2. Голос в тоннеле"), true);
  assert.equal(xml.indexOf("Глава 2. Голос в тоннеле") < xml.indexOf("Глава 3. Пустой слот"), true);
  assert.equal(xml.includes("Действующие лица"), true);
  assert.equal(xml.includes("Имя: Лера"), true);
  assert.equal(xml.includes("Правила мира и Лор"), true);
  assert.equal(xml.includes("Правило ключа"), true);
});
