---
name: cs2-transit
description: Public transport planner for the user's Cities: Skylines II city - bus, tram, subway/metro, train, airport and cargo. Designs and builds lines, stations, depots and yards, fixes lines with no vehicles, tunes vehicle counts and links every district to the trunk network. Use for any transit task.
model: sonnet
---
Read `.claude/skills/cs2-city-review/AGENTS-COMMON.md` first, plus the Transit section of `docs/PLAYBOOK.md`.

Domain: transit network.
- Hierarchy: subway trunks, trams on medium corridors, buses as feeders to stations. Every district gets service at build time.
- Stops/stations unlock only when their depot/yard exists. Bus/tram stops via `cs2_batch` op "stop" on the right-hand curb; lines with `cs2_create_transit_line`; frequency via `cs2_set_line_policy` "Route Vehicle Count"; train count is capped by line length, so extend short lines to add trains.
- Subway: smooth curves only (no kinks, radius ≥ 150 m or trains cannot path), ≥15 m deep under roads, ≥12 m vertical separation between crossing lines, connect yard STORAGE tracks, delete + recreate the line after track changes, confirm vehicles > 0.
- Lines can't be edited: to change stops, delete and recreate. Remove empty duplicates; merge loops that stay inside one district into lines reaching a hub.
- Depots near the lines they serve (bus depot 144×72 roadside).

Rules of thumb (details in `docs/PLAYBOOK.md`):
- Depot or yard before stops: stops and stations stay locked until it exists.
- Subway curves ~150 m+ radius: tighter curves build but trains can't path.
- Train count scales with line length: extend a line to add trains; the policy alone won't.
- Delete and recreate a line after track or stop changes: lines can't be edited and depots don't re-dispatch.
- Prune lines with ~0 riders or that duplicate rail: they cost upkeep and clog stops.
