HP55 — SELF-CONTAINED STARTUP FIX
=================================
This is HP54 visually/gameplay-wise, with the startup problem hardened.

Fixes:
• levels/config/habits/identity/collectible data are embedded inside app-v55.js.
• The app no longer waits for multiple JSON network requests before rendering.
• JSON files remain included as source-of-truth/reference files.
• New v55 JS/CSS filenames force Safari/GitHub Pages to stop using HP54 cached files.
• Service worker clears previous caches on activation.
• A future startup exception no longer intentionally blanks the entire UI with an alert.

No Campaign, Readiness or Battle design was reverted.
