# Notes for coding agents

- The game rules live in `src/game` and are pure TypeScript with no React. Keep them that way: every rule must be
  testable from `tools/sim_test.ts`. Run `npm test` and `npm run typecheck` before committing.
- Content is data. Elements, matchups, moves and areas are tables in `src/game/data`. Add or tune content there
  instead of adding special cases in code.
- One genome, one renderer. `src/render/creature.ts` turns visible traits into a flat list of shapes. The app and
  the tools both use it. Check art changes with `npm run shots` and look at the images in `tools/shots/`.
- This is an Expo app. Expo changes between SDK versions, so check the docs for the installed version before
  touching Expo APIs or config plugins.
- The player never sees gene internals unless a creature is scanned. Don't leak hidden alleles into the UI.
- Not done yet, on purpose: real online PvP and shared raids (need a server), trading, monetization, sound.
