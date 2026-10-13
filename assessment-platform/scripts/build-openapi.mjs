import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { addAdminContracts } from './admin-openapi.mjs';

// Source of truth for future routes. This builds documentation, never HTTP handlers.
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const object = (properties, required = Object.keys(properties)) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required,
});
const string = (extra = {}) => ({ type: 'string', ...extra });
const integer = (extra = {}) => ({ type: 'integer', minimum: 0, ...extra });
const array = (items, extra = {}) => ({ type: 'array', items, ...extra });
const uuid = () => string({ format: 'uuid' });
const utc = () =>
  string({ format: 'date-time', description: 'RFC 3339 UTC, ending in Z on responses.' });
const nullable = (schema) => ({ anyOf: [schema, { type: 'null' }] });
const enums = (...values) => string({ enum: values });
const score = () =>
  string({
    pattern: '^\\d{1,8}(\\.\\d{1,2})?$',
    description: 'Exact decimal, serialized as a string.',
  });
const source = () =>
  string({
    maxLength: 65536,
    description: 'Additional hard limit: 65,536 UTF-8 bytes, enforced by backend.',
  });
const idempotency = {
  name: 'Idempotency-Key',
  in: 'header',
  required: true,
  schema: string({ minLength: 16, maxLength: 128, pattern: '^[A-Za-z0-9_-]+$' }),
  description:
    'Persist across retries. Scoped to user, resource and operation. Different payload with the same key returns 409.',
};
const csrf = {
  name: 'X-CSRF-Token',
  in: 'header',
  required: true,
  schema: string({ minLength: 32, maxLength: 256 }),
  description:
    'Token issued by /auth/csrf. Validate exact Origin and token binding before state changes.',
};
const schemas = {
  Role: enums('STUDENT', 'ADMIN'),
  Language: enums('PYTHON', 'JAVA', 'CPP'),
  Difficulty: enums('EASY', 'MEDIUM', 'HARD'),
  AssessmentStatus: enums('DRAFT', 'SCHEDULED', 'OPEN', 'CLOSED', 'CANCELLED', 'ARCHIVED'),
  AttemptStatus: enums('IN_PROGRESS', 'FINALIZING', 'FINALIZED', 'VOIDED'),
  SubmissionStatus: enums(
    'PENDING',
    'QUEUED',
    'RUNNING',
    'COMPLETED',
    'INFRASTRUCTURE_FAILED',
    'CANCELLED',
  ),
  Verdict: enums(
    'ACCEPTED',
    'WRONG_ANSWER',
    'TIME_LIMIT_EXCEEDED',
    'MEMORY_LIMIT_EXCEEDED',
    'OUTPUT_LIMIT_EXCEEDED',
    'COMPILATION_ERROR',
    'RUNTIME_ERROR',
    'INTERNAL_ERROR',
  ),
  ApiError: object({
    error: object({
      code: enums(
        'VALIDATION_FAILED',
        'UNAUTHENTICATED',
        'FORBIDDEN',
        'CSRF_INVALID',
        'NOT_FOUND',
        'ASSESSMENT_NOT_OPEN',
        'ASSESSMENT_CANCELLED',
        'POOL_INSUFFICIENT',
        'ATTEMPT_EXPIRED',
        'ATTEMPT_FINALIZED',
        'REVISION_CONFLICT',
        'IDEMPOTENCY_CONFLICT',
        'VERSION_IMMUTABLE',
        'RESULT_NOT_RELEASED',
        'RATE_LIMITED',
        'QUEUE_BACKPRESSURE',
        'EXECUTION_UNAVAILABLE',
        'SUBMISSION_LIMIT',
        'SERVICE_UNAVAILABLE',
        'INTERNAL_ERROR',
      ),
      message: string(),
      requestId: uuid(),
      details: array(object({ field: string(), reason: string() })),
      serverNow: utc(),
    }),
  }),
  Meta: object({ requestId: uuid(), serverNow: utc() }),
  PageInfo: object({ nextCursor: nullable(string()), hasMore: { type: 'boolean' } }),
  LoginRequest: object(
    {
      identifier: string({ minLength: 1, maxLength: 320 }),
      role: enums('STUDENT', 'ADMIN'),
      password: string({ minLength: 1, maxLength: 1024 }),
      remember: { type: 'boolean', default: false },
    },
    ['identifier', 'password'],
  ),
  CsrfResponse: object({ csrfToken: string({ minLength: 32 }), expiresAt: utc() }),
  SessionResponse: object(
    {
      user: object({ id: uuid(), role: ref('Role'), displayName: string() }),
      student: nullable(ref('StudentProfile')),
      admin: nullable(object({ id: uuid(), displayName: string(), email: string() })),
      expiresAt: utc(),
    },
    ['user', 'student', 'expiresAt'],
  ),
  StudentProfile: object({ id: uuid(), externalId: string(), displayName: string() }),
  AssessmentRuleResponse: object(
    {
      durationSeconds: integer({ minimum: 900, maximum: 21600, default: 10800 }),
      easyCount: integer({ maximum: 20, default: 2 }),
      mediumCount: integer({ maximum: 20, default: 1 }),
      hardCount: integer({ maximum: 20, default: 1 }),
      allowedLanguages: array(ref('Language'), { minItems: 1, maxItems: 3, uniqueItems: true }),
      maxSourceBytes: integer({ enum: [65536] }),
      gradingPolicyVersion: string(),
      allocationPolicyVersion: string(),
      allowedTopics: array(string()),
      submissionSelection: enums('FINAL_SNAPSHOT', 'BEST_VALID', 'LATEST_VALID'),
      partialScoring: { type: 'boolean' },
      maxHiddenSubmissions: integer({ minimum: 1, maximum: 100 }),
      hiddenCooldownSeconds: integer({ maximum: 3600 }),
      maxPublicRuns: integer({ minimum: 1, maximum: 1000 }),
      hiddenFeedbackImmediate: { type: 'boolean' },
      evaluationGraceSeconds: integer({ minimum: 30, maximum: 3600 }),
    },
    [
      'durationSeconds',
      'easyCount',
      'mediumCount',
      'hardCount',
      'allowedLanguages',
      'maxSourceBytes',
      'gradingPolicyVersion',
      'allocationPolicyVersion',
    ],
  ),
  AssessmentSummary: object({
    id: uuid(),
    title: string(),
    status: ref('AssessmentStatus'),
    opensAt: nullable(utc()),
    latestStartAt: nullable(utc()),
    closesAt: nullable(utc()),
    attemptId: nullable(uuid()),
    attemptStatus: nullable(ref('AttemptStatus')),
  }),
  AssessmentDetail: object({
    assessment: ref('AssessmentSummary'),
    rules: ref('AssessmentRuleResponse'),
    resultsReleaseAt: nullable(utc()),
  }),
  AssessmentEligibility: object({
    assessmentId: uuid(),
    canStart: { type: 'boolean' },
    canResume: { type: 'boolean' },
    reason: enums(
      'READY',
      'NOT_OPEN',
      'ADMISSION_CLOSED',
      'CANCELLED',
      'ALREADY_STARTED',
      'COMPLETED',
      'EXPIRED',
    ),
    message: string(),
    checkedAt: utc(),
  }),
  DashboardAssessment: object({
    assessment: ref('AssessmentSummary'),
    description: nullable(string()),
    rules: ref('AssessmentRuleResponse'),
    category: enums('UPCOMING', 'ACTIVE', 'COMPLETED', 'CLOSED', 'CANCELLED'),
    eligibility: ref('AssessmentEligibility'),
    result: nullable(object({ totalScore: score(), maximumScore: score() })),
  }),
  DashboardAssessments: object({
    items: array(ref('DashboardAssessment')),
    summary: object({
      upcoming: integer(),
      active: integer(),
      completed: integer(),
      closed: integer(),
      cancelled: integer(),
    }),
    pageInfo: ref('PageInfo'),
  }),
  AttemptQuestionSummary: object({
    id: uuid(),
    position: integer({ minimum: 1, maximum: 20 }),
    questionVersionId: uuid(),
    title: string(),
    difficulty: ref('Difficulty'),
    selectedLanguage: ref('Language'),
    finalSubmissionId: nullable(uuid()),
    hasDraft: { type: 'boolean' },
    hasSubmission: { type: 'boolean' },
  }),
  DraftResponse: object({
    attemptQuestionId: uuid(),
    language: ref('Language'),
    sourceCode: source(),
    revision: integer({ minimum: 0 }),
    savedAt: nullable(utc()),
  }),
  AttemptResponse: object({
    id: uuid(),
    assessmentId: uuid(),
    status: ref('AttemptStatus'),
    assessmentTitle: string(),
    capabilities: object({
      executionAvailable: { type: 'boolean' },
      submissionReviewAllowed: { type: 'boolean' },
      message: string(),
    }),
    stateVersion: integer({ minimum: 1 }),
    startedAt: utc(),
    expiresAt: utc(),
    finalizedAt: nullable(utc()),
    rules: ref('AssessmentRuleResponse'),
    questions: array(ref('AttemptQuestionSummary'), { minItems: 1, maxItems: 20 }),
    drafts: array(ref('DraftResponse')),
  }),
  PublicTestCase: object({
    ordinal: integer({ minimum: 1 }),
    input: string(),
    expectedOutput: string(),
  }),
  QuestionTemplateResponse: object({
    language: ref('Language'),
    starterCode: source(),
    toolchainId: string(),
  }),
  QuestionPublic: object({
    attemptQuestionId: uuid(),
    questionVersionId: uuid(),
    title: string(),
    difficulty: ref('Difficulty'),
    statement: string(),
    inputFormat: string(),
    outputFormat: string(),
    constraints: string(),
    explanation: nullable(string()),
    cpuTimeMs: integer({ minimum: 1 }),
    wallTimeMs: integer({ minimum: 1 }),
    memoryLimitKiB: integer({ minimum: 1 }),
    outputLimitBytes: integer({ minimum: 1 }),
    maxScore: score(),
    templates: array(ref('QuestionTemplateResponse')),
    publicTestCases: array(ref('PublicTestCase')),
    topics: array(string()),
    tags: array(string()),
    samplesAvailable: { type: 'boolean' },
  }),
  SaveDraftRequest: object({ sourceCode: source(), expectedRevision: integer({ minimum: 0 }) }),
  SelectLanguageRequest: object({
    language: ref('Language'),
    expectedStateVersion: integer({ minimum: 1 }),
  }),
  SubmissionCreateRequest: object({ sourceCode: source(), language: ref('Language') }),
  ExecutionCreateRequest: object({
    attemptQuestionId: uuid(),
    sourceCode: source(),
    language: ref('Language'),
  }),
  FinalizeRequest: object({ expectedStateVersion: integer({ minimum: 1 }) }),
  PublicCaseResult: object({
    ordinal: integer({ minimum: 1 }),
    verdict: ref('Verdict'),
    stdout: string({ maxLength: 65536 }),
    stderr: string({ maxLength: 4096 }),
    input: string({ maxLength: 262144 }),
    expectedOutput: string({ maxLength: 65536 }),
    cpuTimeMs: nullable(integer()),
    wallTimeMs: nullable(integer()),
    memoryKiB: nullable(integer()),
  }),
  SubmissionResultResponse: object({
    verdict: ref('Verdict'),
    publicCaseResults: array(ref('PublicCaseResult')),
    passedCount: integer(),
    totalCount: integer(),
    score: score(),
    cpuTimeMs: nullable(integer()),
    memoryKiB: nullable(integer()),
  }),
  SubmissionResponse: object({
    id: uuid(),
    attemptId: uuid(),
    attemptQuestionId: uuid(),
    questionVersionId: uuid(),
    purpose: enums('RUN_PUBLIC', 'SUBMIT', 'FINAL'),
    language: ref('Language'),
    status: ref('SubmissionStatus'),
    acceptedAt: utc(),
    completedAt: nullable(utc()),
    feedbackReleased: { type: 'boolean' },
    result: nullable(ref('SubmissionResultResponse')),
  }),
  QuestionResultResponse: object({
    attemptQuestionId: uuid(),
    finalSubmissionId: nullable(uuid()),
    scoringSubmissionId: nullable(uuid()),
    verdict: nullable(ref('Verdict')),
    score: nullable(score()),
    maximumScore: score(),
  }),
  AssessmentResultResponse: object({
    attemptId: uuid(),
    status: enums('PENDING', 'COMPLETE', 'REQUIRES_REVIEW'),
    attemptStatus: ref('AttemptStatus'),
    finalizationReason: nullable(enums('STUDENT', 'EXPIRED', 'ADMIN_VOID')),
    feedbackReleased: { type: 'boolean' },
    totalScore: nullable(score()),
    maximumScore: score(),
    computedAt: nullable(utc()),
    releasedAt: nullable(utc()),
    questions: array(ref('QuestionResultResponse'), { minItems: 1, maxItems: 20 }),
  }),
  AssessmentCreateRequest: object({ title: string({ minLength: 1, maxLength: 200 }) }),
  AssessmentUpdateRequest: object({
    title: string({ minLength: 1, maxLength: 200 }),
    expectedRevision: integer({ minimum: 1 }),
  }),
  AssessmentScheduleRequest: object({
    opensAt: utc(),
    latestStartAt: utc(),
    closesAt: utc(),
    resultsReleaseAt: utc(),
    poolQuestionVersionIds: array(uuid(), { minItems: 4, uniqueItems: true }),
    expectedRevision: integer({ minimum: 1 }),
  }),
  CancelAssessmentRequest: object({
    reason: string({ minLength: 1, maxLength: 500 }),
    expectedRevision: integer({ minimum: 1 }),
  }),
  AssessmentAdminResponse: object({
    id: uuid(),
    title: string(),
    status: ref('AssessmentStatus'),
    revision: integer({ minimum: 1 }),
    opensAt: nullable(utc()),
    latestStartAt: nullable(utc()),
    closesAt: nullable(utc()),
    resultsReleaseAt: nullable(utc()),
    rules: nullable(ref('AssessmentRuleResponse')),
    poolQuestionVersionIds: array(uuid()),
  }),
  AssignmentBatchRequest: object({
    studentIds: array(uuid(), { minItems: 1, maxItems: 500, uniqueItems: true }),
  }),
  AssignmentBatchResponse: object({
    assignedStudentIds: array(uuid()),
    existingStudentIds: array(uuid()),
  }),
  QuestionCreateRequest: object({
    slug: string({ minLength: 1, maxLength: 200, pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' }),
    topics: array(string({ maxLength: 100 }), { uniqueItems: true }),
  }),
  QuestionAdminSummary: object({
    id: uuid(),
    slug: string(),
    topics: array(string()),
    archivedAt: nullable(utc()),
    versions: array(
      object({
        id: uuid(),
        version: integer({ minimum: 1 }),
        status: enums('DRAFT', 'PUBLISHED'),
        title: string(),
        difficulty: ref('Difficulty'),
      }),
    ),
  }),
  TestCaseWriteRequest: object({
    ordinal: integer({ minimum: 1 }),
    visibility: enums('PUBLIC', 'HIDDEN'),
    input: string({ maxLength: 262144 }),
    expectedOutput: string({ maxLength: 262144 }),
    weight: score(),
  }),
  QuestionVersionWriteRequest: object({
    title: string({ minLength: 1, maxLength: 200 }),
    difficulty: ref('Difficulty'),
    statement: string({ maxLength: 131072 }),
    inputFormat: string({ maxLength: 16384 }),
    outputFormat: string({ maxLength: 16384 }),
    constraints: string({ maxLength: 16384 }),
    explanation: nullable(string({ maxLength: 16384 })),
    cpuTimeMs: integer({ minimum: 1, maximum: 10000 }),
    wallTimeMs: integer({ minimum: 1, maximum: 30000 }),
    memoryLimitKiB: integer({ minimum: 16384, maximum: 1048576 }),
    outputLimitBytes: integer({ minimum: 1024, maximum: 65536 }),
    maxScore: score(),
    templates: array(ref('QuestionTemplateResponse'), { minItems: 3, maxItems: 3 }),
    testCases: array(ref('TestCaseWriteRequest'), { minItems: 2, maxItems: 100 }),
  }),
  QuestionVersionAdminResponse: object({
    id: uuid(),
    questionId: uuid(),
    version: integer({ minimum: 1 }),
    status: enums('DRAFT', 'PUBLISHED'),
    title: string(),
    difficulty: ref('Difficulty'),
    contentHash: nullable(string()),
    publishedAt: nullable(utc()),
    publicTestCaseCount: integer(),
    hiddenTestCaseCount: integer(),
  }),
  AuditLogResponse: object({
    id: uuid(),
    actorUserId: nullable(uuid()),
    action: string(),
    entityType: string(),
    entityId: nullable(string()),
    requestId: uuid(),
    occurredAt: utc(),
  }),
};

const paths = {};
const responseHeaders = {
  'X-Request-Id': { description: 'Server-generated correlation ID', schema: uuid() },
  'Cache-Control': {
    description: 'private, no-store for authenticated and exam responses',
    schema: string(),
  },
};
const errors = {
  400: 'Invalid request',
  401: 'Session missing or expired',
  403: 'Role, ownership or CSRF denied',
  404: 'Resource absent or not owned',
  409: 'State, revision or idempotency conflict',
  410: 'Attempt expired or finalized',
  422: 'Assessment publication or allocation rule failed',
  429: 'Per-student rate or concurrency limit exceeded',
  503: 'Dependency unavailable or admission backpressure',
  500: 'Unexpected error; no internal diagnostic details returned',
};
function endpoint(method, url, operationId, tag, summary, role, responseSchema, options = {}) {
  const parameters = [...(options.parameters ?? [])];
  for (const match of url.matchAll(/\{([^}]+)\}/g))
    parameters.push({
      name: match[1],
      in: 'path',
      required: true,
      schema: match[1] === 'language' ? ref('Language') : uuid(),
    });
  if (method !== 'get') parameters.push(csrf);
  if (options.idempotent) parameters.push(idempotency);
  const status = options.status ?? 200;
  const responses = {
    [status]: {
      description:
        options.responseDescription ??
        (status === 202 ? 'Accepted; poll authoritative resource' : 'Successful operation'),
      headers: responseHeaders,
      content: {
        'application/json': { schema: object({ data: responseSchema, meta: ref('Meta') }) },
      },
    },
  };
  for (const [code, description] of Object.entries(errors))
    responses[code] = {
      description,
      headers: {
        ...responseHeaders,
        ...(['429', '503'].includes(code)
          ? {
              'Retry-After': {
                description: 'Seconds until a retry may be attempted',
                schema: integer({ minimum: 1 }),
              },
            }
          : {}),
      },
      content: { 'application/json': { schema: ref('ApiError') } },
    };
  const operation = {
    operationId,
    tags: [tag],
    summary,
    description: `${options.description ?? summary} ${options.implemented ? `Implemented in Step ${options.implemented}.` : 'Reserved Step 1 contract; not yet implemented.'}`,
    security: role === 'PUBLIC' ? [] : [{ cookieAuth: [] }],
    'x-roles': role === 'PUBLIC' ? [] : role === 'AUTHENTICATED' ? ['STUDENT', 'ADMIN'] : [role],
    parameters,
    responses,
  };
  if (options.body)
    operation.requestBody = {
      required: true,
      content: { 'application/json': { schema: ref(options.body) } },
    };
  if (options.idempotent)
    operation['x-idempotency'] = 'Required; durable PostgreSQL deduplication.';
  (paths[url] ??= {})[method] = operation;
}
const page = (type) => object({ items: array(ref(type)), pageInfo: ref('PageInfo') });
const pagination = [
  { name: 'cursor', in: 'query', schema: string({ maxLength: 512 }) },
  { name: 'limit', in: 'query', schema: integer({ minimum: 1, maximum: 100, default: 25 }) },
];
endpoint(
  'get',
  '/auth/csrf',
  'getCsrf',
  'auth',
  'Issue a session-bound or pre-authentication CSRF token',
  'PUBLIC',
  ref('CsrfResponse'),
  { implemented: true },
);
endpoint(
  'post',
  '/auth/login',
  'login',
  'auth',
  'Validate existing credentials and rotate session',
  'PUBLIC',
  ref('SessionResponse'),
  {
    body: 'LoginRequest',
    implemented: true,
    description:
      'Requires pre-authentication CSRF cookie/token and exact Origin. Sets HttpOnly cookie; no access token is returned.',
  },
);
endpoint(
  'get',
  '/auth/session',
  'getSession',
  'auth',
  'Read current session',
  'AUTHENTICATED',
  ref('SessionResponse'),
  { implemented: true },
);
endpoint(
  'post',
  '/auth/logout',
  'logout',
  'auth',
  'Revoke session and expire cookie',
  'AUTHENTICATED',
  object({ revoked: { type: 'boolean', enum: [true] } }),
  { implemented: true },
);
endpoint(
  'get',
  '/student/me',
  'getStudentProfile',
  'students',
  'Read own student profile',
  'STUDENT',
  ref('StudentProfile'),
  { implemented: true },
);
endpoint(
  'get',
  '/student/assessments',
  'listStudentAssessments',
  'assessments',
  'List assigned upcoming and active assessments',
  'STUDENT',
  page('AssessmentSummary'),
  { parameters: pagination, implemented: true },
);
endpoint(
  'get',
  '/student/assessments/{assessmentId}',
  'getStudentAssessment',
  'assessments',
  'Read assigned assessment schedule and rules',
  'STUDENT',
  ref('AssessmentDetail'),
  { implemented: true },
);
endpoint(
  'get',
  '/auth/me',
  'getMe',
  'auth',
  'Read the authenticated session and student identity',
  'AUTHENTICATED',
  ref('SessionResponse'),
  { implemented: true },
);
endpoint(
  'get',
  '/assessments',
  'getDashboardAssessments',
  'assessments',
  'Read own assessment dashboard and history counts',
  'STUDENT',
  ref('DashboardAssessments'),
  { parameters: pagination, implemented: true },
);
endpoint(
  'get',
  '/assessments/upcoming',
  'getUpcomingAssessments',
  'assessments',
  'Read own upcoming assessments with server eligibility',
  'STUDENT',
  page('DashboardAssessment'),
  { parameters: pagination, implemented: true },
);
endpoint(
  'get',
  '/assessments/{assessmentId}/eligibility',
  'getAssessmentEligibility',
  'assessments',
  'Recheck admission against the PostgreSQL clock without creating an attempt',
  'STUDENT',
  ref('AssessmentEligibility'),
  { implemented: true },
);
endpoint(
  'post',
  '/student/assessments/{assessmentId}/attempts',
  'startAttempt',
  'attempts',
  'Start once or return existing attempt',
  'STUDENT',
  ref('AttemptResponse'),
  {
    idempotent: true,
    description:
      'One attempt per assignment. Allocate four pinned versions atomically and set an exact three-hour deadline. Retries always return the same attempt.',
    implemented: 3,
  },
);
endpoint(
  'get',
  '/student/attempts/{attemptId}',
  'getAttempt',
  'attempts',
  'Resume own attempt with drafts and authoritative deadline',
  'STUDENT',
  ref('AttemptResponse'),
  { implemented: 3 },
);
endpoint(
  'get',
  '/student/attempts/{attemptId}/questions/{attemptQuestionId}',
  'getAttemptQuestion',
  'questions',
  'Read own allocated question and public examples',
  'STUDENT',
  ref('QuestionPublic'),
  { implemented: 3 },
);
endpoint(
  'put',
  '/student/attempts/{attemptId}/questions/{attemptQuestionId}/drafts/{language}',
  'saveDraft',
  'attempts',
  'Save code with optimistic revision check',
  'STUDENT',
  ref('DraftResponse'),
  {
    body: 'SaveDraftRequest',
    implemented: 3,
    description:
      'expectedRevision=0 creates the first draft. A lost-response retry of identical content at the previous revision returns the saved revision. Different stale content returns 409. Reject after expiresAt.',
  },
);
endpoint(
  'patch',
  '/student/attempts/{attemptId}/questions/{attemptQuestionId}/language',
  'selectLanguage',
  'attempts',
  'Persist active language for final snapshot',
  'STUDENT',
  ref('AttemptResponse'),
  { body: 'SelectLanguageRequest', implemented: 3 },
);
endpoint(
  'post',
  '/student/attempts/{attemptId}/questions/{attemptQuestionId}/runs',
  'createPublicRun',
  'execution',
  'Queue execution of public tests',
  'STUDENT',
  ref('SubmissionResponse'),
  { body: 'SubmissionCreateRequest', idempotent: true, status: 202 },
);
endpoint(
  'post',
  '/student/attempts/{attemptId}/questions/{attemptQuestionId}/submissions',
  'createSubmission',
  'submissions',
  'Save source snapshot and queue all tests',
  'STUDENT',
  ref('SubmissionResponse'),
  {
    body: 'SubmissionCreateRequest',
    idempotent: true,
    status: 202,
    description:
      'Atomic source snapshot, matching-language draft update, active-language selection, submission and outbox write. Hidden test diagnostics are withheld.',
  },
);
endpoint(
  'get',
  '/student/attempts/{attemptId}/submissions',
  'listSubmissions',
  'submissions',
  'List own attempt submissions',
  'STUDENT',
  page('SubmissionResponse'),
  { parameters: pagination },
);
endpoint(
  'get',
  '/student/attempts/{attemptId}/submissions/{submissionId}',
  'getSubmission',
  'submissions',
  'Poll own execution status',
  'STUDENT',
  ref('SubmissionResponse'),
  {
    description:
      'RUN_PUBLIC can return bounded public outputs. For SUBMIT/FINAL return result=null until assessment result release, avoiding an adaptive hidden-test oracle. No hidden diagnostics are ever returned.',
  },
);
endpoint(
  'post',
  '/student/attempts/{attemptId}/finalization',
  'finalizeAttempt',
  'attempts',
  'Freeze final source snapshots and finalize once',
  'STUDENT',
  ref('AttemptResponse'),
  {
    body: 'FinalizeRequest',
    implemented: 3,
    idempotent: true,
    status: 202,
    description:
      'Transition to FINALIZING and atomically snapshot all four active-language drafts. Grading completes asynchronously. Repeated finalization returns the existing state.',
  },
);
endpoint(
  'get',
  '/student/attempts/{attemptId}/result',
  'getAssessmentResult',
  'results',
  'Read own released result',
  'STUDENT',
  ref('AssessmentResultResponse'),
  {
    description:
      'Return RESULT_NOT_RELEASED before release. Scores are computed solely from final snapshots using frozen policy.',
  },
);
endpoint(
  'get',
  '/admin/students',
  'listAdminStudents',
  'admin',
  'List students without credentials',
  'ADMIN',
  page('StudentProfile'),
  { parameters: pagination },
);
endpoint(
  'get',
  '/admin/assessments',
  'listAdminAssessments',
  'admin',
  'List managed assessments',
  'ADMIN',
  page('AssessmentAdminResponse'),
  { parameters: pagination },
);
endpoint(
  'post',
  '/admin/assessments',
  'createAssessment',
  'admin',
  'Create a draft assessment',
  'ADMIN',
  ref('AssessmentAdminResponse'),
  { body: 'AssessmentCreateRequest', idempotent: true, status: 201 },
);
endpoint(
  'get',
  '/admin/assessments/{assessmentId}',
  'getAdminAssessment',
  'admin',
  'Read managed assessment',
  'ADMIN',
  ref('AssessmentAdminResponse'),
);
endpoint(
  'patch',
  '/admin/assessments/{assessmentId}',
  'updateAssessment',
  'admin',
  'Update a draft assessment title',
  'ADMIN',
  ref('AssessmentAdminResponse'),
  { body: 'AssessmentUpdateRequest' },
);
endpoint(
  'post',
  '/admin/assessments/{assessmentId}/schedule',
  'scheduleAssessment',
  'admin',
  'Validate and freeze schedule, rules and question pool',
  'ADMIN',
  ref('AssessmentAdminResponse'),
  {
    body: 'AssessmentScheduleRequest',
    idempotent: true,
    description:
      'Require published compatible versions and at least 2 easy, 1 medium, 1 hard. latestStartAt + 10800 seconds must not exceed closesAt. Persist UTC.',
  },
);
endpoint(
  'post',
  '/admin/assessments/{assessmentId}/cancellation',
  'cancelAssessment',
  'admin',
  'Cancel admission and void active attempts with audit',
  'ADMIN',
  ref('AssessmentAdminResponse'),
  { body: 'CancelAssessmentRequest', idempotent: true },
);
endpoint(
  'post',
  '/admin/assessments/{assessmentId}/assignments',
  'assignStudents',
  'admin',
  'Assign enrolled students atomically',
  'ADMIN',
  ref('AssignmentBatchResponse'),
  { body: 'AssignmentBatchRequest', idempotent: true },
);
endpoint(
  'get',
  '/admin/questions',
  'listQuestions',
  'admin',
  'List question metadata',
  'ADMIN',
  page('QuestionAdminSummary'),
  { parameters: pagination },
);
endpoint(
  'post',
  '/admin/questions',
  'createQuestion',
  'admin',
  'Create question identity and topic mappings',
  'ADMIN',
  ref('QuestionAdminSummary'),
  { body: 'QuestionCreateRequest', idempotent: true, status: 201 },
);
endpoint(
  'post',
  '/admin/questions/{questionId}/versions',
  'createQuestionVersion',
  'admin',
  'Create a draft version and encrypt uploaded cases',
  'ADMIN',
  ref('QuestionVersionAdminResponse'),
  {
    body: 'QuestionVersionWriteRequest',
    idempotent: true,
    status: 201,
    description:
      'Administrative input-only upload. No test payloads, ciphertext, expected outputs or hidden diagnostics appear in the response.',
  },
);
endpoint(
  'get',
  '/admin/questions/{questionId}/versions/{versionId}',
  'getQuestionVersion',
  'admin',
  'Read version metadata and case counts',
  'ADMIN',
  ref('QuestionVersionAdminResponse'),
);
endpoint(
  'put',
  '/admin/questions/{questionId}/versions/{versionId}',
  'replaceDraftQuestionVersion',
  'admin',
  'Replace only a draft version',
  'ADMIN',
  ref('QuestionVersionAdminResponse'),
  { body: 'QuestionVersionWriteRequest', idempotent: true },
);
endpoint(
  'post',
  '/admin/questions/{questionId}/versions/{versionId}/publication',
  'publishQuestionVersion',
  'admin',
  'Publish immutable question version',
  'ADMIN',
  ref('QuestionVersionAdminResponse'),
  { idempotent: true },
);
endpoint(
  'get',
  '/admin/assessments/{assessmentId}/results',
  'listAssessmentResults',
  'admin',
  'Read assessment result summaries',
  'ADMIN',
  page('AssessmentResultResponse'),
  { parameters: pagination },
);
endpoint(
  'get',
  '/admin/audit-logs',
  'listAuditLogs',
  'admin',
  'Read redacted audit history',
  'ADMIN',
  page('AuditLogResponse'),
  { parameters: pagination },
);

endpoint(
  'get',
  '/attempts/{attemptId}/drafts',
  'getAttemptDrafts',
  'attempts',
  'Read own persisted language drafts',
  'STUDENT',
  object({ items: array(ref('DraftResponse')) }),
  { implemented: 3 },
);
endpoint(
  'get',
  '/attempts/{attemptId}/history',
  'getAttemptHistory',
  'attempts',
  'Review own source snapshots without judge diagnostics',
  'STUDENT',
  object({
    items: array(
      object({
        id: uuid(),
        attemptQuestionId: uuid(),
        language: ref('Language'),
        purpose: enums('RUN_PUBLIC', 'SUBMIT', 'FINAL'),
        status: ref('SubmissionStatus'),
        sourceCode: source(),
        acceptedAt: utc(),
      }),
    ),
  }),
  { implemented: 3 },
);
for (const [method, legacy, canonical, operationId] of [
  [
    'post',
    '/student/assessments/{assessmentId}/attempts',
    '/assessments/{assessmentId}/start',
    'startAssessment',
  ],
  ['get', '/student/attempts/{attemptId}', '/attempts/{attemptId}', 'getStudentAttempt'],
  [
    'get',
    '/student/attempts/{attemptId}/questions/{attemptQuestionId}',
    '/attempts/{attemptId}/questions/{attemptQuestionId}',
    'getStudentAttemptQuestion',
  ],
  [
    'put',
    '/student/attempts/{attemptId}/questions/{attemptQuestionId}/drafts/{language}',
    '/attempts/{attemptId}/drafts/{attemptQuestionId}/{language}',
    'saveStudentDraft',
  ],
  [
    'patch',
    '/student/attempts/{attemptId}/questions/{attemptQuestionId}/language',
    '/attempts/{attemptId}/questions/{attemptQuestionId}/language',
    'selectStudentLanguage',
  ],
  [
    'post',
    '/student/attempts/{attemptId}/finalization',
    '/attempts/{attemptId}/finalization',
    'finalizeStudentAttempt',
  ],
]) {
  paths[canonical] = { [method]: { ...paths[legacy][method], operationId } };
}
endpoint(
  'post',
  '/attempts/{attemptId}/run',
  'runAttemptCode',
  'execution',
  'Queue only public tests',
  'STUDENT',
  ref('SubmissionResponse'),
  { body: 'ExecutionCreateRequest', status: 202, idempotent: true, implemented: 4 },
);
endpoint(
  'post',
  '/attempts/{attemptId}/submit-solution',
  'submitAttemptSolution',
  'submissions',
  'Queue hidden evaluation under the configured probing limit',
  'STUDENT',
  ref('SubmissionResponse'),
  { body: 'ExecutionCreateRequest', status: 202, idempotent: true, implemented: 4 },
);
endpoint(
  'get',
  '/submissions/{submissionId}',
  'getStudentSubmission',
  'submissions',
  'Read own asynchronous evaluation status and permitted feedback',
  'STUDENT',
  ref('SubmissionResponse'),
  { implemented: 4 },
);
endpoint(
  'get',
  '/results/{attemptId}',
  'getStudentResult',
  'results',
  'Read own final scores only after result release',
  'STUDENT',
  ref('AssessmentResultResponse'),
  { implemented: 4 },
);
paths['/attempts/{attemptId}/finalize'] = {
  post: {
    ...paths['/attempts/{attemptId}/finalization'].post,
    operationId: 'finalizeAssessment',
    description:
      'Freeze final source snapshots and await all accepted hidden evaluations. Implemented in Step 4.',
  },
};
for (const [route, method] of [
  ['/student/attempts/{attemptId}/questions/{attemptQuestionId}/runs', 'post'],
  ['/student/attempts/{attemptId}/questions/{attemptQuestionId}/submissions', 'post'],
  ['/student/attempts/{attemptId}/submissions/{submissionId}', 'get'],
  ['/student/attempts/{attemptId}/result', 'get'],
])
  paths[route][method].description =
    'Implemented in Step 4. Hidden feedback follows the pinned assessment policy; hidden inputs, outputs and diagnostics are never returned.';
addAdminContracts({
  schemas,
  paths,
  endpoint,
  object,
  string,
  integer,
  array,
  uuid,
  utc,
  nullable,
  enums,
  ref,
});
const document = {
  openapi: '3.1.0',
  info: {
    title: 'DSA Assessment Platform API',
    version: '0.5.0',
    description:
      'Steps 2–5 implement shared authentication, student assessments, immutable grading, role-protected administration and operational readiness. Legacy unregistered routes remain explicitly reserved.',
    license: {
      name: 'UNLICENSED (private project)',
      url: 'https://choosealicense.com/no-permission/',
    },
  },
  servers: [
    { url: '/api/v1', description: 'Same-origin gateway to NestJS. UTC response timestamps.' },
  ],
  tags: [
    'auth',
    'students',
    'assessments',
    'attempts',
    'questions',
    'execution',
    'submissions',
    'results',
    'admin',
    'health',
  ].map((name) => ({ name, description: `${name} feature boundary` })),
  paths,
  components: {
    securitySchemes: {
      cookieAuth: {
        type: 'apiKey',
        in: 'cookie',
        name: '__Host-assessment_session',
        description:
          'Production opaque session. Development uses assessment_session_dev. Secure, HttpOnly, SameSite=Lax, Path=/, no Domain.',
      },
    },
    schemas,
  },
};
const destination = fileURLToPath(new URL('../contracts/openapi.json', import.meta.url));
mkdirSync(fileURLToPath(new URL('../contracts/generated', import.meta.url)), { recursive: true });
writeFileSync(destination, JSON.stringify(document, null, 2) + '\n');
console.log(
  `OpenAPI: ${Object.values(paths).reduce((sum, path) => sum + Object.keys(path).length, 0)} documented operations.`,
);
