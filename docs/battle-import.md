# Battle archive importer

The battle archive is maintained with a repeatable importer. It scans the full
available OneUP battle history on AlbionBB Europe, with no season boundary or
calendar cutoff.

## Commands

```bash
npm run import:battles
npm run sync:battles
npm run build
```

The first command scans and imports reports; the second downloads their preview
images; the third builds the English and Persian site. Importing is an explicit
maintenance command. The deployment workflow refreshes images and builds the
saved archive without initiating a history scan.

To rebuild the archive from saved data without network access:

```bash
npm run import:battles -- --offline
```

## Configuration and selection

[Import configuration](../content/battle-import.json) contains the guild ID,
server endpoints, and listing filters. The default listing filters require
10 total participants and 5 OneUP participants, focusing on group fights.

The importer exhausts pagination rather than stopping at a particular battle
date. It fetches missing battle details, refreshes the first page of recent
reports, and reuses cached details for older reports. Cached history and every
already published battle ID are retained, including reports no longer returned
by the listing or below its participation filters.

Sessions are selected when at least 8 OneUP members participated in one
engagement and the session has either 5 OneUP kills plus deaths or 1 million
OneUP kill fame. Previously published battle IDs are preserved even below those
thresholds. Selection does not favor positive K/D.

## Combining reports

An automatic merge requires all of the following:

1. At most 20 minutes from the previous engagement's finish to the next start.
2. A combined start-to-finish duration of at most 90 minutes.
3. At least 3 shared OneUP players, covering 50% of the smaller roster.
4. At least 3 shared participant slots outside OneUP's alliance, covering 50% of
   the smaller outside-team composition. Guilds in the same alliance form one
   team; independent guilds retain their own identity.
5. Both the previous engagement and the session's first engagement must match,
   preventing chains from gradually drifting to unrelated teams.

OneUP's allied guilds cannot create a match by themselves. Team identity uses
alliance and guild membership; it does not prove a fight's location or objective.
Ambiguous cases stay separate. Titles list the largest guilds outside OneUP's
alliance and the engagement's start time in UTC.

These short time intervals identify related fights. They do not restrict how
far back the history scan reaches. Grouping and selection rules live in
[the importer](../scripts/import-battles.mjs).

## Verification and saved data

Individual detail responses must contain OneUP's exact guild ID. Kills and deaths
come from the OneUP guild row, never the entire battle. New combined reports are
checked against AlbionBB's actual multi endpoint before publication. Previously
verified combinations are reused only when their IDs and totals still match.
Outcomes remain `recorded`: K/D alone cannot establish a confirmed winner.

- [Source data](battle-source.json) stores cached battle details, guild compositions,
  OneUP rosters, preserved IDs, and verified combined totals.
- [Import audit](battle-import-audit.json) records included and excluded sessions,
  selection reasons, and calculated guild statistics.
- [Published content](../content/site.json) contains the reports used by the site.

Source and audit metadata record when data was fetched for traceability; those
values do not limit imports. Battle timestamps remain part of the actual report
data for ordering and grouping. Source and audit files are not shipped with the
site. Network, grouping, or verification errors stop the import before saved
files change. Reports outside the fetched and cached history remain untouched;
a partially overlapping report stops the import for review.

## Presentation and checks

Only six highlights are shown as full cards, ranked by OneUP's kills minus
deaths, then kills, with newer reports breaking ties. Reports with incomplete
stats follow verified results. All reports remain in the expandable detailed
table, which scrolls within a bounded height to keep the page compact. Each
combined report uses its own combined scoreboard image.

`npm test` checks pagination, unrestricted history, grouping boundaries, unrelated
teams, roster continuity, duplicate IDs, source totals, preservation, and both
languages. `npm run build` also works offline with the saved content and images.
