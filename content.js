// content.js — runs on every page

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'detectJob') {
    // Retry for JS-rendered pages (Workday, SmartRecruiters etc.)
    detectWithRetry(6, 400).then(sendResponse);
    return true;
  }
  if (message.action === 'autofill') {
    autofillForm(message.profile).then(result => sendResponse(result));
    return true; // keep channel open for async
  }
  if (message.action === 'scrapeJob') {
    const doScrape = () => {
      const result = scrapeJobText();
      if (result) {
        // Store in local storage to avoid message channel size limits
        chrome.storage.local.set({ scrapedJobText: result });
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false });
      }
    };
    const quick = scrapeJobText();
    if (!quick) {
      setTimeout(doScrape, 1500);
    } else {
      chrome.storage.local.set({ scrapedJobText: quick });
      sendResponse({ ok: true });
    }
    return true;
  }
});

// ── Toast banner ──────────────────────────────────────────────────────────────
// Shown on high-confidence job pages so students don't forget to log the application.
// Auto-dismisses after 8 seconds. Uses a shadow DOM so page styles can't touch it.

const TOAST_KEY = 'jt_toasted_' + window.location.href;

function showJobToast(company, title) {
  // Don't show twice on the same page (e.g. if content script re-runs)
  if (sessionStorage.getItem(TOAST_KEY)) return;
  sessionStorage.setItem(TOAST_KEY, '1');

  const host = document.createElement('div');
  host.id = '__job-tracker-toast__';
  host.style.cssText = [
    'position:fixed', 'bottom:24px', 'right:24px', 'z-index:2147483647',
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
  ].join(';');

  const shadow = host.attachShadow({ mode: 'closed' });

  const label = company && title ? `${title} at ${company}`
              : company          ? company
              : title            ? title
              : 'a job posting';

  // Use constructable stylesheet to avoid CSP inline-style violations
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(`
    :host { all: initial; }
    .toast {
      display: flex; align-items: center; gap: 12px;
      background: #1a1a1a; color: #fff;
      padding: 13px 16px; border-radius: 10px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.35);
      min-width: 280px; max-width: 360px;
      animation: slideIn 0.3s cubic-bezier(0.34,1.56,0.64,1);
      cursor: default; user-select: none; position: relative;
    }
    .toast.hiding { animation: slideOut 0.25s ease forwards; }
    @keyframes slideIn {
      from { opacity:0; transform:translateY(16px) scale(0.96); }
      to   { opacity:1; transform:translateY(0) scale(1); }
    }
    @keyframes slideOut {
      from { opacity:1; transform:translateY(0) scale(1); }
      to   { opacity:0; transform:translateY(12px) scale(0.95); }
    }
    .icon { font-size: 20px; flex-shrink: 0; }
    .body { flex: 1; min-width: 0; }
    .title { font-size: 13px; font-weight: 600; line-height: 1.3; }
    .sub { font-size: 11px; color: #aaa; margin-top: 2px;
           white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .close {
      background: none; border: none; color: #888; font-size: 18px;
      cursor: pointer; padding: 0 2px; line-height: 1; flex-shrink: 0;
    }
    .close:hover { color: #fff; }
    .progress {
      position: absolute; bottom: 0; left: 0; height: 3px;
      background: #1a73e8; border-radius: 0 0 10px 10px;
      animation: shrink 8s linear forwards; width: 100%;
    }
    @keyframes shrink { from { width:100%; } to { width:0%; } }
  `);
  shadow.adoptedStyleSheets = [sheet];

  // Build DOM elements directly instead of via innerHTML
  const toast    = document.createElement('div');
  toast.className = 'toast';
  toast.setAttribute('role', 'alert');

  const icon = document.createElement('span');
  icon.className = 'icon';
  icon.textContent = '💼';

  const body = document.createElement('div');
  body.className = 'body';

  const titleEl = document.createElement('div');
  titleEl.className = 'title';
  titleEl.textContent = "Don't forget to log this application!";

  const sub = document.createElement('div');
  sub.className = 'sub';
  sub.title = label;
  sub.textContent = label;

  const closeBtn = document.createElement('button');
  closeBtn.className = 'close';
  closeBtn.setAttribute('aria-label', 'Dismiss');
  closeBtn.textContent = '×';

  const progress = document.createElement('div');
  progress.className = 'progress';

  body.appendChild(titleEl);
  body.appendChild(sub);
  toast.appendChild(icon);
  toast.appendChild(body);
  toast.appendChild(closeBtn);
  toast.appendChild(progress);
  shadow.appendChild(toast);

  function dismiss() {
    toast.classList.add('hiding');
    setTimeout(() => host.remove(), 260);
  }

  closeBtn.addEventListener('click', dismiss);

  // Auto-dismiss after 8s
  const timer = setTimeout(dismiss, 8000);
  closeBtn.addEventListener('click', () => clearTimeout(timer));

  document.documentElement.appendChild(host);
}

// ── Run on page load ──────────────────────────────────────────────────────────
(function init() {
  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryShowToast);
  } else {
    // Larger delay for React/Vue pages like Workday
    setTimeout(tryShowToast, 1500);
  }
})();

async function tryShowToast() {
  const job = await detectWithRetry(10, 500); // up to 5s total for slow ATS
  if (job.confidence === 'high') {
    showJobToast(job.company, job.title);
  }
}

// ── Job detection ─────────────────────────────────────────────────────────────

// For most sites, detection is immediate. For JS-heavy ATS (Workday, SmartRecruiters)
// we retry a few times with short gaps, but always respond within ~2s.
async function detectWithRetry(maxAttempts, intervalMs) {
  // First attempt — immediate
  const first = detectJobInfo();
  if (first.confidence === 'high' && first.company && first.title) return first;

  // Only retry if we're on a known slow ATS
  const host = window.location.hostname;
  const isSlowAts = host.includes('myworkdayjobs.com') ||
                    host.includes('workday.com') ||
                    host.includes('smartrecruiters.com') ||
                    host.includes('cityjobs.nyc.gov') ||
                    host.includes('dayforcehcm.com') ||
                    host.includes('icims.com') ||
                    host.includes('taleo.net');
  if (!isSlowAts) return first;

  // Retry up to maxAttempts for slow ATS
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, intervalMs));
    const result = detectJobInfo();
    if (result.confidence === 'high' && result.company && result.title) return result;
  }
  return detectJobInfo();
}
function detectJobInfo() {
  const host = window.location.hostname;
  const path = window.location.pathname.toLowerCase();

  // Blocklist — pages that are never job postings
  const notJobPaths = /^\/(feed|messaging|notifications|mynetwork|search|in\/|company\/(?!.*\/jobs)|groups|events|learning|school|newsletter)\/?$/;
  if (notJobPaths.test(path)) return { confidence: 'none' };

  // Site-specific extractors for major job boards
  const extractors = {
    'linkedin.com':        extractLinkedIn,
    'indeed.com':          extractIndeed,
    'glassdoor.com':       extractGlassdoor,
    'lever.co':            extractLever,
    'greenhouse.io':       extractGreenhouse,
    'workday.com':         extractWorkday,
    'myworkdayjobs.com':   extractWorkday,
    'smartrecruiters.com': extractSmartRecruiters,
    'cityjobs.nyc.gov':    extractSmartRecruiters,
    'jobvite.com':         extractJobvite,
    'rippling.com':        extractRippling,
    'icims.com':           extractICIMS,
    'dayforcehcm.com':     extractGenericTitle,
    'ashbyhq.com':         extractGenericTitle,
    'recruitee.com':       extractGenericTitle,
  };

  for (const [domain, fn] of Object.entries(extractors)) {
    if (host.includes(domain)) {
      const result = fn();
      // For known ATS domains, trust the extractor even if only title found
      if (result.company || result.title) {
        return { ...result, confidence: 'high', canonicalUrl: getCanonicalUrl() };
      }
      // For Workday specifically — if we're on a /job/ path, mark as high confidence
      // even if title hasn't rendered yet — retry will pick it up
      if (domain.includes('workday') && /\/job\//.test(window.location.pathname)) {
        return { ...result, confidence: 'high', canonicalUrl: getCanonicalUrl() };
      }
    }
  }

  // Generic fallback — score the page to decide if it looks like a job posting
  const generic = extractGeneric();
  const confidence = scoreJobConfidence();
  return { ...generic, confidence, canonicalUrl: getCanonicalUrl() };
}

// Get the canonical URL of the page if available (og:url or <link rel="canonical">)
function getCanonicalUrl() {
  const og  = document.querySelector('meta[property="og:url"]')?.content;
  const rel = document.querySelector('link[rel="canonical"]')?.href;
  return og || rel || '';
}

// ── Job confidence scoring ────────────────────────────────────────────────────
function scoreJobConfidence() {
  let score = 0;

  // 1. JSON-LD JobPosting schema — very strong signal
  try {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const s of scripts) {
      const data = JSON.parse(s.textContent);
      const items = Array.isArray(data) ? data : [data];
      if (items.some(d => d['@type'] === 'JobPosting')) { score += 5; break; }
    }
  } catch {}

  // 2. URL path keywords
  const path = window.location.pathname.toLowerCase();
  if (/\/(jobs?|careers?|positions?|openings?|apply|job-posting|vacancies|jid-|requisition)/.test(path)) score += 3;

  // 3. Page contains an Apply button or form
  const bodyText = document.body.innerText.toLowerCase();
  if (/\bapply( now| for this (job|role|position))?\b/.test(bodyText)) score += 2;

  // 4. Job-specific vocabulary in body text
  const jobKeywords = [
    /\b(responsibilities|requirements|qualifications|minimum qualifications)\b/,
    /\b(salary|compensation|equity|benefits|salary range)\b/,
    /\b(full.?time|part.?time|contract|remote|hybrid|on.?site)\b/,
    /\b(years? of experience|bachelor'?s?|master'?s?|degree)\b/,
    /\b(job (description|type|id)|posting date|job level)\b/,
  ];
  for (const kw of jobKeywords) {
    if (kw.test(bodyText)) score += 1;
  }

  // 5. Meta description or og:title contains job signals
  const meta = (metaContent('og:description') + ' ' + metaContent('description')).toLowerCase();
  if (/\b(job|career|position|role|hiring|opportunity)\b/.test(meta)) score += 1;

  // 6. Page title pattern "Job Title | Company"
  if (/^[^|–—]+[|–—]/.test(document.title)) score += 1;

  if (score >= 5) return 'high';
  if (score >= 2) return 'low';
  return 'none';
}

function extractLinkedIn() {
  const path = window.location.pathname.toLowerCase();
  if (!/\/jobs\//.test(path)) return {};
  return {
    title:   text('h1.job-details-jobs-unified-top-card__job-title, h1[class*="job-title"]'),
    company: text('.job-details-jobs-unified-top-card__company-name a, a[class*="company-name"]')
  };
}

function extractIndeed() {
  return {
    title:   text('[data-testid="jobsearch-JobInfoHeader-title"], h1.jobsearch-JobInfoHeader-title'),
    company: text('[data-testid="inlineHeader-companyName"] a, .icl-u-lg-mr--sm a')
  };
}

function extractGlassdoor() {
  return {
    title:   text('[data-test="job-title"], .JobDetails_jobTitle__Rw_gn'),
    company: text('[data-test="employer-name"], .EmployerProfile_profileContainer__63nh7 h4')
  };
}

function extractLever() {
  return {
    title:   text('.posting-headline h2'),
    company: text('.main-header-logo img[alt]', 'alt') || domainToCompany()
  };
}

function extractGreenhouse() {
  const domTitle   = text('#header h1.app-title, .job__title h1, h1.job-title');
  const domCompany = text('.company-name, #header .company-name, .job-company-name');
  if (domTitle && domCompany) return { title: domTitle, company: domCompany };

  const pageTitle = document.title.trim();

  const appMatch = pageTitle.match(/^Job Application for (.+?) at (.+)$/i);
  if (appMatch) return { title: appMatch[1].trim(), company: appMatch[2].trim() };

  const pipeMatch = pageTitle.match(/^(.+?)\s*[|–—]\s*(.+)$/);
  if (pipeMatch) return { title: pipeMatch[1].trim(), company: pipeMatch[2].trim() };

  const slugMatch = window.location.pathname.match(/^\/([^/]+)\//);
  const company = slugMatch
    ? slugMatch[1].replace(/^jobsat/i, '').replace(/^jobsfor/i, '')
        .split(/(?=[A-Z])/).join(' ').trim() || slugMatch[1]
    : '';

  return {
    title:   text('h1') || cleanTitle(metaContent('og:title')),
    company: company || domainToCompany()
  };
}

function extractWorkday() {
  // Try og:title first — most reliable on modern Workday
  // Pattern: "Job Title | Company Careers" or "Job Title - Company"
  const ogTitle = metaContent('og:title');
  if (ogTitle) {
    const parts = ogTitle.split(/\s*[\|–—]\s*/);
    if (parts.length >= 2) {
      const rawCompany = parts[parts.length - 1].replace(/\s*careers?$/i, '').trim();
      return {
        title:   cleanTitle(parts[0].trim()),
        company: rawCompany || extractWorkdayCompanyFromSubdomain()
      };
    }
  }

  // Try document.title — same pattern
  const pageTitle = document.title.trim();
  if (pageTitle) {
    const parts = pageTitle.split(/\s*[\|–—]\s*/);
    if (parts.length >= 2) {
      const rawCompany = parts[parts.length - 1].replace(/\s*careers?$/i, '').trim();
      return {
        title:   cleanTitle(parts[0].trim()),
        company: rawCompany || extractWorkdayCompanyFromSubdomain()
      };
    }
  }

  // DOM fallbacks — Workday uses data-automation-id attributes
  const title =
    text('[data-automation-id="jobPostingHeader"]') ||
    text('[data-automation-id="Job_Posting_Header_JobTitle"]') ||
    text('h2[data-automation-id*="title"]') ||
    text('h1[data-automation-id*="title"]') ||
    text('.css-1q2dra3') ||
    text('h2.css-6tosjd');

  return {
    title:   title || '',
    company: text('[data-automation-id="legalEntityName"]') ||
             text('[data-automation-id="Company_Name"]') ||
             extractWorkdayCompanyFromSubdomain()
  };
}

function extractWorkdayCompanyFromSubdomain() {
  const sub = window.location.hostname.split('.')[0];
  return sub ? sub.charAt(0).toUpperCase() + sub.slice(1).replace(/-/g, ' ') : '';
}

function extractSmartRecruiters() {
  // Try JSON-LD first — most reliable
  const jsonLd = document.querySelector('script[type="application/ld+json"]');
  let company = '';
  let title   = '';
  if (jsonLd) {
    try {
      const data = JSON.parse(jsonLd.textContent);
      company = data?.hiringOrganization?.name || '';
      title   = data?.title || '';
    } catch {}
  }

  // Try og:title — usually "Job Title - Company Name" or "Job Title | Company"
  if (!title) {
    const ogTitle = metaContent('og:title');
    if (ogTitle) {
      const parts = ogTitle.split(/\s*[-|–—]\s*/);
      if (parts.length >= 2) {
        title   = title   || parts[0].trim();
        company = company || parts[parts.length - 1].trim();
      }
    }
  }

  // Try document.title — same pattern
  if (!title) {
    const pageTitle = document.title.trim();
    const parts = pageTitle.split(/\s*[-|–—]\s*/);
    if (parts.length >= 2) {
      title   = title   || parts[0].trim();
      company = company || parts[parts.length - 1].trim();
    } else if (pageTitle) {
      title = pageTitle;
    }
  }

  // DOM fallbacks — only use h1 if it's short enough to be a title
  if (!title) {
    const h1El = document.querySelector('h1[class*="job-title"], h1[class*="jobTitle"], .job-title h1, [data-ui="job-header-title"] h1');
    if (h1El) title = h1El.textContent.trim();
  }
  if (!title) {
    const h1El = document.querySelector('h1');
    const h1Text = h1El?.textContent.trim() || '';
    if (h1Text.length > 0 && h1Text.length < 120 && !h1Text.includes('<') && !h1Text.includes('{')) {
      title = h1Text;
    }
  }

  if (!company) company = text('.hiring-company-name, [itemprop="hiringOrganization"] [itemprop="name"], [class*="company-name"]');
  if (!company) company = domainToCompany();

  return { title: cleanTitle(title), company };
}

function extractJobvite() {
  return {
    title:   text('.jv-header h2, h1.jv-job-title'),
    company: text('.jv-company-name') || domainToCompany()
  };
}

function extractICIMS() {
  const domTitle   = text('h1.iCIMS_JobTitle, h1[class*="job-title"], .iCIMS_Header h1');
  const domCompany = text('.iCIMS_LogoImg img', 'alt') || text('[class*="company-name"]');
  if (domTitle && domCompany) return { title: domTitle, company: domCompany };

  const ogTitle = metaContent('og:title') || document.title;

  const careersMatch = ogTitle.match(/^(.+?)\s*\|\s*Careers at (.+)$/i);
  if (careersMatch) {
    const title   = careersMatch[1].replace(/\s+in\s+[^|]+$/i, '').trim();
    const company = careersMatch[2].trim();
    return { title, company };
  }

  const compCareersMatch = ogTitle.match(/^(.+?)\s*\|\s*(.+?)\s+Careers$/i);
  if (compCareersMatch) {
    return { title: compCareersMatch[1].trim(), company: compCareersMatch[2].trim() };
  }

  const pipeMatch = ogTitle.match(/^(.+?)\s*\|\s*(.+)$/);
  if (pipeMatch) return { title: pipeMatch[1].trim(), company: pipeMatch[2].trim() };

  const subMatch = window.location.hostname.match(/^(?:careers[-.])?(.+?)\.icims\.com$/i);
  const company  = subMatch
    ? subMatch[1].split(/[-.]/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('')
    : '';

  return { title: cleanTitle(ogTitle), company };
}

function extractRippling() {
  const title = text('h2, h1') || cleanTitle(metaContent('og:title'));

  const companyFromPage = text('[class*="company"], [class*="org-name"], [class*="employer"]');
  if (companyFromPage) return { title, company: companyFromPage };

  const slugMatch = window.location.pathname.match(/^\/([^/]+)\//);
  if (slugMatch) {
    const company = slugMatch[1]
      .replace(/-open-positions$/i, '')
      .replace(/-jobs$/i, '')
      .replace(/-careers$/i, '')
      .split('-')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join('');
    return { title, company };
  }

  return { title, company: '' };
}

function extractGenericTitle() {
  const pageTitle = metaContent('og:title') || document.title.trim();
  const parts = pageTitle.split(/\s*[-|–—]\s*/);
  return {
    title:   cleanTitle(parts[0] || pageTitle),
    company: parts.length >= 2 ? parts[parts.length - 1].trim() : domainToCompany()
  };
}

function extractGeneric() {
  const jsonLd = extractJsonLd();
  if (jsonLd.title) return jsonLd;

  // Try og:title first — most reliable
  const ogTitle = metaContent('og:title') || metaContent('twitter:title');
  if (ogTitle) {
    const siteName = metaContent('og:site_name');
    const company = text('[class*="company"],[id*="company"],[class*="employer"],[class*="agency"]')
      || siteName || domainToCompany();
    return { title: cleanTitle(ogTitle), company };
  }

  // Try h1 but only use it if it's short enough to be a title (not a paragraph)
  const h1El = document.querySelector('h1');
  const h1Text = h1El ? h1El.textContent.trim() : '';
  const title = h1Text.length > 0 && h1Text.length < 150 ? cleanTitle(h1Text) : cleanTitle(document.title);

  const siteName = metaContent('og:site_name');
  const company = text('[class*="company"],[id*="company"],[class*="employer"],[class*="agency"]')
    || siteName || domainToCompany();

  return { title: cleanTitle(title), company };
}

function extractJsonLd() {
  try {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const s of scripts) {
      const data = JSON.parse(s.textContent);
      const job  = Array.isArray(data) ? data.find(d => d['@type'] === 'JobPosting') : data;
      if (job && job['@type'] === 'JobPosting') {
        return {
          title:   job.title || '',
          company: job.hiringOrganization?.name || ''
        };
      }
    }
  } catch {}
  return {};
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function text(selector, attr) {
  const el = document.querySelector(selector);
  if (!el) return '';
  return (attr ? el.getAttribute(attr) : el.textContent).trim();
}

function metaContent(property) {
  const el = document.querySelector(`meta[property="${property}"], meta[name="${property}"]`);
  return el ? el.getAttribute('content')?.trim() : '';
}

function domainToCompany() {
  const host = window.location.hostname.replace(/^www\./, '');
  const base = host.split('.')[0];
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function cleanTitle(raw) {
  if (!raw) return '';
  // Strip everything after pipe, dash, or em-dash
  let clean = raw.replace(/[\|\-–—].*$/, '').trim();
  // Strip script/cookie noise — if it contains < or { it's not a title
  if (clean.includes('<') || clean.includes('{') || clean.length > 150) {
    // Fall back to just the first sentence-like chunk
    clean = clean.split(/[.<>{}]/)[0].trim();
  }
  return clean.length > 150 ? clean.substring(0, 150) : clean;
}

// ── Autofill ──────────────────────────────────────────────────────────────────
async function autofillForm(profile) {
  const fieldMap = [
    { keys: ['first.?name','given.?name','\\bfname\\b','forename','preferred.?name','preferred.?first'],  value: firstName(profile.name) },
    { keys: ['last.?name','surname','family.?name','\\blname\\b'],                                         value: lastName(profile.name) },
    { keys: ['\\bfull.?name\\b','\\byour.?name\\b'],                                                       value: profile.name },
    { keys: ['email','e.mail','email.?address'],                                                            value: profile.email },
    { keys: ['phone','mobile','\\btel\\b','\\bcell\\b','contact.?number'],                                  value: profile.phone },
    { keys: ['\\baddress\\b','street','city'],                                                              value: profile.address },
    { keys: ['linkedin'],                                                                                    value: profile.linkedin },
    { keys: ['\\bwebsite\\b','portfolio','personal.?url','\\bgithub\\b','\\burl\\b'],                       value: profile.website },
  ];

  let filled = 0;

  // Try main document first, then look inside iframes (many ATS embed forms in iframes)
  const docs = [document];
  document.querySelectorAll('iframe').forEach(iframe => {
    try { if (iframe.contentDocument) docs.push(iframe.contentDocument); } catch {}
  });

  for (const doc of docs) {
    // Only fill visible text inputs — skip hidden/offscreen ones to avoid false positives
    const inputs = Array.from(doc.querySelectorAll(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]), textarea'
    )).filter(el => {
      const s = getComputedStyle(el);
      return s.display !== 'none' && s.visibility !== 'hidden' && el.offsetParent !== null;
    });

    for (const input of inputs) {
      const labelText   = labelFor(input);
      const ariaLabel   = input.getAttribute('aria-label') || '';
      const ariaLabelBy = input.getAttribute('aria-labelledby')
        ? (doc.getElementById(input.getAttribute('aria-labelledby'))?.textContent || '')
        : '';
      const placeholder  = input.placeholder || '';
      const name         = input.name  || '';
      const id           = input.id    || '';
      const autoComplete = input.getAttribute('autocomplete') || '';
      const dataField    = input.getAttribute('data-field') || '';
      const automationId = input.getAttribute('data-automation-id') || '';
      const dataTest     = input.getAttribute('data-test') || '';
      const dataName     = input.getAttribute('data-field-name') || '';
      const groupLabel   = input.closest('[role="group"]')?.querySelector('legend, label')?.textContent || '';
      const formLabel    = input.closest('.form-field, .form-group, .field-wrapper, [class*="FormField"]')
        ?.querySelector('label, .label, [class*="label"]')?.textContent || '';

      const hint = [labelText, ariaLabel, ariaLabelBy, placeholder, name, id,
                    autoComplete, dataField, automationId, dataTest, dataName, groupLabel, formLabel]
        .join(' ').toLowerCase().replace(/[*#!?:()\[\]]/g, '').trim();

      for (const { keys, value } of fieldMap) {
        if (!value) continue;
        if (new RegExp(keys.join('|'), 'i').test(hint)) {
          if (input.value !== value) {
            reactFill(input, value);
            filled++;
          }
          break;
        }
      }
    }
  }

  // Resume file injection — only count if a visible, relevant file input is found
  if (profile.resumeDataUrl && profile.resumeName) {
    const file     = dataUrlToFile(profile.resumeDataUrl, profile.resumeName);
    const injected = injectResumeFile(file);
    if (injected) filled++;
  }

  return { filled };
}

// Fill a field in a way that React, Vue, and Angular all recognise
function reactFill(el, value) {
  // 1. Set via native descriptor (bypasses React's controlled input guard)
  const proto     = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
  descriptor?.set?.call(el, value);

  // 2. Fire all events React/Vue/Angular listen to
  el.dispatchEvent(new Event('input',  { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(new KeyboardEvent('keydown',  { bubbles: true }));
  el.dispatchEvent(new KeyboardEvent('keypress', { bubbles: true }));
  el.dispatchEvent(new KeyboardEvent('keyup',    { bubbles: true }));
  el.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
  el.dispatchEvent(new FocusEvent('blur',  { bubbles: true }));

  // 3. Workday-specific: trigger React's internal onChange
  const reactKey = Object.keys(el).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
  if (reactKey) {
    const fiber = el[reactKey];
    const onChange = fiber?.memoizedProps?.onChange || fiber?.stateNode?.props?.onChange;
    if (typeof onChange === 'function') {
      onChange({ target: el, currentTarget: el, bubbles: true });
    }
  }
}

function injectResumeFile(file) {
  const allFileInputs = Array.from(document.querySelectorAll('input[type="file"]'));

  const scored = allFileInputs.map(input => {
    const hint = [
      input.name, input.id,
      input.getAttribute('aria-label'),
      input.getAttribute('accept'),
      labelFor(input),
      input.closest('[class]')?.className || ''
    ].join(' ').toLowerCase().replace(/[*#!?:]/g, '');

    let score = 0;
    if (/resume|cv|curriculum/.test(hint)) score += 10;
    if (/cover.?letter/.test(hint)) score -= 5;
    if (/\.pdf|\.doc/.test(hint)) score += 2;
    // Require the input or its container to be in the visible DOM
    const container = input.closest('[class*="upload"], [class*="drop"], [class*="attach"]') || input.parentElement;
    const isVisible = container && getComputedStyle(container).display !== 'none';
    if (!isVisible && score < 10) score = -1; // hidden with no resume hint = skip
    return { input, score, container };
  }).filter(s => s.score >= 0).sort((a, b) => b.score - a.score);

  if (scored.length === 0) return false;

  const target = scored[0].input;

  try {
    const dt = new DataTransfer();
    dt.items.add(file);
    target.files = dt.files;
    target.dispatchEvent(new Event('input',  { bubbles: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
  } catch {}

  const dropZone = target.closest('[class*="upload"], [class*="drop"], [class*="attach"]')
                || target.parentElement;
  if (dropZone) {
    try {
      const dt = new DataTransfer();
      dt.items.add(file);
      const dropEvent = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt });
      dropZone.dispatchEvent(dropEvent);
    } catch {}
  }

  if (getComputedStyle(target).display === 'none' || target.offsetParent === null) {
    highlightUploadZone(dropZone || target.parentElement);
    return true;
  }

  return true;
}

function highlightUploadZone(el) {
  if (!el) return;
  const prev = el.style.cssText;
  el.style.outline = '3px solid #1a73e8';
  el.style.borderRadius = '4px';
  el.style.transition = 'outline 0.3s';
  setTimeout(() => { el.style.cssText = prev; }, 3000);
}

function dataUrlToFile(dataUrl, filename) {
  const [header, base64] = dataUrl.split(',');
  const mime = header.match(/:(.*?);/)[1];
  const bytes = atob(base64);
  const arr   = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new File([arr], filename, { type: mime });
}

function labelFor(input) {
  // Standard label[for] association
  if (input.id) {
    const label = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
    if (label) return label.textContent.trim();
  }

  // Input wrapped inside a label
  const parentLabel = input.closest('label');
  if (parentLabel) return parentLabel.textContent.trim();

  // SmartRecruiters: data-test attribute on wrapper
  const dataTest = input.closest('[data-test]')?.getAttribute('data-test') || '';
  if (dataTest) return dataTest.replace(/-/g, ' ');

  // Preceding sibling label or div with label-like class
  const prev = input.previousElementSibling;
  if (prev && /label|title|heading/i.test(prev.className + prev.tagName)) {
    return prev.textContent.trim();
  }

  // Parent container label
  const container = input.closest('.form-group, .field, [class*="field"], [class*="input"]');
  if (container) {
    const lbl = container.querySelector('label, .label, [class*="label"]');
    if (lbl) return lbl.textContent.trim();
  }

  return '';
}

function firstName(name) { return name ? name.split(' ')[0] : ''; }
function lastName(name)  { return name ? name.split(' ').slice(1).join(' ') : ''; }

// ── Job text scraper ──────────────────────────────────────────────────────────
// Returns a single clean line of text from the page, suitable for a sheet cell.

function scrapeJobText() {
  // Detect application form pages — these have no job description to scrape
  const path = window.location.pathname.toLowerCase();
  // Only treat explicit apply paths as apply pages (not "application" which appears in job text)
  const isApplyPage = /\/(apply|applymanually|create-account|sign-in|login|register)(\/|$)/.test(path);
  if (isApplyPage) return null;

  // Try known job-description containers first (more accurate than whole body)
  const contentSelectors = [
    '#content',                       // Greenhouse
    '.job__description', '.job-post', // Greenhouse variants
    '[class*="job-description"]',
    '[class*="jobDescription"]',
    '[data-automation-id="jobPostingDescription"]', // Workday
    '.posting-page', '.section-wrapper', // Lever
    'main', 'article'
  ];

  let raw = '';
  for (const sel of contentSelectors) {
    const el = document.querySelector(sel);
    if (el && el.innerText && el.innerText.replace(/\s/g, '').length > 200) {
      raw = el.innerText;
      break;
    }
  }

  // Fallback to body if no container matched
  if (!raw) {
    const SKIP_TAGS = new Set(['script','style','noscript','nav','footer','header','aside','iframe']);
    const extractText = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const s = node.textContent.trim();
        return s ? s + ' ' : '';
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return '';
      if (SKIP_TAGS.has(node.tagName.toLowerCase())) return '';
      let out = '';
      for (const child of node.childNodes) out += extractText(child);
      return out;
    };
    raw = extractText(document.body);
    if (raw.replace(/\s/g, '').length < 200) raw = document.body.innerText || '';
  }

  const cleaned = raw.replace(/\s+/g, ' ').trim();
  if (!cleaned || cleaned.length < 50) return null;
  return cleaned;
}