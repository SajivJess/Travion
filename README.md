# Travion ✈️

**AI-powered travel itinerary planner** with real-time adaptation, social intelligence, team collaboration, and live trip tracking.

> Travion generates personalised multi-day itineraries using Google Gemini, enriches them with live weather, flight, hotel and crowd data, then continuously monitors your trip and replans on the fly.

---

## Table of Contents

1. [Features](#features)
2. [Tech Stack](#tech-stack)
3. [Prerequisites](#prerequisites)
4. [Project Structure](#project-structure)
5. [Quick Start](#quick-start)
6. [Environment Variables](#environment-variables)
7. [API Keys — Where to Get Them](#api-keys--where-to-get-them)
8. [Supabase Database Setup](#supabase-database-setup)
9. [Available Scripts](#available-scripts)
10. [Architecture Overview](#architecture-overview)

---

## Features

| Category | Capability |
|---|---|
| **AI Planning** | Gemini-powered multi-day itinerary generation with budget breakdown, meal planning, and age-aware suggestions |
| **Live Data** | Real-time weather (OpenWeatherMap), flights (Amadeus + AviationStack), hotels & attractions (SerpAPI), crowd scores (Instagram) |
| **Agent Intelligence** | Background job loop that monitors weather, crowds and flight delays — auto-replans affected days |
| **Trip Tracking** | Check-in / check-out / skip activities; ETA risk detection; running time alerts |
| **Team Collaboration** | Shareable invite codes, member feedback (6 reaction types), free-text suggestions, consensus voting |
| **Chatbot** | Ask about any place; answers sourced from Jina-scraped tourism pages + Mistral-7B via OpenRouter |
| **Payments** | Subscription billing via Dodo Payments (Pro tier) |
| **Caching** | 3-tier cache (in-memory → Supabase → API) for Instagram feeds and Jina tourism pages |

---

## Tech Stack

### Backend — `travion_backend/`
| Layer | Technology |
|---|---|
| Framework | NestJS (Node.js / TypeScript) |
| AI | Google Gemini 1.5 Flash / Pro (rotation across 4 keys) |
| NLP / Chat | OpenRouter → Mistral-7B-Instruct |
| Job Queues | BullMQ + Redis |
| Real-time | Socket.IO / NestJS WebSockets |
| Database | Supabase (PostgreSQL) |
| HTTP client | Axios |
| Payments | Dodo Payments |

### Frontend — `travion_web/`
| Layer | Technology |
|---|---|
| Framework | React 19 + Vite 7 |
| Language | TypeScript |
| Styling | Tailwind CSS 4 |
| State | Zustand |
| Charts | Recharts |
| Animations | Framer Motion |
| Icons | Lucide React |
| Routing | React Router 7 |

---

## Prerequisites

| Tool | Minimum version | Notes |
|---|---|---|
| **Node.js** | 20 LTS | [nodejs.org](https://nodejs.org) |
| **npm** | 10+ | Bundled with Node |
| **Redis** | 7+ | Must be running locally on port 6379 |
| **Git** | any | — |

> **Windows users:** Install Redis via [Memurai](https://www.memurai.com/) (free for dev) or WSL2 + `apt install redis-server`.

---

## Project Structure

```
Travion/
├── travion_backend/        # NestJS API server (port 3000)
│   ├── src/
│   │   ├── agent/          # Agent HTTP controller + module
│   │   ├── auth/           # JWT auth middleware
│   │   ├── billing/        # Dodo Payments subscriptions
│   │   ├── itinerary/      # Core planning pipeline (Gemini, weather, flights, hotels, chatbot)
│   │   ├── queue/          # BullMQ processors (planning, replan, weather monitor, crowd monitor, agent loop)
│   │   ├── supabase/       # Supabase client + discovery cache service
│   │   ├── team/           # Invite, feedback, suggestions, consensus services
│   │   └── websocket/      # Socket.IO gateway + notifications
│   ├── .env                # ← your secrets (never commit)
│   └── package.json
│
├── travion_web/            # React/Vite frontend (port 5173)
│   ├── src/
│   │   ├── components/     # Shared UI components (layout, planning, team panels)
│   │   ├── pages/          # Route-level pages (Dashboard, Trips, etc.)
│   │   └── store/          # Zustand global state
│   └── package.json
│
├── assets/                 # Static brand assets
├── start-travion.bat       # One-click dev startup (backend + frontend)
├── stop-travion.bat        # Kill all dev processes
├── .env.example            # ← copy to travion_backend/.env and fill in your keys
└── README.md
```

---

## Quick Start

### 1. Clone

```bash
git clone https://github.com/your-username/travion.git
cd travion
```

### 2. Install dependencies

```bash
# Backend
cd travion_backend
npm install

# Frontend
cd ../travion_web
npm install
```

### 3. Configure environment

```bash
# From the repo root:
copy .env.example travion_backend\.env
```

Open `travion_backend/.env` and fill in every key (see [Environment Variables](#environment-variables) below).

### 4. Set up the Supabase database

In your Supabase project → **SQL Editor → New query**, paste and run the following blocks **in order**:

<details>
<summary>Block 1 — Team & Invite tables</summary>

```sql
-- trip_members
CREATE TABLE IF NOT EXISTS trip_members (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  trip_job_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','member')) DEFAULT 'member',
  status TEXT NOT NULL CHECK (status IN ('invited','joined')) DEFAULT 'invited',
  display_name TEXT, email TEXT, joined_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (trip_job_id, user_id)
);

-- trip_invites
CREATE TABLE IF NOT EXISTS trip_invites (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  trip_job_id TEXT NOT NULL,
  token TEXT UNIQUE NOT NULL,
  code TEXT UNIQUE,
  invited_by TEXT NOT NULL,
  max_travelers INTEGER NOT NULL DEFAULT 2,
  expires_at TIMESTAMPTZ NOT NULL,
  used_by TEXT, used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- activity_feedback
CREATE TABLE IF NOT EXISTS activity_feedback (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  trip_job_id TEXT NOT NULL,
  activity_name TEXT NOT NULL,
  day_index INTEGER NOT NULL DEFAULT 0,
  user_id TEXT NOT NULL,
  feedback_type TEXT NOT NULL CHECK (feedback_type IN (
    'looks_good','not_ideal','too_rushed','too_expensive','too_crowded','need_rest'
  )),
  comment TEXT,
  suggestion_text TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (trip_job_id, activity_name, user_id)
);

-- trip_suggestions
CREATE TABLE IF NOT EXISTS trip_suggestions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  trip_job_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  original_text TEXT NOT NULL,
  parsed_activity TEXT, parsed_issue TEXT, parsed_suggestion TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending','applied','ignored')) DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE trip_members      ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_invites      ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_suggestions  ENABLE ROW LEVEL SECURITY;
```

</details>

<details>
<summary>Block 2 — Core trips + instagram cache tables</summary>

```sql
-- trips (main itinerary store)
CREATE TABLE IF NOT EXISTS trips (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id TEXT UNIQUE NOT NULL,
  user_id TEXT NOT NULL,
  destination TEXT,
  start_date DATE,
  end_date DATE,
  travelers INTEGER DEFAULT 1,
  budget NUMERIC,
  currency TEXT DEFAULT 'INR',
  status TEXT DEFAULT 'planning',
  days JSONB,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- instagram_cache
CREATE TABLE IF NOT EXISTS instagram_cache (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  location_key TEXT UNIQUE NOT NULL,
  posts JSONB NOT NULL DEFAULT '[]',
  crowd_score INTEGER DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- discovery_cache
CREATE TABLE IF NOT EXISTS discovery_cache (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  cache_key TEXT UNIQUE NOT NULL,
  data JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE trips             ENABLE ROW LEVEL SECURITY;
ALTER TABLE instagram_cache   ENABLE ROW LEVEL SECURITY;
ALTER TABLE discovery_cache   ENABLE ROW LEVEL SECURITY;
```

</details>

<details>
<summary>Block 3 — Agent intelligence + Jina cache tables</summary>

```sql
-- jina_cache
CREATE TABLE IF NOT EXISTS jina_cache (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  url TEXT UNIQUE NOT NULL,
  content TEXT NOT NULL,
  source_name TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- trip_checkins
CREATE TABLE IF NOT EXISTS trip_checkins (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  trip_job_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  day_index INTEGER NOT NULL,
  activity_name TEXT NOT NULL,
  planned_time TEXT, actual_time TEXT, checkout_time TEXT,
  status TEXT NOT NULL CHECK (status IN ('checked_in','checked_out','skipped')) DEFAULT 'checked_in',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (trip_job_id, day_index, activity_name, user_id)
);

-- trip_eta_checks
CREATE TABLE IF NOT EXISTS trip_eta_checks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  trip_job_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  day_index INTEGER NOT NULL,
  from_activity TEXT NOT NULL,
  to_activity TEXT NOT NULL,
  delay_mins INTEGER NOT NULL DEFAULT 0,
  risk_level TEXT NOT NULL CHECK (risk_level IN ('on_time','at_risk','late')),
  checked_at TIMESTAMPTZ DEFAULT NOW()
);

-- trip_updates
CREATE TABLE IF NOT EXISTS trip_updates (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  trip_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  day INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL,
  risk_level TEXT NOT NULL DEFAULT 'MEDIUM',
  affected_activities JSONB DEFAULT '[]',
  suggested_changes JSONB DEFAULT '[]',
  summary TEXT,
  context JSONB DEFAULT '{}',
  status TEXT NOT NULL CHECK (status IN ('pending','applied','dismissed')) DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- trip_versions
CREATE TABLE IF NOT EXISTS trip_versions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  trip_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  days JSONB NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE jina_cache        ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_checkins     ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_eta_checks   ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_updates      ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_versions     ENABLE ROW LEVEL SECURITY;
```

</details>

### 5. Start the dev servers

```bat
.\start-travion.bat
```

- Backend: http://localhost:3000
- Frontend: http://localhost:5173

---

## Environment Variables

All variables live in `travion_backend/.env`. Copy `.env.example` (repo root) as a starting point.

| Variable | Required | Description |
|---|---|---|
| `PORT` | ✅ | Backend HTTP port (default `3000`) |
| `GEMINI_API_KEY` | ✅ | Primary Gemini key for itinerary generation |
| `GEMINI_API_KEY_2` … `_4` | ⚠️ optional | Rotation keys — avoids Gemini rate limits |
| `GOOGLE_MAPS_API_KEY` | ✅ | Places, Distance Matrix, Directions APIs |
| `SERP_API_KEY` | ✅ | Primary SerpAPI key (hotels, attractions, restaurants) |
| `SERP_API_KEY_2` … `_5` | ⚠️ optional | Rotation keys |
| `REDIS_HOST` | ✅ | Redis host (default `localhost`) |
| `REDIS_PORT` | ✅ | Redis port (default `6379`) |
| `REDIS_PASSWORD` | — | Redis password (leave blank for local) |
| `OPENWEATHER_API_KEY` | ✅ | Live weather + forecasts |
| `AMADEUS_API_KEY` | ✅ | Amadeus flight search |
| `AMADEUS_API_SECRET` | ✅ | Amadeus secret |
| `AMADEUS_BASE_URL` | ✅ | `https://test.api.amadeus.com` (test) or prod URL |
| `AVIATION_STACK_API_KEY` | ✅ | Real-time flight status & delays |
| `SUPABASE_URL` | ✅ | Your project URL from Supabase dashboard |
| `SUPABASE_SERVICE_KEY` | ✅ | Service-role key (bypasses RLS — keep secret) |
| `DODO_API_KEY` | ✅ | Dodo Payments secret key |
| `DODO_API_SECRET` | ✅ | Webhook secret |
| `DODO_PUBLISHABLE_KEY` | ✅ | Dodo public key (safe to expose) |
| `DODO_ENVIRONMENT` | ✅ | `test_mode` or `live_mode` |
| `DODO_PRODUCT_ID_PRO_MONTHLY` | ⚠️ | Dodo product ID for monthly Pro plan |
| `DODO_PRODUCT_ID_PRO_ANNUAL` | ⚠️ | Dodo product ID for annual Pro plan |
| `BACKEND_URL` | ✅ | Public backend URL (ngrok or prod) used for payment webhooks |
| `OPENROUTER_API_KEY` | ✅ | OpenRouter key — routes to Mistral-7B for chatbot + NLP |
| `APP_BASE_URL` | — | Base URL for invite links (default `https://travion.app`) |

---

## API Keys — Where to Get Them

### Google Gemini
1. Go to [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
2. Click **Create API key**
3. Copy into `GEMINI_API_KEY` (create up to 4 keys for rotation)

### Google Maps
1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create or select a project → **APIs & Services → Credentials → Create Credentials → API Key**
3. Enable these APIs on the key: **Maps JavaScript API**, **Places API**, **Distance Matrix API**, **Directions API**
4. Copy into `GOOGLE_MAPS_API_KEY`

### SerpAPI
1. Sign up at [serpapi.com](https://serpapi.com)
2. Dashboard → **API Key** section
3. Free tier: 100 searches/month. Paid plans from $50/mo

### OpenWeatherMap
1. Sign up at [openweathermap.org/api](https://openweathermap.org/api)
2. Profile → **My API Keys**
3. Free tier covers current weather + 5-day forecast

### Amadeus (Flights)
1. Sign up at [developers.amadeus.com](https://developers.amadeus.com)
2. Create an app under **My Apps**
3. Copy **API Key** and **API Secret**
4. Use `https://test.api.amadeus.com` for development (free sandbox)

### AviationStack
1. Sign up at [aviationstack.com](https://aviationstack.com)
2. Dashboard → **API Access Key**
3. Free tier: 100 requests/month

### Supabase
1. Sign up at [supabase.com](https://supabase.com) → **New Project**
2. Settings → **API** tab
3. Copy **Project URL** → `SUPABASE_URL`
4. Copy **service_role** secret → `SUPABASE_SERVICE_KEY`  
   ⚠️ This key bypasses Row Level Security — never expose it in the frontend

### Dodo Payments
1. Sign up at [dodopayments.com](https://dodopayments.com)
2. Dashboard → **Developers → API Keys**
3. Copy secret key → `DODO_API_KEY`
4. Copy webhook secret → `DODO_API_SECRET`
5. Copy publishable key → `DODO_PUBLISHABLE_KEY`
6. Create two Products (monthly + annual Pro) and copy their IDs

### OpenRouter (Mistral-7B)
1. Sign up at [openrouter.ai](https://openrouter.ai)
2. Profile → **Keys → Create Key**
3. Free credits on signup; pay-per-token afterwards
4. Model used: `google/gemma-3-27b-it:free`

---

## Supabase Database Setup

All required tables are documented inline in the [Quick Start → Step 4](#4-set-up-the-supabase-database) section above. Run the three SQL blocks in order in the Supabase SQL editor.

---

## Available Scripts

### Root (Windows)

```bat
.\start-travion.bat    # Start backend + frontend dev servers
.\stop-travion.bat     # Kill all Travion dev processes
```

### Backend

```bash
cd travion_backend
npm run start:dev      # NestJS watch mode (hot reload)
npm run build          # Compile TypeScript → dist/
npm run start:prod     # Run compiled build
```

### Frontend

```bash
cd travion_web
npm run dev            # Vite dev server (http://localhost:5173)
npm run build          # TypeScript check + production build → dist/
npm run preview        # Preview production build locally
npm run lint           # ESLint
```

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser (React/Vite :5173)                                     │
│  Dashboard · Trip Planner · Team Panel · Trip Tracker           │
└────────────────────┬────────────────────────────────────────────┘
                     │  REST + WebSocket (Socket.IO)
┌────────────────────▼────────────────────────────────────────────┐
│  NestJS Backend (:3000)                                         │
│                                                                 │
│  ┌──────────────┐  ┌────────────────┐  ┌─────────────────────┐ │
│  │ItineraryMod  │  │  TeamModule    │  │   BillingModule     │ │
│  │ • Gemini     │  │ • Invites      │  │   • DodoPayments    │ │
│  │ • Weather    │  │ • Feedback     │  └─────────────────────┘ │
│  │ • Flights    │  │ • Consensus    │                           │
│  │ • SerpAPI    │  └────────────────┘  ┌─────────────────────┐ │
│  │ • Instagram  │                      │  WebSocketModule    │ │
│  │ • Chatbot    │  ┌────────────────┐  │  • Notifications    │ │
│  └──────────────┘  │  AgentModule   │  └─────────────────────┘ │
│                    │ • ImpactEngine │                           │
│  ┌─────────────────│ • TripTracker  │──────────────────────┐   │
│  │   QueueModule   │ • EtaMonitor   │                      │   │
│  │  BullMQ Workers │ • Consensus    │                      │   │
│  │  • TripPlanning └────────────────┘                      │   │
│  │  • WeatherMonitor                                        │   │
│  │  • CrowdMonitor                                          │   │
│  │  • AgentLoop                                             │   │
│  │  • Replan                                                │   │
│  └───────────────────────────┬──────────────────────────────┘  │
└──────────────────────────────┼──────────────────────────────────┘
                               │
          ┌────────────────────┼────────────────────┐
          ▼                    ▼                    ▼
    ┌──────────┐        ┌──────────┐        ┌──────────┐
    │  Redis   │        │ Supabase │        │External  │
    │  BullMQ  │        │ Postgres │        │ APIs     │
    │  queues  │        │ + RLS    │        │ Gemini   │
    └──────────┘        └──────────┘        │ Maps     │
                                            │ SerpAPI  │
                                            │ Amadeus  │
                                            │ Instagram│
                                            │ Jina     │
                                            └──────────┘
```

---

## Contributing

Pull requests are welcome. Please run `npx tsc --noEmit` in both `travion_backend/` and `travion_web/` before submitting — zero TypeScript errors required.

---

## License

MIT
