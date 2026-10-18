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
