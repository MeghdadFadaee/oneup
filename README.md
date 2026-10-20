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
| `npm run sync:intel` | Prepare static 60-day analytics datasets |
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

Open `/intel/` or `/fa/intel/` to analyze a prepared Europe guild by its exact full name.
The report includes exact kill/death fame, K/D, recorded attendance and IP,
daily fame, roles, weapons, player rankings, expandable encounter compositions,
source links, and CSV export. Filters and guild name are shareable in the URL.

- Time windows cover 7, 30 or 60 days ending at the published data timestamp. Battle times use UTC.
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
- Every history page in the time range is scanned during data preparation. Errors
  stop publication; partial data is never labelled as a complete report. The
  browser caches versioned bundles for responsive filter changes.

### Static datasets, without proxies or keys

The browser loads `data/intel/manifest.json` and a versioned JSON file for the
selected guild from this same static site. There is no project API, external CORS
proxy, account/key setup or cross-origin data request. Filters, grouping decisions,
composition, statistics, charts and CSV export run in the browser.

This deliberately trades arbitrary live lookup for reliable static hosting:
**only guilds with a published dataset are searchable**. The page lists available
guilds and displays their data timestamp. Windows end at that timestamp, rather
than claiming that an older dataset covers the present moment. Datasets older than
36 hours are explicitly marked. Complete coverage is 60 days per prepared guild.

To refresh:

```bash
npm run sync:intel
npm run build
```

`content/intel-guilds.json` lists full Europe guild names to prepare (initially
OneUP). Add a name there, or use `INTEL_GUILD_NAME="Full Guild Name" npm run sync:intel`.
The collector reads public AlbionBB HTML pages, finds an exact guild match, exhausts the history pages in the
60-day window and saves full guild detail, including recorded roles and weapons.
It retains other guilds' aggregate stats for grouping, but omits their player
rosters to keep files small. Raw files contain only public game data.

For all 7/30/60-day windows, the collector prepares the multi reports needed for
**every distinct total-player threshold**, not just a few preset values. Each is
extracted from AlbionBB's public `battles/multi` HTML pages and its kill, death and fame totals are
verified against the originals. Browser grouping uses the same rules and reads
the corresponding saved multi. Failed or missing data is an error; no silently
approximated merged composition is presented.

The initial real dataset is committed in `public/data/intel/`, so a clean checkout
and normal build work offline. Subsequent refreshes reuse historical raw reports
and verified multi files. The manifest is replaced only after all requested guilds
have been collected successfully. New files have content hashes in their names.

Normal GitHub Pages deployments publish the committed datasets without contacting
the source website. This keeps deployment independent of AlbionBB availability and
its IP restrictions; the direct API previously returned HTTP 403 on GitHub runners.
Plain manual deployments also use committed data.

To explicitly request a remote refresh, enable **refresh_analytics** in Run workflow,
or provide the optional **guild** input to add a prepared guild. Only those runs
restore the Actions data cache and call the collector. Validation runs afterward,
against the actual data being published. A requested refresh still fails visibly
if AlbionBB blocks the runner; a stale or incomplete refresh is not reported as
successful. In that case run `npm run sync:intel` locally and commit the resulting
`public/data/intel/` files before pushing. No runtime server is deployed.

There is no scheduled refresh. Ordinary deployments preserve the dataset timestamp;
it advances only after a successful explicit collection.

Analytics collection now scrapes public pages on `https://europe.albionbb.com`:
guild battle lists, individual reports, search results and combined reports. The
site embeds complete server-rendered report data in its HTML. The scraper parses
that JSON reference graph without executing remote JavaScript and without calling
`api.albionbb.com`. It retains exact fame, player roles, weapons and roster data.
The separate legacy battle importer still uses the API.

Scraping runs on the maintainer's computer or in CI, where browser CORS does not
apply. The source site itself still obtains its data internally; this project
reads its published pages. A source-site block, rate limit, or HTML format change
stops collection, and the previous complete dataset remains usable. Successful
local scraping does not guarantee that GitHub's IP addresses are allowed.

All analysis still happens in the visitor's browser. Scraping another domain from
client JavaScript would still require CORS permission, so the browser reads only
the published same-origin JSON. The normal `npm run build` stays offline.
