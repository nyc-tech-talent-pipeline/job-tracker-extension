import { useState } from 'react';
import Step1JobPosting from './Step1JobPosting.jsx';
import Step2Application from './Step2Application.jsx';
import Step3Confirm from './Step3Confirm.jsx';

const STEPS = [
  { n: 1, label: 'Job Posting' },
  { n: 2, label: 'Application' },
  { n: 3, label: 'Applied?' }
];

export default function LogTab({ active }) {
  const [step, setStepState] = useState(1);
  const [detectedJob, setDetectedJob] = useState({ company: '', title: '', url: '' });
  const [coverLetter, setCoverLetter] = useState('');

  function setStep(n) {
    setStepState(n);
    chrome.storage.local.set({ lastStep: n });
  }

  return (
    <div id="panel-log" className={active ? 'panel active' : 'panel'}>
      <div className="step-bar">
        {STEPS.map((s, i) => (
          <div key={s.n} style={{ display: 'contents' }}>
            {i > 0 && <div className="step-divider" />}
            <div className={`step-item${step === s.n ? ' active' : step > s.n ? ' done' : ''}`}>
              <div className="step-num">{s.n}</div>
              <div className="step-lbl">{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: step === 1 ? 'block' : 'none' }}>
        <Step1JobPosting
          logTabActive={active}
          detectedJob={detectedJob}
          setDetectedJob={setDetectedJob}
          setStep={setStep}
        />
      </div>
      <div style={{ display: step === 2 ? 'block' : 'none' }}>
        <Step2Application
          coverLetter={coverLetter}
          setCoverLetter={setCoverLetter}
          onBack={() => setStep(1)}
          onNext={() => setStep(3)}
        />
      </div>
      <div style={{ display: step === 3 ? 'block' : 'none' }}>
        <Step3Confirm
          detectedJob={detectedJob}
          coverLetter={coverLetter}
          onBack={() => setStep(2)}
          setStep={setStep}
        />
      </div>
    </div>
  );
}
