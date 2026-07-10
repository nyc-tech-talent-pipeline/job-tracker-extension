import { useState } from 'react';
import { cleanJobUrl } from '../../lib/jobUrl.js';
import { getConfig } from '../../lib/config.js';
import { findExistingRow, appendToSheet } from '../../lib/sheets.js';
import { extractResumeText } from '../../lib/resume.js';
import { scrapeCurrentPage } from '../../lib/jobDetection.js';
import StatusBar from '../shared/StatusBar.jsx';
import Spinner from '../shared/Spinner.jsx';

export default function Step3Confirm({ detectedJob, coverLetter, onBack, setStep }) {
  const [source, setSource] = useState('');
  const [sourceOther, setSourceOther] = useState('');
  const [referral, setReferral] = useState(false);
  const [status, setStatus] = useState(null);
  const [saving, setSaving] = useState(false);
  const [relogPending, setRelogPending] = useState(null);

  function buildSourceField() {
    const finalSource = source === 'Other' ? (sourceOther.trim() || 'Other') : source;
    return referral ? (finalSource ? `${finalSource} (Referral)` : 'Referral') : finalSource;
  }

  async function completeLog(cfg, row, company, title) {
    await appendToSheet(cfg, row);
    setStatus({ type: 'success', message: `✅ Logged! ${company} · ${title}` });

    const todayKey = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    const tc = await chrome.storage.local.get('todayCount');
    const prevCount = tc.todayCount?.date === todayKey ? tc.todayCount.count : 0;
    await chrome.storage.local.set({ todayCount: { date: todayKey, count: prevCount + 1 } });

    await chrome.storage.local.remove(['lastDetectedJob', 'lastStep', 'lastJobText']);
    setReferral(false);
    setRelogPending(null);
    setStep(1);
    setTimeout(() => setStatus(null), 3000);
  }

  async function handleLog() {
    const cfg = await getConfig();
    if (!cfg.sheetId) {
      setStatus({ type: 'error', message: '⚠️ No Sheet ID — open Settings first' });
      return;
    }

    const company = detectedJob.company || '—';
    const title = detectedJob.title || '—';
    const url = cleanJobUrl(detectedJob.url);
    const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    const time = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    const sourceField = buildSourceField();

    setSaving(true);
    try {
      setStatus({ type: 'info', message: '🔍 Checking for duplicates…' });
      const existing = await findExistingRow(cfg, url);
      if (existing) {
        setStatus({ type: 'error', message: `⚠️ Already logged on ${existing.date} — ${existing.company}` });
        setSaving(false);
        setRelogPending({ cfg, date, time, company, title, url, sourceField });
        return;
      }

      setStatus({ type: 'info', message: '📄 Extracting resume text…' });
      const resumeText = await extractResumeText();
      setStatus({ type: 'info', message: '🔍 Scraping job description…' });
      const jobText = await scrapeCurrentPage();
      setStatus({ type: 'info', message: '📊 Saving to sheet…' });
      await completeLog(cfg, [date, time, company, title, url, resumeText, coverLetter, jobText, '❓ No Reply', sourceField], company, title);
    } catch (err) {
      setStatus({ type: 'error', message: `❌ ${err.message}` });
    } finally {
      setSaving(false);
    }
  }

  async function handleRelogAnyway() {
    const { cfg, date, time, company, title, url, sourceField } = relogPending;
    setSaving(true);
    try {
      setStatus({ type: 'info', message: '📊 Saving to sheet…' });
      const resumeText = await extractResumeText();
      const jobText = await scrapeCurrentPage();
      await completeLog(cfg, [date, time, company, title, url, resumeText, coverLetter, jobText, '❓ No Reply', sourceField], company, title);
    } catch (err) {
      setStatus({ type: 'error', message: `❌ ${err.message}` });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="step-panel">
      <div className="section">
        <div className="section-title">Confirm & save</div>
        <p style={{ fontSize: 12, color: '#888', marginBottom: 10 }}>Have you submitted the application?</p>

        <div className="edit-row">
          <label>Where did you find it?</label>
          <select className="field-select" value={source} onChange={e => setSource(e.target.value)}>
            <option value="">— Select source —</option>
            <option value="LinkedIn">LinkedIn</option>
            <option value="Indeed">Indeed</option>
            <option value="Handshake">Handshake</option>
            <option value="Company Website">Company Website</option>
            <option value="Glassdoor">Glassdoor</option>
            <option value="Referral">Referral</option>
            <option value="Job Fair">Job Fair</option>
            <option value="Other">Other</option>
          </select>
        </div>
        {source === 'Other' && (
          <div className="edit-row">
            <label>Specify source</label>
            <input className="field-edit" placeholder="e.g. Discord, Slack, Professor…" value={sourceOther} onChange={e => setSourceOther(e.target.value)} />
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, gap: 12 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 500 }}>Used a referral?</div>
            <div style={{ fontSize: 11, color: '#888', marginTop: 1 }}>Someone put in a word for you</div>
          </div>
          <label className="toggle-switch" style={{ flexShrink: 0 }}>
            <input type="checkbox" checked={referral} onChange={e => setReferral(e.target.checked)} />
            <span className="toggle-slider" />
          </label>
        </div>

        <div style={{ marginTop: 14 }} className="btn-row">
          <button className="btn btn-secondary" onClick={onBack}>← Back</button>
          <button className="btn btn-primary" disabled={saving} onClick={handleLog}>
            {saving ? (<><Spinner /> Saving…</>) : '✅ Save Application'}
          </button>
        </div>
        <StatusBar status={status} />
        {relogPending && (
          <div style={{ fontSize: 11, color: '#888', marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
            Applied again?
            <button
              onClick={handleRelogAnyway}
              disabled={saving}
              style={{ background: 'none', border: 'none', color: '#1a73e8', fontSize: 11, cursor: 'pointer', padding: 0, textDecoration: 'underline' }}
            >
              Log it anyway
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
