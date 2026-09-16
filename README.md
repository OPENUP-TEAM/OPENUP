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
| `npm run test:crisis` | 17 cases against the crisis detection floor |
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
in-session chat, counselor notes, emergency escalation. Room opens 15 minutes before the
slot and closes 90 after.

**Anonymous Chat** (Noe) — start a conversation with or without choosing a counselor,
shared claim queue, live messaging and typing indicators over Socket.IO, one-way
anonymity toggle.

**AI Crisis Companion** (Noe) — conversational companion in English, Filipino or Bisaya,
per-message crisis detection, escalation to a human counselor, trusted contact records,
helpfulness rating. Runs in mock mode without an API key.

**Care Credits Segregation** (Christine) — allocate batches to a barangay, withdraw from
an unassigned pool, track distribution and utilization across every barangay.

**Resource & Budget Management** (Christine) — barangay pool, assign and reclaim credits
per resident, subscription costs, monthly spending, utilization.

**LGU analytics** (Marinelle, Joan) — dashboard, heatmap, wellness index, risk alerts,
budget, AI effectiveness. All served from aggregate SQL views, so no resident identity
leaves the database.

Against Table 8, that is **9 of the 12 Tier 1 transactional modules**. Remaining Tier 1:
Group Counseling, Subscription Monitoring, Appointment Management.

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

**Session notes are counselor-only.** A resident reading unfiltered clinical notes
mid-session changes what gets written, and what gets written is what makes the notes
useful later.

**A resident does not have to pick a counselor to start chatting.** Conversations can be
opened with nobody attached and land in a shared queue any verified psychologist can
claim, with a row lock so two counselors cannot claim the same thread. Forcing someone to
browse and choose a person before they can say anything is the friction the module exists
to remove.

**The anonymity toggle is one-way.** A resident can reveal their name but cannot re-hide
it, and the API says so plainly. Once a counselor has read the conversation, flipping a
switch would hide the name from the interface but not from the person who already saw it.

**The AI companion says it is not a counselor before you start.** A crisis bot that lets
someone believe they are talking to a professional is worse than no bot. Two escape
hatches — "talk to a person" and hotlines — are on screen before any message is sent,
regardless of what the model says.

**Escalating from the companion does not copy the conversation to the counselor.** What
someone told a machine at 3am is theirs to repeat or not. The counselor gets a person to
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

**Tier 1, three left:**

1. **Group Counseling** (Noe) — capacity limits and join races. The `group_session` and
   `group_participant` tables already exist.
2. **Subscription Monitoring** (Christine) — admin view of LGU subscriptions, payment
   status, plan changes. Credit allocation already depends on subscription status, so
   this closes that loop.
3. **Appointment Management** (Noe) — admin reassign and cancel, which must correctly
   unwind credits and payments.

**Then:**

4. **Tier 3 in parallel** (Joan) — Wellness Resources, Resources Management, Psychologist
   Directory, Psychologist Dashboard availability editor. No dependency on the above.
   Availability is currently only changeable through SQL, so the editor is the most
   useful of these.
5. **Tier 2** — Mental Health Assessment, Community Testimonials and moderation.
6. **Tier 4 reporting last** — by then there is real transactional data to aggregate, so
   the reports can be verified rather than mocked. Write one export service and call it
   from all four modules that need "Export Report", rather than four implementations with
   four sets of bugs.

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
