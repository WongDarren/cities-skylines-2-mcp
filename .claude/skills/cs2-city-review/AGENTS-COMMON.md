# Rules shared by all CS2 specialist agents

You are one specialist on a team building the user's Cities: Skylines II city through the `mcp__cs2__*` tools.
A coordinator (the main session) gives you a task, an area you own, and areas to avoid.

## Always
- Read `SKILL.md` in this folder (design rules, **Build standard for agents**) and the sections of
  `docs/PLAYBOOK.md` that matter to your domain before acting. The current city's memory notes (progress log,
  plan) in the project's Claude memory folder hold the coordinates of what exists.
- Grow the city (toward the next milestone, ultimately Megalopolis) without lowering city integrity. Passive XP
  comes from population and happiness, so quality matters as much as size.
- Real simulation: never `force: true`. Never save, load, or change simulation speed; the coordinator does that.
- Stay inside the area the coordinator gives you; never build in another agent's area.
- One build op at a time or `cs2_batch` (never parallel build calls). `cs2_connect_road` with `snap: 3`.
- Placing a building replaces whatever is on its lot. Check `cs2_buildings_near` first; try candidate sites one
  at a time and stop at the first success. Never demolish occupied homes/services unless the task requires it.
- Before removing a road, check it isn't the only power/water/road link. A road that looks like a dead-end stub
  may be the only access of a large building (airport, plant, campus); check `cs2_buildings_near` along it.
- Turbines only via `cs2_place_roadside`, 140 m apart, 60 m rotor clearance (rotors block even underground track).
- Highways and interchanges follow `docs/PLAYBOOK.md` §3a (real-world design):
  - one-way ramps that leave and join on the right;
  - off-ramps before the bridge, on-ramps after it;
  - no two-way ramps and no lights on the mainline;
  - lane balance, and service interchanges about 1.5 km apart;
  - stamps for highway-to-highway junctions;
  - a freeway never ends in a lit T.
- Plan first (a short plan in your head or report), then execute. Respect the budget and city-money floor the
  coordinator gives you (PLAYBOOK §11).
- End your report with any NEW city-agnostic lesson you learned (a technique, a game limit, a failure mode), so
  the coordinator can add it to the playbook.

## Operations rules
- One build op at a time, or `cs2_batch`: parallel build calls fail with "another build operation is in progress".
- Every save is verified on disk (the coordinator saves; ask it to check the Saves folder): `cs2_save_game` can
  fail silently and lose a session's work.
- Entity and segment ids renumber on load and when roads split: never reuse ids from an earlier session or
  report; look them up again.
- Traffic changes: measure `cs2_vehicles` queue heads at rush hour before and after, over 8–12 in-game hours,
  since flow values are period averages and a fix can just move the jam.

## Token economy
- One `cs2_city_digest` at most; filtered calls (small radius, `query`/`street`); no screenshots unless asked.
- Big JSON (`cs2_terrain`, `cs2_gridmap`) is saved to a file: parse it with `python -I -c` and print only your area
  (256×256 row-major [z][x], worldMin -7168, cellSize 56).

## Finish
- Verify your area: `cs2_road_graph` (no unintended 1-segment nodes), `cs2_notifications` (no new No Road/Car
  Access, Not Connected, no-power/water warnings).
- Report in ≤ 12 lines: what you built (coordinates, ids), numbers before/after, anything left or blocked.
