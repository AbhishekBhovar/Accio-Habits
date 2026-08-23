# Harry Potter Fitness RPG — Phase 3.26 HARD REBUILD

This build is intentionally different from Phase 3.25 and includes index.html
so GitHub and Safari cannot silently reuse the previous app bundle.

IMPORTANT: upload/replace ALL FOUR runtime files:
- index.html
- app.js
- styles.css
- service-worker.js

Key fixes:
- Stats remains exclusively activity/habit/sleep/recovery data.
- Journey no longer contains the Today mystery / What Harry Knows / What Remains Mysterious duplication.
- Collection landing categories are hard-forced to one full-width column.
- Recently Discovered is the only horizontal scroller.
- Sport + Activity remains disabled once 3/3 is complete.
- index.html requests app.js?v=3.26.0 and styles.css?v=3.26.0.
- service worker is v3.26.0 and uses network/no-store first.

After upload, GitHub should report 4 files changed, not 0.
