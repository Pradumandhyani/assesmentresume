'use client';
import { useRef, useState, type ReactNode } from 'react';
export function ResizablePanels({
  left,
  right,
  mobileTab,
}: {
  left: ReactNode;
  right: ReactNode;
  mobileTab: 'problem' | 'code' | 'results';
}) {
  const [width, setWidth] = useState(43);
  const ref = useRef<HTMLDivElement>(null);
  const clamp = (value: number) => Math.min(65, Math.max(28, value));
  return (
    <div
      ref={ref}
      className={`workspace-panels mobile-${mobileTab}`}
      style={{ gridTemplateColumns: `${width}% 8px minmax(0, 1fr)` }}
    >
      <section className="problem-panel" id="workspace-problem" aria-label="Question description">
        {left}
      </section>
      <div
        className="panel-separator"
        role="separator"
        aria-label="Resize problem and editor panels"
        aria-orientation="vertical"
        aria-valuemin={28}
        aria-valuemax={65}
        aria-valuenow={width}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault();
            setWidth((w) => clamp(w + (e.key === 'ArrowLeft' ? -2 : 2)));
          }
        }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!e.currentTarget.hasPointerCapture(e.pointerId) || !ref.current) return;
          const rect = ref.current.getBoundingClientRect();
          setWidth(clamp(((e.clientX - rect.left) / rect.width) * 100));
        }}
        onPointerUp={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId))
            e.currentTarget.releasePointerCapture(e.pointerId);
        }}
      >
        <span />
      </div>
      <section
        className="coding-panel"
        id="workspace-code"
        aria-label="Code editor and test results"
      >
        {right}
      </section>
    </div>
  );
}
