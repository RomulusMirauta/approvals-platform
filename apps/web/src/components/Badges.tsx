import type { Priority, RequestStatus } from '@approvals/contracts';
import { PRIORITY_LABELS, STATUS_LABELS } from '../format';

export function PriorityBadge({ priority }: { priority: Priority }) {
  return <span className={`badge priority-${priority}`}>{PRIORITY_LABELS[priority]}</span>;
}

export function StatusBadge({ status }: { status: RequestStatus }) {
  return <span className={`badge status-${status}`}>{STATUS_LABELS[status]}</span>;
}

export function Tags({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null;
  // Spans rather than a list: tags also appear inside row buttons, which only allow inline content.
  return (
    <span className="chips">
      {tags.map((tag) => (
        <span key={tag} className="chip">
          #{tag}
        </span>
      ))}
    </span>
  );
}
