import type { Question } from '@/services/attempt-api';
export function ProblemContent({ question, position }: { question: Question; position: number }) {
  return (
    <div className="problem-content">
      <div className="problem-eyebrow">QUESTION {String(position).padStart(2, '0')} OF 04</div>
      <h1>{question.title}</h1>
      <div className="problem-badges">
        <span className={`difficulty-${question.difficulty.toLowerCase()}`}>
          {question.difficulty.slice(0, 1) + question.difficulty.slice(1).toLowerCase()}
        </span>
        {question.topics.map((t) => (
          <span key={t}>{t}</span>
        ))}
        <span>{question.maxScore} points</span>
      </div>
      <div className="statement-text">{question.statement}</div>
      {(
        [
          ['Input format', question.inputFormat],
          ['Output format', question.outputFormat],
          ['Constraints', question.constraints],
        ] as const
      ).map(([title, value]) => (
        <section key={title}>
          <h2>{title}</h2>
          <div className={title === 'Constraints' ? 'constraint-box' : 'statement-text'}>
            {value}
          </div>
        </section>
      ))}
      <section>
        <h2>Examples & public samples</h2>
        {question.publicTestCases.length ? (
          question.publicTestCases.map((c) => (
            <div className="sample-box" key={c.ordinal}>
              <header>Example {c.ordinal}</header>
              <label>INPUT</label>
              <pre>{c.input}</pre>
              <label>EXPECTED OUTPUT</label>
              <pre>{c.expectedOutput}</pre>
            </div>
          ))
        ) : (
          <p className="sample-unavailable">
            {question.samplesAvailable
              ? 'No public samples were published for this question.'
              : 'Public samples are unavailable for this older published fixture. Its encrypted tests remain protected.'}
          </p>
        )}
      </section>
      {question.explanation && (
        <section>
          <h2>Explanation</h2>
          <p className="statement-text">{question.explanation}</p>
        </section>
      )}
      <div className="problem-limits">
        Time limit: {question.cpuTimeMs} ms <span>·</span> Memory:{' '}
        {Math.round(question.memoryLimitKiB / 1024)} MB
      </div>
    </div>
  );
}
