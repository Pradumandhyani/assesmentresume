'use client';
import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { attemptApi } from '@/services/attempt-api';
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Clock3,
  CodeXml,
  FileCode2,
  LoaderCircle,
  LockKeyhole,
} from 'lucide-react';
import type { components } from '@/types/api';
import { studentApi } from '@/services/api-client';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { AssessmentCountdown, useServerClock } from './assessment-countdown';
import { canStartAssessment } from './countdown';
type Item = components['schemas']['DashboardAssessment'];
const languageNames = { PYTHON: 'Python', JAVA: 'Java', CPP: 'C++' };
export function AssessmentCard({
  item,
  serverNow,
  onRefresh,
}: {
  item: Item;
  serverNow: string;
  onRefresh: () => void;
}) {
  const { assessment: a, rules } = item;
  const clock = useServerClock(serverNow);
  const boundary = useRef(false);
  const [dialog, setDialog] = useState(false);
  const router = useRouter();
  const startKey = useRef<string | null>(null);
  const start = useMutation({
    mutationFn: () => {
      startKey.current ??= crypto.randomUUID();
      return attemptApi.start(a.id, startKey.current);
    },
    onSuccess: (response) => router.push(`/attempts/${response.data.id}`),
  });
  const check = useMutation({
    mutationFn: () => studentApi.eligibility(a.id),
    onSuccess: () => {
      setDialog(true);
      onRefresh();
    },
  });
  const canStart = canStartAssessment({
    confirmed: item.eligibility.canStart,
    synchronized: clock.synchronized,
    opensAt: a.opensAt,
    latestStartAt: a.latestStartAt,
    closesAt: a.closesAt,
    serverNowMs: clock.nowMs,
  });
  useEffect(() => {
    if (
      !boundary.current &&
      a.opensAt &&
      clock.nowMs >= Date.parse(a.opensAt) &&
      item.eligibility.reason === 'NOT_OPEN'
    ) {
      boundary.current = true;
      onRefresh();
    }
  }, [a.opensAt, clock.nowMs, item.eligibility.reason, onRefresh]);
  const date = a.opensAt ? new Date(a.opensAt) : null;
  const dateText = date
    ? new Intl.DateTimeFormat('en', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(date)
    : 'Schedule pending';
  const timeText = date
    ? new Intl.DateTimeFormat('en', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
        timeZone: 'UTC',
      }).format(date)
    : '—';
  return (
    <article
      className={`assessment-card ${item.category === 'CANCELLED' ? 'assessment-muted' : ''}`}
    >
      <div className="assessment-card-main">
        <div className="assessment-card-top">
          <span className="assessment-icon">
            <CodeXml size={26} />
          </span>
          <span className={`status-badge badge-${item.category.toLowerCase()}`}>
            <span className="status-dot" />
            {item.category === 'ACTIVE'
              ? item.eligibility.canStart
                ? 'Available now'
                : item.eligibility.canResume
                  ? 'In progress'
                  : 'Processing'
              : item.category === 'UPCOMING'
                ? 'Upcoming'
                : item.category === 'COMPLETED'
                  ? 'Completed'
                  : item.category === 'CANCELLED'
                    ? 'Cancelled'
                    : 'Closed'}
          </span>
        </div>
        <div className="assessment-category">DATA STRUCTURES & ALGORITHMS</div>
        <h3>{a.title}</h3>
        {item.description && <p className="assessment-description">{item.description}</p>}
        <div className="assessment-details">
          <span>
            <CalendarDays size={17} />
            {dateText}
          </span>
          <span>
            <Clock3 size={17} />
            {timeText} UTC
          </span>
          <span>
            <Clock3 size={17} />
            {rules.durationSeconds / 60} minutes
          </span>
          <span>
            <FileCode2 size={17} />
            {rules.easyCount + rules.mediumCount + rules.hardCount} questions
          </span>
        </div>
        <div className="assessment-bottom">
          <div className="difficulty-tags">
            <span className="difficulty-easy">{rules.easyCount} Easy</span>
            <span className="difficulty-medium">{rules.mediumCount} Medium</span>
            <span className="difficulty-hard">{rules.hardCount} Hard</span>
          </div>
          <div className="language-tags">
            {rules.allowedLanguages.map((language) => (
              <span key={language}>{languageNames[language]}</span>
            ))}
          </div>
        </div>
      </div>
      <div className="assessment-card-action">
        {item.category === 'UPCOMING' && a.opensAt ? (
          <>
            <span className="eyebrow">YOUR CHALLENGE STARTS IN</span>
            <AssessmentCountdown
              target={a.opensAt}
              serverNowMs={clock.nowMs}
              synchronized={clock.synchronized}
            />
          </>
        ) : (
          <div className="assessment-ready-icon">
            {item.category === 'COMPLETED' ? <CheckCircle2 size={32} /> : <Clock3 size={32} />}
          </div>
        )}
        <p className="assessment-state" aria-live="polite">
          {clock.synchronized ? item.eligibility.message : 'Synchronizing with the server…'}
        </p>
        <Button
          className="primary-button start-button"
          disabled={(!canStart && !a.attemptId) || check.isPending || start.isPending}
          onClick={() => (a.attemptId ? router.push(`/attempts/${a.attemptId}`) : check.mutate())}
        >
          {check.isPending ? (
            <LoaderCircle size={17} className="spin" />
          ) : canStart ? (
            <ArrowRight size={17} />
          ) : (
            <LockKeyhole size={16} />
          )}
          {item.eligibility.canResume
            ? 'Resume Assessment'
            : a.attemptId
              ? 'Review answers'
              : 'Start Assessment'}
        </Button>
        {check.error && (
          <p role="alert" className="field-error">
            {check.error.message}
          </p>
        )}
        {item.result && (
          <p className="score-summary">
            Score: {item.result.totalScore} / {item.result.maximumScore}
          </p>
        )}
        <span className="server-time-note">Schedule verified by the server</span>
      </div>
      <Modal
        open={dialog}
        onClose={() => setDialog(false)}
        title={check.data?.data.canStart ? 'You’re eligible to start' : 'Assessment availability'}
      >
        <p>{check.data?.data.message}</p>
        <p className="modal-note">
          Starting creates your fixed set of four questions and begins the three-hour timer. The
          timer continues if you leave or close this page.
        </p>
        {start.error && (
          <p role="alert" className="field-error">
            {start.error.message}
          </p>
        )}
        {check.data?.data.canStart && (
          <Button
            className="primary-button"
            disabled={start.isPending}
            onClick={() => start.mutate()}
          >
            {start.isPending ? 'Starting…' : 'Begin assessment'}
          </Button>
        )}
        <Button className="primary-button" onClick={() => setDialog(false)}>
          Back to dashboard
        </Button>
      </Modal>
    </article>
  );
}
