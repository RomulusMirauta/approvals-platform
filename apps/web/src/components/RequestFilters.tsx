import { PRIORITIES, REQUEST_STATUSES, REQUEST_TYPES, type ListRequestsQuery } from '@approvals/contracts';
import { useState, type FormEvent } from 'react';
import { PRIORITY_LABELS, STATUS_LABELS, TYPE_LABELS } from '../format';
import { useTags } from '../queries';

export type Filters = Pick<ListRequestsQuery, 'status' | 'type' | 'priority' | 'tag' | 'q'>;

export function RequestFilters({ value, onChange }: { value: Filters; onChange: (filters: Filters) => void }) {
  const { data: tags = [] } = useTags();
  // The search box is applied on Enter rather than on every keystroke, so typing doesn't fire a request per letter.
  const [search, setSearch] = useState(value.q ?? '');

  // An empty select means "any", which is sent as no parameter at all.
  function set<K extends keyof Filters>(key: K, selected: string) {
    onChange({ ...value, [key]: selected || undefined });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    set('q', search.trim());
  }

  return (
    <form className="filters" role="search" onSubmit={submit}>
      <label>
        Status
        <select value={value.status ?? ''} onChange={(e) => set('status', e.target.value)}>
          <option value="">Any</option>
          {REQUEST_STATUSES.map((status) => (
            <option key={status} value={status}>
              {STATUS_LABELS[status]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Type
        <select value={value.type ?? ''} onChange={(e) => set('type', e.target.value)}>
          <option value="">Any</option>
          {REQUEST_TYPES.map((type) => (
            <option key={type} value={type}>
              {TYPE_LABELS[type]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Priority
        <select value={value.priority ?? ''} onChange={(e) => set('priority', e.target.value)}>
          <option value="">Any</option>
          {PRIORITIES.map((priority) => (
            <option key={priority} value={priority}>
              {PRIORITY_LABELS[priority]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Tag
        <select value={value.tag ?? ''} onChange={(e) => set('tag', e.target.value)}>
          <option value="">Any</option>
          {tags.map((tag) => (
            <option key={tag.id} value={tag.name}>
              {tag.name} ({tag.requestCount})
            </option>
          ))}
        </select>
      </label>
      <div className="search">
        <label htmlFor="search">Search</label>
        <div className="search-row">
          <input
            id="search"
            type="search"
            placeholder="Title or reference"
            maxLength={100}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button type="submit" className="button">
            Search
          </button>
        </div>
      </div>
    </form>
  );
}
