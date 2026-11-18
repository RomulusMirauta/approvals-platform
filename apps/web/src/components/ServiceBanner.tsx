import { useIsFetching } from '@tanstack/react-query';
import { isRetryable } from '../retry';

// While any query is retrying after a network error or a 5xx, say so calmly in one place, instead of each
// panel flashing its own error. It disappears by itself when the retry succeeds; if every retry fails, the
// panel's own error message takes over.
export function ServiceBanner() {
  const retrying = useIsFetching({
    predicate: (query) => query.state.fetchFailureCount > 0 && isRetryable(query.state.fetchFailureReason),
  });
  if (retrying === 0) return null;
  return (
    <p role="status" className="banner">
      Service temporarily unavailable, retrying…
    </p>
  );
}
