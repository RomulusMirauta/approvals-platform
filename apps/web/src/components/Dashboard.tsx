import type { ListRequestsQuery, User } from '@approvals/contracts';
import { useState } from 'react';
import { useMe } from '../queries';
import { ErrorMessage } from './ErrorMessage';
import { NewRequestForm } from './NewRequestForm';
import { NotificationBell } from './NotificationBell';
import { RequestFilters, type Filters } from './RequestFilters';
import { RequestList } from './RequestList';
import { RequestPanel } from './RequestPanel';
import { StatTiles } from './StatTiles';

type View = 'queue' | 'all';

// The exception queue is what agents escalate: invoices that failed matching and wait for a person.
const QUEUE_FILTERS: Filters = { type: 'invoice_exception', status: 'pending' };
const PAGE_SIZE = 20;

export function Dashboard({ onSignOut }: { onSignOut: () => void }) {
  const { data: user, error } = useMe();

  if (!user) {
    return <main className="content">{error ? <ErrorMessage error={error} /> : <p className="muted">Loading…</p>}</main>;
  }
  return <Workspace user={user} onSignOut={onSignOut} />;
}

function Workspace({ user, onSignOut }: { user: User; onSignOut: () => void }) {
  const canDecide = user.role === 'approver' || user.role === 'admin';
  const canCreate = user.role === 'requester' || user.role === 'admin';

  const [view, setView] = useState<View>(canDecide ? 'queue' : 'all');
  const [filters, setFilters] = useState<Filters>({});
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const query: ListRequestsQuery = { ...(view === 'queue' ? QUEUE_FILTERS : filters), page, pageSize: PAGE_SIZE };

  function changeView(next: View) {
    setView(next);
    setPage(1);
  }

  function changeFilters(next: Filters) {
    setFilters(next);
    setPage(1);
  }

  return (
    <>
      <header className="app-header">
        <h1 className="brand">Approvals</h1>
        <div className="user">
          <NotificationBell onOpen={setSelectedId} />
          <span>
            {user.name} <span className="badge">{user.role}</span>
          </span>
          <button type="button" className="button" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </header>

      <main className="content">
        <StatTiles />

        <div className="toolbar">
          <div role="group" aria-label="View" className="segmented">
            <button type="button" aria-pressed={view === 'queue'} onClick={() => changeView('queue')}>
              Exception queue
            </button>
            <button type="button" aria-pressed={view === 'all'} onClick={() => changeView('all')}>
              All requests
            </button>
          </div>
          {canCreate && !creating && (
            <button type="button" className="button primary" onClick={() => setCreating(true)}>
              New request
            </button>
          )}
        </div>

        {creating && (
          <NewRequestForm
            onCancel={() => setCreating(false)}
            onCreated={(id) => {
              setCreating(false);
              setSelectedId(id);
            }}
          />
        )}

        {view === 'all' && <RequestFilters value={filters} onChange={changeFilters} />}

        <div className={selectedId ? 'workspace has-selection' : 'workspace'}>
          <RequestList query={query} selectedId={selectedId} onSelect={setSelectedId} onPageChange={setPage} />
          {selectedId && <RequestPanel key={selectedId} id={selectedId} user={user} onClose={() => setSelectedId(null)} />}
        </div>
      </main>
    </>
  );
}
