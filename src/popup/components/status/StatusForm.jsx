import { useState } from 'react';
import { getConfig } from '../../lib/config.js';
import { getToken } from '../../lib/auth.js';
import { updateApplicationStatus, saveInterviewDetails, saveOfferEntry, formatInterviewData } from '../../lib/sheets.js';
import { scheduleInterviewReminders } from '../../lib/reminders.js';
import { ROLE_INTERVIEW_TYPES, ROLE_TYPE_GROUPS, DS_CHIPS, ALGO_CHIPS, SYS_CHIPS } from '../../lib/chips.js';
import ChipGrid from './ChipGrid.jsx';
import ExpandableChipSection from './ExpandableChipSection.jsx';
import StatusBar from '../shared/StatusBar.jsx';
import Spinner from '../shared/Spinner.jsx';

const OFFER_STATUSES = ['🎁 Received Offer', '✅ Offer Accepted'];

function toggleInSet(setState) {
  return (item) => setState(prev => {
    const next = new Set(prev);
    if (next.has(item)) next.delete(item); else next.add(item);
    return next;
  });
}

export default function StatusForm({ selectedRow, onSaved, onCelebrate }) {
  const [status, setStatusValue] = useState('');
  const [interviewDate, setInterviewDate] = useState('');
  const [interviewTime, setInterviewTime] = useState('');
  const [role, setRole] = useState('Software Engineer');
  const [selectedTypes, setSelectedTypes] = useState(new Set());
  const [dsSelected, setDsSelected] = useState(new Set());
  const [algoSelected, setAlgoSelected] = useState(new Set());
  const [sysSelected, setSysSelected] = useState(new Set());
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null);

  function handleStatusChange(newStatus) {
    setStatusValue(newStatus);
    if (newStatus === '💼 Interview') {
      if (!interviewDate) setInterviewDate(new Date().toISOString().split('T')[0]);
      if (!interviewTime) setInterviewTime('09:00');
    }
  }

  function handleRoleChange(newRole) {
    setRole(newRole);
    setSelectedTypes(new Set()); // role change rebuilds the type-chip list, so prior selections no longer apply
  }

  async function handleSave() {
    if (!status) {
      setSaveStatus({ type: 'error', message: '⚠️ Pick a status' });
      return;
    }
    const cfg = await getConfig();
    if (!cfg.sheetId) {
      setSaveStatus({ type: 'error', message: '⚠️ No Sheet ID in Settings' });
      return;
    }

    setSaving(true);
    try {
      const token = await getToken();
      await updateApplicationStatus(cfg, token, selectedRow.url, status, selectedRow);

      if (status === '💼 Interview') {
        const interviewData = formatInterviewData({
          date: interviewDate,
          time: interviewTime,
          types: [...selectedTypes],
          dsSelected: [...dsSelected],
          algoSelected: [...algoSelected],
          sysSelected: [...sysSelected],
          role
        });
        if (selectedTypes.size > 0) {
          await saveInterviewDetails(cfg, token, selectedRow, interviewData);
        }
        await scheduleInterviewReminders(interviewData.datetimeStr, selectedRow.company, selectedRow.title);
      }

      if (OFFER_STATUSES.includes(status)) {
        await saveOfferEntry(cfg, token, status, selectedRow);
      }

      setSaveStatus({ type: 'success', message: `✅ Status updated to ${status}` });

      if (OFFER_STATUSES.includes(status)) {
        setTimeout(() => onCelebrate({ status, company: selectedRow?.company, title: selectedRow?.title }), 200);
        return;
      }

      onSaved();
    } catch (err) {
      setSaveStatus({ type: 'error', message: `❌ ${err.message}` });
    } finally {
      setSaving(false);
    }
  }

  const interviewTypes = ROLE_INTERVIEW_TYPES[role] || ROLE_INTERVIEW_TYPES.Other;

  return (
    <div id="interview-form">
      <div className="section">
        <div className="section-title">Update status</div>
        <select className="field-select" style={{ width: '100%', marginTop: 4 }} value={status} onChange={e => handleStatusChange(e.target.value)}>
          <option value="">— Select a status —</option>
          <option value="💼 Interview">💼 Interview</option>
          <option value="❌ Rejected">❌ Rejected</option>
          <option value="🎁 Received Offer">🎁 Received Offer</option>
          <option value="✅ Offer Accepted">✅ Offer Accepted</option>
        </select>
      </div>

      {status === '💼 Interview' && (
        <div className="section">
          <div className="section-title" style={{ marginBottom: 6 }}>Interview date &amp; time</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <input type="date" className="field-edit" style={{ flex: 1 }} value={interviewDate} onChange={e => setInterviewDate(e.target.value)} />
            <input type="time" className="field-edit" style={{ width: 110 }} value={interviewTime} onChange={e => setInterviewTime(e.target.value)} />
          </div>

          <div className="section-title" style={{ marginBottom: 6 }}>Role type</div>
          <select className="field-select" style={{ width: '100%', marginBottom: 12 }} value={role} onChange={e => handleRoleChange(e.target.value)}>
            {ROLE_TYPE_GROUPS.map(group => (
              <optgroup key={group.label} label={group.label}>
                {group.options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
              </optgroup>
            ))}
            <option>Other</option>
          </select>

          <div className="section-title" style={{ marginBottom: 8 }}>Interview type</div>
          <ChipGrid items={interviewTypes} selected={selectedTypes} onToggle={toggleInSet(setSelectedTypes)} />

          <ExpandableChipSection title="Data structures" items={DS_CHIPS} selected={dsSelected} onToggle={toggleInSet(setDsSelected)} topMargin />
          <ExpandableChipSection title="Algorithms & patterns" items={ALGO_CHIPS} selected={algoSelected} onToggle={toggleInSet(setAlgoSelected)} />
          <ExpandableChipSection title="System design topics" items={SYS_CHIPS} selected={sysSelected} onToggle={toggleInSet(setSysSelected)} />
        </div>
      )}

      {status && (
        <div className="section">
          <button className="btn btn-primary" disabled={saving} onClick={handleSave}>
            {saving ? (<><Spinner /> Saving…</>) : '💾 Save Status Update'}
          </button>
          <StatusBar status={saveStatus} />
        </div>
      )}
    </div>
  );
}
