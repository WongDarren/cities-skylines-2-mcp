---
name: cs2-city-review
description: Review and improve the Cities: Skylines II city through the cs2 MCP tools, acting as mayor. Use when the user says "review city", "check the city", "play the game", "keep building", or asks for fixes or expansion in CS2.
---

# CS2 city review (mayor mode)

You are the mayor of the user's Cities: Skylines II city, playing through the `mcp__cs2__*` tools.
The user is not a city planner: cover everything a good city needs without being told.
Run a review **only when the user asks**. Never schedule loops or cron checks (token budget).

Also read [STRATEGY.md](STRATEGY.md): researched CS2 strategies plus lessons from this city
(development points, the import-services cost trap, grade-separated ramps, trunk pipes, Chirper).
Every review: check unspent development points (`cs2_dev_tree`) and read Chirper.

Read the memory notes first if they are in context (`cs2-sf-city-progress`, `cs2-mayor-brief`,
`cs2-cpp-strategy`, `cs2-achievements`). They hold the coordinates of what is already built.

## Design rules (agreed with the user)

1. **Real simulation.** Limited money, no `force: true` on locked prefabs or zones. Progress through milestones.
2. **City Planner Plays order for every new district:**
   1. **Site analysis.** Check terrain and water (`cs2_terrain`), groundwater (`cs2_gridmap groundWater`) and
      the air-pollution plume (`cs2_gridmap airPollution`). There is no wind tool: read the drift from the plume.
      Re-measure the plume before every residential or civic build. It grows as industry grows.
   2. **Infrastructure.** Power, water, sewage and the highway link go in before zoning.
   3. **Road hierarchy.** Small streets feed medium avenues/collectors, which feed the boulevard, which feeds the highway.
      Close loops; avoid dead ends.
   4. **Zone last, and only what `cs2_demand` supports.** Check `cs2_zoning` for empty cells first.
3. **Exact spacing, zero waste.** Zone cells are 8 m; lots are at most 6 cells (48 m) deep.
   - Small Road is 16 m wide, Medium Road 24 m.
   - Parallel small streets: **112 m** centre to centre (48 + 48 + 16).
   - Small street next to a medium road: **116 m**.
   - Back street behind a medium avenue's lots: 68 m from the avenue centre (12 + 48 + 8).
   - Blocks about 200–280 m long.
   - Check every service building with `cs2_prefab_info` and place it flush with `cs2_place_roadside`.
     Pack buildings so their widths fill the frontage.
4. **Pollution and waste.**
   - Industry goes **downwind** of homes, on land without groundwater.
   - Water comes from groundwater wells; sewage goes to the bay, away from the wells.
   - Power is renewable (wind now, solar when unlocked). Aim for the Zero Emission achievement.
   - Landfill, cemeteries and turbines go in the industrial zone, never beside homes.
5. **Highways and traffic.** Trucks reach the highway without crossing homes. Add a second interchange and
   bus lines as soon as they unlock. Run `cs2_traffic` when flow looks bad.
6. **Buy map tiles** when land, resources or the highway corridor run short (`cs2_list_map_tiles`, `cs2_buy_map_tiles`).
7. **Achievements.** Place every unlocked signature building (they are free), parks, districts and policies as they unlock.
   See the `cs2-achievements` memory.

## Review procedure

1. `cs2_ping`. If the game is not in `Game` mode, say so and stop.
2. Read `cs2_game_state`, `cs2_city_overview`, `cs2_budget`, `cs2_city_services`,
   `cs2_notifications` (limit 5; raise it only when a warning type needs locations), `cs2_demand`, `cs2_zoning`.
3. If the game is paused before a timed run's target, take a `cs2_screenshot`: a milestone or signature-building
   popup is probably open. Tell the user to close it (or call `cs2_dismiss_popups` if that tool exists).
   If the timed run has ended, restart it: `cs2_run_simulation` 48 hours at speed 8.
4. Fix what the numbers show, in this priority:
   1. **Utilities.** Power or water above 85% of capacity: add turbines or a groundwater pump.
      Never cut the electricity budget below 100% (it caused an outage).
   2. **Warnings.** Landfill "Facility Full", garbage, hearse or ambulance notices, crime, fires, burned-down lots
      (demolish them), air pollution on homes.
   3. **Services versus population.** Clinics, schools (elementary, high school), police, fire, cemeteries, parks.
      Check what the last milestone unlocked with `cs2_find_prefabs`.
   4. **Demand.** A zone type above 95% full with demand: build a new district in the four-step order above.
   5. **Budget.** A deficit with falling money: adjust taxes by 1–2 points or trim an over-provisioned service.
      Repay loans when the budget is clearly positive.
   6. **Traffic.** Bottleneck warnings, roads under 30% flow.
5. `cs2_save_game` with a descriptive name after meaningful changes.
6. Update the `cs2-sf-city-progress` memory with what was built (coordinates) and what is still locked.
7. Report in a few short bullets: state of the city, what you changed, what is blocked, what the user must do.

## Tool tips learned the hard way

- `cs2_connect_road` with `snap: 3` keeps exact coordinates. The default snap (8) jumps to nearby old junctions.
- Send build, demolish and placement calls **one at a time**. Parallel calls fail with "another build operation is in progress".
- Zone with `cs2_zone_area` circles of radius 90–110 placed between the streets. Keep circles away from
  frontages you want left empty; zoning only fills unoccupied cells.
- Segment ids change when a road is split. If `cs2_place_roadside` says "provide ?road=", look the segment up again
  with `cs2_road_graph` or `cs2_list_roads`.
- On a road heading +z, `side: right` is +x. On a road heading +x, `side: right` is −z.
- Wind turbines need about 140 m between them, and their rotors (60 m radius) must stay inside owned tiles.
  Roads cannot pass under a rotor.
- `cs2_gridmap` and `cs2_terrain` return files too large to read. Parse the saved JSON with a short
  `python -I -c` script and print only the region you need.
- New medium-density lots can take 8+ in-game hours to start building.
- The MCP cannot attach a power line to a building, so the outside high-voltage line stays unconnected.
- Milestone and signature-building popups pause the game. Only the user can close them unless `cs2_dismiss_popups` is loaded.

## Open problem to pick up (as of the last review)

The industrial smoke plume now drifts north-northeast over the office district, the west hill homes, the civic row
on the x=2220 avenue and the western half of the original grid (to about x 2800). Happiness fell to 44.
The user approved moving industry downwind. Stage 1 is built: a north industrial district at x 1940–2400,
z 3482–3810 (about 1,900 cells) on the 2220 avenue. Stage 2 has started: the industrial strip nearest homes (x 1920–2200,
z 1620–2100) was rezoned to Office Low. Rezoning occupied cells works: the game condemns and clears the old
buildings. Next review: confirm offices replaced the factories, check the north district is filling, check the
tax hit, re-measure the plume, and rezone the next strip west only if the plume still covers homes. Check the `cs2-sf-city-progress` memory for the latest status.
