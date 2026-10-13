'use client';
import { CheckCircle2, CircleAlert, Clock3, LockKeyhole, Terminal } from 'lucide-react';
import type { components } from '@/types/api';
export type ExecutionState =
  | 'IDLE'
  | 'UNAVAILABLE'
  | 'QUEUED'
  | 'RUNNING'
  | 'COMPLETED'
  | 'COMPILATION_ERROR'
  | 'RUNTIME_ERROR'
  | 'TIME_LIMIT_EXCEEDED'
  | 'MEMORY_LIMIT_EXCEEDED'
  | 'OUTPUT_LIMIT_EXCEEDED'
  | 'SYSTEM_ERROR';
const labels: Record<ExecutionState, string> = {
  IDLE: 'Ready to run public tests',
  UNAVAILABLE: 'Execution is not available yet',
  QUEUED: 'Waiting in the execution queue',
  RUNNING: 'Running your code',
  COMPLETED: 'Execution completed',
  COMPILATION_ERROR: 'Compilation error',
  RUNTIME_ERROR: 'Runtime error',
  TIME_LIMIT_EXCEEDED: 'Time limit exceeded',
  MEMORY_LIMIT_EXCEEDED: 'Memory limit exceeded',
  OUTPUT_LIMIT_EXCEEDED: 'Output limit exceeded',
  SYSTEM_ERROR: 'The execution service encountered an error',
};
export function ExecutionPanel({
  state = 'UNAVAILABLE',
  cases = [],
  diagnostic,
  hiddenVerdict,
  hiddenScore,
  hiddenCounts,
  feedbackReleased,
  tab,
  onTab,
}: {
  state?: ExecutionState;
  cases?: components['schemas']['PublicCaseResult'][] | undefined;
  diagnostic?: string | undefined;
  hiddenVerdict?: components['schemas']['Verdict'] | undefined;
  hiddenScore?: string | undefined;
  hiddenCounts?: { passed: number; total: number } | undefined;
  feedbackReleased?: boolean | undefined;
  tab: 'public' | 'hidden';
  onTab: (value: 'public' | 'hidden') => void;
}) {
  return (
    <div className="execution-panel">
      <div
        className="result-tabs"
        role="tablist"
        aria-label="Test results"
        onKeyDown={(e) => {
          if (['ArrowLeft', 'ArrowRight'].includes(e.key)) {
            e.preventDefault();
            onTab(tab === 'public' ? 'hidden' : 'public');
            const buttons = e.currentTarget.querySelectorAll<HTMLButtonElement>('[role=tab]');
            buttons[tab === 'public' ? 1 : 0]?.focus();
          }
        }}
      >
        {(['public', 'hidden'] as const).map((value) => (
          <button
            key={value}
            role="tab"
            aria-selected={tab === value}
            aria-controls={`results-${value}`}
            id={`result-tab-${value}`}
            tabIndex={tab === value ? 0 : -1}
            onClick={() => onTab(value)}
          >
            {value === 'public' ? <Terminal size={14} /> : <LockKeyhole size={14} />}
            {value === 'public' ? 'Public tests' : 'Hidden tests'}
          </button>
        ))}
        <span className="execution-label">
          {state === 'UNAVAILABLE' ? 'Judge offline' : state.toLowerCase().replaceAll('_', ' ')}
        </span>
      </div>
      <div
        className="result-content"
        role="tabpanel"
        id={`results-${tab}`}
        aria-labelledby={`result-tab-${tab}`}
      >
        {tab === 'hidden' ? (
          <div className="result-placeholder">
            <LockKeyhole size={23} />
            <div>
              <strong>
                {hiddenVerdict ? hiddenVerdict.replaceAll('_', ' ') : 'Hidden tests stay private'}
              </strong>
              <p role="status">
                {tab === 'hidden' &&
                  state !== 'UNAVAILABLE' &&
                  state !== 'IDLE' &&
                  `${labels[state]}. `}
                {hiddenCounts &&
                  `${hiddenCounts.passed} / ${hiddenCounts.total} hidden cases passed. `}
                {hiddenScore !== undefined && `Score: ${hiddenScore}. `}
                {feedbackReleased === false &&
                  'Evaluation feedback is withheld until the assessment release time. '}
                Inputs, expected outputs and diagnostics are never revealed. Grading feedback
                follows the assessment release policy.
              </p>
            </div>
          </div>
        ) : (
          <>
            <div
              className="result-placeholder"
              id="execution-unavailable"
              tabIndex={-1}
              role="status"
            >
              {state === 'COMPLETED' ? (
                <CheckCircle2 size={23} />
              ) : state === 'QUEUED' || state === 'RUNNING' ? (
                <Clock3 size={23} className="spin" />
              ) : (
                <CircleAlert size={23} />
              )}
              <div>
                <strong>{labels[state]}</strong>
                <p>
                  {state === 'UNAVAILABLE'
                    ? 'The execution service is not enabled yet. You can write, save and finalize your answers now.'
                    : state === 'SYSTEM_ERROR'
                      ? 'Your saved code is safe. Retry when the service is available.'
                      : state === 'IDLE'
                        ? 'Run Code uses only this problem’s public cases.'
                        : 'Results shown here come from the execution service.'}
                </p>
              </div>
            </div>
            {diagnostic && <pre className="execution-error">{diagnostic}</pre>}
            {cases.map((c) => (
              <details key={c.ordinal}>
                <summary>
                  Sample {c.ordinal} · {c.verdict.replaceAll('_', ' ')}
                </summary>
                <p>Input</p>
                <pre>{c.input}</pre>
                <p>Expected output</p>
                <pre>{c.expectedOutput}</pre>
                <p>Actual output</p>
                <pre>{c.stdout}</pre>
                {c.stderr && <pre className="execution-error">{c.stderr}</pre>}
                {c.wallTimeMs !== null && <p>Elapsed: {c.wallTimeMs} ms</p>}
                {c.cpuTimeMs !== null && <p>CPU: {c.cpuTimeMs} ms</p>}
                {c.memoryKiB !== null && <p>Memory: {c.memoryKiB} KiB</p>}
              </details>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
