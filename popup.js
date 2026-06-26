// popup.js

// PDF.js sets itself as both window.pdfjsLib and window["pdfjs-dist/build/pdf"]
// Set workerSrc immediately to prevent CDN fallback which violates extension CSP
if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('pdf.worker.min.js');
}

const $ = id => document.getElementById(id);

let detectedJob    = { company: '', title: '', url: '' };
let isEditing      = false;
let selectedRow    = null;
let selectedStage  = '';
let selectedTopics = new Set();
let CONFIG         = null;

// Load config.json (UI config) and client-id.json (Google Client ID) separately.
// config.json is committed to the repo; client-id.json is gitignored and injected by CI.
async function loadConfig() {
  try {
    const res = await fetch(chrome.runtime.getURL('config.json'));
    CONFIG = await res.json();
  } catch {
    CONFIG = {
      statuses:        ['❓ No Reply', '👻 Ghosted', '💼 Interview', '❌ Rejected', '🎁 Received Offer', '✅ Offer Accepted'],
      interviewStages: ['👻 Ghosted', '💼 Interview', '❌ Rejected', '🎁 Received Offer', '✅ Offer Accepted'],
      interviewTopics: ['Arrays','Strings','Hash Maps','Linked Lists','Trees','Graphs','Dynamic Programming','Sorting','BFS / DFS','Recursion'],
      sources:         ['LinkedIn','Indeed','Handshake','Company Website','Glassdoor','Referral','Job Fair','Other']
    };
  }
  try {
    const res = await fetch(chrome.runtime.getURL('client-id.json'));
    const { googleClientId } = await res.json();
    if (googleClientId) CONFIG.googleClientId = googleClientId;
  } catch {
    console.warn('[JobTracker] client-id.json not found — copy client-id.example.json to client-id.json and add your Google Client ID');
  }
}

function escHtml(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Startup ───────────────────────────────────────────────────────────────────

// Listen for auth flow result written by the service worker.
// Fires if the popup stays open while the OAuth window is open;
// if the popup was closed, loadSettings() handles it on next open.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.authFlowResult?.newValue) return;
  const result = changes.authFlowResult.newValue;
  if ($('btn-connect-google')) $('btn-connect-google').disabled = false;
  if ($('connect-google-label')) $('connect-google-label').textContent = 'Connect Google Account';
  if (result.success) {
    showGoogleConnected(result.email);
    showStatus('google-auth-status', 'success', '✅ Connected as ' + result.email);
  } else {
    showStatus('google-auth-status', 'error', `❌ ${result.error || 'Sign-in failed'}`);
  }
  chrome.storage.local.remove('authFlowResult');
});

document.addEventListener('DOMContentLoaded', async () => {
  try { await loadConfig(); }   catch (e) { console.error('[JobTracker] loadConfig failed:', e); }
  try { await loadSettings(); } catch (e) { console.error('[JobTracker] loadSettings failed:', e); }
  try { await loadResume(); }   catch (e) { console.error('[JobTracker] loadResume failed:', e); }

  // Build dynamic UI from config
  buildDsChips();

  const cfg = await getConfig();
  if (!cfg.sheetId) {
    showTab('settings');
    showOnboardingBanner();
    bindEvents();
    return;
  }

  bindEvents();

  const [tab]    = await chrome.tabs.query({ active: true, currentWindow: true });
  const pageType = detectPageType(tab.url);
  const saved    = await chrome.storage.local.get(['lastDetectedJob', 'lastStep']);

  const hasProgressed = saved.lastStep && saved.lastStep > 1;
  const onApplyPage   = pageType === 'apply';

  // Check domain match for non-apply pages
  let domainMatch = onApplyPage; // apply pages always match
  if (!onApplyPage && saved.lastDetectedJob?.url && tab.url) {
    try {
      const savedHost = new URL(saved.lastDetectedJob.url).hostname.replace('www.', '');
      const tabHost   = new URL(tab.url).hostname.replace('www.', '');
      domainMatch = savedHost === tabHost ||
                    tabHost.includes(savedHost) ||
                    savedHost.includes(tabHost);
    } catch { domainMatch = false; }
  }

  // Restore if: on apply page (and saved job is recent) OR (progressed AND same domain)
  const savedAt   = saved.lastDetectedJob?.savedAt || 0;
  const isRecent  = Date.now() - savedAt < 4 * 60 * 60 * 1000; // within 4 hours
  const shouldRestore = saved.lastDetectedJob && (
    (onApplyPage && isRecent) ||
    (hasProgressed && domainMatch)
  );

  if (shouldRestore) {
    const job      = saved.lastDetectedJob;
    const lastStep = saved.lastStep || 2;

    detectedJob.company = job.company;
    detectedJob.title   = job.title;
    detectedJob.url     = job.url;
    $('det-company').textContent = job.company || '—';
    $('det-title').textContent   = job.title   || '—';
    $('det-url').textContent     = shortUrl(job.url);
    $('det-company').className   = 'field-value';
    $('det-title').className     = 'field-value';
    $('det-url').className       = 'field-value';
    $('detected-card').className = 'detected-card';
    $('btn-step1-next').disabled = false;

    showPageTypeBanner(pageType);
    checkIfAlreadyLogged(job.url);
    goToStep(lastStep);
  } else {
    // No matching saved progress — detect fresh and clear stale state
    await chrome.storage.local.remove(['lastDetectedJob', 'lastStep', 'lastJobText']);
    goToStep(1);
    await detectCurrentJob();
  }
});



function showOnboardingBanner() {
  const banner = document.createElement('div');
  banner.style.cssText = 'background:#e8f0fe;border-bottom:1px solid #c5d8f8;padding:12px 16px;font-size:12px;color:#1a55a3;';
  banner.innerHTML = `
    <strong>👋 Welcome to Job Tracker!</strong><br>
    Connect your Google Sheet below to get started.
    <a href="https://sheets.google.com" target="_blank" style="color:#1a73e8;margin-left:4px;">Create a sheet →</a>
  `;
  document.querySelector('.tab-bar').insertAdjacentElement('afterend', banner);
}

function showTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === `panel-${name}`));
}

// ── Tab switching ─────────────────────────────────────────────────────────────
function bindEvents() {
  // Tabs
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', async () => {
      showTab(tab.dataset.tab);
      if (tab.dataset.tab === 'log')   await detectCurrentJob();
      if (tab.dataset.tab === 'stats') await loadStats();
    });
  });

  // Log tab — step navigation
  if ($('btn-edit')) $('btn-edit').addEventListener('click', handleEdit);
  if ($('btn-refresh-job')) $('btn-refresh-job').addEventListener('click', async () => {
    await chrome.storage.local.remove(['lastDetectedJob', 'lastStep', 'lastJobText']);
    goToStep(1);
    await detectCurrentJob();
  });

  if ($('btn-manual-entry')) $('btn-manual-entry').addEventListener('click', async () => {
    // Pre-fill URL with current tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if ($('manual-url') && tab?.url) {
      $('manual-url').value = cleanJobUrl(tab.url) || tab.url;
    }
    $('manual-entry').style.display = 'block';
    $('btn-manual-entry').style.display = 'none';
  });

  if ($('btn-manual-save')) $('btn-manual-save').addEventListener('click', async () => {
    const company = $('manual-company')?.value.trim();
    const title   = $('manual-title')?.value.trim();
    const url     = $('manual-url')?.value.trim();

    if (!company && !title) {
      $('manual-company').focus();
      return;
    }

    detectedJob.company = company || '—';
    detectedJob.title   = title   || '—';
    detectedJob.url     = url     || '';

    await chrome.storage.local.set({ lastDetectedJob: {
      company: detectedJob.company,
      title:   detectedJob.title,
      url:     detectedJob.url,
      savedAt: Date.now()
    }});

    // Scrape text from the current page
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await chrome.storage.local.remove(['lastJobText', 'scrapedJobText']);
      try { await chrome.tabs.sendMessage(tab.id, { action: 'scrapeJob' }); } catch { /* tab closed */ }
      await new Promise(r => setTimeout(r, 1000));
      const scraped = await chrome.storage.local.get('scrapedJobText');
      if (scraped.scrapedJobText) {
        await chrome.storage.local.set({ lastJobText: scraped.scrapedJobText });
      }
    } catch { /* scrape failed silently */ }

    // Show detected card with manual values
    $('not-a-job-banner').style.display = 'none';
    $('job-section').style.display = 'block';
    $('det-company').textContent = detectedJob.company;
    $('det-title').textContent   = detectedJob.title;
    $('det-url').textContent     = shortUrl(detectedJob.url);
    $('det-company').className   = 'field-value';
    $('det-title').className     = 'field-value';
    $('det-url').className       = 'field-value';
    $('detected-card').className = 'detected-card';
    $('btn-step1-next').disabled = false;
  });
  if ($('btn-step1-next')) $('btn-step1-next').addEventListener('click', goStep2);
  if ($('btn-step2-back')) $('btn-step2-back').addEventListener('click', () => goToStep(1));
  if ($('btn-step2-next')) $('btn-step2-next').addEventListener('click', goStep3);
  if ($('btn-step3-back')) $('btn-step3-back').addEventListener('click', () => goToStep(2));
  if ($('btn-log')) $('btn-log').addEventListener('click', handleLog);
  if ($('source-select')) {
    $('source-select').addEventListener('change', () => {
      $('source-other-row').style.display =
        $('source-select')?.value === 'Other' ? 'block' : 'none';
    });
  }
  if ($('btn-autofill')) $('btn-autofill').addEventListener('click', handleAutofill);

  // Interview tab
  if ($('interview-search')) $('interview-search').addEventListener('input', handleInterviewSearch);
  if ($('btn-save-interview')) $('btn-save-interview').addEventListener('click', handleSaveInterview);


  // Stats tab
  if ($('btn-save-goal')) $('btn-save-goal').addEventListener('click', saveGoal);
  if ($('btn-save-settings')) $('btn-save-settings').addEventListener('click', saveSettings);
  if ($('btn-verify-sheet')) $('btn-verify-sheet').addEventListener('click', verifySheet);
  if ($('btn-save-profile')) $('btn-save-profile').addEventListener('click', saveProfile);
  if ($('btn-add-reminder')) $('btn-add-reminder').addEventListener('click', () => addReminderRow());
  if ($('btn-save-preferences')) $('btn-save-preferences').addEventListener('click', savePreferences);

  // Settings sub-tabs
  document.querySelectorAll('.settings-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.settings-tab-btn').forEach(b => {
        b.style.background = 'none';
        b.style.color = '#666';
        b.style.borderColor = '#ddd';
        b.classList.remove('active');
      });
      document.querySelectorAll('.stab-panel').forEach(p => p.style.display = 'none');
      btn.classList.add('active');
      btn.style.background = '#1a73e8';
      btn.style.color = '#fff';
      btn.style.borderColor = '#1a73e8';
      const stab = $(`stab-${btn.dataset.stab}`);
      if (stab) stab.style.display = 'block';
    });
  });

  // Ghost weeks slider
  if ($('cfg-ghost-weeks')) {
    $('cfg-ghost-weeks').addEventListener('input', () => {
      const w = $('cfg-ghost-weeks').value;
      const label = w === '1' ? '1 week' : `${w} weeks`;
      if ($('ghost-weeks-label'))  $('ghost-weeks-label').textContent  = label;
      if ($('ghost-weeks-inline')) $('ghost-weeks-inline').textContent = label;
    });
  }

  // Status dropdown
  if ($('status-select')) {
    $('status-select').addEventListener('change', () => {
      const status = $('status-select').value;
      if ($('interview-type-section')) {
        const show = status === '💼 Interview';
        $('interview-type-section').style.display = show ? 'block' : 'none';
        if (show) {
          if ($('interview-date') && !$('interview-date').value) {
            $('interview-date').value = new Date().toISOString().split('T')[0];
          }
          if ($('interview-time') && !$('interview-time').value) {
            $('interview-time').value = '09:00';
          }
          initInterviewChips();
        }
      }
      if ($('interview-details')) {
        $('interview-details').style.display = status ? 'block' : 'none';
      }
    });
  }
  if ($('cfg-resume-input')) $('cfg-resume-input').addEventListener('change', handleResumeUpload);
  if ($('resume-area')) $('resume-area').addEventListener('click', () => $('cfg-resume-input').click());
  if ($('btn-clear-resume')) $('btn-clear-resume').addEventListener('click', clearResume);
  if ($('btn-connect-google')) $('btn-connect-google').addEventListener('click', handleConnectGoogle);
  if ($('btn-disconnect-google')) $('btn-disconnect-google').addEventListener('click', handleDisconnectGoogle);
}

// ── Detect job ────────────────────────────────────────────────────────────────
async function detectCurrentJob() {
  const card = $('detected-card');
  card.className = 'detected-card loading';
  $('page-type-banner').style.display = 'none';
  $('logged-status-banner').style.display = 'none';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // Check page type first
    const pageType = detectPageType(tab.url);
    showPageTypeBanner(pageType);

    if (pageType === 'apply') {
      // On apply page — try to restore the saved posting from storage
      const saved = await chrome.storage.local.get('lastDetectedJob');
      if (saved.lastDetectedJob) {
        const job = saved.lastDetectedJob;
        detectedJob.company = job.company;
        detectedJob.title   = job.title;
        detectedJob.url     = job.url; // use the original posting URL
        $('det-company').textContent = job.company || '—';
        $('det-title').textContent   = job.title   || '—';
        $('det-url').textContent     = shortUrl(job.url);
        $('det-company').className   = job.company ? 'field-value' : 'field-value placeholder';
        $('det-title').className     = job.title   ? 'field-value' : 'field-value placeholder';
        $('det-url').className       = 'field-value';
        card.className = 'detected-card';
        $('btn-step1-next').disabled = false;
        checkIfAlreadyLogged(job.url);
        return;
      }
      // No saved posting — show the detected card as unknown
      showNotAJobPage();
      return;
    }

    // On a job posting page — detect normally
    // Show a status while waiting (Workday/SmartRecruiters can take 2-3s to render)
    detectedJob.url = cleanJobUrl(tab.url);
    $('det-url').textContent     = shortUrl(detectedJob.url);
    $('det-url').className       = 'field-value';
    $('det-company').textContent = 'Detecting…';
    $('det-title').textContent   = 'Detecting…';
    $('det-company').className   = 'field-value placeholder';
    $('det-title').className     = 'field-value placeholder';

    let response;
    try { response = await chrome.tabs.sendMessage(tab.id, { action: 'detectJob' }); } catch { showNotAJobPage(); return; }

    if (!response || response.confidence === 'none') {
      showNotAJobPage(); return;
    }
    if (response.confidence === 'low') {
      card.className = 'detected-card error';
      showStatus('status-bar', 'info', '⚠️ Might not be a job posting — check details');
    } else {
      card.className = 'detected-card';
    }

    detectedJob.company = response.company || '';
    detectedJob.title   = response.title   || '';
    // Use canonical URL if the page provides one (e.g. cityjobs.nyc.gov via SmartRecruiters)
    detectedJob.url     = response.canonicalUrl || cleanJobUrl(tab.url);
    $('det-company').textContent = response.company || '—';
    $('det-title').textContent   = response.title   || '—';
    $('det-url').textContent     = shortUrl(detectedJob.url);
    $('det-company').className = response.company ? 'field-value' : 'field-value placeholder';
    $('det-title').className   = response.title   ? 'field-value' : 'field-value placeholder';
    $('btn-step1-next').disabled = false;

    if (!response.company || !response.title) showEditFields();

    // Persist detected job immediately
    await chrome.storage.local.set({ lastDetectedJob: {
      company: detectedJob.company,
      title:   detectedJob.title,
      url:     detectedJob.url,
      savedAt: Date.now()
    }});

    // Scrape and cache job text now — await it so it's ready before student navigates away
    await chrome.storage.local.remove('lastJobText');
    try {
      try { await chrome.tabs.sendMessage(tab.id, { action: 'scrapeJob' }); } catch { /* tab closed */ }
      await new Promise(r => setTimeout(r, 1200));
      const s = await chrome.storage.local.get('scrapedJobText');
      if (s.scrapedJobText) {
        await chrome.storage.local.set({ lastJobText: s.scrapedJobText });
        checkCoverLetterRequired(s.scrapedJobText);
      }
    } catch { /* scrape failed silently */ }

    // Check if already logged — run in background
    checkIfAlreadyLogged(tab.url);

  } catch {
    showNotAJobPage();
  }
}

async function checkCoverLetterRequired(jobText) {
  const banner = $('cover-letter-banner');
  if (!banner) return;
  const required = /cover.?letter|letter.?of.?interest|letter.?of.?motivation|writing.?sample/i.test(jobText);
  if (required) {
    banner.style.cssText = 'display:flex; align-items:center; gap:10px; padding:10px 16px; border-bottom:1px solid #1a73e8; background:#e8f0fe;';
    banner.innerHTML = `
      <span style="font-size:16px;">✉️</span>
      <div>
        <div style="font-size:12px; font-weight:600; color:#1a55a3;">Cover letter mentioned</div>
        <div style="font-size:11px; color:#3367d6; margin-top:1px;">This job posting references a cover letter</div>
      </div>`;
  } else {
    banner.style.display = 'none';
  }
}

async function checkIfAlreadyLogged(url) {
  try {
    const cfg = await getConfig();
    if (!cfg.sheetId) return;
    const existing = await findExistingRow(cfg, cleanJobUrl(url));
    const banner = $('logged-status-banner');
    if (existing) {
      banner.style.cssText = 'display:flex; align-items:center; gap:10px; padding:10px 16px; border-bottom:1px solid #f9a825; background:#fff8e1;';
      banner.innerHTML = `
        <span style="font-size:16px;">⚠️</span>
        <div>
          <div style="font-size:12px; font-weight:600; color:#6d4c00;">Already in your sheet</div>
          <div style="font-size:11px; color:#a06000; margin-top:1px;">Logged on ${existing.date} — ${existing.company}</div>
        </div>`;
    } else {
      banner.style.display = 'none';
    }
  } catch {
    // fail silently
  }
}

function detectPageType(url) {
  try {
    const u    = new URL(url);
    const path = u.pathname.toLowerCase();
    const host = u.hostname.toLowerCase();

    // Known ATS apply subdomains/domains
    if (host.includes('jobs.smartrecruiters.com') ||
        (host.includes('myworkdayjobs.com') && path.includes('/apply')) ||
        host.includes('apply.workable.com') ||
        (host.includes('greenhouse.io') && (path.includes('/application') || path.includes('/apply'))) ||
        (host.includes('dayforcehcm.com') && path.includes('/apply')) ||
        (host.includes('ashbyhq.com') && path.includes('/application')) ||
        (host.includes('recruitee.com') && path.includes('/apply')) ||
        (host.includes('jobs.lever.co') && path.includes('/apply'))) {
      return 'apply';
    }

    // Greenhouse job postings: job-boards.greenhouse.io/<co>/jobs/<id> → posting
    if (host.includes('greenhouse.io') && /\/jobs\/\d+/.test(path)) {
      return 'posting';
    }

    // Path-based detection
    if (/\/(apply|applymanually|create-account|sign-in|login|register)(\/|$)/.test(path)) {
      return 'apply';
    }

    // Indeed apply page
    if (host.includes('indeed.com') && u.searchParams.has('jk') && path.includes('viewjob')) {
      return 'apply';
    }

    return 'posting';
  } catch {
    return 'posting';
  }
}

function showPageTypeBanner(type) {
  const banner = $('page-type-banner');
  if (type === 'apply') {
    banner.style.cssText = 'display:flex; align-items:center; gap:10px; padding:10px 16px; border-bottom:1px solid #f9a825; background:#fff8e1;';
    banner.innerHTML = `
      <span style="font-size:18px;">⚠️</span>
      <div>
        <div style="font-size:12px; font-weight:600; color:#6d4c00;">Application form detected</div>
        <div style="font-size:11px; color:#a06000; margin-top:1px;">Go back to the job posting page first</div>
      </div>`;
  } else {
    banner.style.display = 'none';
  }
}


function showNotAJobPage() {
  $('job-section').style.display = 'none';
  $('not-a-job-banner').style.display = 'block';
}

function showEditFields() {
  isEditing = true;
  $('edit-fields').style.display = 'block';
  if ($('edit-company')) $('edit-company').value = detectedJob.company;
  if ($('edit-title')) $('edit-title').value   = detectedJob.title;
  $('btn-edit').textContent = '✓ Done';
}

function handleEdit() {
  if (!isEditing) {
    showEditFields();
  } else {
    detectedJob.company = $('edit-company')?.value.trim() || detectedJob.company;
    detectedJob.title   = $('edit-title')?.value.trim()   || detectedJob.title;
    $('det-company').textContent = detectedJob.company;
    $('det-title').textContent   = detectedJob.title;
    $('edit-fields').style.display = 'none';
    isEditing = false;
    $('btn-edit').textContent = '✏️ Edit';
  }
}

// ── URL cleaner ───────────────────────────────────────────────────────────────
// Strips apply paths, tracking params, and redirects so the saved URL
// points to the job posting itself, not the application form.
function cleanJobUrl(raw) {
  try {
    const u = new URL(raw);

    // Strip apply/applyManually and similar suffixes from the path
    u.pathname = u.pathname
      .replace(/\/apply(\/[^/]*)?$/i, '')   // /apply, /apply/applyManually
      .replace(/\/application\/?$/i, '')     // /application
      .replace(/\/submit\/?$/i, '')          // /submit
      .replace(/\/$/, '');                   // trailing slash

    // Remove common tracking/redirect query params
    const tracking = [
      'utm_source','utm_medium','utm_campaign','utm_content','utm_term',
      'src','source','ref','referrer','redirect','sid','gh_src',
      'ss','oga','rx_campaign','rx_medium','rx_source',
      'mobile','needsRedirect'
    ];
    tracking.forEach(p => u.searchParams.delete(p));

    // Strip the fragment
    u.hash = '';

    return u.toString();
  } catch {
    return raw;
  }
}

// ── Step navigation ───────────────────────────────────────────────────────────
function goToStep(n) {
  [1, 2, 3].forEach(i => {
    $(`step-${i}`).style.display = i === n ? 'block' : 'none';
    const ind = $(`step-ind-${i}`);
    ind.classList.remove('active', 'done');
    if (i === n) ind.classList.add('active');
    else if (i < n) ind.classList.add('done');
  });
  // Persist so we can restore after page navigation
  chrome.storage.local.set({ lastStep: n });
}

function goStep2() {
  // Persist any manual edits before moving forward
  if (isEditing) {
    detectedJob.company = $('edit-company').value || detectedJob.company;
    detectedJob.title   = $('edit-title').value   || detectedJob.title;
  }
  chrome.storage.local.set({ lastDetectedJob: {
    company: detectedJob.company,
    title:   detectedJob.title,
    url:     detectedJob.url
  }});
  goToStep(2);
}

function goStep3() {
  goToStep(3);
}

// ── Log application ───────────────────────────────────────────────────────────
async function handleLog() {
  const cfg = await getConfig();
  if (!cfg.sheetId) {
    showStatus('step3-status', 'error', '⚠️ No Sheet ID — open Settings first');
    return;
  }

  const company     = (isEditing ? $('edit-company')?.value : detectedJob.company) || '—';
  const title       = (isEditing ? $('edit-title')?.value   : detectedJob.title)   || '—';
  const url         = cleanJobUrl(detectedJob.url);
  const date        = new Date().toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' });
  const time        = new Date().toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit', hour12:true });
  const coverLetter = $('cover-letter-select')?.value || '';
  const sourceRaw   = $('source-select')?.value || '';
  const source      = sourceRaw === 'Other'
    ? ($('source-other-input')?.value.trim() || 'Other')
    : sourceRaw;
  const referral    = $('referral-toggle')?.checked ? 'Yes' : '';
  const sourceField = referral ? (source ? `${source} (Referral)` : 'Referral') : source;

  $('btn-log').disabled = true;
  $('log-label').innerHTML = '<span class="spinner"></span> Saving…';

  try {
    showStatus('step3-status', 'info', '🔍 Checking for duplicates…');
    const existing = await findExistingRow(cfg, url);
    if (existing) {
      showStatus('step3-status', 'error', `⚠️ Already logged on ${existing.date} — ${existing.company}`);
      $('btn-log').disabled = false;
      $('log-label').textContent = '✅ Save Application';
      showRelogOption(cfg, date, company, title, url, coverLetter, source);
      return;
    }

    showStatus('step3-status', 'info', '📄 Extracting resume text…');
    const resumeText = await extractResumeText();

    showStatus('step3-status', 'info', '🔍 Scraping job description…');
    const jobText = await scrapeCurrentPage();

    showStatus('step3-status', 'info', '📊 Saving to sheet…');
    await appendToSheet(cfg, [date, time, company, title, url, resumeText, coverLetter, jobText, '❓ No Reply', sourceField]);

    showStatus('step3-status', 'success', `✅ Logged! ${company} · ${title}`);

    // Update todayCount for smart reminder check
    const todayKey = new Date().toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' });
    const tc = await chrome.storage.local.get('todayCount');
    const prevCount = tc.todayCount?.date === todayKey ? tc.todayCount.count : 0;
    await chrome.storage.local.set({ todayCount: { date: todayKey, count: prevCount + 1 } });

    await chrome.storage.local.remove(['lastDetectedJob', 'lastStep', 'lastJobText']);
    if ($('referral-toggle')) $('referral-toggle').checked = false;
    goToStep(1);
    setTimeout(() => $('step3-status').className = 'status-bar hidden', 3000);
  } catch (err) {
    showStatus('step3-status', 'error', `❌ ${err.message}`);
  } finally {
    $('btn-log').disabled = false;
    $('log-label').textContent = '✅ Save Application';
  }
}

// Check if a URL already exists in column D of the sheet
async function findExistingRow(cfg, url) {
  try {
    const rows = await fetchSheetRows(cfg);
    const normalise = u => u.trim().replace(/\/$/, '').toLowerCase();
    const match = rows.find(row => normalise(row[3] || '') === normalise(url));
    if (!match) return null;
    return { date: match[0] || '', company: match[1] || '' };
  } catch {
    return null; // if check fails, allow logging rather than block
  }
}

// Show a small "Log anyway" option below the duplicate warning
function showRelogOption(cfg, date, company, title, url, coverLetter = '', source = '') {
  let existing = $('relog-option');
  if (existing) existing.remove();

  const el = document.createElement('div');
  el.id = 'relog-option';
  el.style.cssText = 'font-size:11px; color:#888; margin-top:6px; display:flex; align-items:center; gap:6px;';
  el.innerHTML = `Applied again? <button id="btn-relog" style="background:none;border:none;color:#1a73e8;font-size:11px;cursor:pointer;padding:0;text-decoration:underline;">Log it anyway</button>`;
  $('status-bar').insertAdjacentElement('afterend', el);

  if ($('btn-relog')) $('btn-relog').addEventListener('click', async () => {
    el.remove();
    $('btn-log').disabled = true;
    $('log-label').innerHTML = '<span class="spinner"></span> Logging…';
    try {
      showStatus('status-bar', 'info', '📊 Saving to sheet…');
      const resumeText = await extractResumeText();
      const jobText    = await scrapeCurrentPage();
      await appendToSheet(cfg, [date, time, company, title, url, resumeText, coverLetter, jobText, '❓ No Reply', sourceField]);
      showStatus('step3-status', 'success', `✅ Logged! ${company} · ${title}`);
    } catch (err) {
      showStatus('status-bar', 'error', `❌ ${err.message}`);
    } finally {
      $('btn-log').disabled = false;
      $('log-label').textContent = '📋 Log Application';
    }
  });
}

// ── Autofill ──────────────────────────────────────────────────────────────────
async function handleAutofill() {
  const cfg = await getConfig();
  if (!cfg.name && !cfg.email) {
    showStatus('autofill-status', 'error', '⚠️ Add your profile in Settings first');
    return;
  }
  $('btn-autofill').disabled = true;
  $('btn-autofill').textContent = 'Filling…';
  try {
    const [tab]   = await chrome.tabs.query({ active: true, currentWindow: true });
    const resume  = await getResume(); // { dataUrl, name } or null
    const response = await chrome.tabs.sendMessage(tab.id, {
      action: 'autofill',
      profile: {
        name: cfg.name, email: cfg.email, phone: cfg.phone,
        address: cfg.address, linkedin: cfg.linkedin, website: cfg.website,
        resumeDataUrl: resume?.dataUrl || null,
        resumeName:    resume?.name    || null,
      }
    });
    if (response?.filled > 0) {
      showStatus('autofill-status', 'success', `✅ Filled ${response.filled} field${response.filled > 1 ? 's' : ''}`);
    } else {
      showStatus('autofill-status', 'error', '⚠️ No matching fields found on this page');
    }
  } catch {
    showStatus('autofill-status', 'error', '❌ Could not reach page — try refreshing');
  } finally {
    $('btn-autofill').disabled = false;
    $('btn-autofill').textContent = '⚡ Fill application form';
  }
}

// Scrape job text from current tab for inline use during logging
async function scrapeCurrentPage() {
  try {
    const cached = await chrome.storage.local.get('lastJobText');
    if (cached.lastJobText && cached.lastJobText.length > 200) {
      const strongApplySignals = [
        /fields marked.*required/i,
        /create an account.*to apply/i,
        /sign in to apply/i,
        /step \d+ of \d+/i
      ];
      const hits = strongApplySignals.filter(re => re.test(cached.lastJobText)).length;
      if (hits < 2) { return cached.lastJobText; }
      await chrome.storage.local.remove('lastJobText');
    }

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return cached.lastJobText || '';

    if (!chrome.scripting) {
      return cached.lastJobText || '';
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: scrapePageContent
    });

    const text = results?.[0]?.result || '';
    return text || cached.lastJobText || '';
  } catch (err) {
    const cached = await chrome.storage.local.get('lastJobText');
    return cached.lastJobText || '';
  }
}

// Injected into the target page — runs in page context, returns the job text
function scrapePageContent() {
  const path = window.location.pathname.toLowerCase();
  if (/\/(apply|applymanually|create-account|sign-in|login|register)(\/|$)/.test(path)) return '';

  const selectors = [
    '#content', '.job__description', '.job-post',
    '[class*="job-description"]', '[class*="jobDescription"]',
    '[class*="job-details"]', '[class*="jobDetails"]',
    '[data-automation-id="jobPostingDescription"]',
    '.posting-page', '.section-wrapper',
    '[role="main"]', 'main', 'article'
  ];

  let raw = '';
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el && el.innerText && el.innerText.replace(/\s/g, '').length > 200) {
      raw = el.innerText;
      break;
    }
  }
  if (!raw) raw = document.body.innerText || '';

  const cleaned = raw.replace(/\s+/g, ' ').trim();
  return cleaned.length < 50 ? '' : cleaned.slice(0, 20000);
}

// Derive the job posting URL from an apply URL
// Works for Workday, Greenhouse, Lever, iCIMS, SmartRecruiters and others
function extractPostingUrl(url) {
  try {
    const u = new URL(url);
    const path = u.pathname;

    // Workday: /en-US/search/job/Location/Job-Title_ID/apply/applyManually
    // → /en-US/search/job/Location/Job-Title_ID
    const workday = path.match(/^(.*\/job\/[^/]+\/[^/]+)\/apply/i);
    if (workday) return `${u.origin}${workday[1]}`;

    // Greenhouse: /applications/new → strip to job board root
    // job-boards.greenhouse.io/company/jobs/12345/applications/new
    const greenhouse = path.match(/^(.*\/jobs\/\d+)\/applications/i);
    if (greenhouse) return `${u.origin}${greenhouse[1]}`;

    // Lever: /apply → strip to posting
    // jobs.lever.co/company/uuid/apply
    const lever = path.match(/^(.*[a-f0-9-]{36})\/apply/i);
    if (lever) return `${u.origin}${lever[1]}`;

    // iCIMS: /jobs/1234/job → already the posting, /jobs/1234/application → strip
    const icims = path.match(/^(.*\/jobs\/\d+)\/application/i);
    if (icims) return `${u.origin}${icims[1]}/job`;

    // Generic: strip /apply or /application suffix
    const generic = path.match(/^(.*?)\/apply(?:manually)?(?:\/.*)?$/i)
                 || path.match(/^(.*?)\/application(?:\/.*)?$/i);
    if (generic && generic[1].length > 1) return `${u.origin}${generic[1]}`;

    return url; // no transformation found
  } catch {
    return url;
  }
}

// Fetch and extract visible text from a URL via a background fetch
async function fetchPageText(url) {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ action: 'fetchPageText', url }, response => {
      resolve(response?.text || '');
    });
  });
}


// ── Resume storage ────────────────────────────────────────────────────────────
// Uses chrome.storage.local (not sync) — files are too large for sync's 8KB limit

async function handleResumeUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  // 5 MB cap — most resumes are <200KB but give generous room
  if (file.size > 5 * 1024 * 1024) {
    showStatus('settings-status', 'error', '❌ File too large — max 5 MB');
    return;
  }

  const dataUrl = await fileToDataUrl(file);
  await chrome.storage.local.set({ resume: { dataUrl, name: file.name } });
  showResumeUI(file.name);
  showStatus('settings-status', 'success', `✅ Resume saved: ${file.name}`);
}

async function loadResume() {
  const result = await chrome.storage.local.get('resume');
  if (result.resume?.name) showResumeUI(result.resume.name);
}

async function clearResume() {
  await chrome.storage.local.remove('resume');
  $('resume-name').style.display = 'none';
  $('resume-label').style.display = 'block';
  $('btn-clear-resume').style.display = 'none';
  if ($('cfg-resume-input')) $('cfg-resume-input').value = '';
  showStatus('settings-status', 'info', 'Resume removed');
}

function showResumeUI(name) {
  $('resume-label').style.display = 'none';
  $('resume-name').textContent = '📄 ' + name;
  $('resume-name').style.display = 'block';
  $('btn-clear-resume').style.display = 'block';
}

function getResume() {
  return new Promise(resolve => {
    chrome.storage.local.get('resume', r => resolve(r.resume || null));
  });
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

// Extract plain text from the saved resume using PDF.js for PDFs
async function extractResumeText() {
  const resume = await getResume();
  if (!resume?.dataUrl) return '';

  const isPdf = resume.name?.toLowerCase().endsWith('.pdf') ||
                resume.dataUrl.startsWith('data:application/pdf');

  if (isPdf) {
    return await extractPdfText(resume.dataUrl);  // let errors propagate to handleLog
  }

  if (resume.dataUrl.startsWith('data:text/')) {
    const base64 = resume.dataUrl.split(',')[1];
    return atob(base64).replace(/\s+/g, ' ').trim();
  }

  return resume.name || '';
}

async function extractPdfText(dataUrl) {
  // Resolve pdfjsLib — legacy build may export under either name
  const pdfjs = window.pdfjsLib || window['pdfjs-dist/build/pdf'];
  if (!pdfjs) throw new Error('PDF.js not loaded — reload the extension');

  pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('pdf.worker.min.js');

  const base64 = dataUrl.split(',')[1];
  const binary  = atob(base64);
  const bytes   = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  const pdf   = await pdfjs.getDocument({ data: bytes }).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page    = await pdf.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map(item => item.str).join(' '));
  }
  return pages.join(' ').replace(/\s+/g, ' ').trim();
}

// ── Interview: search logged applications ─────────────────────────────────────
async function handleInterviewSearch() {
  const query = $('interview-search')?.value.trim().toLowerCase() || '';
  const resultsEl = $('interview-results');

  if (!query) { resultsEl.style.display = 'none'; return; }

  const cfg = await getConfig();
  if (!cfg.sheetId) {
    resultsEl.style.display = 'none';
    showStatus('interview-status', 'error', '⚠️ No Sheet ID — open Settings first');
    return;
  }

  try {
    const rows = await fetchSheetRows(cfg);
    const headerOffset = await getHeaderOffset(cfg);

    // fetchSheetRows already strips the header row if present
    const allMatches = rows
      .map((row, i) => ({
        rowIndex: i + 1 + headerOffset,
        date:    (row[0] || '').trim(),
        company: (row[2] || '').trim(),
        title:   (row[3] || '').trim(),
        url:     (row[4] || '').trim(),
      }))
      .filter(r => {
        const haystack = `${r.company} ${r.title}`.toLowerCase();
        return haystack.includes(query);
      });

    // Deduplicate by company+title — keep the most recent (first row = newest since sheet is newest-first)
    const seen    = new Set();
    const matches = allMatches.filter(r => {
      const key = `${r.company}|${r.title}`.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (matches.length === 0) {
      resultsEl.innerHTML = '<div style="padding:10px;font-size:12px;color:#888;text-align:center;">No matches found</div>';
      resultsEl.style.display = 'block';
      return;
    }

    resultsEl.innerHTML = matches.slice(0, 8).map(r => `
      <div class="result-item" data-row="${r.rowIndex}" data-company="${escHtml(r.company)}" data-title="${escHtml(r.title)}" data-url="${escHtml(r.url)}">
        <div class="r-company">${escHtml(r.company)}</div>
        <div class="r-title">${escHtml(r.title || '—')}</div>
        <div class="r-date">${escHtml(r.date || '')}</div>
      </div>
    `).join('');
    resultsEl.style.display = 'block';

    resultsEl.querySelectorAll('.result-item').forEach(el => {
      el.addEventListener('click', () => selectApplication({
        rowIndex: +el.dataset.row,
        company:  el.dataset.company,
        title:    el.dataset.title,
        url:      el.dataset.url
      }));
    });

  } catch (err) {
    resultsEl.innerHTML = `<div style="padding:10px;font-size:12px;color:#c5221f;">❌ Could not read sheet — check your Sheet ID in Settings</div>`;
    resultsEl.style.display = 'block';
  }
}

function selectApplication(app) {
  selectedRow = app;
  selectedStage = '';

  $('interview-results').style.display = 'none';
  if ($('interview-search')) $('interview-search').value = '';

  $('interview-selected').innerHTML = `
    <div class="selected-app">
      <div class="sa-company">${escHtml(app.company)}</div>
      <div class="sa-title">${escHtml(app.title)}</div>
    </div>`;
  $('interview-selected').style.display = 'block';

  // Reset form — hide save button until status is chosen
  document.querySelectorAll('#interview-type-chips .chip').forEach(c => c.classList.remove('selected'));
  if ($('interview-type-details')) $('interview-type-details').innerHTML = '';
  if ($('interview-details')) $('interview-details').style.display = 'none';
  if ($('status-select')) $('status-select').value = '';
  if ($('interview-type-section')) $('interview-type-section').style.display = 'none';
  if ($('interview-status')) $('interview-status').className = 'status-bar hidden';
  $('interview-form').style.display = 'block';
}

// ── Interview: type chips ─────────────────────────────────────────────────────
// ── Role-based interview chips ────────────────────────────────────────────────

const ROLE_INTERVIEW_TYPES = {
  'Software Engineer':         ['Live Coding','System Design','Technical Screen','Take-Home','Behavioral'],
  'Frontend Engineer':         ['Live Coding','UI Challenge','Technical Screen','Take-Home','Behavioral'],
  'Backend Engineer':          ['Live Coding','System Design','Technical Screen','Take-Home','Behavioral'],
  'Full Stack Engineer':       ['Live Coding','System Design','UI Challenge','Technical Screen','Behavioral'],
  'Mobile Engineer':           ['Live Coding','System Design','Technical Screen','Take-Home','Behavioral'],
  'DevOps / Cloud Engineer':   ['Infrastructure Design','Scripting Challenge','Technical Screen','Take-Home','Behavioral'],
  'QA / Test Engineer':        ['Test Case Design','Bug Analysis','Technical Screen','Take-Home','Behavioral'],
  'Embedded Systems Engineer': ['Live Coding','Hardware Design','Technical Screen','Take-Home','Behavioral'],
  'Data Analyst':              ['SQL Test','Case Study','Data Challenge','Technical Screen','Behavioral'],
  'Data Scientist':            ['SQL Test','Modeling Challenge','Statistics Test','Take-Home','Behavioral'],
  'Data Engineer':             ['SQL Test','Pipeline Design','Technical Screen','Take-Home','Behavioral'],
  'Machine Learning Engineer': ['ML Design','Coding Challenge','Statistics Test','Take-Home','Behavioral'],
  'Business Intelligence Analyst': ['SQL Test','Dashboard Challenge','Case Study','Technical Screen','Behavioral'],
  'Product Manager':           ['Product Case','Metrics Question','Strategy','Take-Home','Behavioral'],
  'UX/UI Designer':            ['Portfolio Review','Design Challenge','Critique','Take-Home','Behavioral'],
  'UX Researcher':             ['Research Plan','Case Study','Portfolio Review','Take-Home','Behavioral'],
  'Product Designer':          ['Portfolio Review','Design Challenge','Critique','Take-Home','Behavioral'],
  'Business Analyst':          ['Case Study','SQL Test','Data Challenge','Take-Home','Behavioral'],
  'Operations Analyst':        ['Case Study','Process Design','Data Challenge','Take-Home','Behavioral'],
  'Program Coordinator':       ['Scenario','Case Study','Presentation','Take-Home','Behavioral'],
  'Project Manager':           ['Scenario','Case Study','Presentation','Take-Home','Behavioral'],
  'Strategy & Operations':     ['Case Study','Metrics Question','Strategy','Take-Home','Behavioral'],
  'Cybersecurity Analyst':     ['Threat Analysis','Technical Screen','CTF Challenge','Take-Home','Behavioral'],
  'IT Support / Systems Admin':['Troubleshooting','Technical Screen','Scenario','Behavioral'],
  'Technical Writer':          ['Writing Sample','Portfolio Review','Edit Test','Take-Home','Behavioral'],
  'Solutions Engineer':        ['Technical Demo','Live Coding','System Design','Behavioral'],
  'Research Scientist':        ['Research Presentation','Technical Screen','Paper Review','Take-Home','Behavioral'],
  'Other':                     ['Technical Screen','Case Study','Presentation','Take-Home','Behavioral'],
};

const DS_CHIPS   = ['Arrays','Strings','Linked Lists','Doubly Linked Lists','Stacks','Queues','Deques','Hash Maps','Hash Sets','Trees','Binary Trees','Binary Search Trees','AVL Trees','Red-Black Trees','Segment Trees','Fenwick Trees','Heaps','Min Heap','Max Heap','Priority Queues','Graphs','Directed Graphs','Weighted Graphs','Tries','Matrices','Monotonic Stack','Monotonic Queue','Disjoint Sets','Bloom Filters','LRU Cache'];
const ALGO_CHIPS = ['Two Pointers','Fast & Slow Pointers','Sliding Window','Binary Search','BFS','DFS','Recursion','Backtracking','Dynamic Programming','Memoization','Tabulation','Greedy','Divide & Conquer','Merge Sort','Quick Sort','Heap Sort','Counting Sort','Radix Sort','Topological Sort',"Dijkstra's","Bellman-Ford",'Floyd-Warshall',"Prim's","Kruskal's",'Bit Manipulation','Math & Number Theory','Prefix Sum','Difference Array','Intervals','Cyclic Sort','Reservoir Sampling','Fisher-Yates Shuffle'];
const SYS_CHIPS  = ['Load Balancing','Caching','Sharding','Replication','CAP Theorem','Consistent Hashing','Message Queues','Rate Limiting','CDN','SQL vs NoSQL','Microservices','API Design','WebSockets','Pub/Sub'];

function initInterviewChips() {
  refreshInterviewTypeChips();

  const roleSelect = $('role-type-select');
  if (roleSelect && !roleSelect.dataset.wired) {
    roleSelect.dataset.wired = '1';
    roleSelect.addEventListener('change', refreshInterviewTypeChips);
  }

  if ($('ds-chips') && !$('ds-chips').dataset.built) {
    $('ds-chips').dataset.built = '1';
    buildStaticChips(DS_CHIPS,   'ds-chips');
    buildStaticChips(ALGO_CHIPS, 'algo-chips');
    buildStaticChips(SYS_CHIPS,  'sys-chips');

    ['ds','algo','sys'].forEach(sId => {
      const header = $(`expand-${sId}`);
      if (header) header.addEventListener('click', () => {
        const content = $(`content-${sId}`);
        const icon    = $(`icon-${sId}`);
        if (!content || !icon) return;
        const open = content.style.display !== 'none';
        content.style.display = open ? 'none' : 'block';
        icon.textContent = open ? '+' : '−';
      });

      const container = $(`${sId}-chips`);
      if (container) container.addEventListener('click', e => {
        const chip = e.target.closest('.chip');
        if (!chip) return;
        chip.classList.toggle('selected');
        const badge = $(`badge-${sId}`);
        if (!badge) return;
        const count = container.querySelectorAll('.chip.selected').length;
        badge.textContent = count > 0 ? `${count} selected` : '';
        badge.style.display = count > 0 ? 'inline-block' : 'none';
      });
    });
  }
}

function refreshInterviewTypeChips() {
  const container = $('interview-type-chips');
  if (!container) return;
  const role  = $('role-type-select')?.value || 'Software Engineer';
  const types = ROLE_INTERVIEW_TYPES[role] || ROLE_INTERVIEW_TYPES['Other'];
  container.innerHTML = types.map(t =>
    `<div class="chip" data-type="${escHtml(t)}">${escHtml(t)}</div>`
  ).join('');
  container.onclick = e => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    chip.classList.toggle('selected');
  };
}

function buildStaticChips(items, containerId) {
  const container = $(containerId);
  if (!container) return;
  container.innerHTML = items.map(t =>
    `<div class="chip" data-chip="${escHtml(t)}">${escHtml(t)}</div>`
  ).join('');
}

function buildDsChips() {}
function buildInterviewTypeDetails() {}


// ── Interview: save update to sheet ──────────────────────────────────────────
async function handleSaveInterview() {
  if (!selectedRow) {
    showStatus('interview-status', 'error', '⚠️ Select an application first');
    return;
  }

  const newStatus = $('status-select')?.value;
  if (!newStatus) {
    showStatus('interview-status', 'error', '⚠️ Pick a status');
    return;
  }

  const cfg = await getConfig();
  if (!cfg.sheetId) {
    showStatus('interview-status', 'error', '⚠️ No Sheet ID in Settings');
    return;
  }

  $('btn-save-interview').disabled = true;
  $('interview-label').innerHTML = '<span class="spinner"></span> Saving…';

  try {
    const token = await getToken();
    await updateApplicationStatus(cfg, token, selectedRow.url, newStatus, selectedRow);

    // Only save to Interviews sheet if Interview type was selected
    if (newStatus === '💼 Interview') {
      const selectedTypes = [...document.querySelectorAll('#interview-type-chips .chip.selected')];
      if (selectedTypes.length > 0) {
        await saveInterviewDetails(cfg, token);
      }
      // Schedule reminders based on interview date
      const { datetimeStr } = collectInterviewData();
      await scheduleInterviewReminders(datetimeStr, selectedRow.company, selectedRow.title);
    }

    // Save to Offers tab
    if (newStatus === '🎁 Received Offer' || newStatus === '✅ Offer Accepted') {
      await saveOfferEntry(cfg, token, newStatus);
    }

    showStatus('interview-status', 'success', `✅ Status updated to ${newStatus}`);

    if (newStatus === '🎁 Received Offer' || newStatus === '✅ Offer Accepted') {
      // Show celebration — skip normal reset so panel stays visible
      setTimeout(() => showCelebration(newStatus, selectedRow?.company, selectedRow?.title), 200);
      return;
    }

    // Reset for non-offer statuses
    if ($('status-select')) $('status-select').value = '';
    if ($('interview-type-section')) $('interview-type-section').style.display = 'none';
    if ($('interview-details')) $('interview-details').style.display = 'none';
    selectedRow = null;
    if ($('interview-selected')) $('interview-selected').style.display = 'none';
    if ($('interview-form')) $('interview-form').style.display = 'none';
  } catch (err) {
    showStatus('interview-status', 'error', `❌ ${err.message}`);
  } finally {
    $('btn-save-interview').disabled = false;
    $('interview-label').textContent = '💾 Save Status Update';
  }
}

async function saveOfferEntry(cfg, token, activity) {
  const offersTab = 'Offers';
  const dateLogged = new Date().toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' });
  const timeLogged = new Date().toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit', hour12:true });

  // Check Offers tab exists
  const metaRes  = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${cfg.sheetId}?fields=sheets.properties`,
    { headers: { 'Authorization': `Bearer ${token}` } }
  );
  const metaData = await metaRes.json();
  const sheet    = metaData.sheets?.find(s => s.properties.title === offersTab);
  if (!sheet) return; // No Offers tab — skip silently

  // Columns: Date Logged | Company | Role | Activity
  const row = [`${dateLogged} ${timeLogged}`, selectedRow.company, selectedRow.title, activity];

  const sheetId = sheet.properties.sheetId;
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${cfg.sheetId}:batchUpdate`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [{ insertDimension: {
        range: { sheetId, dimension: 'ROWS', startIndex: 1, endIndex: 2 },
        inheritFromBefore: false
      }}]
    })
  });

  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${cfg.sheetId}/values/${encodeURIComponent(`${offersTab}!A2`)}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [row] })
    }
  );
}

function collectInterviewData() {
  const dateInput = $('interview-date')?.value;
  const timeInput = $('interview-time')?.value || '09:00';

  // Combined datetime string for alarm scheduling
  const datetimeStr = dateInput ? `${dateInput}T${timeInput}` : null;

  const date = dateInput
    ? new Date(datetimeStr).toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' })
    : new Date().toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' });

  const timeFormatted = dateInput
    ? new Date(datetimeStr).toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit', hour12:true })
    : '';

  const types = [...document.querySelectorAll('#interview-type-chips .chip.selected')]
    .map(c => c.dataset.type).filter(Boolean).join(', ');

  const dsSelected   = [...document.querySelectorAll('#ds-chips .chip.selected')].map(c => c.dataset.chip).filter(Boolean);
  const algoSelected = [...document.querySelectorAll('#algo-chips .chip.selected')].map(c => c.dataset.chip).filter(Boolean);
  const sysSelected  = [...document.querySelectorAll('#sys-chips .chip.selected')].map(c => c.dataset.chip).filter(Boolean);

  const parts = [];
  if (dsSelected.length)   parts.push(`DS: ${dsSelected.join(', ')}`);
  if (algoSelected.length) parts.push(`Algo: ${algoSelected.join(', ')}`);
  if (sysSelected.length)  parts.push(`System Design: ${sysSelected.join(', ')}`);

  const dataStructure = parts.join(' | ');
  const role  = $('role-type-select')?.value || '';
  const notes = role ? `Role: ${role}` : '';

  return { date, timeFormatted, datetimeStr, types, dataStructure, notes };
}

async function saveInterviewDetails(cfg, token) {
  const { date: interviewDate, timeFormatted, types, dataStructure, notes } = collectInterviewData();
  const interviewDateTime = timeFormatted ? `${interviewDate} ${timeFormatted}` : interviewDate;

  const dateLogged = new Date().toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' });
  const timeLogged = new Date().toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit', hour12:true });
  const dateTimeLogged = `${dateLogged} ${timeLogged}`;
  const interviewTab = 'Interviews';

  const metaRes  = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${cfg.sheetId}?fields=sheets.properties`,
    { headers: { 'Authorization': `Bearer ${token}` } }
  );
  const metaData = await metaRes.json();
  const sheet    = metaData.sheets?.find(s => s.properties.title === interviewTab);
  if (!sheet) return; // No Interviews tab — skip silently
  const sheetId = sheet.properties.sheetId;

  const existingRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${cfg.sheetId}/values/${encodeURIComponent(`${interviewTab}!C:D`)}`,
    { headers: { 'Authorization': `Bearer ${token}` } }
  );
  const existingData = await existingRes.json();
  const existingRows = existingData.values || [];
  const matchCount = existingRows.filter(r =>
    (r[0] || '').toLowerCase().trim() === selectedRow.company.toLowerCase().trim() &&
    (r[1] || '').toLowerCase().trim() === selectedRow.title.toLowerCase().trim()
  ).length;
  const round = matchCount + 1;

  const row = [dateTimeLogged, interviewDateTime, selectedRow.company, selectedRow.title, types, dataStructure, round, notes];

  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${cfg.sheetId}:batchUpdate`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [{ insertDimension: {
        range: { sheetId, dimension: 'ROWS', startIndex: 1, endIndex: 2 },
        inheritFromBefore: false
      }}]
    })
  });

  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${cfg.sheetId}/values/${encodeURIComponent(`${interviewTab}!A2`)}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [row] })
    }
  );
}

// ── Sheets helpers ────────────────────────────────────────────────────────────

// Update the Status column in the Applications sheet for a given URL
async function updateApplicationStatus(cfg, token, url, status, selectedRow = null) {
  try {
    const tab  = 'Applications';
    const res  = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${cfg.sheetId}/values/${encodeURIComponent(`${tab}!A:J`)}`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    const data = await res.json();
    const rows = data.values || [];
    if (!rows.length) { console.log('updateStatus: no rows'); return; }

    const normalise = u => (u || '').trim().replace(/\/$/, '').toLowerCase();
    const targetUrl = normalise(url);

    const header = rows[0] || [];

    // The first column is NOT an auto-number — it's a date
    // Just find URL and Status directly from header names
    const urlIdx    = header.findIndex(h => /\burl\b/i.test(h));
    const statusIdx = header.findIndex(h => /\bstatus\b/i.test(h));

    const uIdx = urlIdx    >= 0 ? urlIdx    : 4; // fallback column E
    const sIdx = statusIdx >= 0 ? statusIdx : 8; // fallback column I

    let finalIndex = rows.findIndex((r, i) => i > 0 && normalise(r[uIdx]) === targetUrl);

    if (finalIndex === -1 && selectedRow) {
      const compIdx = header.findIndex(h => /company/i.test(h));
      const roleIdx = header.findIndex(h => /role|title/i.test(h));
      if (compIdx >= 0 && roleIdx >= 0) {
        finalIndex = rows.findIndex((r, i) => i > 0 &&
          (r[compIdx] || '').toLowerCase().trim() === (selectedRow.company || '').toLowerCase().trim() &&
          (r[roleIdx]  || '').toLowerCase().trim() === (selectedRow.title  || '').toLowerCase().trim()
        );
      }
    }
    if (finalIndex === -1) { console.log('updateStatus: row not found'); return; }

    const sheetRow  = finalIndex + 1;
    const colLetter = String.fromCharCode(65 + sIdx);

    const writeRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${cfg.sheetId}/values/${encodeURIComponent(`${tab}!${colLetter}${sheetRow}`)}?valueInputOption=USER_ENTERED`,
      {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: [[status]] })
      }
    );
    const writeData = await writeRes.json();
  } catch (e) {
  }
}
async function getHeaderOffset(cfg) {
  // Returns 1 if sheet has a header row, 0 if data starts at row 1
  const token    = await getToken();
  const tabName  = encodeURIComponent(`${'Applications'}!A1`);
  const endpoint = `https://sheets.googleapis.com/v4/spreadsheets/${cfg.sheetId}/values/${tabName}`;
  const res = await fetch(endpoint, { headers: { 'Authorization': `Bearer ${token}` } });
  const data = await res.json();
  const firstCell = (data.values?.[0]?.[0] || '').toLowerCase().trim();
  return /^(date|company|title|application|date applied|company name|role name)$/i.test(firstCell) ? 1 : 0;
}

async function fetchSheetRows(cfg) {
  const token    = await getToken();
  const tabName  = encodeURIComponent(`${'Applications'}!A:J`);
  const endpoint = `https://sheets.googleapis.com/v4/spreadsheets/${cfg.sheetId}/values/${tabName}`;
  const res = await fetch(endpoint, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!res.ok) throw new Error('Could not fetch sheet');
  const data = await res.json();
  let rows = data.values || [];
  if (rows.length === 0) return [];

  // Skip header row if first cell looks like a header label
  const firstCell = (rows[0][0] || '').toLowerCase().trim();
  const looksLikeHeader = /^(date|company|time|title|application|date applied|company name|role name)$/i.test(firstCell);
  if (looksLikeHeader) rows = rows.slice(1);

  return rows;
}

// Safe wrapper: handles HTML error pages and auto-retries once on 401 with fresh token
async function sheetsFetch(url, options = {}, retried = false) {
  const token = await getToken();
  const res = await fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` }
  });

  if (res.status === 401 && !retried) {
    // Token invalid — force refresh and retry once
    await chrome.storage.local.get('googleAuth').then(s => {
      if (s.googleAuth) chrome.storage.local.set({ googleAuth: { ...s.googleAuth, issuedAt: 0 } });
    });
    return sheetsFetch(url, options, true);
  }

  if (!res.ok) {
    // Read as text first so an HTML error page doesn't throw a JSON parse error
    const text = await res.text();
    let message = `Sheets API error (${res.status})`;
    try { message = JSON.parse(text).error?.message || message; } catch { /* HTML page */ }
    if (res.status === 401) message = 'Session expired — please reconnect Google in Settings';
    if (res.status === 404) message = 'Sheet not found — check your Sheet ID in Settings (paste the ID or full URL)';
    if (res.status === 403) message = "No access to this sheet — make sure it's your sheet";
    throw new Error(message);
  }
  return res;
}

async function appendToSheet(cfg, row) {
  const tab = 'Applications';

  // Get the sheet ID (gid) for the tab
  const metaRes  = await sheetsFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${cfg.sheetId}?fields=sheets.properties`
  );
  const metaData = await metaRes.json();
  const sheet    = metaData.sheets?.find(s => s.properties.title === tab);
  if (!sheet) throw new Error(`No "${tab}" tab found in your sheet`);
  const sheetId  = sheet.properties.sheetId ?? 0;

  // Insert a blank row at position 2 (after header)
  await sheetsFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${cfg.sheetId}:batchUpdate`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{
          insertDimension: {
            range: { sheetId, dimension: 'ROWS', startIndex: 1, endIndex: 2 },
            inheritFromBefore: false
          }
        }]
      })
    }
  );

  // Write the data into row 2
  const range = encodeURIComponent(`${tab}!A2`);
  await sheetsFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${cfg.sheetId}/values/${range}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [row] })
    }
  );
}

// ── Auth ──────────────────────────────────────────────────────────────────────

// Read from config.json — do not hardcode your Client ID here
function getGoogleClientId() {
  const id = CONFIG?.googleClientId;
  if (!id) {
    console.error('[JobTracker] getGoogleClientId: CONFIG =', CONFIG);
    throw new Error('Google Client ID not loaded — reload the extension and try again. If this persists, check that config.json exists and contains a "googleClientId" field.');
  }
  if (id === 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com') {
    throw new Error('Google Client ID is still a placeholder — copy config.example.json to config.json and fill in your real Client ID.');
  }
  return id;
}

async function getToken() {
  const stored = await chrome.storage.local.get('googleAuth');
  const auth   = stored.googleAuth;

  // Token still fresh — return directly
  if (auth?.token && auth.issuedAt && Date.now() - auth.issuedAt < 55 * 60 * 1000) {
    return auth.token;
  }

  if (!auth?.email) {
    throw new Error('Not signed in — connect Google in Settings');
  }

  // Token expired — try SILENT re-auth first (no UI), fall back to interactive
  const buildAuthUrl = (silent) => {
    const url = new URL('https://accounts.google.com/o/oauth2/auth');
    url.searchParams.set('client_id',     getGoogleClientId());
    url.searchParams.set('response_type', 'token');
    url.searchParams.set('redirect_uri',  chrome.identity.getRedirectURL());
    url.searchParams.set('scope',         'https://www.googleapis.com/auth/spreadsheets email profile');
    url.searchParams.set('login_hint',    auth.email);
    if (silent) url.searchParams.set('prompt', 'none'); // no UI if session still valid with Google
    return url.toString();
  };

  const tryAuth = (silent) => new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { action: 'launchAuthFlow', url: buildAuthUrl(silent), interactive: !silent },
      response => {
        if (!response || response.error || !response.responseUrl) { resolve(null); return; }
        const token = new URLSearchParams(new URL(response.responseUrl).hash.slice(1)).get('access_token');
        resolve(token || null);
      }
    );
  });

  // 1. Silent attempt — works as long as the user's Google session is alive
  let token = await tryAuth(true);

  // 2. Fall back to interactive only if silent failed
  if (!token) token = await tryAuth(false);

  if (!token) {
    await chrome.storage.local.remove(['googleAuth', 'googleEmail']);
    throw new Error('Session expired — please reconnect Google in Settings');
  }

  await chrome.storage.local.set({ googleAuth: { ...auth, token, issuedAt: Date.now() } });
  return token;
}

async function handleConnectGoogle() {
  $('btn-connect-google').disabled = true;
  $('connect-google-label').textContent = 'Connecting…';
  try {
    // Clear any previous result, then hand off to the service worker.
    // The popup may close while the OAuth window is open — the service worker
    // completes the flow and writes to storage. We pick up the result either
    // via the storage.onChanged listener below (if popup stays open) or on the
    // next popup open via loadSettings().
    await chrome.storage.local.remove('authFlowResult');
    chrome.runtime.sendMessage({
      action:      'startAuthFlow',
      clientId:    getGoogleClientId(),
      redirectUrl: chrome.identity.getRedirectURL()
    });
    showStatus('google-auth-status', 'info', '🔑 Google sign-in window opened — complete sign-in then reopen the extension if needed');
  } catch (err) {
    showStatus('google-auth-status', 'error', `❌ ${err.message}`);
    $('btn-connect-google').disabled = false;
    $('connect-google-label').textContent = 'Connect Google Account';
  }
}

async function handleDisconnectGoogle() {
  const stored = await chrome.storage.local.get('googleAuth');
  if (stored.googleAuth?.token) {
    fetch(`https://accounts.google.com/o/oauth2/revoke?token=${stored.googleAuth.token}`).catch(() => {});
  }
  await chrome.storage.local.remove(['googleAuth', 'googleEmail']);
  showGoogleDisconnected();
}

function showGoogleConnected(email) {
  $('google-auth-row').style.display = 'none';
  $('google-connected-email').textContent = email;
  $('google-connected').style.display = 'flex';
}

function showGoogleDisconnected() {
  $('google-connected').style.display = 'none';
  $('google-auth-row').style.display = 'block';
  showStatus('google-auth-status', 'info', 'Google account disconnected');
}

async function loadSettings() {
  // Restore Google connection FIRST so it always runs even if later code throws
  try {
    const authStored = await chrome.storage.local.get(['googleAuth', 'googleEmail']);
    const email = authStored.googleAuth?.email || authStored.googleEmail || null;
    if (email) showGoogleConnected(email);
  } catch (e) {
    console.error('[JobTracker] loadSettings — connection restore error:', e);
  }

  try {
    const cfg = await getConfig();
    if ($('cfg-sheet-id')) $('cfg-sheet-id').value  = cfg.sheetId  || '';
    if ($('cfg-name'))     $('cfg-name').value      = cfg.name     || '';
    if ($('cfg-email'))    $('cfg-email').value     = cfg.email    || '';
    if ($('cfg-phone'))    $('cfg-phone').value     = cfg.phone    || '';
    if ($('cfg-address'))  $('cfg-address').value   = cfg.address  || '';
    if ($('cfg-linkedin')) $('cfg-linkedin').value  = cfg.linkedin || '';
    if ($('cfg-website'))  $('cfg-website').value   = cfg.website  || '';

    const stored2 = await chrome.storage.local.get(['ghostWeeks', 'interviewReminders']);
    const weeks   = stored2.ghostWeeks || 3;
    if ($('cfg-ghost-weeks')) {
      $('cfg-ghost-weeks').value = weeks;
      const label = weeks === 1 ? '1 week' : `${weeks} weeks`;
      if ($('ghost-weeks-label'))  $('ghost-weeks-label').textContent  = label;
      if ($('ghost-weeks-inline')) $('ghost-weeks-inline').textContent = label;
    }
    loadReminders(stored2.interviewReminders);
  } catch (e) {
    console.error('[JobTracker] loadSettings — settings load error:', e);
  }
}


async function scheduleInterviewReminders(interviewDate, company, role) {
  if (!chrome.alarms) return;
  const stored    = await chrome.storage.local.get('interviewReminders');
  const reminders = stored.interviewReminders || [];
  if (!reminders.length || !interviewDate) return;

  const interviewMs = new Date(interviewDate).getTime();
  if (isNaN(interviewMs)) return;

  reminders.forEach((r, i) => {
    const amount = parseInt(r.amount) || 1;
    let ms = 0;
    if (r.unit === 'minutes before') ms = amount * 60 * 1000;
    else if (r.unit === 'hours before') ms = amount * 60 * 60 * 1000;
    else if (r.unit === 'days before')  ms = amount * 24 * 60 * 60 * 1000;

    const alarmTime = interviewMs - ms;
    if (alarmTime <= Date.now()) return;

    const label     = `${amount} ${r.unit}`;
    const alarmName = `interviewReminder-${i}-${alarmTime}`;
    // Store data separately keyed by alarm name
    chrome.storage.local.set({ [alarmName]: { company, role, label } });
    chrome.alarms.create(alarmName, { when: alarmTime });
  });
}

// ── Celebration confetti ──────────────────────────────────────────────────────

const CONFETTI_COLORS = ['#1a73e8','#34a853','#fbbc04','#ea4335','#a142f4','#24c1e0','#f28b82','#ccff90','#ff8a65','#80deea','#ff80ab','#ffe57f'];
let confettiPieces = [], confettiAnimId, celCountdownInterval;

function ConfettiPiece(cw, ch) {
  this.x        = Math.random() * cw;
  this.y        = -10 - Math.random() * 80;
  this.w        = 8 + Math.random() * 8;
  this.h        = this.w * (0.2 + Math.random() * 0.2);
  this.vx       = (Math.random() - 0.5) * 3;
  this.vy       = 1.5 + Math.random() * 2.5;
  this.angle    = Math.random() * Math.PI * 2;
  this.angleVel = (Math.random() - 0.5) * 0.18;
  this.wobble   = Math.random() * Math.PI * 2;
  this.wobbleVel= 0.08 + Math.random() * 0.06;
  this.color    = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];
  this.opacity  = 1;
  this.gravity  = 0.07 + Math.random() * 0.04;
  this.drag     = 0.98;
}
ConfettiPiece.prototype.update = function(ch) {
  this.wobble += this.wobbleVel;
  this.vy     += this.gravity;
  this.vx     *= this.drag;
  this.x      += this.vx + Math.sin(this.wobble) * 0.6;
  this.y      += this.vy;
  this.angle  += this.angleVel;
  if (this.y > ch - 30) this.opacity = Math.max(0, this.opacity - 0.03);
  return this.y < ch + 20 && this.opacity > 0;
};
ConfettiPiece.prototype.draw = function(ctx) {
  ctx.save();
  ctx.globalAlpha = this.opacity;
  ctx.translate(this.x, this.y);
  ctx.rotate(this.angle);
  ctx.fillStyle = this.color;
  ctx.fillRect(-this.w/2, -this.h/2, this.w, this.h);
  ctx.restore();
};

function launchConfetti() {
  const canvas = $('confetti-canvas');
  const cel    = $('cel-view');
  if (!canvas || !cel) return;
  canvas.width  = cel.offsetWidth  || 360;
  canvas.height = cel.offsetHeight || 320;
  const ctx = canvas.getContext('2d');
  confettiPieces = [];
  cancelAnimationFrame(confettiAnimId);

  const cw = canvas.width, ch = canvas.height;
  const spawn = count => { for (let i = 0; i < count; i++) confettiPieces.push(new ConfettiPiece(cw, ch)); };

  spawn(90);
  setTimeout(() => spawn(70), 300);
  setTimeout(() => spawn(50), 700);

  function tick() {
    ctx.clearRect(0, 0, cw, ch);
    confettiPieces = confettiPieces.filter(p => { const a = p.update(ch); p.draw(ctx); return a; });
    if (confettiPieces.length > 0) confettiAnimId = requestAnimationFrame(tick);
  }
  tick();
}

function showCelebration(status, company, title) {
  const panel = $('panel-interview');
  const cel   = $('cel-view');
  if (!panel || !cel) return;

  // Hide everything inside panel, show celebration
  [...panel.children].forEach(c => c.style.display = 'none');
  $('cel-emoji').textContent   = status === '✅ Offer Accepted' ? '✅' : '🎁';
  $('cel-title').textContent   = status === '✅ Offer Accepted' ? 'Offer accepted! Congratulations!' : 'Offer received!';
  $('cel-company').textContent = company && title ? `${company} · ${title}` : company || title || '';
  cel.style.display = 'flex';
  panel.appendChild(cel);
  setTimeout(launchConfetti, 30);

  let secs = 5;
  if ($('cel-countdown')) $('cel-countdown').textContent = secs;
  clearInterval(celCountdownInterval);
  celCountdownInterval = setInterval(() => {
    secs--;
    if ($('cel-countdown')) $('cel-countdown').textContent = secs;
    if (secs <= 0) { clearInterval(celCountdownInterval); hideCelebration(); }
  }, 1000);
}

function hideCelebration() {
  const cel = $('cel-view');
  if (cel) cel.style.display = 'none';
  cancelAnimationFrame(confettiAnimId);
  confettiPieces = [];
  clearInterval(celCountdownInterval);

  // Restore just the search section, keep form hidden
  const searchSection = $('panel-interview')?.querySelector('.section');
  if (searchSection) searchSection.style.display = '';
  if ($('interview-type-section')) $('interview-type-section').style.display = 'none';
  if ($('interview-details')) $('interview-details').style.display = 'none';
  if ($('interview-selected')) $('interview-selected').style.display = 'none';
  if ($('interview-form')) $('interview-form').style.display = 'none';
  if ($('status-select')) $('status-select').value = '';
  if ($('interview-search')) $('interview-search').value = '';
  selectedRow = null;
}

// ── Stats ─────────────────────────────────────────────────────────────────────

async function saveGoal() {
  const goal      = parseInt($('cfg-daily-goal')?.value) || 0;
  const reminders = $('cfg-reminders')?.checked || false;
  await chrome.storage.local.set({ goalSettings: { goal, reminders } });
  if (reminders) await scheduleSmartReminder();
  else await cancelSmartReminder();
  showStatus('goal-status-msg', 'success', '✅ Goal saved');
  await loadStats();
}

async function loadStats() {
  const cfg = await getConfig();

  const stored = await chrome.storage.local.get('goalSettings');
  const { goal = 0, reminders = false } = stored.goalSettings || {};
  if ($('cfg-daily-goal')) $('cfg-daily-goal').value = goal || '';
  if ($('cfg-reminders'))  $('cfg-reminders').checked = reminders;

  if (!cfg.sheetId) return;

  try {
    const token = await getToken();
    // Use FORMATTED_VALUE to get dates as strings not serial numbers
    const range = encodeURIComponent('Applications!A:A');
    const res   = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${cfg.sheetId}/values/${range}?valueRenderOption=FORMATTED_VALUE`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data  = await res.json();
    let rows = (data.values || []);

    // Skip header row
    if (rows.length > 0 && /date|applied/i.test(rows[0][0] || '')) rows = rows.slice(1);

    // Normalise each date to 'Mon D, YYYY' format for consistent matching
    const normaliseDate = str => {
      if (!str) return '';
      const d = new Date(str);
      if (!isNaN(d)) return d.toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' });
      return str.trim();
    };

    const today      = new Date().toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' });
    const normRows   = rows.map(r => normaliseDate(r[0])).filter(Boolean);
    const todayCount = normRows.filter(d => d === today).length;
    const totalCount = normRows.length;

    if ($('total-count')) $('total-count').textContent = totalCount;

    // Build day map
    const dayMap = {};
    normRows.forEach(d => { dayMap[d] = (dayMap[d] || 0) + 1; });

    // Calculate streak
    let streak = 0;
    const d = new Date();
    const todayHit = goal > 0 ? todayCount >= goal : todayCount > 0;
    if (!todayHit) d.setDate(d.getDate() - 1);
    for (let i = 0; i < 365; i++) {
      const label = d.toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' });
      const count = dayMap[label] || 0;
      if (goal > 0 ? count < goal : count === 0) break;
      streak++;
      d.setDate(d.getDate() - 1);
    }

    if ($('streak-count')) $('streak-count').textContent = streak;
    if ($('streak-emoji')) $('streak-emoji').textContent = streak >= 7 ? '🔥' : streak >= 3 ? '⚡' : '📋';
    if ($('streak-sub'))   $('streak-sub').textContent   = streak === 0
      ? 'Log applications daily to build your streak'
      : streak === 1 ? 'Keep it up — log again tomorrow!'
      : `${streak} days in a row — great work!`;

    const pct = goal > 0 ? Math.min(100, Math.round(todayCount / goal * 100)) : 0;
    if ($('goal-progress-bar'))    $('goal-progress-bar').style.width    = pct + '%';
    if ($('today-progress-label')) $('today-progress-label').textContent = `${todayCount} / ${goal || '?'}`;
    if ($('today-status-msg')) {
      $('today-status-msg').textContent = !goal
        ? 'Set a daily goal below to track progress'
        : todayCount >= goal
        ? `🎉 Goal reached! ${todayCount} logged today`
        : `${goal - todayCount} more to hit your goal today`;
    }

    buildWeekGrid(dayMap, goal);
  } catch {}
}

function buildWeekGrid(dayMap, goal) {
  const grid = $('week-grid');
  if (!grid) return;
  grid.innerHTML = '';
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const label = d.toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' });
    const count = dayMap[label] || 0;
    const hit   = goal > 0 ? count >= goal : count > 0;
    const isToday = i === 0;
    const cell  = document.createElement('div');
    cell.style.cssText = `flex:1;text-align:center;padding:6px 2px;border-radius:6px;
      background:${hit ? '#1a73e8' : isToday ? '#f0f4ff' : '#f5f5f5'};
      border:${isToday ? '1.5px solid #1a73e8' : '1px solid transparent'};`;
    cell.innerHTML = `
      <div style="font-size:10px;color:${hit ? '#fff' : '#888'};font-weight:500;">${days[d.getDay()]}</div>
      <div style="font-size:14px;font-weight:700;color:${hit ? '#fff' : '#bbb'};margin-top:2px;">${count}</div>`;
    grid.appendChild(cell);
  }
}

async function scheduleSmartReminder() {
  if (!chrome.alarms) return;
  const cfg = await getConfig();
  if (!cfg.sheetId) return;
  try {
    const token = await getToken();
    const res   = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${cfg.sheetId}/values/${encodeURIComponent('Applications!B:B')}?valueRenderOption=FORMATTED_VALUE`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data  = await res.json();
    const times = (data.values || []).slice(1).map(r => r[0]).filter(Boolean);

    let targetHour = 20; // default 8 PM if no history
    const hours = times.map(t => {
      const m = String(t).match(/(\d+):(\d+)\s*(AM|PM)/i);
      if (!m) return null;
      let h = parseInt(m[1]);
      if (m[3].toUpperCase() === 'PM' && h !== 12) h += 12;
      if (m[3].toUpperCase() === 'AM' && h === 12) h = 0;
      return h + parseInt(m[2]) / 60;
    }).filter(h => h !== null);

    if (hours.length) {
      targetHour = Math.round(hours.reduce((a, b) => a + b, 0) / hours.length);
    }

    const when = (() => {
      const n = new Date();
      n.setHours(targetHour, 0, 0, 0);
      if (n <= new Date()) n.setDate(n.getDate() + 1);
      return n.getTime();
    })();

    // Only replace the jobReminder alarm — leave ghostCheck and interview reminders intact
    chrome.alarms.clear('jobReminder', () => {
      chrome.alarms.create('jobReminder', { when, periodInMinutes: 24 * 60 });
    });
  } catch { /* silent */ }
}

async function cancelSmartReminder() {
  if (chrome.alarms) chrome.alarms.clear('jobReminder');
}

async function saveProfile() {
  const cfg = await getConfig();
  cfg.name     = $('cfg-name')?.value.trim()     || '';
  cfg.email    = $('cfg-email')?.value.trim()    || '';
  cfg.phone    = $('cfg-phone')?.value.trim()    || '';
  cfg.address  = $('cfg-address')?.value.trim()  || '';
  cfg.linkedin = $('cfg-linkedin')?.value.trim() || '';
  cfg.website  = $('cfg-website')?.value.trim()  || '';
  await chrome.storage.sync.set({ jobTrackerConfig: cfg });
  showStatus('profile-status', 'success', '✅ Profile saved');
}

// ── Interview reminders ───────────────────────────────────────────────────────

let reminderIdCounter = 0;

function addReminderRow(amount = 1, unit = 'hours before') {
  const list = $('reminders-list');
  if (!list) return;
  const id  = ++reminderIdCounter;
  const div = document.createElement('div');
  div.id    = `reminder-row-${id}`;
  div.style.cssText = 'display:flex; align-items:center; gap:8px; padding:8px 12px; background:#f8f9fa; border-radius:8px; margin-bottom:8px;';

  const amountSel = document.createElement('select');
  amountSel.id    = `r-amount-${id}`;
  amountSel.style.width = '70px';
  [15,30,1,2,6,12,24,48].forEach(v => {
    const o = document.createElement('option');
    o.value = v; o.textContent = v;
    if (String(v) === String(amount)) o.selected = true;
    amountSel.appendChild(o);
  });

  const unitSel = document.createElement('select');
  unitSel.id    = `r-unit-${id}`;
  unitSel.style.flex = '1';
  ['minutes before','hours before','days before'].forEach(u => {
    const o = document.createElement('option');
    o.value = u; o.textContent = u;
    if (u === unit) o.selected = true;
    unitSel.appendChild(o);
  });

  const removeBtn = document.createElement('button');
  removeBtn.textContent = '×';
  removeBtn.style.cssText = 'background:none; border:none; font-size:18px; color:#999; cursor:pointer; padding:0 4px; line-height:1;';
  removeBtn.addEventListener('click', () => div.remove());

  div.appendChild(amountSel);
  div.appendChild(unitSel);
  div.appendChild(removeBtn);
  list.appendChild(div);
}

function getReminders() {
  const list = $('reminders-list');
  if (!list) return [];
  return [...list.querySelectorAll('[id^="reminder-row-"]')].map(row => {
    const id     = row.id.replace('reminder-row-', '');
    const amount = document.getElementById(`r-amount-${id}`)?.value;
    const unit   = document.getElementById(`r-unit-${id}`)?.value;
    return { amount, unit };
  }).filter(r => r.amount && r.unit);
}

function loadReminders(reminders) {
  const list = $('reminders-list');
  if (!list) return;
  list.innerHTML = '';
  reminderIdCounter = 0;
  if (!reminders || reminders.length === 0) {
    addReminderRow(1, 'days before');
    addReminderRow(1, 'hours before');
  } else {
    reminders.forEach(r => addReminderRow(r.amount, r.unit));
  }
}

async function savePreferences() {
  const weeks     = parseInt($('cfg-ghost-weeks')?.value) || 3;
  const reminders = getReminders();
  await chrome.storage.local.set({ ghostWeeks: weeks, interviewReminders: reminders });
  showStatus('preferences-status', 'success', '✅ Preferences saved');

  // Re-run ghost check immediately with new settings
  chrome.runtime.sendMessage({ action: 'runGhostCheck' });
}

async function saveSettings() {
  const cfg = {
    sheetId:  extractSheetId($('cfg-sheet-id')?.value)  || '',
    name:     $('cfg-name')?.value.trim()      || '',
    email:    $('cfg-email')?.value.trim()     || '',
    phone:    $('cfg-phone')?.value.trim()     || '',
    address:  $('cfg-address')?.value.trim()   || '',
    linkedin: $('cfg-linkedin')?.value.trim()  || '',
    website:  $('cfg-website')?.value.trim()   || ''
  };
  // Reflect the cleaned ID back into the field
  if ($('cfg-sheet-id')) $('cfg-sheet-id').value = cfg.sheetId;
  await chrome.storage.sync.set({ jobTrackerConfig: cfg });
  showStatus('settings-status', 'success', '✅ Settings saved');
}

// Accepts a full Google Sheets URL or a bare ID and returns just the ID
function extractSheetId(input) {
  if (!input) return '';
  const val = input.trim();
  // Full URL: https://docs.google.com/spreadsheets/d/<ID>/edit...
  const urlMatch = val.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (urlMatch) return urlMatch[1];
  // Otherwise assume it's already an ID — strip any stray slashes/spaces
  return val.replace(/[/\s]/g, '');
}

async function verifySheet() {
  const sheetId = extractSheetId($('cfg-sheet-id')?.value);
  if (!sheetId) {
    showStatus('settings-status', 'error', '⚠️ Enter a Sheet ID first');
    return;
  }
  // Reflect cleaned ID back
  if ($('cfg-sheet-id')) $('cfg-sheet-id').value = sheetId;

  $('btn-verify-sheet').disabled = true;
  const origLabel = $('btn-verify-sheet').textContent;
  $('btn-verify-sheet').innerHTML = '<span class="spinner"></span> Checking…';

  try {
    const token = await getToken();
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=properties.title,sheets.properties.title`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (res.status === 404) {
      showStatus('settings-status', 'error', '❌ Sheet not found — check the ID');
      return;
    }
    if (res.status === 403) {
      showStatus('settings-status', 'error', "❌ No access — make sure it's your sheet");
      return;
    }
    if (!res.ok) {
      const err = await res.json();
      showStatus('settings-status', 'error', `❌ ${err.error?.message || 'Could not open sheet'}`);
      return;
    }

    const data     = await res.json();
    const title    = data.properties?.title || 'Untitled';
    const tabs     = (data.sheets || []).map(s => s.properties.title);
    const required = ['Applications', 'Interviews', 'Offers'];
    const missing  = required.filter(t => !tabs.includes(t));

    // Persist the verified ID so logging uses the exact same one
    const cfg = await getConfig();
    cfg.sheetId = sheetId;
    await chrome.storage.sync.set({ jobTrackerConfig: cfg });

    if (missing.length === 0) {
      showStatus('settings-status', 'success', `✅ "${title}" — saved & verified, all tabs found`);
    } else {
      showStatus('settings-status', 'error', `⚠️ "${title}" saved but missing tab${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`);
    }
  } catch (err) {
    showStatus('settings-status', 'error', `❌ ${err.message}`);
  } finally {
    $('btn-verify-sheet').disabled = false;
    $('btn-verify-sheet').textContent = origLabel;
  }
}

function getConfig() {
  return new Promise(resolve => {
    chrome.storage.sync.get('jobTrackerConfig', r => resolve(r.jobTrackerConfig || {}));
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function showStatus(id, type, message) {
  const el = $(id);
  el.className = `status-bar ${type}`;
  el.textContent = message;
}

function shortUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname + (u.pathname.length > 30 ? u.pathname.slice(0, 30) + '…' : u.pathname);
  } catch { return url; }
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}