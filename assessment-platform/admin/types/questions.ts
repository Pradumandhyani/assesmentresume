import type { Difficulty, Language } from './admin';
export interface QuestionSummary {
  id: string;
  slug: string;
  archivedAt: string | null;
  versionId: string;
  version: number;
  revision: number;
  status: string;
  title: string;
  difficulty: Difficulty;
  topics: string[];
  maxScore: string;
}
export interface QuestionInput {
  slug: string;
  title: string;
  difficulty: Difficulty;
  topics: string[];
  tags: string[];
  statement: string;
  inputFormat: string;
  outputFormat: string;
  constraints: string;
  explanation: string;
  publicExamples: { ordinal: number; input: string; expectedOutput: string }[];
  maxScore: string;
  cpuTimeMs: number;
  wallTimeMs: number;
  memoryLimitKiB: number;
  outputLimitBytes: number;
  processLimit: number;
  outputComparison: 'TOKENS' | 'EXACT';
  templates: {
    language: Language;
    starterCode: string;
    toolchainId: string;
    executionAdapter?:
      { kind: 'STDIO' } | { kind: 'SOURCE_WRAPPER'; prefix: string; suffix: string };
  }[];
  testCases: {
    ordinal: number;
    visibility: 'PUBLIC' | 'HIDDEN';
    input: string;
    expectedOutput: string;
    weight: string;
  }[];
  revision?: number;
}
export type QuestionDetail = QuestionSummary & QuestionInput;
export interface Settings {
  executionEnabled: boolean;
  toolchains: { id: string; language: Language; version: string }[];
  questionAuthoringAvailable: boolean;
  session: Record<string, unknown>;
  [key: string]: unknown;
}
