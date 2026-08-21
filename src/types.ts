export interface Character {
  id: string;
  name: string;
  role: string;
  description: string;
  traits: string;
  goals: string;
}

export interface Chapter {
  id: string;
  title: string;
  summary: string;
  content: string;
  isPublished?: boolean;
}

export interface WorldRule {
  id: string;
  title: string;
  content: string;
}

export interface Story {
  id: string;
  title: string;
  description: string;
  genre: string;
  characters: Character[];
  chapters: Chapter[];
  worldRules: WorldRule[];
  updatedAt: number;
  bookPlan?: string;
  worldBible?: string;
}

export interface TextSelection {
  chapterId: string;
  start: number;
  end: number;
  text: string;
  sourceHash: string;
}

export interface AuthorVoiceEvidence {
  quote: string;
  observation: string;
}

export interface AuthorVoiceSheet {
  summary: string;
  voiceRules: string[];
  avoid: string[];
  evidence: AuthorVoiceEvidence[];
}

export interface AuthorProfileRecord {
  storyId: string;
  sample: string;
  sampleFileName?: string;
  styleDescription: string;
  protectedTerms: string[];
  voiceSheet?: AuthorVoiceSheet;
  updatedAt: number;
}

export interface AuthorEditIssue {
  severity: "warning" | "blocking";
  sourceFact?: string;
  problem: string;
}

export interface AuthorEditAudit {
  passed: boolean;
  summary: string;
  factIssues: AuthorEditIssue[];
  protectedTermIssues: string[];
  voiceNotes: string[];
  naturalnessNotes: string[];
}

export interface AuthorEditTarget {
  chapterId: string;
  kind: "selection" | "chapter" | "detector-segment";
  original: string;
  sourceHash: string;
  start?: number;
  end?: number;
}

export interface AuthorRevisionRecord {
  id: string;
  storyId: string;
  chapterId: string;
  storyChapterKey: string;
  createdAt: number;
  original: string;
  revised: string;
  target: AuthorEditTarget;
  audit: AuthorEditAudit;
  applied: boolean;
  model: string;
}

export interface HumanizeReport {
  scoreBefore: number;
  scoreAfter: number;
  refinedBlocks: number;
  flaggedLabels: string[];
  unresolvedLabels?: string[];
  burstiness?: number;
  openerRepetition?: number;
  patternDensity?: number;
  gatePassed?: boolean;
  passesRun?: number;
  scenesGenerated?: number;
  depth?: "fast" | "balanced" | "maximum";
  mode?: "single" | "scenes";
  candidatesTried?: number;
  candidateScores?: number[];
  chosenCandidate?: number;
  detectorSegmentsRewritten?: number;
  textHygiene?: {
    removedHiddenCharacters: number;
    normalizedSpaces: number;
    normalizedLineEndings: boolean;
    changed: boolean;
  };
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

// ─── ИИ-Агент ────────────────────────────────────────────────────────

export type AgentTaskType = "write_chapter" | "rewrite_chapter" | "continue_text" | "write_scene";

export type AgentState =
  | "idle"
  | "planning"
  | "extracting_context"
  | "drafting"
  | "evaluating"
  | "correcting"
  | "auditing"
  | "learning"
  | "completed"
  | "error";

export interface AgentConfig {
  maxDraftAttempts: number;
  minCraftScore: number;
  maxTouchupPasses: number;
  targetWordCount: [number, number];
  humanizeDepth: "fast" | "balanced" | "maximum";
  model: string;
}

export interface AgentTaskInput {
  title: string;
  genre: string;
  description: string;
  chapterTitle: string;
  chapterSummary: string;
  previousChapter: string;
  worldBible: string;
  bookPlan: string;
  customPrompt: string;
  authorSample: string;
  voiceSheet?: AuthorVoiceSheet;
  canonDossier?: string;
}

export type AgentEventType =
  | { type: "state_change"; from: AgentState; to: AgentState }
  | { type: "reasoning"; thought: string }
  | { type: "tool_call"; tool: string; args: Record<string, unknown> }
  | { type: "tool_result"; tool: string; summary: string }
  | { type: "draft_preview"; text: string; wordCount: number }
  | { type: "evaluation"; craftScore: number; burstiness: number; issues: string[] }
  | { type: "correction"; pass: number; improved: string[] }
  | { type: "completed"; result: AgentResultSummary }
  | { type: "error"; message: string; recoverable: boolean };

export interface AgentResultSummary {
  taskId: string;
  state: "completed" | "error";
  text?: string;
  craftScore?: number;
  wordCount?: number;
  draftAttempts: number;
  touchupPasses: number;
  error?: string;
  duration: number;
}

export interface AgentHistoryEntry {
  id: string;
  taskType: AgentTaskType;
  storyId: string;
  chapterId?: string;
  timestamp: number;
  state: "completed" | "error";
  craftScore?: number;
  wordCount?: number;
  duration: number;
  lessonsLearned: string[];
}

export interface CodexEntry {
  id: string;
  storyId: string;
  type: 'character' | 'location' | 'lore';
  name: string;
  description: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}
