/*
Handoff note for Mr. Smith:
- File: `src/pages/admin/Fundraise.tsx`
- What this is: Admin route page.
- What it does: Runs one full admin screen with data loading and operator actions.
- Connections: Wired from `src/App.tsx`; depends on admin auth helpers and backend admin routes.
- Main content type: Business logic + admin UI + visible wording.
- Safe edits here: Table labels, section copy, and presentational layout.
- Be careful with: Request/response contracts, auth checks, and state transitions tied to backend behavior.
- Useful context: Operationally sensitive area: UI polish is safe, contract changes need extra care.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

import { ChangeEvent, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { ReactNode } from 'react';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { loadStripe, type StripeElementsOptions } from '@stripe/stripe-js';
import { AnimatePresence, motion } from 'motion/react';
import { createPortal } from 'react-dom';
import {
  Calendar,
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  DollarSign,
  Edit2,
  Globe,
  ImageIcon,
  Landmark,
  Loader2,
  Mail,
  MapPin,
  Plus,
  RefreshCcw,
  Search,
  Save,
  Settings,
  Trash2,
  UserRound,
  Upload,
  X
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { adminFetch } from '../../lib/adminAuth';
import { apiFetch } from '../../lib/api';
import { uploadAdminImage } from '../../lib/adminUploads';
import { fundraisingDonationOptions, type FundraisingDonationOption } from '../../lib/fundraisingContent';
import EventRegistrationFormBuilderModal from './forms/EventRegistrationFormBuilderModal';

type AdminFundraiseTab = 'events' | 'sponsors' | 'attendees' | 'donations';

type FundraiseEvent = {
  id: string;
  title: string;
  showDescription?: string | null;
  showPosterUrl?: string | null;
  startsAt: string;
  endsAt: string | null;
  salesCutoffAt: string | null;
  seatSelectionEnabled: boolean;
  venue: string;
  notes?: string | null;
  seatsTotal: number;
  seatsSold: number;
  pricingTiers: Array<{ id: string; name: string; priceCents: number }>;
};

type EventForm = {
  title: string;
  description: string;
  posterUrl: string;
  startsAt: string;
  endsAt: string;
  salesCutoffAt: string;
  venue: string;
  notes: string;
  tiersText: string;
  seatSelectionEnabled: boolean;
  generalAdmissionCapacity: string;
};

type FundraisingSponsor = {
  id: string;
  name: string;
  tier: 'Balcony' | 'Mezzanine' | 'Orchestra' | 'Center Stage';
  logoUrl: string;
  imageUrl: string;
  spotlight: string;
  websiteUrl: string;
};

type SponsorForm = {
  name: string;
  tier: 'Balcony' | 'Mezzanine' | 'Orchestra' | 'Center Stage';
  logoUrl: string;
  imageUrl: string;
  spotlight: string;
  websiteUrl: string;
};

type DonationIntentResponse = {
  paymentIntentId: string;
  clientSecret: string;
  publishableKey?: string;
  amountCents: number;
  currency: string;
};

type ActiveDonationIntent = {
  paymentIntentId: string;
  clientSecret: string;
  publishableKey: string;
  amountCents: number;
};

type AdminFundraisingDonation = {
  paymentIntentId: string;
  amountCents: number;
  currency: string;
  status: string;
  donorName: string;
  donorEmail: string;
  donorRecognitionPreference: 'known' | 'anonymous';
  donationOptionName: string | null;
  donationLevelTitle: string | null;
  donationLevelAmountLabel: string | null;
  receiptEmail: string | null;
  createdAt: string;
  thankYouEmailSent: boolean;
};

type AdminFundraisingDonationSummary = {
  count: number;
  succeededCount: number;
  grossSucceededCents: number;
};

type AdminFundraisingDonationFeed = {
  donations: AdminFundraisingDonation[];
  summary?: AdminFundraisingDonationSummary;
};

type DonationOptionsAdminPayload = {
  options: FundraisingDonationOption[];
  isCustomized?: boolean;
  updatedAt?: string | null;
};

type DonationStatusFilter = 'all' | 'succeeded' | 'processing' | 'other';

type AdminFundraisingAttendeeOrderSeat = {
  seatId: string | null;
  attendeeName: string | null;
  ticketType: string | null;
  isComplimentary: boolean;
  price: number;
  seatLabel: string;
};

type AdminFundraisingAttendeeOrder = {
  id: string;
  status: string;
  source: string;
  email: string;
  customerName: string;
  amountTotal: number;
  currency: string;
  createdAt: string;
  orderSeats: AdminFundraisingAttendeeOrderSeat[];
  registrationSubmission: {
    id: string;
    submittedAt: string;
    responseJson: unknown;
    form?: { id: string; formName: string } | null;
    formVersion?: { id: string; versionNumber: number } | null;
  } | null;
};

type AdminFundraisingAttendeeFeed = {
  performance: {
    id: string;
    title: string;
    seatSelectionEnabled: boolean;
  };
  summary: {
    orderCount: number;
    ticketCount: number;
    responseCount: number;
  };
  rows: AdminFundraisingAttendeeOrder[];
};

const inputClass =
  'w-full rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm text-stone-900 placeholder:text-stone-300 focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-100 transition';
const labelClass = 'block text-xs font-bold uppercase tracking-widest text-stone-400 mb-2';
const FALLBACK_STRIPE_PUBLISHABLE_KEY = (import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || '').trim();
const GENERAL_ADMISSION_CAPACITY_MIN = 1;
const GENERAL_ADMISSION_CAPACITY_MAX = 5000;
const GENERAL_ADMISSION_CAPACITY_DEFAULT = 250;

const STEPS = [
  { id: 'event', label: 'The Event', icon: Calendar },
  { id: 'schedule', label: 'Date', icon: CalendarClock },
  { id: 'tickets', label: 'Tickets', icon: DollarSign },
  { id: 'review', label: 'Review', icon: Settings }
];

const SPONSOR_STEPS = [
  { id: 'brand', label: 'Brand', icon: Landmark },
  { id: 'media', label: 'Media', icon: ImageIcon },
  { id: 'review', label: 'Review', icon: Settings }
] as const;

function createInitialForm(): EventForm {
  return {
    title: '',
    description: '',
    posterUrl: '',
    startsAt: '',
    endsAt: '',
    salesCutoffAt: '',
    venue: 'Penncrest High School Auditorium',
    notes: '',
    tiersText: 'Adult:1800\nStudent:1200',
    seatSelectionEnabled: true,
    generalAdmissionCapacity: String(GENERAL_ADMISSION_CAPACITY_DEFAULT)
  };
}

function createInitialSponsorForm(): SponsorForm {
  return {
    name: '',
    tier: 'Balcony',
    logoUrl: '',
    imageUrl: '',
    spotlight: '',
    websiteUrl: 'https://'
  };
}

function parseTiers(text: string): Array<{ name: string; priceCents: number }> {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name = '', cents = ''] = line.split(':');
      return { name: name.trim(), priceCents: Number(cents) };
    })
    .filter((tier) => tier.name && Number.isFinite(tier.priceCents) && tier.priceCents > 0);
}

function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase()
  }).format(cents / 100);
}

function parseDonationInputToCents(value: string): number | null {
  const normalized = value.replace(/[^\d.]/g, '').trim();
  if (!normalized) return null;
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const cents = Math.round(amount * 100);
  return cents >= 100 ? cents : null;
}

function formatDonationStatus(status: string): string {
  switch (status) {
    case 'succeeded':
      return 'Succeeded';
    case 'processing':
      return 'Processing';
    case 'requires_payment_method':
      return 'Needs Payment Method';
    case 'requires_action':
      return 'Action Required';
    case 'canceled':
      return 'Canceled';
    default:
      return status.replace(/_/g, ' ');
  }
}

function getDonationDestinationParts(donation: Pick<AdminFundraisingDonation, 'donationOptionName' | 'donationLevelTitle'>): {
  optionName: string;
  levelTitle: string;
  pileName: string;
} {
  const optionName = donation.donationOptionName?.trim() || 'Unassigned';
  const levelTitle = donation.donationLevelTitle?.trim() || '';
  const pileName = levelTitle ? `${optionName} - ${levelTitle}` : optionName;
  return { optionName, levelTitle, pileName };
}

function csvEscape(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function buildCsv(rows: Array<Array<unknown>>): string {
  return rows.map((row) => row.map(csvEscape).join(',')).join('\n');
}

function slugifyForFilename(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'event';
}

function buildDonationOptionId(seed?: string): string {
  const normalized = (seed || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (normalized) return normalized.slice(0, 80);
  return `donation-option-${Math.random().toString(36).slice(2, 10)}`;
}

function buildDonationLevelId(seed?: string): string {
  const normalized = (seed || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (normalized) return normalized.slice(0, 80);
  return `donation-level-${Math.random().toString(36).slice(2, 10)}`;
}

function createDonationLevelDraft(): FundraisingDonationOption['levels'][number] {
  return {
    id: buildDonationLevelId(),
    amountLabel: '$50',
    title: 'New Level',
    detail: 'Describe what this donation level supports.',
    suggestedAmountCents: 5000
  };
}

function createDonationOptionDraft(): FundraisingDonationOption {
  return {
    id: buildDonationOptionId(),
    name: 'New Donation Option',
    description: 'Describe where this donation path directs support.',
    levels: [createDonationLevelDraft()]
  };
}

function AdminDonationPaymentForm({
  amountCents,
  donorName,
  donorEmail,
  onSuccess,
  onError
}: {
  amountCents: number;
  donorName: string;
  donorEmail: string;
  onSuccess: () => void;
  onError: (message: string | null) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onError(null);

    if (!stripe || !elements) {
      onError('Card form is still loading. Please try again.');
      return;
    }

    setSubmitting(true);
    const result = await stripe.confirmPayment({
      elements,
      confirmParams: {
        payment_method_data: {
          billing_details: {
            name: donorName,
            email: donorEmail
          }
        }
      },
      redirect: 'if_required'
    });
    setSubmitting(false);

    if (result.error) {
      onError(result.error.message || 'Payment could not be completed.');
      return;
    }

    const status = result.paymentIntent?.status;
    if (status === 'succeeded' || status === 'processing' || status === 'requires_capture') {
      onSuccess();
      return;
    }

    onError(`Payment did not complete. Current status: ${status || 'unknown'}.`);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="rounded-xl border border-stone-200 bg-white p-3 sm:p-4">
        <PaymentElement />
      </div>
      <button
        type="submit"
        disabled={submitting || !stripe || !elements}
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-red-700 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
        Charge {formatUsd(amountCents)}
      </button>
    </form>
  );
}

export default function AdminFundraisePage() {
  const [tab, setTab] = useState<AdminFundraiseTab>('events');
  const [events, setEvents] = useState<FundraiseEvent[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string>('');
  const [form, setForm] = useState<EventForm>(createInitialForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showWizard, setShowWizard] = useState(false);
  const [showFormBuilder, setShowFormBuilder] = useState(false);
  const [builderEventId, setBuilderEventId] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);
  const [isPosterUploading, setIsPosterUploading] = useState(false);
  const [sponsors, setSponsors] = useState<FundraisingSponsor[]>([]);
  const [sponsorsLoading, setSponsorsLoading] = useState(true);
  const [sponsorForm, setSponsorForm] = useState<SponsorForm>(createInitialSponsorForm);
  const [sponsorEditingId, setSponsorEditingId] = useState<string | null>(null);
  const [showSponsorWizard, setShowSponsorWizard] = useState(false);
  const [sponsorStep, setSponsorStep] = useState(0);
  const [sponsorDir, setSponsorDir] = useState<1 | -1>(1);
  const [sponsorSaving, setSponsorSaving] = useState(false);
  const [sponsorError, setSponsorError] = useState<string | null>(null);
  const [isSponsorLogoUploading, setIsSponsorLogoUploading] = useState(false);
  const [isSponsorImageUploading, setIsSponsorImageUploading] = useState(false);
  const [deletingSponsorId, setDeletingSponsorId] = useState<string | null>(null);
  const [donations, setDonations] = useState<AdminFundraisingDonation[]>([]);
  const [donationSummary, setDonationSummary] = useState<AdminFundraisingDonationSummary | null>(null);
  const [donationsLoading, setDonationsLoading] = useState(true);
  const [donationsError, setDonationsError] = useState<string | null>(null);
  const [donationOptions, setDonationOptions] = useState<FundraisingDonationOption[]>(fundraisingDonationOptions);
  const [donationOptionsLoading, setDonationOptionsLoading] = useState(true);
  const [donationOptionsSaving, setDonationOptionsSaving] = useState(false);
  const [donationOptionsError, setDonationOptionsError] = useState<string | null>(null);
  const [donationOptionsCustomized, setDonationOptionsCustomized] = useState(false);
  const [donationOptionsUpdatedAt, setDonationOptionsUpdatedAt] = useState<string | null>(null);
  const [attendeeRows, setAttendeeRows] = useState<AdminFundraisingAttendeeOrder[]>([]);
  const [attendeeSummary, setAttendeeSummary] = useState<{ orderCount: number; ticketCount: number; responseCount: number } | null>(null);
  const [attendeesLoading, setAttendeesLoading] = useState(false);
  const [attendeesError, setAttendeesError] = useState<string | null>(null);
  const [purgingOrders, setPurgingOrders] = useState(false);
  const [expandedAttendeeOrderId, setExpandedAttendeeOrderId] = useState<string | null>(null);
  const [selectedDonationOptionId, setSelectedDonationOptionId] = useState<string>(fundraisingDonationOptions[0]?.id || '');
  const [selectedDonationLevelId, setSelectedDonationLevelId] = useState<string | null>(null);
  const [selectedDonationAmountCents, setSelectedDonationAmountCents] = useState<number | null>(null);
  const [customDonationAmount, setCustomDonationAmount] = useState('');
  const [donorName, setDonorName] = useState('');
  const [donorEmail, setDonorEmail] = useState('');
  const [donorRecognitionPreference, setDonorRecognitionPreference] = useState<'known' | 'anonymous'>('known');
  const [activeDonationIntent, setActiveDonationIntent] = useState<ActiveDonationIntent | null>(null);
  const [donationIntentLoading, setDonationIntentLoading] = useState(false);
  const [donationError, setDonationError] = useState<string | null>(null);
  const [donationSuccessMessage, setDonationSuccessMessage] = useState<string | null>(null);
  const [donationSearchQuery, setDonationSearchQuery] = useState('');
  const [donationStatusFilter, setDonationStatusFilter] = useState<DonationStatusFilter>('all');
  const [donationEditorOpen, setDonationEditorOpen] = useState(false);
  const [donationProcessOpen, setDonationProcessOpen] = useState(false);
  const customAmountInputRef = useRef<HTMLInputElement | null>(null);

  const tiers = useMemo(() => parseTiers(form.tiersText), [form.tiersText]);
  const selectedEvent = useMemo(() => events.find((event) => event.id === selectedEventId) ?? null, [events, selectedEventId]);
  const builderEvent = useMemo(() => events.find((event) => event.id === builderEventId) ?? null, [builderEventId, events]);
  const selectedDonationOption = useMemo(
    () => donationOptions.find((option) => option.id === selectedDonationOptionId) || donationOptions[0] || null,
    [donationOptions, selectedDonationOptionId]
  );
  const selectedDonationLevels = selectedDonationOption?.levels || [];
  const selectedDonationLevel = useMemo(
    () => selectedDonationLevels.find((level) => level.id === selectedDonationLevelId) || null,
    [selectedDonationLevels, selectedDonationLevelId]
  );
  const donationOptionStats = useMemo(() => {
    const levelCount = donationOptions.reduce((sum, option) => sum + option.levels.length, 0);
    const suggestedTotalCents = donationOptions.reduce(
      (sum, option) => sum + option.levels.reduce((levelSum, level) => levelSum + level.suggestedAmountCents, 0),
      0
    );
    return {
      optionCount: donationOptions.length,
      levelCount,
      suggestedTotalCents
    };
  }, [donationOptions]);
  const donationRecognitionTotals = useMemo(() => {
    return donations.reduce(
      (totals, donation) => {
        if (donation.donorRecognitionPreference === 'anonymous') {
          totals.anonymous += 1;
        } else {
          totals.known += 1;
        }
        return totals;
      },
      { known: 0, anonymous: 0 }
    );
  }, [donations]);
  const donationStatusCounts = useMemo(() => {
    return donations.reduce(
      (totals, donation) => {
        totals.all += 1;
        if (donation.status === 'succeeded') {
          totals.succeeded += 1;
        } else if (donation.status === 'processing') {
          totals.processing += 1;
        } else {
          totals.other += 1;
        }
        return totals;
      },
      { all: 0, succeeded: 0, processing: 0, other: 0 } as Record<DonationStatusFilter, number>
    );
  }, [donations]);
  const donationDestinationTotals = useMemo(() => {
    const buckets = new Map<string, { pileName: string; amountCents: number; count: number }>();
    donations.forEach((donation) => {
      if (donation.status !== 'succeeded') return;
      const { pileName } = getDonationDestinationParts(donation);
      const current = buckets.get(pileName) || { pileName, amountCents: 0, count: 0 };
      current.amountCents += donation.amountCents;
      current.count += 1;
      buckets.set(pileName, current);
    });
    return Array.from(buckets.values()).sort((a, b) => b.amountCents - a.amountCents || a.pileName.localeCompare(b.pileName));
  }, [donations]);
  const filteredDonations = useMemo(() => {
    const query = donationSearchQuery.trim().toLowerCase();
    return donations.filter((donation) => {
      const statusMatch =
        donationStatusFilter === 'all'
          ? true
          : donationStatusFilter === 'other'
            ? donation.status !== 'succeeded' && donation.status !== 'processing'
            : donation.status === donationStatusFilter;

      if (!statusMatch) {
        return false;
      }
      if (!query) {
        return true;
      }

      const searchableFields = [
        donation.donorName,
        donation.donorEmail,
        donation.receiptEmail,
        donation.paymentIntentId,
        donation.donationOptionName,
        donation.donationLevelTitle
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return searchableFields.includes(query);
    });
  }, [donationSearchQuery, donationStatusFilter, donations]);
  const sortedFilteredDonations = useMemo(
    () =>
      [...filteredDonations].sort((a, b) => {
        const aTime = Date.parse(a.createdAt);
        const bTime = Date.parse(b.createdAt);
        const safeATime = Number.isFinite(aTime) ? aTime : 0;
        const safeBTime = Number.isFinite(bTime) ? bTime : 0;
        return safeBTime - safeATime;
      }),
    [filteredDonations]
  );
  const donationStripePromise = useMemo(() => {
    if (!activeDonationIntent?.publishableKey) return null;
    return loadStripe(activeDonationIntent.publishableKey);
  }, [activeDonationIntent?.publishableKey]);
  const donationStripeOptions = useMemo<StripeElementsOptions | null>(() => {
    if (!activeDonationIntent?.clientSecret) return null;
    return {
      clientSecret: activeDonationIntent.clientSecret,
      appearance: { theme: 'stripe' }
    };
  }, [activeDonationIntent?.clientSecret]);
  const isOtherDonationSelected = selectedDonationLevelId === null;

  async function loadEvents() {
    setLoading(true);
    setError(null);
    try {
      const items = await adminFetch<FundraiseEvent[]>('/api/admin/performances?scope=active&kind=fundraise');
      setEvents(items);
      if (items.length > 0 && !items.some((item) => item.id === selectedEventId)) {
        setSelectedEventId(items[0].id);
      }
      if (builderEventId && !items.some((item) => item.id === builderEventId)) {
        setBuilderEventId(null);
        setShowFormBuilder(false);
      }
      if (items.length === 0) {
        setSelectedEventId('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We hit a small backstage snag while trying to load fundraising events');
    } finally {
      setLoading(false);
    }
  }

  async function loadSponsors() {
    setSponsorsLoading(true);
    setSponsorError(null);
    try {
      const data = await adminFetch<{ sponsors: FundraisingSponsor[] }>('/api/admin/fundraising/sponsors');
      setSponsors(Array.isArray(data.sponsors) ? data.sponsors : []);
    } catch (err) {
      setSponsorError(err instanceof Error ? err.message : 'We hit a small backstage snag while trying to load sponsors');
    } finally {
      setSponsorsLoading(false);
    }
  }

  async function loadDonations() {
    setDonationsLoading(true);
    setDonationsError(null);
    try {
      const data = await adminFetch<AdminFundraisingDonationFeed>('/api/admin/fundraising/donations?limit=60');
      setDonations(Array.isArray(data.donations) ? data.donations : []);
      setDonationSummary(data.summary || null);
    } catch (err) {
      setDonationsError(err instanceof Error ? err.message : 'We hit a small backstage snag while trying to load donations');
    } finally {
      setDonationsLoading(false);
    }
  }

  async function loadDonationOptions() {
    setDonationOptionsLoading(true);
    setDonationOptionsError(null);
    try {
      const data = await adminFetch<DonationOptionsAdminPayload>('/api/admin/fundraising/donation-options');
      const options = Array.isArray(data.options) && data.options.length > 0 ? data.options : fundraisingDonationOptions;
      setDonationOptions(options);
      setDonationOptionsCustomized(Boolean(data.isCustomized));
      setDonationOptionsUpdatedAt(data.updatedAt || null);
      setSelectedDonationOptionId((current) => (options.some((option) => option.id === current) ? current : options[0]?.id || ''));
    } catch (err) {
      setDonationOptionsError(err instanceof Error ? err.message : 'We hit a small backstage snag while trying to load donation options');
      setDonationOptions(fundraisingDonationOptions);
      setDonationOptionsCustomized(false);
      setDonationOptionsUpdatedAt(null);
      setSelectedDonationOptionId((current) =>
        fundraisingDonationOptions.some((option) => option.id === current)
          ? current
          : fundraisingDonationOptions[0]?.id || ''
      );
    } finally {
      setDonationOptionsLoading(false);
    }
  }

  async function loadAttendees(performanceId: string) {
    if (!performanceId) {
      setAttendeeRows([]);
      setAttendeeSummary(null);
      return;
    }

    setAttendeesLoading(true);
    setAttendeesError(null);
    try {
      const data = await adminFetch<AdminFundraisingAttendeeFeed>(
        `/api/admin/fundraising/events/${encodeURIComponent(performanceId)}/attendees`
      );
      setAttendeeRows(Array.isArray(data.rows) ? data.rows : []);
      setAttendeeSummary(data.summary || null);
    } catch (err) {
      setAttendeesError(err instanceof Error ? err.message : 'We hit a small backstage snag while trying to load attendee and response data');
      setAttendeeRows([]);
      setAttendeeSummary(null);
    } finally {
      setAttendeesLoading(false);
    }
  }

  function exportAttendeesCsv() {
    if (attendeeRows.length === 0) {
      setNotice('No attendee rows available to export yet.');
      return;
    }

    const table: Array<Array<unknown>> = [
      [
        'order_id',
        'order_created_at',
        'order_status',
        'order_source',
        'customer_name',
        'customer_email',
        'order_total',
        'seat_label',
        'attendee_name',
        'ticket_type',
        'is_complimentary',
        'ticket_price',
        'questionnaire_submitted_at',
        'questionnaire_form_name',
        'questionnaire_form_version',
        'questionnaire_response_json'
      ]
    ];

    attendeeRows.forEach((row) => {
      const submission = row.registrationSubmission;
      const submissionAt = submission?.submittedAt || '';
      const formName = submission?.form?.formName || '';
      const formVersion = submission?.formVersion?.versionNumber || '';
      const responseJson = submission ? JSON.stringify(submission.responseJson) : '';

      if (row.orderSeats.length === 0) {
        table.push([
          row.id,
          row.createdAt,
          row.status,
          row.source,
          row.customerName,
          row.email,
          formatMoney(row.amountTotal, row.currency),
          '',
          '',
          '',
          '',
          '',
          submissionAt,
          formName,
          formVersion,
          responseJson
        ]);
        return;
      }

      row.orderSeats.forEach((seat) => {
        table.push([
          row.id,
          row.createdAt,
          row.status,
          row.source,
          row.customerName,
          row.email,
          formatMoney(row.amountTotal, row.currency),
          seat.seatLabel,
          seat.attendeeName || '',
          seat.ticketType || '',
          seat.isComplimentary ? 'yes' : 'no',
          formatUsd(seat.price),
          submissionAt,
          formName,
          formVersion,
          responseJson
        ]);
      });
    });

    const csv = buildCsv(table);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const eventName = selectedEvent?.title || 'fundraising-event';
    const stamp = new Date().toISOString().slice(0, 10);

    const link = document.createElement('a');
    link.href = url;
    link.download = `${slugifyForFilename(eventName)}-tickets-responses-${stamp}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    setNotice('Attendee CSV export downloaded.');
  }

  function exportDonationsCsv() {
    if (filteredDonations.length === 0) {
      setNotice('No donations available to export for the current filters.');
      return;
    }

    const rows: Array<Array<unknown>> = [
      [
        'payment_intent_id',
        'created_at',
        'status',
        'amount',
        'amount_cents',
        'currency',
        'donor_name',
        'donor_email',
        'receipt_email',
        'recognition_preference',
        'donation_option_name',
        'donation_level_title',
        'donation_level_amount_label',
        'destination_pile',
        'thank_you_email_sent'
      ]
    ];

    filteredDonations.forEach((donation) => {
      const destination = getDonationDestinationParts(donation);
      rows.push([
        donation.paymentIntentId,
        donation.createdAt,
        donation.status,
        formatMoney(donation.amountCents, donation.currency),
        donation.amountCents,
        donation.currency.toUpperCase(),
        donation.donorName || 'Supporter',
        donation.donorEmail || '',
        donation.receiptEmail || '',
        donation.donorRecognitionPreference,
        destination.optionName,
        destination.levelTitle,
        donation.donationLevelAmountLabel || '',
        destination.pileName,
        donation.thankYouEmailSent ? 'yes' : 'no'
      ]);
    });

    const csv = buildCsv(rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().slice(0, 10);

    const link = document.createElement('a');
    link.href = url;
    link.download = `fundraising-donations-${stamp}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    setNotice(`Donation CSV export downloaded (${filteredDonations.length} row${filteredDonations.length === 1 ? '' : 's'}).`);
  }

  async function purgeFundraisingEventOrders() {
    if (!selectedEventId || purgingOrders) {
      return;
    }

    const eventName = selectedEvent?.title || 'this fundraising event';
    const confirmation = window.prompt(
      `Type DELETE to permanently remove all orders for "${eventName}". This cannot be undone.`
    );
    if (confirmation !== 'DELETE') {
      return;
    }

    setPurgingOrders(true);
    setAttendeesError(null);
    setError(null);
    setNotice(null);

    try {
      const response = await adminFetch<{
        success: boolean;
        summary: {
          ordersDeleted: number;
          ticketsDeleted: number;
          orderSeatsDeleted: number;
          submissionsDeleted: number;
          seatsResetToAvailable: number;
          pendingStudentCreditsReleased: number;
        };
      }>(`/api/admin/fundraising/events/${encodeURIComponent(selectedEventId)}/orders`, {
        method: 'DELETE'
      });

      setExpandedAttendeeOrderId(null);
      await Promise.all([loadAttendees(selectedEventId), loadEvents()]);
      setNotice(
        `Deleted ${response.summary.ordersDeleted} order(s), ${response.summary.ticketsDeleted} ticket(s), and ${response.summary.submissionsDeleted} questionnaire response(s).`
      );
    } catch (err) {
      setAttendeesError(err instanceof Error ? err.message : 'We hit a small backstage snag while trying to delete orders for this fundraising event');
    } finally {
      setPurgingOrders(false);
    }
  }

  useEffect(() => {
    void loadEvents();
    void loadSponsors();
    void loadDonations();
    void loadDonationOptions();
  }, []);

  useEffect(() => {
    if (tab !== 'attendees') return;
    if (!selectedEventId) {
      setAttendeeRows([]);
      setAttendeeSummary(null);
      return;
    }
    void loadAttendees(selectedEventId);
  }, [selectedEventId, tab]);

  useEffect(() => {
    if (donationOptions.length === 0) return;
    if (!donationOptions.some((option) => option.id === selectedDonationOptionId)) {
      setSelectedDonationOptionId(donationOptions[0]?.id || '');
      setSelectedDonationLevelId(null);
      setSelectedDonationAmountCents(null);
      setActiveDonationIntent(null);
    }
  }, [donationOptions, selectedDonationOptionId]);

  useEffect(() => {
    if (!selectedDonationOption) return;
    if (!selectedDonationLevelId) return;
    if (!selectedDonationOption.levels.some((level) => level.id === selectedDonationLevelId)) {
      setSelectedDonationLevelId(null);
      setSelectedDonationAmountCents(null);
      setActiveDonationIntent(null);
    }
  }, [selectedDonationLevelId, selectedDonationOption]);

  const goTo = (next: number) => {
    setDir(next > step ? 1 : -1);
    setStep(next);
    setError(null);
  };

  function closeWizard() {
    setShowWizard(false);
    setEditingId(null);
    setForm(createInitialForm());
    setStep(0);
    setError(null);
    setIsPosterUploading(false);
  }

  function startNewEvent() {
    setEditingId(null);
    setSelectedEventId('');
    setForm(createInitialForm());
    setShowWizard(true);
    setStep(0);
    setError(null);
    setNotice('Creating a new fundraising event.');
  }

  function startEditEvent(event: FundraiseEvent) {
    setEditingId(event.id);
    setSelectedEventId(event.id);
    setForm({
      title: event.title,
      description: event.showDescription || '',
      posterUrl: event.showPosterUrl || '',
      startsAt: event.startsAt.slice(0, 16),
      endsAt: event.endsAt ? event.endsAt.slice(0, 16) : '',
      salesCutoffAt: event.salesCutoffAt ? event.salesCutoffAt.slice(0, 16) : '',
      venue: event.venue,
      notes: event.notes || '',
      tiersText: event.pricingTiers.map((tier) => `${tier.name}:${tier.priceCents}`).join('\n'),
      seatSelectionEnabled: event.seatSelectionEnabled !== false,
      generalAdmissionCapacity: String(Math.max(event.seatsTotal, GENERAL_ADMISSION_CAPACITY_MIN))
    });
    setNotice(`Editing "${event.title}".`);
    setError(null);
    setStep(0);
    setShowWizard(true);
  }

  const handlePosterUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setError(null);
    setIsPosterUploading(true);
    try {
      const uploaded = await uploadAdminImage(file, {
        maxWidth: 1400,
        maxHeight: 1900,
        scope: 'fundraise-posters',
        filenameBase: form.title || 'fundraising-event'
      });
      setForm((prev) => ({ ...prev, posterUrl: uploaded.url }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setIsPosterUploading(false);
    }
  };

  async function saveEvent() {
    if (!form.title.trim()) {
      setError('Event title is required.');
      return;
    }
    if (!form.startsAt.trim()) {
      setError('Event date/time is required.');
      return;
    }
    if (form.endsAt) {
      const startMs = Date.parse(form.startsAt);
      const endMs = Date.parse(form.endsAt);
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
        setError('End date/time must be later than the start date/time.');
        return;
      }
    }
    if (tiers.length === 0) {
      setError('Add at least one pricing tier in Name:PriceCents format.');
      return;
    }
    const generalAdmissionCapacity = Number.parseInt(form.generalAdmissionCapacity, 10);
    if (!form.seatSelectionEnabled) {
      if (!Number.isInteger(generalAdmissionCapacity)) {
        setError('Enter a whole number for general admission ticket capacity.');
        return;
      }
      if (
        generalAdmissionCapacity < GENERAL_ADMISSION_CAPACITY_MIN ||
        generalAdmissionCapacity > GENERAL_ADMISSION_CAPACITY_MAX
      ) {
        setError(
          `General admission ticket capacity must be between ${GENERAL_ADMISSION_CAPACITY_MIN} and ${GENERAL_ADMISSION_CAPACITY_MAX}.`
        );
        return;
      }
    }

    setSaving(true);
    setError(null);
    setNotice(null);

    const payload = {
      title: form.title.trim(),
      description: form.description.trim() || undefined,
      posterUrl: form.posterUrl.trim() || undefined,
      type: 'Fundraiser',
      isFundraiser: true,
      staffCompsEnabled: true,
      staffCompLimitPerUser: 1,
      staffTicketLimit: 2,
      studentCompTicketsEnabled: false,
      seatSelectionEnabled: form.seatSelectionEnabled,
      generalAdmissionCapacity: !form.seatSelectionEnabled ? generalAdmissionCapacity : undefined,
      venue: form.venue.trim() || 'Penncrest High School Auditorium',
      notes: form.notes.trim() || undefined,
      pricingTiers: tiers
    };

    try {
      if (editingId) {
        await adminFetch(`/api/admin/performances/${editingId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            ...payload,
            startsAt: new Date(form.startsAt).toISOString(),
            endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
            salesCutoffAt: form.salesCutoffAt ? new Date(form.salesCutoffAt).toISOString() : null
          })
        });
        setNotice('Fundraising event updated.');
      } else {
        const created = await adminFetch<{ id: string }>('/api/admin/performances', {
          method: 'POST',
          body: JSON.stringify({
            ...payload,
            performances: [
              {
                title: form.title.trim(),
                startsAt: new Date(form.startsAt).toISOString(),
                endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
                salesCutoffAt: form.salesCutoffAt ? new Date(form.salesCutoffAt).toISOString() : null
              }
            ]
          })
        });
        setEditingId(created.id);
        setSelectedEventId(created.id);
        setNotice('Fundraising event created.');
      }

      await loadEvents();
      closeWizard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We hit a small backstage snag while trying to save fundraising event');
    } finally {
      setSaving(false);
    }
  }

  async function archiveEvent(event: FundraiseEvent) {
    if (!window.confirm(`Archive "${event.title}"?`)) return;

    setError(null);
    try {
      await adminFetch(`/api/admin/performances/${event.id}/archive`, { method: 'POST' });
      setNotice(`Archived "${event.title}".`);
      setEditingId(null);
      setSelectedEventId('');
      setForm(createInitialForm());
      setShowWizard(false);
      await loadEvents();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We hit a small backstage snag while trying to archive fundraising event');
    }
  }

  const goToSponsorStep = (next: number) => {
    setSponsorDir(next > sponsorStep ? 1 : -1);
    setSponsorStep(next);
    setSponsorError(null);
  };

  function closeSponsorWizard() {
    setShowSponsorWizard(false);
    setSponsorEditingId(null);
    setSponsorForm(createInitialSponsorForm());
    setSponsorStep(0);
    setSponsorError(null);
    setIsSponsorLogoUploading(false);
    setIsSponsorImageUploading(false);
  }

  function startNewSponsor() {
    setSponsorEditingId(null);
    setSponsorForm(createInitialSponsorForm());
    setShowSponsorWizard(true);
    setSponsorStep(0);
    setSponsorError(null);
    setNotice('Creating a new sponsor.');
  }

  function startEditSponsor(sponsor: FundraisingSponsor) {
    setSponsorEditingId(sponsor.id);
    setSponsorForm({
      name: sponsor.name,
      tier: sponsor.tier,
      logoUrl: sponsor.logoUrl,
      imageUrl: sponsor.imageUrl,
      spotlight: sponsor.spotlight,
      websiteUrl: sponsor.websiteUrl
    });
    setShowSponsorWizard(true);
    setSponsorStep(0);
    setSponsorError(null);
    setNotice(`Editing sponsor "${sponsor.name}".`);
  }

  const handleSponsorLogoUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setSponsorError(null);
    setIsSponsorLogoUploading(true);
    try {
      const uploaded = await uploadAdminImage(file, {
        maxWidth: 800,
        maxHeight: 320,
        scope: 'fundraise-sponsor-logos',
        filenameBase: sponsorForm.name || 'fundraising-sponsor-logo'
      });
      setSponsorForm((prev) => ({ ...prev, logoUrl: uploaded.url }));
    } catch (err) {
      setSponsorError(err instanceof Error ? err.message : 'We hit a small backstage snag while trying to upload sponsor logo');
    } finally {
      setIsSponsorLogoUploading(false);
    }
  };

  const handleSponsorImageUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setSponsorError(null);
    setIsSponsorImageUploading(true);
    try {
      const uploaded = await uploadAdminImage(file, {
        maxWidth: 1600,
        maxHeight: 1000,
        scope: 'fundraise-sponsor-images',
        filenameBase: sponsorForm.name || 'fundraising-sponsor-image'
      });
      setSponsorForm((prev) => ({ ...prev, imageUrl: uploaded.url }));
    } catch (err) {
      setSponsorError(err instanceof Error ? err.message : 'We hit a small backstage snag while trying to upload sponsor image');
    } finally {
      setIsSponsorImageUploading(false);
    }
  };

  async function saveSponsor() {
    if (!sponsorForm.name.trim()) {
      setSponsorError('Sponsor name is required.');
      return;
    }
    if (!sponsorForm.websiteUrl.trim()) {
      setSponsorError('Sponsor website is required.');
      return;
    }
    if (!sponsorForm.logoUrl) {
      setSponsorError('Upload a sponsor logo.');
      return;
    }
    if (!sponsorForm.imageUrl) {
      setSponsorError('Upload a sponsor spotlight image.');
      return;
    }
    if (!sponsorForm.spotlight.trim()) {
      setSponsorError('Sponsor spotlight text is required.');
      return;
    }

    setSponsorSaving(true);
    setSponsorError(null);
    setNotice(null);
    const payload = {
      name: sponsorForm.name.trim(),
      tier: sponsorForm.tier,
      logoUrl: sponsorForm.logoUrl,
      imageUrl: sponsorForm.imageUrl,
      spotlight: sponsorForm.spotlight.trim(),
      websiteUrl: sponsorForm.websiteUrl.trim()
    };

    try {
      if (sponsorEditingId) {
        await adminFetch(`/api/admin/fundraising/sponsors/${sponsorEditingId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload)
        });
        setNotice('Sponsor updated.');
      } else {
        await adminFetch('/api/admin/fundraising/sponsors', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        setNotice('Sponsor created.');
      }
      await loadSponsors();
      closeSponsorWizard();
    } catch (err) {
      setSponsorError(err instanceof Error ? err.message : 'We hit a small backstage snag while trying to save sponsor');
    } finally {
      setSponsorSaving(false);
    }
  }

  async function deleteSponsor(sponsor: FundraisingSponsor) {
    if (!window.confirm(`Delete sponsor "${sponsor.name}"?`)) return;
    setDeletingSponsorId(sponsor.id);
    setSponsorError(null);
    try {
      await adminFetch(`/api/admin/fundraising/sponsors/${sponsor.id}`, { method: 'DELETE' });
      setNotice(`Deleted sponsor "${sponsor.name}".`);
      if (sponsorEditingId === sponsor.id) {
        closeSponsorWizard();
      }
      await loadSponsors();
    } catch (err) {
      setSponsorError(err instanceof Error ? err.message : 'We hit a small backstage snag while trying to delete sponsor');
    } finally {
      setDeletingSponsorId(null);
    }
  }

  function addDonationOption() {
    const created = createDonationOptionDraft();
    setDonationOptions((prev) => [...prev, created]);
    setSelectedDonationOptionId(created.id);
    setSelectedDonationLevelId(null);
    setSelectedDonationAmountCents(null);
    setActiveDonationIntent(null);
    setDonationOptionsError(null);
  }

  function removeDonationOption(optionId: string) {
    setDonationOptions((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((option) => option.id !== optionId);
    });
    setSelectedDonationLevelId(null);
    setSelectedDonationAmountCents(null);
    setActiveDonationIntent(null);
    setDonationOptionsError(null);
  }

  function updateDonationOptionField(
    optionId: string,
    field: 'name' | 'description',
    value: string
  ) {
    setDonationOptions((prev) =>
      prev.map((option) => (option.id === optionId ? { ...option, [field]: value } : option))
    );
    setDonationOptionsError(null);
  }

  function addDonationLevel(optionId: string) {
    const created = createDonationLevelDraft();
    setDonationOptions((prev) =>
      prev.map((option) =>
        option.id === optionId
          ? {
              ...option,
              levels: [...option.levels, created]
            }
          : option
      )
    );
    setSelectedDonationOptionId(optionId);
    setSelectedDonationLevelId(created.id);
    setSelectedDonationAmountCents(created.suggestedAmountCents);
    setActiveDonationIntent(null);
    setDonationOptionsError(null);
  }

  function removeDonationLevel(optionId: string, levelId: string) {
    setDonationOptions((prev) =>
      prev.map((option) => {
        if (option.id !== optionId || option.levels.length <= 1) return option;
        return {
          ...option,
          levels: option.levels.filter((level) => level.id !== levelId)
        };
      })
    );
    if (selectedDonationLevelId === levelId) {
      setSelectedDonationLevelId(null);
      setSelectedDonationAmountCents(null);
      setActiveDonationIntent(null);
    }
    setDonationOptionsError(null);
  }

  function updateDonationLevelField(
    optionId: string,
    levelId: string,
    field: 'amountLabel' | 'title' | 'detail' | 'suggestedAmountCents',
    value: string
  ) {
    setDonationOptions((prev) =>
      prev.map((option) => {
        if (option.id !== optionId) return option;
        return {
          ...option,
          levels: option.levels.map((level) => {
            if (level.id !== levelId) return level;
            if (field === 'suggestedAmountCents') {
              const next = Number.parseInt(value, 10);
              return {
                ...level,
                suggestedAmountCents: Number.isFinite(next) ? Math.max(100, next) : level.suggestedAmountCents
              };
            }
            return {
              ...level,
              [field]: value
            };
          })
        };
      })
    );
    setDonationOptionsError(null);
  }

  async function saveDonationOptions() {
    if (donationOptions.length === 0) {
      setDonationOptionsError('Add at least one donation option.');
      return;
    }

    const normalizedOptions = donationOptions.map((option, optionIndex) => ({
      ...option,
      id: buildDonationOptionId(option.id || option.name || `option-${optionIndex + 1}`),
      name: option.name.trim(),
      description: option.description.trim(),
      levels: option.levels.map((level, levelIndex) => ({
        ...level,
        id: buildDonationLevelId(level.id || level.title || `level-${levelIndex + 1}`),
        amountLabel: level.amountLabel.trim(),
        title: level.title.trim(),
        detail: level.detail.trim(),
        suggestedAmountCents: Math.max(100, Math.round(level.suggestedAmountCents))
      }))
    }));

    const hasInvalidOption = normalizedOptions.some(
      (option) => !option.name || option.levels.length === 0 || option.levels.some((level) => !level.amountLabel || !level.title || !level.detail)
    );
    if (hasInvalidOption) {
      setDonationOptionsError('Each option needs a name and at least one complete level.');
      return;
    }

    setDonationOptionsSaving(true);
    setDonationOptionsError(null);
    try {
      const saved = await adminFetch<DonationOptionsAdminPayload>('/api/admin/fundraising/donation-options', {
        method: 'PUT',
        body: JSON.stringify({
          options: normalizedOptions
        })
      });
      const options = Array.isArray(saved.options) && saved.options.length > 0 ? saved.options : normalizedOptions;
      setDonationOptions(options);
      setDonationOptionsCustomized(Boolean(saved.isCustomized ?? true));
      setDonationOptionsUpdatedAt(saved.updatedAt || new Date().toISOString());
      setSelectedDonationOptionId((current) => (options.some((option) => option.id === current) ? current : options[0]?.id || ''));
      setNotice('Donation options saved.');
      setActiveDonationIntent(null);
    } catch (err) {
      setDonationOptionsError(err instanceof Error ? err.message : 'We hit a small backstage snag while trying to save donation options');
    } finally {
      setDonationOptionsSaving(false);
    }
  }

  async function requestDonationIntent(amountCents: number, level: FundraisingDonationOption['levels'][number] | null) {
    const normalizedDonorName = donorName.trim();
    const normalizedDonorEmail = donorEmail.trim().toLowerCase();
    if (!normalizedDonorName) {
      setDonationError('Please enter the donor name before charging.');
      return;
    }
    if (!normalizedDonorEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedDonorEmail)) {
      setDonationError('Please enter a valid donor email for Stripe receipt + thank-you email.');
      return;
    }
    if (!selectedDonationOption) {
      setDonationError('Donation options are still loading. Try again in a moment.');
      return;
    }

    setDonationIntentLoading(true);
    setDonationError(null);
    setDonationSuccessMessage(null);
    setSelectedDonationAmountCents(amountCents);
    setSelectedDonationLevelId(level?.id || null);

    try {
      const response = await apiFetch<DonationIntentResponse>('/api/fundraising/donations/intent', {
        method: 'POST',
        body: JSON.stringify({
          amountCents,
          donorName: normalizedDonorName,
          donorEmail: normalizedDonorEmail,
          donorRecognitionPreference,
          donationOptionId: selectedDonationOption.id,
          donationOptionName: selectedDonationOption.name,
          donationLevelId: level?.id,
          donationLevelTitle: level?.title,
          donationLevelAmountLabel: level?.amountLabel
        })
      });

      const publishableKey = (response.publishableKey || FALLBACK_STRIPE_PUBLISHABLE_KEY || '').trim();
      if (!publishableKey) {
        throw new Error('Stripe publishable key is missing.');
      }

      setActiveDonationIntent({
        paymentIntentId: response.paymentIntentId,
        clientSecret: response.clientSecret,
        publishableKey,
        amountCents: response.amountCents
      });
    } catch (err) {
      setActiveDonationIntent(null);
      setDonationError(err instanceof Error ? err.message : 'We could not start card checkout.');
    } finally {
      setDonationIntentLoading(false);
    }
  }

  function handleOtherDonationSelect() {
    setSelectedDonationAmountCents(null);
    setSelectedDonationLevelId(null);
    setActiveDonationIntent(null);
    setDonationError(null);
    setDonationSuccessMessage(null);
    requestAnimationFrame(() => customAmountInputRef.current?.focus());
  }

  function applyCustomDonationAmount() {
    const amountCents = parseDonationInputToCents(customDonationAmount);
    if (!amountCents) {
      setDonationError('Enter a valid donation amount of at least $1.00.');
      return;
    }
    void requestDonationIntent(amountCents, null);
  }

  const primaryActionLabel =
    tab === 'events'
      ? 'New Fundraising Event'
      : tab === 'sponsors'
        ? 'New Sponsor'
        : tab === 'attendees'
          ? 'Refresh Ticket Responses'
          : 'Refresh Donations';

  const stepContent: ReactNode[] = [
    <div key="event" className="space-y-5">
      <div>
        <label className={labelClass}>Event Title</label>
        <input
          value={form.title}
          onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
          placeholder="e.g. Spring Cabaret Night"
          className={inputClass}
          style={{ fontSize: '1.05rem', fontFamily: 'var(--font-sans)' }}
        />
      </div>
      <div>
        <label className={labelClass}>Description</label>
        <textarea
          value={form.description}
          onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
          rows={4}
          className={`${inputClass} resize-none`}
          placeholder="Short public summary for the fundraising page."
        />
      </div>
      <div>
        <label className={labelClass}>Venue</label>
        <div className="relative">
          <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-300" />
          <input
            value={form.venue}
            onChange={(event) => setForm((prev) => ({ ...prev, venue: event.target.value }))}
            className={`${inputClass} pl-10`}
            placeholder="Venue name"
          />
        </div>
      </div>
      <div>
        <label className={labelClass}>
          Notes <span className="normal-case font-normal text-stone-300">(internal only)</span>
        </label>
        <input
          value={form.notes}
          onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
          className={inputClass}
          placeholder="Anything your team should remember for this fundraiser"
        />
      </div>
      <div>
        <label className={labelClass}>Poster</label>
        <div className="flex items-start gap-3">
          {form.posterUrl ? (
            <img
              src={form.posterUrl}
              alt="Fundraiser poster"
              className="h-20 w-14 flex-shrink-0 rounded-xl border border-stone-100 object-cover shadow-sm"
            />
          ) : (
            <div className="flex h-20 w-14 flex-shrink-0 items-center justify-center rounded-xl bg-stone-100">
              <ImageIcon className="h-5 w-5 text-stone-300" />
            </div>
          )}
          <div className="space-y-2">
            <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs font-semibold text-stone-600 transition hover:bg-white">
              <Upload className="h-3.5 w-3.5" />
              <input type="file" accept="image/*" className="hidden" onChange={(event) => void handlePosterUpload(event)} />
              {isPosterUploading ? 'Uploading…' : form.posterUrl ? 'Replace image' : 'Upload image'}
            </label>
            <p className="text-xs text-stone-400">Use upload only. Image links are not required.</p>
            {form.posterUrl ? (
              <button
                type="button"
                onClick={() => setForm((prev) => ({ ...prev, posterUrl: '' }))}
                className="block text-xs text-red-400 transition hover:text-red-600"
              >
                Remove
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>,

    <div key="schedule" className="space-y-4">
      <p className="text-sm leading-relaxed text-stone-400">Set the fundraiser date and optional sales cutoff.</p>
      <div className="rounded-xl border border-stone-100 bg-stone-50 p-4 space-y-3">
        <div>
          <label className="mb-1 block text-xs text-stone-400">Start date & time</label>
          <input
            type="datetime-local"
            value={form.startsAt}
            onChange={(event) => setForm((prev) => ({ ...prev, startsAt: event.target.value }))}
            className={inputClass}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-stone-400">
            End date & time <span className="text-stone-300">(optional)</span>
          </label>
          <input
            type="datetime-local"
            value={form.endsAt}
            onChange={(event) => setForm((prev) => ({ ...prev, endsAt: event.target.value }))}
            className={inputClass}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-stone-400">
            Sales cutoff <span className="text-stone-300">(optional)</span>
          </label>
          <input
            type="datetime-local"
            value={form.salesCutoffAt}
            onChange={(event) => setForm((prev) => ({ ...prev, salesCutoffAt: event.target.value }))}
            className={inputClass}
          />
        </div>
      </div>
    </div>,

    <div key="tickets" className="space-y-5">
      <div>
        <label className={labelClass}>Pricing Tiers</label>
        <p className="mb-2 text-xs text-stone-300">
          One per line - <code className="rounded bg-stone-100 px-1 text-stone-500">Name:PriceCents</code>
        </p>
        <textarea
          value={form.tiersText}
          onChange={(event) => setForm((prev) => ({ ...prev, tiersText: event.target.value }))}
          rows={4}
          placeholder={'Adult:1800\nStudent:1200'}
          className={`${inputClass} resize-none font-sans text-xs`}
        />
        {tiers.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {tiers.map((tier) => (
              <span
                key={`${tier.name}-${tier.priceCents}`}
                className="rounded-full border border-red-100 bg-red-50 px-3 py-1 text-xs font-semibold text-red-700"
              >
                {tier.name} · ${(tier.priceCents / 100).toFixed(2)}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <div className="rounded-xl border border-stone-200 bg-stone-50 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-stone-800">Seat selection on checkout</p>
            <p className="text-xs text-stone-500">
              On: buyers pick seats. Off: buyers pick quantity and seats are auto-assigned.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={form.seatSelectionEnabled}
            onClick={() => setForm((prev) => ({ ...prev, seatSelectionEnabled: !prev.seatSelectionEnabled }))}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
              form.seatSelectionEnabled
                ? 'border-emerald-200 bg-emerald-100 text-emerald-800'
                : 'border-stone-200 bg-stone-100 text-stone-500'
            }`}
          >
            {form.seatSelectionEnabled ? 'On' : 'Off'}
          </button>
        </div>
      </div>
      <div className="rounded-xl border border-stone-200 bg-stone-50 p-4">
        <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-stone-500">
          General Admission Ticket Capacity
        </label>
        <input
          type="number"
          min={GENERAL_ADMISSION_CAPACITY_MIN}
          max={GENERAL_ADMISSION_CAPACITY_MAX}
          value={form.generalAdmissionCapacity}
          onChange={(event) =>
            setForm((prev) => ({
              ...prev,
              generalAdmissionCapacity: event.target.value
            }))
          }
          disabled={form.seatSelectionEnabled}
          className={`${inputClass} disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-stone-400`}
        />
        <p className="mt-2 text-xs text-stone-500">
          {form.seatSelectionEnabled
            ? 'Turn off seat selection to enforce a fixed ticket count for this fundraiser.'
            : `This event will cap sales at this many general admission tickets.`}
        </p>
      </div>
    </div>,

    <div key="review" className="space-y-4">
      <p className="text-sm text-stone-400">Review fundraiser details before saving.</p>
      <div className="overflow-hidden rounded-2xl border border-stone-100 bg-white divide-y divide-stone-100">
        {[
          { label: 'Title', value: form.title || <span className="font-semibold text-red-400">Missing!</span> },
          { label: 'Description', value: form.description || <span className="text-stone-300">None</span> },
          { label: 'Venue', value: form.venue || <span className="font-semibold text-red-400">Missing!</span> },
          {
            label: 'Start',
            value: form.startsAt
              ? new Date(form.startsAt).toLocaleString()
              : <span className="font-semibold text-red-400">Missing!</span>
          },
          {
            label: 'End',
            value: form.endsAt ? new Date(form.endsAt).toLocaleString() : <span className="text-stone-300">None</span>
          },
          {
            label: 'Cutoff',
            value: form.salesCutoffAt ? new Date(form.salesCutoffAt).toLocaleString() : <span className="text-stone-300">None</span>
          },
          {
            label: 'Pricing',
            value:
              tiers.length > 0
                ? tiers.map((tier) => `${tier.name} $${(tier.priceCents / 100).toFixed(2)}`).join(' · ')
                : <span className="font-semibold text-red-400">Missing!</span>
          },
          {
            label: 'Seat selection',
            value: form.seatSelectionEnabled ? 'Enabled' : 'Auto-assign mode'
          },
          {
            label: 'GA ticket capacity',
            value: form.seatSelectionEnabled ? 'Not used' : form.generalAdmissionCapacity || 'Missing'
          }
        ].map(({ label, value }) => (
          <div key={label} className="flex flex-col gap-1 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <span className="text-stone-400">{label}</span>
            <span className="max-w-full font-semibold text-stone-800 sm:max-w-[58%] sm:text-right">{value}</span>
          </div>
        ))}
      </div>
      {form.posterUrl ? (
        <div className="flex items-center gap-3">
          <img
            src={form.posterUrl}
            alt="Poster preview"
            className="h-14 w-10 rounded-lg border border-stone-100 object-cover shadow-sm"
          />
          <span className="text-sm text-stone-400">Poster attached</span>
          <Check className="h-4 w-4 text-green-500" />
        </div>
      ) : (
        <p className="text-xs text-stone-400">No poster uploaded yet.</p>
      )}
    </div>
  ];

  const sponsorStepContent: ReactNode[] = [
    <div key="sponsor-brand" className="space-y-5">
      <div>
        <label className={labelClass}>Sponsor Name</label>
        <input
          value={sponsorForm.name}
          onChange={(event) => setSponsorForm((prev) => ({ ...prev, name: event.target.value }))}
          placeholder="e.g. Main Street Bank"
          className={inputClass}
        />
      </div>
      <div>
        <label className={labelClass}>Sponsorship Level</label>
        <select
          value={sponsorForm.tier}
          onChange={(event) => setSponsorForm((prev) => ({ ...prev, tier: event.target.value as SponsorForm['tier'] }))}
          className={inputClass}
        >
          <option value="Balcony">Balcony</option>
          <option value="Mezzanine">Mezzanine</option>
          <option value="Orchestra">Orchestra</option>
          <option value="Center Stage">Center Stage</option>
        </select>
      </div>
      <div>
        <label className={labelClass}>Website URL</label>
        <div className="relative">
          <Globe className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-300" />
          <input
            value={sponsorForm.websiteUrl}
            onChange={(event) => setSponsorForm((prev) => ({ ...prev, websiteUrl: event.target.value }))}
            placeholder="https://example.com"
            className={`${inputClass} pl-10`}
          />
        </div>
      </div>
    </div>,

    <div key="sponsor-media" className="space-y-5">
      <div>
        <label className={labelClass}>Sponsor Logo</label>
        <div className="flex items-start gap-3">
          {sponsorForm.logoUrl ? (
            <img
              src={sponsorForm.logoUrl}
              alt="Sponsor logo"
              className="h-16 w-24 rounded-xl border border-stone-100 object-contain bg-white p-2"
            />
          ) : (
            <div className="flex h-16 w-24 items-center justify-center rounded-xl bg-stone-100">
              <ImageIcon className="h-5 w-5 text-stone-300" />
            </div>
          )}
          <div className="space-y-2">
            <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs font-semibold text-stone-600 transition hover:bg-white">
              <Upload className="h-3.5 w-3.5" />
              <input type="file" accept="image/*" className="hidden" onChange={(event) => void handleSponsorLogoUpload(event)} />
              {isSponsorLogoUploading ? 'Uploading…' : sponsorForm.logoUrl ? 'Replace logo' : 'Upload logo'}
            </label>
            {sponsorForm.logoUrl ? (
              <button
                type="button"
                onClick={() => setSponsorForm((prev) => ({ ...prev, logoUrl: '' }))}
                className="block text-xs text-red-400 transition hover:text-red-600"
              >
                Remove
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div>
        <label className={labelClass}>Sponsor Spotlight Image</label>
        <div className="flex items-start gap-3">
          {sponsorForm.imageUrl ? (
            <img
              src={sponsorForm.imageUrl}
              alt="Sponsor spotlight"
              className="h-20 w-32 rounded-xl border border-stone-100 object-cover"
            />
          ) : (
            <div className="flex h-20 w-32 items-center justify-center rounded-xl bg-stone-100">
              <ImageIcon className="h-5 w-5 text-stone-300" />
            </div>
          )}
          <div className="space-y-2">
            <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs font-semibold text-stone-600 transition hover:bg-white">
              <Upload className="h-3.5 w-3.5" />
              <input type="file" accept="image/*" className="hidden" onChange={(event) => void handleSponsorImageUpload(event)} />
              {isSponsorImageUploading ? 'Uploading…' : sponsorForm.imageUrl ? 'Replace image' : 'Upload image'}
            </label>
            {sponsorForm.imageUrl ? (
              <button
                type="button"
                onClick={() => setSponsorForm((prev) => ({ ...prev, imageUrl: '' }))}
                className="block text-xs text-red-400 transition hover:text-red-600"
              >
                Remove
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div>
        <label className={labelClass}>Sponsor Spotlight Text</label>
        <textarea
          value={sponsorForm.spotlight}
          onChange={(event) => setSponsorForm((prev) => ({ ...prev, spotlight: event.target.value }))}
          rows={4}
          className={`${inputClass} resize-none`}
          placeholder="Share how this sponsor supports the theater program."
        />
      </div>
    </div>,

    <div key="sponsor-review" className="space-y-4">
      <p className="text-sm text-stone-400">Review sponsor details before saving.</p>
      <div className="overflow-hidden rounded-2xl border border-stone-100 bg-white divide-y divide-stone-100">
        {[
          { label: 'Name', value: sponsorForm.name || <span className="font-semibold text-red-400">Missing!</span> },
          { label: 'Tier', value: sponsorForm.tier },
          { label: 'Website', value: sponsorForm.websiteUrl || <span className="font-semibold text-red-400">Missing!</span> },
          { label: 'Spotlight', value: sponsorForm.spotlight || <span className="text-stone-300">Missing</span> },
          { label: 'Logo', value: sponsorForm.logoUrl ? 'Uploaded' : <span className="font-semibold text-red-400">Missing!</span> },
          { label: 'Image', value: sponsorForm.imageUrl ? 'Uploaded' : <span className="font-semibold text-red-400">Missing!</span> }
        ].map(({ label, value }) => (
          <div key={label} className="flex flex-col gap-1 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <span className="text-stone-400">{label}</span>
            <span className="max-w-full font-semibold text-stone-800 sm:max-w-[58%] sm:text-right">{value}</span>
          </div>
        ))}
      </div>
      {sponsorForm.logoUrl && sponsorForm.imageUrl ? (
        <div className="flex items-center gap-3">
          <img src={sponsorForm.logoUrl} alt="Logo preview" className="h-10 w-16 rounded-lg border border-stone-100 object-contain bg-white p-1.5" />
          <img src={sponsorForm.imageUrl} alt="Image preview" className="h-10 w-16 rounded-lg border border-stone-100 object-cover" />
          <Check className="h-4 w-4 text-green-500" />
        </div>
      ) : null}
    </div>
  ];

  return (
    <div className="space-y-6" style={{ fontFamily: 'var(--font-sans)' }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-stone-900">Fundraise</h1>
          <p className="text-sm text-stone-600">
            Create fundraising events with the same guided workflow as performances.
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
          <Link
            to="/admin/fundraise/check-in"
            className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-stone-300 bg-white px-5 py-2.5 text-sm font-semibold text-stone-700 transition hover:bg-stone-100 sm:w-auto"
          >
            <CreditCard className="h-4 w-4" />
            Open Check-In
          </Link>
          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            type="button"
            onClick={() => {
              if (tab === 'events') {
                startNewEvent();
                return;
              }
              if (tab === 'sponsors') {
                startNewSponsor();
                return;
              }
              if (tab === 'attendees') {
                if (selectedEventId) {
                  void loadAttendees(selectedEventId);
                }
                return;
              }
              void loadDonations();
              void loadDonationOptions();
            }}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-red-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-red-100 transition hover:bg-red-800 sm:w-auto"
          >
            {tab === 'events' || tab === 'sponsors' ? <Plus className="h-4 w-4" /> : <RefreshCcw className="h-4 w-4" />}
            {primaryActionLabel}
          </motion.button>
        </div>
      </div>

      {notice ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</div>
      ) : null}
      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}
      {sponsorError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{sponsorError}</div>
      ) : null}
      {donationsError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{donationsError}</div>
      ) : null}
      {donationOptionsError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{donationOptionsError}</div>
      ) : null}
      {attendeesError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{attendeesError}</div>
      ) : null}

      <div className="inline-flex rounded-xl border border-stone-200 bg-white p-1">
        <button
          type="button"
          onClick={() => setTab('events')}
          className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
            tab === 'events' ? 'bg-rose-700 text-white' : 'text-stone-600 hover:text-stone-900'
          }`}
        >
          Events
        </button>
        <button
          type="button"
          onClick={() => setTab('sponsors')}
          className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
            tab === 'sponsors' ? 'bg-rose-700 text-white' : 'text-stone-600 hover:text-stone-900'
          }`}
        >
          Sponsors
        </button>
        <button
          type="button"
          onClick={() => setTab('attendees')}
          className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
            tab === 'attendees' ? 'bg-rose-700 text-white' : 'text-stone-600 hover:text-stone-900'
          }`}
        >
          Tickets & Responses
        </button>
        <button
          type="button"
          onClick={() => setTab('donations')}
          className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
            tab === 'donations' ? 'bg-rose-700 text-white' : 'text-stone-600 hover:text-stone-900'
          }`}
        >
          Donations
        </button>
      </div>

      {tab === 'events' ? (
        <div className="space-y-3">
          {loading ? (
            <div className="rounded-2xl border border-stone-200 bg-white py-14 text-center text-sm text-stone-500">
              Loading fundraising events...
            </div>
          ) : events.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-stone-200 py-14 text-center text-sm text-stone-400">
              No fundraising events yet.
            </div>
          ) : (
            events.map((event, idx) => {
              const pct = event.seatsTotal > 0 ? Math.round((event.seatsSold / event.seatsTotal) * 100) : 0;
              const inventoryLabel = event.seatSelectionEnabled ? 'seats' : 'tickets';
              const isSelected = event.id === selectedEvent?.id;
              return (
                <motion.div
                  key={event.id}
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.05 }}
                  className={`flex flex-col gap-4 rounded-2xl border bg-white p-4 transition-all hover:shadow-md sm:flex-row ${
                    isSelected ? 'border-rose-200 shadow-sm shadow-rose-100' : 'border-stone-100 hover:border-stone-200'
                  }`}
                >
                  {event.showPosterUrl ? (
                    <img
                      src={event.showPosterUrl}
                      alt={event.title}
                      className="h-16 w-12 flex-shrink-0 rounded-xl border border-stone-100 object-cover"
                    />
                  ) : (
                    <div className="flex h-16 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-stone-100">
                      <ImageIcon className="h-4 w-4 text-stone-300" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="font-bold text-stone-900">{event.title}</p>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => startEditEvent(event)}
                          className="rounded-lg border border-stone-200 px-2.5 py-1 text-xs font-semibold text-stone-500 transition hover:bg-stone-50 hover:text-stone-900"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedEventId(event.id);
                            setBuilderEventId(event.id);
                            setShowFormBuilder(true);
                          }}
                          className="rounded-lg border border-stone-200 px-2.5 py-1 text-xs font-semibold text-stone-500 transition hover:bg-stone-50 hover:text-stone-900"
                        >
                          Form Builder
                        </button>
                        <button
                          type="button"
                          onClick={() => void archiveEvent(event)}
                          className="rounded-lg border border-amber-200 px-2.5 py-1 text-xs font-semibold text-amber-700 transition hover:bg-amber-50"
                        >
                          Archive
                        </button>
                      </div>
                    </div>
                    <p className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-stone-400">
                      <Calendar className="h-3 w-3" />
                      {new Date(event.startsAt).toLocaleString()}
                      {event.endsAt ? ` - ${new Date(event.endsAt).toLocaleString()}` : ''}
                      <span className="text-stone-200">·</span>
                      <MapPin className="h-3 w-3" />
                      {event.venue}
                    </p>
                    <div className="mt-2.5">
                      <div className="mb-1 flex justify-between text-xs text-stone-400">
                        <span>
                          {event.seatsSold} / {event.seatsTotal} {inventoryLabel}
                        </span>
                        <span className={pct >= 90 ? 'font-bold text-red-500' : pct >= 60 ? 'font-semibold text-amber-500' : ''}>
                          {pct}%
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-stone-100">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${pct}%` }}
                          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1], delay: idx * 0.05 + 0.2 }}
                          className={`h-full rounded-full ${
                            pct >= 90 ? 'bg-red-500' : pct >= 60 ? 'bg-amber-400' : 'bg-emerald-400'
                          }`}
                        />
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-500">
                        {event.seatSelectionEnabled ? 'Seat map checkout' : 'Auto-assign checkout'}
                      </span>
                      {event.pricingTiers.map((tier) => (
                        <span key={tier.id} className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-500">
                          {tier.name} ${(tier.priceCents / 100).toFixed(2)}
                        </span>
                      ))}
                    </div>
                  </div>
                </motion.div>
              );
            })
          )}
        </div>
      ) : tab === 'sponsors' ? (
        <div className="rounded-2xl border border-stone-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-stone-900">Sponsor Showcase</h2>
              <p className="mt-1 text-sm text-stone-600">
                Upload-first sponsor management. Changes here update the public fundraising sponsor section.
              </p>
            </div>
            <button
              type="button"
              onClick={startNewSponsor}
              className="inline-flex items-center gap-2 rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-700 transition-colors hover:bg-stone-50"
            >
              <Plus className="h-4 w-4" />
              New Sponsor
            </button>
          </div>

          {sponsorsLoading ? (
            <div className="mt-5 rounded-xl border border-stone-200 bg-stone-50 px-4 py-8 text-center text-sm text-stone-500">
              Loading sponsors...
            </div>
          ) : sponsors.length === 0 ? (
            <div className="mt-5 rounded-xl border border-dashed border-stone-200 px-4 py-8 text-center text-sm text-stone-500">
              No sponsors yet. Add your first sponsor to populate the public banner and sponsor grid.
            </div>
          ) : (
            <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {sponsors.map((sponsor) => (
                <article key={sponsor.id} className="overflow-hidden rounded-2xl border border-stone-200 bg-white">
                  <img src={sponsor.imageUrl} alt={`${sponsor.name} spotlight`} className="h-36 w-full object-cover" />
                  <div className="p-4">
                    <div className="mb-2 inline-flex items-center gap-1 rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-600">
                      <Landmark className="h-3.5 w-3.5" />
                      {sponsor.tier}
                    </div>
                    <div className="mb-3 flex h-10 items-center">
                      <img src={sponsor.logoUrl} alt={sponsor.name} className="h-9 w-auto object-contain" />
                    </div>
                    <p className="text-sm font-semibold text-stone-900">{sponsor.name}</p>
                    <p className="mt-1 text-sm text-stone-600">{sponsor.spotlight}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => startEditSponsor(sponsor)}
                        className="inline-flex items-center gap-1 rounded-lg border border-stone-300 px-2.5 py-1 text-xs font-semibold text-stone-700 transition-colors hover:bg-stone-50"
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteSponsor(sponsor)}
                        disabled={deletingSponsorId === sponsor.id}
                        className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        {deletingSponsorId === sponsor.id ? 'Deleting…' : 'Delete'}
                      </button>
                      <a
                        href={sponsor.websiteUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex text-xs font-semibold text-rose-700 hover:text-rose-800"
                      >
                        Visit Sponsor
                      </a>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      ) : tab === 'attendees' ? (
        <div className="space-y-4">
          <section className="rounded-2xl border border-stone-200 bg-white p-5">
            <div className="flex flex-wrap items-end gap-3">
              <label className="min-w-[240px] flex-1 space-y-2">
                <span className="text-xs font-semibold uppercase tracking-[0.12em] text-stone-500">Fundraising Event</span>
                <select
                  value={selectedEventId}
                  onChange={(event) => setSelectedEventId(event.target.value)}
                  className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm text-stone-900 outline-none transition focus:border-red-500"
                >
                  {events.length === 0 ? <option value="">No events available</option> : null}
                  {events.map((eventItem) => (
                    <option key={eventItem.id} value={eventItem.id}>
                      {eventItem.title}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={() => {
                  if (selectedEventId) {
                    void loadAttendees(selectedEventId);
                  }
                }}
                disabled={!selectedEventId || attendeesLoading}
                className="inline-flex items-center gap-2 rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-stone-700 transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <RefreshCcw className={`h-4 w-4 ${attendeesLoading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
              <button
                type="button"
                onClick={exportAttendeesCsv}
                disabled={attendeesLoading || attendeeRows.length === 0}
                className="inline-flex items-center gap-2 rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-stone-700 transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Download CSV
              </button>
              <button
                type="button"
                onClick={() => void purgeFundraisingEventOrders()}
                disabled={!selectedEventId || attendeeRows.length === 0 || attendeesLoading || purgingOrders}
                className="inline-flex items-center gap-2 rounded-xl border border-red-300 bg-white px-4 py-2.5 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Trash2 className="h-4 w-4" />
                {purgingOrders ? 'Deleting Orders…' : 'Delete All Orders'}
              </button>
            </div>
          </section>

          <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-stone-200 bg-white px-4 py-3">
              <p className="text-[11px] uppercase tracking-[0.12em] text-stone-500">Orders</p>
              <p className="mt-1 text-xl font-bold text-stone-900">{attendeeSummary?.orderCount ?? attendeeRows.length}</p>
            </div>
            <div className="rounded-xl border border-stone-200 bg-white px-4 py-3">
              <p className="text-[11px] uppercase tracking-[0.12em] text-stone-500">Tickets</p>
              <p className="mt-1 text-xl font-bold text-stone-900">
                {attendeeSummary?.ticketCount ?? attendeeRows.reduce((sum, row) => sum + row.orderSeats.length, 0)}
              </p>
            </div>
            <div className="rounded-xl border border-stone-200 bg-white px-4 py-3">
              <p className="text-[11px] uppercase tracking-[0.12em] text-stone-500">Questionnaire Responses</p>
              <p className="mt-1 text-xl font-bold text-stone-900">
                {attendeeSummary?.responseCount ?? attendeeRows.filter((row) => Boolean(row.registrationSubmission)).length}
              </p>
            </div>
          </section>

          {attendeesLoading ? (
            <div className="rounded-2xl border border-stone-200 bg-white py-14 text-center text-sm text-stone-500">
              Loading tickets, attendees, and responses...
            </div>
          ) : attendeeRows.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-stone-200 bg-white py-14 text-center text-sm text-stone-500">
              No orders found for this fundraising event yet.
            </div>
          ) : (
            <div className="space-y-3">
              {attendeeRows.map((row) => {
                const attendees = row.orderSeats
                  .map((seat) => seat.attendeeName?.trim())
                  .filter((value): value is string => Boolean(value));
                const isExpanded = expandedAttendeeOrderId === row.id;
                return (
                  <article key={row.id} className="overflow-hidden rounded-2xl border border-stone-200 bg-white">
                    <button
                      type="button"
                      onClick={() => setExpandedAttendeeOrderId((current) => (current === row.id ? null : row.id))}
                      className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-stone-900">{row.customerName || row.email}</p>
                        <p className="mt-1 text-xs text-stone-500">
                          {new Date(row.createdAt).toLocaleString()} · {row.orderSeats.length} ticket{row.orderSeats.length === 1 ? '' : 's'} · {formatMoney(row.amountTotal, row.currency)}
                        </p>
                        <p className="mt-1 truncate text-xs text-stone-500">{row.email}</p>
                      </div>
                      <ChevronRight className={`h-4 w-4 shrink-0 text-stone-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                    </button>

                    {isExpanded ? (
                      <div className="border-t border-stone-100 px-5 py-4">
                        <div className="space-y-3">
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-500">Who Is Coming</p>
                            {attendees.length > 0 ? (
                              <div className="mt-2 flex flex-wrap gap-2">
                                {attendees.map((name, index) => (
                                  <span key={`${row.id}-attendee-${index}`} className="rounded-full border border-stone-200 bg-stone-50 px-2.5 py-1 text-xs font-medium text-stone-700">
                                    {name}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <p className="mt-2 text-sm text-stone-500">No attendee names entered on this order.</p>
                            )}
                          </div>

                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-500">Tickets</p>
                            <div className="mt-2 overflow-hidden rounded-xl border border-stone-200">
                              {row.orderSeats.map((seat, index) => (
                                <div key={`${row.id}-seat-${index}`} className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 px-3 py-2 text-sm last:border-b-0">
                                  <div>
                                    <p className="font-medium text-stone-800">{seat.seatLabel}</p>
                                    <p className="text-xs text-stone-500">
                                      {[seat.attendeeName, seat.ticketType, seat.isComplimentary ? 'Complimentary' : null].filter(Boolean).join(' · ') || 'No attendee metadata'}
                                    </p>
                                  </div>
                                  <span className="font-semibold text-stone-700">{formatUsd(seat.price)}</span>
                                </div>
                              ))}
                            </div>
                          </div>

                          <div>
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-500">Questionnaire Response</p>
                              {row.registrationSubmission ? (
                                <p className="text-xs text-stone-500">
                                  {row.registrationSubmission.form?.formName || 'Registration Form'}
                                  {row.registrationSubmission.formVersion?.versionNumber
                                    ? ` · Version ${row.registrationSubmission.formVersion.versionNumber}`
                                    : ''}
                                </p>
                              ) : null}
                            </div>
                            {row.registrationSubmission ? (
                              <>
                                <p className="mt-1 text-xs text-stone-500">
                                  Submitted {new Date(row.registrationSubmission.submittedAt).toLocaleString()}
                                </p>
                                <div className="mt-4 space-y-4">
                                  {/* Sections */}
                                  {row.registrationSubmission.responseJson?.sections && Object.entries(row.registrationSubmission.responseJson.sections).map(([sectionId, sectionData]) => (
                                    <div key={sectionId} className="rounded-xl border border-stone-200 bg-stone-50/50 p-4">
                                      <h4 className="mb-3 text-[11px] font-bold uppercase tracking-wider text-stone-600">{sectionId.replace(/[-_]/g, ' ')}</h4>
                                      {Array.isArray(sectionData) ? (
                                        <div className="space-y-3">
                                          {sectionData.map((childRow: any, idx) => (
                                            <div key={idx} className="rounded-lg bg-white p-4 shadow-sm border border-stone-100">
                                              <div className="mb-3 text-[10px] font-bold uppercase tracking-wider text-stone-400">Entry #{idx + 1}</div>
                                              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                                {Object.entries(childRow).map(([fieldId, value]) => (
                                                  <div key={fieldId}>
                                                    <div className="text-[10px] font-semibold uppercase text-stone-500 mb-0.5">{fieldId.replace(/[-_]/g, ' ')}</div>
                                                    <div className="text-sm text-stone-900 font-medium">
                                                      {Array.isArray(value) ? value.join(', ') : String(value === true ? 'Yes' : value === false ? 'No' : value || '-')}
                                                    </div>
                                                  </div>
                                                ))}
                                              </div>
                                            </div>
                                          ))}
                                        </div>
                                      ) : (
                                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 bg-white p-4 rounded-lg shadow-sm border border-stone-100">
                                          {Object.entries(sectionData as Record<string, any>).map(([fieldId, value]) => (
                                            <div key={fieldId}>
                                              <div className="text-[10px] font-semibold uppercase text-stone-500 mb-0.5">{fieldId.replace(/[-_]/g, ' ')}</div>
                                              <div className="text-sm text-stone-900 font-medium">
                                                {Array.isArray(value) ? value.join(', ') : String(value === true ? 'Yes' : value === false ? 'No' : value || '-')}
                                              </div>
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  ))}

                                  {/* Policies */}
                                  {row.registrationSubmission.responseJson?.policies && Object.keys(row.registrationSubmission.responseJson.policies).length > 0 && (
                                    <div className="rounded-xl border border-stone-200 bg-stone-50/50 p-4">
                                      <h4 className="mb-3 text-[11px] font-bold uppercase tracking-wider text-stone-600">Policies</h4>
                                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 bg-white p-4 rounded-lg shadow-sm border border-stone-100">
                                        {Object.entries(row.registrationSubmission.responseJson.policies).map(([policyId, value]) => (
                                          <div key={policyId}>
                                            <div className="text-[10px] font-semibold uppercase text-stone-500 mb-0.5">{policyId.replace(/[-_]/g, ' ')}</div>
                                            <div className="text-sm text-stone-900 font-medium">
                                              {String(value === true ? 'Yes' : value === false ? 'No' : value || '-')}
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}

                                  {/* Verification */}
                                  {(row.registrationSubmission.responseJson?.signature || row.registrationSubmission.responseJson?.acknowledgments) && (
                                    <div className="rounded-xl border border-stone-200 bg-stone-50/50 p-4">
                                      <h4 className="mb-3 text-[11px] font-bold uppercase tracking-wider text-stone-600">Verification</h4>
                                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 bg-white p-4 rounded-lg shadow-sm border border-stone-100">
                                        {row.registrationSubmission.responseJson.signature && Object.entries(row.registrationSubmission.responseJson.signature).map(([key, value]) => (
                                          <div key={key}>
                                            <div className="text-[10px] font-semibold uppercase text-stone-500 mb-0.5">{key.replace(/([A-Z])/g, ' $1').trim()}</div>
                                            <div className={`text-sm text-stone-900 ${key === 'typedName' ? 'font-["Dancing_Script",cursive,serif] italic text-lg' : 'font-medium'}`}>
                                              {String(value || '-')}
                                            </div>
                                          </div>
                                        ))}
                                        {row.registrationSubmission.responseJson.acknowledgments && Object.entries(row.registrationSubmission.responseJson.acknowledgments).map(([key, value]) => (
                                          <div key={key}>
                                            <div className="text-[10px] font-semibold uppercase text-stone-500 mb-0.5">{key.replace(/([A-Z])/g, ' $1').trim()}</div>
                                            <div className="text-sm text-stone-900 font-medium">
                                              {String(value === true ? 'Yes' : value === false ? 'No' : value || '-')}
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </>
                            ) : (
                              <p className="mt-2 text-sm text-stone-500">No questionnaire submission attached to this order.</p>
                            )}
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-5">
          <section className="relative overflow-hidden rounded-[30px] border border-stone-200 bg-white shadow-[0_24px_65px_rgba(12,10,9,0.09)]">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(239,68,68,0.13),transparent_42%),radial-gradient(circle_at_bottom_left,rgba(245,158,11,0.10),transparent_45%)]" />
            <div className="relative space-y-5 p-5 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-500">Always Open</p>
                  <h2 className="mt-1 text-2xl font-bold text-stone-900">Recent Donations</h2>
                  <p className="mt-1 text-sm text-stone-600">
                    Newest donations stay on top for quick visibility during live processing.
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => void loadDonations()}
                    className="inline-flex items-center gap-1 rounded-full border border-stone-300 bg-white px-3 py-1.5 text-xs font-semibold text-stone-700 transition hover:-translate-y-0.5 hover:border-stone-400 hover:shadow-sm"
                  >
                    <RefreshCcw className={`h-3.5 w-3.5 ${donationsLoading ? 'animate-spin' : ''}`} />
                    Refresh
                  </button>
                  <button
                    type="button"
                    onClick={exportDonationsCsv}
                    disabled={donationsLoading || sortedFilteredDonations.length === 0}
                    className="inline-flex items-center gap-1 rounded-full border border-stone-300 bg-white px-3 py-1.5 text-xs font-semibold text-stone-700 transition hover:-translate-y-0.5 hover:border-stone-400 hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Download CSV
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
                <div className="rounded-xl border border-red-100 bg-white/90 px-3 py-2.5">
                  <p className="text-[10px] uppercase tracking-[0.14em] text-stone-500">Donations</p>
                  <p className="mt-1 text-lg font-bold text-stone-900">{donationSummary?.count ?? donations.length}</p>
                </div>
                <div className="rounded-xl border border-red-100 bg-white/90 px-3 py-2.5">
                  <p className="text-[10px] uppercase tracking-[0.14em] text-stone-500">Succeeded</p>
                  <p className="mt-1 text-lg font-bold text-stone-900">
                    {donationSummary?.succeededCount ?? donations.filter((item) => item.status === 'succeeded').length}
                  </p>
                </div>
                <div className="rounded-xl border border-red-100 bg-white/90 px-3 py-2.5">
                  <p className="text-[10px] uppercase tracking-[0.14em] text-stone-500">Gross</p>
                  <p className="mt-1 text-lg font-bold text-stone-900">{formatUsd(donationSummary?.grossSucceededCents ?? 0)}</p>
                </div>
                <div className="rounded-xl border border-red-100 bg-white/90 px-3 py-2.5">
                  <p className="text-[10px] uppercase tracking-[0.14em] text-stone-500">Known</p>
                  <p className="mt-1 text-lg font-bold text-stone-900">{donationRecognitionTotals.known}</p>
                </div>
                <div className="rounded-xl border border-red-100 bg-white/90 px-3 py-2.5">
                  <p className="text-[10px] uppercase tracking-[0.14em] text-stone-500">Anonymous</p>
                  <p className="mt-1 text-lg font-bold text-stone-900">{donationRecognitionTotals.anonymous}</p>
                </div>
                <div className="rounded-xl border border-red-100 bg-white/90 px-3 py-2.5">
                  <p className="text-[10px] uppercase tracking-[0.14em] text-stone-500">Options</p>
                  <p className="mt-1 text-lg font-bold text-stone-900">{donationOptionStats.optionCount}</p>
                </div>
              </div>

              <div className="rounded-2xl border border-stone-200 bg-white/90 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-500">Donated by destination</p>
                  <p className="text-[11px] text-stone-500">Succeeded only</p>
                </div>
                {donationDestinationTotals.length === 0 ? (
                  <p className="mt-2 text-xs text-stone-500">No succeeded donations yet.</p>
                ) : (
                  <div className="mt-3 max-h-36 space-y-1.5 overflow-y-auto pr-1">
                    {donationDestinationTotals.map((entry) => (
                      <div key={entry.pileName} className="flex items-center justify-between gap-3 rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-2">
                        <p className="truncate text-xs font-semibold text-stone-700" title={entry.pileName}>
                          {entry.pileName}
                        </p>
                        <p className="whitespace-nowrap text-xs font-semibold text-stone-900">
                          {formatUsd(entry.amountCents)} ({entry.count})
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_auto]">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
                  <input
                    type="text"
                    value={donationSearchQuery}
                    onChange={(event) => setDonationSearchQuery(event.target.value)}
                    placeholder="Search donor, email, option, or payment id"
                    className="w-full rounded-xl border border-stone-300 bg-white py-2.5 pl-10 pr-3 text-sm text-stone-900 outline-none transition focus:border-red-500"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  {[
                    { id: 'all', label: 'All' },
                    { id: 'succeeded', label: 'Succeeded' },
                    { id: 'processing', label: 'Processing' },
                    { id: 'other', label: 'Other' }
                  ].map((filter) => (
                    <button
                      key={filter.id}
                      type="button"
                      onClick={() => setDonationStatusFilter(filter.id as DonationStatusFilter)}
                      className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                        donationStatusFilter === filter.id
                          ? 'border-red-600 bg-red-600 text-white'
                          : 'border-stone-300 bg-white text-stone-700 hover:border-red-400 hover:text-red-700'
                      }`}
                    >
                      {filter.label} ({donationStatusCounts[filter.id as DonationStatusFilter]})
                    </button>
                  ))}
                </div>
              </div>

              <p className="text-xs text-stone-500">
                Showing {sortedFilteredDonations.length} of {donations.length} donation{donations.length === 1 ? '' : 's'}.
              </p>

              {donationsLoading ? (
                <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-10 text-center text-sm text-stone-500">
                  Loading donations...
                </div>
              ) : donations.length === 0 ? (
                <div className="rounded-xl border border-dashed border-stone-200 px-4 py-10 text-center text-sm text-stone-500">
                  No donations found yet.
                </div>
              ) : sortedFilteredDonations.length === 0 ? (
                <div className="rounded-xl border border-dashed border-stone-200 px-4 py-10 text-center text-sm text-stone-500">
                  No donations match your current filters.
                </div>
              ) : (
                <div className="max-h-[640px] space-y-2 overflow-y-auto pr-1">
                  <AnimatePresence initial={false}>
                    {sortedFilteredDonations.map((donation) => {
                      const statusTone =
                        donation.status === 'succeeded'
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : donation.status === 'processing'
                            ? 'border-amber-200 bg-amber-50 text-amber-700'
                            : 'border-stone-200 bg-stone-100 text-stone-700';
                      const cardTone =
                        donation.status === 'succeeded'
                          ? 'border-l-emerald-500'
                          : donation.status === 'processing'
                            ? 'border-l-amber-500'
                            : 'border-l-stone-300';

                      return (
                        <motion.div
                          key={donation.paymentIntentId}
                          layout
                          initial={{ opacity: 0, y: 10, scale: 0.98 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: -10, scale: 0.98 }}
                          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                        >
                          <Link
                            to={`/admin/fundraise/donations/${encodeURIComponent(donation.paymentIntentId)}`}
                            className={`block rounded-xl border border-stone-200 border-l-4 bg-white p-3 transition hover:-translate-y-0.5 hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-red-300 ${cardTone}`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-stone-900">{donation.donorName || 'Supporter'}</p>
                                <p className="truncate text-xs text-stone-500">{donation.donorEmail || donation.receiptEmail || 'No email'}</p>
                              </div>
                              <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusTone}`}>
                                {formatDonationStatus(donation.status)}
                              </span>
                            </div>

                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <span className="rounded-full border border-stone-200 bg-stone-50 px-2 py-0.5 text-[11px] font-semibold text-stone-700">
                                {donation.donorRecognitionPreference === 'anonymous' ? 'Anonymous' : 'Known'}
                              </span>
                              {donation.donationOptionName ? (
                                <span className="rounded-full border border-stone-200 bg-stone-50 px-2 py-0.5 text-[11px] font-semibold text-stone-700">
                                  {donation.donationOptionName}
                                </span>
                              ) : null}
                            </div>

                            {donation.donationLevelTitle || donation.donationLevelAmountLabel ? (
                              <p className="mt-2 text-[11px] text-stone-500">
                                {[donation.donationLevelAmountLabel, donation.donationLevelTitle].filter(Boolean).join(' · ')}
                              </p>
                            ) : null}

                            <div className="mt-2 flex items-center justify-between gap-2 text-sm">
                              <span className="font-semibold text-stone-900">{formatMoney(donation.amountCents, donation.currency)}</span>
                              <span className="text-xs text-stone-500">{new Date(donation.createdAt).toLocaleString()}</span>
                            </div>

                            <p className="mt-2 truncate text-[11px] text-stone-500">
                              {donation.thankYouEmailSent ? 'Thank-you email sent' : 'Thank-you email pending'} · {donation.paymentIntentId}
                            </p>
                          </Link>
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>
                </div>
              )}
            </div>
          </section>

          <section className="overflow-hidden rounded-2xl border border-stone-200 bg-white">
            <button
              type="button"
              onClick={() => setDonationEditorOpen((current) => !current)}
              aria-expanded={donationEditorOpen}
              aria-controls="donation-editor-panel"
              className={`flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition-colors ${
                donationEditorOpen ? 'bg-stone-50' : 'bg-white hover:bg-stone-50'
              }`}
            >
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">Folded Section</p>
                <h3 className="mt-1 text-lg font-bold text-stone-900">Donation Page Editor</h3>
                <p className="mt-1 text-sm text-stone-600">Change destination names, descriptions, and preset donation levels.</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full border border-stone-200 bg-stone-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-600">
                  {donationOptionStats.optionCount} options
                </span>
                <ChevronRight className={`h-5 w-5 text-stone-400 transition-transform ${donationEditorOpen ? 'rotate-90' : ''}`} />
              </div>
            </button>

            <AnimatePresence initial={false}>
              {donationEditorOpen ? (
                <motion.div
                  id="donation-editor-panel"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                  className="overflow-hidden border-t border-stone-100"
                >
                  <div className="space-y-4 p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-600">
                        <span className="rounded-full border border-stone-200 bg-stone-50 px-2.5 py-1">
                          {donationOptionsCustomized ? 'Custom setup active' : 'Using default setup'}
                        </span>
                        {donationOptionsUpdatedAt ? (
                          <span className="rounded-full border border-stone-200 bg-stone-50 px-2.5 py-1">
                            Updated {new Date(donationOptionsUpdatedAt).toLocaleString()}
                          </span>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={addDonationOption}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-700 transition hover:bg-stone-50"
                        >
                          <Plus className="h-4 w-4" />
                          Add Option
                        </button>
                        <button
                          type="button"
                          onClick={() => void saveDonationOptions()}
                          disabled={donationOptionsSaving || donationOptionsLoading}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-red-700 px-3 py-2 text-sm font-semibold text-white transition hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <Save className="h-4 w-4" />
                          {donationOptionsSaving ? 'Saving…' : 'Save Donation Setup'}
                        </button>
                      </div>
                    </div>

                    {donationOptionsLoading ? (
                      <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-8 text-center text-sm text-stone-500">
                        Loading donation options...
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {donationOptions.map((option, optionIndex) => {
                          const optionSuggestedCents = option.levels.reduce((sum, level) => sum + level.suggestedAmountCents, 0);
                          return (
                            <article key={option.id} className="rounded-2xl border border-stone-200 bg-stone-50/40 p-4">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="inline-flex items-center rounded-full border border-stone-200 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-600">
                                  Option {optionIndex + 1}
                                </span>
                                <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-500">
                                  <span className="rounded-full border border-stone-200 bg-white px-2.5 py-1">{option.levels.length} levels</span>
                                  <span className="rounded-full border border-stone-200 bg-white px-2.5 py-1">
                                    Suggested total {formatUsd(optionSuggestedCents)}
                                  </span>
                                </div>
                              </div>

                              <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
                                <label className="space-y-1">
                                  <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-500">Option Name</span>
                                  <input
                                    value={option.name}
                                    onChange={(event) => updateDonationOptionField(option.id, 'name', event.target.value)}
                                    className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none transition focus:border-red-500"
                                  />
                                </label>
                                <label className="space-y-1 lg:col-span-2">
                                  <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-500">Option Description</span>
                                  <div className="flex gap-2">
                                    <input
                                      value={option.description}
                                      onChange={(event) => updateDonationOptionField(option.id, 'description', event.target.value)}
                                      className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none transition focus:border-red-500"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => removeDonationOption(option.id)}
                                      disabled={donationOptions.length <= 1}
                                      className="inline-flex items-center gap-1 rounded-xl border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                      Remove
                                    </button>
                                  </div>
                                </label>
                              </div>

                              <div className="mt-3 space-y-3">
                                {option.levels.map((level, levelIndex) => (
                                  <div key={level.id} className="rounded-xl border border-stone-200 bg-white p-3">
                                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                                      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-500">Level {levelIndex + 1}</p>
                                      <button
                                        type="button"
                                        onClick={() => removeDonationLevel(option.id, level.id)}
                                        disabled={option.levels.length <= 1}
                                        className="inline-flex items-center gap-1 rounded-xl border border-red-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                        Remove Level
                                      </button>
                                    </div>

                                    <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                                      <label className="space-y-1">
                                        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-500">Amount Label</span>
                                        <input
                                          value={level.amountLabel}
                                          onChange={(event) =>
                                            updateDonationLevelField(option.id, level.id, 'amountLabel', event.target.value)
                                          }
                                          className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none transition focus:border-red-500"
                                        />
                                      </label>
                                      <label className="space-y-1">
                                        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-500">Level Title</span>
                                        <input
                                          value={level.title}
                                          onChange={(event) =>
                                            updateDonationLevelField(option.id, level.id, 'title', event.target.value)
                                          }
                                          className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none transition focus:border-red-500"
                                        />
                                      </label>
                                      <label className="space-y-1">
                                        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-500">Suggested Cents</span>
                                        <input
                                          type="number"
                                          min={100}
                                          step={100}
                                          value={level.suggestedAmountCents}
                                          onChange={(event) =>
                                            updateDonationLevelField(option.id, level.id, 'suggestedAmountCents', event.target.value)
                                          }
                                          className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none transition focus:border-red-500"
                                        />
                                      </label>
                                    </div>
                                    <label className="mt-3 block space-y-1">
                                      <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-500">Level Detail</span>
                                      <textarea
                                        value={level.detail}
                                        onChange={(event) => updateDonationLevelField(option.id, level.id, 'detail', event.target.value)}
                                        rows={2}
                                        className="w-full resize-none rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none transition focus:border-red-500"
                                      />
                                    </label>
                                  </div>
                                ))}
                              </div>

                              <button
                                type="button"
                                onClick={() => addDonationLevel(option.id)}
                                className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-stone-300 bg-white px-3 py-2 text-xs font-semibold text-stone-700 transition hover:bg-stone-50"
                              >
                                <Plus className="h-3.5 w-3.5" />
                                Add Level
                              </button>
                            </article>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </section>

          <section className="overflow-hidden rounded-2xl border border-stone-200 bg-white">
            <button
              type="button"
              onClick={() => setDonationProcessOpen((current) => !current)}
              aria-expanded={donationProcessOpen}
              aria-controls="donation-process-panel"
              className={`flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition-colors ${
                donationProcessOpen ? 'bg-stone-50' : 'bg-white hover:bg-stone-50'
              }`}
            >
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">Folded Section</p>
                <h3 className="mt-1 text-lg font-bold text-stone-900">Process Donation</h3>
                <p className="mt-1 text-sm text-stone-600">Charge cards using the selected donation paths and donor details.</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-red-700">
                  <CreditCard className="h-3.5 w-3.5" />
                  Stripe secure
                </span>
                <ChevronRight className={`h-5 w-5 text-stone-400 transition-transform ${donationProcessOpen ? 'rotate-90' : ''}`} />
              </div>
            </button>

            <AnimatePresence initial={false}>
              {donationProcessOpen ? (
                <motion.div
                  id="donation-process-panel"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                  className="overflow-hidden border-t border-stone-100"
                >
                  <div className="space-y-4 p-5">
                    <div className="rounded-xl border border-stone-200 bg-stone-50 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-stone-500">1. Choose Donation Path</p>
                      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {donationOptions.map((option) => (
                          <button
                            key={option.id}
                            type="button"
                            onClick={() => {
                              setSelectedDonationOptionId(option.id);
                              setSelectedDonationLevelId(null);
                              setSelectedDonationAmountCents(null);
                              setActiveDonationIntent(null);
                              setDonationError(null);
                              setDonationSuccessMessage(null);
                            }}
                            className={`rounded-xl border p-3 text-left transition ${
                              selectedDonationOption?.id === option.id
                                ? 'border-red-500 bg-white shadow-sm'
                                : 'border-stone-200 bg-white hover:border-red-300'
                            }`}
                          >
                            <p className="text-sm font-semibold text-stone-900">{option.name}</p>
                            <p className="mt-1 text-xs text-stone-600">{option.description}</p>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-xl border border-stone-200 bg-stone-50 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-stone-500">2. Donor Information</p>
                      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <label className="space-y-2">
                          <span className="text-xs font-semibold uppercase tracking-[0.12em] text-stone-500">Donor Name</span>
                          <div className="relative">
                            <UserRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
                            <input
                              type="text"
                              value={donorName}
                              onChange={(event) => setDonorName(event.target.value)}
                              placeholder="Full name"
                              className="w-full rounded-xl border border-stone-300 bg-white py-2.5 pl-10 pr-3 text-sm text-stone-900 outline-none transition focus:border-red-500"
                            />
                          </div>
                        </label>
                        <label className="space-y-2">
                          <span className="text-xs font-semibold uppercase tracking-[0.12em] text-stone-500">Donor Email</span>
                          <div className="relative">
                            <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
                            <input
                              type="email"
                              value={donorEmail}
                              onChange={(event) => setDonorEmail(event.target.value)}
                              placeholder="name@email.com"
                              className="w-full rounded-xl border border-stone-300 bg-white py-2.5 pl-10 pr-3 text-sm text-stone-900 outline-none transition focus:border-red-500"
                            />
                          </div>
                        </label>
                      </div>

                      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <button
                          type="button"
                          onClick={() => setDonorRecognitionPreference('known')}
                          className={`rounded-xl border px-3 py-2.5 text-left transition ${
                            donorRecognitionPreference === 'known'
                              ? 'border-red-500 bg-white shadow-sm'
                              : 'border-stone-200 bg-white hover:border-red-300'
                          }`}
                        >
                          <p className="text-sm font-semibold text-stone-900">Known</p>
                          <p className="mt-1 text-xs text-stone-600">May be recognized in playbills, acknowledgments, or press releases.</p>
                        </button>
                        <button
                          type="button"
                          onClick={() => setDonorRecognitionPreference('anonymous')}
                          className={`rounded-xl border px-3 py-2.5 text-left transition ${
                            donorRecognitionPreference === 'anonymous'
                              ? 'border-red-500 bg-white shadow-sm'
                              : 'border-stone-200 bg-white hover:border-red-300'
                          }`}
                        >
                          <p className="text-sm font-semibold text-stone-900">Anonymous</p>
                          <p className="mt-1 text-xs text-stone-600">Name will be withheld from recognition materials.</p>
                        </button>
                      </div>
                    </div>

                    <div className="rounded-xl border border-stone-200 bg-stone-50 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-stone-500">3. Select Amount & Charge</p>
                      <p className="mt-1 text-xs text-stone-600">{selectedDonationOption?.description || ''}</p>

                      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {selectedDonationLevels.map((level) => {
                          const isSelected =
                            selectedDonationLevelId === level.id && selectedDonationAmountCents === level.suggestedAmountCents;
                          return (
                            <button
                              key={level.id}
                              type="button"
                              onClick={() => void requestDonationIntent(level.suggestedAmountCents, level)}
                              className={`rounded-xl border px-3 py-3 text-left transition ${
                                isSelected ? 'border-red-500 bg-white shadow-sm' : 'border-stone-200 bg-white hover:border-red-300'
                              }`}
                            >
                              <p className="text-base font-bold text-stone-900">{level.amountLabel}</p>
                              <p className="text-sm font-semibold text-stone-800">{level.title}</p>
                              <p className="mt-1 text-xs text-stone-600">{level.detail}</p>
                            </button>
                          );
                        })}
                        <button
                          type="button"
                          onClick={handleOtherDonationSelect}
                          className={`rounded-xl border px-3 py-3 text-left transition ${
                            isOtherDonationSelected
                              ? 'border-red-500 bg-white shadow-sm'
                              : 'border-stone-200 bg-white hover:border-red-300'
                          }`}
                        >
                          <p className="text-base font-bold text-stone-900">Other</p>
                          <p className="text-sm font-semibold text-stone-800">Custom Amount</p>
                          <p className="mt-1 text-xs text-stone-600">Enter any amount of at least $1.00.</p>
                        </button>
                      </div>

                      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                        <div className="relative flex-1">
                          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-stone-500">$</span>
                          <input
                            ref={customAmountInputRef}
                            type="text"
                            inputMode="decimal"
                            value={customDonationAmount}
                            onChange={(event) => {
                              setCustomDonationAmount(event.target.value);
                              setSelectedDonationLevelId(null);
                            }}
                            placeholder="Custom amount"
                            className="w-full rounded-xl border border-stone-300 bg-white py-2.5 pl-8 pr-3 text-sm text-stone-900 outline-none transition focus:border-red-500"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={applyCustomDonationAmount}
                          className="rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-stone-700 transition hover:border-red-500 hover:text-red-700"
                        >
                          Use Amount
                        </button>
                      </div>

                      {donationIntentLoading ? (
                        <div className="mt-3 inline-flex items-center gap-2 text-sm text-stone-600">
                          <Loader2 className="h-4 w-4 animate-spin text-red-700" />
                          Loading secure card form...
                        </div>
                      ) : null}

                      {donationSuccessMessage ? (
                        <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                          {donationSuccessMessage}
                        </div>
                      ) : null}

                      {donationError ? (
                        <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{donationError}</div>
                      ) : null}

                      {activeDonationIntent && donationStripePromise && donationStripeOptions && !donationIntentLoading ? (
                        <div className="mt-3 rounded-2xl border border-stone-200 bg-white p-3 sm:p-4">
                          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-stone-500">
                            Charge {formatUsd(activeDonationIntent.amountCents)}
                            {selectedDonationLevel ? ` · ${selectedDonationLevel.title}` : ''}
                          </p>
                          <Elements stripe={donationStripePromise} options={donationStripeOptions} key={activeDonationIntent.paymentIntentId}>
                            <AdminDonationPaymentForm
                              amountCents={activeDonationIntent.amountCents}
                              donorName={donorName.trim()}
                              donorEmail={donorEmail.trim().toLowerCase()}
                              onSuccess={() => {
                                setDonationSuccessMessage(`Donation of ${formatUsd(activeDonationIntent.amountCents)} was processed.`);
                                setActiveDonationIntent(null);
                                setDonationError(null);
                                void loadDonations();
                              }}
                              onError={setDonationError}
                            />
                          </Elements>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </section>
        </div>
      )}

      <EventRegistrationFormBuilderModal
        open={showFormBuilder}
        performance={builderEvent ? { id: builderEvent.id, title: builderEvent.title, isFundraiser: true } : null}
        performanceOptions={events.map((eventItem) => ({ id: eventItem.id, title: eventItem.title, isFundraiser: true }))}
        onClose={() => {
          setShowFormBuilder(false);
          setBuilderEventId(null);
        }}
      />

      {typeof document !== 'undefined'
        ? createPortal(
            <>
              <AnimatePresence>
                {showWizard ? (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm sm:items-center sm:p-4"
                  >
                    <motion.div
                      initial={{ scale: 0.93, opacity: 0, y: 16 }}
                      animate={{ scale: 1, opacity: 1, y: 0 }}
                      exit={{ scale: 0.93, opacity: 0, y: 16 }}
                      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                      className="flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[28px] bg-white shadow-2xl sm:max-w-lg sm:rounded-3xl"
                    >
                      <div className="mb-0 border-b border-stone-100 px-4 pb-4 pt-5 sm:px-6 flex-shrink-0">
                        <div className="mb-4 flex items-center justify-between">
                          <p className="font-bold text-stone-900">{editingId ? 'Edit Fundraising Event' : 'New Fundraising Event'}</p>
                          <button
                            type="button"
                            onClick={closeWizard}
                            className="rounded-full p-1 text-stone-300 transition hover:bg-stone-50 hover:text-stone-600"
                          >
                            <X className="h-5 w-5" />
                          </button>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {STEPS.map((wizardStep, idx) => {
                            const Icon = wizardStep.icon;
                            const done = idx < step;
                            const active = idx === step;
                            return (
                              <button
                                key={wizardStep.id}
                                type="button"
                                onClick={() => goTo(idx)}
                                className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-all ${
                                  active
                                    ? 'bg-red-700 text-white shadow-sm'
                                    : done
                                      ? 'border border-green-200 bg-green-50 text-green-700'
                                      : 'bg-stone-100 text-stone-400 hover:bg-stone-200'
                                }`}
                              >
                                {done ? <Check className="h-3 w-3" /> : <Icon className="h-3 w-3" />}
                                <span className="hidden sm:inline">{wizardStep.label}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
                        <AnimatePresence mode="wait" initial={false}>
                          <motion.div
                            key={step}
                            initial={{ x: dir * 32, opacity: 0 }}
                            animate={{ x: 0, opacity: 1 }}
                            exit={{ x: dir * -32, opacity: 0 }}
                            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                          >
                            {stepContent[step]}
                          </motion.div>
                        </AnimatePresence>
                      </div>

                      <div className="flex-shrink-0 border-t border-stone-100 bg-stone-50/60 px-4 py-4 sm:px-6">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <button
                            type="button"
                            onClick={() => goTo(step - 1)}
                            disabled={step === 0}
                            className="flex items-center gap-1 text-sm font-semibold text-stone-400 transition hover:text-stone-800 disabled:cursor-not-allowed disabled:opacity-25"
                          >
                            <ChevronLeft className="h-4 w-4" />
                            Back
                          </button>
                          <span className="text-xs text-stone-300">
                            {step + 1} / {STEPS.length}
                          </span>
                          {step < STEPS.length - 1 ? (
                            <button
                              type="button"
                              onClick={() => goTo(step + 1)}
                              className="flex items-center gap-1.5 rounded-full bg-stone-900 px-5 py-2 text-sm font-semibold text-white transition hover:bg-stone-800"
                            >
                              Next
                              <ChevronRight className="h-4 w-4" />
                            </button>
                          ) : (
                            <motion.button
                              type="button"
                              onClick={() => void saveEvent()}
                              whileHover={{ scale: 1.03 }}
                              whileTap={{ scale: 0.97 }}
                              disabled={saving}
                              className="flex items-center gap-1.5 rounded-full bg-red-700 px-5 py-2 text-sm font-semibold text-white shadow-sm shadow-red-100 transition hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              <Save className="h-4 w-4" />
                              {saving ? 'Saving...' : editingId ? 'Save Changes' : 'Create Event'}
                            </motion.button>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  </motion.div>
                ) : null}
              </AnimatePresence>

              <AnimatePresence>
                {showSponsorWizard ? (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm sm:items-center sm:p-4"
                  >
                    <motion.div
                      initial={{ scale: 0.93, opacity: 0, y: 16 }}
                      animate={{ scale: 1, opacity: 1, y: 0 }}
                      exit={{ scale: 0.93, opacity: 0, y: 16 }}
                      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                      className="flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[28px] bg-white shadow-2xl sm:max-w-lg sm:rounded-3xl"
                    >
                      <div className="mb-0 border-b border-stone-100 px-4 pb-4 pt-5 sm:px-6 flex-shrink-0">
                        <div className="mb-4 flex items-center justify-between">
                          <p className="font-bold text-stone-900">{sponsorEditingId ? 'Edit Sponsor' : 'New Sponsor'}</p>
                          <button
                            type="button"
                            onClick={closeSponsorWizard}
                            className="rounded-full p-1 text-stone-300 transition hover:bg-stone-50 hover:text-stone-600"
                          >
                            <X className="h-5 w-5" />
                          </button>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {SPONSOR_STEPS.map((wizardStep, idx) => {
                            const Icon = wizardStep.icon;
                            const done = idx < sponsorStep;
                            const active = idx === sponsorStep;
                            return (
                              <button
                                key={wizardStep.id}
                                type="button"
                                onClick={() => goToSponsorStep(idx)}
                                className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-all ${
                                  active
                                    ? 'bg-red-700 text-white shadow-sm'
                                    : done
                                      ? 'border border-green-200 bg-green-50 text-green-700'
                                      : 'bg-stone-100 text-stone-400 hover:bg-stone-200'
                                }`}
                              >
                                {done ? <Check className="h-3 w-3" /> : <Icon className="h-3 w-3" />}
                                <span className="hidden sm:inline">{wizardStep.label}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
                        <AnimatePresence mode="wait" initial={false}>
                          <motion.div
                            key={sponsorStep}
                            initial={{ x: sponsorDir * 32, opacity: 0 }}
                            animate={{ x: 0, opacity: 1 }}
                            exit={{ x: sponsorDir * -32, opacity: 0 }}
                            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                          >
                            {sponsorStepContent[sponsorStep]}
                          </motion.div>
                        </AnimatePresence>
                      </div>

                      <div className="flex-shrink-0 border-t border-stone-100 bg-stone-50/60 px-4 py-4 sm:px-6">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <button
                            type="button"
                            onClick={() => goToSponsorStep(sponsorStep - 1)}
                            disabled={sponsorStep === 0}
                            className="flex items-center gap-1 text-sm font-semibold text-stone-400 transition hover:text-stone-800 disabled:cursor-not-allowed disabled:opacity-25"
                          >
                            <ChevronLeft className="h-4 w-4" />
                            Back
                          </button>
                          <span className="text-xs text-stone-300">
                            {sponsorStep + 1} / {SPONSOR_STEPS.length}
                          </span>
                          {sponsorStep < SPONSOR_STEPS.length - 1 ? (
                            <button
                              type="button"
                              onClick={() => goToSponsorStep(sponsorStep + 1)}
                              className="flex items-center gap-1.5 rounded-full bg-stone-900 px-5 py-2 text-sm font-semibold text-white transition hover:bg-stone-800"
                            >
                              Next
                              <ChevronRight className="h-4 w-4" />
                            </button>
                          ) : (
                            <motion.button
                              type="button"
                              onClick={() => void saveSponsor()}
                              whileHover={{ scale: 1.03 }}
                              whileTap={{ scale: 0.97 }}
                              disabled={sponsorSaving}
                              className="flex items-center gap-1.5 rounded-full bg-red-700 px-5 py-2 text-sm font-semibold text-white shadow-sm shadow-red-100 transition hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              <Save className="h-4 w-4" />
                              {sponsorSaving ? 'Saving...' : sponsorEditingId ? 'Save Sponsor' : 'Create Sponsor'}
                            </motion.button>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </>,
            document.body
          )
        : null}
    </div>
  );
}
