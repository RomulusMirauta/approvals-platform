import type { ListRequestsQuery, RequestSummary } from '@approvals/contracts';
import { useEffect } from 'react';
import { formatAge, formatDateTime, formatMoney, TYPE_LABELS } from '../format';
import { useRequests } from '../queries';
import { PriorityBadge, StatusBadge, Tags } from './Badges';
import { ErrorMessage } from './ErrorMessage';

type Props = {
  query: ListRequestsQuery;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onPageChange: (page: number) => void;
};

export function RequestList({ query, selectedId, onSelect, onPageChange }: Props) {
  const { data, error, isPending, isFetching, isPlaceholderData } = useRequests(query);

  // An empty result still has one (empty) page.
  const lastPage = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  // Deciding the last item on the last page shrinks the list under you: step back to the new last page
  // instead of showing "Page 2 of 1".
  const pastTheEnd = data !== undefined && !isPlaceholderData && data.page > lastPage;
  useEffect(() => {
    if (pastTheEnd) onPageChange(lastPage);
  }, [pastTheEnd, lastPage, onPageChange]);

  if (isPending) return <p className="muted">Loading requests…</p>;
  if (error) return <ErrorMessage error={error} />;

  const page = Math.min(data.page, lastPage);

  return (
    <section className="request-list" aria-label="Requests" aria-busy={isFetching}>
      {data.items.length === 0 ? (
        <p className="empty">Nothing here. When an agent escalates something, it shows up in this list.</p>
      ) : (
        <ul>
          {data.items.map((request) => (
            <li key={request.id}>
              <RequestRow request={request} selected={request.id === selectedId} onSelect={onSelect} />
            </li>
          ))}
        </ul>
      )}

      <nav className="pagination" aria-label="Pages">
        <button type="button" className="button" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          Previous
        </button>
        <span>
          Page {page} of {lastPage} · {data.total} {data.total === 1 ? 'request' : 'requests'}
        </span>
        <button type="button" className="button" disabled={page >= lastPage} onClick={() => onPageChange(page + 1)}>
          Next
        </button>
      </nav>
    </section>
  );
}

type RowProps = { request: RequestSummary; selected: boolean; onSelect: (id: string) => void };

function RequestRow({ request, selected, onSelect }: RowProps) {
  return (
    <button type="button" className="row" aria-current={selected || undefined} onClick={() => onSelect(request.id)}>
      <span className="row-main">
        <span className="row-title">{request.title}</span>
        <span className="row-meta">
          {TYPE_LABELS[request.type]} · {request.source}
          {request.externalRef && ` / ${request.externalRef}`}
        </span>
        <Tags tags={request.tags} />
      </span>
      <span className="row-side">
        {request.amount && <span className="amount">{formatMoney(request.amount)}</span>}
        <span className="row-badges">
          <PriorityBadge priority={request.priority} />
          {request.status !== 'pending' && <StatusBadge status={request.status} />}
        </span>
        <time className="muted" dateTime={request.createdAt} title={formatDateTime(request.createdAt)}>
          {formatAge(request.createdAt)}
        </time>
      </span>
    </button>
  );
}
