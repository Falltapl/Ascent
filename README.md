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

## Run it

```bash
npm install
cp .env.example .env   # fill in what you have; every integration is optional
npm run dev            # API on :8787, UI on :5173
```

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
Integrations** → **+ New Access Token**, and put it in `CANVAS_TOKEN`.

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
