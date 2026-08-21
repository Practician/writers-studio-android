import test from "node:test";
import assert from "node:assert/strict";
import {
  isNvidiaModelFailoverError,
  isNvidiaModelName,
  normalizeModelName,
  normalizeProviderPreference,
  nvidiaModelChain,
  providerPreference,
  resolveProvider,
  resolveSelectedModel,
} from "../server/llmProvider";

test("nvidia model name detection", () => {
  assert.equal(isNvidiaModelName("meta/llama-3.1-70b-instruct"), true);
  assert.equal(isNvidiaModelName("nvidia:meta/llama-3.1-70b-instruct"), true);
  assert.equal(isNvidiaModelName("nvidia/nemotron-mini"), true);
  assert.equal(isNvidiaModelName("gemini-2.5-flash"), false);
  assert.equal(isNvidiaModelName("gemini-3.5-flash"), false);
});

test("normalize model names per provider", () => {
  assert.equal(normalizeModelName("nvidia:meta/llama-3.1-70b-instruct", "nvidia"), "meta/llama-3.1-70b-instruct");
  assert.ok(normalizeModelName("gemini-2.5-flash", "nvidia").includes("/")); // falls back to default
  assert.equal(normalizeModelName("gemini-2.5-flash", "gemini"), "gemini-2.5-flash");
  assert.ok(normalizeModelName(undefined, "gemini").startsWith("gemini"));
});

test("provider preference reads env", () => {
  const pref = providerPreference();
  assert.ok(
    pref === "auto"
    || pref === "gemini"
    || pref === "nvidia"
    || pref === "groq"
    || pref === "openrouter",
  );
});

test("resolveProvider respects explicit nvidia model when key present", () => {
  const had = process.env.NVIDIA_API_KEY;
  const hadGroq = process.env.GROQ_API_KEY;
  const hadGem = process.env.GEMINI_API_KEY;
  const hadOr = process.env.OPENROUTER_API_KEY;
  process.env.NVIDIA_API_KEY = "nvapi-test";
  delete process.env.GROQ_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  try {
    assert.equal(resolveProvider("meta/llama-3.1-70b-instruct"), "nvidia");
  } finally {
    if (had === undefined) delete process.env.NVIDIA_API_KEY;
    else process.env.NVIDIA_API_KEY = had;
    if (hadGroq === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = hadGroq;
    if (hadGem === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = hadGem;
    if (hadOr === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = hadOr;
  }
});

test("auto prefers Gemini over stale NVIDIA model names when quality provider is available", async () => {
  const { runWithLlmRequestContext, resolveProvider: rp, resolveSelectedModel: rsm } = await import("../server/llmProvider");
  const hadN = process.env.NVIDIA_API_KEY;
  const hadG = process.env.GROQ_API_KEY;
  const hadGemini = process.env.GEMINI_API_KEY;
  process.env.NVIDIA_API_KEY = "nvapi-test";
  process.env.GROQ_API_KEY = "gsk-test";
  process.env.GEMINI_API_KEY = "gem-test";
  try {
    await runWithLlmRequestContext({ preference: "auto" }, async () => {
      // Старый UI слал deepseek/* — auto больше не должен цепляться за NVIDIA
      assert.equal(rp("deepseek-ai/deepseek-v4-flash"), "gemini");
      assert.ok(!rsm("deepseek-ai/deepseek-v4-flash", "auto").includes("deepseek"));
    });
  } finally {
    if (hadN === undefined) delete process.env.NVIDIA_API_KEY;
    else process.env.NVIDIA_API_KEY = hadN;
    if (hadG === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = hadG;
    if (hadGemini === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = hadGemini;
  }
});

test("resolveProvider fails clearly without keys for forced nvidia model", () => {
  const had = process.env.NVIDIA_API_KEY;
  const had2 = process.env.NVIDIA_API_KEY_2;
  delete process.env.NVIDIA_API_KEY;
  delete process.env.NVIDIA_API_KEY_2;
  try {
    assert.throws(() => resolveProvider("meta/llama-3.1-70b-instruct"), /ключ|API|NVIDIA|Настройки/i);
  } finally {
    if (had !== undefined) process.env.NVIDIA_API_KEY = had;
    if (had2 !== undefined) process.env.NVIDIA_API_KEY_2 = had2;
  }
});

test("nvidia model chain starts with default and continues with fallbacks", () => {
  const chain = nvidiaModelChain("meta/llama-3.1-70b-instruct");
  assert.equal(chain[0], "meta/llama-3.1-70b-instruct");
  assert.ok(chain.length >= 3);
  assert.ok(chain.includes("meta/llama-3.1-8b-instruct") || chain.includes("meta/llama-3.3-70b-instruct"));
  // unique
  assert.equal(new Set(chain.map((m) => m.toLowerCase())).size, chain.length);
});

test("nvidia failover errors cover quota and unavailable models", () => {
  assert.equal(isNvidiaModelFailoverError(Object.assign(new Error("x"), { status: 429 })), true);
  assert.equal(isNvidiaModelFailoverError(Object.assign(new Error("model not found"), { status: 404 })), true);
  assert.equal(isNvidiaModelFailoverError(Object.assign(new Error("nope"), { status: 401 })), false);
  assert.equal(isNvidiaModelFailoverError(new Error("capacity exceeded")), true);
  assert.equal(isNvidiaModelFailoverError(Object.assign(new Error("timeout"), { status: 408 })), true);
  assert.equal(isNvidiaModelFailoverError(Object.assign(new Error("gone"), { status: 410 })), true);
});

test("nvidia RU rotation chain includes deepseek qwen mistral", () => {
  const chain = nvidiaModelChain();
  assert.ok(chain.some((m) => m.includes("deepseek")));
  assert.ok(chain.some((m) => m.includes("qwen")));
  assert.ok(chain.some((m) => m.includes("mistral")));
  assert.ok(chain.length >= 10);
});

test("normalizeProviderPreference accepts UI aliases", () => {
  assert.equal(normalizeProviderPreference("nvidia"), "nvidia");
  assert.equal(normalizeProviderPreference("Gemini"), "gemini");
  assert.equal(normalizeProviderPreference("groq"), "groq");
  assert.equal(normalizeProviderPreference("openrouter"), "openrouter");
  assert.equal(normalizeProviderPreference("both"), "auto");
  assert.equal(normalizeProviderPreference("nope"), null);
});

test("resolveSelectedModel maps UI provider to model family", () => {
  assert.ok(resolveSelectedModel("gemini-3.5-flash", "nvidia").includes("/"));
  assert.ok(resolveSelectedModel("deepseek-ai/deepseek-v4-flash", "gemini").startsWith("gemini"));
  assert.equal(resolveSelectedModel("gemini-2.5-flash", "gemini"), "gemini-2.5-flash");
  assert.ok(resolveSelectedModel(undefined, "groq").includes("llama") || resolveSelectedModel(undefined, "groq").length > 0);
  assert.ok(resolveSelectedModel(undefined, "openrouter").length > 0);
});

test("parseRequestCredentials from UI body", async () => {
  const { parseRequestCredentials, runWithLlmRequestContext, collectGroqKeys } = await import("../server/llmProvider");
  const creds = parseRequestCredentials({ groq: "gsk_test_key", gemini: "gem-a,gem-b" });
  assert.ok(creds);
  assert.deepEqual(creds?.groqApiKeys, ["gsk_test_key"]);
  assert.equal(creds?.geminiApiKeys?.length, 2);

  await runWithLlmRequestContext({ credentials: creds }, async () => {
    assert.ok(collectGroqKeys().includes("gsk_test_key"));
  });
});
