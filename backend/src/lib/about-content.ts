import { z } from 'zod';
import { isImageDataUrl } from './image-data-url.js';

export const aboutPageSlugs = [
  'about',
  'performer',
  'stage-crew',
  'musical-theater',
  'tech-crew',
  'costume-crew',
  'set-design'
] as const;

export type AboutPageSlug = string;

export const aboutSlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'Slug must use lowercase letters, numbers, and hyphens only'
  });

const longText = z.string().trim().min(1).max(2_000);
const shortText = z.string().trim().min(1).max(160);

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function isCalendarUrl(value: string): boolean {
  if (value.startsWith('webcal://')) {
    return isHttpUrl(`https://${value.slice('webcal://'.length)}`);
  }
  return isHttpUrl(value);
}

function isRelativePath(value: string): boolean {
  return value.startsWith('/');
}

function isActionHref(value: string): boolean {
  return isHttpUrl(value) || isRelativePath(value) || value.startsWith('mailto:') || value.startsWith('tel:');
}

const imageSourceSchema = z
  .string()
  .trim()
  .max(2_000_000)
  .refine((value) => isHttpUrl(value) || isImageDataUrl(value) || isRelativePath(value), {
    message: 'Image must be an image URL, image data URL, or site-relative path'
  });

const hrefSchema = z
  .string()
  .trim()
  .max(2_000)
  .refine((value) => isActionHref(value), {
    message: 'Link must be a relative path, http(s) URL, mailto link, or tel link'
  });

const imageSchema = z.object({
  url: imageSourceSchema,
  alt: z.string().trim().max(180).default('')
});

const actionSchema = z.object({
  label: shortText,
  href: hrefSchema
});

const heroSchema = z.object({
  eyebrow: shortText,
  title: shortText,
  accent: shortText,
  description: longText
});

const sectionBaseShape = {
  id: shortText,
  hidden: z.boolean().optional().default(false)
};

const storySectionSchema = z.object({
  ...sectionBaseShape,
  type: z.literal('story'),
  eyebrow: shortText,
  heading: shortText,
  lead: z.string().trim().max(300).default(''),
  paragraphs: z.array(longText).min(1).max(8),
  quote: z.string().trim().max(500).optional().default(''),
  quoteAttribution: z.string().trim().max(160).optional().default('')
});

const linkGridSectionSchema = z.object({
  ...sectionBaseShape,
  type: z.literal('linkGrid'),
  eyebrow: shortText,
  heading: shortText,
  items: z
    .array(
      z.object({
        hidden: z.boolean().optional().default(false),
        title: shortText,
        description: longText,
        href: hrefSchema,
        image: imageSchema.optional()
      })
    )
    .max(40)
});

const peopleSectionSchema = z.object({
  ...sectionBaseShape,
  type: z.literal('people'),
  eyebrow: shortText,
  heading: shortText,
  items: z
    .array(
      z.object({
        name: shortText,
        role: shortText,
        image: imageSchema,
        bio: z.string().trim().max(400).optional().default('')
      })
    )
    .min(1)
    .max(24)
});

const calendarSectionSchema = z.object({
  ...sectionBaseShape,
  type: z.literal('calendar'),
  eyebrow: shortText,
  heading: shortText,
  description: z.string().trim().max(300).default(''),
  calendarUrl: z
    .string()
    .trim()
    .max(2_000)
    .default('')
    .refine((value) => value === '' || isCalendarUrl(value), {
      message: 'Calendar URL must be an http(s) or webcal link'
    })
});

const defaultHistoryItems = [
  {
    year: '2024',
    title: 'Seussical',
    image: {
      url: 'https://picsum.photos/seed/beauty/800/600',
      alt: 'Seussical production photo'
    },
    description: 'Suess!'
  },
  {
    year: '2023',
    title: 'Cinderella',
    image: {
      url: 'https://picsum.photos/seed/cinderella/800/600',
      alt: 'Cinderella production photo'
    },
    description: 'Impossible things are happening every day.'
  },
  {
    year: '2022',
    title: 'Phantom of the Opera',
    image: {
      url: 'https://picsum.photos/seed/phantom/800/600',
      alt: 'Phantom of the Opera production photo'
    },
    description: 'The music of the night.'
  },
  {
    year: '2021',
    title: 'Newsies',
    image: {
      url: 'https://picsum.photos/seed/mamma/800/600',
      alt: 'Newsies production photo'
    },
    description: 'A pair of new shoes with matching laces.'
  },
  {
    year: '2019',
    title: 'Les Miserables',
    image: {
      url: 'https://picsum.photos/seed/lesmis/800/600',
      alt: 'Les Miserables production photo'
    },
    description: 'In our dreams...'
  },
  {
    year: '2018',
    title: 'Some other show',
    image: {
      url: 'https://picsum.photos/seed/grease/800/600',
      alt: 'Penncrest Theater production photo'
    },
    description: 'probobly another show'
  }
] as const;

const historyItemSchema = z.object({
  year: z.string().trim().min(1).max(20),
  title: shortText,
  description: z.string().trim().max(300).default(''),
  image: imageSchema
});

const historySectionSchema = z.object({
  ...sectionBaseShape,
  type: z.literal('history'),
  eyebrow: shortText,
  heading: shortText,
  description: z.string().trim().max(300).default(''),
  items: z.array(historyItemSchema).max(40).default(defaultHistoryItems.map((item) => ({ ...item, image: { ...item.image } })))
});

const featureGridSectionSchema = z.object({
  ...sectionBaseShape,
  type: z.literal('featureGrid'),
  eyebrow: shortText,
  heading: shortText,
  intro: z.string().trim().max(500).default(''),
  items: z
    .array(
      z.object({
        title: shortText,
        description: longText
      })
    )
    .min(1)
    .max(12)
});

const splitFeatureSectionSchema = z.object({
  ...sectionBaseShape,
  type: z.literal('splitFeature'),
  eyebrow: shortText,
  heading: shortText,
  lead: z.string().trim().max(500).default(''),
  body: z.array(longText).min(1).max(6),
  bullets: z.array(z.string().trim().min(1).max(160)).max(12).default([]),
  images: z.array(imageSchema).min(1).max(4),
  calloutTitle: z.string().trim().max(120).optional().default(''),
  calloutBody: z.string().trim().max(400).optional().default('')
});

const testimonialSectionSchema = z.object({
  ...sectionBaseShape,
  type: z.literal('testimonial'),
  eyebrow: shortText,
  heading: shortText,
  quote: z.string().trim().min(1).max(700),
  attribution: z.string().trim().min(1).max(160),
  image: imageSchema
});

const listPanelSectionSchema = z.object({
  ...sectionBaseShape,
  type: z.literal('listPanel'),
  eyebrow: shortText,
  heading: shortText,
  body: z.string().trim().max(500).default(''),
  panelTitle: shortText,
  panelBody: z.string().trim().max(500).default(''),
  items: z.array(z.string().trim().min(1).max(160)).min(1).max(12)
});

const ctaSectionSchema = z.object({
  ...sectionBaseShape,
  type: z.literal('cta'),
  eyebrow: shortText,
  heading: shortText,
  body: z.string().trim().max(500).default(''),
  primary: actionSchema,
  secondary: actionSchema.optional(),
  contactLabel: z.string().trim().max(120).optional().default(''),
  contactValue: z.string().trim().max(240).optional().default('')
});

export const aboutSectionSchema = z.discriminatedUnion('type', [
  storySectionSchema,
  linkGridSectionSchema,
  peopleSectionSchema,
  calendarSectionSchema,
  historySectionSchema,
  featureGridSectionSchema,
  splitFeatureSectionSchema,
  testimonialSectionSchema,
  listPanelSectionSchema,
  ctaSectionSchema
]);

export const aboutPageSchema = z.object({
  slug: aboutSlugSchema,
  navLabel: shortText,
  hero: heroSchema,
  sections: z.array(aboutSectionSchema).min(1).max(12)
});

export type AboutPageContent = z.infer<typeof aboutPageSchema>;
export type AboutSection = z.infer<typeof aboutSectionSchema>;

export const defaultAboutPages: Record<string, AboutPageContent> = {
  about: {
    slug: 'about',
    navLabel: 'About',
    hero: {
      eyebrow: 'Penncrest High School · Media, PA',
      title: 'About the',
      accent: 'Theater Program',
      description: "Do you love to sing, dance, act, paint, draw, or work with technology? There's a place for you here."
    },
    sections: [
      {
        id: 'welcome',
        type: 'story',
        hidden: false,
        eyebrow: 'Welcome',
        heading: 'A creative home for performers, makers, and problem-solvers.',
        lead: "Whatever it is you're interested in, welcome.",
        paragraphs: [
          'Maybe you are interested in trying out for the school musical. Maybe you just want a taste of Musical Theater and want to attend Musical Theater Club.',
          'Maybe you enjoy art and want to be involved with creating props or set pieces through our set design club. Maybe you want to learn more about lights or sound equipment through Tech Crew.',
          "Our theater department is more than a club. It's a community where students find lifelong friendships, discover hidden talents, and create performances our school remembers for years."
        ],
        quote: "Whatever it is you're interested in, welcome. We can't wait for another amazing year on and off the stage.",
        quoteAttribution: 'Jennifer Smith, Director'
      },
      {
        id: 'pathways',
        type: 'linkGrid',
        hidden: false,
        eyebrow: 'Find Your Place',
        heading: 'Get Involved',
        items: [
          {
            hidden: false,
            title: 'Performer',
            description: 'Sing, dance, and act in our fall play and spring musical. All skill levels are welcome.',
            href: '/performer'
          },
          {
            hidden: false,
            title: 'Stage Crew',
            description: 'Build the worlds our actors inhabit through carpentry, painting, props, scenic design, and art.',
            href: '/stage-crew'
          },
          {
            hidden: false,
            title: 'Tech Crew',
            description: 'The magic behind every production, Tech Crew runs lights, sound, and show effects.',
            href: '/tech-crew'
          },
          {
            hidden: false,
            title: 'Costume Crew',
            description: 'Design, fit, and maintain costumes that bring each character and scene to life.',
            href: '/costume-crew'
          }
        ]
      },
      {
        id: 'staff',
        type: 'people',
        hidden: false,
        eyebrow: 'The Team',
        heading: 'Meet the Staff',
        items: [
          {
            name: 'Jennifer Smith',
            role: 'Director',
            image: {
              url: 'https://picsum.photos/seed/director/600/600',
              alt: 'Jennifer Smith portrait'
            },
            bio: 'Leads the performance program, auditions, and artistic vision for each season.'
          },
          {
            name: 'Scott Smith',
            role: 'Technical Director',
            image: {
              url: 'https://picsum.photos/seed/music/600/600',
              alt: 'Scott Smith portrait'
            },
            bio: 'Oversees the technical side of the program, from production planning to show execution.'
          },
          {
            name: 'Ms. Oneil',
            role: 'Program Support',
            image: {
              url: 'https://picsum.photos/seed/dance/600/600',
              alt: 'Ms. Oneil portrait'
            },
            bio: 'Supports students behind the scenes and keeps productions moving with care and detail.'
          }
        ]
      },
      {
        id: 'calendar',
        type: 'calendar',
        hidden: false,
        eyebrow: 'Stay in the Loop',
        heading: 'Upcoming Events',
        description: 'Rehearsals, meetings, and performances all live here.',
        calendarUrl: ''
      },
      {
        id: 'history',
        type: 'history',
        hidden: false,
        eyebrow: '25+ Years',
        heading: 'A Legacy of Performance',
        description: 'Take a look at the productions and students that built Penncrest Theater.',
        items: defaultHistoryItems.map((item) => ({ ...item, image: { ...item.image } }))
      },
      {
        id: 'contact',
        type: 'cta',
        hidden: false,
        eyebrow: 'Contact',
        heading: 'Have a question? Reach out anytime.',
        body: "Whether you're a prospective student, a parent, or simply curious about the program, we'd love to hear from you.",
        primary: {
          label: 'Email the Director',
          href: 'mailto:jsmith3@rtmsd.org'
        },
        secondary: {
          label: 'Explore the Season',
          href: '/shows'
        },
        contactLabel: 'Program Contact',
        contactValue: 'Jennifer Smith · Director, Penncrest Theater'
      }
    ]
  },
  performer: {
    slug: 'performer',
    navLabel: 'Performer',
    hero: {
      eyebrow: 'Center Stage',
      title: 'Performer',
      accent: 'Pathway',
      description: 'Sing, dance, and act in productions that challenge your skills and build your confidence.'
    },
    sections: [
      {
        id: 'performer-overview',
        type: 'featureGrid',
        hidden: false,
        eyebrow: 'On Stage',
        heading: 'What You Will Grow',
        intro:
          'Performers in our program build vocal, acting, movement, and collaboration skills while working in a supportive ensemble.',
        items: [
          {
            title: 'Voice',
            description: 'Strengthen vocal technique through rehearsals, ensemble work, and musical storytelling.'
          },
          {
            title: 'Acting',
            description: 'Develop character and scene work with clear direction and practical feedback.'
          },
          {
            title: 'Movement',
            description: 'Learn choreography and stage movement that supports story, energy, and confidence.'
          }
        ]
      },
      {
        id: 'performer-gallery',
        type: 'splitFeature',
        hidden: false,
        eyebrow: 'In Rehearsal',
        heading: 'Life in the Ensemble',
        lead:
          'From first read-through to closing night, performers grow through repetition, trust, and shared creative energy.',
        body: [
          'Students rehearse scenes, music, and choreography in a structured environment that balances challenge with support.',
          'Along the way, cast members build friendships and confidence that often carry far beyond the stage.'
        ],
        bullets: ['Scene study and character work', 'Vocal rehearsal and harmonies', 'Choreography and stage movement'],
        images: [
          {
            url: 'https://picsum.photos/seed/performer-gallery-1/900/1100',
            alt: 'Performer rehearsing under stage lights'
          },
          {
            url: 'https://picsum.photos/seed/performer-gallery-2/900/1100',
            alt: 'Cast rehearsal moment on stage'
          },
          {
            url: 'https://picsum.photos/seed/performer-gallery-3/900/1100',
            alt: 'Ensemble choreography rehearsal'
          },
          {
            url: 'https://picsum.photos/seed/performer-gallery-4/900/1100',
            alt: 'Performer practicing a solo moment'
          },
          {
            url: 'https://picsum.photos/seed/performer-gallery-5/900/1100',
            alt: 'Cast line run during rehearsal'
          },
          {
            url: 'https://picsum.photos/seed/performer-gallery-6/900/1100',
            alt: 'Ensemble staging on the main set'
          }
        ],
        calloutTitle: 'A Supportive Process',
        calloutBody: 'Every rehearsal is designed to help students take creative risks while learning to work as one ensemble.'
      },
      {
        id: 'performer-cta',
        type: 'cta',
        hidden: false,
        eyebrow: 'Get Started',
        heading: 'Ready to Audition?',
        body: 'If you are interested in joining the cast, connect with the program team and watch for audition announcements.',
        primary: {
          label: 'Contact the Program',
          href: '/about'
        },
        secondary: {
          label: 'View Shows',
          href: '/shows'
        },
        contactLabel: 'Questions',
        contactValue: 'Penncrest Theater Staff'
      }
    ]
  },
  'stage-crew': {
    slug: 'stage-crew',
    navLabel: 'Stage Crew',
    hero: {
      eyebrow: 'Build Team',
      title: 'Stage',
      accent: 'Crew',
      description: 'Construct sets, organize props, and keep backstage operations moving with precision and teamwork.'
    },
    sections: [
      {
        id: 'stage-crew-roles',
        type: 'featureGrid',
        hidden: false,
        eyebrow: 'Backstage Craft',
        heading: 'What Stage Crew Does',
        intro:
          'Stage Crew members help transform plans into physical spaces and keep every scene transition clean and safe.',
        items: [
          {
            title: 'Scenery Build',
            description: 'Assist with scenic construction, assembly, and safe tool use in the workshop.'
          },
          {
            title: 'Props & Dressing',
            description: 'Track, prep, and place props and set dressing so each scene is performance-ready.'
          },
          {
            title: 'Scene Changes',
            description: 'Coordinate transitions during rehearsals and shows with timing and consistency.'
          }
        ]
      },
      {
        id: 'stage-crew-gallery',
        type: 'splitFeature',
        hidden: false,
        eyebrow: 'Build Days',
        heading: 'Backstage in Motion',
        lead:
          'Stage Crew is hands-on and fast-paced, blending planning, construction, and timing during every production week.',
        body: [
          'Students collaborate on set pieces, organize prop tables, and practice transitions until every move is clean and safe.',
          'The work is practical, creative, and essential to keeping performances smooth from curtain up to final bow.'
        ],
        bullets: ['Set construction and paint calls', 'Prop tracking and reset discipline', 'Scene-change timing and safety'],
        images: [
          {
            url: 'https://picsum.photos/seed/stage-crew-gallery-1/900/1100',
            alt: 'Stage crew constructing scenic walls'
          },
          {
            url: 'https://picsum.photos/seed/stage-crew-gallery-2/900/1100',
            alt: 'Backstage prop organization before a show'
          },
          {
            url: 'https://picsum.photos/seed/stage-crew-gallery-3/900/1100',
            alt: 'Crew preparing for a scene transition'
          }
        ],
        calloutTitle: 'Team Coordination',
        calloutBody: 'Stage Crew members learn to communicate clearly and execute under live show pressure.'
      },
      {
        id: 'stage-crew-cta',
        type: 'cta',
        hidden: false,
        eyebrow: 'Join In',
        heading: 'Want to Work Backstage?',
        body: 'Stage Crew welcomes students who enjoy building, organizing, and solving practical problems under pressure.',
        primary: {
          label: 'Contact the Program',
          href: '/about'
        },
        contactLabel: 'Program Contact',
        contactValue: 'Penncrest Theater Staff'
      }
    ]
  },
  'musical-theater': {
    slug: 'musical-theater',
    navLabel: 'Musical Theater',
    hero: {
      eyebrow: 'Center Stage',
      title: 'Musical',
      accent: 'Theater',
      description: 'Sing. Dance. Act. Tell stories that move audiences and create memories that last a lifetime.'
    },
    sections: [
      {
        id: 'pillars',
        type: 'featureGrid',
        hidden: false,
        eyebrow: 'More Than a Club',
        heading: 'Build Your Triple Threat Skills',
        intro:
          "The Musical Theater program is the heart of our performing arts department. We produce two major productions a year, and there's a role for every experience level.",
        items: [
          {
            title: 'Voice',
            description: 'Vocal training and ensemble singing to help students strengthen and trust their sound.'
          },
          {
            title: 'Acting',
            description: 'Character development and scene work that turns great stories into believable performances.'
          },
          {
            title: 'Dance',
            description: 'Choreography for all skill levels, with room for both beginners and experienced movers.'
          }
        ]
      },
      {
        id: 'spotlight',
        type: 'testimonial',
        hidden: false,
        eyebrow: 'Student Spotlight',
        heading: 'It changed my high school experience.',
        quote:
          "I was terrified to audition my freshman year. Four years later, I've found my best friends and my voice. The theater department is a family where everyone is accepted for who they are.",
        attribution: "Sarah M., Class of '24",
        image: {
          url: 'https://picsum.photos/seed/performer/800/1000',
          alt: 'Student performer on stage'
        }
      },
      {
        id: 'auditions',
        type: 'cta',
        hidden: false,
        eyebrow: 'Auditions',
        heading: 'Take the Stage',
        body: "Auditions for the next production are coming up soon. Don't miss your chance to shine.",
        primary: {
          label: 'See Program Info',
          href: '/about'
        },
        contactLabel: '',
        contactValue: ''
      }
    ]
  },
  'tech-crew': {
    slug: 'tech-crew',
    navLabel: 'Tech Crew',
    hero: {
      eyebrow: 'Behind the Scenes',
      title: 'Tech',
      accent: 'Crew',
      description: "The magic doesn't just happen on stage. It happens in the booth, on the catwalks, and in the wings."
    },
    sections: [
      {
        id: 'roles',
        type: 'featureGrid',
        hidden: false,
        eyebrow: 'Find Your Role',
        heading: 'What We Do',
        intro: '',
        items: [
          {
            title: 'Lighting',
            description: 'Design and operate the lighting rig to set the mood and atmosphere for every scene.'
          },
          {
            title: 'Sound',
            description: 'Manage microphones, sound effects, and the overall audio mix for the audience.'
          },
          {
            title: 'Stage Management',
            description: 'Call cues and keep the production moving with precision during rehearsals and performances.'
          },
          {
            title: 'Run Crew',
            description: 'Handle scene changes, props, and backstage logistics in real time.'
          }
        ]
      },
      {
        id: 'equipment',
        type: 'splitFeature',
        hidden: false,
        eyebrow: 'Professional Equipment',
        heading: 'Master the Machine',
        lead:
          "Our theater is equipped with professional-grade technology, and Tech Crew members get hands-on training with the tools that make shows happen.",
        body: [
          'No prior experience is necessary. Students learn by doing, with support from staff and experienced crew members.',
          'The same problem-solving and teamwork skills that make a good crew member also carry into every other part of school and life.'
        ],
        bullets: ['ETC lighting console', 'Digital audio workstations', 'Wireless mic systems'],
        images: [
          {
            url: 'https://picsum.photos/seed/techbooth/1000/700',
            alt: 'Tech booth'
          },
          {
            url: 'https://picsum.photos/seed/techlights/1000/700',
            alt: 'Lighting rig and cue programming'
          },
          {
            url: 'https://picsum.photos/seed/techsound/1000/700',
            alt: 'Sound mixing board during rehearsal'
          }
        ],
        calloutTitle: 'Backstage Leadership',
        calloutBody: 'Crew members learn communication, timing, and calm decision-making under live performance pressure.'
      },
      {
        id: 'join-tech',
        type: 'cta',
        hidden: false,
        eyebrow: 'Join Us',
        heading: 'Join the Crew',
        body: "Ready to run the show? We're always looking for new technicians.",
        primary: {
          label: 'Contact the Program',
          href: '/about'
        },
        contactLabel: '',
        contactValue: ''
      }
    ]
  },
  'costume-crew': {
    slug: 'costume-crew',
    navLabel: 'Costume Crew',
    hero: {
      eyebrow: 'Design & Detail',
      title: 'Costume',
      accent: 'Crew',
      description: 'Help shape each production through wardrobe planning, fittings, quick changes, and character styling.'
    },
    sections: [
      {
        id: 'costume-crew-work',
        type: 'featureGrid',
        hidden: false,
        eyebrow: 'Wardrobe Team',
        heading: 'What Costume Crew Handles',
        intro:
          'Costume Crew supports every performer with practical, durable, and story-accurate wardrobe choices.',
        items: [
          {
            title: 'Design & Selection',
            description: 'Pull and coordinate costume pieces that reflect time period, character, and movement needs.'
          },
          {
            title: 'Fittings & Alterations',
            description: 'Support fittings and simple adjustments so costumes are safe, comfortable, and stage-ready.'
          },
          {
            title: 'Show Run Support',
            description: 'Manage costume tracking, repairs, and quick changes during rehearsal and performance.'
          }
        ]
      },
      {
        id: 'costume-crew-gallery',
        type: 'splitFeature',
        hidden: false,
        eyebrow: 'Wardrobe Studio',
        heading: 'Style That Supports Story',
        lead:
          'Costume Crew blends creativity and practical detail, helping each performer step into character with confidence.',
        body: [
          'From sorting racks to quick-change planning, the costume team keeps garments organized, repaired, and performance-ready.',
          'Students learn fabric care, visual storytelling, and backstage timing while supporting every scene.'
        ],
        bullets: ['Character-based styling choices', 'Fitting and adjustment workflow', 'Quick-change planning during shows'],
        images: [
          {
            url: 'https://picsum.photos/seed/costume-crew-gallery-1/900/1100',
            alt: 'Costume rack arranged for production'
          },
          {
            url: 'https://picsum.photos/seed/costume-crew-gallery-2/900/1100',
            alt: 'Costume fitting and adjustment session'
          }
        ],
        calloutTitle: 'Precision and Creativity',
        calloutBody: 'Costume Crew members balance visual design with practical show needs in every rehearsal and performance.'
      },
      {
        id: 'costume-crew-cta',
        type: 'cta',
        hidden: false,
        eyebrow: 'Get Involved',
        heading: 'Join Costume Crew',
        body: 'If you enjoy fashion, cosplay, styling, or detail work, Costume Crew is a great place to contribute.',
        primary: {
          label: 'Contact the Program',
          href: '/about'
        },
        contactLabel: 'Program Contact',
        contactValue: 'Penncrest Theater Staff'
      }
    ]
  },
  'set-design': {
    slug: 'set-design',
    navLabel: 'Set Design',
    hero: {
      eyebrow: 'Stagecraft',
      title: 'Set',
      accent: 'Design',
      description: 'We build worlds. From concept sketches to final construction, Set Design transforms the stage into new realities.'
    },
    sections: [
      {
        id: 'process',
        type: 'featureGrid',
        hidden: false,
        eyebrow: 'How We Work',
        heading: 'The Process',
        intro: '',
        items: [
          {
            title: 'Design',
            description: 'Visualize the environment with sketches, blueprints, and scale ideas that define the world of the show.'
          },
          {
            title: 'Build',
            description: 'Learn safe carpentry and construction skills while building full-scale scenic pieces.'
          },
          {
            title: 'Paint',
            description: 'Use scenic painting techniques, textures, faux finishes, and details that bring sets to life.'
          }
        ]
      },
      {
        id: 'workshop',
        type: 'splitFeature',
        hidden: false,
        eyebrow: 'The Workshop',
        heading: 'Build Something Real',
        lead:
          'Our scene shop is a hive of activity where students learn practical skills that go beyond theater.',
        body: [
          'Set Design teaches project management, structural thinking, collaboration, and craftsmanship through real productions.',
          'Students see an idea move from concept to construction, then onto the stage in front of a live audience.'
        ],
        bullets: ['Concept sketches and layouts', 'Scenic construction', 'Painting and props'],
        images: [
          {
            url: 'https://picsum.photos/seed/set1/800/1000',
            alt: 'Set construction'
          },
          {
            url: 'https://picsum.photos/seed/set2/800/1000',
            alt: 'Painting scenery'
          }
        ],
        calloutTitle: 'Props Department',
        calloutBody: 'The props team sources, builds, and modifies every object actors use on stage.'
      },
      {
        id: 'join-set',
        type: 'cta',
        hidden: false,
        eyebrow: 'Get Involved',
        heading: 'Grab a Hammer',
        body: 'Set Design meets regularly during production season. Come build something amazing.',
        primary: {
          label: 'Learn More',
          href: '/about'
        },
        contactLabel: '',
        contactValue: ''
      }
    ]
  }
};

export function parseAboutPageContent(value: unknown): AboutPageContent {
  return aboutPageSchema.parse(value);
}

export function getDefaultAboutPage(slug: string): AboutPageContent | null {
  const page = defaultAboutPages[slug];
  if (!page) {
    return null;
  }
  return structuredClone(page);
}

export function listDefaultAboutPages(): AboutPageContent[] {
  return aboutPageSlugs
    .map((slug) => getDefaultAboutPage(slug))
    .filter((page): page is AboutPageContent => Boolean(page));
}

export function buildAboutPageTitle(page: AboutPageContent): string {
  return [page.hero.title, page.hero.accent].filter(Boolean).join(' ').trim() || page.navLabel;
}
