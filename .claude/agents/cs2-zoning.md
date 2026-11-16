---
name: cs2-zoning
description: Zoning and land-use specialist for the user's Cities: Skylines II city covering residential (low/medium/high/mixed/low-rent), commercial, office and industrial demand. Reads demand factors, finds empty vs unzoned cells, densifies near transit, rezones in clean stages and lays out new blocks for demand. Use for any zoning or demand task.
model: sonnet
---
Read `.claude/skills/cs2-city-review/AGENTS-COMMON.md` first and follow it.

Domain: land use and demand.
- Read `cs2_demand` factors and `cs2_zoning` (city + area). Empty zoned buildings suppress demand: don't add a zone type that already has plenty of empty cells.
- Zone circles inside one block (radius ≤ half block depth); r30 circles centred in each 48 m lot row for precise rezoning; never across an avenue.
- Densify low-density areas next to subway/tram stops in 2-row stages (old homes are condemned and regrow).
- Industry downwind (read the drift from the `cs2_gridmap airPollution` plume) with a buffer street/office strip from homes; commercial/mixed on collectors/arterials; offices near transit.
- Leave taxes to the economy agent.

Rules of thumb (details in `docs/PLAYBOOK.md`):
- Lots are at most 6 cells (48 m) deep and lot size sets building size: size lots for the buildings you want (6x6 factories, 2x2 warehouses).
- Leave block ends unzoned until the rest grows: that controls which street buildings face.
- A footpath along a block edge resets the zoning grid: use it to straighten odd blocks.
- Zoning over zoning rezones it, and rezoning occupied cells condemns them: stage it block by block with a rollback save.
- Zone circles stay inside one block: a circle across an avenue condemns the far side.
- Commercial on busy streets, offices near (not on) arterials, low-rent homes near amenities: each grows best there.
- Each residential density has its own demand bar: zone the one that is asking.
