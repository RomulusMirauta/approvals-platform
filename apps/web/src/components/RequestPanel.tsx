import type { RequestDetail, User } from '@approvals/contracts';
import { useEffect, useRef } from 'react';
import { formatDateTime, formatMoney, PRIORITY_LABELS, TYPE_LABELS } from '../format';
import { useCancel, useRequest } from '../queries';
import { StatusBadge, Tags } from './Badges';
import { CommentThread } from './CommentThread';
import { DecisionForm } from './DecisionForm';
import { ErrorMessage } from './ErrorMessage';

type Props = { id: string; user: User; onClose: () => void };

export function RequestPanel({ id, user, onClose }: Props) {
  const { data: request, error } = useRequest(id);

  return (
    <aside className="card panel" aria-label="Request details">
      <button type="button" className="button close" onClick={onClose}>
        Close
      </button>
      {error && <ErrorMessage error={error} />}
      {!request && !error && <p className="muted">Loading…</p>}
      {request && <RequestDetails request={request} user={user} />}
    </aside>
  );
}

function RequestDetails({ request, user }: { request: RequestDetail; user: User }) {
  const isOwn = request.requester.id === user.id;
  const isPending = request.status === 'pending';
  // These mirror the API's rules so the UI doesn't offer actions it would refuse. The API still enforces them.
  const canDecide = isPending && !isOwn && (user.role === 'approver' || user.role === 'admin');
  const canCancel = isPending && (isOwn || user.role === 'admin');
  const codes = exceptionCodes(request.metadata);

  // Move focus into the panel when it opens, so keyboard and screen-reader users land on the request
  // they picked. The panel is keyed by id, so this runs once per request, not on every refetch.
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);

  return (
    <>
      <header className="panel-header">
        <h2 ref={heading} tabIndex={-1}>
          {request.title}
        </h2>
        <StatusBadge status={request.status} />
      </header>

      <dl className="facts">
        <dt>Type</dt>
        <dd>{TYPE_LABELS[request.type]}</dd>
        <dt>Priority</dt>
        <dd>{PRIORITY_LABELS[request.priority]}</dd>
        {request.amount && (
          <>
            <dt>Amount</dt>
            <dd className="amount">{formatMoney(request.amount)}</dd>
          </>
        )}
        <dt>Source</dt>
        <dd>
          {request.source}
          {request.externalRef && ` / ${request.externalRef}`}
        </dd>
        <dt>Requested by</dt>
        <dd>
          {request.requester.name}, {formatDateTime(request.createdAt)}
        </dd>
      </dl>

      {request.description && <p className="description">{request.description}</p>}

      {codes.length > 0 && (
        <section>
          <h3>Exceptions</h3>
          <ul className="chips">
            {codes.map((code) => (
              <li key={code} className="chip warning">
                {code}
              </li>
            ))}
          </ul>
        </section>
      )}

      <Tags tags={request.tags} />

      {canDecide && <DecisionForm requestId={request.id} />}
      {canCancel && <CancelButton requestId={request.id} />}

      {request.decisions.length > 0 && (
        <section>
          <h3>Decision</h3>
          <ul className="timeline">
            {request.decisions.map((decision) => (
              <li key={decision.id}>
                <strong>
                  {decision.decision === 'approved' ? 'Approved' : 'Rejected'} by {decision.approver.name}
                </strong>{' '}
                <span className="muted">{formatDateTime(decision.createdAt)}</span>
                {decision.comment && <p>{decision.comment}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <CommentThread requestId={request.id} comments={request.comments} />
    </>
  );
}

function CancelButton({ requestId }: { requestId: string }) {
  const cancel = useCancel(requestId);
  return (
    <div className="actions">
      <button type="button" className="button" disabled={cancel.isPending} onClick={() => cancel.mutate()}>
        Cancel request
      </button>
      <ErrorMessage error={cancel.error} />
    </div>
  );
}

// Metadata is free-form. Agents put the codes of the checks that failed (for example PRICE_MISMATCH)
// in metadata.exceptionCodes, so read them defensively.
function exceptionCodes(metadata: Record<string, unknown>): string[] {
  const codes = metadata.exceptionCodes;
  return Array.isArray(codes) ? codes.filter((code): code is string => typeof code === 'string') : [];
}
