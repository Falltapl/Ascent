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

## 7. Known limits

- Coursera and AWS study progress are manual. No API exists for either at the individual level.
- Apple Calendar is read-only in v1.
- ICS mode loses grades and submission state; only due dates survive.
- Single-user by design. No auth, binds to localhost. Adding accounts would mean real auth, and this
  is a personal tool.
