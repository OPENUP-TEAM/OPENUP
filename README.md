# OpenUp

Web-based mental wellness and freelance counseling support system for Cebu City LGUs.
Built to the stack in Chapter III: React + Vite + Tailwind, Node + Express, Socket.IO,
Jitsi, Google Cloud Speech-to-Text, Supabase (PostgreSQL).

```
openup/
├── db/
│   ├── schema.sql           run first
│   ├── seed.sql             run second
│   ├── rls.sql              run third
│   ├── security-fixes.sql   run fourth
│   └── migrations/          run in numeric order
├── server/                  Express API + Socket.IO
└── client/                  React + Vite + Tailwind
```

## Setting up from scratch

**1. Database.** Create a Supabase project in the Southeast Asia (Singapore) region.
In the SQL Editor, run these files in order, pasting the contents of each:

| Order | File | What it does |
| --- | --- | --- |
| 1 | `db/schema.sql` | 29 tables, 4 analytics views |
| 2 | `db/seed.sql` | 18 Cebu City barangays, 4 test accounts |
| 3 | `db/rls.sql` | Enables RLS on every table |
| 4 | `db/security-fixes.sql` | Clears the Security Advisor criticals |
| 5 | `db/migrations/001_rejected_status.sql` | Separates rejected from suspended |
| 6 | `db/migrations/002_voice_journal.sql` | Journal pipeline state |
| 7 | `db/migrations/003_transcript_confidence.sql` | Stores recogniser confidence |

**2. Storage buckets.** Supabase → Storage → New bucket. Create two, both with
**Public bucket OFF**:

- `licenses` — PRC license documents
- `journals` — voice journal audio

Both hold personal data, so nothing is publicly reachable. Reads go through the
Express API, which checks authorisation and then mints a 5-minute signed URL.

**3. Server.**

```bash
cd server
npm install
cp .env.example .env
npm run verify     # checks env, connection, tables, views, seed data
npm run dev        # http://localhost:4000
```

`DATABASE_URL` is under Project Settings → Database → Connection string → URI. Use the
**Transaction pooler** on port 6543, not the direct connection — the direct one is
IPv6-only and will not resolve on most Philippine ISPs.

Generate `JWT_SECRET` with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**4. Client.**

```bash
cd client
npm install
npm run dev        # http://localhost:5173
```

Vite proxies `/api` and `/socket.io` to port 4000, so there is no CORS setup in
development.

**5. Test account passwords.** The hashes in `seed.sql` are placeholders. Set real
ones once:

```bash
cd server
npm run set-password -- --all OpenUp123!
```

| Email | Role |
| --- | --- |
| `juan@openup.ph` | Resident, Barangay Inayawan, alias "Blue Heron", 2 Care Credits |
| `maria.santos@openup.ph` | Psychologist, verified, ₱800/hr, Mon–Fri availability |
| `inayawan.lgu@openup.ph` | LGU |
| `admin@openup.ph` | Super Admin |

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the API with file watching |
| `npm run verify` | Check environment, database, tables, views, seed data |
| `npm run test:api` | 53 end-to-end API tests; creates and removes its own data |
| `npm run set-password -- <email> <pw>` | Reset one account, or `--all` |

Run `npm run test:api` in a second terminal with the server already running. It covers
the happy paths and the ones that matter more: that a wrong password and an unknown
email return the same error, that `/auth/me` does not leak the password hash, that one
resident cannot read another's moods or cancel their bookings, and that the LGU heatmap
contains no identity fields.

## Modules complete

Against Table 8 of the manuscript:

**Account Management** (Christine) — register as resident or psychologist, login, JWT
sessions, profile update, password change, consent recorded at sign-up.

**Mood Tracking** (Noe) — log, history, weekly trends. One entry per day; logging again
replaces it.

**Resident Dashboard** (Joan) — mood check-in, two-week trend, next session.

**Notifications** (Noe) — stored and pushed live over Socket.IO.

**Psychologist Verification** (Marinelle) — license upload to Storage, admin review
queue with three tabs, approve and reject with a required reason, audit logged.

**Counseling Booking** (Noe) — browse verified psychologists with language and
specialization filters, slots generated from availability minus existing bookings,
book, apply Care Credits, cancel.

**Appointment Requests** (Marinelle) — request queue, accept, decline, mark complete,
mark missed.

**Voice Journal** (Noe) — record, transcribe, emotion analysis, crisis escalation with
hotlines, emotion trends, playback, delete. Runs fully in mock mode; real transcription
needs a Google Cloud key.

**LGU analytics** (Marinelle, Joan) — dashboard, heatmap, wellness index, risk alerts,
budget, AI effectiveness. All served from aggregate SQL views, so no resident identity
leaves the database.

Backend only, no interface yet: **Anonymous Chat** (Socket.IO handlers exist; there is
no REST route to create a conversation, so a resident cannot start one).

## Decisions worth knowing about

**Custom auth, not Supabase Auth.** The Data Dictionary puts a `password` column on the
User table, so the server hashes with bcryptjs and issues its own JWTs. Supabase is used
as managed Postgres plus Storage. Switching to Supabase Auth would make user IDs UUIDs
and require rewriting Table 7.

**`bcryptjs`, not `bcrypt`.** The native `bcrypt` module compiles during install, which
npm 11 blocks by default and which needs Visual Studio Build Tools on Windows. `bcryptjs`
is pure JavaScript with an identical API and the same hash format.

**Four user statuses, not three.** Rejecting a psychologist first set `status =
'suspended'`, which the login route blocks — so a rejected applicant was locked out of
the screen showing them why, and could never upload a corrected license. Suspension is
enforcement; rejection is an outcome the applicant is expected to act on. They now have
separate statuses, and re-uploading a document returns the application to the review
queue.

**Care Credit lifecycle.** `available → reserved → consumed`, releasing back to
`available` when a booking is declined or cancelled. The Data Dictionary defines the
column but not the values; add these to the manuscript so the code and the document
agree.

**Residents appear to psychologists under their display alias.** A counselor deciding
whether to take a slot does not need a legal name, and the resident chose that alias so
they could ask for help without being identified.

**"Mark complete" only appears after the session time has passed.** Completing a session
consumes the resident's Care Credit permanently, so it must not be possible before the
session has happened.

**Crisis detection has two layers, and the second overrides the first.** A language model
classifies risk, and a deterministic keyword check over the same transcript can only ever
*raise* the risk level, never lower it. If the model times out, returns malformed JSON, or
under-rates a clear statement of intent, the floor still escalates. An API call should not
be the only thing between a resident and help.

**Crisis phrases live in one file.** `crisis-vocabulary.js` is read twice: as model
adaptation hints for the speech recogniser, and as the safety floor. Duplicating them
would let someone tune the recogniser for one wording while the floor checked another,
so a disclosure would transcribe correctly and still be missed.

**Hotlines arrive in the same response that raises the alert.** Tappable `tel:` links for
NCMH 1553, Hopeline, and 911, above everything else on the page, never auto-dismissed.
Telling someone in distress that help is coming and giving them nothing to do themselves
is worse than useless.

## Speech-to-text

`STT_PROVIDER` selects `google`, `openai`, or `mock`. With `MOCK_AI=true` the whole Voice
Journal pipeline runs on simulated transcripts, including crisis escalation, so the module
is fully buildable and demoable without any paid API.

**Google Cloud chirp_2 is the intended provider**, chosen over Whisper for one reason:
`chirp_2` supports model adaptation for `ceb-PH`, so the Bisaya crisis phrases the safety
floor depends on can be boosted directly in the recogniser. Whisper has no equivalent,
which means a garbled disclosure never reaches the keyword check at all. Cebuano is served
only from `asia-southeast1`, which is also the nearest region to Cebu.

Setup, when you are ready: enable the Cloud Speech-to-Text API, create a service account
with the **Cloud Speech Client** role, download a JSON key to `server/gcp-key.json`, then
set `GOOGLE_CLOUD_PROJECT`, `GOOGLE_APPLICATION_CREDENTIALS`, and `MOCK_AI=false`.

The Google Cloud free trial gives $300 valid for **90 days from signup**, which is roughly
300 hours of audio. A capstone uses a few hours. Sign up 6 to 8 weeks before defense so
the credit has not expired by then.

**Bisaya accuracy is a documented limitation, not a solved problem.** Record 20 Bisaya
entries and compare the transcripts to what you actually said — `003_transcript_confidence.sql`
ends with a query that reports mean confidence per language. A measured figure with a stated
mitigation is stronger than a claim that falls apart when a panelist asks for a Bisaya demo.

## Things that are not real yet

- **Trusted contact alerts are recorded, not sent.** Sending an SMS needs a gateway that
  is not wired up. The code writes an audit row and the interface says "recorded for
  follow-up" rather than claiming a message went out.
- **Join buttons point at `/app/session/:id`**, which does not exist. That is Counseling
  Session, the Jitsi module.
- **`maria.santos@openup.ph` is verified without a license document**, because the seed
  file sets the flag directly. Harmless, but she will not display correctly in the
  verification tabs.

## Security notes

- `.env` and `gcp-key.json` are gitignored. Run `git status` before every commit and
  confirm neither appears.
- The Supabase **service role key** and the Google **JSON key** both bypass all access
  control. Server only, never in `client/`, never committed.
- RLS is enabled on all 29 tables with no policies written. Supabase publishes every
  `public` table through PostgREST, which accepts the anon key — a key designed to be
  public. Without RLS, anyone holding it could read every password hash, journal
  transcript, session note, and crisis alert. Deny-all is correct here because the
  browser only ever talks to Express.
- The "RLS Enabled No Policy" warnings in the Security Advisor are expected and can be
  ignored. They mean the lockdown is working.
- **Never run `npm audit fix --force`.** It installs breaking major upgrades and would
  jump Express 4 to 5, breaking every route file.

## Build order for what remains

1. **Counseling Session** (Noe) — Jitsi keyed on `booking.room_name`, in-session
   messaging, session notes, emergency escalation. Now unblocked: confirmed bookings
   exist with room names generated. The only module with an external dependency that
   cannot be stubbed, so budget more testing time than the code suggests.
2. **Anonymous Chat UI** (Noe) — the socket layer is done. Needs a route to create a
   conversation, a conversation list, a thread view, and the anonymity toggle.
3. **AI Crisis Companion** (Noe) — reuses the escalation path from Voice Journal.
4. **Care Credits Segregation** (Christine) — independent of everything above, can run
   in parallel.
5. **Resource & Budget Management** (Christine), **Group Counseling** (Noe),
   **Subscription Monitoring** (Christine), **Appointment Management** (Noe).
6. **Tier 3 in parallel** (Joan) — Wellness Resources, Resources Management,
   Psychologist Directory, Psychologist Dashboard availability editor. No dependency on
   the above; should be running now rather than waiting.
7. **Tier 4 reporting last** — by then there is real transactional data to aggregate, so
   the reports can be verified rather than mocked. Write one export service and call it
   from all four modules that need "Export Report", rather than four implementations
   with four sets of bugs.

See `OpenUp_Module_Classification.docx` for the full tier breakdown of all 38 modules.

## Manuscript items to reconcile

- **The ERD is missing 15 tables.** Table 7 covers 14; the 38 modules need 29. Section 2
  of `schema.sql` adds `conversation`, `message`, `availability`, `group_session`,
  `group_participant`, `session_note`, `resource`, `ai_conversation`, `ai_message`,
  `trusted_contact`, `crisis_alert`, `content_flag`, `accomplishment_report`,
  `system_setting`, and `audit_log`. Extend Figure 55 and Table 7 before the final
  defense, or a panelist will ask where Anonymous Chat stores its messages.
- **Care Credit and booking status values** need defining in the Data Dictionary.
- **The `rejected` user status** is new and needs adding to Table 7.
- **AI Effectiveness Tracker has no programmer assigned** in Table 8.
- **Workload is unbalanced.** Noe owns 7 of the 12 Tier 1 modules including all four of
  the hardest; Joan owns none. Worth raising with your adviser while reassignment is
  still cheap.