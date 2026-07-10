import { useState } from 'react';
import ApplicationSearch from './ApplicationSearch.jsx';
import StatusForm from './StatusForm.jsx';
import Celebration from './Celebration.jsx';

export default function StatusTab({ active }) {
  const [selectedApp, setSelectedApp] = useState(null);
  const [celebration, setCelebration] = useState(null);

  return (
    <div id="panel-interview" className={active ? 'panel active' : 'panel'}>
      {celebration ? (
        <Celebration
          status={celebration.status}
          company={celebration.company}
          title={celebration.title}
          onDone={() => { setCelebration(null); setSelectedApp(null); }}
        />
      ) : (
        <>
          <ApplicationSearch selectedRow={selectedApp} onSelect={setSelectedApp} />
          {selectedApp && (
            <StatusForm
              key={selectedApp.rowIndex}
              selectedRow={selectedApp}
              onSaved={() => setSelectedApp(null)}
              onCelebrate={setCelebration}
            />
          )}
        </>
      )}
    </div>
  );
}
