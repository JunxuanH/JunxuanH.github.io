/**
 * Single source of truth for the résumé + projects. Rendered three ways: the Neon Harbor holo slabs
 * (index.astro → scene/night/content.ts), the flat/no-WebGPU page, and /resume (+ the PDF).
 */
export const profile = {
  name: 'Ivan He',
  title: 'GPU Software Performance Engineer',
  location: 'San Francisco Bay Area',
  summary:
    'GPU performance engineer working across graphics, games and machine-learning workloads — profiling, finding the bottleneck, and building the tooling that keeps it found.',
  links: {
    linkedin: 'https://www.linkedin.com/in/ivan-he-026355130/',
    github: 'https://github.com/JunxuanH',
    site: 'https://junxuanh.github.io',
  },
};

export const education = {
  school: 'University of California, Berkeley',
  degree: 'B.A. Cognitive Science',
  dates: '2015 – 2019',
  location: 'Berkeley, CA',
  certifications: [
    'Google Cloud Platform Fundamentals: Core Infrastructure',
    'Architecting with Google Compute Engine (Specialization)',
  ],
  skills: ['GPU performance analysis', 'C# / .NET', 'Java', 'Perl automation', 'Python', 'TypeScript / three.js'],
  /** One line per certification / skill (what it is, when, how it was used): the terminal's expandable rows. */
  details: {
    'Google Cloud Platform Fundamentals: Core Infrastructure':
      'GCP core infrastructure: projects, IAM, networking, storage and billing \u2014 the groundwork for cloud-hosted test fleets.',
    'Architecting with Google Compute Engine (Specialization)':
      'Compute Engine: VPCs, load balancing, instance groups and autoscaling \u2014 how disposable benchmark fleets get built.',
    'GPU performance analysis': 'Profiling graphics, game and ML workloads at AMD and Apple: traces, counters, frame-time statistics \u2014 find the bottleneck.',
    'C# / .NET': 'The AMD auto-report tool (2017): a .NET pipeline that moved test results between departments without the spreadsheets.',
    'Java': 'Berkeley coursework and the first test harnesses; still the language of choice when a tool has to live on the JVM.',
    'Perl automation': 'AMD 2017: automated GPU testing and benchmarking of upcoming game titles across driver builds.',
    'Python': 'Daily driver for analysis: the frame-time anomaly model (AMD 2018), data pipelines and plots.',
    'TypeScript / three.js': 'This site \u2014 Neon Harbor runs on Astro + three.js WebGPU \u2014 and the trip planner\u2019s 3D route maps.',
  } as Record<string, string>,
};

export interface Job {
  id: string;
  /** Short label for the neon sign / nav. */
  label: string;
  org: string;
  role: string;
  dates: string;
  location: string;
  /** One-line context shown under the role. */
  team?: string;
  bullets: string[];
  /** Poster pages (bus-stop carrier): the same story split by summer; `bullets` stays the résumé wording. */
  pages?: { title: string; bullets: string[] }[];
}

export const jobs: Job[] = [
  {
    id: 'amd-intern',
    label: 'AMD · 2017–18',
    org: 'AMD',
    role: 'Co-Op / Intern Engineer',
    dates: 'Jun 2017 – Aug 2017 · May 2018 – Aug 2018',
    location: 'Sunnyvale & Santa Clara, CA',
    team: 'GPU performance & driver test',
    bullets: [
      'Built a model that flags anomalous GPU frame times and ranks statistically significant frames for draw-call trace analysis.',
      'Wrote Perl automation for GPU testing and benchmarking of upcoming game titles; tested and reviewed driver optimizations.',
      'Developed an auto-report tool on the .NET framework to speed up inter-departmental data flow.',
      'Built and debugged test systems from components.',
    ],
    pages: [
      {
        title: 'Summer 2017 \u00b7 Sunnyvale',
        bullets: [
          'Wrote Perl automation for GPU testing and benchmarking of upcoming game titles.',
          'Tested and reviewed driver optimizations ahead of release.',
          'Developed an auto-report tool on the .NET framework to speed up inter-departmental data flow.',
          'Built and debugged test systems from components.',
        ],
      },
      {
        title: 'Summer 2018 \u00b7 Santa Clara',
        bullets: [
          'Built a model that flags anomalous GPU frame times across benchmark runs.',
          'Ranked statistically significant frames for draw-call trace analysis.',
        ],
      },
    ],
  },
  {
    id: 'kioxia',
    label: 'KIOXIA · 2019–21',
    org: 'KIOXIA America (formerly Toshiba Memory America)',
    role: 'Technical Marketing Engineer → Technical Product Manager',
    dates: 'Jun 2019 – Jul 2021',
    location: 'San Jose, CA',
    team: 'Client SSD',
    bullets: [
      'Bridged customer requirements and product development: reviewed product specifications, helped author MRDs and drafted technical responses to customer inquiries.',
      'Benchmarked client SSD performance and analysed test results against Toshiba’s performance requirements.',
      'Produced technical marketing collateral that explained the advantages of the client SSD line.',
    ],
  },
  {
    id: 'amd-dc',
    label: 'AMD · 2021–22',
    org: 'AMD',
    role: 'Software System Designer',
    dates: 'Jul 2021 – Jul 2022',
    location: 'Santa Clara, CA',
    team: 'Data Center GPU Performance Engineering',
    bullets: [
      'Defined performance suites and profiled machine-learning and HPC workloads on AMD data-center GPUs to identify bottlenecks.',
      'Drove optimizations of ML and HPC models on AMD GPUs from those findings.',
      'Built tooling that streamlined collecting and assessing performance metrics across the team.',
    ],
  },
  {
    id: 'apple',
    label: 'APPLE · 2022–',
    org: 'Apple',
    role: 'GPU Software Performance Engineer',
    dates: 'Aug 2022 – Present',
    location: 'Cupertino, CA',
    team: 'Games, Graphics & Machine Learning org',
    bullets: [],
  },
];

export interface Project {
  id: string;
  name: string;
  tagline: string;
  description: string;
  stack: string[];
  /** Public repo, if any. */
  github?: string;
  /** Live URL, if any. */
  live?: string;
  /** Screenshot under public/night/projects/. */
  shot: string;
  status?: string;
}

export const projects: Project[] = [
  {
    id: 'trip-planner',
    name: 'Trip Planner',
    tagline: 'A whole itinerary in one self-contained HTML file.',
    description:
      'Day-by-day timelines paired with street maps drawn from real OpenStreetMap geometry, every booking link, hotel cards, budget and a prioritised booking list — plus a 20-slide deck that opens on a 3D map with the route drawn on. Serverless endpoints let the plan be edited on-site.',
    stack: ['TypeScript', 'three.js', 'OpenStreetMap', 'Vercel Functions', 'Claude API'],
    github: 'https://github.com/JunxuanH/trip-planner',
    shot: '/night/projects/trip-planner.webp',
  },
  {
    id: 'chordsmith',
    name: 'Chordsmith',
    tagline: 'Songwriting workspace: click a word, attach a chord.',
    description:
      'Write lyrics, click any word to hang a chord above it, drop in guitar-tab blocks and transpose the whole song by semitone while keeping sharps, flats and slash-bass notation intact. Local-first, prints to a clean chart.',
    stack: ['React', 'TypeScript', 'Vite'],
    github: 'https://github.com/JunxuanH/chordsmith',
    shot: '/night/projects/chordsmith.webp',
  },
  {
    id: 'okaybuddy',
    name: 'okaybuddy',
    tagline: 'Language exchange with voice rooms and in-chat corrections.',
    description:
      'Web + mobile app on one Supabase backend: tap any message to translate it, suggest corrections on what your partner sends, and drop into live voice rooms hosted in your target language.',
    stack: ['Next.js', 'Expo', 'Supabase', 'LiveKit', 'Claude', 'Stripe'],
    shot: '/night/projects/okaybuddy.webp',
    status: 'private beta',
  },
  {
    id: 'hearthly',
    name: 'Hearthly',
    tagline: 'Close, even when you’re far apart.',
    description:
      'A subscription web app for couples in long-distance relationships: a quiz-led onboarding funnel, an AI visit-plan generator, daily questions and “send a treat” — with Stripe trials and a warm, serif design system.',
    stack: ['Next.js 15', 'React 19', 'Supabase', 'Stripe', 'Claude', 'Resend'],
    shot: '/night/projects/hearthly.webp',
    status: 'private beta',
  },
];

/** Scroll-progress windows (0–1 along the journey) during which each slab is on screen. */
export const WINDOWS: Record<string, [number, number]> = {
  education: [0.165, 0.245],
  'amd-intern': [0.27, 0.36],
  kioxia: [0.39, 0.48],
  'amd-dc': [0.49, 0.585],
  apple: [0.62, 0.70],
  projects: [0.715, 0.865],
  contact: [0.945, 1.001],
};
