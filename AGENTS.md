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
- Sound: every music loop and effect is synthesized by `tools/make_audio.ts` into `assets/music` and `assets/sfx`.
  Replace any file with a real recording of the same name. Playback is in `src/ui/audio.ts`.
- Over-the-air updates: pushing app code to main publishes an EAS Update to the installed app's version. Anything
  native (a new Expo module, app.json) needs a version bump in app.json and a new IPA, or old installs would get
  JavaScript that expects native code they don't have.
- Not done yet, on purpose: real online PvP and shared raids (need a server), trading, monetization.
