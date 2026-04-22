/*
Handoff note for Mr. Smith:
- File: `src/pages/admin/Forms.tsx`
- What this is: Admin route page.
- What it does: Runs one full admin screen with data loading and operator actions.
- Connections: Wired from `src/App.tsx`; depends on admin auth helpers and backend admin routes.
- Main content type: Business logic + admin UI + visible wording.
- Safe edits here: Table labels, section copy, and presentational layout.
- Be careful with: Request/response contracts, auth checks, and state transitions tied to backend behavior.
- Useful context: Operationally sensitive area: UI polish is safe, contract changes need extra care.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

import { useState } from 'react';
import ProgramBioFormsPanel from './forms/ProgramBioFormsPanel';
import SeniorSendoffFormsPanel from './forms/SeniorSendoffFormsPanel';
import CustomFormsPanel from './forms/CustomFormsPanel';

type FormSection = 'program_bio' | 'senior_sendoff' | 'custom_forms';

export default function AdminFormsPage() {
  const [activeSection, setActiveSection] = useState<FormSection>('program_bio');

  return (
    <div>
      <div className="sticky top-0 z-30 border-b border-stone-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl gap-6 px-6 py-4">
          {[
            { key: 'program_bio', label: 'Program Bios' },
            { key: 'senior_sendoff', label: 'Shout Outs' },
            { key: 'custom_forms', label: 'Custom Forms' }
          ].map((section) => (
            <button
              key={section.key}
              type="button"
              onClick={() => setActiveSection(section.key as FormSection)}
              className={`border-b-2 pb-2 text-sm font-semibold transition ${
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

      {activeSection === 'program_bio' && <ProgramBioFormsPanel />}
      {activeSection === 'senior_sendoff' && <SeniorSendoffFormsPanel />}
      {activeSection === 'custom_forms' && <CustomFormsPanel />}
    </div>
  );
}
