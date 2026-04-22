/*
Handoff note for Mr. Smith:
- File: `src/pages/DynamicAboutPage.tsx`
- What this is: Public web route page.
- What it does: Renders a full user-facing page for the theater site.
- Connections: Registered in `src/App.tsx` and backed by shared components/helpers in `src/components` + `src/lib`.
- Main content type: Page layout + visible text + route-level logic.
- Safe edits here: Wording, headings, section order, and styling tweaks.
- Be careful with: Form payloads, URL param handling, and API response assumptions.
- Useful context: This folder is one of the most common edit points for visible site content.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import AboutContentPage from './AboutContentPage';
import NotFoundPage from './NotFound';

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export default function DynamicAboutPage() {
  const { aboutSlug = '' } = useParams<{ aboutSlug: string }>();

  const normalizedSlug = useMemo(() => aboutSlug.trim().toLowerCase(), [aboutSlug]);
  if (!normalizedSlug || !slugPattern.test(normalizedSlug)) {
    return <NotFoundPage />;
  }

  return <AboutContentPage slug={normalizedSlug} />;
}
