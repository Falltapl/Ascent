# Ascent

A personal dashboard for goals, AWS certification progress, and UTA coursework — with the
integrations that actually exist, and honest local tracking for the ones that don't.

<!-- screenshot goes here -->

## What it does

- **Certification readiness** for AWS Cloud Practitioner (CLF-C02) and Solutions Architect Associate
  (SAA-C03), scored against the **official exam-guide domain weightings** rather than a flat average,
  and projected onto the real 100–1000 scaled-score range with the pass threshold drawn in.
- **Automatic certification detection** via Credly. Pass an exam and the badge, issue date, and
  three-year recertification deadline appear on their own.
- **Canvas assignments** from UT Arlington, grouped by course with overdue and due-soon states.
- **Coursera courses**, with name, description, and workload auto-filled from a pasted URL.
- **Apple Calendar** events alongside deadlines.
- **XP, levels, and a study streak** tuned so the cheapest way to gain XP is also the habit worth
  building — study minutes are capped daily so a streak can't be inflated.

## Stack

React 19 · Vite 8 · TypeScript · Tailwind 4 · Express 5 · SQLite (`node:sqlite`, zero native deps)

## Install it as a Mac app

```bash
npm install
npm run install:app
```

That builds `~/Applications/Ascent.app`. Open it from Spotlight (Cmd+Space → "Ascent")
or drag it to the Dock. It starts the local server on demand, waits for it, and opens the UI in its
own window — no tabs, no address bar. Launching it again reuses the running server rather than
starting a second one.

Not Electron on purpose: the app is already a local web server, so bundling a Chromium runtime would
add ~150 MB to provide a window the browser already has.

## Run it in development

```bash
cp .env.example .env   # fill in what you have; every integration is optional
npm run dev            # API on :8787, UI on :5173 with hot reload
```

`npm start` runs the production build instead — one process serving both the API and the UI on
:8787, bound to loopback only.

Open http://localhost:5173. It runs with nothing configured — the Settings tab walks through each
connection and shows which mode it's in.

Try it with sample data first:

```bash
npx tsx server/seed.ts            # load a realistic demo dataset
npx tsx server/seed.ts --clear    # wipe everything
```

## Connecting the integrations

### Canvas

Open [uta.instructure.com/profile/settings](https://uta.instructure.com/profile/settings) → **Approved
Integrations** → **+ New Access Token**. Then install it without it touching your screen, your shell
history, or the process list:

```bash
npm run token
```

It prompts with hidden input and writes straight into `.env` (`chmod 600`, gitignored). Use
`npm run token CREDLY_HANDLE` for any other key. A Canvas token can read your grades and submit work
as you, so never paste one anywhere it gets recorded — rotate it in Canvas if you do.

If that button isn't there, UTA blocks student tokens. Use the fallback: Canvas → **Calendar** →
**Calendar Feed**, and put that URL in `CANVAS_ICS_URL`. Due dates still sync; grades don't. The app
tells you which mode it's running in.

The token is a full-account credential. It stays server-side in `.env`, which is gitignored.

### AWS certifications

Set `CREDLY_HANDLE` to the name in your `credly.com/users/<handle>` URL. AWS publishes no API of its
own — it issues certifications as Credly badges, and Credly's public feed is the real integration
point. Nothing appears until you pass an exam, which is correct.

### Apple Calendar

Calendar.app → right-click a calendar → **Share Calendar…** → tick **Public Calendar**, and put the
`webcal://` URL in `APPLE_CALENDAR_ICS_URL`. Read-only in v1; see [DECISIONS.md](DECISIONS.md) §1 for
why, and what two-way sync would take.

## Why it's built this way

[DECISIONS.md](DECISIONS.md) records each tradeoff and the evidence behind it — which APIs exist,
which don't, why Canvas has to be proxied, and how the readiness math works.
