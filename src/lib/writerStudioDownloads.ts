import { registerPlugin } from "@capacitor/core";

export type SavedDownload = {
  uri: string;
  filename: string;
};

export interface WriterStudioDownloadsPlugin {
  saveDocx(options: { filename: string; data: string }): Promise<SavedDownload>;
}

export const WriterStudioDownloads = registerPlugin<WriterStudioDownloadsPlugin>("WriterStudioDownloads");
