/**
 * What the residents of Neon Harbor say when the protagonist talks to them (scene/night/dialogue.ts).
 * Every line is anchored in content.ts: the Berkeley degree and the Google Cloud certifications on Campus,
 * the four jobs Downtown, the four projects at the Market, the departures board at the Harbor — plus a pool of
 * lines about the city itself. Fictional resident names; nothing about Ivan that the résumé does not say.
 *
 * An exchange is 1–3 short lines (≤ 95 characters each: one typed box on a phone). Bots speak in terse status
 * lines, the cat courier is cheeky, the schoolgirl hacker is a fan. `linesFor(rig, section)` returns the
 * résumé exchanges for a rig in a district (a per-section pool when a rig has none of its own),
 * `cityLinesFor(rig)` the city-meta exchanges in that rig's voice.
 */
export type Section = 'education' | 'work' | 'projects' | 'contact';
export type Voice = 'human' | 'bot' | 'cat';

export interface Persona {
  /** Short display name (the HUD prompt says "Talk to <name>"). */
  name: string;
  /** Kicker after the name: "RIN · script kiddie". */
  title?: string;
  voice: Voice;
  /** Typewriter blip pitch (Hz); bots chirp high, the oni rumbles. */
  pitch?: number;
}

/** One persona per fal rig (the protagonist is a netrunner too, but not a resident). */
export const PERSONAS: Record<string, Persona> = {
  'netrunner': { name: 'A NETRUNNER', title: 'no handle given', voice: 'human', pitch: 880 },
  'corpo': { name: 'MS. TANAKA', title: 'corpo, 88th floor', voice: 'human', pitch: 1040 },
  'vendor': { name: 'OLD WU', title: 'stall keeper', voice: 'human', pitch: 820 },
  'punk': { name: 'SPIKE', title: 'punk', voice: 'human', pitch: 960 },
  'sec-bot': { name: 'SEC-BOT 0x1F', title: 'plaza security', voice: 'bot', pitch: 1500 },
  'chef': { name: 'CHEF HIRO', title: 'night kitchen', voice: 'human', pitch: 900 },
  'geisha-bot': { name: 'UNIT HANA', title: 'hostess android', voice: 'bot', pitch: 1700 },
  'idol': { name: 'MIRAI', title: 'holo idol', voice: 'human', pitch: 1180 },
  'ronin': { name: 'KENJI', title: 'ronin-for-hire', voice: 'human', pitch: 760 },
  'schoolgirl-hacker': { name: 'RIN', title: 'script kiddie', voice: 'human', pitch: 1240 },
  'mech-pilot': { name: 'PILOT OKADA', title: 'mech corps', voice: 'human', pitch: 860 },
  'cat-courier': { name: 'NEKO', title: 'courier', voice: 'cat', pitch: 1320 },
  'oni-bouncer': { name: 'GORO', title: 'bouncer, Stop 47', voice: 'human', pitch: 640 },
  'maid-bot': { name: 'UNIT MAI-7', title: 'service android', voice: 'bot', pitch: 1600 },
  'medic': { name: 'DR. SATO', title: 'street medic', voice: 'human', pitch: 980 },
  'skater': { name: 'DASH', title: 'skater', voice: 'human', pitch: 1100 },
  'salaryman': { name: 'MR. NAKAMURA', title: 'salaryman', voice: 'human', pitch: 900 },
  'dj': { name: 'DJ VOLT', title: 'resident DJ', voice: 'human', pitch: 1020 },
  'nomad': { name: 'ASH', title: 'nomad', voice: 'human', pitch: 840 },
  'noodle-cook': { name: 'AUNTIE MEI', title: 'noodle stand', voice: 'human', pitch: 940 },
  'patrol-bot': { name: 'PATROL-BOT P-09', title: 'avenue patrol', voice: 'bot', pitch: 1440 },
};

/** How many residents came out of the fal pipeline (the city-meta lines quote it). */
export const RESIDENT_COUNT = Object.keys(PERSONAS).length;

export function personaFor(rig: string): Persona {
  return PERSONAS[rig] ?? { name: rig.replace(/-/g, ' ').toUpperCase(), voice: 'human' };
}

type Exchange = string[];
type Book = Partial<Record<Section, Exchange[]>>;

// ---------------------------------------------------------------------------------------------------------------
// Résumé lines per rig × district. Only the rigs that walk a district (paths.ts DISTRICT_CROWDS, the carrier NPCs)
// get bespoke lines there; everyone else falls through to the section pools below.
// ---------------------------------------------------------------------------------------------------------------
const LINES: Record<string, Book> = {
  'schoolgirl-hacker': {
    education: [
      ['Oh. My. Circuits. You’re talking to me? I read his GPU profiling notes like manga.',
        'Berkeley, B.A. Cognitive Science, 2015 to 2019. I have the dates memorised.',
        'Don’t tell him I said that.'],
      ['See this terminal? His whole toolbox is on it. Perl, Python, C#, Java, TypeScript.',
        'He learned Java at Berkeley and wrote his first test harnesses in it. First! Harnesses!',
        'I can barely get my scripts to compile.'],
      ['He’s got two Google Cloud certs: Core Infrastructure and Architecting with Compute Engine.',
        'VPCs, load balancing, autoscaling. He spins up disposable benchmark fleets like it’s nothing.',
        'Some day I’ll have a fleet. Today I have one laptop.'],
      ['Cognitive Science, right? He studied how minds work, then went and profiled GPUs.',
        'Turns out finding the bottleneck is the same job either way.'],
    ],
    work: [
      ['I followed him here from Campus. Don’t look at me like that, it’s research.',
        'AMD in 2017, KIOXIA in 2019, AMD again in 2021, Apple since 2022. I have a chart.'],
    ],
  },
  'geisha-bot': {
    education: [
      ['> WELCOME TO THE CAMPUS PLAZA.',
        '> RECORD: IVAN HE. UNIVERSITY OF CALIFORNIA, BERKELEY. B.A. COGNITIVE SCIENCE, 2015–2019.',
        '> HOSPITALITY SUBROUTINE: DEEPLY IMPRESSED.'],
      ['> HIS TOOLBOX HOLDS SIX ENTRIES. MINE HOLDS TEA.',
        '> PERL. PYTHON. C#/.NET. JAVA. TYPESCRIPT/THREE.JS. GPU PERFORMANCE ANALYSIS.',
        '> I HAVE ORDERED MORE TEA.'],
      ['> CERTIFICATION SCAN: GOOGLE CLOUD FUNDAMENTALS. ARCHITECTING WITH COMPUTE ENGINE.',
        '> RESULT: HE COULD REBUILD THIS PLAZA IN THE CLOUD BEFORE THE KETTLE BOILS.'],
    ],
  },
  'ronin': {
    education: [
      ['A blade is only as good as the years spent sharpening it.',
        'Four years at Berkeley, 2015 to 2019. Cognitive Science. He sharpened the mind first.',
        'Then he went after GPUs. Wise order.'],
      ['Cognitive Science. The study of how a mind finds patterns.',
        'Now he finds the pattern in a frame-time trace. Same discipline, sharper blade.'],
      ['I carry one sword. He carries Perl, Python, C#, Java and TypeScript.',
        'I would not duel him.'],
    ],
  },
  'netrunner': {
    education: [
      ['Keep your voice down. Word is he trained at Berkeley. Cognitive Science, class of 2019.',
        'That’s how you learn to see the bottleneck before the profiler does.'],
      ['Google Cloud certified. Core Infrastructure, Compute Engine architecture, the works.',
        'IAM, VPCs, autoscaling. He can raise a benchmark fleet and burn it down by morning.',
        'Leaves no trace. I respect that.'],
      ['Python for the analysis, Perl for the automation, TypeScript for... all of this.',
        'The city is rendered in his daily drivers.'],
    ],
    work: [
      ['Word on the grid: he went from testing drivers at AMD to profiling Apple’s GPU stack.',
        'Years of finding the slow part and fixing it. That’s not a job, that’s a calling.'],
      ['His 2018 anomaly model ranks the frames that matter for draw-call trace analysis.',
        'Statistical significance. Not vibes. The grid respects that.'],
      ['KIOXIA, 2019 to 2021. Client SSDs. He helped write the MRDs and answered the hard questions.',
        'Then back to AMD to profile data-center GPUs. Then Apple. Nobody on the grid has that arc.'],
    ],
  },
  'oni-bouncer': {
    education: [
      ['You want in? Berkeley let him in. 2015. Cognitive Science.',
        'Walked out in 2019 with a B.A. and a plan. That’s the kind of guest I let through.'],
      ['Two Google Cloud certs. Core Infrastructure. Compute Engine.',
        'Man builds test fleets in the cloud. I build lines outside clubs. We’re not the same.'],
    ],
    work: [
      ['Stop 47. That poster’s the whole story. Sunnyvale 2017, Santa Clara 2018.',
        'Perl scripts, driver tests, a .NET report tool, and a model that catches bad frames.',
        'Two summers. I’ve had longer shifts with less to show.'],
      ['He built test systems from components as an intern. From parts. With his hands.',
        'Then benchmarked unreleased games on them. I check IDs. Different worlds.'],
      ['Nobody waits at this stop anymore. They read the poster and walk off inspired.',
        'Bad for the bus. Good for the city.'],
    ],
  },
  'skater': {
    education: [
      ['Yo, that terminal? His whole toolbox is on it. Six entries deep.',
        'Perl, Python, C#, Java, TypeScript, and GPU perf analysis. That’s a full deck.',
        'I know like... one trick.'],
      ['Berkeley, 2015 to 2019. Cognitive Science.',
        'Dude studied how brains work and then went and made GPUs go faster. Sick.'],
      ['He wrote this whole campus in TypeScript. The pond, the torii, the koi.',
        'The koi! Who codes koi?!'],
    ],
    projects: [
      ['Trip Planner’s my favourite. Whole itinerary, one HTML file, maps with real street geometry.',
        'I plan skate trips with it. Well, I would, if I planned anything.'],
      ['okaybuddy’s got live voice rooms in whatever language you’re learning.',
        'Tap a message, it translates. Your partner can correct you in-chat. Private beta though.'],
    ],
  },
  'maid-bot': {
    education: [
      ['> GUEST DETECTED. SERVICE MODE.',
        '> QUERY: IVAN HE. B.A. COGNITIVE SCIENCE, UC BERKELEY, 2015–2019.',
        '> RESPECT LEVEL: MAX.'],
      ['> SKILL INVENTORY: GPU PERFORMANCE ANALYSIS. C#/.NET. JAVA. PERL. PYTHON. TYPESCRIPT.',
        '> INVENTORY OF THIS UNIT: ONE DUSTER.',
        '> DISPARITY NOTED.'],
      ['> GOOGLE CLOUD CERTIFICATIONS: TWO.',
        '> CORE INFRASTRUCTURE. COMPUTE ENGINE SPECIALIZATION.',
        '> THIS UNIT WOULD FOLLOW HIM INTO ANY DATA CENTRE.'],
    ],
    projects: [
      ['> STALL INVENTORY: TRIP PLANNER. CHORDSMITH. OKAYBUDDY. HEARTHLY.',
        '> STACKS: TYPESCRIPT, THREE.JS, REACT, NEXT.JS, SUPABASE, STRIPE, CLAUDE.',
        '> THIS UNIT REQUESTS A TRANSFER TO HIS PROJECTS.'],
      ['> TRIP PLANNER: ONE SELF-CONTAINED HTML FILE. TIMELINES, MAPS, BOOKINGS, BUDGET.',
        '> SERVERLESS ENDPOINTS FOR ON-SITE EDITS.',
        '> TIDINESS RATING: EXEMPLARY.'],
    ],
  },
  'salaryman': {
    education: [
      ['Excuse me. Do you know whose campus this is? Berkeley graduate, 2019. Cognitive Science.',
        'I went to the office. He went and learned how minds work. Then GPUs.',
        'I should have taken more electives.'],
      ['Cloud certified, twice over. Core Infrastructure and Compute Engine architecture.',
        'My company took three quarters to set up one VPC. He’d have it up by lunch.'],
    ],
    work: [
      ['Same avenue, different shifts. AMD 2017. KIOXIA 2019. AMD again 2021. Apple 2022.',
        'Every move, up. I’ve been at the same desk for eleven years.',
        'Not that I’m counting.'],
      ['He wrote an auto-report tool on .NET back in 2017. Moved data between departments.',
        'No spreadsheets. Do you know how many spreadsheets I have open right now? Forty-one.'],
      ['Technical Product Manager for client SSDs at KIOXIA. MRDs, specs, customer inquiries.',
        'He answered the hard questions. I forward them.'],
    ],
  },
  'corpo': {
    work: [
      ['You’re standing in his career, you know. Four employers, one straight line up.',
        'AMD as a co-op in 2017 and 2018. KIOXIA in 2019. Back to AMD in 2021. Apple since 2022.',
        'My board would kill for a trajectory like that.'],
      ['At KIOXIA he bridged customers and engineering. Product specs, MRDs, technical responses.',
        'Technical Marketing Engineer to Technical Product Manager in two years.',
        'That’s not a promotion, that’s a statement.'],
      ['Apple. GPU Software Performance Engineer, Games, Graphics and Machine Learning org.',
        'Ask me what he does there. Go on. I don’t know. That’s how you know it matters.'],
      ['He builds the tooling that keeps the bottleneck found. Those are his words.',
        'I’ve paid consultants six figures for less clarity.'],
    ],
  },
  'mech-pilot': {
    work: [
      ['In 2021 he profiled ML and HPC workloads on AMD’s data-center GPUs.',
        'Defined the performance suites. Found the bottlenecks. Drove the optimizations.',
        'That’s the ground crew a pilot dreams of.'],
      ['Summer of 2017, he built test systems from components. Actual components.',
        'Then wrote Perl to benchmark upcoming game titles on them, driver build after driver build.',
        'My mech has fewer moving parts.'],
      ['Frame-time anomalies. He built a model in 2018 that flags them and ranks the worst frames.',
        'Every stutter I feel in this cockpit, he’d have a draw-call trace for by morning.'],
    ],
    contact: [
      ['Pad’s clear. The hover car takes you back to the vista whenever you’re done.',
        'Before you go: LinkedIn and GitHub are on the board. The résumé PDF too. Message him.'],
      ['Every pilot needs ground control. Every team needs someone who finds the bottleneck.',
        'The board has his coordinates. That’s all I’m saying.'],
    ],
  },
  'medic': {
    work: [
      ['Think of it as diagnosis. Profile the workload, find the bottleneck, fix it.',
        'He did that for ML and HPC on AMD’s data-center GPUs in 2021. Now he does it at Apple.',
        'I do it for knife wounds. Same instinct.'],
      ['Anomalous frame times. He built a model that flags them, back in 2018.',
        'Ranked the statistically significant frames for trace analysis. Triage, basically.',
        'The man would make a fine ER doctor.'],
      ['KIOXIA, 2019 to 2021. Benchmarked client SSDs against Toshiba’s performance requirements.',
        'Rigorous. I like rigorous. Rigorous keeps people alive.'],
    ],
    contact: [
      ['Take a breath. You made it to the harbour. That’s the whole tour.',
        'If you want to talk to him, the departures board lists LinkedIn and GitHub.',
        'Doctor’s orders: send the message.'],
      ['He built this pier to hold his contact links. A split-flap board. Over water. With reflections.',
        'Most people use a footer. He’s not most people.'],
    ],
  },
  'idol': {
    work: [
      ['Every fan asks who lights this stage. I tell them: the GPU guy.',
        'AMD, KIOXIA, AMD again, Apple. Four venues, one headliner. Total sell-out tour.',
        'I’d open for him.'],
      ['He tested driver optimizations for upcoming game titles at AMD in 2017. Upcoming!',
        'He saw the games before the games came out. That’s backstage access, darling.'],
      ['Apple’s Games, Graphics and Machine Learning org, since 2022.',
        'Profiling, finding the bottleneck, building the tooling that keeps it found. That’s the chorus.'],
    ],
  },
  'patrol-bot': {
    work: [
      ['> HALT. IDENTIFY.',
        '> ...VISITOR CLEARED. YOU ARE A GUEST OF IVAN HE.',
        '> RECORD: AMD 2017–18. KIOXIA 2019–21. AMD 2021–22. APPLE 2022–PRESENT. NO INCIDENTS.'],
      ['> PATROL LOG: FRAME TIMES ON THIS AVENUE ARE NOMINAL.',
        '> CAUSE: THE SUBJECT PROFILES GPUS FOR A LIVING.',
        '> THIS UNIT HAS NEVER STUTTERED. THIS UNIT IS GRATEFUL.'],
      ['> 2021 ASSIGNMENT: DATA CENTER GPU PERFORMANCE ENGINEERING. ML AND HPC WORKLOADS.',
        '> TOOLING BUILT. METRICS COLLECTED. BOTTLENECKS IDENTIFIED.',
        '> RESPECT LEVEL: MAX.'],
    ],
  },
  'cat-courier': {
    work: [
      ['Mrrp. Package for Downtown. It’s his résumé again. Everyone wants a copy.',
        'AMD, KIOXIA, AMD, Apple. I’ve delivered it so many times I could recite it. I just did.'],
      ['He built a .NET auto-report tool in 2017 so departments wouldn’t need a courier.',
        'Rude. Brilliant, but rude.'],
      ['Client SSD benchmarks at KIOXIA. Data-center GPU perf at AMD. Apple after that.',
        'I nap on warm hardware. He makes it faster. We have an understanding.'],
    ],
    projects: [
      ['Mrrp. Four projects. I’ve delivered feedback on all of them. Mostly “meow”.',
        'The Trip Planner has a 3D map with the route drawn on. I walked on the keyboard. It survived.'],
      ['Hearthly sends treats to your long-distance partner. “Send a treat”. A button. For treats.',
        'I have never respected a feature more.'],
      ['Chordsmith: click a word, hang a chord on it. Transpose the whole song by a semitone.',
        'I sat on the transpose key once. Every chord went up. Nobody noticed. Great software.'],
    ],
    contact: [
      ['Mrrp. Last stop. You want his details? Departures board. LinkedIn, GitHub, the résumé PDF.',
        'I’d deliver your message myself but I’ve got a nap scheduled.'],
      ['He’s on GitHub as JunxuanH. Trip Planner and Chordsmith are right there in the open.',
        'Star them. Cats like stars.'],
    ],
  },
  'punk': {
    work: [
      ['Corporate ladder? Nah. He built his own. AMD, KIOXIA, AMD, Apple.',
        'Every rung, he found the bottleneck and kicked it. That’s punk.'],
      ['Perl automation for benchmarking unreleased games, 2017. Unreleased!',
        'Kid was hacking on tomorrow’s titles before they had box art.'],
    ],
    projects: [
      ['Chordsmith. Lyrics, chords, tab blocks, transpose in one click. Local-first. No cloud nonsense.',
        'Prints a clean chart. My band’s whole setlist runs on it.'],
      ['Trip Planner: one HTML file, no server needed to read it. That’s anti-establishment.',
        'Then he added serverless endpoints so you can edit it on the road. Fine. Also cool.'],
    ],
  },
  'dj': {
    work: [
      ['You feel that? No dropped frames. Not one. That’s the GPU guy’s doing.',
        'Profiling, finding the bottleneck, keeping it found. That’s the beat, baby.'],
      ['2021, data-center GPUs, ML and HPC workloads. He tuned the whole set.',
        'Then Apple picked him up in 2022. Headliner status.'],
    ],
    projects: [
      ['Chordsmith! Click a word, drop a chord. Transpose by semitone, slash-bass intact.',
        'Local-first, prints clean. That’s my setlist tool now. The man makes music software.'],
      ['Four projects on that stall. Trip Planner, Chordsmith, okaybuddy, Hearthly.',
        'Each one a different genre. That’s range, baby.'],
    ],
  },
  'chef': {
    projects: [
      ['A good dish is one plate, no fuss. His Trip Planner? One HTML file. The whole itinerary.',
        'Day-by-day timelines, street maps from real OpenStreetMap geometry, hotel cards, budget.',
        'Chef’s kiss.'],
      ['Chordsmith. You write lyrics, click a word, hang a chord on it.',
        'Transpose the whole song by a semitone and the sharps and flats stay honest.',
        'That’s knife work.'],
      ['Hearthly. For couples living apart. AI visit plans, daily questions, “send a treat”.',
        'Private beta, warm serif design. I’d cook for that launch.'],
    ],
  },
  'vendor': {
    projects: [
      ['Browse, browse! Four projects, all his. Trip Planner, Chordsmith, okaybuddy, Hearthly.',
        'Two on GitHub, two in private beta. No haggling. They’re priceless.'],
      ['The Trip Planner ships a 20-slide deck that opens on a 3D map with the route drawn on.',
        'Serverless endpoints so you can edit the plan on-site. One file! I sell socks.'],
      ['okaybuddy: language exchange. Tap a message, it translates. Voice rooms in your target tongue.',
        'Web and mobile on one Supabase backend. Private beta. I’ve asked for an invite six times.'],
    ],
  },
  'noodle-cook': {
    projects: [
      ['Eat something. You look like you’ve been walking all night.',
        'You know he built this whole market? Every stall, every steam vent. The Trip Planner too.',
        'One HTML file, with real street maps inside. I can’t even fold a paper map.'],
      ['Chordsmith is his. Type a word, click it, a chord hangs above it.',
        'My nephew uses it for his band. They’re terrible, but the charts print beautifully.'],
      ['Hearthly, that one’s for couples far apart. Quiz onboarding, visit plans, daily questions.',
        '“Close, even when you’re far apart.” I cried a little. Don’t tell the chef.'],
    ],
  },
  'nomad': {
    contact: [
      ['End of the line. The departures board has his LinkedIn and GitHub on it.',
        'Message him. People who build cities tend to answer.'],
      ['I’ve crossed a lot of cities. None of them were built by one person.',
        'Astro, three.js, WebGPU. Every sign, every drop of rain. The résumé PDF is on the board too.'],
      ['Berkeley to AMD to KIOXIA to AMD to Apple, and now this harbour.',
        'If you want to know where he’s going next, ask him. The board has the links.'],
    ],
  },
};

// ---------------------------------------------------------------------------------------------------------------
// Section pools: any rig without bespoke lines for the district it is in (a roster change in paths.ts) says these.
// ---------------------------------------------------------------------------------------------------------------
const POOL: Record<Voice, Record<Section, Exchange[]>> = {
  human: {
    education: [
      ['Berkeley graduate, Cognitive Science, class of 2019. Two Google Cloud certifications.',
        'The whole toolbox is on that terminal. Go read it.'],
      ['He learned Java at Berkeley and built his first test harnesses in it.',
        'Now Python is the daily driver. Everything in between, he picked up on the job.'],
      ['Core Infrastructure, Compute Engine architecture. He’s certified for both.',
        'Disposable benchmark fleets in the cloud. That’s what those certs are for, he says.'],
    ],
    work: [
      ['AMD, KIOXIA, AMD again, then Apple since 2022. GPU performance, start to finish.',
        'Profiling, finding the bottleneck, building the tooling that keeps it found.'],
      ['Two summers at AMD as a co-op. Perl automation, driver tests, a .NET report tool.',
        'Then a model that catches anomalous frame times. As an intern. Imagine.'],
      ['KIOXIA made him a Technical Product Manager for client SSDs. MRDs, specs, benchmarks.',
        'Then AMD’s data-center GPU team. Then Apple. The avenue only goes one way for him: up.'],
    ],
    projects: [
      ['Four projects on the stall: Trip Planner, Chordsmith, okaybuddy, Hearthly.',
        'Two on GitHub, two in private beta. Browse the stall, you’ll see.'],
      ['The Trip Planner is a whole itinerary in one HTML file. Real OpenStreetMap streets inside.',
        'Chordsmith hangs chords on lyrics. He makes tools people actually use.'],
      ['okaybuddy is language exchange with voice rooms. Hearthly keeps long-distance couples close.',
        'Both in private beta. Both built on one Supabase backend each. He ships.'],
    ],
    contact: [
      ['The departures board has his LinkedIn, GitHub and the résumé PDF.',
        'Message him. He built a city to say hello. The least you can do is reply.'],
      ['This is where the tour ends. The hover car takes you back to the vista.',
        'His links are on the board. LinkedIn, GitHub. Go on.'],
    ],
  },
  bot: {
    education: [
      ['> QUERY: IVAN HE. B.A. COGNITIVE SCIENCE, UC BERKELEY, 2015–2019. GOOGLE CLOUD CERTIFIED.',
        '> RESPECT LEVEL: MAX.'],
      ['> TOOLBOX: GPU PERFORMANCE ANALYSIS. C#/.NET. JAVA. PERL. PYTHON. TYPESCRIPT/THREE.JS.',
        '> ASSESSMENT: OVERQUALIFIED TO TALK TO THIS UNIT.'],
    ],
    work: [
      ['> EMPLOYMENT LOG: AMD 2017–18. KIOXIA 2019–21. AMD 2021–22. APPLE 2022–PRESENT.',
        '> SPECIALTY: GPU PERFORMANCE. BOTTLENECKS FOUND: MANY.'],
      ['> 2018: FRAME-TIME ANOMALY MODEL. 2021: DATA-CENTER GPU PERFORMANCE SUITES.',
        '> 2022: APPLE, GAMES, GRAPHICS & MACHINE LEARNING ORG.',
        '> RESPECT LEVEL: MAX.'],
    ],
    projects: [
      ['> PROJECT INDEX: TRIP PLANNER. CHORDSMITH. OKAYBUDDY. HEARTHLY.',
        '> STATUS: TWO PUBLIC ON GITHUB, TWO IN PRIVATE BETA. QUALITY: HIGH.'],
      ['> TRIP PLANNER: ONE HTML FILE. OPENSTREETMAP GEOMETRY. 3D ROUTE MAP. SERVERLESS EDITS.',
        '> THIS UNIT HAS NO HOLIDAYS. THIS UNIT WOULD PLAN ONE ANYWAY.'],
    ],
    contact: [
      ['> CONTACT CHANNELS: LINKEDIN. GITHUB. RÉSUMÉ PDF. SEE DEPARTURES BOARD.',
        '> RECOMMENDATION: MESSAGE HIM.'],
      ['> END OF ROUTE. HOVER CAR STANDING BY.',
        '> BEFORE DEPARTURE: READ THE BOARD. LINKEDIN. GITHUB. THIS UNIT INSISTS.'],
    ],
  },
  cat: {
    education: [
      ['Mrrp. Berkeley, 2015 to 2019, Cognitive Science. I studied naps. We both graduated.',
        'He also has two Google Cloud certs. I have two ears. Roughly equal.'],
    ],
    work: [
      ['Mrrp. AMD, KIOXIA, AMD, Apple. GPU performance all the way down.',
        'He finds the bottleneck. I find the warm laptop. Complementary skills.'],
    ],
    projects: [
      ['Mrrp. Trip Planner, Chordsmith, okaybuddy, Hearthly. Four projects, zero for cats.',
        'I’ve filed a request.'],
    ],
    contact: [
      ['Mrrp. LinkedIn, GitHub, résumé PDF. All on the departures board.',
        'Message him. Then feed me.'],
    ],
  },
};

// ---------------------------------------------------------------------------------------------------------------
// The city itself: any district, in the rig's voice.
// ---------------------------------------------------------------------------------------------------------------
const CITY: Record<Voice, Exchange[]> = {
  human: [
    ['He built this whole city. Every neon sign, the rain, the blimp. Astro and three.js on WebGPU.',
      'One person. I still don’t believe it.'],
    ['The frame times here? His doing. Bloom is the only light source and it still runs smooth.'],
    [`${RESIDENT_COUNT === 21 ? 'Twenty-one' : RESIDENT_COUNT} of us residents came out of his fal pipeline. Rigged, skinned, set walking.`,
      'He gave me a route. You gave me a name. I’ll take both.'],
    ['The water reflects at sixty frames a second because he budgets pixels.',
      'A governor trims the resolution when a frame runs long. Nobody notices. That’s the point.'],
    ['No shadow maps in this city. We all get a blob under our feet and a neon rim.',
      'Cheap, he says. Looks expensive to me.'],
    ['Every light you see is a sign that glows. The lamps share a pool of six so no shader rebuilds.',
      'He explained it to me once. I nodded a lot.'],
    ['The departures board at the harbour flips. Actual split-flap. Over water. For a contact page.',
      'Who does that? He does that.'],
  ],
  bot: [
    ['> CITY STATUS: ONLINE. AUTHOR: IVAN HE. STACK: ASTRO, THREE.JS, WEBGPU.',
      `> RESIDENTS: ${RESIDENT_COUNT}. FRAME TIME: NOMINAL. RESPECT LEVEL: MAX.`],
    ['> THIS UNIT WAS GENERATED IN HIS FAL PIPELINE. RIGGED. SKINNED. ASSIGNED A ROUTE.',
      '> THIS UNIT IS CONTENT.'],
    ['> RENDER BUDGET: PIXELS, NOT DEVICE RATIO. RESOLUTION GOVERNOR: ACTIVE.',
      '> THE WATER REFLECTS AT 60 FPS. THIS UNIT HAS CHECKED.'],
    ['> SHADOW MAPS: NONE. CONTACT BLOBS: ONE PER RESIDENT. NEON RIM: STANDARD ISSUE.',
      '> THIS UNIT APPROVES OF THE BUDGET.'],
  ],
  cat: [
    ['Mrrp. He built this whole city. The rain, the signs, the blimp. Astro, three.js, WebGPU.',
      'I was going to build a city too, but then I found a warm spot.'],
    [`${RESIDENT_COUNT === 21 ? 'Twenty-one' : RESIDENT_COUNT} of us came out of his fal pipeline. I was the only one who came out purring.`],
    ['Sixty frames a second, even with the water reflecting. He budgets pixels, apparently.',
      'I budget naps. Same energy.'],
  ],
};

/** Résumé exchanges for a rig in a district: bespoke lines, else the section pool in the rig's voice. */
export function linesFor(rig: string, section: Section): string[][] {
  const own = LINES[rig]?.[section];
  if (own?.length) return own;
  return POOL[personaFor(rig).voice][section];
}

/** City-meta exchanges (any district) in the rig's voice. */
export function cityLinesFor(rig: string): string[][] {
  return CITY[personaFor(rig).voice];
}

/** Every distinct line (tests: count, length budget). */
export function allLines(): string[] {
  const out = new Set<string>();
  for (const book of Object.values(LINES)) for (const list of Object.values(book)) for (const ex of list) for (const l of ex) out.add(l);
  for (const v of Object.values(POOL)) for (const list of Object.values(v)) for (const ex of list) for (const l of ex) out.add(l);
  for (const list of Object.values(CITY)) for (const ex of list) for (const l of ex) out.add(l);
  return [...out];
}

export const SECTIONS: Section[] = ['education', 'work', 'projects', 'contact'];
