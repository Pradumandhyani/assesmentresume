'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Save, LoaderCircle, Search } from 'lucide-react';
import { z } from 'zod';
import type { EntityMutation } from '@/types/admin';
import { useAdminMutation, useAdminQuery } from '@/hooks/use-admin';
import type { Assessment, AssessmentInput, Difficulty, Language, Page, Rule } from '@/types/admin';
import type { QuestionSummary } from '@/types/questions';
import { Badge, Field, ErrorState, Pagination } from '@/components/ui/management';
import { queryString } from '@/services/api-client';
export const defaultRule: Rule = {
  durationSeconds: 10800,
  easyCount: 2,
  mediumCount: 1,
  hardCount: 1,
  allowedLanguages: ['PYTHON', 'JAVA', 'CPP'],
  allowedTopics: [],
  marks: { EASY: '10', MEDIUM: '20', HARD: '30' },
  submissionSelection: 'FINAL_SNAPSHOT',
  partialScoring: true,
  hiddenFeedbackImmediate: false,
};
export function toLocalInput(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
export function toUtc(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}
const textList = (value: string) =>
  value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
export function AssessmentForm({ initial }: { initial?: Assessment }) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(initial?.questionVersionIds ?? []);
  const [languages, setLanguages] = useState<Language[]>(
    initial?.rule.allowedLanguages ?? defaultRule.allowedLanguages,
  );
  const [errors, setErrors] = useState<string[]>([]);
  const rule = initial?.rule ?? defaultRule;
  const questions = useAdminQuery<Page<QuestionSummary>>(
    `/admin/questions${queryString({ status: 'PUBLISHED', search, page, pageSize: 20 })}`,
  );
  const save = useAdminMutation<EntityMutation, AssessmentInput>(
    initial ? `/admin/assessments/${initial.id}` : '/admin/assessments',
    initial ? 'PATCH' : 'POST',
  );
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (key: string) => String(form.get(key) ?? '');
    const count = (key: string) => Number(value(key));
    const title = z
      .string()
      .trim()
      .min(3, 'Title must be at least 3 characters.')
      .max(200)
      .safeParse(value('title'));
    if (!title.success) {
      setErrors(title.error.issues.map((i) => i.message));
      return;
    }
    if (!languages.length) {
      setErrors(['Select at least one allowed language.']);
      return;
    }
    let dates;
    try {
      dates = {
        opensAt: toUtc(value('opensAt')),
        latestStartAt: toUtc(value('latestStartAt')),
        closesAt: toUtc(value('closesAt')),
        resultsReleaseAt: toUtc(value('resultsReleaseAt')),
      };
    } catch {
      setErrors(['Enter valid schedule dates.']);
      return;
    }
    setErrors([]);
    const input: AssessmentInput = {
      title: title.data,
      description: value('description'),
      ...dates,
      questionVersionIds: selected,
      rule: {
        durationSeconds: count('durationMinutes') * 60,
        easyCount: count('easyCount'),
        mediumCount: count('mediumCount'),
        hardCount: count('hardCount'),
        allowedLanguages: languages,
        allowedTopics: textList(value('allowedTopics')),
        marks: { EASY: value('easyMarks'), MEDIUM: value('mediumMarks'), HARD: value('hardMarks') },
        submissionSelection: value('submissionSelection') as Rule['submissionSelection'],
        partialScoring: form.get('partialScoring') === 'on',
        hiddenFeedbackImmediate: form.get('hiddenFeedbackImmediate') === 'on',
      },
      ...(initial ? { revision: initial.revision } : {}),
    };
    save.mutate(input, {
      onSuccess: (response) => {
        router.push(`/assessments/${response.data.id}`);
        router.refresh();
      },
    });
  }
  return (
    <form onSubmit={submit} className="management-form">
      <fieldset disabled={save.isPending}>
        <section className="panel form-panel">
          <div className="section-heading">
            <span className="section-number">01</span>
            <div>
              <h2>Assessment details</h2>
              <p>Give students a clear description of the assessment.</p>
            </div>
          </div>
          <Field label="Assessment title" htmlFor="title">
            <input
              id="title"
              name="title"
              required
              minLength={3}
              maxLength={200}
              defaultValue={initial?.title ?? ''}
              placeholder="DSA Coding Assessment — Round 1"
            />
          </Field>
          <Field label="Description" htmlFor="description">
            <textarea
              id="description"
              name="description"
              rows={3}
              maxLength={10000}
              defaultValue={initial?.description ?? ''}
            />
          </Field>
        </section>
        <section className="panel form-panel">
          <div className="section-heading">
            <span className="section-number">02</span>
            <div>
              <h2>Schedule</h2>
              <p>Times below use your browser’s local time zone and are saved as UTC.</p>
            </div>
          </div>
          <div className="form-grid">
            <Field label="Scheduled start" htmlFor="opensAt">
              <input
                type="datetime-local"
                id="opensAt"
                name="opensAt"
                required
                defaultValue={toLocalInput(initial?.opensAt ?? null)}
              />
            </Field>
            <Field
              label="Latest permitted start"
              htmlFor="latestStartAt"
              hint="Allow enough time for the full assessment before closing."
            >
              <input
                type="datetime-local"
                id="latestStartAt"
                name="latestStartAt"
                required
                defaultValue={toLocalInput(initial?.latestStartAt ?? null)}
              />
            </Field>
            <Field label="Closing time" htmlFor="closesAt">
              <input
                type="datetime-local"
                id="closesAt"
                name="closesAt"
                required
                defaultValue={toLocalInput(initial?.closesAt ?? null)}
              />
            </Field>
            <Field
              label="Results release"
              htmlFor="resultsReleaseAt"
              hint="Student results remain withheld until this time."
            >
              <input
                type="datetime-local"
                id="resultsReleaseAt"
                name="resultsReleaseAt"
                defaultValue={toLocalInput(initial?.resultsReleaseAt ?? null)}
              />
            </Field>
          </div>
        </section>
        <section className="panel form-panel">
          <div className="section-heading">
            <span className="section-number">03</span>
            <div>
              <h2>Rules & scoring</h2>
              <p>Published rules are frozen for every student attempt.</p>
            </div>
          </div>
          <div className="form-grid">
            <Field label="Duration (minutes)" htmlFor="durationMinutes">
              <input
                id="durationMinutes"
                name="durationMinutes"
                type="number"
                required
                min={15}
                max={360}
                defaultValue={rule.durationSeconds / 60}
              />
            </Field>
            <Field
              label="Allowed topics"
              htmlFor="allowedTopics"
              hint="Comma-separated topic names. Empty allows all topics."
            >
              <input
                id="allowedTopics"
                name="allowedTopics"
                defaultValue={rule.allowedTopics.join(', ')}
              />
            </Field>
          </div>
          <div className="form-grid three">
            {(['EASY', 'MEDIUM', 'HARD'] as Difficulty[]).map((d) => (
              <div key={d} className="difficulty-config">
                <Badge tone={d === 'EASY' ? 'success' : d === 'MEDIUM' ? 'warning' : 'danger'}>
                  {d}
                </Badge>
                <Field label={`${d.toLowerCase()} questions`} htmlFor={`${d.toLowerCase()}Count`}>
                  <input
                    id={`${d.toLowerCase()}Count`}
                    name={`${d.toLowerCase()}Count`}
                    type="number"
                    min={0}
                    max={20}
                    required
                    defaultValue={
                      rule[`${d.toLowerCase()}Count` as 'easyCount' | 'mediumCount' | 'hardCount']
                    }
                  />
                </Field>
                <Field label="Marks per question" htmlFor={`${d.toLowerCase()}Marks`}>
                  <input
                    id={`${d.toLowerCase()}Marks`}
                    name={`${d.toLowerCase()}Marks`}
                    type="number"
                    min={0.01}
                    max={10000}
                    step="0.01"
                    required
                    defaultValue={rule.marks[d]}
                  />
                </Field>
              </div>
            ))}
          </div>
          <div className="field">
            <span className="field-label">Allowed languages</span>
            <div className="checkbox-row">
              {(['PYTHON', 'JAVA', 'CPP'] as Language[]).map((language) => (
                <label className="checkbox" key={language}>
                  <input
                    type="checkbox"
                    checked={languages.includes(language)}
                    onChange={(e) =>
                      setLanguages(
                        e.target.checked
                          ? [...languages, language]
                          : languages.filter((l) => l !== language),
                      )
                    }
                  />
                  {language === 'CPP' ? 'C++' : language === 'PYTHON' ? 'Python' : 'Java'}
                </label>
              ))}
            </div>
          </div>
          <Field label="Submission selection policy" htmlFor="submissionSelection">
            <select
              id="submissionSelection"
              name="submissionSelection"
              defaultValue={rule.submissionSelection}
            >
              <option value="FINAL_SNAPSHOT">Final saved code snapshot</option>
              <option value="BEST_VALID">Best valid submission</option>
              <option value="LATEST_VALID">Latest submitted solution</option>
            </select>
          </Field>
          <label className="checkbox">
            <input name="partialScoring" type="checkbox" defaultChecked={rule.partialScoring} />
            Allow weighted partial scoring
          </label>
          <label className="checkbox">
            <input
              name="hiddenFeedbackImmediate"
              type="checkbox"
              defaultChecked={rule.hiddenFeedbackImmediate}
            />
            Release aggregate hidden results immediately
          </label>
          <p className="muted">
            Hidden test inputs, expected outputs, and raw diagnostics are never returned to
            students.
          </p>
        </section>
        <section className="panel form-panel">
          <div className="section-heading">
            <span className="section-number">04</span>
            <div>
              <h2>Published question pool</h2>
              <p>
                Select enough immutable versions to satisfy every difficulty and allowed language.
              </p>
            </div>
          </div>
          <p className="selection-count">{selected.length} versions selected</p>
          <div className="search-input">
            <Search size={17} />
            <input
              aria-label="Search question pool"
              placeholder="Search published questions"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
          {questions.isError ? (
            <ErrorState error={questions.error} retry={() => void questions.refetch()} />
          ) : questions.isPending ? (
            <p className="muted">Loading question bank…</p>
          ) : (
            <>
              <div className="pool-list">
                {questions.data.data.items
                  .filter((q) => !q.archivedAt)
                  .map((q) => (
                    <label className="pool-item" key={q.versionId}>
                      <input
                        type="checkbox"
                        checked={selected.includes(q.versionId)}
                        onChange={(e) =>
                          setSelected(
                            e.target.checked
                              ? [...selected, q.versionId]
                              : selected.filter((id) => id !== q.versionId),
                          )
                        }
                      />
                      <span>
                        <strong>{q.title}</strong>
                        <small>
                          v{q.version} · {q.topics.join(', ') || 'No topics'}
                        </small>
                      </span>
                      <Badge>{q.difficulty}</Badge>
                    </label>
                  ))}
              </div>
              <Pagination
                page={page}
                pageSize={20}
                total={questions.data.data.total}
                onChange={setPage}
              />
            </>
          )}
        </section>
      </fieldset>
      {errors.length > 0 && (
        <div className="alert" role="alert">
          {errors.map((error) => (
            <p key={error}>{error}</p>
          ))}
        </div>
      )}
      {save.error && (
        <p className="alert" role="alert">
          {save.error.message}
        </p>
      )}
      <div className="form-actions">
        <button className="button" type="submit" disabled={save.isPending}>
          {save.isPending ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />}{' '}
          {initial ? 'Save draft changes' : 'Create draft assessment'}
        </button>
        <span className="muted">
          Publishing requires a complete schedule and a valid question pool.
        </span>
      </div>
    </form>
  );
}
