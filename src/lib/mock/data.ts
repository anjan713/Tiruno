// Mock-first content. Grounded loosely in the sample coursework
// (CMPE 277 Android, CMPE 273 Enterprise Distributed Systems) so the demo feels real.

export type NodeType = "lesson" | "article" | "checkpoint" | "review";
export type NodeStatus = "done" | "active" | "locked";

export interface MCQ {
  id: string;
  prompt: string;
  options: string[];
  answer: number;
  explanation: string;
  citation: string;
}

export interface Lesson {
  id: string;
  title: string;
  topic: string;
  concept: string; // short teaching explanation shown (and narrated) before questions
  questions: MCQ[];
  /** Set when the lesson was authored from an ingested article (engagement linkage). */
  articleId?: string;
}

export interface ArticleSegment {
  heading: string;
  text: string;
  checkpoint?: MCQ;
}

export interface Article {
  id: string;
  title: string;
  source: string;
  readingTime: string;
  topic: string;
  segments: ArticleSegment[];
}

export interface SkillNode {
  id: string;
  title: string;
  type: NodeType;
  status: NodeStatus;
  xp: number;
  contentId?: string; // lesson or article id
  /** Set when this node was derived from a bookmarked article (for on-demand lesson gen). */
  articleId?: string;
  /** Topic to ground a generated lesson when contentId isn't pre-generated. */
  topic?: string;
  /** This lesson's position within its section + the section's total, so multi-lesson
   *  sections generate distinct lessons covering different parts of the article. */
  lessonIndex?: number;
  lessonCount?: number;
}

export interface Unit {
  id: string;
  title: string;
  subtitle: string;
  accent: string; // tailwind color token name
  nodes: SkillNode[];
}

export interface Course {
  id: string;
  code: string;
  name: string;
  selected: boolean;
}

export const MOCK_COURSES: Course[] = [
  { id: "cmpe277", code: "CMPE 277", name: "Smartphone Application Development (Android)", selected: true },
  { id: "cmpe273", code: "CMPE 273", name: "Enterprise Distributed Systems", selected: true },
  { id: "cmpe255", code: "CMPE 255", name: "Data Mining", selected: false },
  { id: "cmpe283", code: "CMPE 283", name: "Virtualization Technologies", selected: false },
];

export const PRO_INTERESTS = [
  "System Design",
  "Distributed Systems",
  "Mobile Engineering",
  "AI / LLMs",
  "Web Performance",
  "Security",
  "Databases",
  "DevOps & Cloud",
  "Product",
  "Leadership",
];

export const LESSONS: Record<string, Lesson> = {
  "l-activity": {
    id: "l-activity",
    title: "Android Activity Lifecycle",
    topic: "Android Fundamentals",
    concept:
      "Every Android screen is an Activity that moves through lifecycle callbacks as the user opens, leaves, and returns to it. The key ones in order are onCreate (set up once), onStart (becoming visible), onResume (now interactive), then onPause and onStop as it goes away. Knowing this order tells you exactly where to load data and where to safely release things like the camera.",
    questions: [
      {
        id: "q1",
        prompt: "Which callback runs first when an Activity becomes visible to the user?",
        options: ["onCreate()", "onStart()", "onResume()", "onRestart()"],
        answer: 1,
        explanation:
          "onStart() is invoked when the activity becomes visible. onCreate() runs once for setup; onResume() runs after onStart() when the activity moves to the foreground.",
        citation: "CMPE 277 · Session 2 · Activity Lifecycle",
      },
      {
        id: "q2",
        prompt: "Where should you release camera or sensor resources that must not run in the background?",
        options: ["onDestroy()", "onPause()", "onStop()", "onSaveInstanceState()"],
        answer: 1,
        explanation:
          "onPause() is the safe place to release resources like the camera, because the activity may not reach onStop()/onDestroy() promptly.",
        citation: "CMPE 277 · Session 2 · Lifecycle best practices",
      },
      {
        id: "q3",
        prompt: "What is onSaveInstanceState() primarily used for?",
        options: [
          "Persisting data to a database",
          "Saving transient UI state across config changes",
          "Releasing network sockets",
          "Starting a new Activity",
        ],
        answer: 1,
        explanation:
          "It stores small amounts of transient UI state (e.g., scroll position) in a Bundle so it survives configuration changes like rotation.",
        citation: "CMPE 277 · Session 2 · Saving state",
      },
      {
        id: "q4",
        prompt: "After a device rotation, which sequence is correct for a running Activity?",
        options: [
          "onPause → onStop → onDestroy → onCreate → onStart → onResume",
          "onResume → onCreate → onStart",
          "onStop → onResume",
          "onDestroy only",
        ],
        answer: 0,
        explanation:
          "By default the Activity is destroyed and recreated on rotation, running the full teardown then re-creation sequence.",
        citation: "CMPE 277 · Session 2 · Configuration changes",
      },
      {
        id: "q5",
        prompt: "Which method is NOT guaranteed to be called before an app process is killed?",
        options: ["onPause()", "onStop()", "onDestroy()", "onCreate()"],
        answer: 2,
        explanation:
          "The system can kill the process without calling onDestroy(). Only onPause() is guaranteed; persist critical data earlier.",
        citation: "CMPE 277 · Session 2 · Process death",
      },
    ],
  },
  "l-intents": {
    id: "l-intents",
    title: "Intents & Navigation",
    topic: "Android Fundamentals",
    concept:
      "Intents are messages that start activities and pass data between them. An explicit intent names the exact component to launch; an implicit intent just declares an action (like 'share') and lets the system offer a handler. To get a result back from a screen you launched, modern apps use the Activity Result APIs instead of the old startActivityForResult.",
    questions: [
      {
        id: "q1",
        prompt: "An Intent that names a specific component to start is called…",
        options: ["Implicit Intent", "Explicit Intent", "Pending Intent", "Broadcast Intent"],
        answer: 1,
        explanation:
          "Explicit Intents specify the exact component (class). Implicit Intents declare an action and let the system resolve a handler.",
        citation: "CMPE 277 · Session 3 · Intents",
      },
      {
        id: "q2",
        prompt: "Which is the right tool to pass data back from a launched Activity in modern Android?",
        options: [
          "startActivityForResult()",
          "Activity Result APIs (registerForActivityResult)",
          "A global static variable",
          "SharedPreferences only",
        ],
        answer: 1,
        explanation:
          "registerForActivityResult with a contract is the recommended replacement for the deprecated startActivityForResult().",
        citation: "CMPE 277 · Session 3 · Activity results",
      },
      {
        id: "q3",
        prompt: "What does an intent filter declare?",
        options: [
          "Runtime permissions",
          "Which implicit intents a component can respond to",
          "The app's package name",
          "Thread priority",
        ],
        answer: 1,
        explanation:
          "Intent filters in the manifest declare the actions, categories, and data a component can handle for implicit intents.",
        citation: "CMPE 277 · Session 3 · Intent filters",
      },
      {
        id: "q4",
        prompt: "Best practice for sending large bitmaps between activities is to…",
        options: [
          "Put the bitmap directly in the Intent extras",
          "Pass a URI / identifier and load the data on the other side",
          "Use a static field",
          "Serialize to JSON in the Intent",
        ],
        answer: 1,
        explanation:
          "Intent extras have a small size limit (TransactionTooLargeException). Pass a reference (URI/id) and load lazily.",
        citation: "CMPE 277 · Session 3 · Passing data",
      },
      {
        id: "q5",
        prompt: "A PendingIntent is most commonly used with…",
        options: ["RecyclerView", "Notifications & alarms", "Room database", "Gradle build"],
        answer: 1,
        explanation:
          "PendingIntent grants another app/system service the right to perform an action later — e.g., notifications and AlarmManager.",
        citation: "CMPE 277 · Session 3 · PendingIntent",
      },
    ],
  },
  "l-security": {
    id: "l-security",
    title: "Securing Distributed Services",
    topic: "Distributed Systems",
    concept:
      "Securing distributed services means protecting data in transit and proving who is calling. TLS encrypts traffic and authenticates the server (mTLS authenticates both sides); signed tokens like JWT carry a user's identity statelessly across services; and least-privilege access plus a secrets manager limit the blast radius if any one component is compromised.",
    questions: [
      {
        id: "q1",
        prompt: "What does TLS primarily provide between two services?",
        options: [
          "Load balancing",
          "Encryption + integrity + server authentication",
          "Service discovery",
          "Caching",
        ],
        answer: 1,
        explanation:
          "TLS encrypts data in transit, protects integrity, and authenticates the server (and optionally the client via mTLS).",
        citation: "CMPE 273 · Security Session · Transport security",
      },
      {
        id: "q2",
        prompt: "A stateless way to carry user identity across microservices is…",
        options: ["A signed JWT", "A server-side session file", "A cookie jar on the gateway", "An IP allowlist"],
        answer: 0,
        explanation:
          "A signed JWT carries claims that any service can verify with the public key, avoiding shared session state.",
        citation: "CMPE 273 · Security Session · Tokens",
      },
      {
        id: "q3",
        prompt: "mTLS differs from regular TLS because…",
        options: [
          "It is unencrypted",
          "Both client and server present certificates",
          "It only works over HTTP/1.1",
          "It replaces OAuth",
        ],
        answer: 1,
        explanation:
          "Mutual TLS authenticates both parties with certificates — common for service-to-service trust inside a mesh.",
        citation: "CMPE 273 · Security Session · mTLS",
      },
      {
        id: "q4",
        prompt: "The principle of least privilege means…",
        options: [
          "Give every service admin rights for simplicity",
          "Grant only the permissions a component needs",
          "Disable all authentication",
          "Use one API key everywhere",
        ],
        answer: 1,
        explanation:
          "Each component should hold the minimum permissions required, limiting blast radius if compromised.",
        citation: "CMPE 273 · Security Session · Authorization",
      },
      {
        id: "q5",
        prompt: "Where should secrets (DB passwords, API keys) live in a distributed system?",
        options: [
          "Hardcoded in source",
          "In a secrets manager / injected env, never in the repo",
          "In client-side JavaScript",
          "In the JWT payload",
        ],
        answer: 1,
        explanation:
          "Secrets belong in a managed secret store and are injected at runtime — never committed to source or exposed to clients.",
        citation: "CMPE 273 · Security Session · Secret management",
      },
    ],
  },
};

export const ARTICLES: Record<string, Article> = {
  "a-llm-rag": {
    id: "a-llm-rag",
    title: "Why Retrieval-Augmented Generation Beats Bigger Prompts",
    source: "Engineering Digest · 6 min",
    readingTime: "6 min",
    topic: "AI / LLMs",
    segments: [
      {
        heading: "The grounding problem",
        text: "Large language models hallucinate when asked about facts outside their training data. Retrieval-Augmented Generation (RAG) fixes this by fetching relevant documents at query time and feeding them to the model as context, so answers are grounded in real sources.",
        checkpoint: {
          id: "c1",
          prompt: "What core problem does RAG address?",
          options: ["Slow networks", "Model hallucination / stale knowledge", "GPU cost", "UI rendering"],
          answer: 1,
          explanation: "RAG grounds answers in retrieved documents, reducing hallucination and stale knowledge.",
          citation: "Engineering Digest · RAG primer",
        },
      },
      {
        heading: "Vectors over keywords",
        text: "Instead of keyword matching, RAG embeds text into vectors and retrieves by semantic similarity. A vector index (like Redis HNSW) returns the nearest chunks, which capture meaning even when wording differs.",
        checkpoint: {
          id: "c2",
          prompt: "Why use vector similarity instead of keyword search for retrieval?",
          options: [
            "It is always cheaper",
            "It captures semantic meaning, not just exact words",
            "It avoids needing a database",
            "It removes the need for the LLM",
          ],
          answer: 1,
          explanation: "Embeddings capture meaning, so semantically related text is retrieved even with different wording.",
          citation: "Engineering Digest · Embeddings",
        },
      },
      {
        heading: "Keep context tight",
        text: "Bigger prompts are not better: irrelevant context dilutes attention and raises cost. Retrieve the few most relevant chunks, cite them, and let the model synthesize a focused answer.",
      },
    ],
  },
  "a-redis-vectors": {
    id: "a-redis-vectors",
    title: "Vector Search in Redis with HNSW",
    source: "Backend Weekly · 5 min",
    readingTime: "5 min",
    topic: "Databases",
    segments: [
      {
        heading: "Why Redis for vectors",
        text: "Redis is no longer just a cache. With RediSearch you can store embeddings and run approximate nearest-neighbor search using the HNSW algorithm — all in memory, with millisecond latency, right next to your other application data.",
        checkpoint: {
          id: "c1",
          prompt: "What algorithm powers Redis approximate nearest-neighbor search?",
          options: ["B-Tree", "HNSW", "QuickSort", "PageRank"],
          answer: 1,
          explanation: "HNSW (Hierarchical Navigable Small World) graphs give fast, high-recall ANN search.",
          citation: "Backend Weekly · Redis vectors",
        },
      },
      {
        heading: "Hybrid queries",
        text: "Production search rarely uses vectors alone. Redis lets you pre-filter by metadata (tags, numeric ranges) and then rank the survivors by vector similarity — the standard pattern for RAG and semantic search.",
      },
    ],
  },
  "a-system-design": {
    id: "a-system-design",
    title: "Idempotency Keys: Making Retries Safe",
    source: "Distributed Digest · 7 min",
    readingTime: "7 min",
    topic: "System Design",
    segments: [
      {
        heading: "The double-charge problem",
        text: "Networks fail mid-request, so clients retry. Without protection, a retried 'create payment' call can charge a customer twice. Idempotency keys let the server recognize a repeat and return the original result instead of acting again.",
        checkpoint: {
          id: "c1",
          prompt: "What problem do idempotency keys primarily solve?",
          options: [
            "Slow database queries",
            "Duplicate side-effects from retried requests",
            "Password storage",
            "CSS layout bugs",
          ],
          answer: 1,
          explanation: "They make a retried request safe by de-duplicating the side-effect on the server.",
          citation: "Distributed Digest · Idempotency",
        },
      },
      {
        heading: "Implementation sketch",
        text: "The client sends a unique key per logical operation. The server stores key -> result for a window; if the key reappears, it returns the stored result. Pair this with retries and you get at-least-once delivery that behaves like exactly-once.",
      },
    ],
  },
};

export interface CourseTrack {
  courseId: string;
  code: string;
  name: string;
  accent: string;
  units: Unit[];
}

export const COURSE_TRACKS: CourseTrack[] = [
  {
    courseId: "cmpe277",
    code: "CMPE 277",
    name: "Smartphone Application Development",
    accent: "primary",
    units: [
      {
        id: "and-1",
        title: "Unit 1 · Android Foundations",
        subtitle: "Lifecycle, intents, and UI",
        accent: "primary",
        nodes: [
          { id: "a1", title: "Activity Lifecycle", type: "lesson", status: "done", xp: 20, contentId: "l-activity" },
          { id: "a2", title: "Intents & Navigation", type: "lesson", status: "active", xp: 20, contentId: "l-intents" },
          { id: "a3", title: "Layouts & Compose Basics", type: "lesson", status: "locked", xp: 20 },
          { id: "a4", title: "Foundations Checkpoint", type: "checkpoint", status: "locked", xp: 40 },
        ],
      },
      {
        id: "and-2",
        title: "Unit 2 · Data & Networking",
        subtitle: "Lists, storage, and APIs",
        accent: "primary",
        nodes: [
          { id: "a5", title: "RecyclerView & Lists", type: "lesson", status: "locked", xp: 25 },
          { id: "a6", title: "Room Persistence", type: "lesson", status: "locked", xp: 25 },
          { id: "a7", title: "Retrofit & REST APIs", type: "lesson", status: "locked", xp: 25 },
          { id: "a8", title: "Coroutines & Async", type: "lesson", status: "locked", xp: 30 },
        ],
      },
    ],
  },
  {
    courseId: "cmpe273",
    code: "CMPE 273",
    name: "Enterprise Distributed Systems",
    accent: "secondary",
    units: [
      {
        id: "dist-1",
        title: "Unit 1 · Service Communication",
        subtitle: "APIs, security, reliability",
        accent: "secondary",
        nodes: [
          { id: "d1", title: "REST vs gRPC", type: "lesson", status: "locked", xp: 25 },
          { id: "d2", title: "Securing Services", type: "lesson", status: "locked", xp: 25, contentId: "l-security" },
          { id: "d3", title: "Idempotency & Retries", type: "article", status: "locked", xp: 15, contentId: "a-system-design" },
        ],
      },
      {
        id: "dist-2",
        title: "Unit 2 · Scale & Storage",
        subtitle: "Consistency, caching, balancing",
        accent: "secondary",
        nodes: [
          { id: "d4", title: "Consistency Models", type: "lesson", status: "locked", xp: 30 },
          { id: "d5", title: "Caching with Redis", type: "article", status: "locked", xp: 15, contentId: "a-redis-vectors" },
          { id: "d6", title: "Load Balancing", type: "lesson", status: "locked", xp: 30 },
        ],
      },
    ],
  },
  {
    courseId: "cmpe255",
    code: "CMPE 255",
    name: "Data Mining",
    accent: "success",
    units: [
      {
        id: "dm-1",
        title: "Unit 1 · Foundations",
        subtitle: "From data to insight",
        accent: "success",
        nodes: [
          { id: "m1", title: "Clustering Basics", type: "lesson", status: "locked", xp: 25 },
          { id: "m2", title: "Classification", type: "lesson", status: "locked", xp: 25 },
          { id: "m3", title: "RAG, explained", type: "article", status: "locked", xp: 15, contentId: "a-llm-rag" },
        ],
      },
    ],
  },
  {
    courseId: "cmpe283",
    code: "CMPE 283",
    name: "Virtualization Technologies",
    accent: "amber",
    units: [
      {
        id: "virt-1",
        title: "Unit 1 · Virtualization Core",
        subtitle: "Hypervisors & containers",
        accent: "amber",
        nodes: [
          { id: "v1", title: "Hypervisors 101", type: "lesson", status: "locked", xp: 25 },
          { id: "v2", title: "Containers vs VMs", type: "lesson", status: "locked", xp: 25 },
          { id: "v3", title: "Caching with Redis", type: "article", status: "locked", xp: 15, contentId: "a-redis-vectors" },
        ],
      },
    ],
  },
];

const INTEREST_POOL: Array<{ title: string; type: NodeType; contentId?: string; xp: number }> = [
  { title: "Retrieval-Augmented Generation", type: "article", contentId: "a-llm-rag", xp: 15 },
  { title: "Vector Search in Redis", type: "article", contentId: "a-redis-vectors", xp: 15 },
  { title: "Idempotency & Retries", type: "article", contentId: "a-system-design", xp: 15 },
  { title: "Securing Distributed Services", type: "lesson", contentId: "l-security", xp: 25 },
];

function buildInterestTracks(interests: string[]): CourseTrack[] {
  const list = interests.length ? interests.slice(0, 4) : ["Your Topics"];
  return list.map((interest, i) => ({
    courseId: `int-${i}`,
    code: "TOPIC",
    name: interest,
    accent: "primary",
    units: [
      {
        id: `int-${i}-u1`,
        title: `${interest} · Path`,
        subtitle: "Curated from trending sources",
        accent: "primary",
        nodes: INTEREST_POOL.map((p, j) => ({
          id: `p${i}-${j}`,
          title: p.title,
          type: p.type,
          status: "locked" as NodeStatus,
          xp: p.xp,
          contentId: p.contentId,
        })),
      },
    ],
  }));
}

export function getLearnTracks(
  persona: string | null,
  selectedCourses: string[],
  selectedInterests: string[]
): CourseTrack[] {
  if (persona === "professional") return buildInterestTracks(selectedInterests);
  const sel = COURSE_TRACKS.filter((t) => selectedCourses.includes(t.courseId));
  return sel.length ? sel : COURSE_TRACKS.slice(0, 2);
}

// Flattened default (kept for any legacy consumers)
export const MOCK_UNITS: Unit[] = COURSE_TRACKS.slice(0, 2).flatMap((t) => t.units);

export const REVIEW_QUEUE: MCQ[] = [
  LESSONS["l-activity"].questions[4],
  LESSONS["l-intents"].questions[3],
  LESSONS["l-security"].questions[1],
];

export interface TopicScore {
  topic: string;
  mastery: number; // 0-100 — how well the topic is known
  currency: number; // 0-100 — how current that knowledge is (decays while idle)
  /** Local date key (YYYY-M-D) of the last in-app activity for this topic; drives decay. */
  lastActive?: string;
}

export const TOPIC_SCORES: TopicScore[] = [
  { topic: "Android Fundamentals", mastery: 72, currency: 64 },
  { topic: "Distributed Systems", mastery: 38, currency: 80 },
  { topic: "AI / LLMs", mastery: 21, currency: 95 },
];

// `skillScore` now lives in src/lib/learn/skill.ts so the model (with currency decay and
// topic-progress updates) is a single, testable abstraction shared by the store and UI.

export interface FeedItem {
  id: string; // -> ARTICLES key
  title: string;
  source: string;
  topic: string;
  readingTime: string;
  freshness: string;
  reason: string;
}

export const FEED: FeedItem[] = [
  {
    id: "a-llm-rag",
    title: ARTICLES["a-llm-rag"].title,
    source: ARTICLES["a-llm-rag"].source,
    topic: "AI / LLMs",
    readingTime: "6 min",
    freshness: "Today",
    reason: "Matches your interest in AI / LLMs",
  },
  {
    id: "a-redis-vectors",
    title: ARTICLES["a-redis-vectors"].title,
    source: ARTICLES["a-redis-vectors"].source,
    topic: "Databases",
    readingTime: "5 min",
    freshness: "2 days ago",
    reason: "Builds on your Distributed Systems path",
  },
  {
    id: "a-system-design",
    title: ARTICLES["a-system-design"].title,
    source: ARTICLES["a-system-design"].source,
    topic: "System Design",
    readingTime: "7 min",
    freshness: "This week",
    reason: "Fills a gap in your weak areas",
  },
];
