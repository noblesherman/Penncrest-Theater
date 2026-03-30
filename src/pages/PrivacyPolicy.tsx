import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

const LAST_UPDATED = 'March 30, 2026';

const personalInformationItems = [
  'Name',
  'Email address',
  'Phone number',
  'Billing address',
  'Payment-related information',
  'Ticket order details',
  'School or organization affiliation, if voluntarily provided'
];

const collectionMethods = [
  {
    title: 'Through the Services',
    body: 'We collect Personal Information when you purchase tickets, request information, contact us, join a mailing list, receive digital tickets, or otherwise interact with the Services.'
  },
  {
    title: 'Offline',
    body: 'We may collect Personal Information offline when you contact us directly about tickets, attend an event, or communicate with theater staff.'
  },
  {
    title: 'From Other Sources',
    body: 'We may receive Personal Information from payment processors, school staff involved in event administration, or service providers that help us operate the Services.'
  }
];

const usagePurposes = [
  {
    title: 'Providing the functionality of the Services',
    body: 'To allow you to browse performances, select seats, purchase tickets, receive confirmations, access digital tickets, and receive support.'
  },
  {
    title: 'Managing performances, ticketing, and event operations',
    body: 'To manage seating, admissions, ticket scanning, order records, event logistics, fraud prevention, and service reliability.'
  },
  {
    title: 'Improving the Services',
    body: 'To understand use patterns, diagnose technical issues, improve content and functionality, and maintain security.'
  },
  {
    title: 'Sending optional updates',
    body: 'If you opt in, we may send emails about performances, announcements, and related events. You can unsubscribe at any time.'
  }
];

const disclosureScenarios = [
  {
    title: 'Service providers',
    body: 'We may share Personal Information with third-party providers that support website hosting, payment processing, email delivery, ticketing infrastructure, analytics, storage, and technical support.'
  },
  {
    title: 'School or theater administrators',
    body: 'We may share information with authorized Penncrest Theater or school personnel when needed for event administration, admissions, support, or safety-related matters.'
  },
  {
    title: 'Legal and safety obligations',
    body: 'We may use or disclose Personal Information to comply with law, respond to lawful requests, enforce our terms, protect operations, or protect the rights, privacy, safety, or property of Penncrest Theater, users, or others.'
  },
  {
    title: 'Organizational changes',
    body: 'If operation of the Services is transferred or reorganized, Personal Information may be transferred as permitted by applicable law.'
  }
];

function Section({
  title,
  children
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-4">
      <h2 className="text-lg sm:text-xl font-semibold text-stone-900 tracking-tight">{title}</h2>
      <div className="space-y-3 text-sm sm:text-[15px] leading-relaxed text-stone-700">{children}</div>
    </section>
  );
}

export default function PrivacyPolicy() {
  return (
    <div className="bg-stone-50 min-h-screen">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-14">
        <header className="mb-8 sm:mb-10">
          <p className="text-xs uppercase tracking-[0.14em] text-stone-500 font-medium">Penncrest Theater Department</p>
          <h1 className="mt-2 text-3xl sm:text-4xl text-stone-900 font-semibold tracking-tight" style={{ fontFamily: 'Georgia, serif' }}>
            Privacy Policy
          </h1>
          <p className="mt-3 text-sm text-stone-600">Last Updated: {LAST_UPDATED}</p>
        </header>

        <article className="rounded-2xl border border-stone-200 bg-white shadow-sm p-6 sm:p-10 space-y-8 sm:space-y-10">
          <Section title="Overview">
            <p>
              Penncrest Theater Department, including the Penncrest Theater ticketing website, wants you to understand how we collect,
              use, and disclose information. This Privacy Policy describes our practices for information collected through the Penncrest
              Theater ticketing website, related web pages, online box office tools, digital ticket delivery, email communications that
              link to this Privacy Policy, and other online services operated by us that link to this Privacy Policy (collectively,
              the &ldquo;Services&rdquo;).
            </p>
          </Section>

          <Section title="Personal Information">
            <p>
              &ldquo;Personal Information&rdquo; means information that identifies you as an individual or relates to an identifiable
              individual, such as:
            </p>
            <ul className="list-disc pl-5 space-y-1">
              {personalInformationItems.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </Section>

          <Section title="Collection of Personal Information">
            <p>We and our service providers collect Personal Information in a variety of ways.</p>
            <div className="space-y-3">
              {collectionMethods.map((method) => (
                <p key={method.title}>
                  <span className="font-medium text-stone-900">{method.title}: </span>
                  {method.body}
                </p>
              ))}
            </div>
            <p>
              We need certain Personal Information to provide the Services. If you do not provide requested information, we may not be
              able to complete your transaction or provide certain features.
            </p>
          </Section>

          <Section title="Use of Personal Information">
            <p>We and our service providers use Personal Information for operational and educational purposes, including:</p>
            <div className="space-y-3">
              {usagePurposes.map((purpose) => (
                <p key={purpose.title}>
                  <span className="font-medium text-stone-900">{purpose.title}: </span>
                  {purpose.body}
                </p>
              ))}
            </div>
          </Section>

          <Section title="Disclosure of Personal Information">
            <p>We may disclose Personal Information in the following circumstances:</p>
            <div className="space-y-3">
              {disclosureScenarios.map((scenario) => (
                <p key={scenario.title}>
                  <span className="font-medium text-stone-900">{scenario.title}: </span>
                  {scenario.body}
                </p>
              ))}
            </div>
          </Section>

          <Section title="Payment Information">
            <p>
              Payments made through the Services may be processed by a third-party provider such as Stripe. We do not store full payment
              card numbers on our own servers. Payment information submitted during checkout is handled according to the payment processor&apos;s
              privacy practices and terms.
            </p>
          </Section>

          <Section title="Other Information and Cookies">
            <p>
              &ldquo;Other Information&rdquo; means information that does not directly identify you, such as browser type, device type,
              operating system, referring pages, approximate location based on IP address, and usage analytics.
            </p>
            <p>
              We and our service providers may collect Other Information automatically through browser or device signals, cookies and
              similar technologies, analytics tools, and server logs (including IP addresses). We use this information for functionality,
              performance, security, fraud prevention, and service improvement.
            </p>
          </Section>

          <Section title="Your Privacy Choices">
            <p>
              If you receive promotional emails, you may opt out using the unsubscribe link in the message or by contacting us. Even if
              you opt out of marketing messages, we may still send administrative messages related to orders, tickets, or account activity.
            </p>
            <p>
              You may also request access to, correction of, or deletion of Personal Information you have previously provided. We will
              review and respond as required by applicable law and operational needs. Certain information may be retained for recordkeeping,
              security, transaction completion, fraud prevention, and legal compliance.
            </p>
          </Section>

          <Section title="Retention and Security">
            <p>
              We retain Personal Information for as long as needed or permitted for the purposes for which it was collected, including
              providing the Services, maintaining order and event records, resolving disputes, enforcing policies, and complying with
              legal or school-related obligations.
            </p>
            <p>
              We use reasonable organizational, technical, and administrative safeguards to protect Personal Information. No method of
              data transmission or storage is fully secure.
            </p>
          </Section>

          <Section title="Third-Party Services">
            <p>
              This Privacy Policy does not address, and we are not responsible for, the privacy practices of third parties, including
              payment processors, analytics providers, or external websites linked from our Services.
            </p>
          </Section>

          <Section title="Children and Sensitive Information">
            <p>
              The Services are intended for a general audience, including parents, families, students, and community members purchasing
              tickets for school performances. We do not knowingly collect Personal Information from children in a manner prohibited by
              applicable law.
            </p>
            <p>
              Please do not send sensitive information through the Services or by email unless specifically requested and securely required,
              including Social Security numbers, government identification numbers, or medical information.
            </p>
          </Section>

          <Section title="Updates to This Privacy Policy">
            <p>
              The &ldquo;Last Updated&rdquo; date at the top of this page indicates when this Privacy Policy was last revised. Changes
              become effective when the revised policy is posted on the Services.
            </p>
          </Section>

          <Section title="Contacting Us">
            <p>If you have questions about this Privacy Policy or would like to submit a privacy-related request, contact:</p>
            <div className="text-stone-800">
              <p className="font-medium">Penncrest Theater Department</p>
              <p>134 Barren Rd, Media, PA 19063</p>
              <p>
                <a href="mailto:jsmith3@rtmsd.org" className="text-red-700 hover:text-red-800 underline underline-offset-2">
                  jsmith3@rtmsd.org
                </a>
              </p>
            </div>
            <p>Please do not include payment card information or other sensitive information in email messages to us.</p>
          </Section>
        </article>

        <div className="mt-6 text-sm text-stone-500">
          Looking for site usage terms? Visit our <Link to="/" className="text-red-700 hover:text-red-800 underline underline-offset-2">homepage</Link>{' '}
          and legal links in the footer.
        </div>
      </div>
    </div>
  );
}
