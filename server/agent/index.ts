// server/agent/index.ts
// Точка входа для ИИ-агента: экспортирует всё необходимое.

export { AgentOrchestrator, getAgent, removeAgent } from "./orchestrator";
export { SessionMemory, EpisodicMemory } from "./memory";
export type { EpisodeRecord, AgentPlan, AgentPlanStep, AuthorEditDiff } from "./memory";
export { buildDeepStyleProfile, mergeProfiles, buildStyleInstructionBlock, computeStyleMetrics } from "./styleProfiler";
export type { DeepStyleProfile, StyleMetrics, StylePatterns, StyleExemplar } from "./styleProfiler";
export { learnFromEdits, consolidateMemory } from "./selfLearner";
export type { EditPattern, LearningResult } from "./selfLearner";
export { executeTool, AGENT_TOOLS } from "./tools";
export type { AgentTool, ToolContext, ToolResult, AgentEvent } from "./tools";
