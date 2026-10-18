# Content reference

All guild content lives in three JSON files:

| File | What to edit |
| --- | --- |
| `content/site.json` | Domain, member count, recruitment status and details, social links, clips, battle reports, SEO descriptions |
| `content/rewards.json` | Point targets, Silver payouts, and jersey artwork |
| `content/translations.json` | English and Persian page text |

Translated fields accept `{ "en": "English text", "fa": "متن فارسی" }`. A plain string also works. Missing Persian entries fall back to English.

## Recruitment

Recruitment copy, PvP activities, fame thresholds, and application instructions are editable in `recruitment` within `content/site.json`. The community section presents these in English and Persian; an “Apply on Discord” button appears automatically when the Discord social URL is configured.

## Social links

Set each social's `url` to its real HTTPS invite/channel address. Empty URLs display a translated “Link coming soon” label. Add or remove entries freely; `kind` supports `discord`, `telegram`, `youtube`, or a generic globe for other services.

## Fight clips

Add to the `clips` array in `content/site.json`:

```json
{
  "title": { "en": "Your fight title", "fa": "عنوان نبرد شما" },
  "description": { "en": "A short description", "fa": "توضیح کوتاه" },
  "type": "youtube",
  "url": "https://www.youtube.com/watch?v=YOUR_VIDEO_ID",
  "duration": "04:32"
}
```

Replace the video ID with a real 11-character YouTube ID. Watch, short-link, Shorts, Live, and embed URLs are supported. YouTube previews use the video's thumbnail; the privacy-enhanced player loads only after a click.

For a direct MP4/WebM file, use `"type": "direct"`, a publicly accessible HTTPS media URL, and optionally `"poster": "assets/my-fight.jpg"`. The media host must permit browser playback. Use a URL for the actual video file, rather than a sharing page. A link to the original is always available in the player.

Put additional local images under `public/assets/` and reference them as `assets/filename.jpg`. Do not add `public/` to content paths. Large videos are better hosted on YouTube or an external media host.

## Battle reports and AlbionBB preview images

Add each battle manually to `battles` after the fight:

```json
{
  "title": { "en": "Your battle title", "fa": "عنوان نبرد شما" },
  "date": "2026-10-18",
  "url": "https://europe.albionbb.com/battles/448776222"
}
```

The sample title and date are illustrative. Omit the date or results when unknown.

Optional fields: `"date": "2026-10-18"`, `"outcome": "victory"` (also `defeat`, `draw`, or `recorded`), `"kills": 0`, and `"deaths": 0`. Enter verified guild-specific numbers. Omit unknown dates and figures; they display as dashes. Reports sort by date, newest first, with undated reports following in JSON order. Combined `/battles/multi?ids=...` links are supported and receive distinct preview cache filenames.

Only the report URL is needed to discover its preview; no `preview` field is required. The GitHub deployment automatically runs `npm run sync:battles`, which reads each report's `twitter:image` or `og:image`, including combined reports. If the report page cannot be read or has no image metadata, Europe reports fall back to endpoints derived from the report URL: `https://api.albionbb.com/eu/preview/BATTLE_ID` for a single battle, or `https://api.albionbb.com/eu/preview/multi?ids=ID1,ID2,...` for combined battles. An optional explicit `preview` field overrides discovery.

PNG/JPEG/WebP images are downloaded to `public/assets/battles/` and included in the generated site. If a download fails, the discovered remote URL remains usable by the browser; an existing local image cache is preserved. Europe single and combined preview URLs are also derived directly during local builds without synchronization. Image display does not require a cross-origin API request. Downloaded files on the Actions runner are included in deployment but are not committed back to Git.

Every report renders a visual card with local decorative terrain artwork, guild branding, report IDs, and single/combined report labels. Report images display in full without cropping; missing or failed images retain the local artwork. Combined reports use the combined scoreboard image; a single engagement's image is not substituted for the combined results. The map is decorative, not a reconstruction of the battle. Archive counts use report entries and unique battle IDs from their URLs. Only supplied dates and results are shown. The full table is available in the expandable detailed log.

To download previews locally, run:

```bash
npm run sync:battles
```

Commit `public/assets/battles/` if you want persistent local fallback images. An optional `preview` field can provide an explicit HTTPS image URL or a local `assets/` path. This is useful if AlbionBB changes its metadata. Override an old cached image by syncing the report again or removing its entry from `public/assets/battles/previews.json`.

You can inspect/download a report's preview without publishing it to the battle archive:

```bash
npm run sync:battles -- https://europe.albionbb.com/battles/448776222
```

## Rewards

The reward model supports one first-to-target winner per category and a separate end-of-season podium. Targets, payouts, and jersey artwork are configured in `content/rewards.json`. Values use whole Silver: `20000000` means 20M. Update the explanatory text in `content/translations.json` when changing the jersey rule or adding different prizes.

Artwork lives in `public/assets/`. The build copies it into the site and creates a circular favicon with transparent corners from the original logo. The reward rules are maintained in `content/rewards.json`.

