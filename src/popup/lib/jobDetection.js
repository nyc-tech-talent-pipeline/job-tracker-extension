import { cleanJobUrl, detectPageType } from './jobUrl.js';

export async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// Mirrors popup.js detectCurrentJob()'s core detection branch (minus UI side effects).
// Returns a discriminated result describing what was found so the caller can update state.
export async function detectJobOnActiveTab() {
  const tab = await getActiveTab();
  const pageType = detectPageType(tab.url);

  if (pageType === 'apply') {
    return { tab, pageType, kind: 'apply-page' };
  }

  const url = cleanJobUrl(tab.url);

  let response;
  try {
    response = await chrome.tabs.sendMessage(tab.id, { action: 'detectJob' });
  } catch {
    return { tab, pageType, kind: 'not-a-job', url };
  }

  if (!response || response.confidence === 'none') {
    return { tab, pageType, kind: 'not-a-job', url };
  }

  return {
    tab,
    pageType,
    kind: 'detected',
    confidence: response.confidence,
    company: response.company || '',
    title: response.title || '',
    // Use canonical URL if the page provides one (e.g. cityjobs.nyc.gov via SmartRecruiters)
    url: response.canonicalUrl || url
  };
}

// Scrape and cache job text right after detection so it's ready even if the
// student navigates away before logging. Returns the scraped text, or ''.
export async function scrapeAndCacheJobText(tabId) {
  await chrome.storage.local.remove('lastJobText');
  try {
    try { await chrome.tabs.sendMessage(tabId, { action: 'scrapeJob' }); } catch { /* tab closed */ }
    await new Promise(r => setTimeout(r, 1200));
    const s = await chrome.storage.local.get('scrapedJobText');
    if (s.scrapedJobText) {
      await chrome.storage.local.set({ lastJobText: s.scrapedJobText });
      return s.scrapedJobText;
    }
  } catch { /* scrape failed silently */ }
  return '';
}

// Injected into the target page — runs in page context, returns the job text.
// Must be fully self-contained (chrome.scripting.executeScript serializes it).
function scrapePageContentInjected() {
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

// Scrape job text from current tab for inline use during logging.
export async function scrapeCurrentPage() {
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
      if (hits < 2) return cached.lastJobText;
      await chrome.storage.local.remove('lastJobText');
    }

    const tab = await getActiveTab();
    if (!tab?.id) return cached.lastJobText || '';

    if (!chrome.scripting) {
      return cached.lastJobText || '';
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: scrapePageContentInjected
    });

    const text = results?.[0]?.result || '';
    return text || cached.lastJobText || '';
  } catch {
    const cached = await chrome.storage.local.get('lastJobText');
    return cached.lastJobText || '';
  }
}
