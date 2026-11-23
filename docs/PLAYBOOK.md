# Cities: Skylines II playbook

City-agnostic rules learned building a ~195k-population city through this repo's MCP bridge.
Each rule carries its reason. Coordinates and entity ids of a specific city belong in that city's
memory notes, not here. For a fresh map, follow [NEW-CITY-CHECKLIST.md](NEW-CITY-CHECKLIST.md).
Research background and sources: [STRATEGY.md](../.claude/skills/cs2-city-review/STRATEGY.md).
Beginner-stage practices also draw on City Planner Plays, "The New Ultimate Beginners Guide to Cities Skylines 2" (post-Economy 2.0).

Trust in-game numbers (`cs2_demand`, `cs2_budget`, `cs2_traffic`) over any guide: the economy was
reworked in patch 1.1.5f1 (Economy 2.0, June 2024) and many web guides predate it.

## 1. New-city bootstrap (first ~50k people)

0. **Choose the map carefully:** climate, hemisphere and natural resources are fixed for good.
   Prefer maps with fertile land, ore and oil.
1. **Site analysis before any road.** `cs2_terrain` (water, slopes; in-game contour lines are 10 m
   apart, close together = steep), `cs2_gridmap groundWater`, `cs2_list_map_tiles` (features).
   Find the outside highway, high-voltage line and water edges. There is no wind tool: once
   industry runs, read the drift from `cs2_gridmap airPollution`.
2. **Pick zones by site.** Homes upwind and away from the shore outlet; industry downwind, away
   from the aquifers you will pump (aquifers often touch, so pollution spreads), with a direct truck
   route to the highway. **Don't build over fertile, ore or oil land:** local extraction makes goods
   cheaper, speeds level-ups and raises profits. Reserve a utility strip (turbines, landfill, pumps)
   away from homes.
   Map-provided roads have no upkeep until upgraded; new roads add upkeep, so pause the game while
   laying out.
3. **Infrastructure before zoning:** highway link, power, a groundwater pump upstream, a sewage
   outlet downstream of every well.
4. **Road skeleton first, grid second.** Lay the main avenue/collector loop from the highway
   exit, then the 112 m local grid inside it (section 2). Plan a second exit from day one.
5. **Zone only to demand** (`cs2_demand`), starting with low-density homes, local shops and basic
   industry. Check `cs2_zoning` for empty cells first: empty zoned lots suppress demand.
6. **Services ahead of growth:** clinic, elementary school, police, fire, landfill, cemetery as each
   unlocks. Never switch on Import City Services (section 9).
7. **Spend development points every milestone** (`cs2_dev_tree`). Many "locked" buildings are
   dev-tree nodes, not milestones.
8. **Transit as soon as depots unlock;** every new district gets a line at build time.
9. **Save under a new name after each milestone and before every big change; verify on disk.**

## 2. Grid, spacing and hierarchy

- Zone cells are 8 m; lots are at most 6 cells (48 m) deep. Small Road 16 m, Medium Road 24 m.
- Parallel Small streets **112 m** apart (48+48+16); Small next to Medium **116 m**; Medium next to
  Medium **120 m**. Align new rows with the neighbouring district's coordinates.
- The 112 m pitch is roughly "Barcelona" block size: it balances walkability, traffic and room
  for large buildings. Follow the terrain; small imperfections are fine.
- Blocks 200–280 m long; T-junctions ≥ 60 m apart, no junctions within 30 m of each other; every
  street joins at both ends (no dead ends, no stubs).
- Plan the hierarchy deliberately: local streets → collectors (one-way couplets for local flow
  where useful) → a central Medium arterial carrying regional traffic toward future interchanges.
- Hierarchy: Small → Medium collector → arterial → highway. Only collectors and arterials meet
  arterials. Keep collectors Medium; an over-wide side road (Large) gets equal priority with the
  arterial it meets and queues the main flow.
- Every district needs **two entrances** to different points of the network, so one junction
  failing does not cut it off.

## 3. Highways and arterials

- **Arterials cross highways grade-separated about every 500 m** (overpass or tunnel), so cross-town
  trips stay off the highway. A highway that splits the main boulevard into right-in/right-out
  stubs pushes every cross-town trip onto the highway: the root cause of city-wide jams.
- **Highway access only at real interchanges, about 1 km apart.** No at-grade Ts on a highway.
- **Never connect local streets to a highway.** End them as cul-de-sacs ~20 m short and route them
  through a collector.
- **Lane balance at merges:** lanes out = lanes in. 2+2 → 4 works; 3+2 → 4 queued badly. Widen the
  carriageway after a merge, and give busy ramps 2 lanes (a 1-lane flyover carrying ~400 vehicles
  was the real limit behind a chain of queues).
- **Fixing queue heads one at a time just moves the jam.** Find the network cause (missing
  crossings, a lane drop, two lit junctions close together) before widening.
- Two signalised junctions < 40 m apart jam; merge them into one. Removing lights at tight Ts where
  flows cross caused accidents: keep them there.
- End a busy on-ramp ~60 m past a signalised junction and set that merge node `nolights`.
- A one-way couplet (two parallel `Medium Road Oneway` in opposite directions) makes every junction
  2-phase without demolition.
- Dead-end stubs off ramps attract U-turners that block the ramp: remove them.
- Freight: trucks reach the highway without crossing homes (dedicated arterial, cargo rail, harbor).
  Consider the Heavy Traffic Ban policy in residential districts.
- Measure over 8–12 in-game hours: `cs2_traffic` flow is a period average. Use `cs2_vehicles`
  queue heads at peak to find the real choke.

### 3a. Real-world freeway design (apply to every interchange)

Distilled from US highway design practice: the FHWA interchange principles (Richard & Lichty), the
AASHTO Green Book §10.9 (lane balance, basic number of lanes), Caltrans Highway Design Manual ch. 500,
and TxDOT Roadway Design Manual ch. 15. The user wants interchanges that look and flow like real ones.

- **Ramps are one-way and join on the RIGHT.** Each movement gets its own one-way ramp
  (`Highway Oneway - 1/2 lanes`): it leaves the carriageway on the right at a shallow angle and
  joins on the right at a shallow angle. No two-way ramps. No left exits or left entries. No ramp
  that crosses the opposite carriageway at grade. No traffic lights or junctions on the mainline.
- **Diamond (the default service interchange), for a highway crossing an arterial:**
  - **Off-ramps leave BEFORE the bridge:** each direction exits upstream of the crossing street.
    - Eastbound: SW quadrant.
    - Westbound: NE quadrant.
  - **On-ramps join AFTER the bridge:** each direction merges downstream of it.
    - Westbound: NW quadrant.
    - Eastbound: SE quadrant.
  - All four ramp terminals sit on the crossing street, on either side of the bridge. Use lights at
    the terminals, or roundabouts if they fit.
  - **Diverge before merge:** exits come before entries, so there is no weave through the
    interchange.
  - Reference build: beltway I6 at Bedford St (x≈-1460, z≈850).
- **Spacing:**
  - Service interchanges about **1.5 km apart in the city** (US urban "1 mile", which is about
    1.6 km) and **3 km+ in open country**.
  - Closer than about 1 km makes the entering and exiting traffic weave and jam. Where two
    interchanges must be closer, use a **collector-distributor road** (parallel one-way roads that
    carry the exits and entries) or **braided ramps** (one ramp flies over the other).
- **Lane balance and basic lanes:**
  - At a diverge, lanes in = lanes out − 1. At a merge, lanes out = lanes in − 1 at most; never more
    than one lane dropped at a time.
  - Keep the through carriageway's basic lane count constant across the interchange, and drop
    lanes only after the last ramp.
  - Busy ramps (above about 300 vehicles) get 2 lanes, with a 2-lane exit or merge.
- **System interchanges (highway to highway):** use stamps, never at-grade.
  - Trumpet for a T-junction of highways.
  - Stack, turbine or partial cloverleaf for a full crossing.
  - Avoid a full **cloverleaf** under heavy load, because its loop ramps weave.
- **Ramp terminal spacing on the arterial:** keep the next signalised junction about 120–200 m+
  from a ramp terminal. Give the arterial a median (Large Road Divided) near interchanges so turns
  don't block through lanes.
- **Arterial access management:** signals about 400–800 m apart on arterials, and no driveways or
  small streets within about 100 m of an interchange.
- **Freeway end:** never end a freeway in a lit T. Taper it into an arterial through a proper
  terminal, or carry it on to the next interchange.

## 4. Junction and bridge techniques

- **Roundabouts:** `cs2_place_roundabout` on a junction id from `cs2_road_graph`; pick a size
  (`cs2_find_prefabs` netobject `round`) that fits between neighbouring junctions and buildings.
  Placing one on a junction that has one replaces it.
- **To remove a roundabout, demolish all its legs** (that removes the node) and redraw the roads.
- **Intersection stamps** (Intersections dev node, `cs2_find_prefabs` category `stamp`) occupy their
  full footprint box (240–1600 m); they only fit open land. Try rotations; failed placements cost
  nothing. **Never demolish a stamp piecewise:** leftover ghost pieces block later builds, even
  after reload. Demolish via its owner.
- **Widening clears what it overlaps:** `cs2_replace_road` to a wider prefab can clip lots,
  depots, hospitals or subway yards. Check `cs2_buildings_near` along the road first.
- **Bus stops block road widening** and `cs2_demolish` refuses them. Keep stops off arterials you may
  widen; put them on collectors, mid-block, not on corners.
- **Flyovers with `cs2_connect_road`:**
  - `e1`/`e2` are metres **above terrain**, applied only to free (unsnapped) ends; a snapped end
    takes the node's height. Build in pieces: each ends free at its `e2`, the next snaps onto it.
  - `snap: 3–5` so a free elevated end isn't pulled onto a ground junction.
  - Climb ≤ 6–8% (about +6 m per 80–100 m); reach ≥ 10–13 m clearance before the crossing.
  - Cross mid-segment: a curve through an existing node joins it at grade.
  - **Keep each span over a highway ≤ 60 m**, or the game drops a pillar between carriageways and
    the build fails.
  - Negative `e` builds tunnels; go ~12–20 m deep under roads.
  - Check `cs2_list_roads` (prefab `High-voltage Line`) for pylons first: a pylon on the alignment
    fails flyovers (OverlapExisting / SteepSlope); a tunnel can pass under it.
- Lots touching a junction corner fail validation; keep buildings clear of corners.

## 5. Transit

- **Depot before stops.** Bus stops, tram stops and subway/train stations report "locked" until a
  Bus Depot, Tram Depot, Subway Yard or train depot exists, even with the node bought.
- Hierarchy: subway/train trunks, trams on medium corridors, buses as feeders into stations.
- **Tram on a road is a road upgrade** (`cs2_upgrade_road` upgrades=tram); drawing tram track over
  a road builds nothing.
- **Subway track:**
  - Curves need ~**150 m+ radius**; tighter S-bends build fine but trains can't path
    (PathfindFailed). Put the curve's control point on the intersection of the tangents.
  - No kinks: chained straights meeting at 40–60° look connected but don't work.
  - 15–20 m deep under roads; ≥ 12 m vertical separation where lines cross.
  - Wind-turbine rotors block even underground track.
  - Connect the yard's **storage tracks** to the line, or the line gets 0 vehicles.
  - Unpowered stations stop service: keep power margin.
- **Train count scales with line length.** A short line caps at ~3 trains whatever the policy; to
  add capacity, extend the line (a 6.7 km line ran 4 trains, 9.7 km ran 6).
- **Lines can't be edited:** after track or stop changes, delete and recreate the line so the depot
  re-dispatches, then set the Route Vehicle Count policy (`cs2_set_line_policy`;
  `cs2_set_line_vehicles` only picks the model). Confirm vehicles > 0.
- Delete lines with ~0 riders or that duplicate a rail line; merge loops that stay inside one
  district into lines reaching a hub.

## 6. Power

- **Night is the binding constraint:** wind and solar output drop; measure load at night/evening,
  not midday. Keep ≥ 20–25% margin and add generation at > 80% night load.
- **Electricity service budget 120% adds ~15% output** cheaply; try it before building. Never cut
  it below 100% (caused an outage).
- **Wind turbines only via `cs2_place_roadside`**: placed by x/z they face away from the road and
  stay "Powerline Not Connected". Space them ~140 m; rotors (60 m radius) stay inside owned tiles,
  off roads and tracks. Build a dedicated small-road turbine field, not beside homes.
- **Big plants (solar, geothermal, incinerator, batteries) need a high-voltage hookup.** Put a
  TransformerStation **right beside** each plant, one short HV hop; roads carry low voltage onward.
  Long HV lines through town are impossible: pylons can't stand on roads or built lots.
  `cs2_route_power_line` routes a line around buildings; use it for hops over open land.
- Early game, wind beats small coal: no workers and lower upkeep. Turbine upgrades (solar assist,
  battery extension, advanced rotor) add output on the same land when space gets tight.
- Where the map's high-voltage line reaches the edge, a transformer there imports power.
- Solar needs a long clear frontage (288×552 lot). **Geothermal needs a geothermal hotspot**
  (map resource), not just groundwater; it fails everywhere else.
- Zero-emission goal: no gas/coal.

## 7. Water, sewage, garbage and utilities

- **Roads carry power and small pipes. Before removing a road, check what it carries.** Removing
  highway crossings once cut a wind farm off (820 buildings dark). Lay Low-voltage Ground Cable and
  Combined Large Pipe across gaps first. **Highways carry no water or sewage** by default, so
  districts reached only by highway need pipes laid separately.
- A river/ocean water pumping station gives ~3× a water tower's output for much less upkeep;
  intake upstream, sewage outlet downstream.
- Past ~10k people, add trunk pipes (Large Water / Large Sewage / Combined Large) from pumps and
  outlets into each district; road pipes are small.
- Pumps on clean groundwater, upstream; outlets downstream; never pump near landfills (they poison
  the aquifer). Treat sewage before it reaches the shore.
- **Orphaned pipes and cables** left after a rebuild raise Pipeline/Powerline Not Connected
  warnings: remove them.
- Garbage: spread landfill/recycling/incinerator capacity across the city; all-in-one-corner left
  the far side short. Replace landfills with recycling and incineration as the city grows.
- **Never let a landfill fill up:** collection stops and pumps (and coal plants) lose output.
  Rebuild a "Facility Full" landfill or cemetery in place (demolish + place) to reset it.
- Crematoriums beat cemeteries on space and upkeep. Start with the small clinic and small police
  station. Place services just off arterials, not on them.

## 8. Pollution and zoning

- Industry, landfills and incinerators downwind and off groundwater; a shop/office buffer strip
  between industry and homes. Re-measure the plume before each residential or civic build; it
  grows with industry.
- **Rezoning occupied cells condemns them;** the game clears and regrows. Works for moving industry
  or densifying, but do it block by block with a rollback save and keep housing demand covered.
- **Zone circles must stay inside one block** (radius ≤ half block depth from the street). A circle
  reaching across an avenue rezones and condemns the far side.
- Zoning over existing zoning rezones it, which is easy to do by accident.
- One zone type per block face; commercial/mixed on collectors and arterials, residential inside,
  office/industry as buffers. Densify near subway/tram stops in 2-row stages.
- Commercial wants passing car and foot traffic (main streets); offices like being near, not on,
  major roads; low-rent housing goes close to amenities. Each residential density has its own
  demand bar.
- Lot size sets building size: size lots on purpose (e.g. 6×6 for big factories, 2×2 for small
  warehouses).
- Control which street buildings front: leave block ends unzoned at first and fill them once the
  rest has grown. A footpath along a block edge straightens the zoning grid.
- Parks drive building level-ups (more tax): add them early, not as an afterthought.
- New medium-density lots can take 8+ in-game hours to start building.
- Noise: keep homes off highways, industry and turbine fields; pedestrian/small streets and parks.

## 9. Economy and progression

- **Import City Services (Paid Outside Services) is a trap:** at 13k people it cost ~$2.2M/month
  and flipped the budget to a deficit. Keep it OFF; build your own services.
- Move taxes 1–2 points at a time and watch the `Taxes` factor in `cs2_demand`. Residential,
  commercial and industrial tolerate 10–12%; office demand drops above ~8–9%.
- Avoid loans early. Later they're fine for a planned big build when income covers repayment.
- Moving buildings costs real money; place them right the first time.
- Use the production-chain view: filling a local shortfall (e.g. a farm for a missing good) cuts
  costs and earns exports.
- Upgrading or raising a service budget is often cheaper than a new building (garbage 140% fixed
  coverage gaps).
- **Milestones are XP-based** (`cs2_milestones`). Passive XP from population + happiness dominates
  at scale; milestones 11–20 unlock no buildings, only money, dev points, permits, loan limit.
- Dev-point order that worked: road services → highways/large roads → roundabouts → hospital,
  crematorium → recycling, incinerator → telecom, post sorting → advanced electricity, solar →
  water treatment → college/university → transit (train, tram, subway) → intersections.
- Buy tiles when a planned district or corridor needs them, not before: tile upkeep is heavy
  (`cs2_list_map_tiles`, `cs2_tiles_info` for cost). Keep some permits.
- Spend dev points on what you will place soon. Signature buildings are free: place them as soon
  as they unlock.
- Happiness levers: clinics/hospital, clean air, education, police, working utilities, traffic,
  parks. Read Chirper (screenshot while the panel is open) for exact complaints.

## 10. Operations (tool use)

- **Verify every save on disk.** `cs2_save_game` is async and can fail silently; an unverified save
  once lost a subway line. Check the Saves folder
  (`$USERPROFILE/AppData/LocalLow/Colossal Order/Cities Skylines II/Saves/`) and re-save under a new
  name if missing. Save a rollback before big road work.
- **Entity ids renumber on load.** Never reuse ids from an earlier session; look them up again.
  Segment ids also change when a road is split.
- **One build call at a time**, or `cs2_batch` for several (parallel calls fail with "another build
  operation is in progress").
- `cs2_connect_road` with `snap: 3` keeps exact coordinates; the default 8 jumps to old junctions.
- **Placement replaces whatever is on the lot,** and dry runs don't detect it. Check
  `cs2_buildings_near` first; try candidate sites one at a time, stop at the first success.
- Place services with `cs2_prefab_info` (size) + `cs2_place_roadside`, flush and packed.
- On a road heading +z, `side: right` is +x; heading +x, `side: right` is −z.
- `cs2_gridmap` / `cs2_terrain` return large files: parse with `python -I -c` and print only your
  area (256×256 row-major [z][x], worldMin −7168, cellSize 56).
- Start reviews with one `cs2_city_digest`; use filtered `cs2_road_graph` calls (small radius,
  `street`/`query`).
- Reward popups pause the game: `cs2_run_simulation` auto-dismisses them, or `cs2_dismiss_popups`.
- A road that looks like a dead-end stub may be a large building's only access; check before removing.
- Real simulation: never `force: true`.
- **Saves can fail silently.** A tiny (~1.4 KB) autosave appearing instead of your named save means
  it failed. Save again under a new name and `ls` the Saves folder every time.
- `cs2_demolish` of a ramp can fail with InvalidShape. Workaround: `cs2_replace_road` it to a one-way
  prefab with `invert` so it becomes a useful ramp, then demolish the leftover stub.
- Auto-mode permission rules may block `cs2_place_transit_stop` / batch `stop`; reuse existing stops
  or ask the user to allow the tool.

## 11. Running a big build with parallel agents

- **Plan first, then fan out.** Write a short master plan, then give each agent a disjoint region:
  - the trunk highway and its interchange spacing;
  - land use per area: homes upwind, industry downwind on resource tiles, offices as buffers;
  - where utilities go;
  - transit;
  - a money floor.

  Overlapping agents undo each other's work.
- Every agent prompt includes:
  - its region bounds, and what the other agents are doing;
  - "do not save, do not run/pause the sim" (only the lead does that);
  - a budget, and a city-money floor (e.g. ≥ $40M);
  - the PLAYBOOK sections that apply (§2 grid, §3/§3a highways);
  - "ids were renumbered on load, re-read them";
  - token efficiency: plan, then `cs2_batch` (≤ 60 ops), filtered graph reads, and one audit at
    the end.
- **The lead verifies each report in the game** (one targeted check: warnings, queue heads or the
  road graph) before logging it. Reports can overstate.
- An agent stopped early leaves partial work, typically roads and zones with no services or
  transit. Log what's missing and finish it next round.
- Stop agents cleanly near usage limits. Message each one to leave the network consistent (no
  half-built ramps), then save and verify on disk.

## 12. Lessons from scaling a 200k city

- **Overpass over a 4-lane highway**, from an existing junction: piece 1 to a free end about 15–30 m
  short of the highway edge at e≈11. Piece 2 crosses the highway mid-segment at e≈11, with its
  pillar ≥ 25 m from the highway centreline. Piece 3 lands at e 0. About 8 m clearance passes
  validation.
- **Water bodies fail road pieces with InWater.** Build a grid as one piece per node-to-node link, so
  failures only hit the water cells. Then remove the stubs that are left dead-ending into the water.
- **Bus depots cap how many buses run.** When lines show 0 vehicles or "No Vehicles" warnings, add
  BusDepot01 (or its Extra Garage), and trim the vehicle count (60–100%) on short or empty lines.
- **Spiderwebbing (50 lines):** add short feeders, at least two per subway station, plus 2–4 per new
  district, instead of empty filler lines.
- **Smog sources inside housing.** A crematorium inside a high-rise block produced a local
  air-pollution peak. Deathcare and industry belong outside residential blocks.
- **Dense industry is noisy.** It produces noise warnings about 250 m into neighbouring homes. Parks
  do not absorb noise. Keep about 300 m of offices or parks between industry and housing, and plan
  that buffer up front.
- **Outside power line, incinerators and batteries:** a TransformerStation01 right beside each, with
  one short high-voltage hop (`cs2_route_power_line` to go around lots). When an overhead line fails
  with NotEnoughClearance (plant lot well below the road), use a High-voltage Ground Cable.
- **Subway yard storage tracks** need their own track link back to the line, or they show
  No Train Access.
- **Surface water pumps need deep water.** Shallow marsh lakes don't work. Groundwater pumps on a
  clean aquifer are the reliable choice.
- **Desalination** needs a sea shoreline with road access. Check for high-voltage lines and rail
  along the coast first.
- **Check development points after every milestone.** Points pile up unspent. Prefer clean or
  unique unlocks (desalination, research buildings) over polluting ones (gas, coal).
- **Achievements:**
  - Take the ≥ $200k loan (The Deep End) while the sim is running.
  - Calling the Shots needs locked policies unlocked first (prison, hazardous-waste site, and so
    on).
  - Districts with policies, signature buildings, parks and trees are cheap wins: do them early.
- **Zone names:** use one family consistently (e.g. the `NA ...` zones). Mixing in "Residential
  Low" creates a second, separately counted zone type.
