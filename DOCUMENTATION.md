# Travion — Full Technical Documentation

> **Version:** 1.0.0  
> **Stack:** NestJS · React 19 · Google Gemini · BullMQ · Supabase · Redis  
> **Audience:** Developers, technical reviewers, contributors

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [System Architecture](#2-system-architecture)
3. [Backend — NestJS](#3-backend--nestjs)
   - 3.1 [Module Map](#31-module-map)
   - 3.2 [Itinerary Module](#32-itinerary-module)
   - 3.3 [Queue Module (BullMQ)](#33-queue-module-bullmq)
   - 3.4 [Agent Module](#34-agent-module)
   - 3.5 [Team Module](#35-team-module)
   - 3.6 [Auth Module](#36-auth-module)
   - 3.7 [Billing Module](#37-billing-module)
   - 3.8 [WebSocket Module](#38-websocket-module)
4. [Frontend — React / Vite](#4-frontend--react--vite)
   - 4.1 [Page Structure](#41-page-structure)
   - 4.2 [State Management](#42-state-management)
   - 4.3 [Key Components](#43-key-components)
5. [All APIs Used](#5-all-apis-used)
6. [All Tools & Libraries](#6-all-tools--libraries)
7. [Database Design (Supabase)](#7-database-design-supabase)
8. [Caching Strategy](#8-caching-strategy)
9. [Background Job System](#9-background-job-system)
10. [AI & NLP Approach](#10-ai--nlp-approach)
11. [Trip Planning Pipeline](#11-trip-planning-pipeline)
12. [Real-Time Adaptation Engine](#12-real-time-adaptation-engine)
13. [Team Collaboration System](#13-team-collaboration-system)
14. [Trip Tracking & ETA System](#14-trip-tracking--eta-system)
15. [Security Model](#15-security-model)
16. [Full API Reference](#16-full-api-reference)
17. [Environment Configuration](#17-environment-configuration)
18. [Data Flow Diagrams](#18-data-flow-diagrams)

---

## 1. Project Overview

Travion is a full-stack AI-powered travel itinerary platform. Unlike static itinerary generators, Travion generates a **living trip plan** that continuously reacts to real-world changes:

- Live weather alerts trigger automatic activity rescheduling
- Flight delays proactively reroute the day's plan
- Instagram crowd scoring surfaces hidden gems and avoids overcrowded spots
- Team members can join a trip, vote on activities, and raise issues in real time
- The traveler checks in and out of each activity; the system tracks live ETA risk

### Core Design Principles

| Principle | Implementation |
|---|---|
| **Async-first** | All planning is queued through BullMQ; HTTP returns immediately with a jobId |
| **Agent-driven** | Background loops continuously monitor weather, crowds, flights, and POIs |
| **Consent-based replanning** | System proposes changes; user explicitly accepts or dismisses |
| **Cache-heavy** | Three-tier caching (memory → Supabase → API) prevents rate-limit abuse |
| **AI rotation** | 4 Gemini keys + 5 SerpAPI keys rotated to maximise throughput |

---

## 2. System Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                       Browser (React 19 / Vite 7)                        │
│  Dashboard · Planning · Trips · Settings · Subscription · Updates        │
│  Socket.IO client ──────────────────────────────────────────────────┐    │
└────────────────────────────────────────┬────────────────────────────│────┘
                                         │ HTTPS REST (port 3000)     │
┌────────────────────────────────────────▼────────────────────────────▼────┐
│                         NestJS Application Server                         │
│                                                                           │
│  ┌──────────────────────────────────────────────────────────────────┐    │
│  │  ItineraryModule                  TeamModule                     │    │
│  │  ├─ ItineraryService (Gemini)     ├─ InviteService               │    │
│  │  ├─ WeatherService (OWM)          ├─ FeedbackService             │    │
│  │  ├─ FlightService (Amadeus)       ├─ SuggestionService (Gemini)  │    │
│  │  ├─ SerpService (SerpAPI)         └─ ConsensusService            │    │
│  │  ├─ InstagramService (Apify)                                     │    │
│  │  ├─ ChatbotService (Jina+OR)      AgentModule                    │    │
│  │  ├─ GeoService (Google Maps)      ├─ ImpactEngineService         │    │
│  │  ├─ AviationStackService          ├─ AgentToolsService           │    │
│  │  ├─ TripTrackerService            ├─ TripTrackerService          │    │
│  │  ├─ EtaMonitorService             ├─ EtaMonitorService           │    │
│  │  └─ OpenRouterService             └─ ConsensusService            │    │
│  └──────────────────────────────────────────────────────────────────┘    │
│                                                                           │
│  ┌─────────────────────────── QueueModule ──────────────────────────┐    │
│  │  BullMQ Workers (Redis-backed)                                   │    │
│  │  ├─ TripPlanningProcessor      ├─ PoiMonitorProcessor            │    │
│  │  ├─ WeatherMonitorProcessor    ├─ FlightDelayMonitorProcessor    │    │
│  │  ├─ CrowdMonitorProcessor      ├─ TransportDelayMonitorProcessor │    │
│  │  ├─ ReplanProcessor            └─ AgentLoopProcessor             │    │
│  └──────────────────────────────────────────────────────────────────┘    │
│                                                                           │
│  ┌─ WebSocketModule ──┐  ┌─ AuthModule ──┐  ┌─ BillingModule ───┐       │
│  │  AgentGateway      │  │  JWT + Supa.  │  │  DodoPayments     │       │
│  │  NotificationSvc   │  └───────────────┘  └───────────────────┘       │
│  └────────────────────┘                                                   │
└─────────────────────────────────┬─────────────────────────────────────────┘
                                  │
         ┌────────────────────────┼────────────────────┐
         ▼                        ▼                    ▼
   ┌──────────┐           ┌──────────────┐     ┌──────────────────┐
   │  Redis   │           │  Supabase    │     │  External APIs   │
   │  BullMQ  │           │  PostgreSQL  │     │  (see §5)        │
   └──────────┘           │  + RLS       │     └──────────────────┘
                          └──────────────┘
```

---

## 3. Backend — NestJS

**Runtime:** Node.js 20 LTS  
**Framework:** NestJS 11  
**Language:** TypeScript 5.9 (strict mode)  
**Entry point:** `travion_backend/src/main.ts` — starts HTTP server on `PORT` (default 3000), enables CORS, registers global validation pipe

### 3.1 Module Map

```
AppModule
├── ConfigModule           (global env vars)
├── ItineraryModule        (core AI planning + all data services)
├── QueueModule            (BullMQ workers + job coordination)
├── AgentModule            (intelligence layer)
├── TeamModule             (collaboration)
├── AuthModule             (JWT verification)
├── BillingModule          (Dodo Payments subscriptions)
├── WebsocketModule        (Socket.IO real-time gateway)
└── ServeStaticModule      (serves React build in production)
```

---

### 3.2 Itinerary Module

**Path:** `src/itinerary/`  
**Controller:** `ItineraryController` @ `api/itinerary`  
**Guard:** `UsageLimitGuard` — enforces per-user rate limits stored in Supabase

#### Services

| Service | File | Responsibility |
|---|---|---|
| `ItineraryService` | `itinerary.service.ts` | Master orchestrator — calls all data services, runs Gemini pipeline, stitches final itinerary |
| `WeatherService` | `weather.service.ts` | OpenWeatherMap current + 5-day forecast; rain/heat/wind alerts mapped to activity risk |
| `FlightService` | `flight.service.ts` | Amadeus flight search — cheapest fares from source airport to destination |
| `AviationStackService` | `aviation-stack.service.ts` | Real-time flight status (delays, cancellations) keyed by flight number |
| `SerpService` | `serp.service.ts` | SerpAPI Google Search — hotels (maps/hotels endpoint), restaurants, tourist attractions with ratings and price levels |
| `GeoService` | `geo.service.ts` | Google Maps Places — geocoding, Distance Matrix, Directions, travel-time calculation |
| `TransportService` | `transport.service.ts` | Intra-city transport options (cab, auto, bus, metro); calculates realistic transfer times between activities |
| `AirportService` | `airport.service.ts` | IATA airport lookup from bundled `airports.json` (47k airports offline) |
| `InstagramService` | `instagram.service.ts` | Apify Instagram hashtag scraper → crowd scoring algorithm (post volume × recency × engagement) |
| `YoutubeDiscoveryService` | `youtube-discovery.service.ts` | Best YouTube travel video per POI via SerpAPI video search |
| `ChatbotService` | `chatbot.service.ts` | Jina Reader scrapes official tourism page → Mistral-7B (OpenRouter) answers user Q&A |
| `OpenRouterService` | `openrouter.service.ts` | Wrapper for OpenRouter REST API; exposes `call()` and `ping()` |
| `ImageService` | `image.service.ts` | Fetches place images (SerpAPI + Maps) for activity cards |
| `TourismAdvisoryService` | `tourism-advisory.service.ts` | Fetches travel advisories and local safety tips for destination |
| `TourismPoiService` | `tourism-poi.service.ts` | Enriches activities with official POI data (timings, entry fees, facilities) |
| `EasemytripService` | `easemytrip.service.ts` | Scraper wrapper for domestic Indian train/bus options (fallback transport) |
| `UserFlagService` | `user-flag.service.ts` | NLP-parses free-text user issue reports via Gemini; extracts affected activity, severity, recommended action |
| `ImpactEngineService` | `impact-engine.service.ts` | Calculates trip-level risk score from combined weather + crowd + flight signals |
| `AgentToolsService` | `agent-tools.service.ts` | Toolset called by AgentLoopProcessor — verify activity availability, check current crowd, compute ETA |
| `TripTrackerService` | `trip-tracker.service.ts` | Persists check-in / check-out / skip events to `trip_checkins`; computes live schedule drift |
| `EtaMonitorService` | `eta-monitor.service.ts` | After each check-in, computes travel time to next activity via Google Maps; flags `at_risk` / `late` |

#### Gemini Key Rotation

```typescript
// itinerary.service.ts — simplified
const keys = [
  process.env.GEMINI_API_KEY,
  process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY_3,
  process.env.GEMINI_API_KEY_4,
].filter(Boolean);

let keyIndex = 0;

function getGemini(): GoogleGenerativeAI {
  const key = keys[keyIndex % keys.length];
  keyIndex++;
  return new GoogleGenerativeAI(key);
}
```

Up to 4 keys rotate round-robin. On a `429 Resource Exhausted` response the service immediately retries with the next key.

#### SerpAPI Key Rotation

Same pattern with up to 5 SerpAPI keys. Each has an independent monthly quota; rotation prevents a single key exhausting its quota during a heavy planning session.

---

### 3.3 Queue Module (BullMQ)

**Path:** `src/queue/`  
**Backed by:** Redis (ioredis client)  
**Default job options:** 3 attempts, exponential back-off starting at 5 s, keep last 100 completed jobs for polling

#### Queues & Processors

| Queue Name | Processor | Purpose |
|---|---|---|
| `trip-planning` | `TripPlanningProcessor` | Full trip generation pipeline; emits WebSocket progress events at each stage |
| `weather-monitor` | `WeatherMonitorProcessor` | Repeating job (every 30 min); checks weather for active trips; creates `trip_updates` on alert |
| `crowd-monitor` | `CrowdMonitorProcessor` | Repeating job (every 2 h); re-scrapes Instagram crowd data; flags high-crowd days |
| `replan` | `ReplanProcessor` | Triggered by monitors; runs Gemini replan for affected days; stores proposal for user consent |
| `flight-delay-monitor` | `FlightDelayMonitorProcessor` | Polls AviationStack for flight status; queues replan if departure delay > 45 min |
| `transport-delay-monitor` | `TransportDelayMonitorProcessor` | Monitors known transfer legs; alerts on major road/rail delays |
| `poi-monitor` | `PoiMonitorProcessor` | Checks if a planned POI is temporarily closed via SerpAPI; surfaces alternative |
| `agent-loop` | `AgentLoopProcessor` | Autonomous decision loop — runs ImpactEngine, calls AgentTools, decides whether to replan |
| `notifications` | *(inline)* | Fan-out WebSocket events to connected trip members |

#### `QueueService` — Key Methods

```typescript
submitTripPlanningJob(userId, dto)        // → jobId string
getTripJobStatus(jobId)                   // → { status, result?, progress? }
getUserTrips(userId)                      // → paginated trip list from Supabase
startMonitoring(job: TripMonitoringJob)   // → launches weather + crowd repeating jobs
stopMonitoring(tripId)                    // → removes all repeating jobs for a trip
queueReplan(job: ReplanJob)              // → adds to replan queue
queueAgentLoop(job: AgentLoopJob)        // → adds to agent-loop queue
getProposalsForTrip(tripId)              // → pending proposals
acceptProposal(proposalId)               // → triggers actual replan
rejectProposal(proposalId)               // → marks dismissed
getTripUpdates(tripId)                   // → Supabase trip_updates rows
saveTripUpdate(input: TripUpdateInput)   // → upsert to trip_updates
applyTripUpdate(updateId, userId)        // → triggers replan from stored context
dismissTripUpdate(updateId)             // → status = 'dismissed'
getTripVersions(tripId)                 // → all version snapshots
updateTripDays(tripId, days)            // → patches trips table + saves version
```

---

### 3.4 Agent Module

**Path:** `src/agent/`  
**Controller:** `AgentController` @ `api/agent`

The agent module exposes the 7 intelligence services for direct HTTP testing and for the `AgentLoopProcessor`.

#### Agent Intelligence Services

| Service | What it does |
|---|---|
| `ImpactEngineService` | Aggregates weather severity, crowd score, and flight delay into a single `riskScore (0–100)` + `riskLevel` (LOW/MEDIUM/HIGH/CRITICAL) for the trip as a whole |
| `AgentToolsService` | Runtime tool-calls the agent uses: `checkActivityAvailability`, `getCurrentCrowdLevel`, `calculateTravelTime`, `getWeatherImpact`, `findAlternativeActivity` |
| `TripTrackerService` | Manages check-in/out/skip state in Supabase; computes how far the actual schedule has drifted from the planned one |
| `EtaMonitorService` | After each check-in, calls Google Maps Distance Matrix for live travel time to the next activity; classifies as `on_time` / `at_risk` / `late` |
| `ConsensusService` | Aggregates team votes (looks_good, not_ideal, too_rushed, too_expensive, too_crowded, need_rest) per activity; computes agree/disagree ratio |

#### `AgentLoopProcessor` — Autonomous Decision Flow

```
1. Receive AgentLoopJob (tripId, destination, currentDays, context)
2. Call ImpactEngineService.assessTrip()
   ├── if riskScore < 30  → log "OK", no action
   ├── if riskScore 30–69 → surface trip_update (pending)
   └── if riskScore ≥ 70  → immediately queue replan job
3. For each HIGH-risk activity:
   a. AgentToolsService.checkActivityAvailability()
   b. AgentToolsService.getCurrentCrowdLevel()
   c. If unavailable/overcrowded → AgentToolsService.findAlternativeActivity()
4. Save assessment to trip_updates (Supabase)
5. Emit WebSocket event to connected clients
```

---

### 3.5 Team Module

**Path:** `src/team/`  
**Controller:** `TeamController` @ `api/team`

#### Services

| Service | File | Responsibility |
|---|---|---|
| `InviteService` | `invite.service.ts` | Generates 32-hex-char link tokens + 6-char alphanumeric team codes; enforces `max_travelers` cap; `joinTrip` validates token/code and registers member |
| `FeedbackService` | `feedback.service.ts` | Upserts activity reactions (6 types) per user per activity; returns aggregated counts |
| `SuggestionService` | `suggestion.service.ts` | Accepts free-text member suggestions; parses them via Gemini NLP (extracts activity, issue, recommended change); owner applies/ignores |
| `ConsensusService` | `consensus.service.ts` | Receives agree/disagree/neutral votes; maps to DB feedback_type; calculates consensus score per activity |

#### Invite Flow

```
Owner: POST /api/team/invite/generate
  └─ InviteService.ensureOwner()      → upsert to trip_members (role=owner)
  └─ InviteService.generateInvite()   → insert to trip_invites (token + code)
  └─ Returns { token, code, link, expiresAt }

Member: POST /api/team/invite/join
  └─ Validates token or 6-char code against trip_invites
  └─ Checks expiry + member count < max_travelers
  └─ Inserts new row in trip_members (role=member, status=joined)
  └─ Returns { tripJobId, role }
```

---

### 3.6 Auth Module

**Path:** `src/auth/`  
**Middleware:** `AuthMiddleware` applied to all `/itinerary` routes

- Reads `Authorization: Bearer <token>` header
- Verifies JWT against Supabase's public key endpoint
- Attaches `req.user = { userId, email }` for downstream use
- Non-authenticated requests from the frontend (anon mode) are tolerated on most endpoints; only `UsageLimitGuard`-decorated endpoints enforce authentication

#### Usage Limit Guard

`UsageLimitGuard` + `@UsageLimit('trips' | 'ai_requests')` decorator:

- Queries `user_usage` table in Supabase for current period count
- Free tier: 3 full trip generations / 50 AI requests per month
- Pro tier: unlimited
- Returns `HTTP 429` with `{ error, used, limit, plan }` when exceeded

---

### 3.7 Billing Module

**Path:** `src/billing/`  
**Controller:** `BillingController` @ `api/billing`  
**Service:** `SubscriptionService`

- Creates Dodo Payments checkout sessions for Pro Monthly / Pro Annual products
- Handles incoming Dodo webhooks (payment verified via HMAC `whsec_*` signature)
- On successful payment: upserts `user_subscriptions` row in Supabase with `plan=pro`, `period_end`
- On payment failure / cancellation: downgrades back to `free`

---

### 3.8 WebSocket Module

**Path:** `src/websocket/`  
**Gateway:** `AgentGateway` (Socket.IO namespace `/`)

#### Events emitted to client

| Event | Payload | When |
|---|---|---|
| `trip:progress` | `{ jobId, stage, percent, message }` | Each stage of BullMQ trip planning |
| `trip:complete` | `{ jobId, itinerary }` | Planning finished |
| `trip:error` | `{ jobId, error }` | Planning failed |
| `trip:update` | `{ tripId, updateType, summary }` | Weather/crowd/flight alert detected |
| `trip:proposal` | `{ proposalId, summary, affectedDays }` | Replan proposal ready for consent |
| `eta:alert` | `{ tripJobId, riskLevel, delayMins, nextActivity }` | ETA risk after check-in |

**Connection:** Client connects with `{ auth: { token } }` — gateway verifies against Supabase.

---

## 4. Frontend — React / Vite

**Path:** `travion_web/src/`  
**Build tool:** Vite 7  
**Language:** TypeScript 5.9  
**Styling:** Tailwind CSS 4  

### 4.1 Page Structure

| Route | File | Purpose |
|---|---|---|
| `/` | `Dashboard.tsx` | Overview: recent trips, usage stats, weather snapshot |
| `/planning` | `Planning.tsx` | Multi-step itinerary planner — destination, dates, budget, preferences |
| `/trips` | `Trips.tsx` | All saved trips; live trip view with day-by-day activities, check-in/out, Team tab, Updates tab |
| `/updates` | `Updates.tsx` | Pending system alerts and replan proposals; accept/dismiss UI |
| `/settings` | `Settings.tsx` | User profile, preferences, notification toggles |
| `/subscription` | `Subscription.tsx` | Plan comparison, Dodo checkout redirect, current plan status |

### 4.2 State Management

**Zustand** stores — lightweight, no boilerplate:

| Store | File | State |
|---|---|---|
| `authStore` | `store/authStore.ts` | `user`, `session`, `plan`, `signIn()`, `signOut()` |
| `planningStore` | `store/planningStore.ts` | Form state for the multi-step planner; `jobId`, `status`, `itinerary` result |
| `tripStore` | `store/tripStore.ts` | Active trip being viewed; `selectedDayIndex`, `trackingStatus`, `pendingUpdates` |

**Supabase JS client** (`src/lib/supabase.ts`) handles auth session persistence (localStorage) and real-time subscriptions.

### 4.3 Key Components

| Component | Path | Function |
|---|---|---|
| `PlanningSessionPanel` | `components/planning/PlanningSessionPanel.tsx` | Live streaming progress display during BullMQ job execution; connects to Socket.IO `trip:progress` events |
| `LiveDestinationFeed` | `components/planning/LiveDestinationFeed.tsx` | Fetches `GET /api/itinerary/social-feed/:destination` and renders Instagram crowd score + top posts |
| `PoiVideoPreview` | `components/planning/PoiVideoPreview.tsx` | YouTube embed cards fetched from `GET /api/itinerary/poi-videos/:destination` |
| `InvitePanel` | `components/team/InvitePanel.tsx` | Owner generates invite code; displays 6-char team code + shareable link; member join form |
| `ActivityFeedback` | `components/team/ActivityFeedback.tsx` | Six emoji reaction buttons per activity; submits to `POST /api/team/feedback` |
| `SuggestionBox` | `components/team/SuggestionBox.tsx` | Free-text input for member suggestions; shows parsed result after submission |
| `OwnerAlertBanner` | `components/team/OwnerAlertBanner.tsx` | Displays pending replan proposals or system alerts for the trip owner |
| `AuthModal` | `components/auth/AuthModal.tsx` | Supabase email+password + magic-link auth UI |
| `Sidebar` | `components/layout/Sidebar.tsx` | Navigation; shows active trip name + tracking indicator |
| `TopBar` | `components/layout/TopBar.tsx` | User avatar, plan badge, notification bell linked to real-time updates |

---

## 5. All APIs Used

| API | Provider | Purpose | Free Tier |
|---|---|---|---|
| **Gemini 1.5 Flash / Pro** | Google DeepMind | Itinerary generation, day replanning, NLP parsing of user issues, suggestion analysis | 15 RPM / 1 M tokens/day per key |
| **Google Maps Platform** | Google Cloud | Geocoding, Place Details, Distance Matrix, Directions, autocomplete | $200 credit/month |
| **SerpAPI** | SerpAPI.com | Hotel search, restaurant discovery, tourist attractions, POI images, YouTube video search | 100 searches/month |
| **OpenWeatherMap** | OpenWeather | Current weather, 5-day forecast (3-hour steps) | 1,000 calls/day |
| **Amadeus for Developers** | Amadeus | Flight search (cheapest offers), airport lookup | Free test sandbox |
| **AviationStack** | apilayer.com | Real-time flight status, departure/arrival times, delay in minutes | 100 calls/month |
| **OpenRouter** | OpenRouter.ai | Routes requests to `mistralai/mistral-7b-instruct` for chatbot Q&A and NLP | Pay-per-token (~$0.06/M) |
| **Jina Reader** | Jina AI (`r.jina.ai`) | Converts any URL into clean markdown for LLM ingestion; used for tourism pages | Free |
| **Apify** | Apify.com | Instagram hashtag scraper actor (`reGe1ST3OBgYZSsZJ`) for social crowd data | $5 free credits |
| **Dodo Payments** | dodopayments.com | Subscription billing — checkout sessions, webhook verification, pro plan management | Test mode free |
| **Supabase** | Supabase.com | PostgreSQL database, auth (JWT), Row Level Security, real-time subscriptions | Free tier (500 MB) |

---

## 6. All Tools & Libraries

### Backend Dependencies

| Package | Version | Role |
|---|---|---|
| `@nestjs/common` | ^11 | Core NestJS decorators and utilities |
| `@nestjs/core` | ^11 | Application bootstrap, DI container |
| `@nestjs/platform-express` | ^11 | Express HTTP adapter |
| `@nestjs/config` | ^4 | Environment variable management via `ConfigModule` |
| `@nestjs/bull` | ^11 | BullMQ decorator integration (`@InjectQueue`, `@Process`) |
| `@nestjs/websockets` | ^11 | WebSocket gateway decorators |
| `@nestjs/platform-socket.io` | ^11 | Socket.IO adapter for NestJS |
| `@nestjs/serve-static` | ^5 | Serve React production build from NestJS |
| `bull` | ^4 | Redis-backed job queue (BullMQ v3 API) |
| `ioredis` | ^5 | Redis client used internally by Bull |
| `@google/generative-ai` | ^0.21 | Google Gemini SDK |
| `@supabase/supabase-js` | ^2 | Supabase client — DB queries + auth |
| `axios` | ^1 | HTTP client for all external API calls |
| `cheerio` | ^1 | HTML parsing for web scraping fallbacks |
| `class-validator` | ^0.14 | DTO validation decorators (`@IsString`, `@IsNumber`, etc.) |
| `class-transformer` | ^0.5 | DTO transformation (`plainToInstance`) |
| `date-fns` | ^4 | Date arithmetic for itinerary day calculation |
| `dotenv` | ^17 | Loads `.env` into `process.env` |
| `reflect-metadata` | ^0.2 | Required by NestJS DI |
| `rxjs` | ^7 | Observable streams used by NestJS internals |

### Frontend Dependencies

| Package | Version | Role |
|---|---|---|
| `react` | ^19 | UI framework |
| `react-dom` | ^19 | DOM rendering |
| `react-router-dom` | ^7 | Client-side routing |
| `vite` | ^7 | Dev server and production bundler |
| `typescript` | ~5.9 | Type safety |
| `tailwindcss` | ^4 | Utility-first CSS |
| `postcss` | ^8 | CSS processing pipeline |
| `framer-motion` | ^12 | Declarative animations and transitions |
| `lucide-react` | ^0.575 | Icon set (2000+ icons as React components) |
| `recharts` | ^3 | Chart components for dashboard analytics |
| `zustand` | ^5 | Minimal global state management |
| `@supabase/supabase-js` | ^2 | Auth session management + DB queries |
| `axios` | ^1 | Typed HTTP client for backend calls |
| `date-fns` | ^4 | Date formatting helpers |
| `clsx` | ^2 | Conditional class string builder |
| `tailwind-merge` | ^3 | Merge Tailwind classes without conflicts |

### Development Tools

| Tool | Purpose |
|---|---|
| `@nestjs/cli` | NestJS code generator and build tool |
| `ts-node` | TypeScript execution for scripts |
| `@vitejs/plugin-react` | Vite plugin for React Fast Refresh |
| `eslint` | Linting for both backend and frontend |
| `eslint-plugin-react-hooks` | Enforces React hooks rules |
| `autoprefixer` | CSS vendor prefix injection |

---

## 7. Database Design (Supabase)

All tables have **Row Level Security enabled**. The backend uses `SUPABASE_SERVICE_KEY` (service role) which bypasses RLS — frontend uses the anon key only for auth.

### Table Reference

#### `trips`
| Column | Type | Description |
|---|---|---|
| `id` | UUID PK | Internal ID |
| `job_id` | TEXT UNIQUE | BullMQ job ID (primary lookup key) |
| `user_id` | TEXT | Supabase auth UID |
| `destination` | TEXT | e.g. "Delhi" |
| `start_date` | DATE | — |
| `end_date` | DATE | — |
| `travelers` | INTEGER | Party size |
| `budget` | NUMERIC | Total budget in base currency |
| `currency` | TEXT | Default 'INR' |
| `status` | TEXT | `planning` / `ready` / `active` / `completed` |
| `days` | JSONB | Full generated itinerary array |
| `metadata` | JSONB | Source, transport mode, travel style, etc. |

#### `trip_members`
| Column | Type | Description |
|---|---|---|
| `trip_job_id` | TEXT | References trips.job_id |
| `user_id` | TEXT | Member's auth UID |
| `role` | TEXT CHECK | `owner` / `member` |
| `status` | TEXT CHECK | `invited` / `joined` |
| `display_name` | TEXT | Display name |
| `joined_at` | TIMESTAMPTZ | When member accepted invite |
| UNIQUE | `(trip_job_id, user_id)` | — |

#### `trip_invites`
| Column | Type | Description |
|---|---|---|
| `trip_job_id` | TEXT | Trip this invite belongs to |
| `token` | TEXT UNIQUE | 32-char hex for link-based join |
| `code` | TEXT UNIQUE | 6-char alphanumeric code |
| `invited_by` | TEXT | Owner's user_id |
| `max_travelers` | INTEGER | Capacity cap |
| `expires_at` | TIMESTAMPTZ | TTL — 24 hours from creation |
| `used_by` | TEXT | User who joined (if used) |

#### `activity_feedback`
| Column | Type | Description |
|---|---|---|
| `trip_job_id` | TEXT | Trip reference |
| `activity_name` | TEXT | Activity name (denormalized) |
| `day_index` | INTEGER | Day number (0-based) |
| `user_id` | TEXT | Who submitted |
| `feedback_type` | TEXT CHECK | `looks_good` / `not_ideal` / `too_rushed` / `too_expensive` / `too_crowded` / `need_rest` |
| `comment` | TEXT | Optional free text |
| `suggestion_text` | TEXT | From consensus votes |
| UNIQUE | `(trip_job_id, activity_name, user_id)` | One reaction per user per activity |

#### `trip_suggestions`
Free-text member inputs parsed by Gemini NLP. Columns: `original_text`, `parsed_activity`, `parsed_issue`, `parsed_suggestion`, `status` (pending/applied/ignored).

#### `trip_checkins`
| Column | Type | Description |
|---|---|---|
| `trip_job_id` | TEXT | Trip reference |
| `day_index` | INTEGER | 0-based day |
| `activity_name` | TEXT | Checked-in activity |
| `planned_time` | TEXT | From itinerary (e.g. "09:00 AM") |
| `actual_time` | TEXT | Filled on `checkIn()` |
| `checkout_time` | TEXT | Filled on `checkOut()` |
| `status` | TEXT CHECK | `checked_in` / `checked_out` / `skipped` |
| UNIQUE | `(trip_job_id, day_index, activity_name, user_id)` | — |

#### `trip_eta_checks`
Persisted ETA risk events. Columns: `from_activity`, `to_activity`, `delay_mins`, `risk_level` (on_time/at_risk/late), `checked_at`.

#### `trip_updates`
System-detected alerts. Columns: `reason`, `risk_level`, `affected_activities` (JSONB), `suggested_changes` (JSONB), `summary`, `context` (JSONB), `status` (pending/applied/dismissed).

#### `trip_versions`
Snapshot archive. Columns: `trip_id`, `version` (integer), `days` (JSONB snapshot), `reason`.

#### `jina_cache`
| Column | Type | Description |
|---|---|---|
| `url` | TEXT UNIQUE | Original source URL (cache key) |
| `content` | TEXT | Scraped markdown content |
| `expires_at` | TIMESTAMPTZ | 24-hour TTL |

#### `instagram_cache`
| Column | Type | Description |
|---|---|---|
| `location_key` | TEXT UNIQUE | `{destination}:{poi}` |
| `posts` | JSONB | Scraped post array |
| `crowd_score` | INTEGER | 0–100 computed score |
| `expires_at` | TIMESTAMPTZ | 6-hour TTL |

#### `discovery_cache`
General-purpose API response cache (SerpAPI hotel/restaurant results). TTL configurable per query type.

---

## 8. Caching Strategy

Every expensive external call is protected by a **3-tier cache**:

```
Tier 1 — In-process Map (fastest, zero latency)
  └─ TTL:   6 hours (Instagram), 24 hours (Jina), per-request (Gemini not cached)
  └─ Scope: Single server process (lost on restart)

Tier 2 — Supabase (persistent, survives restarts)
  └─ Tables: instagram_cache, jina_cache, discovery_cache
  └─ TTL:   Stored in expires_at column; query checks > NOW()
  └─ Write: Async fire-and-forget after Tier 3 fetch

Tier 3 — External API (slowest, costs money / quota)
  └─ Instagram: Apify actor (~3s)
  └─ Jina:      r.jina.ai scrape (~5–22s for slow sites)
  └─ SerpAPI:   Google search (~1–2s)
```

#### Cache Key Design

| Data | Key Pattern |
|---|---|
| Instagram feed | `${destination.toLowerCase()}:${poi.toLowerCase()}` |
| Jina scrape | Full source URL |
| SerpAPI hotels | `hotels:${destination}:${checkIn}:${checkOut}:${travelers}` |
| SerpAPI restaurants | `restaurants:${destination}:${dayIndex}` |
| YouTube POI video | `youtube:${destination}:${poi}` |

---

## 9. Background Job System

### Job Lifecycle

```
1. HTTP POST /api/itinerary creates job
2. QueueService.submitTripPlanningJob() → Bull enqueues to 'trip-planning'
3. TripPlanningProcessor.handle():
   a. Calls ItineraryService.generate() (full pipeline ~20–40s)
   b. Emits Socket.IO progress events at each stage
   c. Saves result to Supabase trips table
   d. Starts monitoring jobs:
      - WeatherMonitorProcessor répeat every 30 min
      - CrowdMonitorProcessor repeat every 2 h
      - FlightDelayMonitorProcessor repeat every 15 min
      - PoiMonitorProcessor repeat every 6 h
4. Client polls GET /api/itinerary/status/:jobId
5. On completion, result pulled from Bull job data
```

### Monitor → Replan Flow

```
WeatherMonitorProcessor:
  1. Fetch OWM forecast for trip destination
  2. For each day with RAIN/STORM/EXTREME events:
     a. Map affected outdoor activities
     b. Assess severity (HIGH if rain > 50%, CRITICAL if storm)
  3. If severity ≥ MEDIUM:
     a. QueueService.saveTripUpdate() → Supabase trip_updates
     b. QueueService.queueReplan() → replan queue
     c. Emit WebSocket 'trip:update' to connected clients

ReplanProcessor:
  1. Load trip days from Supabase
  2. Identify affected activities for each affectedDay
  3. Call ItineraryService.replanDay() → Gemini generates replacement
  4. Build ProposedReplan with summary (human-readable)
  5. QueueService stores in proposals Map
  6. Emit WebSocket 'trip:proposal' to owner
  7. Owner responds via POST /api/itinerary/replan-consent/:proposalId
  8. On accept: QueueService.updateTripDays() patches Supabase
```

---

## 10. AI & NLP Approach

### Primary Model: Google Gemini 1.5 Flash

Used for all high-throughput tasks:
- Full itinerary generation
- Single-day replanning
- Budget validation
- User issue NLP parsing
- Suggestion text parsing

**Why Gemini Flash?** Fast (~3–8s), handles large JSON outputs reliably, free tier generous enough for development.

#### Prompt Design Pattern

All Gemini prompts follow a consistent structure:

```
ROLE: You are an expert travel planner for [destination], [country].

CONTEXT: [live data injected here]
- Weather: { forecast summary }
- Hotels found: { top 3 from SerpAPI }
- Flights: { cheapest option from Amadeus }
- Crowd scores: { Instagram scores per POI }

TASK: Generate a [N]-day itinerary for [travelers] traveler(s) with a budget of [budget] [currency].

CONSTRAINTS:
- Budget breakdown MUST include: accommodation, food, activities, transport, miscellaneous
- Each day MUST have activities array with name, time, duration, location, cost, description
- ...

OUTPUT FORMAT: Strict JSON matching the Itinerary interface schema.
DO NOT include markdown fences. Return raw JSON only.
```

**JSON repair:** After Gemini responds, the service runs a lightweight regex-based JSON sanitiser to strip any accidental markdown fences or trailing commas before `JSON.parse`.

### Secondary Model: Mistral-7B-Instruct (via OpenRouter)

Used for lower-stakes, per-user NLP tasks:
- Chatbot Q&A ("Ask about this place")
- Consensus vote suggestion parsing

**Why Mistral?** Very fast on short prompts, low token cost, good instruction following for factual Q&A grounded in provided context.

#### Chatbot Approach

```
1. User asks: "What are the entry fees for Humayun's Tomb?"
2. ChatbotService.askAboutPlace("Humayun's Tomb", "Delhi", question)
3. Cache check (memory → Supabase jina_cache)
4. If miss: GET https://r.jina.ai/https://delhitourism.gov.in/delhitourism/tourist_place/humayuns_tomb.jsp
5. Prompt to Mistral:
   ---
   You are a helpful travel assistant. Answer ONLY using the content below.
   If the answer is not in the content, say "I don't have that information."

   CONTENT: { jina markdown, max 8000 chars }

   QUESTION: { user question }
   ---
6. Return { answer, source: "Delhi Tourism", sourceUrl }
```

### NLP Issue Parsing (UserFlagService)

When a user taps "Report Issue" and writes free text like:

> "The traffic to Qutub Minar is terrible, we're stuck and might miss the next activity"

Gemini extracts:
```json
{
  "affectedActivity": "Qutub Minar",
  "issueType": "transport_delay",
  "severity": "HIGH",
  "shiftHours": 2,
  "shouldReplan": true,
  "suggestedAction": "Delay next activity by ~2 hours or replace with nearby low-transit option"
}
```

This structured output is then fed into `queueReplan()` with appropriate context.

---

## 11. Trip Planning Pipeline

The `ItineraryService.generate()` method runs sequentially, with parallelised API calls at each data-gathering stage.

```
Stage 1 — Validation & Enrichment (synchronous)
  ├─ Parse and validate CreateItineraryDto
  ├─ AirportService: resolve IATA codes for source + destination
  └─ GeoService: geocode destination, get country + timezone

Stage 2 — Parallel Data Fetch (Promise.allSettled)
  ├─ FlightService.searchFlights()          → cheapest round-trip fares
  ├─ WeatherService.getForecast()           → 5-day conditions
  ├─ SerpService.searchHotels()             → top 5 ranked hotels in budget
  ├─ SerpService.searchRestaurants()        → top restaurants per meal type
  ├─ SerpService.searchAttractions()        → top POIs with ratings
  ├─ InstagramService.getOrFetchFeed()      → crowd scores per POI
  ├─ TourismAdvisoryService.getAdvisory()   → travel safety notes
  └─ (for domestic India trips)
     EasemytripService.getTrainOptions()    → rail fares

Stage 3 — AI Generation
  └─ ItineraryService.callGemini(enrichedPrompt)
     ├─ Constructs mega-prompt with all Stage 2 data
     ├─ Specifies exact JSON schema required
     ├─ Calls Gemini Flash (with retry + key rotation)
     └─ JSON.parse + schema validation

Stage 4 — Post-processing
  ├─ Budget breakdown validation (ensure all 5 keys present; auto-fill if 0)
  ├─ Activity enrichment:
  │   ├─ GeoService.getTransportBetweenActivities() per activity pair
  │   ├─ ImageService.getPlaceImage() per unique place
  │   └─ TourismPoiService.enrichActivity() (timings, fees, accessible)
  ├─ Weather warnings injected per day
  └─ Flight info attached to Day 1 / last day

Stage 5 — Persist
  └─ QueueService.saveTripToSupabase() → upsert to trips table

Stage 6 — Start Monitoring
  └─ QueueService.startMonitoring() → launch repeating background jobs
```

**Typical total latency:** 18–45 seconds depending on destination and API response times.

---

## 12. Real-Time Adaptation Engine

### Trigger Sources

| Trigger | Detector | Check Interval |
|---|---|---|
| Severe weather | `WeatherMonitorProcessor` | Every 30 minutes |
| High crowd density | `CrowdMonitorProcessor` | Every 2 hours |
| Flight delay > 45 min | `FlightDelayMonitorProcessor` | Every 15 minutes |
| Transport major incident | `TransportDelayMonitorProcessor` | Every 30 minutes |
| POI temporarily closed | `PoiMonitorProcessor` | Every 6 hours |
| User-reported issue | `UserFlagService` + HTTP | Real-time (on user submit) |
| Agent autonomous loop | `AgentLoopProcessor` | On-demand (triggered by monitors) |

### Risk Scoring (`ImpactEngineService`)

```typescript
riskScore = (
  weatherSeverity  × 0.35 +   // 0–100: clear=0, storm=100
  crowdScore       × 0.25 +   // 0–100: empty=0, viral=100
  flightDelay      × 0.30 +   // 0–100: on-time=0, cancelled=100
  poiRisk          × 0.10     // 0–100: open=0, closed=100
)

riskLevel:
  < 30  → LOW      (no action)
  30–59 → MEDIUM   (surface info banner)
  60–79 → HIGH     (propose replan, user consent required)
  ≥ 80  → CRITICAL (immediate replan proposal + priority notification)
```

### Consent-Based Replanning

Travion **never silently mutates a user's itinerary**. Every AI-generated change goes through:

```
System detects HIGH risk
  → Saves trip_update (Supabase)
  → Creates ProposedReplan (in-memory, 24h TTL)
  → WebSocket 'trip:proposal' event to owner

Owner sees banner: "⚠ Heavy rain expected Day 3 — AI suggests alternatives"
  → Clicks "Review Changes"
  → Sees before/after diff per activity
  
Owner accepts → ReplanProcessor patches trip days in Supabase
Owner rejects → Dismissed flag set, no changes made
```

---

## 13. Team Collaboration System

### Data Model

```
trip_members (1 owner + N members, max = max_travelers)
    ↓
trip_invites (link token + 6-char code per trip)
    ↓
activity_feedback (one row per member per activity per type)
    ↓
trip_suggestions (free-text, Gemini-parsed)
```

### Workflow

```
1. Owner plans trip → auto-registered as owner in trip_members
2. Owner opens Team tab → clicks "Generate Invite"
   → 6-char code (e.g. DEL6X9) + shareable link
   → Valid 24 hours, expires after max_travelers reached

3. Friend opens app → enters code or clicks link
   → Joins trip as member

4. Member sees same itinerary (read-only)
5. Member reacts to each activity (👍 looks_good, 👎 not_ideal, etc.)
6. Member types suggestions ("Too many museums, add street food tour")
   → Gemini parses → owner sees structured suggestion

7. Consensus panel shows per-activity vote breakdown
8. Owner applies suggestions → triggers targeted replan
```

### Consent Vote → DB Mapping

Raw UI vote types are mapped to DB-compliant feedback types:

| UI Vote | DB `feedback_type` |
|---|---|
| `agree` | `looks_good` |
| `disagree` | `not_ideal` |
| `neutral` | `need_rest` |

---

## 14. Trip Tracking & ETA System

### Check-In Flow

```
User on Day 2, Activity: "Red Fort visit"
  → Taps ✅ Check In

POST /api/itinerary/checkin
  → TripTrackerService.checkIn()
    ├─ Upsert trip_checkins (status = 'checked_in', actual_time = now())
    └─ Return updated tracking status

POST /api/itinerary/eta-check
  → EtaMonitorService.checkEtaAfterCheckin()
    ├─ Google Maps Distance Matrix:
    │   origin = "Red Fort, Delhi"
    │   destination = "Jama Masjid, Delhi"
    │   mode = driving | walking | transit
    ├─ Compute travel_time_minutes
    ├─ Compare: (next_activity_start - now) vs (travel_time + 15min buffer)
    ├─ Classify:
    │   on_time  → next activity start - now > travel_time + buffer
    │   at_risk  → within 10 min of being late
    │   late     → already past next activity start time
    ├─ Persist to trip_eta_checks
    └─ Emit WebSocket 'eta:alert' if at_risk or late
```

### Schedule Drift Calculation

```typescript
// TripTrackerService
drift = sum of (actual_checkout_time - planned_end_time) across completed activities

if drift > 30 min → flagged in tracking status as "running late"
Overall completion % = checked_out_activities / total_activities × 100
```

---

## 15. Security Model

| Layer | Mechanism |
|---|---|
| **Auth** | Supabase JWT — all protected routes verify token server-side |
| **Service key** | `SUPABASE_SERVICE_KEY` stored only in backend `.env`, never in frontend |
| **RLS** | All Supabase tables have Row Level Security enabled; service key bypasses, anon key is restricted |
| **CORS** | Backend allows `http://localhost:5173` in dev; configured to production domain in prod |
| **Rate limiting** | `UsageLimitGuard` enforces per-user monthly quota per feature tier |
| **Payment webhooks** | Dodo webhook signature verified with HMAC `whsec_*` secret before processing |
| **API key rotation** | All external API keys are server-side only; never exposed to frontend |
| **Input validation** | `class-validator` global ValidationPipe on all DTO classes — bad input returns 400 before service layer |

---

## 16. Full API Reference

### Itinerary Endpoints (`/api/itinerary`)

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/` | Required | Create itinerary. `?sync=true` for immediate response, default async |
| GET | `/status/:jobId` | No | Poll async job status |
| GET | `/trips` | Required | List user's trips |
| POST | `/replan-day` | Required | Replan a single day with AI |
| POST | `/validate-budget` | Required | Validate budget feasibility before generating |
| POST | `/report-issue` | Required | NLP-parse a user-reported issue; queue replan if needed |
| GET | `/proposals/:tripId` | Required | Get pending replan proposals |
| POST | `/replan-consent/:proposalId` | Required | Accept or reject a proposal |
| GET | `/trip-updates/:tripId` | Required | Get system-detected alerts |
| POST | `/apply-update/:updateId` | Required | Trigger replan from stored update context |
| POST | `/dismiss-update/:updateId` | Required | Dismiss a pending update |
| GET | `/trip-versions/:tripId` | Required | Get itinerary version history |
| PATCH | `/update-days/:tripId` | Required | Save manually edited days |
| GET | `/social-feed/:destination` | No | Instagram crowd data + posts |
| GET | `/poi-videos/:destination` | No | YouTube videos per POI |
| POST | `/chatbot` | Required | Ask about a specific place |
| POST | `/checkin` | Required | Check in to activity |
| POST | `/checkout` | Required | Check out of activity |
| POST | `/skip-activity` | Required | Skip activity |
| GET | `/tracking/:tripJobId` | Required | Get live tracking status |
| POST | `/eta-check` | Required | Check ETA risk after check-in |
| GET | `/openrouter-health` | No | Ping OpenRouter connectivity |

### Team Endpoints (`/api/team`)

| Method | Path | Description |
|---|---|---|
| GET | `/members/:tripJobId` | List trip members |
| GET | `/invite/:tripJobId` | Get active invite for trip |
| POST | `/invite/generate` | Generate new invite link + code |
| POST | `/invite/join` | Join trip via token or code |
| POST | `/feedback` | Submit activity reaction |
| GET | `/feedback/:tripJobId` | Get all feedback for a trip |
| POST | `/suggestions` | Submit free-text suggestion |
| GET | `/suggestions/:tripJobId` | Get suggestions for a trip |
| PATCH | `/suggestions/:id` | Apply or ignore a suggestion |
| POST | `/vote` | Submit consensus vote |
| GET | `/consensus/:tripJobId` | Get vote breakdown per activity |

### Agent Endpoints (`/api/agent`)

| Method | Path | Description |
|---|---|---|
| POST | `/assess` | Run ImpactEngine assessment on a trip |
| POST | `/check-tools` | Run AgentTools check on an activity |
| GET | `/tracking/:tripJobId` | Get tracker state |
| POST | `/eta` | Manual ETA check |
| GET | `/consensus/:tripJobId` | Get consensus scores |

### Auth Endpoints (`/api/auth`)

| Method | Path | Description |
|---|---|---|
| POST | `/verify` | Verify Supabase JWT and return user info |

### Billing Endpoints (`/api/billing`)

| Method | Path | Description |
|---|---|---|
| POST | `/checkout` | Create Dodo Payments checkout session |
| POST | `/webhook` | Receive and verify Dodo payment webhook |
| GET | `/subscription/:userId` | Get current subscription status |

---

## 17. Environment Configuration

All variables live in `travion_backend/.env`. Full documentation is in `.env.example` at the repo root.

| Group | Variables |
|---|---|
| Server | `PORT`, `BACKEND_URL`, `APP_BASE_URL` |
| AI | `GEMINI_API_KEY` – `GEMINI_API_KEY_4`, `OPENROUTER_API_KEY` |
| Maps & Search | `GOOGLE_MAPS_API_KEY`, `SERP_API_KEY` – `SERP_API_KEY_5` |
| Weather | `OPENWEATHER_API_KEY` |
| Flights | `AMADEUS_API_KEY`, `AMADEUS_API_SECRET`, `AMADEUS_BASE_URL`, `AVIATION_STACK_API_KEY` |
| Database | `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` |
| Queue | `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` |
| Payments | `DODO_API_KEY`, `DODO_API_SECRET`, `DODO_PUBLISHABLE_KEY`, `DODO_ENVIRONMENT`, `DODO_PRODUCT_ID_PRO_MONTHLY`, `DODO_PRODUCT_ID_PRO_ANNUAL` |

---

## 18. Data Flow Diagrams

### Full Trip Generation Flow

```
User fills planner form → POST /api/itinerary
         │
         ▼
  ItineraryController
  adds to 'trip-planning' BullMQ queue
  returns { jobId, status: 'queued' }
         │
         ▼
  TripPlanningProcessor (background)
         │
    ┌────┴────────────────────────────────────────────┐
    │  Parallel API Calls (Promise.allSettled)         │
    │  FlightService ──── WeatherService               │
    │  SerpService (hotels, restaurants, attractions)  │
    │  InstagramService ─ TourismAdvisoryService        │
    └────┬────────────────────────────────────────────┘
         │
    Gemini 1.5 Flash (mega-prompt with all data)
         │
    JSON parse + validate + repair
         │
    Post-process:
    ├─ Geo enrichment (transport between activities)
    ├─ Image fetch per place
    ├─ Budget breakdown fix
    └─ Weather warnings injected
         │
    Supabase: upsert trips table
         │
    Socket.IO: emit 'trip:complete' to client
         │
    Launch monitoring jobs (weather, crowd, flight, POI)
```

### Real-Time Monitoring → User Notification

```
WeatherMonitorProcessor (every 30 min)
         │
    OWM API → storm detected Day 3
         │
    saveTripUpdate() → Supabase trip_updates
         │
    queueReplan() → 'replan' queue
         │
  ReplanProcessor
    ├─ Load days from Supabase
    ├─ Gemini: generate alternative Day 3
    └─ Store ProposedReplan (in-memory)
         │
    WebSocket: 'trip:proposal' → owner's browser
         │
  Owner sees consent banner
    ├─ Accepts → updateTripDays() → Supabase patched
    └─ Rejects → dismissed, no changes
```

### Check-In → ETA Alert

```
User taps Check In on "Red Fort"
         │
POST /api/itinerary/checkin
  └─ trip_checkins: status = 'checked_in', actual_time = now()
         │
POST /api/itinerary/eta-check
  └─ Google Maps Distance Matrix:
      Red Fort → Jama Masjid = 12 min driving
         │
  next_activity_start = 11:30 AM
  now = 10:55 AM, travel = 12 min, buffer = 15 min
  available = 35 min > 27 min → on_time ✅
         │
  If late → Socket.IO 'eta:alert' → yellow/red banner in app
```

---

*Documentation generated for Travion v1.0.0 — February 2026*
