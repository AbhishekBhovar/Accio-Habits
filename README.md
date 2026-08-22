# Harry Potter Fitness RPG — PWA Phase 1

GitHub Pages-ready installable Progressive Web App shell for the 168-level / 385-collectible fitness RPG.

## Included
- 168 canonical story levels and 42 checkpoints
- 385 collectible registry
- spoiler-safe identity rules data
- offline service worker + PWA manifest
- iPhone Home Screen standalone mode
- local-device save state
- Journey and Collection screens
- development XP tester
- save export/import

## GitHub Pages deployment
1. Create a new GitHub repository (for example `harry-potter-fitness-rpg`).
2. Upload **all files and folders from this package to the repository root**.
3. Commit to `main`.
4. In GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
5. Open the deployed Pages URL once in Safari.
6. iPhone: **Share → Add to Home Screen**.

The app's `manifest.webmanifest` uses `display: standalone`, so launching from the Home Screen removes the normal Safari tab/address-bar experience.

## Important Phase-1 limitation
The exact automatic **random discovery slot cadence per level** has intentionally not been invented. The engine and data support the locked rarity/pity rules, but no unlimited Claim button is exposed. We should set/validate the slot cadence during Year-1 play testing before enabling automatic RNG rewards.

## Next implementation phase
Connect the Daily Habits / XP system to `addXP()` and replace the development XP buttons. Then add collectible artwork and polished level-up/revelation animations.

deployment refresh
