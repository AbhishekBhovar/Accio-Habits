# Harry Potter Fitness RPG — Phase 3 UX Upgrade

This build consolidates the latest review feedback into one GitHub Pages / iPhone PWA update.

## Major changes
- Weekly Missions → Daily Missions → Sleep order on Today
- Sauna moved to Weekly Missions: 5 credits/week; 30 min = 1 credit; 60 min = 2 credits with no second same-day XP payment
- 11 yes/no daily habits in the agreed sequence
- one-tap habit completion with no Continue popup
- celebratory Perfect Routine / Perfect Day dashboard state
- status/reward zone visually separated from mission input zone
- collectible level-up/reveal animation + generated sound effects
- Journey rebuilt as a mobile magical map with book regions and 24 nodes per book
- Collection rebuilt as six themed galleries, then filtered by Year/Book
- Stats rebuilt as an executive-style visual dashboard with 7-day chart and mission bars
- Settings cleaned to App/Data/Preferences only
- reset/test XP tools hidden unless URL includes `?dev=1`
- network-first service worker cache bumped to v3.0.0

## GitHub update
Upload/replace these files in the repository root, then commit to `main`:
- `app.js`
- `index.html`
- `styles.css`
- `service-worker.js`
- `manifest.webmanifest`
- `habit-config.json`
- `README.md`

Your `levels.json`, `collectibles.json`, `reward-events.json`, `identity-rules.json`, `game-config.json` and icon files do not need replacing for this update.

## Artwork
This build uses themed illustrated placeholders/sigils for collectible cards. Real collectible artwork can be added later without changing the progression engine.


## Phase 3.1 UI polish
- Consistency achievements are now compact badge medallions.
- Latest Journey Events is a visual timeline with event hierarchy.
- Collection gallery landing page is a compact 2 x 3 grid.
- Stats and Settings are unchanged.


## Phase 3.2 — Storytelling & Hogwarts visual identity
- Replaced the Home activity-log emphasis with a spoiler-safe **Your Story** preview: current mystery, narrative hook, cliffhanger, XP remaining, and face-down discovery cards.
- Journey map now includes a narrative ribbon and chapter panels with **suspense → reveal → cliffhanger** structure.
- Future chapter titles remain hidden when they would spoil the payoff.
- Added an optional **current checkpoint levels** dropdown (4 levels) beneath the Journey story panel.
- Added a warmer Gryffindor/Hufflepuff-led Hogwarts palette: burgundy, antique gold, parchment, candlelight, midnight blue and forest green.
- Stats and Settings layouts intentionally unchanged.
- Cache bumped to v3.2.0.
