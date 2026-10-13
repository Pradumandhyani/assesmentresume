/** Step 5 contracts extend the earlier student specification; legacy reserved routes remain labelled. */
export function addAdminContracts({
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
}) {
  // These unregistered Step 1 shapes were superseded by the concrete management contracts.
  for (const name of ['AssessmentCreateRequest','AssessmentUpdateRequest','AssignmentBatchRequest','AssignmentBatchResponse','QuestionCreateRequest','QuestionAdminSummary','AuditLogResponse']) delete schemas[name];
  const boolean = { type: 'boolean' },
    money = string({ pattern: '^\\d{1,6}(\\.\\d{1,2})?$' });
  const text = string(),
    id = uuid(),
    time = nullable(utc());
  const page = (item) =>
    object({
      items: array(ref(item)),
      page: integer({ minimum: 1 }),
      pageSize: integer({ minimum: 1, maximum: 100 }),
      total: integer(),
    });
  const params = [
    { name: 'page', in: 'query', schema: integer({ minimum: 1, default: 1 }) },
    { name: 'pageSize', in: 'query', schema: integer({ minimum: 1, maximum: 100, default: 25 }) },
    ...['search', 'active', 'status', 'assessmentId', 'studentId'].map((name) => ({
      name,
      in: 'query',
      schema: name.endsWith('Id') ? uuid() : string({ maxLength: 128 }),
    })),
  ];
  schemas.AdminRevision = object({ revision: integer({ minimum: 1 }) });
  schemas.AdminMutation = object(
    {
      id,
      revision: integer({ minimum: 1 }),
      versionId: id,
      status: text,
      assignedCount: integer(),
      archived: boolean,
      updated: boolean,
    },
    ['id'],
  );
  schemas.AdminRule = object({
    durationSeconds: integer({ minimum: 900, maximum: 21600, default: 10800 }),
    easyCount: integer({ maximum: 20, default: 2 }),
    mediumCount: integer({ maximum: 20, default: 1 }),
    hardCount: integer({ maximum: 20, default: 1 }),
    allowedLanguages: array(ref('Language'), { minItems: 1, maxItems: 3, uniqueItems: true }),
    allowedTopics: array(text),
    marks: object({ EASY: money, MEDIUM: money, HARD: money }),
    submissionSelection: enums('FINAL_SNAPSHOT', 'BEST_VALID', 'LATEST_VALID'),
    partialScoring: boolean,
    hiddenFeedbackImmediate: boolean,
  });
  const assessment = {
    title: string({ maxLength: 200 }),
    description: text,
    opensAt: utc(),
    latestStartAt: utc(),
    closesAt: utc(),
    resultsReleaseAt: time,
    revision: integer({ minimum: 1 }),
    rule: ref('AdminRule'),
    questionVersionIds: array(id, { maxItems: 500, uniqueItems: true }),
  };
  schemas.AdminAssessmentWrite = object(
    assessment,
    Object.keys(assessment).filter((k) => k !== 'revision'),
  );
  schemas.AdminAssessment = object({
    ...assessment,
    id,
    status: ref('AssessmentStatus'),
    opensAt: time,
    latestStartAt: time,
    closesAt: time,
    rule: nullable(ref('AdminRule')),
    pool: array(
      object({
        id,
        questionId: id,
        title: text,
        difficulty: ref('Difficulty'),
        maxScore: money,
        topics: array(text),
      }),
    ),
    assignmentCount: integer(),
    attemptCount: integer(),
  });
  schemas.AdminAssessmentPage = page('AdminAssessment');
  schemas.AdminStudent = object({
    id,
    externalId: text,
    displayName: text,
    cohort: nullable(text),
    isActive: boolean,
    assignments: array(
      object({
        assessmentId: id,
        title: text,
        status: text,
        attemptId: nullable(id),
        attemptStatus: nullable(text),
        score: nullable(money),
        eligibility: text,
      }),
    ),
  });
  schemas.AdminStudentPage = page('AdminStudent');
  schemas.AdminStudentWrite = object(
    { active: boolean, cohort: nullable(string({ maxLength: 100 })) },
    [],
  );
  schemas.AdminAssignments = object(
    {
      studentIds: array(id, { maxItems: 5000 }),
      cohorts: array(string({ maxLength: 100 }), { maxItems: 100 }),
      revoke: boolean,
    },
    [],
  );
  schemas.AdminCase = object({
    ordinal: integer({ minimum: 1, maximum: 64 }),
    visibility: enums('PUBLIC', 'HIDDEN'),
    input: string({ maxLength: 262144 }),
    expectedOutput: string({ maxLength: 262144 }),
    weight: money,
  });
  schemas.AdminAdapter = {
    oneOf: [
      object({ kind: enums('STDIO') }),
      object({
        kind: enums('SOURCE_WRAPPER'),
        prefix: string({ maxLength: 16384 }),
        suffix: string({ maxLength: 16384 }),
      }),
    ],
    description:
      'SOURCE_WRAPPER is read-only in the browser. Only an identical previously trusted adapter is accepted when updating a draft; new wrappers require deployment review.',
  };
  schemas.AdminTemplate = object(
    {
      language: ref('Language'),
      starterCode: string({ maxLength: 65536 }),
      toolchainId: text,
      executionAdapter: ref('AdminAdapter'),
    },
    ['language', 'starterCode', 'toolchainId'],
  );
  const question = {
    slug: string({ maxLength: 200 }),
    title: string({ maxLength: 200 }),
    difficulty: ref('Difficulty'),
    topics: array(text),
    tags: array(text),
    statement: text,
    inputFormat: text,
    outputFormat: text,
    constraints: text,
    explanation: text,
    publicExamples: array(
      object({ ordinal: integer({ minimum: 1 }), input: text, expectedOutput: text }),
    ),
    maxScore: money,
    cpuTimeMs: integer({ minimum: 1, maximum: 10000 }),
    wallTimeMs: integer({ minimum: 1, maximum: 30000 }),
    memoryLimitKiB: integer({ minimum: 16384, maximum: 1048576 }),
    outputLimitBytes: integer({ minimum: 1024, maximum: 65536 }),
    processLimit: integer({ minimum: 1, maximum: 64 }),
    outputComparison: enums('TOKENS', 'EXACT'),
    templates: array(ref('AdminTemplate'), { minItems: 3, maxItems: 3 }),
    testCases: array(ref('AdminCase'), { minItems: 2, maxItems: 64 }),
    revision: integer({ minimum: 1 }),
  };
  schemas.AdminQuestionWrite = object(
    question,
    Object.keys(question).filter((k) => k !== 'revision'),
  );
  schemas.AdminQuestionDetail = object({
    ...question,
    id,
    versionId: id,
    version: integer({ minimum: 1 }),
    status: enums('DRAFT', 'PUBLISHED'),
    archivedAt: time,
  });
  schemas.AdminQuestionSummary = object({
    id,
    slug: text,
    archivedAt: time,
    versionId: id,
    version: integer({ minimum: 1 }),
    revision: integer({ minimum: 1 }),
    status: enums('DRAFT', 'PUBLISHED'),
    title: text,
    difficulty: ref('Difficulty'),
    topics: array(text),
    maxScore: money,
  });
  schemas.AdminQuestionPage = page('AdminQuestionSummary');
  schemas.AdminQuestionValidation = object({
    valid: boolean,
    issues: array(text),
    executionValidated: { type: 'boolean', const: false },
    message: text,
  });
  schemas.AdminQueue = object({
    pending: integer(),
    queued: integer(),
    running: integer(),
    failed: integer(),
    oldestPendingAt: time,
    oldestPendingAgeSeconds: nullable(integer()),
    healthyWorkers: integer(),
    status: enums('HEALTHY', 'DEGRADED', 'DISABLED'),
  });
  schemas.AdminAudit = object({
    id,
    action: text,
    entityType: text,
    entityId: nullable(text),
    occurredAt: utc(),
    actorName: text,
    metadata: { type: 'object', additionalProperties: true },
  });
  schemas.AdminAuditPage = page('AdminAudit');
  schemas.AdminDashboard = object({
    totalStudents: integer(),
    totalAssessments: integer(),
    upcomingAssessments: integer(),
    activeAssessments: integer(),
    completedAssessments: integer(),
    currentlyActiveStudents: integer(),
    completionRate: { type: 'number', minimum: 0, maximum: 1 },
    queue: ref('AdminQueue'),
    recentActions: array(ref('AdminAudit')),
  });
  schemas.AdminMonitorRow = object({
    assignmentId: id,
    studentId: id,
    studentName: text,
    externalId: text,
    attemptId: nullable(id),
    status: enums(
      'NOT_STARTED',
      'ACTIVE',
      'COMPLETED',
      'EXPIRED',
      'STALE',
      'EVALUATION_PENDING',
      'EVALUATION_FAILED',
      'CANCELLED',
    ),
    attemptStatus: nullable(ref('AttemptStatus')),
    lastHeartbeatAt: time,
    expiresAt: time,
    resultStatus: nullable(text),
    score: nullable(money),
  });
  schemas.AdminMonitoring = object({
    items: array(ref('AdminMonitorRow')),
    counts: { type: 'object', additionalProperties: integer() },
    serverNow: utc(),
    page: integer(),
    pageSize: integer(),
    total: integer(),
    message: text,
  });
  schemas.AdminSubmission = object({
    id,
    attemptId: id,
    studentId: id,
    studentName: text,
    externalId: text,
    assessmentId: id,
    assessmentTitle: text,
    questionTitle: text,
    purpose: enums('RUN_PUBLIC', 'SUBMIT', 'FINAL'),
    language: ref('Language'),
    status: ref('SubmissionStatus'),
    acceptedAt: utc(),
    completedAt: time,
    errorCode: nullable(text),
    result: nullable(
      object({
        verdict: ref('Verdict'),
        passedCount: integer(),
        totalCount: integer(),
        score: money,
        cpuTimeMs: nullable(integer()),
        memoryKiB: nullable(integer()),
      }),
    ),
  });
  schemas.AdminSubmissionPage = page('AdminSubmission');
  schemas.AdminResult = object({
    id,
    attemptId: id,
    assessmentId: id,
    assessmentTitle: text,
    studentId: id,
    studentName: text,
    externalId: text,
    status: enums('PENDING', 'COMPLETE', 'REQUIRES_REVIEW'),
    totalScore: nullable(money),
    maximumScore: money,
    computedAt: time,
    questions: array(
      object({
        title: text,
        difficulty: ref('Difficulty'),
        topics: array(text),
        score: nullable(money),
        maximumScore: money,
        verdict: nullable(ref('Verdict')),
        submissionId: nullable(id),
      }),
    ),
  });
  const grouped = array(object({ label: text, earned: money, maximum: money, count: integer() }));
  schemas.AdminAnalytics = object({
    completionRate: { type: 'number', minimum: 0, maximum: 1 },
    scoreDistribution: array(object({ range: text, count: integer() })),
    difficulty: grouped,
    topics: grouped,
    questions: grouped,
  });
  schemas.AdminResultPage = object({
    ...page('AdminResult').properties,
    analytics: ref('AdminAnalytics'),
  });
  schemas.AdminSettings = object({
    executionEnabled: boolean,
    questionAuthoringAvailable: boolean,
    toolchains: array(object({ id: text, language: ref('Language'), version: text })),
    queueLimits: object({ public: integer(), hidden: integer() }),
    session: object({ secure: boolean, sameSite: enums('lax'), ttlSeconds: integer() }),
    policy: object({ maxQuestions: integer(), maxDurationSeconds: integer() }),
    serverNow: utc(),
  });
  const get = (url, name, schema, paged = false) =>
    endpoint('get', url, name, 'admin', name, 'ADMIN', ref(schema), {
      implemented: 5,
      ...(paged ? { parameters: params } : {}),
    });
  const write = (method, url, name, body) =>
    endpoint(method, url, name, 'admin', name, 'ADMIN', ref('AdminMutation'), {
      implemented: 5,
      body,
      idempotent: true,
    });
  get('/admin/dashboard', 'adminDashboard', 'AdminDashboard');
  get('/admin/settings', 'adminSettings', 'AdminSettings');
  get('/admin/students', 'adminStudents', 'AdminStudentPage', true);
  write('patch', '/admin/students/{studentId}', 'adminUpdateStudent', 'AdminStudentWrite');
  get('/admin/assessments', 'adminAssessments', 'AdminAssessmentPage', true);
  get('/admin/assessments/{assessmentId}', 'adminAssessmentDetail', 'AdminAssessment');
  write('post', '/admin/assessments', 'adminCreateAssessment', 'AdminAssessmentWrite');
  write(
    'patch',
    '/admin/assessments/{assessmentId}',
    'adminUpdateAssessment',
    'AdminAssessmentWrite',
  );
  for (const action of ['publish', 'cancel'])
    write(
      'post',
      `/admin/assessments/{assessmentId}/${action}`,
      `admin${action}Assessment`,
      'AdminRevision',
    );
  write(
    'post',
    '/admin/assessments/{assessmentId}/assignments',
    'adminAssignStudents',
    'AdminAssignments',
  );
  get(
    '/admin/assessments/{assessmentId}/monitor',
    'adminMonitorAssessment',
    'AdminMonitoring',
    true,
  );
  get('/admin/questions', 'adminQuestions', 'AdminQuestionPage', true);
  get('/admin/questions/{questionId}', 'adminQuestionDetail', 'AdminQuestionDetail');
  paths['/admin/questions/{questionId}'].get.description +=
    ' Authorized authoring-only plaintext cases use the separate admin database identity/keyring; every view is audited. This schema is never reachable from student responses.';
  write('post', '/admin/questions', 'adminCreateQuestion', 'AdminQuestionWrite');
  write('patch', '/admin/questions/{questionId}', 'adminUpdateQuestion', 'AdminQuestionWrite');
  for (const action of ['draft', 'publish', 'archive'])
    write(
      'post',
      `/admin/questions/{questionId}/${action}`,
      `admin${action}Question`,
      'AdminRevision',
    );
  endpoint(
    'post',
    '/admin/questions/{questionId}/validate',
    'adminValidateQuestion',
    'admin',
    'Validate structural publication invariants',
    'ADMIN',
    ref('AdminQuestionValidation'),
    {
      implemented: 5,
      body: 'AdminRevision',
      description:
        'Structural and encryption validation only. Does not claim compilation/reference execution; the isolated runtime gate is separate.',
    },
  );
  get('/admin/submissions', 'adminSubmissions', 'AdminSubmissionPage', true);
  get('/admin/results', 'adminResults', 'AdminResultPage', true);
  endpoint(
    'get',
    '/admin/results/export',
    'adminExportResults',
    'admin',
    'Export at most 10000 filtered results with spreadsheet formula neutralization',
    'ADMIN',
    text,
    { implemented: 5, parameters: params },
  );
  paths['/admin/results/export'].get.responses['200'].content = {
    'text/csv': { schema: string() },
  };
  get('/admin/audit-logs', 'adminAuditLogs', 'AdminAuditPage', true);
  endpoint(
    'post',
    '/attempts/{attemptId}/heartbeat',
    'attemptHeartbeat',
    'attempts',
    'Record an owned active attempt heartbeat; inactivity never implies cheating',
    'STUDENT',
    object({
      attemptId: id,
      status: enums('IN_PROGRESS'),
      lastHeartbeatAt: utc(),
      expiresAt: utc(),
    }),
    { implemented: 5, body: 'EmptyRequest' },
  );
  schemas.EmptyRequest = object({});
  endpoint(
    'get',
    '/health/live',
    'healthLive',
    'health',
    'Process liveness',
    'PUBLIC',
    object({ live: boolean }),
    { implemented: 5 },
  );
  endpoint(
    'get',
    '/health/ready',
    'healthReady',
    'health',
    'Database and enabled judge dependency readiness',
    'PUBLIC',
    object({
      ready: boolean,
      dependencies: object({
        database: enums('READY', 'UNAVAILABLE'),
        queue: enums('READY', 'UNAVAILABLE', 'DISABLED'),
        execution: enums('READY', 'UNAVAILABLE', 'DISABLED'),
      }),
    }),
    { implemented: 5 },
  );
  paths['/health/ready'].get.responses['503'] = {
    ...paths['/health/ready'].get.responses['200'],
    description: 'A required dependency is unavailable; ready is false.',
  };
}
