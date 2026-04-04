import { useState } from 'react';
import ProgramBioFormsPanel from './forms/ProgramBioFormsPanel';
import SeniorSendoffFormsPanel from './forms/SeniorSendoffFormsPanel';

type FormSection = 'program_bio' | 'senior_sendoff';

export default function AdminFormsPage() {
  const [activeSection, setActiveSection] = useState<FormSection>('program_bio');

  return (
    <div>
      <div className="sticky top-0 z-30 border-b border-stone-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl gap-6 px-6 py-3">
          {[
            { key: 'program_bio', label: 'Program Bios' },
            { key: 'senior_sendoff', label: 'Senior Send-Offs' }
          ].map((section) => (
            <button
              key={section.key}
              type="button"
              onClick={() => setActiveSection(section.key as FormSection)}
              className={`border-b-2 pb-1.5 text-sm font-semibold transition ${
                activeSection === section.key
                  ? 'border-red-700 text-red-700'
                  : 'border-transparent text-stone-500 hover:text-stone-800'
              }`}
            >
              {section.label}
            </button>
          ))}
        </div>
      </div>

      {activeSection === 'program_bio' ? <ProgramBioFormsPanel /> : <SeniorSendoffFormsPanel />}
    </div>
  );
}
