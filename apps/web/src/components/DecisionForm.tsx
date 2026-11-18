import { DecisionBody, type DecisionValue } from '@approvals/contracts';
import { useState } from 'react';
import { useDecide } from '../queries';
import { ErrorMessage } from './ErrorMessage';

export function DecisionForm({ requestId }: { requestId: string }) {
  const decide = useDecide(requestId);
  const [comment, setComment] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  function submit(decision: DecisionValue) {
    // Validate with the same schema the API uses, so "a rejection needs a comment" is one rule, not two.
    const parsed = DecisionBody.safeParse({ decision, comment });
    if (!parsed.success) {
      setProblem(parsed.error.issues[0]?.message ?? 'Check the comment and try again');
      return;
    }
    setProblem(null);
    decide.mutate(parsed.data);
  }

  return (
    <section className="decision" aria-label="Decision">
      <label htmlFor="decision-comment">Comment (required to reject)</label>
      <textarea
        id="decision-comment"
        rows={3}
        maxLength={2000}
        value={comment}
        aria-invalid={problem !== null}
        aria-describedby={problem ? 'decision-problem' : undefined}
        onChange={(e) => setComment(e.target.value)}
      />
      {problem && (
        <p id="decision-problem" role="alert" className="error">
          {problem}
        </p>
      )}
      <ErrorMessage error={decide.error} />
      <div className="actions">
        <button type="button" className="button approve" disabled={decide.isPending} onClick={() => submit('approved')}>
          Approve
        </button>
        <button type="button" className="button reject" disabled={decide.isPending} onClick={() => submit('rejected')}>
          Reject
        </button>
      </div>
    </section>
  );
}
