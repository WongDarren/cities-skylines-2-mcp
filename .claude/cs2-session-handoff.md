# CS2 "San Francisco" handoff (paste into a new session)

I'm playing Cities: Skylines II through this repo's CS2 MCP (`mcp__cs2__*` tools). You act as my mayor.
Load the project skill `cs2-city-review` (`.claude/skills/cs2-city-review/SKILL.md`) before reviewing. There is also an agent, `.claude/agents/cs2-mayor.md`.
Only review the city when I ask ("review city"). **Never schedule loops or crons**: I'm on a token budget that resets every 5 hours.
Your memory notes (`cs2-sf-city-progress` and others) may also be loaded. If they differ from this file, the newer one wins.

---

## 1. Design brief (agreed at the start)

- **Real simulation.** Unlimited Money is OFF. Never pass `force: true`; progress through milestones.
- **Be the whole city staff.** I'm not a city planner, so cover everything a great city needs without being told: utilities, pollution and waste, schools, health, police, fire, parks, transit, walkability, tourism, trade and economy.
- **Precise and space-efficient. Waste nothing.**
  - Zone cells are 8 m, and lots are at most 6 cells (48 m) deep.
  - Small Road is 16 m wide, Medium Road 24 m.
  - Parallel small streets: **112 m** centre to centre. A small street next to a medium road: **116 m**.
  - Check every service building's size with `cs2_prefab_info`, place it flush with `cs2_place_roadside`, and pack widths so they fill the frontage.
- **City Planner Plays order for every new district:**
  1. **Site analysis.** Terrain, groundwater, and the air-pollution plume (the MCP has no wind tool; read the drift from the plume). **Re-measure the plume before every residential or civic build**: it grows as industry grows.
  2. **Infrastructure first.** Power, water, sewage, highway link.
  3. **Road hierarchy.** Local street → collector/avenue → boulevard/arterial → highway. Close loops; blocks about 200–280 m long.
  4. **Zone last, only to demand** (`cs2_demand`, `cs2_zoning`).
- **Pollution and waste.**
  - Industry goes downwind of homes (the wind blows smoke north-northeast) and on land without groundwater.
  - Drinking water comes from groundwater wells; sewage goes to the bay, away from the wells.
  - Power is renewable (wind now, solar when unlocked).
  - Landfill, cemeteries and turbines go in industrial areas, away from homes.
- **Use highways well.** Trucks reach the highway without crossing neighbourhoods. Add a second interchange and bus lines as soon as they unlock.
- **Buy map tiles** when land, resources or the highway corridor run short.
- **Get every achievement** (46 in total). I installed the Achievement Fixer mod. Place free signature buildings, parks, districts and policies as they unlock.

## 2. City state (game date 2027-01-03)

- **People and money:** 13,471 residents, happiness 42, health 56. Money about $1.96M; budget about **+$566k per month**. No loan (a 200k loan was taken and repaid, for "The Deep End").
- **Taxes:** residential 12%, industrial 11%, others 10%. All service budgets at 100%. **Never cut electricity below 100%** (it caused an outage).
- **Policy on:** "Paid Outside Services" (Import City Services).
- **Milestone:** "Busy Town". 15 tiles owned; about 36 permits left.
- **Still locked:** highways, large roads, bus stops, hospital, recycling, incinerator, university, solar, high-density zones.
- **Latest save:** `SF-police-landfill3`. Earlier rollback points: `SF-southwest-lowrent`, `SF-before-landfill-swap`, `SF-landfill-moved`, `SF-stage3-offices`, `SF-before-stage3`.
- **Utilities:**
  - Power: about 388 MW made, 234 MW used.
  - Water: 41k used of 79.5k.
  - Sewage: 41k of 100k.
  - Garbage accumulation: about 485k.

### What is built and where

World coordinates are in metres; +z is north, +x is east. The highway exit is in the south-east, at about (3275,1603).

- **Boulevard (Medium Road)** at z=1728, from x 1000 to 3180, feeding the highway exit.
- **Original grid:**
  - Medium avenues at x=2500, 2780 and 3040.
  - Small streets at z=1844, 1956, 2068, 2180, 2292 and 2404.
  - Low-density homes, with shops on the boulevard frontage.
- **North districts:**
  - Avenues x=2220, 2500 and 2780, plus the waterfront drive at x=2990.
  - Medium collector loops at z=2856 and 3312.
  - Small streets at 2516, 2628, 2740, 2972, 3084 and 3196.
  - Low-density homes.
- **West hill district:** x 2220–2490, z 2404–3312 (homes). Back street at x=2432.
- **South medium-density district** (tile 2493,1246):
  - Avenues x=2220, 2500 and 2780.
  - Streets at z=1612, 1500, 1388, 1276 and 1164; medium collector at z=1048.
- **South-west district** (tile 57608, x 1558–2181, z 935–1558):
  - Streets at z 1500, 1388, 1276 and 1164 run west from the 2220 avenue to x=2000, with a closing road at x=2000.
  - Zoning: LowRent housing (z 1276–1500), low-density homes (z 1164–1276 and south of 1164), shops on the north side of z=1500.
  - The unused outside high-voltage line runs north–south at x about 1950 and blocks roads.
- **Offices:**
  - The original office district at x 2212–2424, z 1740–2400.
  - The **former western industry**, now Office Low: x 1650–2200, z 1620–2100.
- **Industrial district 2** (still industry): x 1000–1650, z 1728–2068, plus the boulevard's south frontage.
- **North industrial district** (full):
  - The 2220 avenue extended to z 3760.
  - Streets at z 3536 (x 1760–2400), 3648 (x 1940–2400) and 3760 (x 2080–2400); end roads at x 1940, 2080 and 2400.
- **Wind farm:** about 30 WindTurbine01.
  - Columns at x 1020, 1170 and 1318, z 2150–2724.
  - More along the x=1650 road, at x 1630 (z 1774–2295).
  - On the boulevard's south side at x 1224 and 1372.
  - Two at x 1020 (z 1786 and 2012), one at (1322,2023), and the first at (3240,2170).
- **Water:** groundwater pumps at (3136,2118) and (3296,2118). Sewage outlet at (3291,2440) on the bay.
- **Garbage:** Landfill #1 at (1726,1656), rebuilt fresh. Landfill #2 at (2468,3648) and Landfill #3 at (1857,3604), both north and downwind.
- **Health:**
  - Clinics at (2722,2100), (2184,2456) and (2570,1012).
  - Cemeteries at (2464,2572) and (1560,1692).
- **Education:**
  - Elementary schools at (2360,2900) and (2176,2580).
  - HighSchool01 at (2144,2952).
- **Safety:**
  - Police at (3030,2572), (2180,3140) and (2160,1424).
  - Firehouse at (3022,2686).
- **Civic row**, on the west side of the 2220 avenue: clinic, elementary school, five parks between z 2680 and 2840, the high school, and a police station. Free frontage remains between z 3196 and 3312.
- **Signature buildings** (4 of the 5 needed for "Making a Mark"):
  - Polaris Suites at (3128,2178).
  - Rubique Apartments at (3034,3004).
  - Rock Musician Mansion at (3034,3048).
  - CCP5 tower at (3018,2800).

## 3. Open problems and next steps

1. **Happiness is 42.**
   - Air pollution is solved: 0 over the main grids, about 1,500 on the civic row.
   - Remaining causes: crime (rate 69 before the two new police stations), garbage (6 warnings, 2 "Facility Full"), and few clinics (hospital locked).
   - **Next review:** confirm crime and garbage dropped and happiness recovered.
2. **Demand:** shops and offices are both at 100. Zone more on clean land. Re-measure pollution first.
3. **Traffic:**
   - Bottlenecks on the boulevard at (2195,1777) and (2504,1692).
   - The single highway interchange is the main limit: add a second one when highways unlock, and bus lines when bus stops unlock.
4. **When they unlock:** hospital, recycling or incinerator (garbage is heavy), university.
5. **Achievements:**
   - Place a 5th signature building when one unlocks.
   - Districts and policies are still to do ("Executive Decision", "Wide Variety", "Calling the Shots").
   - Things I have to do by hand: photo mode, open every info view, follow a citizen, listen to the radio, use the map editor.

## 4. MCP repo changes (uncommitted)

- `mcp-server/src/index.ts` and `CS2MCP.Bridge/HttpBridgeServer.cs`: spaces in names are now decoded properly; zone names had been breaking.
- `CS2MCP.Bridge/RequestHandlers.Placement.cs`: the shoreline search widens its radius, so the sewage outlet can be placed.
- `CS2MCP.Bridge/BridgeSystem.cs`, `RequestHandlers.Meta.cs`, `RequestHandlers.cs` and `index.ts`: new `cs2_dismiss_popups` tool, and automatic popup closing during `cs2_run_simulation`. **Untested;** it needs a game restart to load. Milestone and signature popups pause the game until I click them.
- New `.claude/skills/cs2-city-review/`, `.claude/agents/cs2-mayor.md` and this handoff file.
- Known MCP gap: power lines can't be attached to buildings, so the outside high-voltage line stays unconnected.

## 5. Tool tips

- `cs2_connect_road` with `snap: 3` keeps exact coordinates (the default snap of 8 jumps to old junctions).
- Send build, demolish and placement calls one at a time (parallel calls fail with "another build operation is in progress").
- Rezoning occupied cells works: the game condemns the old buildings and clears them within minutes.
- **Keep zone circles at least 30 m short of an avenue's far side.** A circle that reaches across rezones the occupied lots there, and the game condemns them.
- Segment ids change when roads split. Look them up again with `cs2_road_graph` when `cs2_place_roadside` complains.
- Roadside sides: on a road heading +z, `right` is +x; on a road heading −x, `right` is +z.
- Wind turbines need about 140 m spacing and rotors inside owned land; roads can't pass under rotors.
- `cs2_gridmap` and `cs2_terrain` outputs are too large to read. Parse the saved file with a short `python -I -c` script and print only the region you need.
- New medium-density or industrial lots can take 8–14 in-game hours to start building.
