# OpenUp

Web-based mental wellness and freelance counseling support system for Cebu City LGUs.
Built to the stack in Chapter III: React + Vite + Tailwind, Node + Express, Socket.IO,
Jitsi, Whisper / HuggingFace, Supabase (PostgreSQL).

```
openup/
├── db/          schema.sql, seed.sql
├── server/      Express API + Socket.IO
└── client/      React + Vite + Tailwind
```

## Setting up

**1. Database.** Create a Supabase project. Open the SQL Editor, paste `db/schema.sql`,
run it, then do the same with `db/seed.sql`.

**2. Server.**

```bash
cd server
npm install
cp .env.example .env      # fill in DATABASE_URL and JWT_SECRET
npm run dev               # http://localhost:4000
```

`DATABASE_URL` is under Project Settings → Database → Connection string → URI. Use the
**pooler** connection on port 6543, not the direct one — the direct connection is IPv6-only
and will not resolve on most Philippine ISPs.

**3. Client.**

```bash
cd client
npm install
npm run dev               # http://localhost:5173
```

Vite proxies `/api` and `/socket.io` to port 4000, so there is no CORS setup in development.

**Test accounts** (password `OpenUp123!` for all):

| Email | Role |
| --- | --- |
| `juan@openup.ph` | Resident, Barangay Inayawan |
| `maria.santos@openup.ph` | Psychologist, verified |
| `inayawan.lgu@openup.ph` | LGU |
| `admin@openup.ph` | Super Admin |

## What is already working

- Account Management: register (resident + psychologist), login, JWT sessions, profile
  update, password change, consent recorded at sign-up
- Mood Tracking: log, history, weekly trends (one entry per day, re-logging replaces it)
- Counseling Booking: browse verified psychologists, generated open slots, book, apply
  Care Credits, cancel, accept/decline
- Notifications: stored and pushed live over Socket.IO
- Anonymous Chat: Socket.IO rooms with per-conversation access checks and alias masking
- LGU analytics: dashboard, heatmap, wellness index, risk alerts, budget, AI effectiveness
  (all served from aggregate SQL views — no resident identity leaves the database)

## Two decisions worth knowing about

**Custom auth, not Supabase Auth.** Your Data Dictionary puts a `password` column on the
User table, so the server hashes with bcrypt and issues its own JWTs. Supabase is used as
managed Postgres plus Storage. If you would rather use Supabase Auth, the user IDs become
UUIDs and the Data Dictionary needs updating — decide before you go further.

**Care Credit lifecycle.** The dictionary has a `status` column but does not define the
values. This build uses `available → reserved → consumed`, releasing back to `available`
when a booking is declined or cancelled. Add that to the manuscript so the code and the
document agree.

## Build order for the remaining modules

Each step depends on the ones above it, so going in order avoids rework.

1. **Psychologist verification** (Marinelle) — nothing on the counselor side is testable
   until an admin can flip `is_verified`. Needs Supabase Storage for license uploads.
2. **Anonymous Chat UI** (Noe) — the socket layer is done; build the conversation list,
   thread view, and the anonymity toggle.
3. **Appointment Requests + Psychologist Dashboard** (Marinelle, Joan) — the booking
   endpoints exist; these are the screens on top of them.
4. **Counseling Session** (Noe) — Jitsi embed keyed on `booking.room_name`, plus session
   notes. Jitsi is the only module with an external dependency you cannot stub.
5. **Mental Health Assessment** (Noe) — self-contained, good to hand to whoever is free.
6. **Voice Journal** (Noe) — record → upload to Storage → Whisper transcription →
   LLM emotion analysis → write a `crisis_alert` on high risk. Biggest module; start early.
7. **AI Crisis Companion** (Noe) — reuses the escalation path from step 6.
8. **Community Testimonials + moderation** (Joan, Marinelle).
9. **Wellness Resources + management** (Joan).
10. **LGU screens** (Marinelle, Christine) — endpoints exist, build heatmap, alerts,
    budget, wellness index, accomplishment report, psychologist directory.
11. **Admin screens** (Christine, Joan, Noe) — user management, LGU accounts,
    subscriptions, care credit segregation, appointment management, system settings.

## Manuscript items to reconcile

The ERD and Data Dictionary cover 14 tables, but the 38 modules in Table 8 need more.
`db/schema.sql` Section 2 adds: `conversation`, `message`, `availability`, `group_session`,
`group_participant`, `session_note`, `resource`, `ai_conversation`, `ai_message`,
`trusted_contact`, `crisis_alert`, `content_flag`, `accomplishment_report`,
`system_setting`, `audit_log`. Extend Figure 55 and Table 7 to include them before the
final defense, or a panelist will ask where Anonymous Chat stores its messages.
