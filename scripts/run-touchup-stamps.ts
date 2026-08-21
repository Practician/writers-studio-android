import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import { aiTellScore } from "../server/humanStyle";
import { humanizeProseDraft } from "../server/chapterGenerate";

dotenv.config();

const outDir = path.resolve(process.cwd(), "..", "тест-очеловечивание");
const text = fs.readFileSync(path.join(outDir, "2-ии-текст-до.txt"), "utf8");
const idx = text.search(/пугающей|прорвал|словно нехотя|не просто/iu);
const slice = text.slice(Math.max(0, idx - 200), Math.min(text.length, idx + 2800));
const before = aiTellScore(slice);
console.log("slice", slice.length, "score", before.score, "hits", before.hits.map((h) => h.label).join("; "));

const keys = [process.env.GEMINI_API_KEY_2, process.env.GEMINI_API_KEY, process.env.GEMINI_API_KEY_3].filter(Boolean) as string[];
const models = ["gemini-2.0-flash", "gemini-2.5-flash-lite", "gemini-2.5-flash"];

async function tryOnce(apiKey: string, model: string) {
  const ai = new GoogleGenAI({ apiKey });
  const generate = async (params: {
    model: string;
    contents: string;
    systemInstruction: string;
    temperature: number;
    responseMimeType?: string;
    responseSchema?: unknown;
    maxOutputTokens?: number;
  }) => {
    const response = await ai.models.generateContent({
      model: params.model,
      contents: params.contents,
      config: {
        systemInstruction: params.systemInstruction,
        temperature: params.temperature,
        responseMimeType: params.responseMimeType,
        responseSchema: params.responseSchema as any,
        maxOutputTokens: params.maxOutputTokens ?? 8192,
        ...(params.model.includes("2.5") ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
      },
    });
    if (!response.text?.trim()) throw new Error("empty");
    return response.text;
  };
  return humanizeProseDraft(slice, generate, {
    model,
    personaBlock: "Инженер, первое лицо, сухо и конкретно.",
    humanizeDepth: "balanced",
  });
}

for (const key of keys) {
  for (const model of models) {
    try {
      console.log("trying", model, "…" + key.slice(-4));
      const polished = await tryOnce(key, model);
      const after = aiTellScore(polished.text);
      console.log("OK", model, before.score, "->", after.score);
      console.log("hits", before.hits.length, "->", after.hits.length);
      console.log("left:", [...new Set(after.hits.map((h) => h.label))].join("; ") || "none");
      console.log(JSON.stringify(polished.humanizeReport, null, 2));
      fs.writeFileSync(path.join(outDir, "live-touchup-stamps.txt"), polished.text, "utf8");
      fs.writeFileSync(
        path.join(outDir, "live-touchup-stamps.report.json"),
        JSON.stringify({ before, after, report: polished.humanizeReport }, null, 2),
        "utf8",
      );
      process.exit(0);
    } catch (error: any) {
      console.log("fail", model, error?.status ?? error?.message?.slice(0, 160));
    }
  }
}
console.error("all attempts failed");
process.exit(1);
