# Job Tracker — Setup Guide

## What this extension does

1. **Detects** the job title and company from the current page automatically  
2. **Autofills** your personal info into application forms with one click  
3. **Logs** every application to your Google Sheet (date, company, title, URL, archive link, status)  
4. **Archives** the job posting to the Wayback Machine (web.archive.org) so you always have a copy — no account needed, completely free

---

## Step 1 — Create your Google Sheet

1. Go to [sheets.google.com](https://sheets.google.com) and create a new spreadsheet  
2. Rename the first tab to **Applications**  
3. Add these headers in row 1:

| A | B | C | D | E | F |
|---|---|---|---|---|---|
| Date | Company | Title | URL | Archive | Status |

4. Copy the **Sheet ID** from the URL:  
   `https://docs.google.com/spreadsheets/d/`**THIS_PART**`/edit`

---

## Step 2 — Set up Google OAuth (one-time)

You need a Google Cloud project to let the extension write to your sheet.

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project (e.g. "Job Tracker")
3. Go to **APIs & Services → Enable APIs** → enable **Google Sheets API**
4. Go to **APIs & Services → Credentials → Create Credentials → OAuth client ID**
5. Choose **Chrome Extension** as the application type
6. Set the application ID to your extension's ID (see Step 3 below)
7. Copy the **Client ID** you get (ends in `.apps.googleusercontent.com`)

8. Copy `config.example.json` to `config.json` and replace `YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com` with your actual Client ID:
   ```json
   { "googleClientId": "1234567890-xxxx.apps.googleusercontent.com", ... }
   ```
   `config.json` is gitignored — your Client ID stays local and is never committed

---

## Step 3 — Load the extension in Chrome

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked**
4. Select this folder (`job-tracker-extension`)
5. Note the **Extension ID** shown — go back to Google Cloud and add it to your OAuth credentials
6. Click the extension icon in your toolbar to open the popup

---

## Step 4 — Configure the extension

1. Click the extension icon
2. Click **Settings & Sheet Config** at the bottom
3. Paste your **Sheet ID** from Step 1
4. Fill in your profile (name, email, phone, address, LinkedIn, website)
5. Click **Save Settings**

---

## Using the extension

### Log an application
1. Open any job posting (LinkedIn, Indeed, Greenhouse, Lever, etc.)
2. Click the extension icon — it auto-detects the company and title
3. If anything is wrong, click **Edit** to fix it
4. Click **Log Application**  
   → Saves a row to your sheet  
   → Archives the page to archive.is  
   → Shows you the archive link

### Autofill a form
1. Navigate to the actual application form page
2. Click the extension icon
3. Click **Fill application form**
   → The extension matches your saved info to form fields  
   → Works on React, Vue, and plain HTML forms

---

## Supported job boards (auto-detection)

- LinkedIn
- Indeed
- Glassdoor
- Lever
- Greenhouse
- Workday / MyWorkdayJobs
- SmartRecruiters
- Jobvite
- Any page with JSON-LD `JobPosting` schema
- Generic fallback for all other sites

---

## Troubleshooting

**"No Sheet ID — open Settings first"**  
→ Open the Settings panel and paste your Sheet ID

**"Not detected" for company/title**  
→ Click Edit and type them in manually, then log

**Autofill fills 0 fields**  
→ The form may use non-standard field names. Try scrolling to see if you missed any, or fill manually.

**Archive link goes to a Wayback search instead of a snapshot**  
→ The Wayback Machine may take a minute to process. Click the link and it will show the queued or nearest snapshot.

**Google sign-in not working**  
→ Make sure your Client ID in manifest.json matches the one in Google Cloud Console, and the Extension ID is added to the OAuth credentials.
