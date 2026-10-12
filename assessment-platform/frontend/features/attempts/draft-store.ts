import { ApiError } from '@/services/api-client';
import type { Draft, Language } from '@/services/attempt-api';
export type SaveState = 'saved' | 'starter' | 'dirty' | 'saving' | 'offline' | 'conflict' | 'error';
export type BufferDraft = {
  questionId: string;
  language: Language;
  source: string;
  savedSource: string;
  revision: number;
  state: SaveState;
  error: string | null;
};
type Save = (q: string, language: Language, code: string, revision: number) => Promise<Draft>;
export const draftKey = (q: string, language: Language) => `${q}:${language}`;
export class DraftStore {
  private entries: Record<string, BufferDraft> = {};
  private listeners = new Set<() => void>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private flights = new Map<string, Promise<void>>();
  private disposed = false;
  private enabled = true;
  constructor(
    private readonly save: Save,
    private readonly persist?: (drafts: BufferDraft[]) => void,
    private readonly wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  ) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  snapshot = () => this.entries;
  setEnabled(value: boolean) {
    this.enabled = value;
  }
  private update(key: string, changes: Partial<BufferDraft>) {
    const old = this.entries[key];
    if (!old) return;
    this.entries = { ...this.entries, [key]: { ...old, ...changes } };
    this.persist?.(Object.values(this.entries).filter((d) => d.source !== d.savedSource));
    this.listeners.forEach((listener) => listener());
  }
  ensure(
    q: string,
    language: Language,
    starter: string,
    saved?: Draft,
    recovered?: { source: string; revision: number },
  ) {
    const key = draftKey(q, language);
    if (this.entries[key]) return;
    const source = saved?.sourceCode ?? starter;
    this.entries = {
      ...this.entries,
      [key]: {
        questionId: q,
        language,
        source: recovered?.source ?? source,
        savedSource: source,
        revision: saved?.revision ?? 0,
        state:
          recovered && recovered.source !== source
            ? recovered.revision === (saved?.revision ?? 0)
              ? 'dirty'
              : 'conflict'
            : saved
              ? 'saved'
              : 'starter',
        error:
          recovered && recovered.revision !== (saved?.revision ?? 0)
            ? 'Recovered code differs from a newer server revision.'
            : null,
      },
    };
    this.listeners.forEach((listener) => listener());
  }
  merge(drafts: Draft[]) {
    for (const d of drafts) {
      const key = draftKey(d.attemptQuestionId, d.language),
        local = this.entries[key];
      if (!local || this.flights.has(key) || d.revision <= local.revision) continue;
      if (local.source !== local.savedSource && local.source !== d.sourceCode)
        this.update(key, {
          state: 'conflict',
          error: 'A newer server draft was saved in another tab.',
        });
      else
        this.update(key, {
          source: d.sourceCode,
          savedSource: d.sourceCode,
          revision: d.revision,
          state: 'saved',
          error: null,
        });
    }
  }
  edit(q: string, language: Language, source: string) {
    if (!this.enabled) return;
    const key = draftKey(q, language),
      old = this.entries[key];
    if (!old) return;
    this.update(key, {
      source,
      state:
        old.state === 'conflict'
          ? 'conflict'
          : source === old.savedSource
            ? old.revision
              ? 'saved'
              : 'starter'
            : 'dirty',
      error: old.state === 'conflict' ? old.error : null,
    });
    this.schedule(key);
  }
  private schedule(key: string) {
    const timer = this.timers.get(key);
    if (timer) clearTimeout(timer);
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key);
        void this.flushKey(key).catch(() => undefined);
      }, 800),
    );
  }
  async flush(q: string, language: Language) {
    return this.flushKey(draftKey(q, language));
  }
  async flushAll() {
    await Promise.all(Object.keys(this.entries).map((key) => this.flushKey(key)));
  }
  private async flushKey(key: string): Promise<void> {
    const timer = this.timers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(key);
    }
    const flight = this.flights.get(key);
    if (flight) {
      await flight;
      return this.flushKey(key);
    }
    const entry = this.entries[key];
    if (!entry || entry.source === entry.savedSource || this.disposed) return;
    if (!this.enabled)
      throw new Error('Saving is disabled until the server confirms this attempt is active.');
    if (entry.state === 'conflict')
      throw new Error('Resolve the draft conflict before continuing.');
    const work = this.send(key, entry);
    this.flights.set(key, work);
    try {
      await work;
    } finally {
      this.flights.delete(key);
    }
    if (this.entries[key]?.source !== this.entries[key]?.savedSource) return this.flushKey(key);
  }
  private async send(key: string, entry: BufferDraft) {
    for (let retry = 0; ; retry++) {
      if (this.disposed || !this.enabled) throw new Error('Saving paused.');
      this.update(key, { state: 'saving', error: null });
      try {
        const saved = await this.save(
          entry.questionId,
          entry.language,
          entry.source,
          entry.revision,
        );
        this.update(key, {
          revision: saved.revision,
          savedSource: saved.sourceCode,
          state: this.entries[key]?.source === saved.sourceCode ? 'saved' : 'dirty',
          error: null,
        });
        return;
      } catch (error) {
        const conflict = error instanceof ApiError && error.code === 'REVISION_CONFLICT';
        const transient =
          error instanceof ApiError &&
          (error.status === 0 || error.status === 429 || error.status >= 500);
        this.update(key, {
          state: conflict ? 'conflict' : transient ? 'offline' : 'error',
          error: error instanceof Error ? error.message : 'Saving failed.',
        });
        if (!transient || retry >= 2) throw error;
        await this.wait(500 * 2 ** retry);
      }
    }
  }
  resolve(
    q: string,
    language: Language,
    server: Draft | undefined,
    keepLocal: boolean,
    starter: string,
  ) {
    const key = draftKey(q, language),
      old = this.entries[key];
    if (!old) return;
    const source = server?.sourceCode ?? starter;
    this.update(key, {
      source: keepLocal ? old.source : source,
      savedSource: source,
      revision: server?.revision ?? 0,
      state: keepLocal && old.source !== source ? 'dirty' : server ? 'saved' : 'starter',
      error: null,
    });
    if (keepLocal) this.schedule(key);
  }
  hasUnsaved() {
    return Object.values(this.entries).some(
      (e) => e.source !== e.savedSource || e.state === 'saving',
    );
  }
  dispose() {
    this.disposed = true;
    this.timers.forEach(clearTimeout);
    this.timers.clear();
  }
}
