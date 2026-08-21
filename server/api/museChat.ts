import { Router } from "express";
import { resolveProvider, getGeminiClient, normalizeModelName, parseRequestCredentials, runWithLlmRequestContext, normalizeProviderPreference } from "../llmProvider.js";

export const museChatRouter = Router();

museChatRouter.post("/stream", async (req, res) => {
  const {
    title,
    description,
    currentDraft,
    history,
    customPrompt,
    model,
    llmProvider: llmProviderRaw,
    apiKeys,
  } = req.body;

  const llmProvider = normalizeProviderPreference(llmProviderRaw);
  const credentials = parseRequestCredentials(apiKeys);

  // Set headers for SSE
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  try {
    await runWithLlmRequestContext({ preference: llmProvider, credentials }, async () => {
      const provider = resolveProvider(typeof model === "string" ? model : undefined);

      const systemInstruction = "You are the Muse—a supportive, highly creative, and deeply insightful AI companion for writers. You chat with the author, offering feedback, brainstorming plots, helping overcome block, and praising their efforts.";

      const storyContext = `Current Story Info:
- Title: ${title || "Untitled"}
- Summary: ${description || "Not specified"}
- Current Draft Excerpt: ${currentDraft ? currentDraft.slice(0, 800) + (currentDraft.length > 800 ? "..." : "") : "Empty"}`;

      const chatHistoryText = history && history.length > 0
        ? history.map((h: any) => `${h.role === "user" ? "Writer" : "Muse"}: ${h.content}`).join("\n")
        : "No previous discussion.";

      const prompt = `${storyContext}\n\nConversation History:\n${chatHistoryText}\n\nWriter's latest message: "${customPrompt || "Hello!"}"\n\nRespond in character as the Muse. Be inspiring, encouraging, and highly specific with story-related ideas. Keep your response under 180 words, warm, and highly engaging.`;

      if (provider === "gemini") {
        const ai = getGeminiClient();
        const modelName = normalizeModelName(model as string, "gemini");
        
        try {
          const responseStream = await ai.models.generateContentStream({
            model: modelName,
            contents: prompt,
            config: {
              systemInstruction,
              temperature: 0.7,
            },
          });

          for await (const chunk of responseStream) {
            if (chunk.text) {
              res.write(`data: ${JSON.stringify({ text: chunk.text })}\n\n`);
            }
          }
        } catch (e) {
          console.error("Gemini stream error", e);
          res.write(`data: ${JSON.stringify({ error: "Failed to generate response." })}\n\n`);
        }
      } else {
        // Fallback for non-gemini providers (simulated streaming or implement their streaming)
        // For brevity and since the project heavily relies on llmProvider.llmGenerate:
        const { llmGenerate } = await import("../llmProvider.js");
        const result = await llmGenerate({
          contents: prompt,
          systemInstruction,
          model: model as string,
          temperature: 0.7
        });
        
        // chunk the text to simulate streaming if it doesn't stream natively
        const text = result.text || "";
        const chunks = text.match(/.{1,50}/g) || [];
        for (const chunk of chunks) {
          res.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
          await new Promise(r => setTimeout(r, 50));
        }
      }
      
      res.write(`data: [DONE]\n\n`);
      res.end();
    });
  } catch (error: any) {
    console.error("MuseChat SSE error:", error);
    res.write(`data: ${JSON.stringify({ error: error.message || "Internal server error" })}\n\n`);
    res.end();
  }
});
