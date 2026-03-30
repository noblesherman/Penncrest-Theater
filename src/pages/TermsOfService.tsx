import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

const LAST_UPDATED = 'March 30, 2026';

type TermsSection = {
  number: number;
  title: string;
  paragraphs: string[];
  bullets?: string[];
};

const termsSections: TermsSection[] = [
  {
    number: 1,
    title: 'Changes to These Terms',
    paragraphs: [
      'We may update these Terms of Service by posting a revised version on the website or by providing notice through other reasonable means. Your continued use of the Services after updated Terms are posted constitutes acceptance of the revised Terms.',
      'We may modify, suspend, or discontinue all or part of the Services at any time, with or without notice, and without liability to you.'
    ]
  },
  {
    number: 2,
    title: 'Privacy',
    paragraphs: [
      'Your submission of information through the Services is governed by our Privacy Policy.',
      'By using the Services, you acknowledge that you have reviewed our Privacy Policy and understand how we collect, use, and disclose information.',
      'You agree that information you provide will be accurate, current, and complete, and that you will update information when necessary.'
    ]
  },
  {
    number: 3,
    title: 'Eligibility and Use of the Services',
    paragraphs: [
      'The Services are intended to let users browse performances, view seating availability, select seats, purchase tickets, receive digital tickets, and access related event information.',
      'You may use the Services only for lawful purposes and in accordance with these Terms of Service.'
    ]
  },
  {
    number: 4,
    title: 'Rules of Conduct',
    paragraphs: ['In connection with your use of the Services, you agree not to:'],
    bullets: [
      'Use the Services for any fraudulent, unlawful, abusive, or misleading purpose.',
      'Interfere with or disrupt the operation or security of the Services.',
      'Access accounts, systems, or data not intended for you.',
      'Use bots, scripts, scrapers, or automated means to access, monitor, extract, or copy content or data.',
      'Upload, transmit, or distribute malicious code, viruses, or other harmful technology.',
      'Impersonate any person or entity, or falsely represent affiliation with any person or entity.',
      'Circumvent seat hold limits, purchase limits, or other ticketing controls.',
      'Copy, reproduce, distribute, modify, reverse engineer, or create derivative works from any part of the Services except as expressly permitted by law or by our prior written consent.'
    ]
  },
  {
    number: 5,
    title: 'Performance Listings and Availability',
    paragraphs: [
      'The Services may include listings, schedules, seating charts, pricing, and other information regarding performances and events. We try to keep information accurate and current, but we do not guarantee it will always be complete or up to date.',
      'Performance dates, times, cast members, seating configurations, ticket availability, prices, and related details are subject to change without notice.',
      'The display of a performance or ticket option does not guarantee continued availability.'
    ]
  },
  {
    number: 6,
    title: 'Ticket Purchases and Transactions',
    paragraphs: [
      'If you make a purchase, you may be required to provide payment and billing information including your name, email address, billing address, and payment details.',
      'By making a purchase, you represent and warrant that you are authorized to use the submitted payment method, all submitted information is accurate and complete, and your purchase is lawful and for legitimate personal use.',
      'We reserve the right to refuse, cancel, or limit any order or transaction if we suspect fraud, unauthorized resale, technical manipulation, pricing error, duplicate activity, or violation of these Terms.',
      'You agree to pay all charges incurred in connection with your transaction, including ticket prices, applicable fees, and applicable taxes.',
      'Order confirmation emails do not necessarily constitute final acceptance of an order.'
    ]
  },
  {
    number: 7,
    title: 'Seat Selection and Temporary Holds',
    paragraphs: [
      'Seat selection is subject to availability at the time of purchase. A seat placed in a cart or otherwise marked as selected is not guaranteed until checkout is completed and payment is processed.',
      'Seats may be temporarily held for a limited period and released automatically if checkout is not completed within the applicable window.',
      'We are not responsible for loss of selected seats resulting from session expiration, connectivity issues, browser issues, payment failure, or other technical interruptions.'
    ]
  },
  {
    number: 8,
    title: 'Delivery of Tickets',
    paragraphs: [
      'Tickets may be delivered electronically, including by email, mobile ticket, QR code, downloadable format, account access, or other digital methods made available through the Services.',
      'You are responsible for reviewing order confirmations promptly and contacting us if tickets are not received.',
      'You are also responsible for safeguarding your ticket. We are not responsible for lost, stolen, copied, shared, or transferred digital tickets, except where required by law.'
    ]
  },
  {
    number: 9,
    title: 'Refunds, Exchanges, and Cancellations',
    paragraphs: [
      'All ticket sales are final unless otherwise stated by Penncrest Theater or required by applicable law.',
      'Refunds, exchanges, credits, or replacements are granted only in accordance with our posted refund policy or as determined by Penncrest Theater in its discretion.',
      'If a performance is canceled and not rescheduled, ticket holders may be offered a refund, exchange, or credit, as determined by Penncrest Theater.',
      'If a performance is rescheduled, postponed, has a cast change, or experiences minor program changes, refunds may not be available.'
    ]
  },
  {
    number: 10,
    title: 'Admission and Event Policies',
    paragraphs: [
      'A valid ticket is required for entry. Penncrest Theater reserves the right to refuse admission, revoke a ticket, or remove any person from an event for safety reasons, disruptive conduct, violation of school or venue policies, suspected fraud, or other inappropriate behavior.',
      'No refund will be required for denied admission or removal based on violation of these Terms, venue rules, school rules, or event policies.'
    ]
  },
  {
    number: 11,
    title: 'Accounts and Credentials',
    paragraphs: [
      'Some features may require account access, administrative login, or use of a password-protected portal.',
      'If you receive or create login credentials, you are responsible for maintaining their confidentiality and for all activity occurring under your account. You agree to notify us promptly if credentials may be compromised.',
      'We may suspend or disable accounts at any time if we believe an account has been misused or used in violation of these Terms.'
    ]
  },
  {
    number: 12,
    title: 'Intellectual Property',
    paragraphs: [
      'The Services, including design, text, graphics, logos, icons, layout, software, ticketing functionality, images, and other content, are owned by or licensed to Penncrest Theater, the school, or applicable rights holders and protected by applicable laws.',
      'Except as expressly permitted, you may not reproduce, distribute, display, perform, publish, modify, create derivative works from, or otherwise exploit any part of the Services without prior written permission from the applicable rights holder.'
    ]
  },
  {
    number: 13,
    title: 'User Submitted Content',
    paragraphs: [
      'If the Services allow content submission, including feedback, comments, or messages, you retain ownership of rights you have in submitted content.',
      'By submitting content through the Services, you grant Penncrest Theater a non-exclusive, royalty-free, worldwide license to use, reproduce, display, distribute, and otherwise use that content in connection with operating, improving, promoting, or administering the Services and related theater activities.',
      'You represent and warrant that you have the right to submit the content and that it does not violate law or third-party rights.',
      'We may remove submitted content at any time and for any reason.'
    ]
  },
  {
    number: 14,
    title: 'Third-Party Services and Links',
    paragraphs: [
      'The Services may integrate with or link to third-party services, including payment processors, email providers, hosting providers, analytics providers, or external websites.',
      'We do not control and are not responsible for the content, terms, privacy practices, or operation of third-party services. Your use of third-party services is at your own risk and subject to those services’ terms and policies.'
    ]
  },
  {
    number: 15,
    title: 'Disclaimer of Warranties',
    paragraphs: [
      'To the fullest extent permitted by applicable law, the Services and all related content, features, tickets, offerings, and materials are provided on an "as is" and "as available" basis, without warranties of any kind, whether express, implied, or statutory.',
      'We do not warrant that the Services will be uninterrupted, secure, error free, accurate, complete, or free from viruses or other harmful components.'
    ]
  },
  {
    number: 16,
    title: 'Limitation of Liability',
    paragraphs: [
      'To the fullest extent permitted by applicable law, Penncrest Theater, its school, administrators, faculty, volunteers, student workers, service providers, and related parties will not be liable for indirect, incidental, consequential, special, exemplary, or punitive damages arising out of or relating to your use of or inability to use the Services.',
      'Without limiting the foregoing, we are not liable for losses from technical failures, lost tickets, delayed emails, checkout interruptions, seat release due to inactivity, pricing display errors, unauthorized account access, event changes, or third-party service failures.',
      'To the fullest extent permitted by law, our total liability for any claim arising out of or relating to the Services will not exceed the total amount you paid to us in connection with the specific transaction giving rise to the claim.'
    ]
  },
  {
    number: 17,
    title: 'Indemnification',
    paragraphs: [
      'To the fullest extent permitted by applicable law, you agree to defend, indemnify, and hold harmless Penncrest Theater, its school, administrators, faculty, volunteers, service providers, and related parties from and against claims, liabilities, damages, losses, and expenses, including reasonable attorneys’ fees, arising out of or relating to your use of the Services, your violation of these Terms, your misuse of tickets, or your violation of any law or third-party rights.'
    ]
  },
  {
    number: 18,
    title: 'Suspension and Termination',
    paragraphs: [
      'We may suspend, restrict, or terminate your access to the Services at any time, with or without notice, if we believe you violated these Terms, misused the Services, engaged in fraud, or posed a risk to the Services or other users.',
      'Upon termination, provisions that by their nature should survive termination will remain in effect, including intellectual property, disclaimers, limitations of liability, indemnification, and dispute-related provisions.'
    ]
  },
  {
    number: 19,
    title: 'Governing Law',
    paragraphs: [
      'These Terms of Service are governed by the laws of the Commonwealth of Pennsylvania, without regard to conflict of law rules, except to the extent superseded by applicable federal law.'
    ]
  },
  {
    number: 20,
    title: 'Disputes',
    paragraphs: [
      'Any dispute arising out of or relating to these Terms or the Services shall be resolved in the state or federal courts located in Pennsylvania, and you consent to the jurisdiction of those courts, unless applicable law requires otherwise.'
    ]
  },
  {
    number: 21,
    title: 'Copyright Complaints',
    paragraphs: [
      'If you believe content made available through the Services infringes your copyright, please contact us with a written notice describing the allegedly infringing material, your contact information, and the basis for your claim.'
    ]
  },
  {
    number: 22,
    title: 'Miscellaneous',
    paragraphs: [
      'These Terms of Service constitute the entire agreement between you and Penncrest Theater regarding the Services and supersede prior or contemporaneous understandings regarding the same subject matter.',
      'If any provision is found unenforceable, the remaining provisions remain in full force and effect.',
      'Failure to enforce any provision does not waive our right to enforce it later.',
      'You may not assign your rights or obligations without our prior written consent. We may assign our rights and obligations as part of an organizational or operational transition.'
    ]
  },
  {
    number: 23,
    title: 'Contact Information',
    paragraphs: [
      'If you have questions about these Terms of Service, please contact Penncrest Theater Department at the address and email below.',
      'Please do not send payment card information or other sensitive information by email.'
    ]
  }
];

function Section({
  section
}: {
  section: TermsSection;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-base sm:text-lg font-semibold text-stone-900 tracking-tight">
        {section.number}. {section.title}
      </h2>
      {section.paragraphs.map((paragraph) => (
        <p key={paragraph} className="text-sm sm:text-[15px] leading-relaxed text-stone-700">
          {paragraph}
        </p>
      ))}
      {section.bullets && (
        <ul className="list-disc pl-5 text-sm sm:text-[15px] leading-relaxed text-stone-700 space-y-1">
          {section.bullets.map((bullet) => (
            <li key={bullet}>{bullet}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function TermsOfService() {
  return (
    <div className="bg-stone-50 min-h-screen">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-14">
        <header className="mb-8 sm:mb-10">
          <p className="text-xs uppercase tracking-[0.14em] text-stone-500 font-medium">Penncrest Theater Department</p>
          <h1 className="mt-2 text-3xl sm:text-4xl text-stone-900 font-semibold tracking-tight" style={{ fontFamily: 'Georgia, serif' }}>
            Terms of Service
          </h1>
          <p className="mt-3 text-sm text-stone-600">Last Updated: {LAST_UPDATED}</p>
        </header>

        <article className="rounded-2xl border border-stone-200 bg-white shadow-sm p-6 sm:p-10 space-y-8">
          <section className="space-y-3">
            <p className="text-sm sm:text-[15px] leading-relaxed text-stone-700">
              Please read these Terms of Service carefully. By accessing or using the Penncrest Theater Department ticketing website,
              including related pages, features, digital tickets, order tools, and services made available through the website, you
              agree to be bound by these Terms. If you do not agree, do not use the Services.
            </p>
            <p className="text-sm sm:text-[15px] leading-relaxed text-stone-700">
              These Terms are between you and Penncrest Theater Department (&ldquo;Penncrest Theater,&rdquo; &ldquo;we,&rdquo;
              &ldquo;our,&rdquo; or &ldquo;us&rdquo;) concerning your use of our ticketing website and related services
              (collectively, the &ldquo;Services&rdquo;).
            </p>
            <p className="text-sm sm:text-[15px] leading-relaxed text-stone-700">
              By using the Services, you represent that you are legally able to enter into this agreement or, if you are under the age
              of majority in your jurisdiction, that you are using the Services with involvement and consent of a parent or legal guardian.
            </p>
          </section>

          {termsSections.map((section) => (
            <Section key={section.number} section={section} />
          ))}

          <section className="space-y-2 text-sm sm:text-[15px] leading-relaxed text-stone-700">
            <p className="font-medium text-stone-900">Penncrest Theater Department</p>
            <p>134 Barren Rd, Media, PA 19063</p>
            <p>
              <a href="mailto:jsmith3@rtmsd.org" className="text-red-700 hover:text-red-800 underline underline-offset-2">
                jsmith3@rtmsd.org
              </a>
            </p>
          </section>
        </article>

        <div className="mt-6 text-sm text-stone-500">
          See also our{' '}
          <Link to="/privacy-policy" className="text-red-700 hover:text-red-800 underline underline-offset-2">
            Privacy Policy
          </Link>{' '}
          and{' '}
          <Link to="/refund-policy" className="text-red-700 hover:text-red-800 underline underline-offset-2">
            Refund Policy
          </Link>
          .
        </div>
      </div>
    </div>
  );
}
