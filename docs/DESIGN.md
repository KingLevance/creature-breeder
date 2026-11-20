# Design summary

Full design doc: https://claude.ai/artifact/Lvv2DYyMFF64J8J5esR2wp

**Loop:** run a campaign -> win drops (gold, materials, sometimes eggs) -> incubate -> hatch -> level up by
fighting -> breed two adults -> new egg -> build a better team -> next run.

**Decided**
- No capture and no gacha pulls. New creatures come only from eggs: enemy drops and breeding.
- Male and female; breeding needs one adult of each. Costs gold that escalates with rarity and times bred; a
  cooldown per parent; no lifetime limit.
- Genome: two alleles per gene, simple dominant/recessive for traits, averaged for numbers. Hidden carriers.
  Mutation per gene on each breeding.
- Peeking at carriers: free pedigree (parents and grandparents), a hint icon for rare carriers, a scan lens for a
  full reveal, and a breeding forecast that shows odds without naming alleles.
- Star rating 1-5 from the genome's potential, not level, shown on eggs too.
- Six skeletons: quadruped, biped, aquatic, serpentine, multi-legged, floating. Wings are a part, not a skeleton.
- 20 elements, all in from the start, with a full matchup chart; dual types multiply.
- 8 moves per element in four rarity tiers. A creature has up to five move slots, one per life stage. The slot's
  rarity is visible; the move stays hidden until the slot unlocks. Only some bloodlines have a legendary slot.
- Five life stages (baby, teen, adult, ancient, legendary at level 100). Only adults breed. Rarer elements
  mature later. Looks age by proportions and features growing in.
- Four stats: Health, Attack, Defense, Speed. Healing and shields scale from Attack.
- Combat: turn-based 5v5. Speed fills a gauge, so fast creatures act more often. One move per action. Cooldowns
  and status durations count a creature's own actions. At most one extra action in a row.
- Runs: pick a team, 3-5 fights and a boss, no swapping, deaths stick, boss chest at the end. Visible loot tables.
- XP only from fighting, scaled by fight difficulty and by what the creature contributed.
- Tutorial: pick one of three low-star starters, win a fight for an egg and an incubator, hatch, clear the first
  area (both grow up), breed, hatch the child.

**Suggested and built, still to confirm**
- Bad-luck protection: the rare chest egg is guaranteed on a first clear and after three dry chests.
- Incubation timers by star rating; gold speed-ups that cost more each time in a day.
- Wild enemies are weaker than a player creature of the same level, because a run is several fights in a row.
- Strike: a typeless basic hit every creature has, so no one is locked out by cooldowns or immunities.
- Long fights heat up after 100 actions (more damage, less healing) so nothing can stall forever.
- Rivals and the raid run locally against the computer until there is a server.

**Open**
- Real PvP and shared raids, trading, monetization, sound and music, hand-drawn art to replace the shapes.
