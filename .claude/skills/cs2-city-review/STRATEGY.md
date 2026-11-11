# CS2 strategy reference

Read this with SKILL.md before a review. It combines community guides (researched November 2026) with
lessons learned in this city. Most web guides date from the 2023 launch; the economy was reworked in
patch 1.1.5f1 ("Economy 2.0", June 2024), so older tax and rent numbers may be wrong. Trust the
in-game numbers (`cs2_demand`, `cs2_budget`) over any guide.

## 1. Progression and development points

- **Check development points every review** (`cs2_dev_tree`; until the MCP server reconnects, use the
  bridge directly: `GET http://127.0.0.1:8642/city/devtree`). This city once sat on 36 unspent points.
  As a result, the hospital, highways, telecom, recycling and solar all looked "milestone-locked".
- Points come from milestones. Nodes need only their parent node, not other branches. Spend on what
  fixes a current problem, not "one of everything".
- Good order, matching community consensus and this city:
  1. Roads: Advanced Road Services (traffic controls).
  2. Highways and Large Roads.
  3. Roundabouts.
  4. Health: Hospital, Crematorium.
  5. Garbage: Recycling, Incinerator.
  6. Communications: Telecom Tower (internet complaints), Post Sorting Facility.
  7. Electricity: Advanced Electricity, then Solar (Zero Emission goal).
  8. Water Treatment Plant.
  9. Education: College, University.
  10. Welfare Office, Police HQ.
  11. Park Maintenance and Large Parks.
  12. Transport: Train; then Tram and Subway once there is density to serve.
- Still to buy as points arrive: Server Farm, Fire Station, Sports Parks, Harbor, Tram, Medical and
  Technical University, Parking Areas, City Hall, Intersections.

## 2. Money

- **"Paid Outside Services" (Import City Services) is a trap at scale.** At 13k people it cost about
  $2.17M a month and turned +$566k into −$1.63M. Keep it OFF, and build enough fire, police, clinics,
  hospitals and cemeteries instead.
- Since Economy 2.0 there are no government subsidies, and taxes affect demand more strongly. Move
  taxes 1–2 points at a time and watch the `Taxes` factor in `cs2_demand`.
- Loans are fine for a big one-off build (hospital $1.88M) when monthly income clearly covers the
  repayment. Repay when cash builds up.
- Upgrading an existing service is often cheaper than building a new one.

## 3. Land value, pollution and noise

- Land value decides what grows and how dense it gets. Services, parks, transit and low pollution
  raise it. Air, ground and noise pollution all suppress it, and pollution also lowers citizens'
  health.
- Industry, landfills and incinerators go downwind (smoke here drifts north-north-east) and on land
  without groundwater. **Re-measure the plume before every residential build.**
- Landfills are strong air polluters (this city's peaked at about 9,000). Move them downwind, and
  replace them with recycling and incineration as garbage grows. Higher-density and low-education
  households make more garbage.
- Noise: keep homes away from industry, turbines and busy arterials. Use shops or offices as a buffer
  strip between industry and homes. Road trees, sound barriers on highways, and small or pedestrian
  streets in neighbourhoods also help.

## 4. Traffic: modern real-world solutions

- **Road hierarchy, fewer conflicting junctions and bypasses work better than wider roads.**
  Extra lanes attract more cars.
- **Every district needs a second way out.** A single exit (here, the boulevard to one interchange)
  will choke. Give large districts their own collector straight to a highway ramp.
- **Grade separation.** Build interchanges with ramps and flyovers instead of at-grade highway
  junctions:
  - Left exits rarely fit between close carriageways. Use a **loop ramp** (cloverleaf style): exit
    right, turn 270° while climbing, cross both carriageways at a right angle about 13 m up, then
    come down into the street grid.
  - With `cs2_connect_road`, build the ramp in pieces and climb with `e2` on the pieces before the
    crossing. How the elevation parameters work (from `BridgeToolSystem.cs` and `BridgeRoadToolSystem.cs`):
    - `e1`/`e2` are metres **above the terrain** at that point, not absolute height. The curve follows
      the ground and is lifted by a linear blend from `e1` to `e2`. Over sloping ground, aim for clearance
      over the road below, not a fixed absolute height.
    - They apply only to **free** ends. An end that snaps to an existing node or segment takes that
      node's height and ignores `e1`/`e2`. Start a ramp snapped at grade (or to an elevated node), and end
      each piece free with `e2` set. The next piece snaps onto that new node and inherits its height.
    - Use `snap` 3–5 so the free elevated end isn't pulled onto a nearby ground junction. Never let a
      piece's start or end sit within snap range of the road you're crossing.
    - Keep each piece's climb gentle (about 6–8% grade, e.g. +6 m per 80–100 m) or validation fails.
      Reach about 13 m clearance before the crossing, cross mid-segment, then descend the same way.
    - Negative values make tunnels. An underpass needs the same ramp length below ground.
  - Cross mid-segment. A curve that passes through an existing node joins it at grade.
- **Freight bypass.** Industrial trucks must reach the highway without crossing neighbourhoods. Use
  a dedicated highway or arterial from industry to the highway, a cargo train terminal at each
  industrial hub, or a harbor. Several small cargo hubs beat one big one.
- **Roundabouts** keep traffic moving where a signalised junction would stop it. Space junctions out;
  don't put transit stops on corners.
- **Transit.** Transit lanes take an existing lane, so use them where frequent lines justify it. Run
  trams or metro along the busiest corridors; connect paths straight to stations.
- **Alternative intersections (FHWA; Texas DDI / U-turns, Michigan left, RCUT, continuous-flow).**
  They all remove left turns that cross oncoming traffic, cutting signal phases and conflict points
  (RCUT: 18 vs 32). Cheapest CS2 forms that worked here:
  - **One-way couplet:** two parallel avenues as `Medium Road Oneway` in opposite directions
    (same 24 m width, so no demolition; `cs2_replace_road` with `invert` sets direction). Every
    junction becomes 2-phase. Match it to tram/bus loop directions.
  - **Merge past the signal:** end a busy inbound ramp on the arterial ~60 m beyond the signalised
    junction (snap 2, or the game snaps it onto the junction), then set that merge node `nolights`.
  - **Second way in:** every district and industrial area needs two entrances to different points
    of the network (here: north industry via 2220 and 2500; west district to the bypass).
- **Measure over at least 8-12 in-game hours.** Flow values are period averages; a 4-hour check
  understates the effect of a change.
- **Draw the network.** Dump `/city/road-graph` (radius 2600) and render it with Pillow, coloured
  by flow, to see chokes and one-way directions before redesigning.
- **Tram tracks on roads** are a road upgrade (`cs2_upgrade_road` upgrades=tram), not a separate
  track network; drawing a Double Tram Track over a road builds nothing.
- **Stops and stations unlock when their depot exists.** Bus stops, tram stops and metro/train
  stations report "locked" until a Bus Depot, Tram Depot, Subway Yard or train depot is built,
  even after the development node is bought. Build the depot first, then place stops.
- **Active transport.** Bike greenways and pedestrian paths that link homes, schools and job
  centres take short trips off the roads. Chirper asks for bike lanes; road bike-lane upgrades are a
  separate unlock.

## 5. Happiness (wellbeing + health)

- Happiness combines wellbeing and health. The main levers are:
  - Health: clinics first, then a hospital; clean air and ground.
  - Education: there are five levels; elementary, high school, college and university each cover
    one.
  - Low crime: police coverage.
  - Working services: water, power, garbage, mail, internet.
  - Traffic flow.
  - Parks.
- **Read Chirper** (screenshot the panel, or ask the user to scroll it). It names the exact
  shortfalls, for example "crime", "packages taking ages", "no internet", "no bike lanes", "smog",
  "noise", "can't find a job".

## 6. Utilities at scale

- **Roads carry power and pipes.** Before closing or removing a road (for example a highway
  crossing), lay Low-voltage Ground Cables and Combined Large Pipes across the gap first, or whole
  districts lose power and water. This happened here: 820 buildings went dark.
- Wind output swings with the weather: here, rated 466 MW delivered only about 406 MW. Keep about
  25% margin over consumption, and add steady baseload (geothermal, or gas if accepted) as the city
  grows.

- **Trunk pipes.** Roads carry only small built-in pipes. Once the city passes about 10k people, add
  Large Water Pipe, Large Sewage Pipe or Combined Large Pipe trunks from pumps and outlets into each
  district. Here, a single Small Sewage Pipe was carrying the whole city's sewage.
- Treat sewage (Water Treatment Plant) before it reaches the bay, and keep outlets downstream of
  wells.

## Sources

- Economy 2.0 patch: [GamesRadar](https://www.gamesradar.com/games/city-builder/cities-skylines-2-finally-unleashes-its-huge-economy-20-patch-with-reworked-rent-and-a-fix-for-death-waves-but-itll-also-kill-a-bunch-of-your-citizens), [Paradox dev diary, economy part two](https://www.paradoxinteractive.com/games/cities-skylines-ii/news/dev-diary-economy-part-two)
- Development tree: [Shacknews](https://shacknews.com/article/137520/cities-skylines-2-best-development-upgrades), [Prima Games](https://primagames.com/tips/best-development-tree-unlocks-cities-skylines-2), [VideoGamer](https://www.videogamer.com/guides/cities-skylines-2-development-tree-points)
- Traffic: [Prima Games](https://primagames.com/tips/how-to-manage-traffic-cities-skylines-2), [gameplay.tips](https://gameplay.tips/guides/cities-skylines-ii-traffic-guide.html), [positioniseverything](https://www.positioniseverything.net/how-to-fix-traffic-jams-and-gridlock-in-cities-skylines-original-and-ii/), [Steam discussion](https://steamcommunity.com/app/949230/discussions/0/4030223299336614187)
- Cargo: [Paradox: public cargo transportation](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/public-cargo-transportation), [Paradox: Bridges & Ports dev diary](https://www.paradoxinteractive.com/games/cities-skylines-ii/news/bridges-and-ports-dev-diary-ports), [Steam discussion](https://steamcommunity.com/app/949230/discussions/0/4202489789153796692)
- Pollution and garbage: [GamesRadar pollution guide](https://gamesradar.com/cities-skylines-2-pollution-guide), [VideoGamer garbage guide](https://www.videogamer.com/guides/cities-skylines-2-garbage), [Stealth Optional noise guide](https://stealthoptional.com/guides/cities-skylines-2-noise-pollution/)
- Happiness: [Paradox: citizen simulation](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/citizen-simulation-lifepath), [Prima Games](https://primagames.com/gaming/how-to-increase-citizen-happiness-in-cities-skylines-ii)
