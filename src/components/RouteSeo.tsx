import { matchPath, useLocation } from 'react-router-dom';
import Seo from './Seo';
import {
  buildBreadcrumbSchema,
  buildOrganizationSchema,
  buildWebPageSchema,
  buildWebsiteSchema
} from '../lib/seo';

type RouteDefinition = {
  path: string;
  title: string;
  description: string;
  noindex?: boolean;
  type?: 'website' | 'article';
  structuredData?: Record<string, unknown> | Array<Record<string, unknown>>;
};

const routes: RouteDefinition[] = [
  {
    path: '/',
    title: 'Penncrest Theater | Shows, Tickets, and Student Arts in Media, PA',
    description:
      'Penncrest Theater brings student productions, ticketing, and arts opportunities to Media, Pennsylvania through performances, musical theater, tech crew, set design, and family programming.',
    type: 'website',
    structuredData: [
      buildOrganizationSchema(),
      buildWebsiteSchema()
    ]
  },
  {
    path: '/shows',
    title: 'Our Season | Penncrest Theater Tickets and Upcoming Shows',
    description:
      'See upcoming Penncrest Theater productions, show details, and performance information for current shows at Penncrest High School.',
    structuredData: [
      buildWebPageSchema(
        'Our Season | Penncrest Theater Tickets and Upcoming Shows',
        'See upcoming Penncrest Theater productions, show details, and performance information for current shows at Penncrest High School.',
        '/shows',
        'CollectionPage'
      ),
      buildBreadcrumbSchema([
        { name: 'Home', path: '/' },
        { name: 'Our Season', path: '/shows' }
      ])
    ]
  },
  {
    path: '/about',
    title: 'About the Theater Program | Penncrest Theater',
    description:
      'Learn about Penncrest Theater, student opportunities, staff leadership, upcoming events, and the history of the Penncrest High School theater program.',
    structuredData: [
      buildWebPageSchema(
        'About the Theater Program | Penncrest Theater',
        'Learn about Penncrest Theater, student opportunities, staff leadership, upcoming events, and the history of the Penncrest High School theater program.',
        '/about',
        'AboutPage'
      ),
      buildBreadcrumbSchema([
        { name: 'Home', path: '/' },
        { name: 'About', path: '/about' }
      ])
    ]
  },
  {
    path: '/tech-crew',
    title: 'Tech Crew | Backstage Theater Opportunities at Penncrest',
    description:
      'Join Penncrest Theater Tech Crew and learn lighting, sound, stage management, and backstage production skills while supporting school performances.',
    structuredData: [
      buildWebPageSchema(
        'Tech Crew | Backstage Theater Opportunities at Penncrest',
        'Join Penncrest Theater Tech Crew and learn lighting, sound, stage management, and backstage production skills while supporting school performances.',
        '/tech-crew'
      ),
      buildBreadcrumbSchema([
        { name: 'Home', path: '/' },
        { name: 'Tech Crew', path: '/tech-crew' }
      ])
    ]
  },
  {
    path: '/set-design',
    title: 'Set Design | Scenic Art and Props at Penncrest Theater',
    description:
      'Explore Penncrest Theater set design opportunities in scenic art, carpentry, props, and backstage production for student performers and creators.',
    structuredData: [
      buildWebPageSchema(
        'Set Design | Scenic Art and Props at Penncrest Theater',
        'Explore Penncrest Theater set design opportunities in scenic art, carpentry, props, and backstage production for student performers and creators.',
        '/set-design'
      ),
      buildBreadcrumbSchema([
        { name: 'Home', path: '/' },
        { name: 'Set Design', path: '/set-design' }
      ])
    ]
  },
  {
    path: '/musical-theater',
    title: 'Musical Theater | Acting, Singing, and Dance at Penncrest',
    description:
      'Discover Penncrest Theater musical theater opportunities for actors, singers, and dancers in school productions and student performance programs.',
    structuredData: [
      buildWebPageSchema(
        'Musical Theater | Acting, Singing, and Dance at Penncrest',
        'Discover Penncrest Theater musical theater opportunities for actors, singers, and dancers in school productions and student performance programs.',
        '/musical-theater'
      ),
      buildBreadcrumbSchema([
        { name: 'Home', path: '/' },
        { name: 'Musical Theater', path: '/musical-theater' }
      ])
    ]
  },
  {
    path: '/interest-meeting',
    title: 'Interest Meeting | Join Penncrest Theater',
    description:
      'Get information about Penncrest Theater interest meetings, how to get involved, and what students can expect from the program.',
    structuredData: [
      buildWebPageSchema(
        'Interest Meeting | Join Penncrest Theater',
        'Get information about Penncrest Theater interest meetings, how to get involved, and what students can expect from the program.',
        '/interest-meeting'
      ),
      buildBreadcrumbSchema([
        { name: 'Home', path: '/' },
        { name: 'Interest Meeting', path: '/interest-meeting' }
      ])
    ]
  },
  {
    path: '/fundraising',
    title: 'Fundraising | Donate or Sponsor Penncrest Theater',
    description:
      'Support Penncrest Theater through fundraising events, community donations, and local sponsorships that help student performers and crews.',
    structuredData: [
      buildWebPageSchema(
        'Fundraising | Donate or Sponsor Penncrest Theater',
        'Support Penncrest Theater through fundraising events, community donations, and local sponsorships that help student performers and crews.',
        '/fundraising'
      ),
      buildBreadcrumbSchema([
        { name: 'Home', path: '/' },
        { name: 'Fundraising', path: '/fundraising' }
      ])
    ]
  },
  {
    path: '/fundraising/events/:slug',
    title: 'Fundraising Event | Penncrest Theater',
    description:
      'View fundraising event details, dates, and goals supporting Penncrest Theater students and productions.',
    structuredData: [
      buildWebPageSchema(
        'Fundraising Event | Penncrest Theater',
        'View fundraising event details, dates, and goals supporting Penncrest Theater students and productions.',
        '/fundraising'
      ),
      buildBreadcrumbSchema([
        { name: 'Home', path: '/' },
        { name: 'Fundraising', path: '/fundraising' }
      ])
    ]
  },
  {
    path: '/privacy-policy',
    title: 'Privacy Policy | Penncrest Theater Department',
    description:
      'Read the Penncrest Theater Department Privacy Policy for ticketing services, including data collection, payment processing, cookies, and privacy rights.',
    structuredData: [
      buildWebPageSchema(
        'Privacy Policy | Penncrest Theater Department',
        'Read the Penncrest Theater Department Privacy Policy for ticketing services, including data collection, payment processing, cookies, and privacy rights.',
        '/privacy-policy'
      ),
      buildBreadcrumbSchema([
        { name: 'Home', path: '/' },
        { name: 'Privacy Policy', path: '/privacy-policy' }
      ])
    ]
  },
  {
    path: '/terms-of-service',
    title: 'Terms of Service | Penncrest Theater Department',
    description:
      'Read the Penncrest Theater Department Terms of Service for ticketing, site use, purchases, refunds, liability, and event policies.',
    structuredData: [
      buildWebPageSchema(
        'Terms of Service | Penncrest Theater Department',
        'Read the Penncrest Theater Department Terms of Service for ticketing, site use, purchases, refunds, liability, and event policies.',
        '/terms-of-service'
      ),
      buildBreadcrumbSchema([
        { name: 'Home', path: '/' },
        { name: 'Terms of Service', path: '/terms-of-service' }
      ])
    ]
  },
  {
    path: '/refund-policy',
    title: 'Refund Policy | Penncrest Theater Department',
    description:
      'Review the Penncrest Theater Department Refund Policy for ticket cancellations, reschedules, and refund request criteria.',
    structuredData: [
      buildWebPageSchema(
        'Refund Policy | Penncrest Theater Department',
        'Review the Penncrest Theater Department Refund Policy for ticket cancellations, reschedules, and refund request criteria.',
        '/refund-policy'
      ),
      buildBreadcrumbSchema([
        { name: 'Home', path: '/' },
        { name: 'Refund Policy', path: '/refund-policy' }
      ])
    ]
  },
  {
    path: '/booking/:performanceId',
    title: 'Ticket Checkout | Penncrest Theater',
    description: 'Secure Penncrest Theater tickets for your selected performance.',
    noindex: true
  },
  {
    path: '/confirmation',
    title: 'Order Confirmation | Penncrest Theater',
    description: 'Your Penncrest Theater order confirmation and ticket links.',
    noindex: true
  },
  {
    path: '/orders/lookup',
    title: 'Order Lookup | Penncrest Theater',
    description: 'Retrieve Penncrest Theater ticket links using your order ID and email address.',
    noindex: true
  },
  {
    path: '/tickets/:publicId',
    title: 'Digital Ticket | Penncrest Theater',
    description: 'Your Penncrest Theater digital ticket.',
    noindex: true
  },
  {
    path: '/teacher-tickets',
    title: 'Teacher Complimentary Ticket | Penncrest Theater',
    description: 'Teacher and staff complimentary ticket access for Penncrest Theater.',
    noindex: true
  },
  {
    path: '/staff-tickets',
    title: 'Teacher Complimentary Ticket | Penncrest Theater',
    description: 'Teacher and staff complimentary ticket access for Penncrest Theater.',
    noindex: true
  },
  {
    path: '/admin/*',
    title: 'Admin Portal | Penncrest Theater',
    description: 'Penncrest Theater administrative access.',
    noindex: true
  }
];

export default function RouteSeo() {
  const location = useLocation();
  const isShowDetailsRoute = matchPath('/shows/:id', location.pathname);

  if (isShowDetailsRoute) {
    return null;
  }

  const match = routes.find((route) => matchPath({ path: route.path, end: true }, location.pathname));
  if (!match) {
    return null;
  }

  return (
    <Seo
      title={match.title}
      description={match.description}
      noindex={match.noindex}
      type={match.type}
      structuredData={match.structuredData}
    />
  );
}
