import { useState } from 'react';
import { getConfig } from '../../lib/config.js';
import { getResume } from '../../lib/resume.js';
import { getActiveTab } from '../../lib/jobDetection.js';
import StatusBar from '../shared/StatusBar.jsx';

export default function Step2Application({ coverLetter, setCoverLetter, onBack, onNext }) {
  const [autofillLabel, setAutofillLabel] = useState('⚡ Autofill application form');
  const [autofillLoading, setAutofillLoading] = useState(false);
  const [autofillStatus, setAutofillStatus] = useState(null);

  async function handleAutofill() {
    const cfg = await getConfig();
    if (!cfg.name && !cfg.email) {
      setAutofillStatus({ type: 'error', message: '⚠️ Add your profile in Settings first' });
      return;
    }
    setAutofillLoading(true);
    setAutofillLabel('Filling…');
    try {
      const tab = await getActiveTab();
      const resume = await getResume(); // { dataUrl, name } or null
      const response = await chrome.tabs.sendMessage(tab.id, {
        action: 'autofill',
        profile: {
          name: cfg.name, email: cfg.email, phone: cfg.phone,
          address: cfg.address, linkedin: cfg.linkedin, website: cfg.website,
          resumeDataUrl: resume?.dataUrl || null,
          resumeName: resume?.name || null
        }
      });
      if (response?.filled > 0) {
        setAutofillStatus({ type: 'success', message: `✅ Filled ${response.filled} field${response.filled > 1 ? 's' : ''}` });
      } else {
        setAutofillStatus({ type: 'error', message: '⚠️ No matching fields found on this page' });
      }
    } catch {
      setAutofillStatus({ type: 'error', message: '❌ Could not reach page — try refreshing' });
    } finally {
      setAutofillLoading(false);
      setAutofillLabel('⚡ Fill application form');
    }
  }

  return (
    <div className="step-panel">
      <div className="section">
        <div className="section-title">Fill the application</div>
        <p style={{ fontSize: 12, color: '#888', marginBottom: 10 }}>
          Use autofill to populate the form, then upload your resume and note if you wrote a cover letter.
        </p>

        <button className="btn btn-secondary" disabled={autofillLoading} onClick={handleAutofill}>{autofillLabel}</button>
        <StatusBar status={autofillStatus} />

        <div className="edit-row" style={{ marginTop: 12 }}>
          <label>Cover letter?</label>
          <select className="field-select" value={coverLetter} onChange={e => setCoverLetter(e.target.value)}>
            <option value="">No cover letter</option>
            <option value="Yes">Yes</option>
            <option value="Custom">Custom / tailored</option>
            <option value="Generic">Generic template</option>
          </select>
        </div>

        <div style={{ marginTop: 10 }} className="btn-row">
          <button className="btn btn-secondary" onClick={onBack}>← Back</button>
          <button className="btn btn-primary" onClick={onNext}>Next →</button>
        </div>
      </div>
    </div>
  );
}
