'use client';
import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Inbox,
  LoaderCircle,
  RefreshCw,
  X,
} from 'lucide-react';
export function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action && <div className="heading-action">{action}</div>}
    </div>
  );
}
export function LoadingState() {
  return (
    <div aria-busy="true" aria-label="Loading" className="loading-skeleton">
      <div />
      <div />
      <div />
    </div>
  );
}
export function ErrorState({ error, retry }: { error: Error | null; retry: () => void }) {
  return (
    <div className="state-box error-state" role="alert">
      <AlertCircle size={28} />
      <h2>Unable to load this view</h2>
      <p>{error?.message ?? 'The service is unavailable.'}</p>
      <button className="button secondary" onClick={retry}>
        <RefreshCw size={16} />
        Try again
      </button>
    </div>
  );
}
export function EmptyState({
  title = 'No records yet',
  description = 'Records will appear here once they are created.',
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div className="state-box">
      <Inbox size={32} />
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  );
}
export function Badge({ children, tone }: { children: ReactNode; tone?: string }) {
  const value = String(children);
  const inferred = [
    'COMPLETE',
    'COMPLETED',
    'FINALIZED',
    'PUBLISHED',
    'OPEN',
    'ACTIVE',
    'ACCEPTED',
  ].includes(value)
    ? 'success'
    : [
          'DRAFT',
          'PENDING',
          'QUEUED',
          'FINALIZING',
          'SCHEDULED',
          'EVALUATION_PENDING',
          'NOT_STARTED',
        ].includes(value)
      ? 'warning'
      : [
            'CANCELLED',
            'ARCHIVED',
            'VOIDED',
            'DISABLED',
            'INFRASTRUCTURE_FAILED',
            'REQUIRES_REVIEW',
            'EVALUATION_FAILED',
          ].includes(value)
        ? 'danger'
        : 'neutral';
  return <span className={`badge badge-${tone ?? inferred}`}>{value.replaceAll('_', ' ')}</span>;
}
export function Pagination({
  page,
  pageSize,
  total,
  onChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onChange: (page: number) => void;
}) {
  return (
    <div className="pagination">
      <span>
        {total === 0
          ? '0 records'
          : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}`}
      </span>
      <div>
        <button
          className="button secondary small"
          aria-label="Previous page"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
        >
          <ArrowLeft size={14} />
          Previous
        </button>
        <button
          className="button secondary small"
          aria-label="Next page"
          disabled={page * pageSize >= total}
          onClick={() => onChange(page + 1)}
        >
          Next
          <ArrowRight size={14} />
        </button>
      </div>
    </div>
  );
}
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  onClose,
  onConfirm,
  pending,
  error,
  destructive = false,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  onClose: () => void;
  onConfirm: () => void;
  pending?: boolean;
  error?: Error | null;
  destructive?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open && !ref.current?.open) ref.current?.showModal();
    else if (!open && ref.current?.open) ref.current.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="confirm-dialog"
      onCancel={(e) => {
        if (pending) e.preventDefault();
        else onClose();
      }}
      aria-labelledby="dialog-title"
    >
      <div className="dialog-top">
        <h2 id="dialog-title">{title}</h2>
        <button
          className="icon-button"
          aria-label="Close dialog"
          disabled={pending}
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
      <p>{description}</p>
      {error && (
        <p role="alert" className="alert">
          {error.message}
        </p>
      )}
      <div className="dialog-actions">
        <button className="button secondary" disabled={pending} onClick={onClose}>
          Cancel
        </button>
        <button
          className={`button ${destructive ? 'danger' : ''}`}
          disabled={pending}
          onClick={onConfirm}
        >
          {pending && <LoaderCircle className="spin" size={16} />} {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
export function Field({
  label,
  htmlFor,
  children,
  hint,
  error,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
  hint?: string;
  error?: string;
}) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <small>{hint}</small>}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
export function dateTime(value: string | null | undefined) {
  return value
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(value),
      )
    : 'Not scheduled';
}
