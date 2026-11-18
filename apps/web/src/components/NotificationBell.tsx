import { useState } from 'react';
import { formatAge } from '../format';
import { useMarkRead, useNotifications } from '../queries';

// The unread count in the header and, when opened, the latest notifications. Choosing one marks it read and
// opens its request.
export function NotificationBell({ onOpen }: { onOpen: (requestId: string) => void }) {
  const { data } = useNotifications();
  const markRead = useMarkRead();
  const [open, setOpen] = useState(false);
  const unread = data?.unread ?? 0;

  return (
    <div className="notifications">
      <button
        type="button"
        className="button"
        aria-expanded={open}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        onClick={() => setOpen(!open)}
      >
        Notifications{unread > 0 && <span className="count">{unread}</span>}
      </button>
      {open && (
        <div className="notifications-list" role="region" aria-label="Notifications">
          {data?.items.length ? (
            <ul>
              {data.items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    className={n.read ? 'notification' : 'notification unread'}
                    onClick={() => {
                      if (!n.read) markRead.mutate(n.id);
                      onOpen(n.requestId);
                      setOpen(false);
                    }}
                  >
                    <span>{n.message}</span>
                    <span className="muted" title={new Date(n.createdAt).toLocaleString()}>
                      {formatAge(n.createdAt)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No notifications yet.</p>
          )}
        </div>
      )}
    </div>
  );
}
