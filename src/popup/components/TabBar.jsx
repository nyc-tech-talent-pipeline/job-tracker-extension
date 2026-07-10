const TABS = [
  { key: 'log', label: '📋 Log' },
  { key: 'interview', label: '🎯 Status' },
  { key: 'stats', label: '📊 Stats' },
  { key: 'settings', label: '⚙️ Settings' }
];

export default function TabBar({ active, onChange }) {
  return (
    <div className="tab-bar">
      {TABS.map(t => (
        <div key={t.key} className={`tab${active === t.key ? ' active' : ''}`} onClick={() => onChange(t.key)}>
          {t.label}
        </div>
      ))}
    </div>
  );
}
