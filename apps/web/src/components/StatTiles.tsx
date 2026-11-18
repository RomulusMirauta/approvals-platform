import { useStats } from '../queries';

export function StatTiles() {
  const { data: stats } = useStats();

  const tiles = [
    { label: 'Pending', value: stats?.byStatus.pending },
    { label: 'High priority pending', value: stats?.pendingHighPriority, accent: true },
    { label: 'Approved', value: stats?.byStatus.approved },
    { label: 'Rejected', value: stats?.byStatus.rejected },
  ];

  return (
    <section className="stats" aria-label="Summary">
      {tiles.map((tile) => (
        <div key={tile.label} className={tile.accent ? 'stat accent' : 'stat'}>
          <span className="stat-value">{tile.value ?? '–'}</span>
          <span className="stat-label">{tile.label}</span>
        </div>
      ))}
    </section>
  );
}
