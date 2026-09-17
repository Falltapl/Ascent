# Decision log

Why this is built the way it is. Written as decisions were made, not reconstructed after.

---

## 1. Which integrations are actually possible

Every claim below was tested against the live service before any code was written.

| Service | Verdict | Evidence |
|---|---|---|
| Canvas (UTA) | Full REST API | `uta.instructure.com/api/v1/users/self` → `401 {"status":"unauthenticated"}` — alive, needs a token |
| AWS certifications | Yes, **via Credly** | `credly.com/users/<handle>/badges.json` → `200` with `issued_at_date` / `expires_at_date` |
| Coursera | Catalog only | `api.coursera.org/api/courses.v1?q=slug&...` → `200`; progress endpoints are enterprise-gated |
| Apple Calendar | Read-only for v1 | EventKit probe compiled and ran; `caldav.icloud.com` → `401` (live, wants credentials) |

### AWS has no certification API

AWS publishes nothing — not CertMetrics (the certification portal), not Skill Builder. What it *does*
do is issue every certification as a Credly badge, and Credly exposes an unauthenticated public JSON
feed per user. That is the only real integration surface, and it's a good one: it carries the issue
date and the three-year expiry, so the recertification clock maintains itself.

The catch is that a badge only exists **after** you pass. There is no API for *studying*. So study
progress is modelled locally against the published exam-guide domains — which turns out better than
an API would have been, because those domains have official scored weightings (see §3).

### Coursera progress is enterprise-only

The Catalog API is public and works. The learner progress and gradebook endpoints require OAuth
issued to a Coursera for Business / Campus / Government account. An individual learner account has
no path to them.

Scraping with a session cookie was considered and rejected: it breaks on any markup change and it
violates their terms. Instead the catalog fills in the name, description, and workload estimate from
a pasted URL, and module completion is a local counter. Cheap to maintain, honest about what it is.

### Apple Calendar: local read, not a published feed

Three routes existed. A Swift EventKit helper was compiled and run to test the most capable one:

```
GRANTED? no → DENIED: calendar access not granted
```

That denial was **not** a user refusal — no dialog ever appeared. macOS TCC attributes a request from
an unbundled CLI binary to its parent process, which here was the host app, and that has no Calendar
entitlement. The fix is either a signed bundle or granting the launching app Calendar access.

The published-`webcal://` route avoids TCC entirely, but it has a cost that only becomes obvious when
you read what "Public Calendar" actually does: it uploads the calendar to Apple's servers at a URL
that requires no authentication. Obscure, but public. That is a poor default for someone's class and
personal schedule.

So EventKit is the primary path after all, with the permission handled rather than avoided. The
helper (`native/calfetch.swift`, built by `npm run build:native`) prints JSON and degrades to
`{ok:false, reason}` instead of hanging, and the server turns each reason into an instruction —
`access_denied` becomes "grant Calendar access to the terminal you started the app from." Launched
from a terminal, that terminal owns the prompt and the grant sticks.

The ICS feed remains as a documented fallback for anyone who would rather publish than grant, and the
UI labels it honestly as "publicly readable by anyone with the URL" rather than presenting the two as
equivalent. Two-way sync via CalDAV with an app-specific password is still the upgrade path and needs
no schema change — `cal_events` already has everything.

---

## 2. Canvas must be proxied, and that is a feature

Canvas returns **no CORS headers**, so a browser cannot call it directly. Everything goes through the
Express server.

This was going to be the design anyway. A Canvas token is a full-account credential — it can read
grades and submit work — and it has no business being in client-side JavaScript. It stays in `.env`,
server-side, gitignored from the first commit.

The proxy also handles pagination properly. Canvas paginates with RFC-5988 `Link` headers rather than
page counts, so following `rel="next"` is the only correct way to read a full list; a naive
`?page=1&page_size=100` silently truncates. Assignments are fetched with `include[]=submission` so
submission state arrives in the same request instead of fanning out N+1 calls per assignment.

Rate limits are not a concern: UTA's response advertises `rlr=700.0` with `x-request-cost: 0.016`,
so a full sync costs a rounding error against the bucket.

**UTA may block student tokens.** Some institutions disable student token generation because tokens
expose FERPA-protected data. If that button is missing from Canvas settings, `CANVAS_ICS_URL` reads
the per-user calendar feed instead — every due date, no token, read-only. The app detects which mode
it is in and says so in the UI rather than silently degrading.

### What the real sync exposed

Connecting the live token surfaced two things no amount of reading docs would have:

**Canvas keeps every past enrollment "active".** An unfiltered `enrollment_state=active`
query returned 17 courses and 320 assignments — years of finished semesters, plus
non-academic org shells (advising, compliance, career services) sitting in a dateless
"Default Term". 213 of those read as *open*, which would have rendered the dashboard
useless. Filtering to courses whose term is currently running cuts it to 5 courses and
51 assignments, and drops sync time from 19s to under 4s.

**`submitted_at` is the wrong completion signal.** Work handed in on paper or graded
manually carries a score and a `graded_at` but no submission timestamp:

```
Pop Quiz 1 - On Paper   submitted_at: null   score: 2   workflow_state: graded
```

Keying off `submitted_at` marked already-graded work as overdue. Canvas's own
`workflow_state` is authoritative — only `unsubmitted` means open. Fixing this took
overdue from 3 to 1, and the survivor is genuinely unsubmitted.

Course names also arrive as `2268-INSY-4321-001-MOBILE APP DEVELOPMENT`, so they're
parsed into `INSY 4321 · Mobile App Development`, with a small abbreviation list so
"STATS FOR BA" doesn't title-case into the nonsense "Stats For Ba".

---

## 3. Progress bars that mean something

The reason a gamified design works here rather than being decoration: both target exams publish
their domain weightings, and they are not uniform.

| CLF-C02 | | SAA-C03 | |
|---|---|---|---|
| Cloud Concepts | 24% | Design Secure Architectures | 30% |
| Security and Compliance | 30% | Design Resilient Architectures | 26% |
| Cloud Technology and Services | 34% | Design High-Performing Architectures | 24% |
| Billing, Pricing, and Support | 12% | Design Cost-Optimized Architectures | 20% |

So readiness is a weighted sum, not an average:

```
readiness = Σ(weight × confidence) / Σ(weight)
```

Being strong on Billing (12%) moves the needle far less than being strong on Cloud Technology (34%),
which is exactly how the real exam scores. The predicted number is then mapped onto the actual
100–1000 scaled-score range, and the pass threshold (700 / 720) is drawn as a line at its true
position on the bar. Verified: raising SAA domain 3 from 25→75 moved readiness 31%→43%, precisely
its 24% weight × 50 points.

---

## 4. XP tuned so it can't be farmed

The failure mode of a gamified tracker is that clicking becomes worth more than working.

- Study minutes are **capped at 180/day**, so one marathon session cannot inflate what a streak is
  worth, and the cheapest path to XP stays "study regularly."
- Levels scale superlinearly (`100 × level^1.35`) so early levels arrive fast and later ones take
  real work.
- A streak does not break until midnight — today being unlogged shows a warning, not a reset.
- Completing a goal is worth 200 XP, more than any single click, because finishing things is the
  point.

---

## 5. Stack

- **Node 24 + React 19 + Vite 8 + TypeScript + Tailwind 4.** Node was installed user-local
  (`~/.local/node`) from the official arm64 tarball with its SHA-256 verified, so no `sudo` and no
  Homebrew dependency.
- **`node:sqlite`**, built into Node 22+, so the database has zero native dependencies — nothing to
  rebuild, nothing to break on upgrade. The file is plain SQLite and opens in any browser tool.
- **One `/api/state` call** renders the whole dashboard. At this data volume it is one fast query set,
  and it removes a class of loading-state bugs entirely.
- **Canvas data is cached in SQLite**, so the app renders instantly and still works when Canvas is
  down or the token is absent.

---

## 6. The built-in assistant

An "Ask" tab backed by the Claude API (`claude-opus-5`), for general knowledge questions without
leaving the app.

**Streaming, because it's a chat UI.** A non-streaming call would sit silent for the whole
generation. Reasoning is requested with `display: "summarized"` — the API default is `"omitted"`,
which returns empty thinking blocks and makes the UI look frozen before the first token.

**Effort is `medium`, not the default `high`.** Effort trades thoroughness for tokens and latency.
Coding and long-horizon agentic work repay the top of the range; chat generally does not. It's a
parameter on the request, so any route that needs more can ask for it.

**The system prompt is frozen and cached; progress is not part of it.** Prompt caching is a prefix
match — one byte of drift anywhere in the prefix invalidates everything after it. Injecting live
assignment and readiness numbers into the system prompt would bust the cache on literally every
turn. Instead the stable instructions carry `cache_control` and the volatile snapshot is appended as
a mid-conversation `{role: "system"}` message, which sits after the cached prefix and carries
operator authority rather than arriving as user text. `cache_read_input_tokens` is surfaced under
each reply so the cache can be seen working.

**Context sharing is a visible toggle**, defaulting on but switchable per conversation — the
assistant shouldn't silently ship coursework and goals to an API for a question about the TCP
handshake.

**Markdown is rendered to React elements, never `dangerouslySetInnerHTML`.** Model output is
untrusted input like any other. Verified with an `<img onerror=...>` payload: it renders as literal
text and does not execute.

**Two providers, one prompt.** Claude (`claude-opus-5`) and Gemini (`gemini-3.8-flash`) sit behind a
small registry; whichever has a key becomes active, and with both set the header offers a switch.
The system prompt and progress snapshot live in `assistant/shared.ts` so the only difference between
providers is transport, not behaviour. The two differ in one way that matters: Claude accepts a
mid-conversation `{role: "system"}` message, so volatile context lands *after* the cached prefix;
Gemini has no such role, so the snapshot is appended to the final user turn inside a
`<current_progress>` tag, leaving `systemInstruction` byte-stable for implicit caching. Effort maps
onto each provider's own knob — Anthropic's `output_config.effort`, Google's `thinkingLevel`.

Provider errors are flattened to one sentence before reaching the UI. Google nests a JSON string
inside a JSON error envelope; raw, an invalid key rendered as forty lines of escaped braces.

**A bug worth recording.** Cancellation was first written as `req.on('close')`. On a POST, `req`
emits `close` as soon as the request *body* has been read — which is before streaming starts — so
every request was flagged aborted, the loop broke on the first chunk, and the response never ended:
empty replies and a hung connection. The signal has to be `res.on('close')`, with `res.writableEnded`
separating a finished response from a dropped socket. It only surfaced because the error path was
timed rather than eyeballed.

---

## 7. Inbox triage

An Inbox tab that pulls school mail and sorts it into critical / important / routine / noise, so a
class cancellation is not buried under club newsletters.

**Password auth to a university mailbox no longer exists.** Microsoft disabled Basic Authentication
for Exchange Online; IMAP and POP still work but only over OAuth 2.0. So there is no app-password
shortcut for a Microsoft 365 mailbox — OAuth or nothing.

**UTA blocks it.** Graph Explorer signed in fine with the UTA account and `GET /me` returned 200 —
so the tenant does issue delegated tokens — but `GET /me/messages` returns **403**. `Mail.Read` is
consented separately from `User.Read`, and UTA denies it to students. The Graph source below is kept
for other tenants, or if that policy changes, but it is not the working path here.

**Gmail is the live source.** OAuth 2.0 with a loopback redirect to `http://localhost:8787`, which
this server already answers, so nothing needs hosting.

*Scope choice:* `gmail.metadata` is the tighter scope and was the first choice, but it excludes the
message snippet — and subject lines alone misclassify badly ("Re: your question" tells you nothing).
So `gmail.readonly` is requested and every call asks for `format=metadata`. The scope permits more
than the code uses; bodies are never requested and never stored.

*The 7-day trap:* Google issues refresh tokens that expire after **7 days** while an OAuth app sits
in "Testing" publishing status, which would mean reconnecting weekly forever. Setting the app to
"In production" — unverified is fine for personal use — makes them permanent. The refresh handler
detects `invalid_grant` and says exactly this rather than reporting a generic auth failure.

*The gap this leaves:* professors email the `@mavs.uta.edu` address, so Gmail alone does not carry
the messages this feature exists for. Closing it means either forwarding UTA mail into Gmail, or
signing into Outlook desktop and reading its local database.

**Device-code flow, not a redirect** (Graph, retained but blocked here). An authorization-code flow needs a hosted redirect URI and
usually a client secret. Device code needs neither: the app prints a short code, the user enters it
at a Microsoft URL, and the token poll completes. Right shape for a tool running on localhost. The
one prerequisite is a free app registration with public client flows enabled and delegated
`Mail.Read`.

**Local mail was evaluated first and rejected.** Reading Apple Mail's store needs Full Disk Access —
a far broader grant than Calendar's, for one feature. Outlook desktop turned out to be installed but
signed into nothing: its database has exactly the right shape (`Message_NormalizedSubject`,
`Message_SenderAddressList`, `Message_Preview`) and held zero messages. If that account is ever
signed in, it becomes a zero-auth path worth revisiting.

**Classification is batched, ~25 emails per request.** Same per-email judgement as one-call-per-email
at roughly a tenth of the cost and a fraction of the latency. Only sender, subject, and a truncated
preview are sent — never bodies or attachments — and bodies are never stored, only Graph's own
`bodyPreview`.

Keyword rules were considered and rejected as the primary filter: a professor writing "we won't be
meeting Thursday" never uses the word *cancelled*, and a mass department email is noise even though
it comes from a professor. The prompt therefore asks for judgement about obligation, not keywords.

**A silent-failure bug, caught in testing.** The per-batch `try/catch` exists so one malformed
response cannot strand the rest of the queue — but it also swallowed a missing API key, so clicking
Triage returned `classified: 0` as though it had succeeded. Now the provider is checked before the
loop, and a run where every batch failed raises instead of reporting a no-op.

---

## 8. Packaging it as a desktop app

`npm run install:app` builds `~/Applications/Ascent.app`.

**Not Electron.** The app is already a local web server; wrapping it in Chromium would add roughly
150 MB to supply a window the browser already provides. The bundle is a few KB of `Info.plist`,
an `.icns`, and a launcher script.

**One process in production.** In development Vite serves the UI on :5173 and Express serves the API
on :8787, which is why CORS is configured at all. `npm start` has Express serve `dist/` too, so
there is one process, one port, and no cross-origin — the CORS middleware is skipped entirely in that
mode. Hashed assets get a one-year immutable cache; `index.html` gets `no-store`, because it names
those hashed bundles and a cached copy would pin the app to a previous build.

**Bound to 127.0.0.1, not 0.0.0.0.** This server holds a Canvas token that can read grades and submit
work, plus mail. It has no business being reachable from the network.

**Express 5 fires the listen callback on a failed bind.** Raw `net` only emits `listening` on
success, but `app.listen(port, host, cb)` runs `cb` even when the port is taken, with
`server.listening === false`. Unguarded, the process announces a port it never got and then prints
the conflict error immediately after — which reads like the server started and then broke. The
callback now returns early unless `server.listening` is true.

**The launcher is idempotent.** It checks whether something is already listening before starting a
server, so opening the app twice doesn't spawn a duplicate. Failures surface as a macOS alert and a
line in `~/Library/Logs/Ascent.log` rather than a window that silently never appears.

**Icons are generated, not committed as binaries.** `scripts/make-icons.mjs` writes the PNGs from raw
RGBA through `zlib`, which ships with Node — no image library needed. It renders at 4x and
box-filters down so the rounded corners and triangle edge stay smooth, then `sips` and `iconutil`
(both built into macOS) produce the `.icns`.

---

## 9. Grades

Per-course grades for the current term, on the dashboard, refreshed with every Canvas sync.

**The headline is Canvas's `current_score`, never `final_score`.** Canvas returns both, and against
real data they diverge wildly early in a semester: INSY 3305 read **100** current and **22** final.
`final_score` counts every ungraded assignment as zero. Showing it as "your grade" would be alarming
and wrong, so it appears only inside the expanded view, labelled "if nothing else is turned in".

**Canvas's number is used rather than recomputed.** Canvas applies the course's assignment-group
weights, drop rules and grading scheme; reimplementing that would drift from what the registrar sees.
The per-category breakdown *is* computed locally, from graded, non-excused, non-omitted work — it
explains the total rather than replacing it.

**Each grade says how much of the course it rests on.** A 100% built on Assignments alone (30% of
BSTAT 3321's weight, exams not yet taken) is not the same claim as a 95% with something graded in
every category. The expanded view states the settled share of course weight.

**No invented totals.** ECON 3303 has graded work but every category weight is 0, so Canvas returns a
null course score. The card says Canvas isn't publishing a total and still shows the breakdown,
rather than fabricating an unweighted percentage that could be badly wrong.

**Term GPA is an estimate and labelled as one.** Letter grades × credit hours, where hours come from
UT Arlington's course-numbering convention — the second digit is semester credit hours
(INSY 4321 → 3). Unparseable names fall back to 3. Courses without a letter are excluded.

---

## 10. Theming

*Written after the fact: the log edit made alongside the theming commit (`f1e9f4a`) silently matched
nothing, so this section did not exist until it was noticed missing while recording the fix below.
The decisions and numbers are the ones established and measured at the time.*

Three independent axes, each a data attribute on `<html>`: `data-theme` (dark/light), `data-accent`
(six presets), `data-motion` (on/off). Switching is one attribute write and CSS does the rest — no
React re-render, no prop drilling.

**Getting there meant removing 338 hardcoded hex values** across twelve files. Before committing to a
mechanical swap, it was verified that Tailwind 4 compiles `bg-[var(--accent)]/12` into
`color-mix(in oklab, var(--accent) 12%, transparent)`, so opacity modifiers survive replacing a hex
literal with a variable. The heatmap ramp is derived from the live accent the same way.

**48 `bg-black/*` and `bg-white/*` overlays had to change too.** They read as "slightly raised" only
against a dark background; on a white card, `bg-white/5` is invisible. White overlays became
`var(--ink)`, which inverts between themes, and black wells became `var(--ground)`. The modal scrim
is the one deliberate exception — a backdrop is dark in every theme.

**Status colours don't follow the accent.** "Overdue" stays red under the Rose accent, because that
red carries information rather than decoration.

**Contrast was measured.** The first pass had three text tokens below WCAG AA against card surfaces:
`--faint` at 2.6 in both themes, and `--ok` at 3.77 in light. After adjustment every text token clears
4.5:1 in both themes, the lowest at 4.7.

**The ambient background** is two oversized blurred gradients on 54s and 67s cycles, animated with
`transform` only so they stay on the compositor. It has its own toggle and is forced off under
`prefers-reduced-motion` regardless of the stored setting.

An inline script in `index.html` applies the saved attributes before first paint; without it the app
renders dark for a frame, then snaps to light.

**Theme switches don't animate.** The first version transitioned `body` colour and card backgrounds
over 0.35s. A switch restyles about 70 elements, each animating on its own clock while others changed
instantly, so inherited text colour lagged behind new backgrounds — briefly white-on-white in light
mode. Measured while verifying the grades card: two seconds after a switch, 70 CSS transitions were
still `running`, with course codes rendering `rgb(240,240,255)` on a light row. `apply()` now sets a
`data-theme-switching` attribute that forces `transition: none`, swaps the theme attributes, forces a
style flush so the new values commit unanimated, and removes the attribute — synchronously, with no
dependence on animation frames. Verified both directions: zero running transitions immediately after
a switch, correctly paired text and background, and `.card-hover` transitions intact.

---

## 11. Internship tracker

An Internships tab: an application tracker plus a feed of open Summer 2027 roles in DFW, Austin and
remote US.

**The feed comes from SimplifyJobs' community list**, which publishes every listing as one JSON file
(~13 MB, ~17k rows across all terms). The server downloads it, keeps active, visible, Summer 2027,
software or AI/data roles in the target regions — 117 at first sync — and stores only those. The repo
has no license, so the data is read at runtime for personal use and never committed. Re-syncs send
the stored ETag; an unchanged file returns 304 in ~30ms instead of re-downloading.

**Regions match city and state together.** A substring match on "Austin" counted "Austin, MN", and
"Arlington" counted Arlington, VA — both present in the real data.

**Tracked postings that disappear are flagged, not deleted.** When a listing drops out of the active
set, the application gets "Posting closed" and keeps its notes and status.

**Server code was never typechecked.** `tsc -b` covered only `src/` and `vite.config.ts`; a planted
type error in a server file produced no output. Every earlier "typecheck clean" about server changes
covered only the frontend. Added `tsconfig.server.json` (strict) and Express/CORS type definitions;
the existing server code then passed with zero errors, so the gap was coverage, not latent bugs.

**Three UI bugs found by using it, not by reading it:**
- *Unsaved text wiped by save replies.* Each row resets from the server's response after a save. A
  reply for one field landing while another field was mid-edit replaced the typed text. Now the field
  being edited is excluded from the reset. Reproduced with focus held in the field during a status
  change, and confirmed fixed.
- *Overdue dates not red.* The base cell style set a text colour; two Tailwind colour utilities on one
  element resolve by stylesheet order, not class order, so the base won. Each cell sets its own colour.
- *Dialog covered by the page.* The Add dialog rendered inside a card, and `.card` has
  `backdrop-filter`, which makes it the containing block for fixed-position children — the next
  section painted over the dialog and its button. Modals now portal to `<body>`, fixing it for every
  dialog.

CSV export neutralises cells starting with `= + - @` so a scraped title can't run as a spreadsheet
formula.


**Undergrad filter.** Each listing carries the degrees it accepts. A role counts as undergrad-eligible
when those include Bachelor's (or Associate's), unless the title explicitly names PhD, Master's or MBA
without also naming undergraduate — metadata and title occasionally disagree. Listings with no degree
data and no hint in the title are kept, since unknown isn't excluded. On the first real run it hid 16
of 120 listings, and flagged 3 roles already tracked as grad-only rather than removing them.

**A freshness check that lied.** Checking whether the upstream file had changed, a manual conditional
request returned 200 while the app's own sync returned 304. raw.githubusercontent.com issues a
different ETag per encoding — a strong tag for the plain file, a weak one for gzip — and the app
stores the gzip tag. A check made without `Accept-Encoding: gzip` can never match it. The app was
right; the manual check was wrong.

---

## 12. Known limits
- Coursera and AWS study progress are manual. No API exists for either at the individual level.
- Apple Calendar is read-only in v1.
- ICS mode loses grades and submission state; only due dates survive.
- Single-user by design. No auth, binds to localhost. Adding accounts would mean real auth, and this
  is a personal tool.
