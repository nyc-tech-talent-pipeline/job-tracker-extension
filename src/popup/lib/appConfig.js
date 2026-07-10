// The only field of config.json/client-id.json actually consumed anywhere in
// the app is googleClientId — everything else in config.json is currently
// unused. Loaded once at startup by App.jsx via loadConfig(), then read here
// by auth.js so getToken()/connectGoogle() don't need it threaded through
// every Sheets-calling function.
let googleClientId = null;

export function setGoogleClientId(id) {
  googleClientId = id || null;
}

export function getGoogleClientId() {
  if (!googleClientId) {
    throw new Error('Google Client ID not loaded — reload the extension and try again. If this persists, check that config.json exists and contains a "googleClientId" field.');
  }
  if (googleClientId === 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com') {
    throw new Error('Google Client ID is still a placeholder — copy config.example.json to config.json and fill in your real Client ID.');
  }
  return googleClientId;
}
