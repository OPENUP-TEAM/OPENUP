# OpenUp

Web-based mental wellness and freelance counseling support system for Cebu City LGUs.
Built to the stack in Chapter III: React + Vite + Tailwind, Node + Express, Socket.IO,
Jitsi, Google Cloud Speech-to-Text, Supabase (PostgreSQL).

**All 38 modules in Table 8 are implemented.**

```
openup/
├── db/
│   ├── schema.sql           29 tables, analytics views
│   ├── seed.sql             18 Cebu City barangays, 4 test accounts
│   ├── rls.sql              Row Level Security lockdown
│   ├── security-fixes.sql   clears the Security Advisor criticals
│   └── migrations/          001 to 007, run in order
├── server/                  Express API + Socket.IO, 28 route files
└── client/                  React + Vite + Tailwind, 45 screens
```

## Setting up from scratch

**1. Database.** Create a Supabase project in the Southeast Asia (Singapore) region. In
the SQL Editor, paste and run each file in this order:

| Order | File | What it does |
| --- | --- | --- |
| 1 | `db/schema.sql` | 29 tables, 4 analytics views |
| 2 | `db/seed.sql` | Barangays and test accounts |
| 3 | `db/rls.sql` | Enables RLS on every table |
| 4 | `db/security-fixes.sql` | Clears the Security Advisor criticals |
| 5 | `db/migrations/001_rejected_status.sql` | Separates rejected from suspended |
| 6 | `db/migrations/002_voice_journal.sql` | Journal pipeline state |
| 7 | `db/migrations/003_transcript_confidence.sql` | Recogniser confidence |
| 8 | `db/migrations/004_credit_pool.sql` | Barangay credit pool |
| 9 | `db/migrations/005_assessment.sql` | PHQ-9 and GAD-7 columns |
| 10 | `db/migrations/006_consent_aware_analytics.sql` | Consent-aware analytics views |
| 11 | `db/migrations/007_password_reset.sql` | Password reset tokens |

**2. Storage buckets.** Supabase → Storage → New bucket. Create three, all with
**Public bucket OFF**:

- `licenses` — PRC license documents
- `journals` — voice journal audio
- `resources` — wellness resource attachments

All three hold personal data, so nothing is publicly reachable. Reads go through the API,
which checks authorisation and then mints a short-lived signed URL.

**3. Server.**

```bash
cd server
npm install
cp .env.example .env
npm run verify
npm run dev
```

`DATABASE_URL` is under Project Settings → Database → Connection string → URI. Use the
**Transaction pooler** on port 6543; the direct connection is IPv6-only and will not
resolve on most Philippine ISPs.

Generate `JWT_SECRET` with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**4. Client.**

```bash
cd client
npm install
npm run dev
```

Vite proxies `/api` and `/socket.io` to port 4000, so there is no CORS setup in
development.

**5. Test account passwords.** The hashes in `seed.sql` are placeholders. Set real ones
once:

```bash
cd server
npm run set-password -- --all OpenUp123!
```

| Email | Role |
| --- | --- |
| `juan@openup.ph` | Resident, Barangay Inayawan, alias "Blue Heron", 2 Care Credits |
| `maria.santos@openup.ph` | Psychologist, verified, ₱800/hr, Mon–Fri |
| `inayawan.lgu@openup.ph` | LGU |
| `admin@openup.ph` | Super Admin |

## Working on this

**Stop both dev servers before copying files in.** Vite watches every file under `src`,
and copying while it runs can catch a half-written file, which crashes the watcher with
`EBUSY`. Then hard-refresh the browser with Ctrl+Shift+R; a normal refresh can serve
cached JavaScript.

**Commit after every module.** Restoring from Git is instant; rebuilding from memory is
not.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the API with file watching |
| `npm run verify` | Environment, connection, tables, views, seed data |
| `npm run check:storage` | The three Storage buckets exist and are private |
| `npm run check:sql` | Every query's `$N` placeholders are contiguous |
| `npm run test:api` | End-to-end API tests; creates and removes its own data |
| `npm run test:crisis` | Crisis detection floor against real phrasings |
| `npm run set-password -- <email> <pw>` | Reset one account, or `--all` |

`check:sql` exists because Postgres cannot infer the type of a placeholder that never
appears in the SQL. A query using `$1` and `$3` with three parameters passes a syntax
check and fails only when someone opens the page. One reached the accomplishment report
that way.

`test:crisis` needs no server. Add a case every time real testing turns up a phrasing the
floor missed.

## Modules

All 38 from Table 8. Grouped by who uses them.

**Resident.** Account Management, Resident Dashboard, Mood Tracking, Mental Health
Assessment (PHQ-9 and GAD-7), Voice Journal, AI Crisis Companion, Anonymous Chat,
Counseling Booking, Counseling Session, Group Counseling, Community Testimonials,
Wellness Resources, Notifications, and a Privacy screen covering consent and the right to
erasure.

**Psychologist.** Psychologist Dashboard with an availability editor and earnings,
Appointment Requests, Client Management with progress notes, Psychologist Reports with
CSV export, the crisis alert queue, Anonymous Chat, Group Counseling facilitation,
Counseling Session with notes and emergency escalation.

**LGU.** LGU Dashboard, Mental Health Heatmap with distress filters and period
comparison, Community Wellness Index, Barangay Risk Alerts with referral, Resource &
Budget Management, Psychologist Directory, AI Effectiveness Tracker, Data Governance &
Consent, Accomplishment Report with CSV and print.

**Admin.** Admin Dashboard, Psychologist Verification, User Management, Manage LGU
Accounts, Subscription Monitoring, Care Credits Segregation, Appointment Management,
Community Testimonials Moderation, Resources Management, AI Crisis Management, System
Settings, Reports & Analytics with exports.

## Decisions worth knowing about

These are the answers to "why is it like that", and most of them are the paragraphs worth
lifting into Chapter III.

### Architecture

**Custom auth, not Supabase Auth.** The Data Dictionary puts a `password` column on the
User table, so the server hashes with bcryptjs and issues its own JWTs. Supabase is
managed Postgres plus Storage. Switching to Supabase Auth would make user IDs UUIDs and
require rewriting Table 7.

**`bcryptjs`, not `bcrypt`.** The native module compiles during install, which npm 11
blocks by default and which needs Visual Studio Build Tools on Windows. Same API, same
hash format, no compiler.

**Four user statuses, not three.** Rejecting a psychologist first set `status =
'suspended'`, which the login route blocks, so a rejected applicant was locked out of the
screen telling them why. Suspension is enforcement; rejection is an outcome the applicant
is expected to act on. Re-uploading a document returns them to the review queue.

**One export service.** Four modules list "Export Report". Written four times that is
four CSV serialisers and four sets of quoting bugs. `export.service.js` handles commas in
"Basak, Pardo", embedded quotes, newlines inside fields, and writes a UTF-8 BOM so Excel
on a Philippine Windows install does not mangle peso signs or Bisaya text.

**Printing uses a print stylesheet, not server-generated PDFs.** No extra dependency, and
the document is what was on screen.

**Settings that do nothing are worse than no settings.** The session room window was
hardcoded in two route files. It now reads from `system_setting` through a cached service,
and saving invalidates the cache. A control that edits a row nothing reads tells an
administrator they changed something when they did not.

### Safety

**Crisis detection has two layers, and the second overrides the first.** A language model
classifies risk; a deterministic keyword check over the same text can only ever *raise*
the level. If the model times out, returns malformed JSON, or under-rates a clear
statement of intent, the floor still escalates. An API call should not be the only thing
between a resident and help.

**The vocabulary was wrong, and testing caught it.** The first version omitted `hikog`,
the ordinary Cebuano word for suicide. A real test typed *kuyog ta maghikod* and the floor
returned low risk. The list went from 22 severe phrases to 59, and `npm run test:crisis`
now guards every phrasing found so far. **This belongs in Chapter IV**: a documented false
negative in crisis detection for a low-resource language, with a fix and a regression
test, is a more interesting finding than "we implemented crisis detection".

**Crisis phrases live in one file.** `crisis-vocabulary.js` is read four times: as model
adaptation hints for the recogniser, and as the safety floor in the journal, the
companion, and community posts. Duplicating them would let someone tune the recogniser
for one wording while a floor checked another.

**Hotlines arrive in the same response that raises the alert.** Tappable `tel:` links,
above everything else, never auto-dismissed. Telling someone in distress that help is
coming and giving them nothing to do is worse than useless.

**The crisis panel has three states and tells the truth in each.** Someone online, offer
to connect. Nobody online but on duty, offer to leave a message and note the hotlines
answer immediately. Nobody at all, no connect button, just the numbers. A button saying
"talk to a psychologist now" at 2am sends someone into an empty room and teaches them the
app cannot help.

**Psychologist presence is tracked in memory, not the database.** A stale row claiming
someone is available is exactly the lie the panel exists to avoid. This assumes a single
server process; more than one would need Redis.

**The AI companion says it is not a psychologist before you start.** A crisis bot that
lets someone believe they are talking to a professional is worse than no bot. Two escape
hatches are on screen before any message is sent.

**Escalating from the companion does not copy the conversation.** What someone told a
machine at 3am is theirs to repeat or not. The psychologist gets a person to talk to, not
a transcript.

**Companion escalation fires once per conversation.** Otherwise every subsequent message
notifies every psychologist, and the alerts start being ignored. That is how a safety
feature quietly stops working.

**The PHQ-9 safety item is scored separately from the total.** Someone can answer "not at
all" to eight items, endorse thoughts of being better off dead on the ninth, and land in
the minimal band. Scoring on the total alone would let that pass silently.

### Privacy

**Residents appear to psychologists under their display alias.** A psychologist deciding
whether to take a Thursday slot does not need a legal name, and the resident chose that
alias so they could ask for help without being identified.

**Crisis alerts reach psychologists without what triggered them.** They need to know a
client is at risk; what he said into his phone at 3am stays his until he raises it.

**One psychologist cannot read another's notes about the same resident.** Every query is
scoped by `psychologist_id`. A resident consented to talking to one person, not to a
shared clinical file.

**Psychologists cannot start conversations, with one narrow exception.** Residents begin
chats, so nobody receives an unsolicited message from a stranger about their mental
health. An open crisis alert permits outreach, enforced on the server and refused once
the alert is resolved. The resident asked for it twice: the alert exists because of
something they wrote, and every path that raises one tells them a psychologist may reach
out.

**Outreach never reuses another psychologist's thread.** Two professionals appearing in
one person's crisis conversation is worse than one, so it refuses and names who is already
in contact.

**Consent withdrawal actually changes what the LGU sees.** Analytics views join
`v_analytics_consent`, so a resident who opts out disappears from the heatmap on the next
read. Before this, consent rows were written at sign-up and read by nothing.

**Consent is stored as history, not a flag.** Each change inserts a row, so grants and
withdrawals are both auditable, which is what RA 10173 requires.

**`data_use` cannot be withdrawn while keeping an account**, and the screen says so
rather than offering a toggle that silently fails.

**Barangay Risk Alerts inverts the direction of information.** Table 8 gives the LGU
"Manage Barangay Residents" and "Flag High-Risk Cases"; the Scope chapter says aggregate
only. Both hold because: alerts return barangay, risk level and date, never who;
residents are listed by name with registration and credit position and no mental health
data; and flagging is the barangay telling the system about someone they are worried
about, learning nothing back about whether the system already flagged them. A barangay
worker who visits houses knows things the app cannot see, and the app knows things the
barangay must not see.

**No CSV export contains a resident identifier.** An export is the easiest route for
clinical data to leave a system, so the column is simply not in the file.

**A psychologist with session history is anonymised on deletion, not erased.** Their
bookings are also the residents' records and the barangay's spending history. Personal
details and licence document go; the session rows survive without a name.

### Correctness

**Group session capacity is enforced under a row lock.** Counting seats outside a
transaction lets two residents both read "1 seat left" and both take it.

**Care Credit lifecycle:** `available → reserved → consumed`, releasing back to
`available` when a booking is declined or cancelled. Reclaim and withdraw only touch
unused credits; a reserved credit is holding a booked session.

**Reassigning an appointment leaves the Care Credit alone.** The resident is getting the
session their barangay paid for, with a different psychologist.

**"Mark complete" only appears after the session time has passed**, because completing a
session consumes the credit permanently.

**Care Credits are allocated to a barangay, not a person.** A platform administrator has
no basis for judging which household needs counseling. Allocation requires an active
subscription, which is what makes the business model coherent rather than decorative.

**Cancelling a subscription does not claw back issued credits.** A lapsed payment stops
new allocation; it does not take away sessions residents are counting on.

**Counseling rooms have a time window.** Public `meet.jit.si` rooms admit anyone who
knows the name, so the name alone cannot be the only protection. Proper access control
needs a self-hosted Jitsi with JWT auth, which is outside a capstone budget — document
this in Scope and Limitations.

**Sessions are audio-first with the camera off.** The module is "Join Audio Session",
video costs bandwidth many barangay residents do not have, and people find it easier to
talk without a camera on.

**Suspension takes effect on the next request.** `requireAuth` re-reads status from the
database rather than trusting the JWT, so a psychologist behaving badly in chat stops
immediately rather than after seven days.

**The last active administrator cannot be suspended, demoted, or self-deleted.**

**Reporting community content does not hide it.** Auto-hiding would let anyone silence a
post they disliked, which on a mental health board means silencing someone struggling in
public. One moderation decision settles every report against the same content.

### Honesty in reporting

**Detection accuracy is measured only over alerts a psychologist reviewed and judged.**
The resolve dialog asks whether the concern was real, and that answer is the only ground
truth in the system. Precision is withheld below ten reviewed alerts, because a
percentage over three cases is noise.

**There is no recall figure, and the screen says so.** A resident in danger who was never
detected leaves no record. Reporting precision while silently omitting that would flatter
the system.

**Attendance and completion rates appear only over a sample large enough to mean
something.** A rate over two sessions says nothing.

**Resolution asks about the concern, not the outcome.** Someone genuinely in danger who
declines a session is a correct detection and a declined offer, not a false positive.
Conflating them would make the system look accurate by punishing residents for saying no.

**A barangay with no mood entries is flagged as having no data, not scored as well.** An
empty month is not a good month, and a heatmap that shades silence green would mislead
exactly the person trying to decide where to send help.

**Badges count outstanding work, not unread items, except where they count unread
items.** Unread clears on reading; work clears on doing. Maria's Alerts badge drops when
she resolves an alert, not when she opens the page — if it cleared on open she would see 0
with three alerts unhandled.

**The rate limiter used to cover `/auth/me`**, which every page load calls, so ordinary
use burned the login quota and locked people out. Now only endpoints that accept a
password are limited, and only failures count. A security control that locks out
legitimate users is worth writing up.

**Password reset returns the same response whether the email exists or not.** Saying "no
account with that email" turns the form into a way to discover who uses a mental health
service.

## Speech-to-text

`STT_PROVIDER` selects `google`, `openai`, or `mock`. With `MOCK_AI=true` the whole Voice
Journal pipeline runs on simulated transcripts, including crisis escalation, so the module
is fully demoable without any paid API.

**Google Cloud `chirp_2` is the intended provider**, chosen over Whisper for one reason:
it supports model adaptation for `ceb-PH`, so the Bisaya crisis phrases the safety floor
depends on can be boosted in the recogniser. Whisper has no equivalent, which means a
garbled disclosure never reaches the keyword check. Cebuano is served only from
`asia-southeast1`, also the nearest region to Cebu.

Setup: enable the Cloud Speech-to-Text API, create a service account with the **Cloud
Speech Client** role, download a JSON key to `server/gcp-key.json`, then set
`GOOGLE_CLOUD_PROJECT`, `GOOGLE_APPLICATION_CREDENTIALS`, and `MOCK_AI=false`.

The Google Cloud free trial gives $300 valid for **90 days from signup** — roughly 300
hours of audio, against a capstone's few hours. Sign up 6 to 8 weeks before defense so
the credit has not expired.

**Bisaya accuracy is a documented limitation, not a solved problem.** Record 20 Bisaya
entries and compare the transcripts to what was said;
`003_transcript_confidence.sql` ends with a query reporting mean confidence per language.
A measured figure with a stated mitigation is stronger than a claim that collapses when a
panelist asks for a Bisaya demo.

## Things that are not real yet

- **Mock mode is fake, not a working model.** The companion picks from a list of replies
  keyed to risk level; it does not read what was written. Fine for demonstrating the
  pipeline, but do not present it as working AI. About ₱50 on an `OPENAI_API_KEY` makes
  the companion and the journal's emotion analysis real, independently of the Google
  speech credit.
- **Password reset links are printed to the server console** until an email provider is
  set. A launch blocker, not a development one.
- **Trusted contact alerts are recorded, not sent.** No SMS gateway is wired up.
- **Nothing reviews psychologist conduct in private chat.** Moderation covers resident
  posts and comments. A psychologist replying badly can only be dealt with by suspension
  through User Management, and only if someone reports it out of band. Worth naming as a
  limitation in Chapter V.
- **`maria.santos@openup.ph` is verified without a license document**, because the seed
  sets the flag directly. She will not display correctly in the verification tabs.

## Security notes

- `.env` and `gcp-key.json` are gitignored. Run `git status` before every commit.
- The Supabase **service role key** and the Google **JSON key** both bypass all access
  control. Server only, never in `client/`, never committed.
- RLS is enabled on all tables with no policies written. Supabase publishes every
  `public` table through PostgREST, which accepts the anon key — a key designed to be
  public. Without RLS, anyone holding it could read every password hash, journal
  transcript, session note, and crisis alert. Deny-all is correct because the browser only
  ever talks to Express.
- The "RLS Enabled No Policy" warnings in the Security Advisor are expected. They mean the
  lockdown is working.
- Reset tokens are stored as a SHA-256 hash. The token exists in the emailed URL and
  nowhere else, so a leaked database hands nobody a working link.
- **Never run `npm audit fix --force`.** It installs breaking major upgrades and would
  jump Express 4 to 5, breaking every route file.

## Manuscript items to reconcile

- **The ERD is missing 15 tables.** Table 7 covers 14; the system uses 29. Section 2 of
  `schema.sql` adds `conversation`, `message`, `availability`, `group_session`,
  `group_participant`, `session_note`, `resource`, `ai_conversation`, `ai_message`,
  `trusted_contact`, `crisis_alert`, `content_flag`, `accomplishment_report`,
  `system_setting`, `audit_log`, plus `password_reset` from migration 007. Extend Figure
  55 and Table 7 before the final defense, or a panelist will ask where Anonymous Chat
  stores its messages.
- **Undefined values need defining in the Data Dictionary:** Care Credit status, booking
  status, and the new `rejected` user status.
- **Schema changes to add to Table 7:** `assessment` gained `instrument`, `severity`,
  `max_score`, `flagged_item`; `care_credit` gained a nullable `resident_id` plus
  allocation columns; `voice_journal` gained `status`, `language`, `duration_sec`,
  `emotion_scores`, `risk_score`, `transcript_confidence`, `error_detail`.
- **Add "psychologist" to the Definition of Terms**, defined as a professional licensed by
  the PRC under RA 10029, and use it consistently through Chapters I to V. Guidance
  counselors are a separate profession under RA 9258 and are not supported. "Counseling"
  is kept for the activity, since it names four modules in Table 8.
- **Cite the assessment instruments.** PHQ-9 (Kroenke, Spitzer & Williams, 2001) and
  GAD-7 (Spitzer et al., 2006), and say which language version was used. Item wording is
  part of what was validated, so a machine translation into Bisaya would look like the
  instrument while having no validated cut-offs behind it. English only, stated honestly.
- **AI Effectiveness Tracker has no programmer assigned** in Table 8.
- **Be ready for the supply question.** There are relatively few licensed psychologists in
  Cebu. "The platform is designed for psychologists; extending it to guidance counselors
  under RA 9258 is future work" is a better answer than being caught without one.

## Before the defense

- **Seed realistic activity.** An accomplishment report over five mood entries and no
  completed sessions looks broken. A few months of plausible data across several
  barangays, generated before the day, makes every Tier 4 report demonstrable.
- **Demo one chain, not fifteen screens.** Resident books with a Care Credit →
  psychologist accepts → admin sees it in Appointments → the credit moves from available
  to consumed. Then one safety path: take the PHQ-9 answering "not at all" to everything
  except item nine, and watch the crisis panel fire on a total of 1 out of 27.
- **Fix the test data.** `Mike Cebekol` is verified with a ₱0 rate. Set a rate or suspend
  the account.
- **Weak wifi breaks uploads first.** Voice recording, licence documents and resource
  attachments all go through Supabase Storage. Text paths — booking, chat, mood, companion
  — survive a bad connection. If the venue's wifi is unreliable, demo a text-only resource.
