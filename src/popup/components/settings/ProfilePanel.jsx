import { useEffect, useState } from 'react';
import { setConfig } from '../../lib/config.js';
import { getResume, saveResume, clearResume } from '../../lib/resume.js';
import StatusBar from '../shared/StatusBar.jsx';

export default function ProfilePanel({ fields, setField }) {
  const [resumeName, setResumeName] = useState(null);
  const [profileStatus, setProfileStatus] = useState(null);

  useEffect(() => {
    (async () => {
      const resume = await getResume();
      if (resume?.name) setResumeName(resume.name);
    })();
  }, []);

  async function handleFileChange(e) {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const saved = await saveResume(file);
      setResumeName(saved.name);
      setProfileStatus({ type: 'success', message: `✅ Resume saved: ${saved.name}` });
    } catch (err) {
      setProfileStatus({ type: 'error', message: `❌ ${err.message}` });
    }
  }

  async function handleClearResume(e) {
    e.stopPropagation();
    await clearResume();
    setResumeName(null);
    setProfileStatus({ type: 'info', message: 'Resume removed' });
  }

  async function handleSaveProfile() {
    await setConfig(fields);
    setProfileStatus({ type: 'success', message: '✅ Profile saved' });
  }

  return (
    <div className="section">
      <div className="section-title">Your info (for autofill)</div>
      <div className="edit-row"><label>Full name</label><input className="field-edit" value={fields.name} onChange={e => setField('name', e.target.value)} /></div>
      <div className="edit-row"><label>Email</label><input className="field-edit" value={fields.email} onChange={e => setField('email', e.target.value)} /></div>
      <div className="edit-row"><label>Phone</label><input className="field-edit" value={fields.phone} onChange={e => setField('phone', e.target.value)} /></div>
      <div className="edit-row"><label>Address</label><input className="field-edit" value={fields.address} onChange={e => setField('address', e.target.value)} /></div>
      <div className="edit-row"><label>LinkedIn URL</label><input className="field-edit" value={fields.linkedin} onChange={e => setField('linkedin', e.target.value)} /></div>
      <div className="edit-row"><label>Portfolio / Website</label><input className="field-edit" value={fields.website} onChange={e => setField('website', e.target.value)} /></div>

      <div className="edit-row" style={{ marginTop: 4 }}>
        <label>Default resume</label>
        <label
          htmlFor="cfg-resume-input"
          style={{ display: 'block', border: '1px dashed #ddd', borderRadius: 6, padding: '10px 12px', textAlign: 'center', cursor: 'pointer', transition: 'border-color 0.15s' }}
        >
          {!resumeName ? (
            <div style={{ fontSize: 12, color: '#888' }}>Click to upload PDF or Word doc</div>
          ) : (
            <div style={{ fontSize: 12, fontWeight: 600, color: '#1a1a1a' }}>📄 {resumeName}</div>
          )}
          <input type="file" id="cfg-resume-input" accept=".pdf,.doc,.docx" style={{ display: 'none' }} onChange={handleFileChange} />
        </label>
        {resumeName && (
          <button className="btn btn-danger" style={{ marginTop: 5, fontSize: 11, padding: '5px 8px' }} onClick={handleClearResume}>
            ✕ Remove resume
          </button>
        )}
      </div>
      <button className="btn btn-primary" style={{ marginTop: 8 }} onClick={handleSaveProfile}>Save profile</button>
      <div style={{ marginTop: 8 }}><StatusBar status={profileStatus} /></div>
    </div>
  );
}
