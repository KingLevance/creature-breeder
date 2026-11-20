# Hatchlore (working title)

A mobile game about hatching, raising and breeding fantasy creatures. One genome drives how a creature looks,
its stats and its moves. Enemies drop eggs, breeding mixes genes (with mutation), and your best bloodline carries
your team through multi-fight campaign runs.

Built with Expo / React Native. The design doc lives at https://claude.ai/artifact/Lvv2DYyMFF64J8J5esR2wp and a
summary is in `docs/DESIGN.md`.

## Run it

    npm install
    npm run web        # in a browser
    npm run ios        # in the iOS simulator (needs a Mac)

## Check it

    npm test           # game rules: genetics, every move, every area, the whole tutorial
    npm run typecheck
    npm run shots      # renders creature contact sheets to tools/shots/

## Get it on a phone

Run the "iOS sideload IPA" workflow in the Actions tab (or push a tag named `build-*`). It builds an unsigned
`.ipa` and attaches it to a GitHub Release. Install it with Sideloadly or AltStore, which sign it with your Apple ID.

## Where things are

| Path | What |
| --- | --- |
| `src/game/data/` | Elements and matchups, all 160 moves, the 20 campaign areas. Pure data: tune here. |
| `src/game/genome.ts` | Gene slots, dominant/recessive, breeding, mutation, star rating. |
| `src/game/creature.ts` | Stats, life stages, XP, move unlocks, pedigree. |
| `src/game/battle.ts` | Speed-based turn order, moves, status effects, the AI. |
| `src/game/run.ts` | Campaign runs, drops, boss chests, XP awards, tower, rivals, raid. |
| `src/game/economy.ts` | Breeding costs, incubators, shop, roster, starters. |
| `src/render/creature.ts` | Draws any creature from its genes as flat 2D shapes. |
| `src/ui/` | The screens. |
