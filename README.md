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
| 8 | `db/migrations/004_credit_pool.sql` | Barangay credit pool, distribution view |
| 9 | `db/migrations/005_assessment.sql` | PHQ-9 and GAD-7 scoring columns |

**2. Storage buckets.** Supabase → Storage → New bucket. Create two, both with
**Public bucket OFF**:

- `licenses` — PRC license documents
- `journals` — voice journal audio
- `resources` — wellness resource attachments

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
| `npm run test:crisis` | 17 cases against the crisis detection floor |
| `npm run check:storage` | Verifies the three Storage buckets exist and are private |
| `npm run set-password -- <email> <pw>` | Reset one account, or `--all` |

Run `npm run test:api` in a second terminal with the server already running. It covers
the happy paths and the ones that matter more: that a wrong password and an unknown
email return the same error, that `/auth/me` does not leak the password hash, that one
resident cannot read another's moods or cancel their bookings, and that the LGU heatmap
contains no identity fields.

`npm run test:crisis` needs no server. It checks the deterministic crisis floor against
real phrasings, including ones that testing caught it missing. Add a case every time a
new one turns up.

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

**Counseling Session** (Noe) — Jitsi room keyed on `booking.room_name`, audio-first,
in-session chat, psychologist notes, emergency escalation. Room opens 15 minutes before the
slot and closes 90 after.

**Anonymous Chat** (Noe) — start a conversation with or without choosing a psychologist,
shared claim queue, live messaging and typing indicators over Socket.IO, one-way
anonymity toggle.

**AI Crisis Companion** (Noe) — conversational companion in English, Filipino or Bisaya,
per-message crisis detection, escalation to a human psychologist, trusted contact records,
helpfulness rating. Runs in mock mode without an API key.

**Care Credits Segregation** (Christine) — allocate batches to a barangay, withdraw from
an unassigned pool, track distribution and utilization across every barangay.

**Resource & Budget Management** (Christine) — barangay pool, assign and reclaim credits
per resident, subscription costs, monthly spending, utilization.

**LGU analytics** (Marinelle, Joan) — dashboard, heatmap, wellness index, risk alerts,
budget, AI effectiveness. All served from aggregate SQL views, so no resident identity
leaves the database.

**Group Counseling** (Noe) — browse and join sessions, capacity enforced under a row
lock so two residents cannot take the last seat, facilitator creates and cancels.
Participants join the room under their aliases.

**Subscription Monitoring** (Christine) — plans, payment status, renewal, cancellation.
Credit allocation depends on an active subscription, so a lapsed payment has real
consequences.

**Appointment Management** (Noe) — every booking on the platform, reassignment to a
psychologist who is actually free and working that day, cancellation that returns the
Care Credit and refunds the payment row.

**Psychologist Dashboard** (Joan) — weekly availability editor, upcoming sessions,
earnings by month. Availability was previously only changeable through SQL.

**Mental Health Assessment** (Noe) — PHQ-9 and GAD-7, one question per screen, scoring
with validated cut-offs, history and trend. The PHQ-9 safety item is handled separately
from the total.

**Wellness Resources** (Joan) — browse, search by category, read in-app, download.

**Resources Management** (Joan) — drafts and published, attachments, publish toggle.

**User Management** (Christine) — search and filter, suspend and reactivate with a
reason, delete with typed confirmation.

**Manage LGU Accounts** (Christine) — one account per barangay, generated passwords shown
once, password reset.

**Community Testimonials** (Joan) — anonymous-by-default posts, comments, edit and delete,
reporting.

**Community Testimonials Moderation** (Marinelle) — review queue, keep or remove, one
decision settles every report against the same content.

Against Table 8, that is **all 12 Tier 1 transactional modules**, plus most of Tier 2 and
Tier 3. Roughly **25 of 38 modules** are complete.

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

**Residents appear to psychologists under their display alias.** A psychologist deciding
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

**Crisis phrases live in one file.** `crisis-vocabulary.js` is read three times: as model
adaptation hints for the speech recogniser, as the Voice Journal safety floor, and as the
companion safety floor. Duplicating them would let someone tune the recogniser for one
wording while a floor checked another, so a disclosure would transcribe correctly and
still be missed.

**The vocabulary was wrong, and testing caught it.** The first version was built around
phrases like *magpakamatay* and *dili na ko gusto mabuhi* and omitted `hikog`, the
ordinary Cebuano word for suicide. A real test typed *kuyog ta maghikod* and the floor
returned low risk. The list went from 22 severe phrases to 59, and `npm run test:crisis`
now guards every phrasing found so far. This is worth writing up in Chapter IV: it is a
documented false negative in crisis detection for a low-resource language, with a fix and
a regression test, which is a more interesting finding than "we implemented crisis
detection".

**Counseling rooms have a time window.** Public `meet.jit.si` rooms admit anyone who
knows the name, so the name alone cannot be the only protection. The window means a
leaked room name is not a permanent back door into a counseling room. Proper access
control needs a self-hosted Jitsi with JWT auth, which is outside a capstone budget —
document this in Scope and Limitations.

**Sessions are audio-first with the camera off.** The module is "Join Audio Session",
video costs bandwidth many barangay residents do not have, and people find it easier to
talk about mental health without a camera on.

**In-session messaging uses Jitsi's own chat**, so messages stay inside the call rather
than being stored on the server. A deliberate privacy choice, not a shortcut.

**Session notes are psychologist-only.** A resident reading unfiltered clinical notes
mid-session changes what gets written, and what gets written is what makes the notes
useful later.

**A resident does not have to pick a psychologist to start chatting.** Conversations can be
opened with nobody attached and land in a shared queue any verified psychologist can
claim, with a row lock so two psychologists cannot claim the same thread. Forcing someone to
browse and choose a person before they can say anything is the friction the module exists
to remove.

**The anonymity toggle is one-way.** A resident can reveal their name but cannot re-hide
it, and the API says so plainly. Once a psychologist has read the conversation, flipping a
switch would hide the name from the interface but not from the person who already saw it.

**The AI companion says it is not a psychologist before you start.** A crisis bot that lets
someone believe they are talking to a professional is worse than no bot. Two escape
hatches — "talk to a person" and hotlines — are on screen before any message is sent,
regardless of what the model says.

**Escalating from the companion does not copy the conversation to the psychologist.** What
someone told a machine at 3am is theirs to repeat or not. The psychologist gets a person to
talk to, not a transcript.

**Companion escalation fires once per conversation.** Without that, every subsequent
message would notify every psychologist on the platform and the alerts would start being
ignored, which is how a safety feature quietly stops working.

**Care Credits are allocated to a barangay, not to a person.** An administrator allocates
a batch; the barangay decides who receives them. A platform admin has no basis for judging
which household needs counseling. Allocation also requires an active subscription, which
is what makes the business model coherent rather than decorative.

**Reclaim and withdraw only touch unused credits.** A reserved credit is holding a booked
session; pulling it back would cancel an appointment without telling anyone.

**Group session capacity is enforced under a row lock.** Counting seats outside a
transaction lets two residents both read "1 seat left" and both take it, leaving a
session for ten quietly holding twelve.

**Assessment uses PHQ-9 and GAD-7, not invented questions.** A made-up questionnaire
produces a number with no validated cut-offs behind it, so "you scored 14" cannot be
interpreted. Cite Kroenke, Spitzer and Williams (2001) and Spitzer et al. (2006).

**The PHQ-9 safety item is scored separately from the total.** Someone can answer "not at
all" to eight items, endorse thoughts of being better off dead on the ninth, and land in
the minimal band. Scoring on the total alone would let that pass silently.

**Assessments are English only, deliberately.** Item wording is part of what was
validated. A machine translation into Bisaya would look like the instrument while having
no validated cut-offs behind it, which is worse than not offering it.

**Reporting community content does not hide it.** The post stays visible, marked as
flagged, until a person decides. Auto-hiding would let anyone silence a post they
disliked, which on a mental health board means silencing someone struggling in public.

**Suspension takes effect on the next request, not when the token expires.** requireAuth
re-reads status from the database rather than trusting the JWT, so a psychologist behaving
badly in chat stops immediately rather than after seven days.

**The last active administrator cannot be suspended**, and nobody can change their own
status. Both are easy to do by accident and lock everyone out of the platform.

**LGU passwords are generated and shown once.** An administrator setting passwords by hand
across eighteen barangays ends up reusing one memorable string.

**Psychologist presence is tracked in memory, not the database.** The crisis panel says how
many psychologists are online right now, and a stale row claiming someone is available is
exactly the lie that would send a person in distress into an empty room. This assumes a
single server process; more than one would need Redis.

**The crisis panel has three states and tells the truth in each.** Someone online, offer to
connect. Nobody online but on duty, offer to leave a message and note the hotlines answer
immediately. Nobody at all, no connect button, just the numbers.

**"Psychologist", not "psychologist".** The system verifies PRC licenses under RA 10029, so
the people it verifies are psychologists. Guidance psychologists are a separate profession
under RA 9258 and are not supported. "Counseling" is kept for the activity, since it is
also the name of four modules in Table 8.

**Unbuilt pages show "Not built yet", not the landing page.** A missing child route in
React Router falls through to the global catch-all, and being redirected to the public
site looks exactly like being signed out. Each role's shell now has its own catch-all.

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
- **Mock mode is fake, not a working model.** The companion picks from a list of replies
  keyed to risk level; it does not read what was written. Fine for demonstrating the
  pipeline, but do not present it as working AI — anyone who types two unrelated
  sentences will see the seams. About ₱50 on an OpenAI key makes the companion and the
  journal's emotion analysis real, independently of the Google speech credit.
- **`maria.santos@openup.ph` is verified without a license document**, because the seed
  file sets the flag directly. Harmless, but she will not display correctly in the
  verification tabs.
- **Nothing reviews psychologist conduct in chat.** Moderation covers resident posts and
  comments. A psychologist replying badly to a resident in a private chat can only be
  dealt with by suspending the account through User Management, and only if someone
  reports it out of band. Worth naming as a limitation in Chapter V.
- **Trusted contact alerts are recorded, not sent.** No SMS gateway is wired up.

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

All Tier 1 is done. Thirteen modules remain, and most are reporting.

1. **Psychologist Directory** (Joan) — read-only listing for LGU accounts. Small.
2. **Client Management** (Marinelle) — a psychologist's own clients, session history,
   progress notes. The `session_note` table and the notes panel already exist.
3. **System Settings** (Christine) — the `system_setting` table already drives crisis
   hotlines and the AI escalation threshold, both currently only editable through SQL.
4. **AI Crisis Management** (Noe) — escalation rules and emergency contacts, which is the
   admin face of the same settings.
5. **Data Governance & Consent** (Christine) — consent records are written at sign-up but
   nothing reads them back.
6. **The ten Tier 4 reports.** Write one export service first and call it from all four
   modules that need "Export Report", rather than four implementations with four sets of
   bugs. There is now real transactional data to aggregate, so these can be verified
   rather than mocked.

Before the defense, seed a few months of plausible activity across several barangays.
An accomplishment report over five mood entries and no completed sessions looks broken.

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
- **Add "psychologist" to the Definition of Terms**, defined as a professional licensed by
  the PRC under RA 10029, and use it consistently through Chapters I to V.
- **Cite the assessment instruments.** PHQ-9 and GAD-7 both need references, and the
  manuscript should say which language version was used.
- **The `assessment` table gained `instrument`, `severity`, `max_score` and
  `flagged_item`**; `care_credit` gained a nullable `resident_id` plus allocation columns.
  Both need updating in Table 7.
- **Workload has flipped.** Noe carried the critical path and has one module left. Most of
  what remains is Marinelle's, and six of her outstanding modules are Tier 4 reports that
  all need the same export capability. Building that once and sharing it is the difference
  between one afternoon and six.
