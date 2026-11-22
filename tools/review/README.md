# Review harness

Art, animation and menu changes get looked at by someone other than whoever made them before they ship. This
folder is what that reviewer works from: the same fixed creatures, the same menus and the same fights captured
before and after a change, so the two sets line up picture for picture, and a rubric built from everything the
owner has sent back so far.

## The pieces

- `RUBRIC.md` — who the reviewer is reviewing for, his past complaints in his own words and what each one
  means, the bar, and the report format (PASS / FAIL / CANNOT TELL per item, then regressions, then a verdict).
  Add to it whenever the owner sends something back.
- `art_sheets.ts` — sheets of fixed-seed creatures: 16 per body plan, roster-size tiles, every life stage,
  poses, babies, legendaries, shinies. `wings.ts` (every wing type on every body) and `proportions.ts` (the
  squattest and lankiest builds) cover the combinations that strain most. `closeup.ts` renders any numbered
  creature large.
- `cases.ts` — writes the fixed saves the captures load: one lived-in save for menu screenshots and one small
  fight per kind of move (every attack flair, each support kind, each status, faint, win, boss, legendary).
- `battle_cap.py` — films those fights. The app's web build has a test bench (`src/ui/Lab.tsx`) that opens
  straight into a given fight; the script runs it on a frozen clock with a fixed random seed and steps time
  itself, so frame "560ms" is the same instant in every build. Output: contact sheets, 20 frames each, 70 ms apart.
- `menu_cap.py` — screenshots of every menu screen and modal from the menu save, same frozen clock.
- `shot_case.py` — one full-screen shot of a fight case (for the move picker and HUD).
- `zoo_cap.py` — strips of a line-up of creatures standing, walking or running, frame by frame (the test
  bench's `zoo` mode), for judging idle motion and walk cycles.
- `celldiff.py` — compares two sheets cell by cell and writes before | after pairs of the cells that changed.
  `montage.py` tiles screenshots side by side.

The Python scripts need Playwright with Chrome and Pillow (`pip install playwright pillow numpy`); they are
dev tools and nothing in the app depends on them.

## A review, start to finish

```sh
# 1. Before the change (on the commit you are starting from)
OUT=/tmp/review/cases npx tsx tools/review/cases.ts
OUT=/tmp/review/base/art npx tsx tools/review/art_sheets.ts
npx expo export -p web --output-dir /tmp/dist_base
python3 tools/review/battle_cap.py /tmp/dist_base /tmp/review/base/battle /tmp/review/cases 8801 all
python3 tools/review/menu_cap.py   /tmp/dist_base /tmp/review/base/menus  /tmp/review/cases 8802

# 2. After the change: the same five commands with "after" in place of "base".

# 3. Pairs of what changed, for the reviewer to start from
python3 tools/review/celldiff.py /tmp/review/base/art/plan_quad.png /tmp/review/after/art/plan_quad.png 300 /tmp/review/after/diff_plan_quad.png
```

Then write a short brief (what changed, what each change is meant to achieve and must not do, which pictures
show it, what was not supposed to change) and hand the brief, `RUBRIC.md` and the two folders to a fresh
reviewer who has not seen the work being made. Fix every FAIL and have it reviewed again before pushing.

Filming all 64 fights takes about 20 minutes on two cores; pass case names instead of `all` to film a few.
`--keep=1 --dpr=2` keeps every frame as its own file at double resolution; `--step=35` halves the time step.
