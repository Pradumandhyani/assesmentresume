'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, Plus, Save, Trash2 } from 'lucide-react';
import type { Difficulty, Language } from '@/types/admin';
import type { QuestionDetail, QuestionInput, Settings } from '@/types/questions';
import type { EntityMutation } from '@/types/admin';
import { useAdminMutation, useAdminQuery } from '@/hooks/use-admin';
import { Badge, Field } from '@/components/ui/management';
const names: Record<Language, string> = { PYTHON: 'Python', JAVA: 'Java', CPP: 'C++' };
const starter: Record<Language, string> = {
  PYTHON:
    '# Read from stdin and print the answer.\nimport sys\n\ndef main():\n    pass\n\nif __name__ == "__main__":\n    main()\n',
  JAVA: 'import java.io.*;\nimport java.util.*;\n\npublic class Main {\n    public static void main(String[] args) throws Exception {\n        // Read from stdin and print the answer.\n    }\n}\n',
  CPP: '#include <iostream>\nusing namespace std;\n\nint main() {\n    ios::sync_with_stdio(false);\n    cin.tie(nullptr);\n    // Read from stdin and print the answer.\n    return 0;\n}\n',
};
type Case = QuestionInput['testCases'][number];
export function QuestionForm({ initial }: { initial?: QuestionDetail }) {
  const router = useRouter();
  const settings = useAdminQuery<Settings>('/admin/settings');
  const [language, setLanguage] = useState<Language>('PYTHON');
  const [templates, setTemplates] = useState<Record<Language, string>>(
    () =>
      Object.fromEntries(
        (['PYTHON', 'JAVA', 'CPP'] as Language[]).map((l) => [
          l,
          initial?.templates.find((t) => t.language === l)?.starterCode ?? starter[l],
        ]),
      ) as Record<Language, string>,
  );
  const [toolchains, setToolchains] = useState<Partial<Record<Language, string>>>(() =>
    Object.fromEntries(initial?.templates.map((t) => [t.language, t.toolchainId]) ?? []),
  );
  const [cases, setCases] = useState<Case[]>(initial?.testCases ?? []);
  const [preview, setPreview] = useState(false);
  const [previewData, setPreviewData] = useState<QuestionInput | null>(null);
  const [error, setError] = useState('');
  const save = useAdminMutation<EntityMutation, QuestionInput>(
    initial ? `/admin/questions/${initial.id}` : '/admin/questions',
    initial ? 'PATCH' : 'POST',
  );
  function read(form: HTMLFormElement): QuestionInput {
    const data = new FormData(form);
    const text = (key: string) => String(data.get(key) ?? '');
    const number = (key: string) => Number(text(key));
    const list = (key: string) =>
      text(key)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    const selectedTemplates = (['PYTHON', 'JAVA', 'CPP'] as Language[]).map((l) => ({
      language: l,
      starterCode: templates[l],
      toolchainId:
        toolchains[l] ??
        settings.data?.data.toolchains.filter((t) => t.language === l).at(-1)?.id ??
        '',
      executionAdapter: initial?.templates.find((t) => t.language === l)?.executionAdapter ?? {
        kind: 'STDIO' as const,
      },
    }));
    return {
      slug: text('slug'),
      title: text('title'),
      difficulty: text('difficulty') as Difficulty,
      topics: list('topics'),
      tags: list('tags'),
      statement: text('statement'),
      inputFormat: text('inputFormat'),
      outputFormat: text('outputFormat'),
      constraints: text('constraints'),
      explanation: text('explanation'),
      publicExamples: cases
        .map((c, i) => ({ ...c, ordinal: i + 1 }))
        .filter((c) => c.visibility === 'PUBLIC')
        .map(({ ordinal, input, expectedOutput }) => ({ ordinal, input, expectedOutput })),
      maxScore: text('maxScore'),
      cpuTimeMs: number('cpuTimeMs'),
      wallTimeMs: number('wallTimeMs'),
      memoryLimitKiB: number('memoryLimitKiB'),
      outputLimitBytes: number('outputLimitBytes'),
      processLimit: number('processLimit'),
      outputComparison: text('outputComparison') as 'TOKENS' | 'EXACT',
      templates: selectedTemplates,
      testCases: cases.map((c, i) => ({ ...c, ordinal: i + 1 })),
      ...(initial ? { revision: initial.revision } : {}),
    };
  }
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const input = read(e.currentTarget);
    if (!input.title.trim() || !input.statement.trim()) {
      setError('Enter a title and problem statement.');
      return;
    }
    if (!input.templates.every((t) => t.toolchainId)) {
      setError(
        'All three languages require configured, pinned toolchains. Ask the platform owner to configure the toolchain catalog.',
      );
      return;
    }
    setError('');
    save.mutate(input, {
      onSuccess: (r) => {
        router.push(`/questions/${r.data.id}/edit`);
        router.refresh();
      },
    });
  }
  function updateCase(index: number, key: keyof Case, value: string) {
    setCases((current) =>
      current.map((item, i) => (i === index ? { ...item, [key]: value } : item)),
    );
  }
  return (
    <>
      <form onSubmit={submit} className="management-form">
        <fieldset disabled={save.isPending}>
          <section className="panel form-panel">
            <div className="section-heading">
              <span className="section-number">01</span>
              <div>
                <h2>Problem definition</h2>
                <p>Plain text content is safely rendered in the student interface.</p>
              </div>
            </div>
            <div className="form-grid">
              <Field label="Title" htmlFor="title">
                <input
                  name="title"
                  id="title"
                  required
                  maxLength={200}
                  defaultValue={initial?.title}
                />
              </Field>
              <Field label="Unique slug" htmlFor="slug">
                <input
                  name="slug"
                  id="slug"
                  required
                  maxLength={200}
                  pattern="[a-z0-9]+(-[a-z0-9]+)*"
                  defaultValue={initial?.slug}
                  placeholder="two-sum"
                />
              </Field>
              <Field label="Difficulty" htmlFor="difficulty">
                <select
                  name="difficulty"
                  id="difficulty"
                  defaultValue={initial?.difficulty ?? 'EASY'}
                >
                  <option>EASY</option>
                  <option>MEDIUM</option>
                  <option>HARD</option>
                </select>
              </Field>
              <Field label="Maximum marks" htmlFor="maxScore">
                <input
                  name="maxScore"
                  id="maxScore"
                  type="number"
                  min="0.01"
                  max="10000"
                  step="0.01"
                  required
                  defaultValue={initial?.maxScore ?? '10'}
                />
              </Field>
              <Field
                label="Topics"
                htmlFor="topics"
                hint="Comma-separated topics used by assessment allocation."
              >
                <input name="topics" id="topics" defaultValue={initial?.topics.join(', ')} />
              </Field>
              <Field label="Tags" htmlFor="tags">
                <input name="tags" id="tags" defaultValue={initial?.tags.join(', ')} />
              </Field>
            </div>
            {[
              { name: 'statement', label: 'Problem statement', rows: 8 },
              { name: 'inputFormat', label: 'Input format', rows: 3 },
              { name: 'outputFormat', label: 'Output format', rows: 3 },
              { name: 'constraints', label: 'Constraints', rows: 4 },
              { name: 'explanation', label: 'Explanation', rows: 4 },
            ].map((f) => (
              <Field key={f.name} label={f.label} htmlFor={f.name}>
                <textarea
                  id={f.name}
                  name={f.name}
                  rows={f.rows}
                  required={f.name !== 'explanation'}
                  defaultValue={
                    initial?.[
                      f.name as
                        'statement' | 'inputFormat' | 'outputFormat' | 'constraints' | 'explanation'
                    ]
                  }
                  maxLength={30000}
                />
              </Field>
            ))}
          </section>
          <section className="panel form-panel">
            <div className="section-heading">
              <span className="section-number">02</span>
              <div>
                <h2>Starter code & toolchains</h2>
                <p>
                  Each language compiles against an immutable, reviewed toolchain. Browser-authored
                  questions use standard input/output.
                </p>
              </div>
            </div>
            {settings.data && !settings.data.data.questionAuthoringAvailable && (
              <p className="alert">
                Question authoring is unavailable. The private encryption keyring and pinned
                toolchain catalog must be configured on the backend.
              </p>
            )}
            <div className="tabs" role="group" aria-label="Starter code language">
              {(['PYTHON', 'JAVA', 'CPP'] as Language[]).map((l) => (
                <button
                  key={l}
                  type="button"
                  aria-pressed={language === l}
                  className={language === l ? 'selected' : ''}
                  onClick={() => setLanguage(l)}
                >
                  {names[l]}
                </button>
              ))}
            </div>
            <Field label={`${names[language]} toolchain`} htmlFor="toolchain">
              <select
                id="toolchain"
                value={
                  toolchains[language] ??
                  settings.data?.data.toolchains.filter((t) => t.language === language).at(-1)
                    ?.id ??
                  ''
                }
                onChange={(e) => setToolchains({ ...toolchains, [language]: e.target.value })}
              >
                <option value="">Select pinned toolchain</option>
                {settings.data?.data.toolchains
                  .filter((t) => t.language === language)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.version} · {t.id}
                    </option>
                  ))}
              </select>
            </Field>
            {initial?.templates.find((t) => t.language === language)?.executionAdapter?.kind ===
              'SOURCE_WRAPPER' && (
              <p className="notice">
                This question has a reviewed source wrapper. Its adapter is preserved and cannot be
                edited here.
              </p>
            )}
            <Field label={`${names[language]} starter code`} htmlFor="starter">
              <textarea
                id="starter"
                className="code-input"
                rows={14}
                value={templates[language]}
                onChange={(e) => setTemplates({ ...templates, [language]: e.target.value })}
                spellCheck={false}
                maxLength={65536}
              />
            </Field>
          </section>
          <section className="panel form-panel">
            <div className="section-heading">
              <span className="section-number">03</span>
              <div>
                <h2>Examples & test cases</h2>
                <p>
                  Public cases become student-visible examples. Hidden cases are encrypted by the
                  backend and available only to authorized staff.
                </p>
              </div>
            </div>
            <p className="notice">
              Hidden inputs and outputs remain sensitive. This page never stores them in browser
              storage or sends them to analytics.
            </p>
            {cases.length === 0 && (
              <p className="muted">
                Add public samples and hidden grading cases. Publishing requires both.
              </p>
            )}
            {cases.map((test, index) => (
              <div className="case-editor" key={index}>
                <div className="case-heading">
                  <strong>Case {index + 1}</strong>
                  <select
                    aria-label={`Case ${index + 1} visibility`}
                    value={test.visibility}
                    onChange={(e) => updateCase(index, 'visibility', e.target.value)}
                  >
                    <option value="PUBLIC">Public sample</option>
                    <option value="HIDDEN">Hidden grading case</option>
                  </select>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Remove case ${index + 1}`}
                    onClick={() => setCases(cases.filter((_, i) => i !== index))}
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
                <div className="form-grid">
                  <Field label="Input" htmlFor={`input-${index}`}>
                    <textarea
                      id={`input-${index}`}
                      rows={4}
                      className="code-input"
                      value={test.input}
                      onChange={(e) => updateCase(index, 'input', e.target.value)}
                      maxLength={65536}
                    />
                  </Field>
                  <Field label="Expected output" htmlFor={`output-${index}`}>
                    <textarea
                      id={`output-${index}`}
                      rows={4}
                      className="code-input"
                      value={test.expectedOutput}
                      onChange={(e) => updateCase(index, 'expectedOutput', e.target.value)}
                      maxLength={65536}
                    />
                  </Field>
                </div>
                <Field label="Scoring weight" htmlFor={`weight-${index}`}>
                  <input
                    id={`weight-${index}`}
                    type="number"
                    min="0.01"
                    max="10000"
                    step="0.01"
                    value={test.weight}
                    onChange={(e) => updateCase(index, 'weight', e.target.value)}
                  />
                </Field>
              </div>
            ))}
            <div className="button-row">
              <button
                type="button"
                className="button secondary"
                disabled={cases.length >= 32}
                onClick={() =>
                  setCases([
                    ...cases,
                    {
                      ordinal: cases.length + 1,
                      visibility: 'PUBLIC',
                      input: '',
                      expectedOutput: '',
                      weight: '1',
                    },
                  ])
                }
              >
                <Plus size={16} />
                Add public case
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={cases.length >= 32}
                onClick={() =>
                  setCases([
                    ...cases,
                    {
                      ordinal: cases.length + 1,
                      visibility: 'HIDDEN',
                      input: '',
                      expectedOutput: '',
                      weight: '1',
                    },
                  ])
                }
              >
                <Plus size={16} />
                Add hidden case
              </button>
            </div>
          </section>
          <section className="panel form-panel">
            <div className="section-heading">
              <span className="section-number">04</span>
              <div>
                <h2>Execution limits</h2>
                <p>The backend enforces bounded limits and the total evaluation budget.</p>
              </div>
            </div>
            <div className="form-grid three">
              {[
                {
                  name: 'cpuTimeMs',
                  label: 'CPU time (ms)',
                  min: 100,
                  max: 10000,
                  value: initial?.cpuTimeMs ?? 2000,
                },
                {
                  name: 'wallTimeMs',
                  label: 'Wall time (ms)',
                  min: 100,
                  max: 20000,
                  value: initial?.wallTimeMs ?? 5000,
                },
                {
                  name: 'memoryLimitKiB',
                  label: 'Memory (KiB)',
                  min: 16384,
                  max: 1048576,
                  value: initial?.memoryLimitKiB ?? 262144,
                },
                {
                  name: 'outputLimitBytes',
                  label: 'Output (bytes)',
                  min: 1024,
                  max: 65536,
                  value: initial?.outputLimitBytes ?? 65536,
                },
                {
                  name: 'processLimit',
                  label: 'Process limit',
                  min: 1,
                  max: 64,
                  value: initial?.processLimit ?? 32,
                },
              ].map((f) => (
                <Field key={f.name} label={f.label} htmlFor={f.name}>
                  <input
                    id={f.name}
                    name={f.name}
                    type="number"
                    required
                    min={f.min}
                    max={f.max}
                    defaultValue={f.value}
                  />
                </Field>
              ))}
              <Field label="Output comparison" htmlFor="outputComparison">
                <select
                  id="outputComparison"
                  name="outputComparison"
                  defaultValue={initial?.outputComparison ?? 'TOKENS'}
                >
                  <option value="TOKENS">Whitespace-separated tokens</option>
                  <option value="EXACT">Exact output</option>
                </select>
              </Field>
            </div>
          </section>
        </fieldset>
        {error && (
          <p role="alert" className="alert">
            {error}
          </p>
        )}
        {save.error && (
          <p role="alert" className="alert">
            {save.error.message}
          </p>
        )}
        <div className="form-actions">
          <button
            type="submit"
            className="button"
            disabled={
              save.isPending ||
              settings.isPending ||
              !settings.data?.data.questionAuthoringAvailable
            }
          >
            <Save size={17} />
            {save.isPending ? 'Saving…' : 'Save question draft'}
          </button>
          <button
            type="button"
            className="button secondary"
            onClick={(e) => {
              const form = e.currentTarget.form;
              if (form) {
                setPreviewData(read(form));
                setPreview(true);
              }
            }}
          >
            <Eye size={17} />
            Preview student problem
          </button>
        </div>
      </form>
      <QuestionPreview open={preview} question={previewData} onClose={() => setPreview(false)} />
    </>
  );
}
export function QuestionPreview({
  open,
  question,
  onClose,
}: {
  open: boolean;
  question: QuestionInput | null;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open && !ref.current?.open) ref.current?.showModal();
    else if (!open && ref.current?.open) ref.current.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="confirm-dialog preview-dialog"
      onCancel={onClose}
      aria-labelledby="preview-title"
    >
      <div className="dialog-top">
        <h2 id="preview-title">{question?.title || 'Question preview'}</h2>
        <button className="button secondary small" onClick={onClose}>
          Close preview
        </button>
      </div>
      {question && (
        <div className="problem-preview">
          <div className="button-row">
            <Badge>{question.difficulty}</Badge>
            <span className="muted">
              {question.topics.join(', ')} ? {question.maxScore} marks
            </span>
          </div>
          <h3>Problem statement</h3>
          <p className="preserve-lines">{question.statement}</p>
          <h3>Input format</h3>
          <p className="preserve-lines">{question.inputFormat}</p>
          <h3>Output format</h3>
          <p className="preserve-lines">{question.outputFormat}</p>
          <h3>Constraints</h3>
          <pre>{question.constraints}</pre>
          <h3>Public examples</h3>
          {question.publicExamples.map((e) => (
            <div className="example" key={e.ordinal}>
              <strong>Example {e.ordinal}</strong>
              <div className="form-grid">
                <div>
                  <small>INPUT</small>
                  <pre>{e.input}</pre>
                </div>
                <div>
                  <small>EXPECTED OUTPUT</small>
                  <pre>{e.expectedOutput}</pre>
                </div>
              </div>
            </div>
          ))}
          <h3>Explanation</h3>
          <p className="preserve-lines">{question.explanation}</p>
          <p className="notice">Hidden test cases are excluded from this student preview.</p>
        </div>
      )}
    </dialog>
  );
}
