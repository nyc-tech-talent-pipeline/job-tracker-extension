import { useEffect, useState } from 'react';
import StatusBar from '../shared/StatusBar.jsx';

const AMOUNT_OPTIONS = [15, 30, 1, 2, 6, 12, 24, 48];
const UNIT_OPTIONS = ['minutes before', 'hours before', 'days before'];
const DEFAULT_REMINDERS = [{ amount: 1, unit: 'days before' }, { amount: 1, unit: 'hours before' }];

export default function PreferencesPanel() {
  const [ghostWeeks, setGhostWeeks] = useState(3);
  const [reminders, setReminders] = useState(DEFAULT_REMINDERS);
  const [status, setStatus] = useState(null);

  useEffect(() => {
    (async () => {
      const stored = await chrome.storage.local.get(['ghostWeeks', 'interviewReminders']);
      setGhostWeeks(stored.ghostWeeks || 3);
      if (stored.interviewReminders && stored.interviewReminders.length > 0) {
        setReminders(stored.interviewReminders);
      }
    })();
  }, []);

  function updateReminder(idx, key, value) {
    setReminders(prev => prev.map((r, i) => (i === idx ? { ...r, [key]: value } : r)));
  }
  function removeReminder(idx) {
    setReminders(prev => prev.filter((_, i) => i !== idx));
  }
  function addReminder() {
    setReminders(prev => [...prev, { amount: 1, unit: 'hours before' }]);
  }

  async function handleSave() {
    await chrome.storage.local.set({ ghostWeeks, interviewReminders: reminders });
    setStatus({ type: 'success', message: '✅ Preferences saved' });
    // Re-run ghost check immediately with new settings
    chrome.runtime.sendMessage({ action: 'runGhostCheck' });
  }

  const weeksLabel = ghostWeeks === 1 ? '1 week' : `${ghostWeeks} weeks`;

  return (
    <>
      <div className="section">
        <div className="section-title">👻 Ghosted trigger</div>
        <div style={{ fontSize: 12, color: '#666', marginBottom: 12 }}>
          Automatically mark applications as 👻 Ghosted after no reply for:
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
          <div style={{ fontSize: 13, color: '#333' }}>Weeks with no reply</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#1a73e8' }}>{weeksLabel}</div>
        </div>

        <input type="range" min="1" max="12" step="1" value={ghostWeeks} style={{ width: '100%' }} onChange={e => setGhostWeeks(parseInt(e.target.value))} />

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, marginBottom: 12 }}>
          <span style={{ fontSize: 10, color: '#888' }}>1 week</span>
          <span style={{ fontSize: 10, color: '#888' }}>12 weeks</span>
        </div>

        <div style={{ background: '#f8f9fa', borderRadius: 8, padding: '10px 12px', fontSize: 11, color: '#666', lineHeight: 1.5 }}>
          Applications still marked ❓ No Reply after <strong style={{ color: '#333' }}>{weeksLabel}</strong> will automatically update to 👻 Ghosted.
        </div>
      </div>

      <div className="section">
        <div className="section-title">🔔 Interview reminders</div>
        <div style={{ fontSize: 12, color: '#666', marginBottom: 12 }}>
          Get notified before a scheduled interview. Add as many as you want.
        </div>

        <div>
          {reminders.map((r, idx) => (
            <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: '#f8f9fa', borderRadius: 8, marginBottom: 8 }}>
              <select style={{ width: 70 }} value={r.amount} onChange={e => updateReminder(idx, 'amount', e.target.value)}>
                {AMOUNT_OPTIONS.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
              <select style={{ flex: 1 }} value={r.unit} onChange={e => updateReminder(idx, 'unit', e.target.value)}>
                {UNIT_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
              <button
                onClick={() => removeReminder(idx)}
                style={{ background: 'none', border: 'none', fontSize: 18, color: '#999', cursor: 'pointer', padding: '0 4px', lineHeight: 1 }}
              >
                ×
              </button>
            </div>
          ))}
        </div>

        <button className="btn btn-secondary" style={{ width: '100%', borderStyle: 'dashed', marginTop: 4 }} onClick={addReminder}>
          + Add reminder
        </button>
      </div>

      <div className="section">
        <button className="btn btn-primary" style={{ width: '100%' }} onClick={handleSave}>Save preferences</button>
        <div style={{ marginTop: 8 }}><StatusBar status={status} /></div>
      </div>
    </>
  );
}
