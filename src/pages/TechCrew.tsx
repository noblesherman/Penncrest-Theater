/*
Handoff note for Mr. Smith:
- File: `src/pages/TechCrew.tsx`
- What this is: Public web route page.
- What it does: Renders a full user-facing page for the theater site.
- Connections: Registered in `src/App.tsx` and backed by shared components/helpers in `src/components` + `src/lib`.
- Main content type: Page layout + visible text + route-level logic.
- Safe edits here: Wording, headings, section order, and styling tweaks.
- Be careful with: Form payloads, URL param handling, and API response assumptions.
- Useful context: This folder is one of the most common edit points for visible site content.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

import AboutContentPage from './AboutContentPage';

export default function TechCrew() {
  return <AboutContentPage slug="tech-crew" />;
}
