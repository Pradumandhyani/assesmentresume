export type Language = 'PYTHON' | 'JAVA' | 'CPP';
export type Difficulty = 'EASY' | 'MEDIUM' | 'HARD';
export interface EntityMutation {
  id: string;
  revision?: number;
  status?: string;
  versionId?: string;
  updated?: boolean;
}
export interface Envelope<T> {
  data: T;
  meta: { serverNow: string; requestId?: string };
}
export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}
export interface Session {
  user: { id: string; role: 'STUDENT' | 'ADMIN'; displayName: string };
  expiresAt: string;
  student: unknown;
}
export interface Student {
  id: string;
  externalId: string;
  displayName: string;
  cohort: string | null;
  isActive: boolean;
  assignments: {
    assessmentId: string;
    title: string;
    status: string;
    attemptId: string | null;
    attemptStatus: string | null;
    score: string | null;
    eligibility?: string;
  }[];
}
export interface Rule {
  durationSeconds: number;
  easyCount: number;
  mediumCount: number;
  hardCount: number;
  allowedLanguages: Language[];
  allowedTopics: string[];
  marks: Record<Difficulty, string>;
  submissionSelection: 'FINAL_SNAPSHOT' | 'BEST_VALID' | 'LATEST_VALID';
  partialScoring: boolean;
  hiddenFeedbackImmediate: boolean;
}
export interface PoolQuestion {
  id: string;
  questionId: string;
  title: string;
  difficulty: Difficulty;
  maxScore: string;
  topics: string[];
}
export interface Assessment {
  id: string;
  title: string;
  description: string | null;
  status: string;
  revision: number;
  opensAt: string | null;
  latestStartAt: string | null;
  closesAt: string | null;
  resultsReleaseAt: string | null;
  rule: Rule;
  questionVersionIds: string[];
  pool: PoolQuestion[];
  assignmentCount: number;
  attemptCount: number;
}
export type AssessmentInput = Pick<
  Assessment,
  | 'title'
  | 'description'
  | 'opensAt'
  | 'latestStartAt'
  | 'closesAt'
  | 'resultsReleaseAt'
  | 'rule'
  | 'questionVersionIds'
> & { revision?: number };
export interface Monitoring {
  page: number;
  pageSize: number;
  total: number;
  items: {
    assignmentId: string;
    studentId: string;
    studentName: string;
    externalId: string;
    attemptId: string | null;
    status: string;
    attemptStatus: string | null;
    lastHeartbeatAt: string | null;
    expiresAt: string | null;
    resultStatus: string | null;
    score: string | null;
  }[];
  counts: Record<string, number>;
  serverNow: string;
}
export interface Audit {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actorUserId: string | null;
  occurredAt: string;
  requestId: string;
  metadata: Record<string, unknown>;
}
