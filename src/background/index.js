// background.js — service worker

chrome.alarms?.onAlarm.addListener(async alarm => {
  if (alarm.name === 'jobReminder') {
    const stored = await chrome.storage.local.get('goalSettings');
    const goal   = stored.goalSettings?.goal || 1;
    const today  = new Date().toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' });
    const logged = await chrome.storage.local.get('todayCount');
    const count  = logged.todayCount?.date === today ? logged.todayCount.count : 0;
    if (count < goal) {
      chrome.notifications.create({
        type: 'basic', iconUrl: 'icons/icon128.png',
        title: 'Job Tracker Reminder',
        message: `You've logged ${count}/${goal} applications today. Keep going!`
      });
    }
  }

  if (alarm.name === 'ghostCheck') {
    await runGhostCheck();
  }

  if (alarm.name.startsWith('interviewReminder-')) {
    const stored = await chrome.storage.local.get(alarm.name);
    const data   = stored[alarm.name] || {};
    const company = data.company || '';
    const role    = data.role    || '';
    const label   = data.label   || 'Reminder';
    chrome.notifications.create({
      type: 'basic', iconUrl: 'icons/icon128.png',
      title: '📅 Interview reminder',
      message: `${label} — ${company}${role ? ': ' + role : ''}`
    });
    // Clean up storage
    chrome.storage.local.remove(alarm.name);
  }
});

// Run ghost check once a day — only create if not already scheduled
chrome.alarms?.get('ghostCheck', existing => {
  if (!existing) {
    chrome.alarms?.create('ghostCheck', { periodInMinutes: 24 * 60 });
  }
});

// Also run immediately on startup in case the alarm was missed
runGhostCheck();

async function runGhostCheck() {
  try {
    const local  = await chrome.storage.local.get(['googleAuth', 'ghostWeeks']);
    const sync   = await chrome.storage.sync.get('jobTrackerConfig');
    const token  = local.googleAuth?.token;
    if (!token) return;

    const cfg   = sync.jobTrackerConfig || {};
    if (!cfg.sheetId) return;

    const weeks  = local.ghostWeeks || 3;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - weeks * 7);

    // Use FORMATTED_VALUE to get readable dates instead of serial numbers
    const res  = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${cfg.sheetId}/values/${encodeURIComponent('Applications!A:J')}?valueRenderOption=FORMATTED_VALUE`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) return;
    const data = await res.json();
    const rows = data.values || [];
    if (!rows.length) return;

    const header    = rows[0];
    const statusIdx = header.findIndex(h => /\bstatus\b/i.test(h));
    const dateIdx   = header.findIndex(h => /date/i.test(h));
    if (statusIdx < 0 || dateIdx < 0) return;

    const colLetter = String.fromCharCode(65 + statusIdx);
    const updates   = [];

    rows.forEach((row, i) => {
      if (i === 0) return;
      const status = (row[statusIdx] || '').trim();
      if (status !== '❓ No Reply') return;

      const dateStr = row[dateIdx];
      if (!dateStr) return;

      // Parse formatted date string e.g. "May 25, 2026" or "5/25/2026"
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return;

      if (date < cutoff) {
        updates.push({ row: i + 1, col: colLetter });
      }
    });

    for (const u of updates) {
      await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${cfg.sheetId}/values/${encodeURIComponent(`Applications!${u.col}${u.row}`)}?valueInputOption=USER_ENTERED`,
        {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ values: [['👻 Ghosted']] })
        }
      );
    }

    if (updates.length > 0) {
      chrome.notifications.create({
        type: 'basic', iconUrl: 'icons/icon128.png',
        title: 'Job Tracker',
        message: `${updates.length} application${updates.length > 1 ? 's' : ''} marked as 👻 Ghosted after ${weeks} weeks with no reply.`
      });
    }
  } catch { /* silent */ }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'startAuthFlow') {
    // Fire-and-forget: run the full auth flow in the service worker.
    // The popup may close while the OAuth window is open — that's fine.
    // Result is written to chrome.storage.local so the popup picks it up on next open.
    runAuthFlow(message.clientId, message.redirectUrl);
    sendResponse({ ok: true });
    return false;
  }
  if (message.action === 'runGhostCheck') {
    runGhostCheck();
    sendResponse({ ok: true });
    return true;
  }
  if (message.action === 'fetchPageText') {
    fetchAndExtractText(message.url)
      .then(text => sendResponse({ text }))
      .catch(() => sendResponse({ text: '' }));
    return true;
  }
  if (message.action === 'saveJobState') {
    // Content script sends job state to persist before popup closes
    chrome.storage.local.set({
      lastDetectedJob: message.job,
      lastStep:        message.step || 1
    });
    sendResponse({ ok: true });
    return true;
  }
});

// ── Fetch page text ───────────────────────────────────────────────────────────
async function fetchAndExtractText(url) {
  const res  = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; job-tracker/1.0)' }
  });
  const html = await res.text();
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#?\w+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Google auth flow (runs entirely in service worker) ────────────────────────
async function runAuthFlow(clientId, redirectUrl) {
  try {
    const authUrl = new URL('https://accounts.google.com/o/oauth2/auth');
    authUrl.searchParams.set('client_id',     clientId);
    authUrl.searchParams.set('response_type', 'token');
    authUrl.searchParams.set('redirect_uri',  redirectUrl);
    authUrl.searchParams.set('scope',         'https://www.googleapis.com/auth/spreadsheets email profile');

    const responseUrl = await new Promise((resolve, reject) => {
      chrome.identity.launchWebAuthFlow({ url: authUrl.toString(), interactive: true }, url => {
        if (chrome.runtime.lastError || !url) {
          reject(new Error(chrome.runtime.lastError?.message || 'Sign-in cancelled'));
        } else {
          resolve(url);
        }
      });
    });

    const token = new URLSearchParams(new URL(responseUrl).hash.slice(1)).get('access_token');
    if (!token) throw new Error('No token in response');

    const res   = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${token}` }
    });
    const info  = await res.json();
    const email = info.email || 'Connected';

    await chrome.storage.local.set({
      googleAuth:     { token, email, issuedAt: Date.now() },
      googleEmail:    email,
      authFlowResult: { success: true, email }
    });
  } catch (err) {
    await chrome.storage.local.set({
      authFlowResult: { success: false, error: err.message }
    });
  }
}

// ── Badge + auto-save state on navigation ─────────────────────────────────────
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  if (!tab.url?.startsWith('http')) return;

  chrome.action.setBadgeText({ tabId, text: '' });

  const u = new URL(tab.url);
  const isApplyDomain = u.hostname.includes('jobs.smartrecruiters.com') ||
                        (u.hostname.includes('myworkdayjobs.com') && u.pathname.includes('/apply')) ||
                        u.hostname.includes('apply.workable.com') ||
                        (u.hostname.includes('greenhouse.io') && (u.pathname.includes('/application') || u.pathname.includes('/apply'))) ||
                        (u.hostname.includes('dayforcehcm.com') && u.pathname.includes('/apply')) ||
                        (u.hostname.includes('ashbyhq.com') && u.pathname.includes('/application')) ||
                        (u.hostname.includes('recruitee.com') && u.pathname.includes('/apply'));
  const isApplyPath   = /\/(apply|applymanually|create-account|sign-in|register)(\/|$)/i.test(u.pathname);
  const isApplyPage   = isApplyDomain || isApplyPath;

  const saved = await chrome.storage.local.get(['lastDetectedJob', 'lastStep']);

  if (isApplyPage && saved.lastDetectedJob) {
    // Only bump to step 2 if on an explicit apply page
    if (!saved.lastStep || saved.lastStep === 1) {
      await chrome.storage.local.set({ lastStep: 2 });
    }
    chrome.action.setBadgeText({ tabId, text: '!' });
    chrome.action.setBadgeBackgroundColor({ tabId, color: '#1a73e8' });
    chrome.action.setTitle({ tabId, title: 'Job Tracker — Click to continue logging this job' });
    return;
  }

  setTimeout(() => checkAndBadge(tabId), 800);
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url?.startsWith('http')) {
    chrome.action.setBadgeText({ tabId, text: '' });
    return;
  }

  // If student switches tabs and hasn't progressed past step 1, clear saved state
  // They're likely looking at a new job, not continuing the application
  const saved = await chrome.storage.local.get('lastStep');
  if (!saved.lastStep || saved.lastStep <= 1) {
    await chrome.storage.local.remove(['lastDetectedJob', 'lastStep', 'lastJobText']);
  }
});

async function checkAndBadge(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { action: 'detectJob' });
    if (response?.confidence === 'high') {
      if (response.company || response.title) {
        const tab = await chrome.tabs.get(tabId);
        const jobUrl = response.canonicalUrl || tab.url;

        // Always update saved job for the current page
        await chrome.storage.local.set({
          lastDetectedJob: {
            company: response.company || '',
            title:   response.title   || '',
            url:     jobUrl
          },
          lastStep: 1  // reset to step 1 for new job
        });

        // Scrape and cache job text in background
        await chrome.storage.local.remove(['lastJobText', 'scrapedJobText']);
        try {
          try { await chrome.tabs.sendMessage(tabId, { action: 'scrapeJob' }); } catch { return; }
          // Wait for content script to write to storage
          await new Promise(r => setTimeout(r, 1500));
          const scraped = await chrome.storage.local.get('scrapedJobText');
          if (scraped.scrapedJobText) {
            await chrome.storage.local.set({ lastJobText: scraped.scrapedJobText });
          }
        } catch { /* scrape failed silently */ }
      }

      chrome.action.setBadgeText({ tabId, text: '!' });
      chrome.action.setBadgeBackgroundColor({ tabId, color: '#34a853' });
      chrome.action.setTitle({ tabId, title: 'Job Tracker — Job detected! Click to log.' });
    } else if (response?.confidence === 'low') {
      chrome.action.setBadgeText({ tabId, text: '?' });
      chrome.action.setBadgeBackgroundColor({ tabId, color: '#fbbc04' });
      chrome.action.setTitle({ tabId, title: 'Job Tracker — Possible job posting detected.' });
    } else {
      chrome.action.setBadgeText({ tabId, text: '' });
      chrome.action.setTitle({ tabId, title: 'Job Tracker' });
    }
  } catch {
    // Content script not reachable — ignore
  }
}