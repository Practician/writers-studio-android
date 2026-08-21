import express from "express";
import { llmGenerate, llmTextOrThrow, parseRequestCredentials, runWithLlmRequestContext, resolveSelectedModel, normalizeProviderPreference } from "../llmProvider";

const router = express.Router();

const handleEditRequest = async (req: express.Request, res: express.Response, instructionPreset: string) => {
  const { text, customPrompt, llmProvider: llmProviderRaw, apiKeys, model } = req.body;

  if (!text) {
    return res.status(400).json({ error: "No text provided" });
  }

  const llmProvider = normalizeProviderPreference(llmProviderRaw);
  const credentials = parseRequestCredentials(apiKeys);

  try {
    await runWithLlmRequestContext({ preference: llmProvider, credentials }, async () => {
      const selectedModel = resolveSelectedModel(
        typeof model === "string" ? model : undefined,
        llmProvider || undefined,
      );

      const systemInstruction = "You are a world-class book editor and prose stylist. Your goal is to refine and polish text to make it exceptional.";
      
      const prompt = `Improve the following passage.
Style Direction: ${instructionPreset}
${customPrompt ? `Additional custom requests: ${customPrompt}` : ""}

Original Passage:
"""
${text}
"""

Provide ONLY the revised text. Do not provide any commentary, headers, or "before/after" comparisons. Just output the refined passage itself.`;

      const llmResult = await llmGenerate({
        model: selectedModel,
        contents: prompt,
        systemInstruction,
        temperature: 0.7,
      });

      const reply = llmTextOrThrow(llmResult, "Micro-editing");

      return res.json({ result: reply, model: selectedModel });
    });
  } catch (error: any) {
    console.error("Micro-edit API error:", error);
    const status = error?.status ?? error?.statusCode;
    const overloaded = status === 503 || status === 500;
    const quota = status === 429;
    const message = overloaded
      ? "LLM-сервис временно перегружен. Попробуйте снова через минуту."
      : quota
        ? "Квота LLM исчерпана. Переключитесь на другой провайдер."
        : error.message || "Не удалось выполнить микро-редактуру.";
    return res.status(overloaded ? 503 : quota ? 429 : 500).json({ error: message });
  }
};

router.post("/rewrite", (req, res) => {
  return handleEditRequest(req, res, "Polishing style, tone, flow, and vocabulary. Rewrite the text to make it more engaging.");
});

router.post("/show-dont-tell", (req, res) => {
  return handleEditRequest(req, res, "Apply 'Show, Don't Tell' principles. Turn dry explanations/internal summaries into active dialogue, physical reactions, or vivid environment cues.");
});

router.post("/sensory", (req, res) => {
  return handleEditRequest(req, res, "Vividly enhance sensory details, descriptions, textures, sounds, and sights to fully immerse the reader in the scene.");
});

router.post("/expand", (req, res) => {
  return handleEditRequest(req, res, "Expand the text. Add more descriptive details, internal monologue, or environmental context without altering the core meaning.");
});

export default router;
