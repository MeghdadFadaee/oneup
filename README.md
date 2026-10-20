# OneUP

**One United Power.** A bilingual static website for the OneUP Albion Online guild, with fight highlights, AlbionBB reports, recruitment, and seasonal rewards.

## Development

Requires Node.js 22 or newer. The project has no external build dependencies; no install step is needed.

```bash
npm run dev
```

Preview at `http://localhost:4173`. Restart after source or content changes to rebuild. Set `PORT` to use a different port.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Build and serve a local preview |
| `npm run build` | Generate the static website in `dist/` |
| `npm test` | Validate content, URL handling, preview metadata, and generated pages |
| `npm run sync:battles` | Download social preview images for configured AlbionBB reports |
| `npm run import:battles` | Scan available battle history and import verified reports |

The build works offline. Battle image synchronization requires network access and preserves report links when previews are unavailable.

## Project structure

```text
content/           Guild data, reward configuration, and translations
docs/              Content format reference
public/assets/     Logo, jersey artwork, and optional media
scripts/           Static generator, preview server, and battle image sync
src/               Styles and browser interactions
test/              Node.js tests
.github/workflows/ Build and deployment workflow
```

## Content

| File | Purpose |
| --- | --- |
| `content/site.json` | Site URL, guild profile, recruitment, socials, clips, and battle reports |
| `content/rewards.json` | Milestone targets, Silver payouts, and reward artwork |
| `content/translations.json` | English and Persian interface copy |

Localized fields accept `{ "en": "English", "fa": "فارسی" }` or a plain string. Missing Persian values fall back to English. See [the content reference](docs/content.md) for media formats, battle report fields, recruitment, and rewards.

The [battle importer](docs/battle-import.md) documents ongoing imports, selection
criteria, multi-report grouping, and verification. The scan has no date cutoff.

## Architecture

The Node.js generator renders complete HTML pages at `/` (English) and `/fa/` (Persian, RTL). Vanilla JavaScript handles navigation, reward tabs, media dialogs, and language preferences. A one-year `oneup_language` cookie remembers the selected language; `?lang=en` or `?lang=fa` overrides it.

The build emits canonical and language alternate links, social metadata, organization structured data, `robots.txt`, `sitemap.xml`, a circular SVG favicon, and a custom-domain `CNAME`. Hosting assumes the domain root rather than a repository subpath.

YouTube uses thumbnails and a privacy-enhanced player loaded on request. Direct video URLs use the native video element. AlbionBB previews are cached at build time; explicit image URLs and Europe single/combined battle preview URLs also work without a local cache. Fonts are served by Google Fonts, with system fallbacks.

The GitHub Actions workflow validates pull requests. Pushes to `main` or `master` also synchronize battle previews, build, and deploy the static artifact to GitHub Pages. Generated output is not tracked.

## Guild intelligence

Open `/intel/` or `/fa/intel/` to analyze any Europe guild by its exact full name.
The live report includes exact kill/death fame, K/D, recorded attendance and IP,
daily fame, roles, weapons, player rankings, expandable encounter compositions,
source links, and CSV export. Filters and guild name are shareable in the URL.

- Time windows are rolling 7, 30 or 60 days. Battle times use UTC.
- Minimum players means **all players from all guilds in each original battle**.
  For example, 40 includes a 40-player fight even if only four belong to the searched
  guild. Filtering happens before merging and applies to every reported statistic.
- Optional grouping uses the archive's continuity criteria: a maximum 20-minute
  gap, at least three and 50% overlapping guild members, at least three and 50%
  overlap in other teams, and at most a 90-minute encounter span. Each new battle
  must match both the first and most recent battle in the group.
- Combined groups are requested from AlbionBB's `/battles/multi` API and their
  kill, death and kill-fame totals are verified against the original reports.
  End timestamps are taken from the original reports because the multi response
  does not reliably contain the latest finish time.
- Composition counts recorded player appearances, once per encounter. The same
  member is counted again in another encounter. Zero/missing IP is excluded from
  the recorded-IP average. Role/weapon snapshots are not complete movement,
  equipment-switch or in-game attendance telemetry.
- Every history page in the time range is scanned. Errors stop the analysis;
  partial results are never labelled as a complete report. Retry and cancellation
  are available. Requests use bounded concurrency and a short in-page cache.

### Live API hosting

AlbionBB allows browser requests only from its own origin. Live reports therefore
require a small server-side read proxy; a GitHub Pages static artifact alone
cannot provide this endpoint. No API key is required.

`npm run dev` provides `/api/albion/*` automatically. For production there are two options:

1. Build with `npm run build`, then deploy `worker.mjs` and `dist/` to Cloudflare
   Workers using the included `wrangler.jsonc` (e.g. `npx wrangler deploy`). This
   serves both the existing site and the same-origin API. Deployment is a separate
   operator action; the existing GitHub Pages workflow is unchanged.
2. Keep GitHub Pages and host the Worker separately. Set the Worker's `SITE_ORIGIN`
   variable to the exact site origin (for this project, `https://oneup.megh.dad`).
   Build the static site with
   `ONEUP_API_BASE_URL=https://YOUR-WORKER.workers.dev/api/albion npm run build`.
   For the existing CI workflow, set the repository variable `ONEUP_API_BASE_URL`
   to that URL. Only the configured origin receives cross-origin access.

The proxy permits GET requests to a fixed Europe upstream and a small allowlist
of public report routes and parameters. It does not forward cookies or credentials.
Upstream timeouts and rate limits produce a visible error with a retry option.
