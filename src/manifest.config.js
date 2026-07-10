import { defineManifest } from '@crxjs/vite-plugin';

// Fixed public key so the unpacked extension ID stays stable across rebuilds —
// otherwise chrome.identity.launchWebAuthFlow's redirect URI breaks every time
// dist/ is regenerated at a different path/hash.
const MANIFEST_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAzCRd1gMlH37y8lweUafxMc1UlKA2ZR3dLqkZqGpX/Y1MuPGF4j3ULxH+PcpGU40i/A6aAFiqJi3tqVEWNi/88s+ezydnRDg06YlOD7QBHNF3vgiRxS5WlJyXAP+UOBWY1h4oALVvFFvYnoN8JvCvS528Ddr2pb317X2gPwgGGdISgcvS0g49fQLtngHMPK0RQ5NVG0yIeMYBbD0LdhcO8lUrJj/iJ496fZuMx8tswLPIsE1AS3ligoy27IyVD/ZXyI/7GVUhYXCYQg/sP59rVImbuLMQlgeS0GVknJZAj+c/ad0ObbSwLWLYJmpdt4vFln68mAKH98JC2sucOQoOXwIDAQAB';

const HOST_PERMISSIONS = [
  'https://www.googleapis.com/*',
  'https://oauth2.googleapis.com/*',
  'https://sheets.googleapis.com/*',
  'https://www.linkedin.com/*',
  'https://www.indeed.com/*',
  'https://www.glassdoor.com/*',
  'https://*.lever.co/*',
  'https://*.greenhouse.io/*',
  'https://*.workday.com/*',
  'https://*.myworkdayjobs.com/*',
  'https://*.smartrecruiters.com/*',
  'https://*.jobvite.com/*',
  'https://*.rippling.com/*',
  'https://*.icims.com/*',
  'https://*.dayforcehcm.com/*',
  'https://*.ceridian.com/*',
  'https://*.ultipro.com/*',
  'https://*.paylocity.com/*',
  'https://*.paycom.com/*',
  'https://*.adp.com/*',
  'https://*.myworkday.com/*',
  'https://*.taleo.net/*',
  'https://*.oraclecloud.com/*',
  'https://*.successfactors.eu/*',
  'https://*.successfactors.com/*',
  'https://*.recruitics.com/*',
  'https://*.ashbyhq.com/*',
  'https://jobs.ashbyhq.com/*',
  'https://*.pinpointrecruitment.com/*',
  'https://*.recruitee.com/*',
  'https://*.dover.com/*'
];

const CONTENT_SCRIPT_MATCHES = [
  'https://www.linkedin.com/*',
  'https://www.indeed.com/*',
  'https://www.glassdoor.com/*',
  'https://*.lever.co/*',
  'https://*.greenhouse.io/*',
  'https://*.workday.com/*',
  'https://*.myworkdayjobs.com/*',
  'https://*.smartrecruiters.com/*',
  'https://*.jobvite.com/*',
  'https://*.rippling.com/*',
  'https://*.icims.com/*',
  'https://*.taleo.net/*',
  'https://*.successfactors.com/*',
  'https://*.brassring.com/*',
  'https://*.ultipro.com/*',
  'https://*.bamboohr.com/*',
  'https://*.recruitingbypaycor.com/*',
  'https://*.applytojob.com/*',
  'https://*.jobscore.com/*',
  'https://jobs.ashbyhq.com/*',
  'https://boards.greenhouse.io/*',
  'https://jobs.lever.co/*',
  'https://apply.workable.com/*',
  'https://*.workable.com/*',
  'https://*.ziprecruiter.com/*',
  'https://www.dice.com/*',
  'https://www.monster.com/*',
  'https://www.simplyhired.com/*',
  'https://www.builtin.com/*',
  'https://www.builtinnyc.com/*',
  'https://www.builtinchicago.com/*',
  'https://www.builtinaustin.com/*',
  'https://www.builtinboston.com/*',
  'https://www.builtinla.com/*',
  'https://www.builtinsf.com/*',
  'https://www.builtincolorado.com/*',
  'https://www.builtinseattle.com/*',
  'https://www.handshake.com/*',
  'https://app.joinhandshake.com/*',
  'https://cityjobs.nyc.gov/*',
  'https://*.careers.microsoft.com/*',
  'https://careers.google.com/*',
  'https://www.amazon.jobs/*',
  'https://jobs.apple.com/*',
  'https://www.metacareers.com/*',
  'https://*.dayforcehcm.com/*',
  'https://*.ceridian.com/*',
  'https://*.paylocity.com/*',
  'https://*.paycom.com/*',
  'https://*.adp.com/*',
  'https://*.myworkday.com/*',
  'https://*.oraclecloud.com/*',
  'https://*.successfactors.eu/*',
  'https://*.recruitics.com/*',
  'https://*.ashbyhq.com/*',
  'https://*.pinpointrecruitment.com/*',
  'https://*.recruitee.com/*',
  'https://*.dover.com/*'
];

export default defineManifest({
  manifest_version: 3,
  name: 'Job Tracker',
  version: '1.0.2',
  key: MANIFEST_KEY,
  description:
    'Track job applications effortlessly. Auto-detect postings, autofill forms, and log everything to your Google Sheet — stay organized.',
  permissions: ['storage', 'activeTab', 'identity', 'tabs', 'alarms', 'notifications', 'scripting'],
  host_permissions: HOST_PERMISSIONS,
  background: {
    service_worker: 'src/background/index.js'
  },
  action: {
    default_popup: 'src/popup/index.html',
    default_icon: {
      16: 'icons/icon16.png',
      48: 'icons/icon48.png',
      128: 'icons/icon128.png'
    }
  },
  content_scripts: [
    {
      matches: CONTENT_SCRIPT_MATCHES,
      js: ['src/content/index.jsx'],
      run_at: 'document_idle'
    }
  ],
  icons: {
    16: 'icons/icon16.png',
    48: 'icons/icon48.png',
    128: 'icons/icon128.png'
  }
  // No manual web_accessible_resources needed — the PDF.js worker is now a
  // bundled popup asset (pdfjs-dist, loaded same-origin from the popup),
  // not a page-facing resource. crxjs auto-computes entries for anything
  // the content script itself needs to expose to matched page origins.
});
