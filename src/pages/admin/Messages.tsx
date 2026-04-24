/*
Handoff note for Mr. Smith:
- File: `src/pages/admin/Messages.tsx`
- What this is: Admin route page.
- What it does: Runs one full admin screen with data loading and operator actions.
- Connections: Wired from `src/App.tsx`; depends on admin auth helpers and backend admin routes.
- Main content type: Business logic + admin UI + visible wording.
- Safe edits here: Table labels, section copy, and presentational layout.
- Be careful with: Request/response contracts, auth checks, and state transitions tied to backend behavior.
- Useful context: Operationally sensitive area: UI polish is safe, contract changes need extra care.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CalendarClock, Mail, Megaphone, Sparkles, Ticket } from 'lucide-react';
import { adminFetch } from '../../lib/adminAuth';

type MessageAudience = {
  id: string;
  title: string;
  showTitle: string;
  startsAt: string;
  venue: string;
  isFundraiser: boolean;
  recipientCount: number;
  orderCount: number;
  lastOrderAt: string | null;
};

type AudienceFeed = {
  items: MessageAudience[];
};

type SendMessageResponse = {
  recipientCount: number;
  sentCount: number;
  failedCount: number;
  failures: Array<{ email: string; error: string }>;
};

type AudienceFilter = 'performances' | 'fundraisers';

type MessageTemplate = {
  label: string;
  subject: string;
  previewText: string;
  headline: string;
  body: string;
  callToActionLabel: string;
  callToActionUrl: string;
  includeEventDetails: boolean;
  signature: string;
};

type MessageBuilderState = {
  subject: string;
  previewText: string;
  headline: string;
  body: string;
  callToActionLabel: string;
  callToActionUrl: string;
  includeEventDetails: boolean;
  signature: string;
};

const inputClass =
  'w-full rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm text-stone-900 placeholder:text-stone-300 transition focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-100';
const labelClass = 'block text-xs font-bold uppercase tracking-widest text-stone-400 mb-2';

const TEMPLATES: MessageTemplate[] = [
  {
    label: 'Schedule Update',
    subject: '{{title}}: Important ticket-holder update',
    previewText: 'Please review this important update for your upcoming Penncrest Theater event.',
    headline: 'Important update for your upcoming event',
    body:
      'Thank you for supporting Penncrest Theater.\n\nWe wanted to share an important update with all ticket holders. Please review the event details below and arrive a few minutes early so check-in stays smooth for everyone.',
    callToActionLabel: 'Open Event Info',
    callToActionUrl: 'https://www.penncresttheater.com/shows',
    includeEventDetails: true,
    signature: 'Penncrest Theater Team'
  },
  {
    label: 'Arrival Reminder',
    subject: '{{title}}: Your performance reminder',
    previewText: 'Doors open soon. Here is your quick reminder before the show.',
    headline: 'We are excited to welcome you soon',
    body:
      'Your support means a lot to our students and production team.\n\nDoors open approximately 30 minutes before showtime. We recommend arriving early so you can find seats, settle in, and enjoy the full performance experience.',
    callToActionLabel: 'Order Lookup',
    callToActionUrl: 'https://www.penncresttheater.com/orders/lookup',
    includeEventDetails: true,
    signature: 'Penncrest Theater Box Office'
  },
  {
    label: 'Thank You Note',
    subject: '{{title}}: Thank you for supporting Penncrest Theater',
    previewText: 'A quick thank-you from the Penncrest Theater team.',
    headline: 'Thank you for supporting our students',
    body:
      'From our cast, crew, and directors: thank you for being part of this production.\n\nYour attendance and support directly help students grow in confidence, creativity, and teamwork. We appreciate you and hope to see you at another event soon.',
    callToActionLabel: 'See Upcoming Events',
    callToActionUrl: 'https://www.penncresttheater.com/fundraising',
    includeEventDetails: false,
    signature: 'Penncrest Theater'
  }
];

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(value));
}

function resolveAudienceLabel(audience: MessageAudience | null): string {
  if (!audience) return 'your event';
  return audience.title || audience.showTitle;
}

function applyTemplateWithAudience(template: MessageTemplate, audience: MessageAudience | null): MessageBuilderState {
  const label = resolveAudienceLabel(audience);
  const replace = (value: string) => value.replace(/\{\{title\}\}/g, label);
  return {
    subject: replace(template.subject),
    previewText: replace(template.previewText),
    headline: replace(template.headline),
    body: replace(template.body),
    callToActionLabel: template.callToActionLabel,
    callToActionUrl: template.callToActionUrl,
    includeEventDetails: template.includeEventDetails,
    signature: template.signature
  };
}

export default function AdminMessagesPage() {
  const [audiences, setAudiences] = useState<MessageAudience[]>([]);
  const [audienceFilter, setAudienceFilter] = useState<AudienceFilter>('performances');
  const [selectedAudienceId, setSelectedAudienceId] = useState<string>('');
  const [builder, setBuilder] = useState<MessageBuilderState>({
    subject: '',
    previewText: '',
    headline: '',
    body: '',
    callToActionLabel: '',
    callToActionUrl: '',
    includeEventDetails: true,
    signature: 'Penncrest Theater Team'
  });
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [lastSendResult, setLastSendResult] = useState<SendMessageResponse | null>(null);

  const loadAudiences = async () => {
    setLoading(true);
    setError(null);

    try {
      const feed = await adminFetch<AudienceFeed>('/api/admin/messages/audiences');
      setAudiences(feed.items || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We hit a small backstage snag while loading message audiences');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAudiences();
  }, []);

  const filteredAudiences = useMemo(
    () =>
      audiences.filter((audience) =>
        audienceFilter === 'fundraisers' ? audience.isFundraiser : !audience.isFundraiser
      ),
    [audiences, audienceFilter]
  );

  useEffect(() => {
    if (filteredAudiences.length === 0) {
      setSelectedAudienceId('');
      return;
    }

    const hasSelected = filteredAudiences.some((audience) => audience.id === selectedAudienceId);
    if (!hasSelected) {
      setSelectedAudienceId(filteredAudiences[0]!.id);
    }
  }, [filteredAudiences, selectedAudienceId]);

  const selectedAudience =
    audiences.find((audience) => audience.id === selectedAudienceId) || filteredAudiences[0] || null;

  const applyTemplate = (template: MessageTemplate) => {
    setBuilder(applyTemplateWithAudience(template, selectedAudience));
    setError(null);
    setNotice(`Template applied: ${template.label}.`);
  };

  const onSend = async () => {
    setError(null);
    setNotice(null);
    setLastSendResult(null);

    if (!selectedAudience) {
      setError('Select a performance or fundraiser before sending.');
      return;
    }

    if (!builder.subject.trim() || !builder.headline.trim() || !builder.body.trim()) {
      setError('Subject, headline, and message body are required.');
      return;
    }

    const hasCtaLabel = Boolean(builder.callToActionLabel.trim());
    const hasCtaUrl = Boolean(builder.callToActionUrl.trim());
    if (hasCtaLabel !== hasCtaUrl) {
      setError('Call-to-action label and URL must both be filled in.');
      return;
    }

    if (selectedAudience.recipientCount <= 0) {
      setError('This audience has no paid ticket holder emails yet.');
      return;
    }

    const confirmed = window.confirm(
      `Send this message to ${selectedAudience.recipientCount} ticket holders for "${resolveAudienceLabel(selectedAudience)}"?`
    );
    if (!confirmed) return;

    setSending(true);
    try {
      const response = await adminFetch<SendMessageResponse>('/api/admin/messages/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          performanceId: selectedAudience.id,
          subject: builder.subject.trim(),
          previewText: builder.previewText.trim() || undefined,
          headline: builder.headline.trim(),
          body: builder.body.trim(),
          callToActionLabel: hasCtaLabel ? builder.callToActionLabel.trim() : undefined,
          callToActionUrl: hasCtaUrl ? builder.callToActionUrl.trim() : undefined,
          includeEventDetails: builder.includeEventDetails,
          signature: builder.signature.trim() || undefined
        })
      });

      setLastSendResult(response);
      setNotice(
        `Sent ${response.sentCount} of ${response.recipientCount} emails for ${resolveAudienceLabel(selectedAudience)}.`
      );
      void loadAudiences();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We hit a small backstage snag while sending that message');
    } finally {
      setSending(false);
    }
  };

  const previewParagraphs = useMemo(() => {
    return builder.body
      .split(/\n{2,}/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean);
  }, [builder.body]);

  return (
    <div className="mx-auto max-w-[1240px] space-y-6 px-4 pb-10 pt-6 sm:px-6 lg:px-8">
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28 }}
        className="overflow-hidden rounded-3xl border border-red-900/20 bg-[radial-gradient(120%_140%_at_0%_0%,#7f1d1d_0%,#3f1111_45%,#140909_100%)] p-6 text-rose-50 shadow-xl shadow-red-950/20 sm:p-8"
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-amber-300/35 bg-amber-200/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-100">
              <Mail className="h-3.5 w-3.5" />
              Mass Messaging
            </div>
            <h1 className="font-serif text-3xl leading-tight text-amber-50 sm:text-4xl">Ticket Holder Messages</h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-rose-100/85 sm:text-[15px]">
              Draft and send polished updates to every paid ticket holder for a specific performance or fundraiser.
              Messages send from <span className="font-semibold text-amber-100">no-reply@penncresttheater.com</span>.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              void loadAudiences();
            }}
            className="inline-flex items-center gap-2 rounded-xl border border-amber-300/40 bg-amber-200/10 px-4 py-2 text-sm font-semibold text-amber-50 transition hover:bg-amber-200/20"
          >
            Refresh Audiences
          </button>
        </div>
      </motion.section>

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      ) : null}

      {notice ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <section className="space-y-6 rounded-3xl border border-stone-200 bg-white p-5 shadow-sm sm:p-6">
          <div>
            <p className={labelClass}>Audience Type</p>
            <div className="inline-flex rounded-xl border border-stone-200 bg-stone-50 p-1">
              <button
                type="button"
                onClick={() => setAudienceFilter('performances')}
                className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
                  audienceFilter === 'performances'
                    ? 'bg-white text-red-700 shadow-sm'
                    : 'text-stone-500 hover:text-stone-900'
                }`}
              >
                Performances
              </button>
              <button
                type="button"
                onClick={() => setAudienceFilter('fundraisers')}
                className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
                  audienceFilter === 'fundraisers'
                    ? 'bg-white text-red-700 shadow-sm'
                    : 'text-stone-500 hover:text-stone-900'
                }`}
              >
                Fundraisers
              </button>
            </div>
          </div>

          <div>
            <label className={labelClass}>Audience</label>
            <select
              value={selectedAudience?.id || ''}
              onChange={(event) => setSelectedAudienceId(event.target.value)}
              className={inputClass}
              disabled={loading || filteredAudiences.length === 0}
            >
              {filteredAudiences.length === 0 ? <option value="">No matching audiences</option> : null}
              {filteredAudiences.map((audience) => (
                <option key={audience.id} value={audience.id}>
                  {resolveAudienceLabel(audience)} • {audience.recipientCount} recipients
                </option>
              ))}
            </select>
            <p className="mt-2 text-xs text-stone-500">
              Audience includes unique emails from all paid orders for the selected event.
            </p>
          </div>

          <div>
            <p className={labelClass}>Quick Templates</p>
            <div className="grid gap-2 sm:grid-cols-3">
              {TEMPLATES.map((template) => (
                <button
                  key={template.label}
                  type="button"
                  onClick={() => applyTemplate(template)}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm font-semibold text-stone-700 transition hover:border-red-300 hover:bg-red-50 hover:text-red-700"
                >
                  <Sparkles className="h-4 w-4" />
                  {template.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-4">
            <div>
              <label className={labelClass}>Email Subject</label>
              <input
                className={inputClass}
                value={builder.subject}
                onChange={(event) => setBuilder((prev) => ({ ...prev, subject: event.target.value }))}
                placeholder="Performance reminder, ticket-holder update, etc."
              />
            </div>

            <div>
              <label className={labelClass}>Preview Line</label>
              <input
                className={inputClass}
                value={builder.previewText}
                onChange={(event) => setBuilder((prev) => ({ ...prev, previewText: event.target.value }))}
                placeholder="Optional inbox preview text"
              />
            </div>

            <div>
              <label className={labelClass}>Headline</label>
              <input
                className={inputClass}
                value={builder.headline}
                onChange={(event) => setBuilder((prev) => ({ ...prev, headline: event.target.value }))}
                placeholder="Main headline shown inside the email"
              />
            </div>

            <div>
              <label className={labelClass}>Message Body</label>
              <textarea
                className={`${inputClass} min-h-[180px] resize-y`}
                value={builder.body}
                onChange={(event) => setBuilder((prev) => ({ ...prev, body: event.target.value }))}
                placeholder="Write your message to ticket holders..."
              />
              <p className="mt-2 text-xs text-stone-500">Separate paragraphs with a blank line.</p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={labelClass}>CTA Label (Optional)</label>
                <input
                  className={inputClass}
                  value={builder.callToActionLabel}
                  onChange={(event) => setBuilder((prev) => ({ ...prev, callToActionLabel: event.target.value }))}
                  placeholder="Open Event Info"
                />
              </div>
              <div>
                <label className={labelClass}>CTA URL (Optional)</label>
                <input
                  className={inputClass}
                  value={builder.callToActionUrl}
                  onChange={(event) => setBuilder((prev) => ({ ...prev, callToActionUrl: event.target.value }))}
                  placeholder="https://..."
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
              <div>
                <label className={labelClass}>Signature</label>
                <input
                  className={inputClass}
                  value={builder.signature}
                  onChange={(event) => setBuilder((prev) => ({ ...prev, signature: event.target.value }))}
                  placeholder="Penncrest Theater Team"
                />
              </div>
              <label className="inline-flex items-center gap-2 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm font-semibold text-stone-700">
                <input
                  type="checkbox"
                  checked={builder.includeEventDetails}
                  onChange={(event) => setBuilder((prev) => ({ ...prev, includeEventDetails: event.target.checked }))}
                  className="h-4 w-4 rounded border-stone-300 accent-red-700"
                />
                Include event details
              </label>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-stone-100 pt-5">
            <button
              type="button"
              onClick={() => setBuilder(applyTemplateWithAudience(TEMPLATES[0]!, selectedAudience))}
              className="rounded-xl border border-stone-200 bg-white px-4 py-2.5 text-sm font-semibold text-stone-700 transition hover:border-stone-300 hover:text-stone-900"
            >
              Reset To Default Template
            </button>
            <button
              type="button"
              onClick={() => {
                void onSend();
              }}
              disabled={sending || !selectedAudience}
              className="inline-flex items-center gap-2 rounded-xl bg-red-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {sending ? (
                <span className="inline-flex h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              ) : (
                <Megaphone className="h-4 w-4" />
              )}
              {sending ? 'Sending…' : 'Send Mass Email'}
            </button>
          </div>
        </section>

        <section className="space-y-4">
          <div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-bold uppercase tracking-[0.16em] text-stone-400">Audience Snapshot</h2>
            <div className="mt-4 grid gap-3">
              <div className="rounded-2xl border border-stone-100 bg-stone-50 px-4 py-3">
                <p className="text-xs uppercase tracking-[0.14em] text-stone-400">Selected Event</p>
                <p className="mt-1 text-base font-semibold text-stone-900">
                  {selectedAudience ? resolveAudienceLabel(selectedAudience) : 'No audience selected'}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-stone-100 bg-stone-50 px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.14em] text-stone-400">Recipients</p>
                  <p className="mt-1 text-xl font-bold text-stone-900">{selectedAudience?.recipientCount || 0}</p>
                </div>
                <div className="rounded-2xl border border-stone-100 bg-stone-50 px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.14em] text-stone-400">Paid Orders</p>
                  <p className="mt-1 text-xl font-bold text-stone-900">{selectedAudience?.orderCount || 0}</p>
                </div>
              </div>

              {selectedAudience ? (
                <div className="rounded-2xl border border-stone-100 bg-stone-50 px-4 py-3 text-sm text-stone-600">
                  <div className="flex items-center gap-2">
                    <CalendarClock className="h-4 w-4 text-stone-400" />
                    {formatDateTime(selectedAudience.startsAt)}
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <Ticket className="h-4 w-4 text-stone-400" />
                    {selectedAudience.venue}
                  </div>
                  {selectedAudience.lastOrderAt ? (
                    <p className="mt-2 text-xs text-stone-500">
                      Last paid order: {formatDateTime(selectedAudience.lastOrderAt)}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>

          <motion.div
            layout
            className="overflow-hidden rounded-3xl border border-stone-200 bg-white shadow-sm"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
          >
            <div className="border-b border-stone-100 bg-stone-50 px-5 py-3">
              <p className="text-sm font-semibold text-stone-700">Live Email Preview</p>
            </div>
            <div className="bg-[#f5f0e8] p-4">
              <div className="mx-auto max-w-xl overflow-hidden rounded-2xl border border-stone-200 bg-white shadow">
                <div className="bg-[linear-gradient(160deg,#1a0505_0%,#3d0a0a_60%,#5a1010_100%)] px-5 py-4 text-amber-50">
                  <p className="text-[10px] uppercase tracking-[0.22em] text-amber-200/85">Penncrest Theater</p>
                  <p className="mt-2 text-xl font-semibold leading-tight">{resolveAudienceLabel(selectedAudience)}</p>
                  <p className="mt-1 text-xs text-amber-100/80">Message for ticket holders</p>
                </div>
                <div className="space-y-4 px-5 py-5">
                  <p className="font-serif text-xl text-red-800">{builder.headline || 'Your headline appears here'}</p>
                  {previewParagraphs.length > 0 ? (
                    previewParagraphs.map((paragraph, index) => (
                      <p key={`${paragraph.slice(0, 20)}-${index}`} className="whitespace-pre-line text-sm leading-7 text-stone-700">
                        {paragraph}
                      </p>
                    ))
                  ) : (
                    <p className="text-sm text-stone-400">Write your message body to preview it here.</p>
                  )}

                  {builder.includeEventDetails && selectedAudience ? (
                    <div className="rounded-xl border border-amber-300/60 bg-amber-50 px-3 py-3 text-sm text-stone-700">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-700">Event Details</p>
                      <p className="mt-2">{formatDateTime(selectedAudience.startsAt)}</p>
                      <p>{selectedAudience.venue}</p>
                    </div>
                  ) : null}

                  {builder.callToActionLabel.trim() && builder.callToActionUrl.trim() ? (
                    <a
                      href={builder.callToActionUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-600"
                    >
                      {builder.callToActionLabel} →
                    </a>
                  ) : null}

                  <p className="text-sm font-medium text-stone-700">{builder.signature || 'Penncrest Theater Team'}</p>
                </div>
              </div>
            </div>
          </motion.div>

          <AnimatePresence>
            {lastSendResult && lastSendResult.failedCount > 0 ? (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
              >
                <p className="font-semibold">
                  {lastSendResult.failedCount} send{lastSendResult.failedCount === 1 ? '' : 's'} failed.
                </p>
                <p className="mt-1 text-xs text-amber-700">Showing the first {lastSendResult.failures.length} failures:</p>
                <ul className="mt-2 space-y-1 text-xs">
                  {lastSendResult.failures.map((failure) => (
                    <li key={`${failure.email}-${failure.error}`}>
                      {failure.email}: {failure.error}
                    </li>
                  ))}
                </ul>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </section>
      </div>
    </div>
  );
}
