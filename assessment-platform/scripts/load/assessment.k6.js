import http from 'k6/http';
import { check, fail, sleep } from 'k6';
import { SharedArray } from 'k6/data';
import { Counter, Rate, Trend } from 'k6/metrics';
import exec from 'k6/execution';

const fixture = JSON.parse(open(__ENV.LOAD_FIXTURE_FILE));
const credentials = new SharedArray('private real credentials', () => fixture.students);
const base = `${__ENV.LOAD_BASE_URL}/api/v1`;
const origin = __ENV.LOAD_BROWSER_ORIGIN;
const apiLatency = new Trend('assessment_api_latency', true);
const completionTime = new Trend('submission_completion_time', true);
const queueWait = new Trend('submission_observed_queue_wait', true);
const throughput = new Counter('completed_submissions');
const rejected = new Counter('backpressure_rejections');
const failures = new Rate('workflow_failures');
const expiries = new Counter('verified_expiry_rejections');
const saved = new Counter('confirmed_draft_saves');
const privateLeak = new Rate('hidden_data_leak');
const integrity = new Rate('workflow_integrity_failure');
const fullExpiry = __ENV.LOAD_EXPIRY_MODE === 'true';
const workSeconds = Number(__ENV.LOAD_WORK_SECONDS ?? 900);
const submissionTimeout = Number(__ENV.LOAD_SUBMISSION_TIMEOUT_SECONDS ?? 600);
const vus = Number(__ENV.LOAD_STUDENT_COUNT ?? 500);
if (!Number.isInteger(vus) || vus < 500 || vus > 2000 || credentials.length < vus)
  throw new Error('500 distinct prepared accounts required');
if (
  !Number.isFinite(workSeconds) ||
  workSeconds < 60 ||
  workSeconds > 10800 ||
  !Number.isFinite(submissionTimeout) ||
  submissionTimeout < 60 ||
  submissionTimeout > 1800
)
  throw new Error(
    'Work duration must be 60..10800 seconds and evaluation timeout 60..1800 seconds',
  );
if (!__ENV.LOAD_OUTPUT_DIRECTORY || __ENV.LOAD_TEST_ACK !== 'DEDICATED_ISOLATED_LOAD_ENVIRONMENT')
  throw new Error('Invoke through run-load-test.mjs on the isolated test environment');

export const options = {
  scenarios: {
    students: {
      executor: 'per-vu-iterations',
      vus,
      iterations: 1,
      maxDuration: fullExpiry ? '3h30m' : '45m',
      gracefulStop: '2m',
    },
  },
  summaryTrendStats: ['min', 'avg', 'med', 'p(50)', 'p(95)', 'p(99)', 'max'],
  thresholds: {
    assessment_api_latency: ['p(95)<1000', 'p(99)<2500'],
    workflow_failures: ['rate<0.01'],
    hidden_data_leak: ['rate==0'],
    workflow_integrity_failure: ['rate==0'],
    checks: ['rate>0.99'],
    submission_completion_time: [`p(95)<${submissionTimeout * 1000}`],
    confirmed_draft_saves: [`count>=${vus * 4}`],
    completed_submissions: [`count>=${vus * 2}`],
    ...(fullExpiry ? { verified_expiry_rejections: [`count>=${Math.floor(vus / 5)}`] } : {}),
  },
  discardResponseBodies: false,
  tags: { test: 'assessment-500', run_id: fixture.runId },
};
function payload(response) {
  try {
    return response.json();
  } catch {
    return null;
  }
}
function request(method, path, body, name, headers = {}) {
  const response = http.request(
    method,
    `${base}${path}`,
    body === undefined ? null : JSON.stringify(body),
    {
      headers: {
        Origin: origin,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...headers,
      },
      tags: { name },
      timeout: '30s',
    },
  );
  apiLatency.add(response.timings.duration, { operation: name });
  return response;
}
function mutation(method, path, body, name, key) {
  const csrf = request('GET', '/auth/csrf', undefined, 'csrf');
  const token = payload(csrf)?.data?.csrfToken;
  if (!token) fail('CSRF response unavailable');
  return request(method, path, body, name, {
    'X-CSRF-Token': token,
    ...(key ? { 'Idempotency-Key': key } : {}),
  });
}
function assert(response, expected, description) {
  const ok = check(response, { [description]: (value) => expected.includes(value.status) });
  failures.add(!ok);
  if (!ok) fail(`${description}; status ${response.status}`); // No credentials/source/body in logs.
  return payload(response);
}
function key(kind, index = 0) {
  return `load_${fixture.runId}_${exec.vu.idInTest}_${kind}_${index}`;
}
function pollSubmission(id, hidden, acceptedAt) {
  let lastStatus = 'PENDING',
    observedRunning = false;
  const deadline = Date.now() + submissionTimeout * 1000;
  while (Date.now() < deadline) {
    const result = assert(
      request('GET', `/submissions/${id}`, undefined, 'submission_poll'),
      [200],
      'submission owned',
    );
    const submission = result.data;
    if (hidden) {
      const serialized = JSON.stringify(submission);
      const leaked =
        serialized.includes('inputCiphertext') ||
        serialized.includes('privateDiagnosticsCiphertext') ||
        serialized.includes('expectedOutput') ||
        (submission.result?.publicCaseResults?.length ?? 0) > 0;
      privateLeak.add(leaked);
      check(leaked, { 'hidden raw data absent': (value) => value === false });
    }
    if (!observedRunning && ['RUNNING', 'COMPLETED'].includes(submission.status)) {
      queueWait.add(Date.now() - acceptedAt);
      observedRunning = true;
    }
    lastStatus = submission.status;
    if (lastStatus === 'COMPLETED') {
      completionTime.add(Date.now() - acceptedAt);
      throughput.add(1);
      return submission;
    }
    if (['INFRASTRUCTURE_FAILED', 'CANCELLED'].includes(lastStatus))
      fail(`Evaluation terminated: ${lastStatus}`);
    sleep(1 + (exec.vu.idInTest % 5) * 0.1);
  }
  failures.add(true);
  fail(`Evaluation timeout in status ${lastStatus}`);
}
export default function () {
  const credential = credentials[exec.vu.idInTest - 1];
  // Warm up real bounded Argon2 admission; all authenticated VUs align at the same
  // server-reported assessment opening. Set LOAD_LOGIN_SPIKE=true to test overload.
  if (__ENV.LOAD_LOGIN_SPIKE !== 'true') sleep((exec.vu.idInTest - 1) * 0.1);
  let loggedIn = false;
  for (let retry = 0; retry < 24; retry++) {
    const response = mutation(
      'POST',
      '/auth/login',
      { identifier: credential.identifier, password: credential.password, remember: false },
      'login',
    );
    if (response.status === 200) {
      loggedIn = true;
      break;
    }
    if (![429, 503].includes(response.status)) assert(response, [200], 'login succeeds');
    rejected.add(1, { operation: 'login' });
    sleep(5 + (exec.vu.idInTest % 5));
  }
  if (!loggedIn) fail('Login admission did not recover');
  assert(request('GET', '/auth/me', undefined, 'profile'), [200], 'authenticated profile');
  let dashboard = assert(
    request('GET', '/assessments', undefined, 'dashboard'),
    [200],
    'real dashboard',
  );
  assert(
    request('GET', '/assessments/upcoming', undefined, 'upcoming'),
    [200],
    'upcoming retrieval',
  );
  const assigned = dashboard.data.items.find((item) => item.assessment.id === fixture.assessmentId);
  if (!assigned) fail('Prepared assessment not assigned');
  const opensAt = Date.parse(assigned.assessment.opensAt);
  const serverNow = Date.parse(dashboard.meta.serverNow);
  const openingDelay = Math.max(
    0,
    opensAt - serverNow,
    70000 - (Date.now() - exec.scenario.startTime),
  );
  if (openingDelay > 300000)
    fail('Schedule opening is more than five minutes away; prepare a suitable assessment');
  // Poll with a monotonic elapsed interval; the actual start authorization is backend.
  const waitStarted = Date.now();
  while (Date.now() - waitStarted < openingDelay) {
    sleep(Math.min(10, Math.max(0.1, (openingDelay - (Date.now() - waitStarted)) / 1000)));
    assert(
      request(
        'GET',
        `/assessments/${fixture.assessmentId}/eligibility`,
        undefined,
        'countdown_eligibility',
      ),
      [200],
      'eligibility poll',
    );
  }
  let start = mutation(
    'POST',
    `/assessments/${fixture.assessmentId}/start`,
    {},
    'start',
    key('start'),
  );
  const attempt = assert(start, [200], 'assessment start persisted').data;
  const duplicate = assert(
    mutation(
      'POST',
      `/assessments/${fixture.assessmentId}/start`,
      {},
      'start_duplicate',
      key('start'),
    ),
    [200],
    'duplicate start accepted',
  ).data;
  integrity.add(
    !check(duplicate, {
      'duplicate start returns same attempt': (value) => value.id === attempt.id,
    }),
  );
  integrity.add(
    !check(attempt, {
      'four stable questions allocated': (value) =>
        value.questions.length === 4 &&
        value.questions.filter((question) => question.difficulty === 'EASY').length === 2 &&
        value.questions.filter((question) => question.difficulty === 'MEDIUM').length === 1 &&
        value.questions.filter((question) => question.difficulty === 'HARD').length === 1,
    }),
  );
  if (!attempt.capabilities.executionAvailable)
    fail('Real reviewed judge required for this workload');
  const revisions = {};
  for (const question of attempt.questions) {
    const content = assert(
      request(
        'GET',
        `/attempts/${attempt.id}/questions/${question.id}`,
        undefined,
        'question_navigation',
      ),
      [200],
      'question owned',
    ).data;
    integrity.add(
      !check(content, {
        'question version remains pinned': (value) =>
          value.questionVersionId === question.questionVersionId,
      }),
    );
    const source = fixture.sources[question.questionVersionId]?.PYTHON;
    if (!source) fail('Reference source unavailable');
    const previous = attempt.drafts.find(
      (draft) => draft.attemptQuestionId === question.id && draft.language === 'PYTHON',
    );
    revisions[question.id] = previous?.revision ?? 0;
    const save = assert(
      mutation(
        'PUT',
        `/attempts/${attempt.id}/drafts/${question.id}/PYTHON`,
        { sourceCode: source, expectedRevision: revisions[question.id] },
        'autosave',
      ),
      [200],
      'draft persisted',
    ).data;
    revisions[question.id] = save.revision;
    saved.add(1);
  }
  const q = attempt.questions[0],
    source = fixture.sources[q.questionVersionId].PYTHON;
  for (const purpose of ['run', 'submit-solution']) {
    const acceptedAt = Date.now(),
      requestKey = key(purpose);
    const accepted = assert(
      mutation(
        'POST',
        `/attempts/${attempt.id}/${purpose}`,
        { attemptQuestionId: q.id, language: 'PYTHON', sourceCode: source },
        purpose,
        requestKey,
      ),
      [202],
      'real evaluation accepted',
    ).data;
    const replay = assert(
      mutation(
        'POST',
        `/attempts/${attempt.id}/${purpose}`,
        { attemptQuestionId: q.id, language: 'PYTHON', sourceCode: source },
        `${purpose}_duplicate`,
        requestKey,
      ),
      [202],
      'duplicate evaluation replay',
    ).data;
    integrity.add(
      !check(replay, { 'duplicate submission same ID': (value) => value.id === accepted.id }),
    );
    pollSubmission(accepted.id, purpose === 'submit-solution', acceptedAt);
  }
  const expiresAt = Date.parse(attempt.expiresAt);
  const initialServer = Date.parse(start.json().meta.serverNow);
  const localStart = Date.now();
  const expireThisStudent = fullExpiry && exec.vu.idInTest % 5 === 0;
  const stopAfter = expireThisStudent
    ? expiresAt - initialServer + 3000
    : Math.max(0, exec.scenario.startTime + 70000 + workSeconds * 1000 - localStart);
  let saves = 0;
  while (Date.now() - localStart < stopAfter) {
    sleep(10 + (exec.vu.idInTest % 5));
    const snapshot = assert(
      request('GET', `/attempts/${attempt.id}`, undefined, 'attempt_timer_poll'),
      [200],
      'timer snapshot',
    ).data;
    if (snapshot.status !== 'IN_PROGRESS') break;
    const selected = attempt.questions[saves % attempt.questions.length];
    assert(
      request(
        'GET',
        `/attempts/${attempt.id}/questions/${selected.id}`,
        undefined,
        'question_navigation',
      ),
      [200],
      'navigation preserved',
    );
    const value = `${fixture.sources[selected.questionVersionId].PYTHON}\n# load edit ${saves}\n`;
    const response = mutation(
      'PUT',
      `/attempts/${attempt.id}/drafts/${selected.id}/PYTHON`,
      { sourceCode: value, expectedRevision: revisions[selected.id] },
      'autosave',
    );
    if (
      response.status === 410 &&
      Date.parse(payload(response)?.error?.serverNow ?? '') >= expiresAt
    )
      break;
    const draft = assert(response, [200], 'ordered autosave persisted').data;
    revisions[selected.id] = draft.revision;
    saved.add(1);
    saves++;
    if (saves % 3 === 0)
      assert(
        request('GET', `/attempts/${attempt.id}/drafts`, undefined, 'refresh_drafts'),
        [200],
        'refresh recovers drafts',
      );
  }
  if (expireThisStudent) {
    const response = mutation(
      'POST',
      `/attempts/${attempt.id}/submit-solution`,
      { attemptQuestionId: q.id, language: 'PYTHON', sourceCode: source },
      'post_expiry_submit',
      key('expired'),
    );
    assert(response, [410], 'backend rejects after expiry');
    expiries.add(1);
  } else {
    // All normal students share the same finish horizon: this deliberately creates
    // a finalization spike rather than smoothing it away with random arrivals.
    const latest = assert(
      request('GET', `/attempts/${attempt.id}`, undefined, 'finalize_snapshot'),
      [200],
      'finalization snapshot',
    ).data;
    assert(
      mutation(
        'POST',
        `/attempts/${attempt.id}/finalize`,
        { expectedStateVersion: latest.stateVersion },
        'finalize',
        key('finalize'),
      ),
      [202],
      'assessment freeze durable',
    );
  }
  const finalDeadline = Date.now() + submissionTimeout * 1000;
  let finalState;
  do {
    finalState = assert(
      request('GET', `/attempts/${attempt.id}`, undefined, 'finalization_poll'),
      [200],
      'frozen attempt available',
    ).data;
    if (finalState.status === 'FINALIZED') break;
    sleep(2);
  } while (Date.now() < finalDeadline);
  integrity.add(
    !check(finalState, {
      'final grading reaches terminal state': (value) => value.status === 'FINALIZED',
    }),
  );
  assert(
    request('GET', `/results/${attempt.id}`, undefined, 'student_result'),
    [200, 403, 404],
    'results release policy enforced',
  );
  assert(mutation('POST', '/auth/logout', {}, 'logout'), [200], 'logout invalidated');
}
export function handleSummary(data) {
  return { [`${__ENV.LOAD_OUTPUT_DIRECTORY}/summary.json`]: JSON.stringify(data, null, 2) };
}
