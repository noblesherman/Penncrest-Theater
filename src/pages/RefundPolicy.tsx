/*
Handoff note for Mr. Smith:
- File: `src/pages/RefundPolicy.tsx`
- What this is: Public web route page.
- What it does: Renders a full user-facing page for the theater site.
- Connections: Registered in `src/App.tsx` and backed by shared components/helpers in `src/components` + `src/lib`.
- Main content type: Page layout + visible text + route-level logic.
- Safe edits here: Wording, headings, section order, and styling tweaks.
- Be careful with: Form payloads, URL param handling, and API response assumptions.
- Useful context: This folder is one of the most common edit points for visible site content.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

import { Link } from 'react-router-dom';

const LAST_UPDATED = 'March 30, 2026';

const requestChecklist = [
  'Name used for purchase',
  'Order confirmation or ticket details',
  'Reason for the request'
];

const cancellationOutcomes = [
  'Refund',
  'Exchange for another performance',
  'Account credit'
];

export default function RefundPolicy() {
  return (
    <div className="bg-stone-50 min-h-screen">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-14">
        <header className="mb-8 sm:mb-10">
          <p className="text-xs uppercase tracking-[0.14em] text-stone-500 font-medium">Penncrest Theater Department</p>
          <h1 className="mt-2 text-3xl sm:text-4xl text-stone-900 font-semibold tracking-tight" style={{ fontFamily: 'Georgia, serif' }}>
            Refund Policy
          </h1>
          <p className="mt-3 text-sm text-stone-600">Last Updated: {LAST_UPDATED}</p>
        </header>

        <article className="rounded-2xl border border-stone-200 bg-white shadow-sm p-6 sm:p-10 space-y-7">
          <section className="space-y-3">
            <p className="text-sm sm:text-[15px] leading-relaxed text-stone-700">
              All ticket sales are considered final. Penncrest Theater Department does not guarantee refunds or exchanges except as
              outlined below or where required by applicable law.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-base sm:text-lg font-semibold text-stone-900 tracking-tight">General Policy</h2>
            <p className="text-sm sm:text-[15px] leading-relaxed text-stone-700">
              Tickets purchased through the Penncrest Theater ticketing website are non-refundable and non-transferable. Once a
              transaction is completed, tickets cannot be canceled, returned, or exchanged.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-base sm:text-lg font-semibold text-stone-900 tracking-tight">Refund Requests</h2>
            <p className="text-sm sm:text-[15px] leading-relaxed text-stone-700">
              While all sales are final, Penncrest Theater may, at its sole discretion, review refund requests submitted by patrons.
            </p>
            <p className="text-sm sm:text-[15px] leading-relaxed text-stone-700">
              To request a refund, contact us by email at{' '}
              <a href="mailto:jsmith3@rtmsd.org" className="text-red-700 hover:text-red-800 underline underline-offset-2">
                jsmith3@rtmsd.org
              </a>
              .
            </p>
            <p className="text-sm sm:text-[15px] leading-relaxed text-stone-700">Refund requests should include:</p>
            <ul className="list-disc pl-5 text-sm sm:text-[15px] leading-relaxed text-stone-700 space-y-1">
              {requestChecklist.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <p className="text-sm sm:text-[15px] leading-relaxed text-stone-700">
              Submitting a request does not guarantee a refund. Decisions are made case by case.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-base sm:text-lg font-semibold text-stone-900 tracking-tight">Performance Cancellations</h2>
            <p className="text-sm sm:text-[15px] leading-relaxed text-stone-700">
              If a performance is canceled and not rescheduled, ticket holders may be offered one of the following:
            </p>
            <ul className="list-disc pl-5 text-sm sm:text-[15px] leading-relaxed text-stone-700 space-y-1">
              {cancellationOutcomes.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <p className="text-sm sm:text-[15px] leading-relaxed text-stone-700">
              The specific resolution will be determined by Penncrest Theater.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-base sm:text-lg font-semibold text-stone-900 tracking-tight">Rescheduled Performances</h2>
            <p className="text-sm sm:text-[15px] leading-relaxed text-stone-700">
              If a performance is rescheduled, tickets remain valid for the new date. Refunds are not guaranteed but may be considered
              if you cannot attend the new date.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-base sm:text-lg font-semibold text-stone-900 tracking-tight">Missed Performances</h2>
            <p className="text-sm sm:text-[15px] leading-relaxed text-stone-700">
              No refunds or credits are issued for missed performances, late arrivals, or failure to attend.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-base sm:text-lg font-semibold text-stone-900 tracking-tight">Cast or Program Changes</h2>
            <p className="text-sm sm:text-[15px] leading-relaxed text-stone-700">
              Performance details, including cast, schedule, and program, are subject to change without notice. These changes do not
              qualify for refunds.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-base sm:text-lg font-semibold text-stone-900 tracking-tight">Technical Issues</h2>
            <p className="text-sm sm:text-[15px] leading-relaxed text-stone-700">
              Penncrest Theater is not responsible for internet connectivity issues, device compatibility limitations, or user error
              during checkout. Refunds for these issues are not guaranteed.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-base sm:text-lg font-semibold text-stone-900 tracking-tight">Payment Processing</h2>
            <p className="text-sm sm:text-[15px] leading-relaxed text-stone-700">
              Payments are processed through a third-party provider. If approved, refunds are issued to the original payment method when
              possible.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-base sm:text-lg font-semibold text-stone-900 tracking-tight">Contact</h2>
            <p className="text-sm sm:text-[15px] leading-relaxed text-stone-700">
              For refund requests or questions about this policy, contact{' '}
              <a href="mailto:jsmith3@rtmsd.org" className="text-red-700 hover:text-red-800 underline underline-offset-2">
                jsmith3@rtmsd.org
              </a>
              .
            </p>
          </section>
        </article>

        <div className="mt-6 text-sm text-stone-500">
          See also our{' '}
          <Link to="/terms-of-service" className="text-red-700 hover:text-red-800 underline underline-offset-2">
            Terms of Service
          </Link>{' '}
          and{' '}
          <Link to="/privacy-policy" className="text-red-700 hover:text-red-800 underline underline-offset-2">
            Privacy Policy
          </Link>
          .
        </div>
      </div>
    </div>
  );
}
