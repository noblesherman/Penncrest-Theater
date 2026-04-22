/*
Handoff note for Mr. Smith:
- File: `src/pages/NotFound.tsx`
- What this is: Public web route page.
- What it does: Renders a full user-facing page for the theater site.
- Connections: Registered in `src/App.tsx` and backed by shared components/helpers in `src/components` + `src/lib`.
- Main content type: Page layout + visible text + route-level logic.
- Safe edits here: Wording, headings, section order, and styling tweaks.
- Be careful with: Form payloads, URL param handling, and API response assumptions.
- Useful context: This folder is one of the most common edit points for visible site content.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

import { useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Copy, Home, Mail, Theater, Ticket } from 'lucide-react';
import Seo from '../components/Seo';
import { SITE_EMAIL, SITE_NAME } from '../lib/siteMeta';

type ErrorGuideItem = {
  code: string;
  technicalMeaning: string;
  plainEnglish: string;
  whatToEmail: string;
  heroLine: string;
};

const ERROR_GUIDE: ErrorGuideItem[] = [
  {
    code: '400',
    technicalMeaning: 'Bad Request',
    plainEnglish: 'Your browser sent something the site couldn\'t understand.',
    whatToEmail: 'What you were doing and exactly what you clicked before it failed.',
    heroLine: 'got lost in translation.',
  },
  {
    code: '401',
    technicalMeaning: 'Unauthorized',
    plainEnglish: 'This page requires a login or permission you don\'t currently have.',
    whatToEmail: 'Whether you were signed in and what account you expected to use.',
    heroLine: 'is backstage only.',
  },
  {
    code: '403',
    technicalMeaning: 'Forbidden',
    plainEnglish: 'The server understood your request but blocked access.',
    whatToEmail: 'The page URL and why you expected to have access.',
    heroLine: 'is off limits.',
  },
  {
    code: '404',
    technicalMeaning: 'Not Found',
    plainEnglish: 'That page doesn\'t exist here anymore, or the link was typed wrong.',
    whatToEmail: 'The full URL that failed and where you clicked from.',
    heroLine: 'missed its cue.',
  },
  {
    code: '408',
    technicalMeaning: 'Request Timeout',
    plainEnglish: 'The server took too long to respond and gave up.',
    whatToEmail: 'Approximate time of the error and whether your connection was slow.',
    heroLine: 'took too long.',
  },
  {
    code: '429',
    technicalMeaning: 'Too Many Requests',
    plainEnglish: 'Too many requests were sent in a short period.',
    whatToEmail: 'What action you repeated and how many times before the error appeared.',
    heroLine: 'was overwhelmed.',
  },
  {
    code: '500',
    technicalMeaning: 'Internal Server Error',
    plainEnglish: 'Something broke on our end while processing your request.',
    whatToEmail: 'The action you were taking and any on-screen error text.',
    heroLine: 'had a breakdown.',
  },
  {
    code: '502',
    technicalMeaning: 'Bad Gateway',
    plainEnglish: 'One of our servers got a bad response from another server.',
    whatToEmail: 'The exact page URL and whether refreshing fixed it.',
    heroLine: 'got a bad note.',
  },
  {
    code: '503',
    technicalMeaning: 'Service Unavailable',
    plainEnglish: 'The site is temporarily unavailable — likely maintenance or high load.',
    whatToEmail: 'When it happened and how long it stayed unavailable.',
    heroLine: 'is on intermission.',
  },
  {
    code: '504',
    technicalMeaning: 'Gateway Timeout',
    plainEnglish: 'A server waiting for a response gave up after too long.',
    whatToEmail: 'What page you requested and if this keeps happening.',
    heroLine: 'waited too long.',
  },
];

function normalizeErrorCode(rawCode: string | null): string {
  if (!rawCode) return '404';
  const cleaned = rawCode.trim().toUpperCase();
  return ERROR_GUIDE.some((entry) => entry.code === cleaned) ? cleaned : '404';
}

export default function NotFound() {
  const location = useLocation();
  const queryParams = new URLSearchParams(location.search);
  const errorCode = normalizeErrorCode(queryParams.get('code'));
  const [copied, setCopied] = useState(false);

  const entry = useMemo(
    () => ERROR_GUIDE.find((e) => e.code === errorCode) ?? ERROR_GUIDE[3],
    [errorCode]
  );

  const reportText = useMemo(() => {
    const lines = [
      `Site: ${SITE_NAME}`,
      `Error: ${entry.code} — ${entry.technicalMeaning}`,
      `URL: ${window.location.href}`,
      `Path: ${location.pathname}${location.search}`,
      `Time: ${new Date().toISOString()}`,
      '',
      'What I was doing:',
      '[Please describe here]',
    ];
    return lines.join('\n');
  }, [location.pathname, location.search, entry]);

  const supportHref = useMemo(() => {
    const subject = encodeURIComponent(`${SITE_NAME} Website Error (${entry.code})`);
    const body = encodeURIComponent(reportText);
    return `mailto:${SITE_EMAIL}?subject=${subject}&body=${body}`;
  }, [reportText, entry]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(reportText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="min-h-screen bg-white text-stone-900">
      <Seo
        title={`${entry.code} | ${SITE_NAME}`}
        description="Page not found. Use our plain-English error guide and contact support."
        noindex
      />

      {/* Hero */}
      <section className="border-b border-stone-100 bg-white">
        <div className="mx-auto max-w-6xl px-6 py-16 sm:py-20 lg:px-10">
          {/* Eyebrow */}
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-red-200 bg-red-50 px-4 py-1.5">
            <span className="h-2 w-2 rounded-full bg-red-700" />
            <span className="text-xs font-semibold uppercase tracking-widest text-red-700">
              Error {entry.code} — {entry.technicalMeaning}
            </span>
          </div>

          <div className="flex items-start justify-between gap-8">
            <div className="max-w-xl">
              <h1 className="text-5xl font-bold leading-tight text-stone-900 sm:text-6xl lg:text-7xl" style={{ fontFamily: 'Georgia, serif' }}>
                The page
                <br />
                <em className="text-red-700">{entry.heroLine}</em>
              </h1>
              <p className="mt-5 text-base leading-relaxed text-stone-500">
                {entry.plainEnglish} You didn't do anything wrong.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link
                  to="/"
                  className="inline-flex items-center gap-2 rounded-full bg-red-700 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-red-800"
                >
                  <Home className="h-4 w-4" />
                  Back Home
                </Link>
                <Link
                  to="/shows"
                  className="inline-flex items-center gap-2 rounded-full border border-stone-200 bg-white px-6 py-2.5 text-sm font-semibold text-stone-700 transition hover:border-stone-300"
                >
                  <Ticket className="h-4 w-4" />
                  Our Season
                </Link>
                <Link
                  to="/fundraising"
                  className="inline-flex items-center gap-2 rounded-full border border-stone-200 bg-white px-6 py-2.5 text-sm font-semibold text-stone-700 transition hover:border-stone-300"
                >
                  <Theater className="h-4 w-4" />
                  Fundraising
                </Link>
              </div>
            </div>

            {/* Big error code */}
            <div className="hidden flex-shrink-0 text-right lg:block">
              <span
                className="block font-bold leading-none text-red-700"
                style={{ fontFamily: 'Georgia, serif', fontSize: '9rem' }}
              >
                {entry.code}
              </span>
              <span className="mt-1 block text-xs font-semibold uppercase tracking-widest text-stone-400">
                {entry.technicalMeaning}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Info + Report */}
      <section className="mx-auto max-w-6xl px-6 py-14 lg:px-10">
        {/* Section label */}
        <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-red-700">
          Error Translator
        </p>
        <h2 className="mb-8 text-3xl font-bold text-stone-900" style={{ fontFamily: 'Georgia, serif' }}>
          What this means in plain English
        </h2>

        {/* Three panels */}
        <div className="mb-10 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-stone-100 bg-stone-50 p-5">
            <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-stone-400">Error Code</p>
            <p className="font-bold leading-none text-red-700" style={{ fontFamily: 'Georgia, serif', fontSize: '2.5rem' }}>
              {entry.code}
            </p>
            <p className="mt-1 text-xs text-stone-400">{entry.technicalMeaning}</p>
          </div>
          <div className="rounded-xl border border-stone-100 bg-stone-50 p-5">
            <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-stone-400">Plain English</p>
            <p className="text-sm leading-relaxed text-stone-600">{entry.plainEnglish}</p>
          </div>
          <div className="rounded-xl border border-stone-100 bg-stone-50 p-5">
            <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-stone-400">Include in Your Email</p>
            <p className="text-sm leading-relaxed text-stone-600">{entry.whatToEmail}</p>
          </div>
        </div>

        {/* Report box */}
        <div className="overflow-hidden rounded-2xl border border-stone-200">
          {/* Header */}
          <div className="flex flex-wrap items-center justify-between gap-4 bg-stone-900 px-6 py-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-stone-500">Report</p>
              <p className="mt-0.5 text-lg font-bold text-white" style={{ fontFamily: 'Georgia, serif' }}>
                Help us fix it — send this report
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <a
                href={supportHref}
                className="inline-flex items-center gap-2 rounded-full bg-red-700 px-5 py-2 text-sm font-semibold text-white transition hover:bg-red-800"
              >
                <Mail className="h-4 w-4" />
                Email {SITE_EMAIL}
              </a>
              <button
                type="button"
                onClick={() => void handleCopy()}
                className="inline-flex items-center gap-2 rounded-full border border-stone-600 bg-transparent px-5 py-2 text-sm font-semibold text-stone-300 transition hover:border-stone-400 hover:text-white"
              >
                <Copy className="h-4 w-4" />
                {copied ? 'Copied!' : 'Copy Report'}
              </button>
            </div>
          </div>

          {/* Pre */}
          <pre className="overflow-x-auto bg-stone-50 px-6 py-5 font-mono text-xs leading-relaxed text-stone-600">
            {reportText}
          </pre>

          {/* Footer hint */}
          <div className="border-t border-stone-100 bg-white px-6 py-3">
            <p className="text-xs text-stone-400">
              Try refreshing first — if it keeps happening,{' '}
              <span className="font-semibold text-red-700">send us the report above.</span>{' '}
              We promise not to blame the audience.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}