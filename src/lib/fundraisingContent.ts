import { SITE_FALLBACK_URL } from './siteMeta';

export type FundraisingEvent = {
  id: string;
  slug: string;
  title: string;
  dateLabel: string;
  timeLabel: string;
  location: string;
  heroImageUrl: string;
  summary: string;
  longDescription: string;
  goalLabel: string;
  details: string[];
};

export type SponsorshipTier = {
  level: string;
  amount: string;
  benefit: string;
};

export type DonationLevel = {
  amount: string;
  label: string;
  detail: string;
};

export type FundraisingDonationOptionLevel = {
  id: string;
  amountLabel: string;
  title: string;
  detail: string;
  suggestedAmountCents: number;
};

export type FundraisingDonationOption = {
  id: string;
  name: string;
  description: string;
  levels: FundraisingDonationOptionLevel[];
};

export type FundraisingSponsor = {
  id: string;
  name: string;
  tier: 'Balcony' | 'Mezzanine' | 'Orchestra' | 'Center Stage';
  logoUrl: string;
  imageUrl: string;
  spotlight: string;
  websiteUrl: string;
};

export const fundraisingEvents: FundraisingEvent[] = [
  {
    id: 'event-spring-cabaret-night',
    slug: 'spring-cabaret-night',
    title: 'Spring Cabaret Night',
    dateLabel: 'April 18, 2026',
    timeLabel: '7:00 PM',
    location: 'Penncrest Auditorium',
    heroImageUrl: 'https://picsum.photos/id/1043/1600/900',
    summary: 'An image-forward evening of student performances, raffle baskets, and family concessions.',
    longDescription:
      'Spring Cabaret Night highlights solo and ensemble performances while raising funds for costumes, sound support, and student production opportunities throughout the year.',
    goalLabel: '$8,000 Goal',
    details: [
      'Student performances curated from this season.',
      'Lobby raffle baskets donated by local businesses.',
      'Concession sales support student tech scholarships.',
      'Open seating and family-friendly run time.'
    ]
  },
  {
    id: 'event-backstage-open-house',
    slug: 'backstage-open-house',
    title: 'Backstage Open House',
    dateLabel: 'May 2, 2026',
    timeLabel: '1:00 PM - 4:00 PM',
    location: 'Theater Lobby + Stage',
    heroImageUrl: 'https://picsum.photos/id/1074/1600/900',
    summary: 'Walk through the wings, lighting booth, and rehearsal spaces with student guides.',
    longDescription:
      'This open house is designed for families and community members who want to understand how fundraising directly supports every aspect of our productions.',
    goalLabel: '$5,000 Goal',
    details: [
      'Guided tours led by student cast and crew.',
      'Live mini demos for sound, lights, and stage management.',
      'Sponsor showcase wall with logo placements.',
      'Volunteer sign-up station for summer build days.'
    ]
  },
  {
    id: 'event-summer-build-day',
    slug: 'summer-build-day',
    title: 'Summer Build Day',
    dateLabel: 'June 13, 2026',
    timeLabel: '9:30 AM - 2:00 PM',
    location: 'Scene Shop',
    heroImageUrl: 'https://picsum.photos/id/1060/1600/900',
    summary: 'A hands-on volunteer day for set prep, prop organization, and costume inventory.',
    longDescription:
      'Summer Build Day is where community volunteers and students work side by side to prepare the next season with practical support and direct material donations.',
    goalLabel: '$3,500 Goal',
    details: [
      'Set framing and painting stations for volunteers.',
      'Costume sorting and quick-repair tables.',
      'Prop donation intake and inventory prep.',
      'Crew mentor sessions with student leaders.'
    ]
  }
];

export const fundraisingSponsors: FundraisingSponsor[] = [
  {
    id: 'sponsor-main-street-bank',
    name: 'Main Street Bank',
    tier: 'Center Stage',
    logoUrl: 'https://dummyimage.com/320x120/ffffff/991b1b.png&text=Main+Street+Bank',
    imageUrl: 'https://picsum.photos/id/1025/900/600',
    spotlight: 'Supporting production sound upgrades and student leadership scholarships.',
    websiteUrl: SITE_FALLBACK_URL
  },
  {
    id: 'sponsor-media-arts-council',
    name: 'Media Arts Council',
    tier: 'Orchestra',
    logoUrl: 'https://dummyimage.com/320x120/ffffff/7f1d1d.png&text=Media+Arts+Council',
    imageUrl: 'https://picsum.photos/id/1038/900/600',
    spotlight: 'Funding scenic art materials and seasonal community arts collaborations.',
    websiteUrl: SITE_FALLBACK_URL
  },
  {
    id: 'sponsor-rose-tree-dental',
    name: 'Rose Tree Dental',
    tier: 'Mezzanine',
    logoUrl: 'https://dummyimage.com/320x120/ffffff/b45309.png&text=Rose+Tree+Dental',
    imageUrl: 'https://picsum.photos/id/1067/900/600',
    spotlight: 'Helping cover student costume and wardrobe costs.',
    websiteUrl: SITE_FALLBACK_URL
  },
  {
    id: 'sponsor-miller-family-foundation',
    name: 'Miller Family Foundation',
    tier: 'Orchestra',
    logoUrl: 'https://dummyimage.com/320x120/ffffff/78350f.png&text=Miller+Family+Foundation',
    imageUrl: 'https://picsum.photos/id/1011/900/600',
    spotlight: 'Providing annual support for student theater training opportunities.',
    websiteUrl: SITE_FALLBACK_URL
  },
  {
    id: 'sponsor-cedar-realty-group',
    name: 'Cedar Realty Group',
    tier: 'Mezzanine',
    logoUrl: 'https://dummyimage.com/320x120/ffffff/92400e.png&text=Cedar+Realty+Group',
    imageUrl: 'https://picsum.photos/id/1041/900/600',
    spotlight: 'Backing front-of-house improvements and audience accessibility support.',
    websiteUrl: SITE_FALLBACK_URL
  },
  {
    id: 'sponsor-brightline-fitness',
    name: 'Brightline Fitness',
    tier: 'Balcony',
    logoUrl: 'https://dummyimage.com/320x120/ffffff/1f2937.png&text=Brightline+Fitness',
    imageUrl: 'https://picsum.photos/id/1050/900/600',
    spotlight: 'Contributing to rehearsal wellness supplies and cast support kits.',
    websiteUrl: SITE_FALLBACK_URL
  }
];

export const donationLevels: DonationLevel[] = [
  {
    amount: '$25',
    label: 'Spotlight Supporter',
    detail: 'Supports scripts, rehearsal essentials, and student project supplies.'
  },
  {
    amount: '$100',
    label: 'Stage Builder',
    detail: 'Helps cover set construction materials, paint, and prop hardware.'
  },
  {
    amount: '$250+',
    label: 'Season Champion',
    detail: 'Funds costumes, microphones, and production support for major shows.'
  }
];

export const sponsorshipTiers: SponsorshipTier[] = [
  {
    level: 'Balcony',
    amount: '$50 - $249',
    benefit: 'Quarter-page ad in our programs for all four productions next school year, plus listing on the sponsor page.'
  },
  {
    level: 'Mezzanine',
    amount: '$250 - $499',
    benefit: 'Everything in Balcony, plus tax-deductible donation documentation and a half-page program ad.'
  },
  {
    level: 'Orchestra',
    amount: '$500 - $999',
    benefit: 'Everything in Mezzanine, plus listing on donor posters displayed during performances and a full-page program ad.'
  },
  {
    level: 'Center Stage',
    amount: '$1,000+',
    benefit: 'Everything in Orchestra, plus sponsor listing on all advertising and press releases.'
  }
];

export const fundraisingDonationOptions: FundraisingDonationOption[] = [
  {
    id: 'regular-donation',
    name: 'Regular Donation',
    description: 'Support costumes, sets, rehearsal materials, and production needs across the full season.',
    levels: [
      {
        id: 'regular-spotlight-supporter',
        amountLabel: '$25',
        title: 'Spotlight Supporter',
        detail: 'Supports scripts, rehearsal essentials, and student project supplies.',
        suggestedAmountCents: 2500
      },
      {
        id: 'regular-stage-builder',
        amountLabel: '$100',
        title: 'Stage Builder',
        detail: 'Helps cover set construction materials, paint, and prop hardware.',
        suggestedAmountCents: 10000
      },
      {
        id: 'regular-season-champion',
        amountLabel: '$250+',
        title: 'Season Champion',
        detail: 'Funds costumes, microphones, and production support for major shows.',
        suggestedAmountCents: 25000
      }
    ]
  },
  {
    id: 'scholarship-donation',
    name: 'Scholarship Donation',
    description: 'Fund student participation scholarships so every performer can join regardless of financial barriers.',
    levels: [
      {
        id: 'scholarship-script-starter',
        amountLabel: '$50',
        title: 'Script Starter',
        detail: 'Offsets script, workbook, and rehearsal supply costs for one student.',
        suggestedAmountCents: 5000
      },
      {
        id: 'scholarship-ensemble-boost',
        amountLabel: '$150',
        title: 'Ensemble Boost',
        detail: 'Helps cover costume pieces and production fees for participating students.',
        suggestedAmountCents: 15000
      },
      {
        id: 'scholarship-full-spotlight',
        amountLabel: '$500+',
        title: 'Full Spotlight',
        detail: 'Provides major scholarship support for student theater participation during the season.',
        suggestedAmountCents: 50000
      }
    ]
  },
  {
    id: 'sponsorship-donation',
    name: 'Sponsorship Donation',
    description: 'Contribute at sponsor-level support with recognition and outreach benefits for your organization.',
    levels: [
      {
        id: 'sponsor-balcony',
        amountLabel: '$50 - $249',
        title: 'Balcony',
        detail: 'Quarter-page ad in our programs for all four productions next school year, plus listing on the sponsor page.',
        suggestedAmountCents: 5000
      },
      {
        id: 'sponsor-mezzanine',
        amountLabel: '$250 - $499',
        title: 'Mezzanine',
        detail: 'Everything in Balcony, plus tax-deductible donation documentation and a half-page program ad.',
        suggestedAmountCents: 25000
      },
      {
        id: 'sponsor-orchestra',
        amountLabel: '$500 - $999',
        title: 'Orchestra',
        detail: 'Everything in Mezzanine, plus listing on donor posters displayed during performances and a full-page program ad.',
        suggestedAmountCents: 50000
      },
      {
        id: 'sponsor-center-stage',
        amountLabel: '$1,000+',
        title: 'Center Stage',
        detail: 'Everything in Orchestra, plus sponsor listing on all advertising and press releases.',
        suggestedAmountCents: 100000
      }
    ]
  }
];

export function getFundraisingEventBySlug(slug: string): FundraisingEvent | undefined {
  return fundraisingEvents.find((event) => event.slug === slug);
}
