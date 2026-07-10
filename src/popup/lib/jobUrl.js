// Strips apply paths, tracking params, and redirects so the saved URL
// points to the job posting itself, not the application form.
export function cleanJobUrl(raw) {
  try {
    const u = new URL(raw);

    u.pathname = u.pathname
      .replace(/\/apply(\/[^/]*)?$/i, '')
      .replace(/\/application\/?$/i, '')
      .replace(/\/submit\/?$/i, '')
      .replace(/\/$/, '');

    const tracking = [
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
      'src', 'source', 'ref', 'referrer', 'redirect', 'sid', 'gh_src',
      'ss', 'oga', 'rx_campaign', 'rx_medium', 'rx_source',
      'mobile', 'needsRedirect'
    ];
    tracking.forEach(p => u.searchParams.delete(p));

    u.hash = '';

    return u.toString();
  } catch {
    return raw;
  }
}

export function detectPageType(url) {
  try {
    const u = new URL(url);
    const path = u.pathname.toLowerCase();
    const host = u.hostname.toLowerCase();

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

    if (host.includes('greenhouse.io') && /\/jobs\/\d+/.test(path)) {
      return 'posting';
    }

    if (/\/(apply|applymanually|create-account|sign-in|login|register)(\/|$)/.test(path)) {
      return 'apply';
    }

    if (host.includes('indeed.com') && u.searchParams.has('jk') && path.includes('viewjob')) {
      return 'apply';
    }

    return 'posting';
  } catch {
    return 'posting';
  }
}

export function shortUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname + (u.pathname.length > 30 ? u.pathname.slice(0, 30) + '…' : u.pathname);
  } catch {
    return url;
  }
}
