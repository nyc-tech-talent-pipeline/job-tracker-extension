import { useState } from 'react';
import ChipGrid from './ChipGrid.jsx';

// Generic collapsible chip section — the DS/Algo/System-Design blocks were
// three copy-pasted markup+wiring blocks in the original; this is the one
// reusable version.
export default function ExpandableChipSection({ title, items, selected, onToggle, topMargin = false }) {
  const [open, setOpen] = useState(false);
  const count = selected.size;

  return (
    <div style={{ borderTop: '0.5px solid #f0f0f0', marginTop: topMargin ? 12 : 0 }}>
      <div
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', cursor: 'pointer' }}
        onClick={() => setOpen(o => !o)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: '#555', letterSpacing: '0.04em', textTransform: 'uppercase' }}>{title}</span>
          {count > 0 && (
            <span style={{ fontSize: 10, background: '#e8f0fe', color: '#1a55a3', padding: '2px 8px', borderRadius: 20, fontWeight: 500 }}>
              {count} selected
            </span>
          )}
        </div>
        <span style={{ fontSize: 18, color: '#888', fontWeight: 300, lineHeight: 1 }}>{open ? '−' : '+'}</span>
      </div>
      {open && (
        <div style={{ paddingBottom: 10 }}>
          <ChipGrid items={items} selected={selected} onToggle={onToggle} />
        </div>
      )}
    </div>
  );
}
