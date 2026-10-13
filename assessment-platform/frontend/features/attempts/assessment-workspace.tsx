'use client';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  Cloud,
  CloudOff,
  CodeXml,
  FileText,
  History,
  LoaderCircle,
  Moon,
  Play,
  Settings2,
  Sun,
  Upload,
  WifiOff,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { PlatformLogo } from '@/components/platform-logo';
import { useSession } from '@/features/auth/use-auth';
import { ApiError } from '@/services/api-client';
import { attemptApi, type Attempt, type Envelope, type Language } from '@/services/attempt-api';
import { DraftStore, draftKey, type BufferDraft } from './draft-store';
import { ExamTimer, useExamClock } from './exam-timer';
import { ResizablePanels } from './resizable-panels';
import { ProblemContent } from './problem-content';
import { ExecutionPanel } from './execution-panel';
import { useDraftAutosave } from './use-draft-autosave';
import { executionState, useExecution } from './use-execution';
const CodeEditor = dynamic(() => import('./code-editor').then((m) => m.CodeEditor), {
  ssr: false,
  loading: () => <div className="editor-loading">Loading editor…</div>,
});
const languageNames = { PYTHON: 'Python', JAVA: 'Java', CPP: 'C++' };
const saveLabels = {
  saved: 'Saved to server',
  starter: 'Starter template',
  dirty: 'Unsaved changes',
  saving: 'Saving…',
  offline: 'Not saved · retrying',
  conflict: 'Draft conflict',
  error: 'Save failed',
};
function recover(
  key: string,
): Array<{ questionId: string; language: Language; source: string; revision: number }> {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(key) ?? '[]');
    return Array.isArray(value)
      ? value.filter(
          (d) =>
            d &&
            typeof d.questionId === 'string' &&
            ['PYTHON', 'JAVA', 'CPP'].includes(d.language) &&
            typeof d.source === 'string' &&
            Number.isInteger(d.revision) &&
            d.revision >= 0,
        )
      : [];
  } catch {
    return [];
  }
}
export function AssessmentWorkspace({ attemptId }: { attemptId: string }) {
  const router = useRouter();
  const session = useSession();
  const query = useQuery({
    queryKey: ['attempt', attemptId],
    queryFn: ({ signal }) => attemptApi.get(attemptId, signal),
    refetchInterval: 10000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: 'always',
    retry: (count, error) =>
      !(error instanceof ApiError && [401, 403, 404].includes(error.status)) && count < 2,
  });
  useEffect(() => {
    if (
      (session.error instanceof ApiError && session.error.status === 401) ||
      (query.error instanceof ApiError && query.error.status === 401)
    )
      router.replace('/login');
  }, [session.error, query.error, router]);
  if (!query.data || !session.data?.data.student)
    return (
      <div className="workspace-loading" role={query.error ? 'alert' : 'status'}>
        {query.error ? (
          <>
            <h1>Unable to restore this attempt</h1>
            <p>{query.error.message}</p>
            <Button
              className="primary-button"
              onClick={() => {
                void query.refetch();
              }}
            >
              Retry
            </Button>
            <Button variant="outline" onClick={() => router.push('/dashboard')}>
              Dashboard
            </Button>
          </>
        ) : (
          <>
            <div className="skeleton" />
            <p>Restoring your questions and saved code…</p>
          </>
        )}
      </div>
    );
  return (
    <Workspace
      key={`${session.data.data.student.id}:${attemptId}`}
      attempt={query.data}
      student={session.data.data.student}
      refresh={() => {
        void query.refetch();
      }}
      connectionError={query.error?.message ?? null}
    />
  );
}
function Workspace({
  attempt,
  student,
  refresh,
  connectionError,
}: {
  attempt: Envelope<Attempt>;
  student: { id: string; externalId: string; displayName: string };
  refresh: () => void;
  connectionError: string | null;
}) {
  const router = useRouter(),
    cache = useQueryClient();
  const a = attempt.data;
  const clock = useExamClock(attempt.meta.serverNow, a.expiresAt, attempt.timing);
  const readOnly = a.status !== 'IN_PROGRESS' || clock.expired || !clock.synchronized;
  useEffect(() => {
    if (readOnly) return;
    let active = true,
      sending = false;
    const send = async () => {
      if (!active || sending || !navigator.onLine) return;
      sending = true;
      try {
        await attemptApi.heartbeat(a.id);
      } catch {
        /* Connectivity is not cheating; the existing polling UI reports disconnection. */
      } finally {
        sending = false;
      }
    };
    void send();
    const interval = setInterval(() => {
      void send();
    }, 30000);
    const wake = () => {
      if (document.visibilityState === 'visible') void send();
    };
    window.addEventListener('online', wake);
    document.addEventListener('visibilitychange', wake);
    return () => {
      active = false;
      clearInterval(interval);
      window.removeEventListener('online', wake);
      document.removeEventListener('visibilitychange', wake);
    };
  }, [a.id, readOnly]);
  const [selected, setSelected] = useState(a.questions[0]!.id);
  const question = a.questions.find((q) => q.id === selected) ?? a.questions[0]!;
  const language = question.selectedLanguage;
  const [mobileTab, setMobileTab] = useState<'problem' | 'code' | 'results'>('problem');
  const [resultTab, setResultTab] = useState<'public' | 'hidden'>('public');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [fontSize, setFontSize] = useState(14);
  const [settings, setSettings] = useState(false);
  const [dialog, setDialog] = useState<'finalize' | 'leave' | 'history' | 'conflict' | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [storageError, setStorageError] = useState(false);
  const storageKey = `assessment-pending:${student.id}:${a.id}`;
  const storage = useRef<
    Array<{ questionId: string; language: Language; source: string; revision: number }>
  >([]);
  const expiryRequested = useRef(false);
  const finalRequest = useRef<{ key: string; version: number } | null>(null);
  const persist = useCallback(
    (drafts: BufferDraft[]) => {
      try {
        if (drafts.length) sessionStorage.setItem(storageKey, JSON.stringify(drafts));
        else sessionStorage.removeItem(storageKey);
      } catch {
        setStorageError(true);
      }
    },
    [storageKey],
  );
  const store = useMemo(
    () =>
      new DraftStore(
        async (q, l, code, revision) => (await attemptApi.save(a.id, q, l, code, revision)).data,
        persist,
      ),
    [a.id, persist],
  );
  const buffers = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  const content = useQuery({
    queryKey: ['question', a.id, question.id],
    queryFn: ({ signal }) => attemptApi.question(a.id, question.id, signal),
    staleTime: Infinity,
    retry: 1,
  });
  const history = useQuery({
    queryKey: ['attempt-history', a.id],
    queryFn: ({ signal }) => attemptApi.history(a.id, signal),
    enabled: dialog === 'history' && a.capabilities.submissionReviewAllowed,
    staleTime: 0,
  });
  const conflictServer = useQuery({
    queryKey: ['conflict-drafts', a.id],
    queryFn: () => attemptApi.drafts(a.id),
    enabled: dialog === 'conflict',
    staleTime: 0,
  });
  useEffect(() => {
    storage.current = recover(storageKey);
    for (const recovered of storage.current) {
      if (
        !a.questions.some((q) => q.id === recovered.questionId) ||
        !a.rules.allowedLanguages.includes(recovered.language)
      )
        continue;
      const saved = a.drafts.find(
        (d) => d.attemptQuestionId === recovered.questionId && d.language === recovered.language,
      );
      store.ensure(
        recovered.questionId,
        recovered.language,
        saved?.sourceCode ?? '',
        saved,
        recovered,
      );
    }
  }, [storageKey, store, a.questions, a.rules.allowedLanguages, a.drafts]);
  useEffect(() => {
    if (content.data)
      for (const template of content.data.data.templates) {
        const saved = a.drafts.find(
          (d) => d.attemptQuestionId === question.id && d.language === template.language,
        );
        const recovered = storage.current.find(
          (d) => d.questionId === question.id && d.language === template.language,
        );
        store.ensure(question.id, template.language, template.starterCode, saved, recovered);
      }
    store.merge(a.drafts);
  }, [content.data, a.drafts, question.id, store]);
  useDraftAutosave(store, readOnly);
  useEffect(() => {
    if (clock.expired && a.status === 'IN_PROGRESS' && !expiryRequested.current) {
      expiryRequested.current = true;
      refresh();
    }
  }, [clock.expired, a.status, refresh]);
  useEffect(() => {
    const unload = (e: BeforeUnloadEvent) => {
      if (store.hasUnsaved()) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    const online = () => {
      refresh();
      void store.flushAll().catch(() => undefined);
    };
    const visibility = () => {
      if (document.visibilityState === 'visible') refresh();
      else void store.flushAll().catch(() => undefined);
    };
    window.addEventListener('beforeunload', unload);
    window.addEventListener('online', online);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('beforeunload', unload);
      window.removeEventListener('online', online);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [store, refresh]);
  const current = buffers[draftKey(question.id, language)];
  const execution = useExecution(a.id, question.id, language, refresh);
  const finalResult = useQuery({
    queryKey: ['assessment-result', a.id],
    queryFn: ({ signal }) => attemptApi.result(a.id, signal),
    enabled: a.status === 'FINALIZING' || a.status === 'FINALIZED',
    refetchInterval: (query) =>
      !query.state.data?.data.feedbackReleased || query.state.data.data.status === 'PENDING'
        ? 5000
        : false,
  });
  const feedback = resultTab === 'public' ? execution.publicSubmission : execution.hiddenSubmission;
  const startExecution = useCallback(
    (purpose: 'RUN_PUBLIC' | 'SUBMIT') => {
      if (readOnly || busy || !current || !a.capabilities.executionAvailable) return;
      setResultTab(purpose === 'RUN_PUBLIC' ? 'public' : 'hidden');
      setMobileTab('results');
      void execution.execute(purpose, current.source);
    },
    [readOnly, busy, current, a.capabilities.executionAvailable, execution],
  );
  const unsaved = Object.values(buffers).filter((b) => b.source !== b.savedSource);
  const save = useCallback(() => {
    void store
      .flushAll()
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Saving failed.'));
  }, [store]);
  const selectQuestion = (id: string) => {
    if (busy) return;
    void store.flush(question.id, language).catch(() => undefined);
    setSelected(id);
    setError(null);
  };
  const changeLanguage = async (next: Language) => {
    if (readOnly || busy || next === language) return;
    setBusy(true);
    setError(null);
    try {
      await store.flush(question.id, language);
      const response = await attemptApi.select(a.id, question.id, next, a.stateVersion);
      cache.setQueryData(['attempt', a.id], response);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Language selection failed.');
      refresh();
    } finally {
      setBusy(false);
    }
  };
  const finalize = async () => {
    setBusy(true);
    setError(null);
    try {
      await store.flushAll();
      finalRequest.current ??= { key: crypto.randomUUID(), version: a.stateVersion };
      const response = await attemptApi.finalize(
        a.id,
        finalRequest.current.version,
        finalRequest.current.key,
      );
      cache.setQueryData(['attempt', a.id], response);
      setDialog(null);
      sessionStorage.removeItem(storageKey);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) finalRequest.current = null;
      setError(e instanceof Error ? e.message : 'Final submission failed.');
      refresh();
    } finally {
      setBusy(false);
    }
  };
  const conflict = current?.state === 'conflict';
  const reviewConflict = async (keepLocal: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const server = await attemptApi.drafts(a.id);
      const saved = server.data.items.find(
        (d) => d.attemptQuestionId === question.id && d.language === language,
      );
      store.resolve(
        question.id,
        language,
        saved,
        keepLocal,
        content.data?.data.templates.find((t) => t.language === language)?.starterCode ?? '',
      );
      setDialog(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Cannot retrieve the latest draft.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={`assessment-workspace workspace-${theme}`}>
      <header className="exam-header">
        <div className="exam-brand">
          <PlatformLogo />
          <div className="exam-heading">
            <strong>{a.assessmentTitle}</strong>
            <span>
              {student.externalId} · {a.rules.durationSeconds / 60} minutes
            </span>
          </div>
        </div>
        <div className="exam-header-actions">
          <div className="exam-student">
            <strong>{student.displayName}</strong>
            <span>{student.externalId}</span>
          </div>
          <ExamTimer seconds={clock.seconds} synchronized={clock.synchronized} />
          <span className={`save-indicator save-${current?.state ?? 'starter'}`} role="status">
            {current?.state === 'saving' ? (
              <LoaderCircle size={15} className="spin" />
            ) : current?.state === 'saved' ? (
              <Cloud size={15} />
            ) : (
              <CloudOff size={15} />
            )}
            {saveLabels[current?.state ?? 'starter']}
          </span>
          <Button
            className="primary-button final-button"
            disabled={readOnly || busy}
            onClick={() => {
              setError(null);
              setDialog('finalize');
            }}
          >
            <Upload size={15} />
            <span>Submit Assessment</span>
          </Button>
        </div>
      </header>
      <nav className="question-navigation" aria-label="Assessment questions">
        <button
          className="workspace-back"
          aria-label="Return to dashboard"
          onClick={() => {
            if (store.hasUnsaved()) setDialog('leave');
            else router.push('/dashboard');
          }}
        >
          <ArrowLeft size={18} />
        </button>
        <span className="nav-caption">QUESTIONS</span>
        {a.questions.map((q) => {
          const local = Object.values(buffers).some(
            (b) => b.questionId === q.id && b.source !== b.savedSource,
          );
          const draft =
            q.hasDraft ||
            Object.values(buffers).some((b) => b.questionId === q.id && b.revision > 0);
          return (
            <button
              key={q.id}
              aria-current={q.id === question.id ? 'step' : undefined}
              className={`question-tab ${q.id === question.id ? 'selected' : ''}`}
              onClick={() => selectQuestion(q.id)}
              disabled={busy}
              aria-label={`Question ${q.position}${q.hasSubmission ? ', submitted' : local ? ', unsaved draft' : draft ? ', saved draft' : ''}`}
            >
              Q{q.position}
              {q.hasSubmission ? (
                <Check size={13} />
              ) : (
                (draft || local) && (
                  <span className={local ? 'draft-dot unsaved-dot' : 'draft-dot'} />
                )
              )}
            </button>
          );
        })}
        <span className="nav-progress">
          {a.questions.filter((q) => q.hasSubmission).length} / 4 submitted
        </span>
        <button
          className="history-button"
          onClick={() => setDialog('history')}
          disabled={!a.capabilities.submissionReviewAllowed}
        >
          <History size={16} />
          History
        </button>
      </nav>
      {a.status !== 'IN_PROGRESS' ? (
        <div className="attempt-status-banner" role="status">
          <Check size={18} />
          <div>
            <strong>
              {a.status === 'VOIDED'
                ? 'This attempt has been voided'
                : 'Your final answers are locked'}
            </strong>
            <span>
              {a.status === 'FINALIZING'
                ? 'Your four final answers are saved. Grading is pending.'
                : finalResult.data?.data.status === 'REQUIRES_REVIEW'
                  ? 'An infrastructure failure requires review; no final score is fabricated.'
                  : finalResult.data?.data.totalScore !== null &&
                      finalResult.data?.data.totalScore !== undefined
                    ? `Final score: ${finalResult.data.data.totalScore} / ${finalResult.data.data.maximumScore}.`
                    : 'Grading is complete. Scores follow the assessment release policy.'}
            </span>
            {finalResult.data?.data.finalizationReason === 'EXPIRED' && (
              <span>Time expired; accepted evaluations were preserved.</span>
            )}
            {finalResult.error && (
              <span role="alert">
                Could not refresh grading status.{' '}
                <button
                  onClick={() => {
                    void finalResult.refetch();
                  }}
                >
                  Retry
                </button>
              </span>
            )}
          </div>
        </div>
      ) : (
        clock.warning && (
          <div className="exam-warning" role="status">
            {clock.warning}
          </div>
        )
      )}
      {(connectionError || !clock.synchronized || storageError) && (
        <div className="workspace-notice" role="status">
          <WifiOff size={15} />
          {connectionError
            ? `Connection interrupted. ${connectionError} Local edits are retained in this tab.`
            : storageError
              ? 'Browser recovery storage is unavailable. Save to the server before leaving.'
              : 'Confirming the server clock. Editing will resume after synchronization.'}
          <button onClick={refresh}>Reconnect</button>
        </div>
      )}
      {error && (
        <div className="workspace-error" role="alert">
          {error}
          <button onClick={save} disabled={readOnly}>
            Retry saves
          </button>
        </div>
      )}
      {current?.error && (
        <div className="workspace-error" role="alert">
          {current.error}
          {conflict ? (
            <button onClick={() => setDialog('conflict')}>Review conflict</button>
          ) : (
            <button onClick={save} disabled={readOnly}>
              Retry save
            </button>
          )}
        </div>
      )}
      <div
        className="mobile-workspace-tabs"
        role="tablist"
        aria-label="Workspace panels"
        onKeyDown={(e) => {
          const tabs = ['problem', 'code', 'results'] as const;
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
          e.preventDefault();
          const index =
            e.key === 'Home'
              ? 0
              : e.key === 'End'
                ? 2
                : (tabs.indexOf(mobileTab) + (e.key === 'ArrowRight' ? 1 : 2)) % 3;
          setMobileTab(tabs[index]!);
          e.currentTarget.querySelectorAll<HTMLButtonElement>('[role=tab]')[index]?.focus();
        }}
      >
        {(['problem', 'code', 'results'] as const).map((tab) => (
          <button
            key={tab}
            role="tab"
            aria-selected={mobileTab === tab}
            tabIndex={mobileTab === tab ? 0 : -1}
            aria-controls={tab === 'problem' ? 'workspace-problem' : 'workspace-code'}
            onClick={() => setMobileTab(tab)}
          >
            {tab === 'problem' ? <FileText size={15} /> : <CodeXml size={15} />}
            {tab.slice(0, 1).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>
      <ResizablePanels
        mobileTab={mobileTab}
        left={
          <>
            {content.data ? (
              <ProblemContent question={content.data.data} position={question.position} />
            ) : (
              <div className="workspace-empty">
                {content.error ? (
                  <>
                    <p role="alert">{content.error.message}</p>
                    <Button
                      onClick={() => {
                        void content.refetch();
                      }}
                    >
                      Retry
                    </Button>
                  </>
                ) : (
                  <>
                    <div className="skeleton" />
                    <p>Loading question…</p>
                  </>
                )}
              </div>
            )}
            <div className="problem-navigation">
              <Button
                variant="outline"
                disabled={question.position === 1 || busy}
                onClick={() => selectQuestion(a.questions[question.position - 2]!.id)}
              >
                <ChevronLeft size={15} />
                Previous
              </Button>
              <span>{question.position} of 4</span>
              <Button
                variant="outline"
                disabled={question.position === 4 || busy}
                onClick={() => selectQuestion(a.questions[question.position]!.id)}
              >
                Next
                <ChevronRight size={15} />
              </Button>
            </div>
          </>
        }
        right={
          <>
            <div className="editor-toolbar">
              <div className="language-select">
                <CodeXml size={16} />
                <select
                  aria-label="Programming language"
                  value={language}
                  disabled={readOnly || busy}
                  onChange={(e) => {
                    void changeLanguage(e.target.value as Language);
                  }}
                >
                  {a.rules.allowedLanguages.map((l) => (
                    <option key={l} value={l}>
                      {languageNames[l]}
                    </option>
                  ))}
                </select>
              </div>
              <span className="editor-file">
                {language === 'PYTHON' ? 'main.py' : language === 'JAVA' ? 'Main.java' : 'main.cpp'}
              </span>
              <button
                className="icon-button"
                aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} editor theme`}
                onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
              >
                {theme === 'light' ? <Moon size={17} /> : <Sun size={17} />}
              </button>
              <button
                className="icon-button"
                aria-label="Editor settings"
                onClick={() => setSettings(true)}
              >
                <Settings2 size={17} />
              </button>
            </div>
            <div className="editor-container">
              {current && content.data ? (
                <CodeEditor
                  questionId={question.id}
                  language={language}
                  source={current.source}
                  onChange={(value) => store.edit(question.id, language, value)}
                  onSave={save}
                  onRun={() => startExecution('RUN_PUBLIC')}
                  readOnly={readOnly || busy}
                  theme={theme}
                  fontSize={fontSize}
                />
              ) : (
                <div className="editor-loading">Restoring language draft…</div>
              )}
            </div>
            <div className="execution-toolbar">
              <span>Ctrl / Cmd + S to save</span>
              <button className="save-code-button" onClick={save} disabled={readOnly || busy}>
                Save now
              </button>
              <Button
                variant="outline"
                disabled={
                  readOnly ||
                  busy ||
                  !!execution.posting ||
                  execution.publicPending ||
                  !current ||
                  !a.capabilities.executionAvailable
                }
                title={a.capabilities.message}
                onClick={() => startExecution('RUN_PUBLIC')}
              >
                <Play size={14} />
                Run Code
              </Button>
              <Button
                className="solution-submit"
                disabled={
                  readOnly ||
                  busy ||
                  !!execution.posting ||
                  execution.hiddenPending ||
                  !current ||
                  !a.capabilities.executionAvailable
                }
                title={a.capabilities.message}
                onClick={() => startExecution('SUBMIT')}
              >
                <Upload size={14} />
                Submit Solution
              </Button>
            </div>
            {execution.error && (
              <div className="workspace-error" role="alert">
                {execution.error}
              </div>
            )}
            <ExecutionPanel
              tab={resultTab}
              onTab={setResultTab}
              state={executionState(feedback, a.capabilities.executionAvailable)}
              cases={resultTab === 'public' ? feedback?.result?.publicCaseResults : []}
              hiddenVerdict={resultTab === 'hidden' ? feedback?.result?.verdict : undefined}
              hiddenScore={resultTab === 'hidden' ? feedback?.result?.score : undefined}
              hiddenCounts={
                resultTab === 'hidden' && feedback?.result
                  ? { passed: feedback.result.passedCount, total: feedback.result.totalCount }
                  : undefined
              }
              feedbackReleased={feedback?.feedbackReleased}
            />
          </>
        }
      />
      <footer className="workspace-footer">
        <span>
          <span className="status-dot" />
          {a.status === 'IN_PROGRESS'
            ? 'Assessment in progress'
            : a.status === 'VOIDED'
              ? 'Attempt voided'
              : 'Answers frozen'}
        </span>
        <span>
          {unsaved.length
            ? `${unsaved.length} unsaved language draft${unsaved.length === 1 ? '' : 's'}`
            : 'No unsaved edits'}
          <span className="footer-divider">·</span>Server-authoritative deadline
        </span>
      </footer>
      <Modal open={settings} onClose={() => setSettings(false)} title="Editor preferences">
        <label className="editor-font-label" htmlFor="editor-font-size">
          Font size <strong>{fontSize}px</strong>
        </label>
        <input
          id="editor-font-size"
          type="range"
          min={12}
          max={24}
          value={fontSize}
          onChange={(e) => setFontSize(Number(e.target.value))}
        />
        <p className="modal-note">
          Ctrl / Cmd + S saves your drafts. Ctrl / Cmd + Enter opens execution availability. Monaco
          supports keyboard navigation and screen reader mode.
        </p>
      </Modal>
      <Modal
        open={dialog === 'finalize'}
        onClose={() => {
          if (!busy) setDialog(null);
        }}
        title="Submit your assessment?"
      >
        <p>
          This locks the active language answer for each of your four questions. You won't be able
          to edit after the server confirms submission.
        </p>
        <p className="modal-note">
          Unsaved changes must reach the server first. Grading is currently pending.
        </p>
        <ul className="final-summary">
          {a.questions.map((q) => (
            <li key={q.id}>
              Q{q.position} · {q.title}
              <span>{languageNames[q.selectedLanguage]}</span>
            </li>
          ))}
        </ul>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <Button variant="outline" disabled={busy} onClick={() => setDialog(null)}>
            Continue working
          </Button>
          <Button
            className="primary-button"
            disabled={busy || readOnly}
            onClick={() => {
              void finalize();
            }}
          >
            {busy ? 'Saving & submitting…' : 'Submit final answers'}
          </Button>
        </div>
      </Modal>
      <Modal
        open={dialog === 'leave'}
        onClose={() => setDialog(null)}
        title="You have unsaved code"
      >
        <p>
          Save your edits before returning to the dashboard. The exam timer continues while you are
          away.
        </p>
        <div className="dialog-actions">
          <Button variant="outline" onClick={() => setDialog(null)}>
            Keep working
          </Button>
          {readOnly && (
            <Button variant="outline" onClick={() => router.push('/dashboard')}>
              Leave with unsaved code
            </Button>
          )}
          <Button
            className="primary-button"
            disabled={busy || readOnly}
            onClick={() => {
              setBusy(true);
              void store
                .flushAll()
                .then(() => router.push('/dashboard'))
                .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Save failed.'))
                .finally(() => setBusy(false));
            }}
          >
            Save & leave
          </Button>
        </div>
        {error && (
          <p role="alert" className="field-error">
            {error}
          </p>
        )}
      </Modal>
      <Modal
        open={dialog === 'conflict'}
        onClose={() => setDialog(null)}
        title="Review the newer server draft"
      >
        <p>
          Your local code is retained. Choose whether to reload the server version or explicitly
          save your local code over its current revision.
        </p>
        <h3>Your local code</h3>
        <pre className="conflict-preview">{current?.source}</pre>
        <h3>Latest server code</h3>
        {conflictServer.isPending ? (
          <p role="status">Loading current server revision...</p>
        ) : conflictServer.error ? (
          <p role="alert">{conflictServer.error.message}</p>
        ) : (
          <pre className="conflict-preview">
            {conflictServer.data?.data.items.find(
              (d) => d.attemptQuestionId === question.id && d.language === language,
            )?.sourceCode ??
              content.data?.data.templates.find((t) => t.language === language)?.starterCode}
          </pre>
        )}
        {error && (
          <p role="alert" className="field-error">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <Button
            variant="outline"
            disabled={busy || readOnly || conflictServer.isPending || !!conflictServer.error}
            onClick={() => {
              void reviewConflict(false);
            }}
          >
            Use server version
          </Button>
          <Button
            className="primary-button"
            disabled={busy || readOnly || conflictServer.isPending || !!conflictServer.error}
            onClick={() => {
              void reviewConflict(true);
            }}
          >
            Keep my local code
          </Button>
        </div>
      </Modal>
      <Modal open={dialog === 'history'} onClose={() => setDialog(null)} title="Submission history">
        {history.isPending ? (
          <p role="status">Loading saved snapshots…</p>
        ) : history.error ? (
          <>
            <p role="alert">{history.error.message}</p>
            <Button
              onClick={() => {
                void history.refetch();
              }}
            >
              Retry
            </Button>
          </>
        ) : !history.data?.data.items.length ? (
          <p>
            No source snapshots have been submitted. The execution service is not enabled yet;
            finalizing this assessment saves all four answers.
          </p>
        ) : (
          history.data.data.items.map((s) => (
            <details className="history-item" key={s.id}>
              <summary>
                Q{a.questions.find((q) => q.id === s.attemptQuestionId)?.position} ·{' '}
                {languageNames[s.language]} · {s.purpose} · {s.status}
              </summary>
              <time>{new Date(s.acceptedAt).toISOString()}</time>
              <pre>{s.sourceCode}</pre>
            </details>
          ))
        )}
      </Modal>
    </div>
  );
}
