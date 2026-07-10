import { useEffect, useRef, useState } from 'react';
import { cleanJobUrl, detectPageType, shortUrl } from '../../lib/jobUrl.js';
import { detectJobOnActiveTab, getActiveTab, scrapeAndCacheJobText } from '../../lib/jobDetection.js';
import { getConfig } from '../../lib/config.js';
import { findExistingRow } from '../../lib/sheets.js';
import StatusBar from '../shared/StatusBar.jsx';

const COVER_LETTER_RE = /cover.?letter|letter.?of.?interest|letter.?of.?motivation|writing.?sample/i;

export default function Step1JobPosting({ logTabActive, detectedJob, setDetectedJob, setStep }) {
  const [status, setStatus] = useState('detecting'); // detecting | ready | error | not-a-job
  const [pageType, setPageType] = useState(null);
  const [alreadyLoggedInfo, setAlreadyLoggedInfo] = useState(null);
  const [coverLetterRequired, setCoverLetterRequired] = useState(false);
  const [statusBar, setStatusBar] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editCompany, setEditCompany] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [manualEntryOpen, setManualEntryOpen] = useState(false);
  const [manualCompany, setManualCompany] = useState('');
  const [manualTitle, setManualTitle] = useState('');
  const [manualUrl, setManualUrl] = useState('');

  const firstActivation = useRef(true);

  async function checkIfAlreadyLogged(url) {
    try {
      const cfg = await getConfig();
      if (!cfg.sheetId) return;
      const existing = await findExistingRow(cfg, cleanJobUrl(url));
      setAlreadyLoggedInfo(existing);
    } catch {
      // fail silently
    }
  }

  function checkCoverLetterRequired(jobText) {
    setCoverLetterRequired(COVER_LETTER_RE.test(jobText));
  }

  async function runPlainDetect() {
    setStatus('detecting');
    setPageType(null);
    setAlreadyLoggedInfo(null);
    setCoverLetterRequired(false);

    try {
      const tab = await getActiveTab();
      const type = detectPageType(tab.url);
      setPageType(type);

      if (type === 'apply') {
        const saved = await chrome.storage.local.get('lastDetectedJob');
        if (saved.lastDetectedJob) {
          const job = saved.lastDetectedJob;
          setDetectedJob({ company: job.company, title: job.title, url: job.url });
          setStatus('ready');
          checkIfAlreadyLogged(job.url);
          return;
        }
        setStatus('not-a-job');
        return;
      }

      setDetectedJob(prev => ({ ...prev, url: cleanJobUrl(tab.url) }));

      const result = await detectJobOnActiveTab();

      if (result.kind !== 'detected' || result.confidence === 'none') {
        setStatus('not-a-job');
        return;
      }

      if (result.confidence === 'low') {
        setStatus('error');
        setStatusBar({ type: 'info', message: '⚠️ Might not be a job posting — check details' });
      } else {
        setStatus('ready');
      }

      const job = { company: result.company, title: result.title, url: result.url };
      setDetectedJob(job);

      if (!job.company || !job.title) {
        setIsEditing(true);
        setEditCompany(job.company);
        setEditTitle(job.title);
      }

      await chrome.storage.local.set({
        lastDetectedJob: { ...job, savedAt: Date.now() }
      });

      const text = await scrapeAndCacheJobText(tab.id);
      if (text) checkCoverLetterRequired(text);

      checkIfAlreadyLogged(tab.url);
    } catch {
      setStatus('not-a-job');
    }
  }

  async function runStartupSequence() {
    const cfg = await getConfig();
    if (!cfg.sheetId) return; // matches original: DOMContentLoaded never reaches restore/detect without a Sheet ID

    const tab = await getActiveTab();
    const type = detectPageType(tab.url);
    const saved = await chrome.storage.local.get(['lastDetectedJob', 'lastStep']);

    const hasProgressed = saved.lastStep && saved.lastStep > 1;
    const onApplyPage = type === 'apply';

    let domainMatch = onApplyPage;
    if (!onApplyPage && saved.lastDetectedJob?.url && tab.url) {
      try {
        const savedHost = new URL(saved.lastDetectedJob.url).hostname.replace('www.', '');
        const tabHost = new URL(tab.url).hostname.replace('www.', '');
        domainMatch = savedHost === tabHost || tabHost.includes(savedHost) || savedHost.includes(tabHost);
      } catch {
        domainMatch = false;
      }
    }

    const savedAt = saved.lastDetectedJob?.savedAt || 0;
    const isRecent = Date.now() - savedAt < 4 * 60 * 60 * 1000; // within 4 hours
    const shouldRestore = saved.lastDetectedJob && (
      (onApplyPage && isRecent) ||
      (hasProgressed && domainMatch)
    );

    if (shouldRestore) {
      const job = saved.lastDetectedJob;
      const lastStep = saved.lastStep || 2;

      setDetectedJob({ company: job.company, title: job.title, url: job.url });
      setStatus('ready');
      setPageType(type);
      checkIfAlreadyLogged(job.url);
      setStep(lastStep);
    } else {
      await chrome.storage.local.remove(['lastDetectedJob', 'lastStep', 'lastJobText']);
      setStep(1);
      await runPlainDetect();
    }
  }

  useEffect(() => {
    if (!logTabActive) return;
    if (firstActivation.current) {
      firstActivation.current = false;
      runStartupSequence();
    } else {
      runPlainDetect();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logTabActive]);

  async function handleRefresh() {
    await chrome.storage.local.remove(['lastDetectedJob', 'lastStep', 'lastJobText']);
    setStep(1);
    setManualEntryOpen(false);
    await runPlainDetect();
  }

  function startEditing() {
    setIsEditing(true);
    setEditCompany(detectedJob.company);
    setEditTitle(detectedJob.title);
  }

  function goToStep2() {
    // If still mid-edit when advancing, commit the in-progress values first
    // (untrimmed, matching original goStep2 — only the explicit "Done" button trims).
    const job = isEditing
      ? { ...detectedJob, company: editCompany || detectedJob.company, title: editTitle || detectedJob.title }
      : detectedJob;
    setDetectedJob(job);
    chrome.storage.local.set({ lastDetectedJob: { company: job.company, title: job.title, url: job.url } });
    setStep(2);
  }

  function commitEditing() {
    setDetectedJob(prev => ({
      ...prev,
      company: editCompany.trim() || prev.company,
      title: editTitle.trim() || prev.title
    }));
    setIsEditing(false);
  }

  async function openManualEntry() {
    const tab = await getActiveTab();
    if (tab?.url) setManualUrl(cleanJobUrl(tab.url) || tab.url);
    setManualEntryOpen(true);
  }

  async function saveManualEntry() {
    const company = manualCompany.trim();
    const title = manualTitle.trim();
    const url = manualUrl.trim();

    if (!company && !title) return;

    const job = { company: company || '—', title: title || '—', url: url || '' };
    setDetectedJob(job);
    setStatus('ready');

    await chrome.storage.local.set({ lastDetectedJob: { ...job, savedAt: Date.now() } });

    try {
      const tab = await getActiveTab();
      await chrome.storage.local.remove(['lastJobText', 'scrapedJobText']);
      try { await chrome.tabs.sendMessage(tab.id, { action: 'scrapeJob' }); } catch { /* tab closed */ }
      await new Promise(r => setTimeout(r, 1000));
      const scraped = await chrome.storage.local.get('scrapedJobText');
      if (scraped.scrapedJobText) {
        await chrome.storage.local.set({ lastJobText: scraped.scrapedJobText });
      }
    } catch { /* scrape failed silently */ }
  }

  const cardClassName = `detected-card${status === 'detecting' ? ' loading' : status === 'error' ? ' error' : ''}`;
  const detecting = status === 'detecting';

  return (
    <div className="step-panel">
      {pageType === 'apply' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderBottom: '1px solid #f9a825', background: '#fff8e1' }}>
          <span style={{ fontSize: 18 }}>⚠️</span>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#6d4c00' }}>Application form detected</div>
            <div style={{ fontSize: 11, color: '#a06000', marginTop: 2 }}>Go back to the job posting page first</div>
          </div>
        </div>
      )}

      {alreadyLoggedInfo && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderBottom: '1px solid #f9a825', background: '#fff8e1' }}>
          <span style={{ fontSize: 16 }}>⚠️</span>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#6d4c00' }}>Already in your sheet</div>
            <div style={{ fontSize: 11, color: '#a06000', marginTop: 1 }}>Logged on {alreadyLoggedInfo.date} — {alreadyLoggedInfo.company}</div>
          </div>
        </div>
      )}

      {coverLetterRequired && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderBottom: '1px solid #1a73e8', background: '#e8f0fe' }}>
          <span style={{ fontSize: 16 }}>✉️</span>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#1a55a3' }}>Cover letter mentioned</div>
            <div style={{ fontSize: 11, color: '#3367d6', marginTop: 1 }}>This job posting references a cover letter</div>
          </div>
        </div>
      )}

      {status === 'not-a-job' ? (
        <div style={{ padding: 16, background: '#f8f9fa', borderBottom: '1px solid #f0f0f0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <span style={{ fontSize: 22 }}>🔍</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#444' }}>No job posting detected</div>
              <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>Navigate to a job posting, or enter details manually</div>
            </div>
          </div>
          {manualEntryOpen ? (
            <div>
              <div className="edit-row">
                <label>Company</label>
                <input className="field-edit" placeholder="e.g. Acme Corp" value={manualCompany} onChange={e => setManualCompany(e.target.value)} />
              </div>
              <div className="edit-row" style={{ marginTop: 6 }}>
                <label>Job Title</label>
                <input className="field-edit" placeholder="e.g. Software Engineer" value={manualTitle} onChange={e => setManualTitle(e.target.value)} />
              </div>
              <div className="edit-row" style={{ marginTop: 6 }}>
                <label>URL</label>
                <input className="field-edit" placeholder="Paste job posting URL" value={manualUrl} onChange={e => setManualUrl(e.target.value)} />
              </div>
              <button className="btn btn-primary" style={{ marginTop: 10, width: '100%' }} onClick={saveManualEntry}>Use These Details →</button>
            </div>
          ) : (
            <button className="btn btn-secondary" style={{ width: '100%' }} onClick={openManualEntry}>✏️ Enter job details manually</button>
          )}
        </div>
      ) : (
        <div className="section">
          <div className="section-title">Detected job</div>
          <div className={cardClassName}>
            <div className="field-row">
              <span className="field-label">Company</span>
              <span className={detecting || !detectedJob.company ? 'field-value placeholder' : 'field-value'}>
                {detecting ? 'Detecting…' : (detectedJob.company || '—')}
              </span>
            </div>
            <div className="field-row">
              <span className="field-label">Title</span>
              <span className={detecting || !detectedJob.title ? 'field-value placeholder' : 'field-value'}>
                {detecting ? 'Detecting…' : (detectedJob.title || '—')}
              </span>
            </div>
            <div className="field-row">
              <span className="field-label">URL</span>
              <span className="field-value">{shortUrl(detectedJob.url) || '—'}</span>
            </div>
          </div>

          {isEditing && (
            <div style={{ marginTop: 10 }}>
              <div className="edit-row">
                <label>Company</label>
                <input className="field-edit" placeholder="e.g. Acme Corp" value={editCompany} onChange={e => setEditCompany(e.target.value)} />
              </div>
              <div className="edit-row">
                <label>Job Title</label>
                <input className="field-edit" placeholder="e.g. Software Engineer" value={editTitle} onChange={e => setEditTitle(e.target.value)} />
              </div>
            </div>
          )}

          <div style={{ marginTop: 10 }} className="btn-row">
            <button className="btn btn-secondary" onClick={() => (isEditing ? commitEditing() : startEditing())}>
              {isEditing ? '✓ Done' : '✏️ Edit'}
            </button>
            <button className="btn btn-secondary" onClick={handleRefresh}>🔄 Refresh</button>
            <button className="btn btn-primary" disabled={status !== 'ready' && status !== 'error'} onClick={goToStep2}>
              Next →
            </button>
          </div>
          <StatusBar status={statusBar} />
        </div>
      )}
    </div>
  );
}
