#!/usr/bin/env node
/**
 * cs2-mcp - MCP server for Cities: Skylines II.
 *
 * Translates MCP tool calls into HTTP requests against the CS2MCP bridge mod
 * running inside the game (default http://127.0.0.1:8642, override with the
 * CS2_BRIDGE_URL environment variable).
 */
import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BRIDGE_URL = (process.env.CS2_BRIDGE_URL ?? "http://127.0.0.1:8642").replace(/\/+$/, "");
const BRIDGE_TOKEN = process.env.CS2MCP_TOKEN?.trim() ?? "";

class BridgeError extends Error {}

/** Routes that change game state; must match IsMutatingPath in CS2MCP.Bridge/HttpBridgeServer.cs. */
function isMutatingPath(path: string): boolean {
  return (
    path.startsWith("/build/") ||
    path.startsWith("/sim/") ||
    path.endsWith("/set") ||
    ["/game/save", "/city/tiles/buy", "/city/devtree/purchase", "/transit/stops/place", "/transit/lines/create", "/transit/lines/delete"].includes(path)
  );
}

async function bridgeFetch(path: string, timeoutMs: number): Promise<Response> {
  const route = path.split("?", 1)[0];
  try {
    return await fetch(`${BRIDGE_URL}${path}`, {
      method: isMutatingPath(route) ? "POST" : "GET",
      headers: BRIDGE_TOKEN ? { "X-CS2MCP-Token": BRIDGE_TOKEN } : {},
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new BridgeError(
      `Cannot reach the CS2 bridge at ${BRIDGE_URL} (${(err as Error).message}). ` +
        `Make sure Cities: Skylines II is running and the CS2MCP mod is enabled.`,
    );
  }
}

async function bridgeJson(path: string, timeoutMs = 12_000): Promise<unknown> {
  const res = await bridgeFetch(path, timeoutMs);
  const text = await res.text();
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = { raw: text };
  }
  if (!res.ok) {
    const message = (payload as { error?: string })?.error ?? `bridge returned HTTP ${res.status}`;
    throw new BridgeError(String(message));
  }
  return payload;
}

/** CS2MCP_VERBOSE=1 restores pretty-printed, unabridged tool output. */
const VERBOSE = process.env.CS2MCP_VERBOSE === "1";
/** Boilerplate keys the bridge repeats in every reply; they cost tokens and carry no data. */
const DROP_KEYS = new Set(["note", "stalenessWarning"]);

/**
 * Shrink a bridge payload for the model: drop boilerplate keys and nulls, and
 * round fractional numbers (2 decimals below 10, else 1). Coordinates keep
 * 0.1 m precision, which is finer than any placement needs.
 */
function compact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(compact);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (DROP_KEYS.has(key) || item === null || item === undefined) continue;
      out[key] = compact(item);
    }
    return out;
  }
  if (typeof value === "number" && !Number.isInteger(value)) {
    const scale = Math.abs(value) < 10 ? 100 : 10;
    return Math.round(value * scale) / scale;
  }
  return value;
}

function jsonResult(payload: unknown) {
  const text = VERBOSE ? JSON.stringify(payload, null, 2) : JSON.stringify(compact(payload));
  return { content: [{ type: "text" as const, text }] };
}

function errorResult(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

const server = new McpServer({ name: "cs2-mcp", version: "0.8.0" });

server.registerTool(
  "cs2_ping",
  {
    title: "Ping the game bridge",
    description:
      "Check that Cities: Skylines II is running with the CS2MCP bridge mod loaded. " +
      "Returns mod version, current game mode (MainMenu / Game / Editor) and whether a save is loading. " +
      "Works even while a save is still loading; use this first to diagnose connection issues.",
    inputSchema: {},
  },
  async () => {
    try {
      return jsonResult(await bridgeJson("/ping", 3_000));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "cs2_game_state",
  {
    title: "Get game state",
    description:
      "Get the current game state: game mode, whether a city is loaded, city name, " +
      "simulation pause/speed and the in-game date/time.",
    inputSchema: {},
  },
  async () => {
    try {
      return jsonResult(await bridgeJson("/state"));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "cs2_city_overview",
  {
    title: "Get city overview",
    description:
      "Key statistics of the loaded city: population (plus citizens currently moving in), " +
      "average happiness and health, city treasury money, XP, in-game date and simulation speed. " +
      "Requires a loaded city.",
    inputSchema: {},
  },
  async () => {
    try {
      return jsonResult(await bridgeJson("/city/overview"));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "cs2_demand",
  {
    title: "Get RCI zoning demand",
    description:
      "Residential (low/medium/high density), commercial, industrial, office and storage demand " +
      "of the loaded city (0-100), including the demand factors that explain WHY demand is high or low " +
      "(e.g. Taxes, Unemployment, EmptyZones, Homelessness). Positive factor values push demand up, " +
      "negative values push it down.",
    inputSchema: {},
  },
  async () => {
    try {
      return jsonResult(await bridgeJson("/city/demand"));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "cs2_set_simulation",
  {
    title: "Pause / set simulation speed",
    description:
      "Control the simulation clock: pause/unpause the game and/or set the simulation speed " +
      "(0 = paused, 1 = normal, 2 = double, 4 = fastest UI speed; values up to 8 are accepted). " +
      "Returns the resulting state.",
    inputSchema: {
      paused: z.boolean().optional().describe("true to pause, false to resume"),
      speed: z.number().min(0).max(8).optional().describe("simulation speed multiplier (0-8)"),
    },
  },
  async ({ paused, speed }) => {
    if (paused === undefined && speed === undefined) {
      return errorResult(new Error("provide at least one of: paused, speed"));
    }
    const params = new URLSearchParams();
    if (speed !== undefined) params.set("speed", String(speed));
    if (paused !== undefined) params.set("paused", String(paused));
    try {
      return jsonResult(await bridgeJson(`/sim/control?${bridgeQueryString(params)}`));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "cs2_screenshot",
  {
    title: "Take a screenshot",
    description:
      "Capture the current game view as a PNG image. Useful for seeing the city layout, " +
      "checking what the player is looking at, or verifying the result of an action. " +
      "Returns the image directly.",
    inputSchema: {
      width: z
        .number()
        .int()
        .min(64)
        .max(3840)
        .optional()
        .describe("Downscale the image to this width in pixels (default 1280, keeps aspect ratio)"),
    },
  },
  async ({ width }) => {
    const w = width ?? 1280;
    try {
      const res = await bridgeFetch(`/screenshot?width=${w}`, 30_000);
      if (!res.ok) {
        const text = await res.text();
        let message = `bridge returned HTTP ${res.status}`;
        try {
          message = (JSON.parse(text) as { error?: string })?.error ?? message;
        } catch {
          // keep default message
        }
        return errorResult(new BridgeError(message));
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      return {
        content: [
          { type: "image" as const, data: buffer.toString("base64"), mimeType: "image/png" },
        ],
      };
    } catch (err) {
      return errorResult(err);
    }
  },
);

/** Register a parameter-less tool that returns bridge JSON. */
function registerJsonTool(name: string, title: string, description: string, path: string) {
  server.registerTool(name, { title, description, inputSchema: {} }, async () => {
    try {
      return jsonResult(await bridgeJson(path));
    } catch (err) {
      return errorResult(err);
    }
  });
}

registerJsonTool(
  "cs2_budget",
  "Get budget breakdown",
  "Detailed city budget: total income/expenses, balance, and a per-source breakdown " +
    "(residential/commercial/industrial/office taxes, service fees, subsidies, service upkeep, " +
    "loan interest, electricity/water import-export, map tile upkeep). Values are monthly rates; " +
    "expenses are positive costs.",
  "/city/budget",
);

registerJsonTool(
  "cs2_city_services",
  "Get utility service status",
  "Electricity (production/consumption/battery/trade), water & sewage (capacity/consumption/trade) " +
    "and garbage accumulation of the loaded city. Compare production vs consumption to spot shortages.",
  "/city/services",
);

registerJsonTool(
  "cs2_labor",
  "Get labor market",
  "Employment data: employed citizens, unemployment rate, homelessness, total/free jobs broken down " +
    "by required education level, and the population age structure (children/teens/adults/seniors).",
  "/city/labor",
);

server.registerTool(
  "cs2_statistics",
  {
    title: "Get statistic history",
    description:
      "Time series of a city statistic (sampled 32x per in-game day). Useful types: Population, Money, " +
      "Income, Expense, HouseholdCount, WorkerCount, Unemployed, TouristCount, CrimeRate, BirthRate, " +
      "DeathRate, CitizensMovedIn, CitizensMovedAway, ResidentialTaxableIncome, TrafficFlow-style passenger " +
      "counts (PassengerCountBus/Subway/Train...). An invalid type returns the full list of valid names.",
    inputSchema: {
      type: z.string().describe("StatisticType enum name, e.g. 'Population' or 'Money'"),
      parameter: z.number().int().optional().describe("Sub-index for parameterized statistics (default 0)"),
      samples: z.number().int().min(1).max(512).optional().describe("How many recent samples to return (default 64)"),
    },
  },
  async ({ type, parameter, samples }) => {
    const params = new URLSearchParams({ type });
    if (parameter !== undefined) params.set("parameter", String(parameter));
    if (samples !== undefined) params.set("samples", String(samples));
    try {
      return jsonResult(await bridgeJson(`/city/statistics?${bridgeQueryString(params)}`));
    } catch (err) {
      return errorResult(err);
    }
  },
);

registerJsonTool(
  "cs2_get_taxes",
  "Get tax rates",
  "Current tax rate and allowed range for each tax area: Residential, Commercial, Industrial, Office.",
  "/city/taxes",
);

server.registerTool(
  "cs2_set_tax",
  {
    title: "Set a tax rate",
    description:
      "Set the tax rate (integer percent) for one tax area. The rate is clamped to the game's allowed " +
      "range (returned in the response). Higher taxes raise income but lower demand and happiness.",
    inputSchema: {
      area: z.enum(["Residential", "Commercial", "Industrial", "Office"]).describe("Tax area to change"),
      rate: z.number().int().describe("New tax rate in percent"),
    },
  },
  async ({ area, rate }) => {
    try {
      return jsonResult(await bridgeJson(`/city/taxes/set?area=${area}&rate=${rate}`));
    } catch (err) {
      return errorResult(err);
    }
  },
);

registerJsonTool(
  "cs2_dev_tree",
  "List the development tree",
  "The development (progression) tree: available development points and every node with its service, " +
    "point cost, whether it is purchased, whether its service is unlocked, its prerequisite nodes and " +
    "whether it is affordable right now. Buy nodes with cs2_buy_dev_node.",
  "/city/devtree",
);

server.registerTool(
  "cs2_buy_dev_node",
  {
    title: "Buy a development tree node",
    description:
      "Spend development points on one node of the development tree (by name from cs2_dev_tree), the same " +
      "as clicking it in the game's Progression panel. The game checks points and prerequisites; compare " +
      "pointsBefore/pointsAfter or re-list cs2_dev_tree to confirm.",
    inputSchema: {
      name: z.string().describe("Node name from cs2_dev_tree"),
    },
  },
  async ({ name }) => {
    const params = new URLSearchParams({ name });
    try {
      return jsonResult(await bridgeJson(`/city/devtree/purchase?${bridgeQueryString(params)}`));
    } catch (err) {
      return errorResult(err);
    }
  },
);

registerJsonTool(
  "cs2_policies",
  "List city policies",
  "All city-wide policies with their internal name, localized title, active state, locked state and " +
    "whether they take a slider adjustment value (e.g. Recycling, Education Subsidies, speed limits).",
  "/city/policies",
);

server.registerTool(
  "cs2_set_policy",
  {
    title: "Toggle a city policy",
    description:
      "Activate or deactivate a city-wide policy by its internal name (from cs2_policies). " +
      "Slider policies additionally accept an adjustment value. Locked policies cannot be set.",
    inputSchema: {
      name: z.string().describe("Policy internal name from cs2_policies"),
      active: z.boolean().describe("true to activate, false to deactivate"),
      adjustment: z.number().optional().describe("Slider value for slider policies (optional)"),
    },
  },
  async ({ name, active, adjustment }) => {
    const params = new URLSearchParams({ name, active: String(active) });
    if (adjustment !== undefined) params.set("adjustment", String(adjustment));
    try {
      return jsonResult(await bridgeJson(`/city/policies/set?${bridgeQueryString(params)}`));
    } catch (err) {
      return errorResult(err);
    }
  },
);

registerJsonTool(
  "cs2_service_budgets",
  "Get service budgets",
  "Per-service budget sliders (50-150%, 100 = default) with current efficiency, estimated upkeep cost " +
    "and building count for every city service (police, healthcare, education, transport, ...).",
  "/city/service-budgets",
);

server.registerTool(
  "cs2_set_service_budget",
  {
    title: "Set a service budget",
    description:
      "Set the budget percentage (50-150) for one city service by name (from cs2_service_budgets). " +
      "Lower budgets save money but reduce service efficiency; higher budgets do the opposite.",
    inputSchema: {
      service: z.string().describe("Service name from cs2_service_budgets"),
      percentage: z.number().int().min(50).max(150).describe("Budget percentage, 100 = default"),
    },
  },
  async ({ service, percentage }) => {
    const params = new URLSearchParams({ service, percentage: String(percentage) });
    try {
      return jsonResult(await bridgeJson(`/city/service-budgets/set?${bridgeQueryString(params)}`));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "cs2_find_prefabs",
  {
    title: "Search placeable prefabs",
    description:
      "Search the game's building or road prefabs by name substring. Returns exact prefab names " +
      "needed by cs2_place_building, plus their type and locked state. Example queries: 'school', " +
      "'FireHouse', 'WindTurbine', 'Highway'. category 'netobject' lists roundabouts (and other road-attached " +
      "objects) for cs2_place_roundabout, with size and placement (junction or segment); 'stamp' lists pre-built " +
      "intersections/interchanges from the Intersections development node, placed with cs2_place_building.",
    inputSchema: {
      category: z
        .enum(["building", "road", "net", "tree", "netobject", "stamp"])
        .optional()
        .describe("Prefab category (default building); 'net' = all networks incl. train tracks, pipes, power lines, pedestrian paths; " +
          "'netobject' = roundabouts and other road-attached objects; 'stamp' = pre-built intersections/interchanges"),
      query: z.string().optional().describe("Case-insensitive name substring filter"),
      limit: z.number().int().min(1).max(200).optional().describe("Max results (default 50)"),
    },
  },
  async ({ category, query, limit }) => {
    const params = new URLSearchParams();
    if (category) params.set("category", category);
    if (query) params.set("query", query);
    if (limit) params.set("limit", String(limit));
    try {
      return jsonResult(await bridgeJson(`/prefabs?${bridgeQueryString(params)}`));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "cs2_place_building",
  {
    title: "Place a building",
    description:
      "Place a building in the world at the given map coordinates (x, z in meters; the map is roughly " +
      "-7000 to +7000 on each axis, use cs2_list_buildings to see coordinates of existing buildings for " +
      "reference). Height is sampled from the terrain automatically. The game validates the placement " +
      "(collisions, terrain, water) and the call fails with an explanation if blocked. Costs city money " +
      "like a normal player action. Verify the result with cs2_screenshot or cs2_list_buildings. Also places " +
      "asset stamps (cs2_find_prefabs category 'stamp': pre-built intersections/interchanges); the stamp's roads " +
      "are built at x/z with the given rotation, so clear the site first and join them up with cs2_connect_road.",
    inputSchema: {
      prefab: z.string().describe("Exact prefab name from cs2_find_prefabs"),
      x: z.number().describe("World X coordinate (meters)"),
      z: z.number().describe("World Z coordinate (meters)"),
      rotation: z.number().optional().describe("Rotation around Y axis in degrees (default 0)"),
      force: z.boolean().optional().describe("Place even if the prefab is milestone-locked"),
    },
  },
  async ({ prefab, x, z, rotation, force }) => {
    const params = new URLSearchParams({ prefab, x: String(x), z: String(z) });
    if (rotation !== undefined) params.set("rotation", String(rotation));
    if (force) params.set("force", "true");
    try {
      return jsonResult(await bridgeJson(`/build/place?${bridgeQueryString(params)}`, 15_000));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "cs2_build_road",
  {
    title: "Build a road segment",
    description:
      "Build any network segment between two world coordinates (terrain-following): roads, train tracks, " +
      "pedestrian paths, power lines, pipes 鈥?any prefab from cs2_find_prefabs category 'road' or 'net'. " +
      "Straight by default; pass cx/cz for a curved segment through that control point. Length 8-1500m. " +
      "Endpoints on existing nodes connect to them. Costs city money; fails with an explanation if blocked.",
    inputSchema: {
      prefab: z.string().describe("Exact prefab name from cs2_find_prefabs (category road or net)"),
      x1: z.number().describe("Start X (meters)"),
      z1: z.number().describe("Start Z (meters)"),
      x2: z.number().describe("End X (meters)"),
      z2: z.number().describe("End Z (meters)"),
      cx: z.number().optional().describe("Curve control point X (with cz: builds a curve through it)"),
      cz: z.number().optional().describe("Curve control point Z"),
      e1: z.number().optional().describe("Elevation at start in meters (bridges/elevated; negative = tunnel-ish)"),
      e2: z.number().optional().describe("Elevation at end in meters"),
      force: z.boolean().optional().describe("Build even if the prefab is milestone-locked"),
    },
  },
  async ({ prefab, x1, z1, x2, z2, cx, cz, e1, e2, force }) => {
    const params = new URLSearchParams({
      prefab,
      x1: String(x1),
      z1: String(z1),
      x2: String(x2),
      z2: String(z2),
    });
    if (cx !== undefined) params.set("cx", String(cx));
    if (cz !== undefined) params.set("cz", String(cz));
    if (e1 !== undefined) params.set("e1", String(e1));
    if (e2 !== undefined) params.set("e2", String(e2));
    if (force) params.set("force", "true");
    try {
      return jsonResult(await bridgeJson(`/build/road?${bridgeQueryString(params)}`, 15_000));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "cs2_list_buildings",
  {
    title: "List placed buildings",
    description:
      "List buildings existing in the city with their prefab name, world position and entity id " +
      "(index+version, needed for cs2_demolish). Filter by name substring to find specific buildings.",
    inputSchema: {
      query: z.string().optional().describe("Case-insensitive prefab-name substring filter"),
      limit: z.number().int().min(1).max(500).optional().describe("Max results (default 100)"),
    },
  },
  async ({ query, limit }) => {
    const params = new URLSearchParams();
    if (query) params.set("query", query);
    if (limit) params.set("limit", String(limit));
    try {
      return jsonResult(await bridgeJson(`/city/buildings?${bridgeQueryString(params)}`));
    } catch (err) {
      return errorResult(err);
    }
  },
);

registerJsonTool(
  "cs2_list_zones",
  "List zone types",
  "All zone types (residential low/medium/high, commercial, industrial, office...) with their " +
    "internal name, area type and locked state. Use the exact name with cs2_zone_area.",
  "/zones",
);

server.registerTool(
  "cs2_zone_area",
  {
    title: "Zone an area",
    description:
      "Paint zoning on all zonable cells within a radius around a point. Zone cells only exist " +
      "along roads (build a road first). Pass zone='None' to remove zoning. Buildings grow on zoned " +
      "cells while the simulation runs, driven by RCI demand (check cs2_demand).",
    inputSchema: {
      zone: z.string().describe("Exact zone name from cs2_list_zones, or 'None' to dezone"),
      x: z.number().describe("Center X (meters)"),
      z: z.number().describe("Center Z (meters)"),
      radius: z.number().min(8).max(200).optional().describe("Radius in meters (default 32)"),
      force: z.boolean().optional().describe("Zone even if the zone type is milestone-locked"),
    },
  },
  async ({ zone, x, z: zCoord, radius, force }) => {
    const params = new URLSearchParams({ zone, x: String(x), z: String(zCoord) });
    if (radius !== undefined) params.set("radius", String(radius));
    if (force) params.set("force", "true");
    try {
      return jsonResult(await bridgeJson(`/build/zone?${bridgeQueryString(params)}`));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "cs2_upgrade_road",
  {
    title: "Upgrade a road segment",
    description:
      "Apply upgrades to an existing road segment (from cs2_list_roads): grass, trees, wideSidewalk, " +
      "soundBarrier, parking, lighting, medianGrass, medianTrees, tram (tram tracks in the road: " +
      "side=both for a double track, left/right for one; needs a road type that supports trams). " +
      "Combine multiple with commas; upgrades the segment already has are kept. " +
      "The segment is recreated with the new composition via the game's tool pipeline.",
    inputSchema: {
      index: z.number().int().describe("Road segment entity index"),
      version: z.number().int().describe("Road segment entity version"),
      upgrades: z.string().describe("Comma-separated upgrade names, e.g. 'grass,lighting'"),
      side: z.enum(["both", "left", "right"]).optional().describe("Which side for side upgrades (default both)"),
      remove: z.boolean().optional().describe("true to remove these upgrades instead of adding them (e.g. the wrong-way tram track on a one-way road)"),
    },
  },
  async ({ index, version, upgrades, side, remove }) => {
    const params = new URLSearchParams({ index: String(index), version: String(version), upgrades });
    if (side) params.set("side", side);
    if (remove) params.set("remove", "true");
    try {
      return jsonResult(await bridgeJson(`/build/upgrade?${bridgeQueryString(params)}`, 15_000));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "cs2_list_roads",
  {
    title: "List road segments",
    description:
      "List road segments (edges) with entity id, prefab name, start/end coordinates and length. " +
      "Filter spatially with x/z/radius or by prefab-name substring. Use the entity id with cs2_demolish.",
    inputSchema: {
      query: z.string().optional().describe("Prefab-name substring filter"),
      x: z.number().optional().describe("Center X for spatial filter"),
      z: z.number().optional().describe("Center Z for spatial filter"),
      radius: z.number().optional().describe("Radius in meters for spatial filter (default 250)"),
      limit: z.number().int().min(1).max(500).optional().describe("Max results (default 100)"),
    },
  },
  async ({ query, x, z: zCoord, radius, limit }) => {
    const params = new URLSearchParams();
    if (query) params.set("query", query);
    if (x !== undefined) params.set("x", String(x));
    if (zCoord !== undefined) params.set("z", String(zCoord));
    if (radius !== undefined) params.set("radius", String(radius));
    if (limit) params.set("limit", String(limit));
    try {
      return jsonResult(await bridgeJson(`/city/roads?${bridgeQueryString(params)}`));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "cs2_demolish",
  {
    title: "Demolish a building or road segment",
    description:
      "Demolish (bulldoze) one building (from cs2_list_buildings) or road segment (from cs2_list_roads) " +
      "identified by its entity index and version. Irreversible 鈥?double-check the target first.",
    inputSchema: {
      index: z.number().int().describe("Entity index from cs2_list_buildings"),
      version: z.number().int().describe("Entity version from cs2_list_buildings"),
    },
  },
  async ({ index, version }) => {
    try {
      return jsonResult(await bridgeJson(`/build/demolish?index=${index}&version=${version}`));
    } catch (err) {
      return errorResult(err);
    }
  },
);

registerJsonTool(
  "cs2_get_camera",
  "Get camera state",
  "Current gameplay camera: pivot (look-at point), position, compass/tilt angles and zoom distance.",
  "/camera",
);

server.registerTool(
  "cs2_set_camera",
  {
    title: "Move the camera",
    description:
      "Point the gameplay camera: set the pivot (look-at world coordinates; height auto-sampled from " +
      "terrain unless y given), compass rotation angleX (degrees), tilt angleY (0-89) and zoom distance. " +
      "Combine with cs2_screenshot to LOOK at any place in the city 鈥?the AI's own eyes.",
    inputSchema: {
      x: z.number().optional().describe("Pivot X (requires z)"),
      z: z.number().optional().describe("Pivot Z (requires x)"),
      y: z.number().optional().describe("Pivot height (optional, terrain height used if omitted)"),
      angleX: z.number().optional().describe("Compass rotation in degrees"),
      angleY: z.number().optional().describe("Tilt in degrees (0 = horizontal, 89 = top-down)"),
      zoom: z.number().optional().describe("Camera distance (10-10000, larger = further out)"),
    },
  },
  async ({ x, z: zCoord, y, angleX, angleY, zoom }) => {
    const params = new URLSearchParams();
    if (x !== undefined) params.set("x", String(x));
    if (zCoord !== undefined) params.set("z", String(zCoord));
    if (y !== undefined) params.set("y", String(y));
    if (angleX !== undefined) params.set("angleX", String(angleX));
    if (angleY !== undefined) params.set("angleY", String(angleY));
    if (zoom !== undefined) params.set("zoom", String(zoom));
    try {
      return jsonResult(await bridgeJson(`/camera/set?${bridgeQueryString(params)}`));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "cs2_terrain",
  {
    title: "Get terrain & water map",
    description:
      "Sampled heightmap and water-depth grid of the whole map (14336x14336m). Returns row-major arrays; " +
      "waterDepths > 0 marks rivers/lakes/sea. Use to understand geography before planning construction.",
    inputSchema: {
      resolution: z.number().int().min(16).max(256).optional().describe("Grid resolution per axis (default 64)"),
    },
  },
  async ({ resolution }) => {
    const params = new URLSearchParams();
    if (resolution) params.set("resolution", String(resolution));
    try {
      return jsonResult(await bridgeJson(`/city/terrain?${bridgeQueryString(params)}`, 30_000));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "cs2_gridmap",
  {
    title: "Get data-layer grid",
    description:
      "The game's native cell-map grids as row-major arrays: landValue, groundPollution, airPollution, " +
      "noisePollution, groundWater, groundWaterPollution. Use to pick good locations (cheap land, clean " +
      "air, water for pumps) like a player reading infoviews.",
    inputSchema: {
      layer: z
        .enum(["landValue", "groundPollution", "airPollution", "noisePollution", "groundWater", "groundWaterPollution"])
        .describe("Which data layer to export"),
    },
  },
  async ({ layer }) => {
    try {
      return jsonResult(await bridgeJson(`/city/gridmap?layer=${layer}`, 30_000));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "cs2_zoning",
  {
    title: "Read current zoning",
    description:
      "Summary of painted zones: cells per zone type with occupied/empty split, whole-city or within a " +
      "radius. Empty zoned cells are where buildings will grow.",
    inputSchema: {
      x: z.number().optional().describe("Center X for area filter"),
      z: z.number().optional().describe("Center Z for area filter"),
      radius: z.number().optional().describe("Radius in meters (with x/z)"),
    },
  },
  async ({ x, z: zCoord, radius }) => {
    const params = new URLSearchParams();
    if (x !== undefined) params.set("x", String(x));
    if (zCoord !== undefined) params.set("z", String(zCoord));
    if (radius !== undefined) params.set("radius", String(radius));
    try {
      return jsonResult(await bridgeJson(`/city/zoning?${bridgeQueryString(params)}`, 20_000));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "cs2_notifications",
  {
    title: "List warning notifications",
    description:
      "All active in-world warning icons (no electricity, no water, garbage piling up, abandoned buildings, " +
      "high rent...) with type counts, locations and target entities. The primary way to discover problems.",
    inputSchema: {
      limit: z.number().int().min(1).max(500).optional().describe("Max detailed items (default 100)"),
    },
  },
  async ({ limit }) => {
    const params = new URLSearchParams();
    if (limit) params.set("limit", String(limit));
    try {
      return jsonResult(await bridgeJson(`/city/notifications?${bridgeQueryString(params)}`));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "cs2_inspect",
  {
    title: "Inspect an entity",
    description:
      "Detail view of one entity (building/road) by index+version: prefab, position, status flags " +
      "(abandoned/condemned/destroyed), renters with citizen/employee counts. Like clicking a building in game.",
    inputSchema: {
      index: z.number().int().describe("Entity index"),
      version: z.number().int().describe("Entity version"),
    },
  },
  async ({ index, version }) => {
    try {
      return jsonResult(await bridgeJson(`/entity/inspect?index=${index}&version=${version}`));
    } catch (err) {
      return errorResult(err);
    }
  },
);

registerJsonTool(
  "cs2_get_loan",
  "Get city loan state",
  "Current loan principal, daily interest rate, daily payment and the city's creditworthiness (max borrowable).",
  "/city/loan",
);

server.registerTool(
  "cs2_set_loan",
  {
    title: "Borrow / repay loan",
    description:
      "Set the city's loan principal: higher than current = borrow more (cash added to treasury), " +
      "lower = repay, 0 = repay fully. Clamped to creditworthiness. Interest accrues daily.",
    inputSchema: {
      amount: z.number().int().min(0).describe("New total loan principal"),
    },
  },
  async ({ amount }) => {
    try {
      return jsonResult(await bridgeJson(`/city/loan/set?amount=${amount}`));
    } catch (err) {
      return errorResult(err);
    }
  },
);

registerJsonTool(
  "cs2_get_fees",
  "Get service fees",
  "Current price the city charges per service (electricity, water, healthcare, education levels, garbage, " +
    "parking, public transport...) with slider ranges and estimated monthly income per fee.",
  "/city/fees",
);

server.registerTool(
  "cs2_set_fee",
  {
    title: "Set a service fee",
    description:
      "Set the fee/price for one service resource (name from cs2_get_fees). Higher fees raise income " +
      "but reduce usage and citizen happiness.",
    inputSchema: {
      resource: z.string().describe("Resource name from cs2_get_fees, e.g. 'Electricity'"),
      fee: z.number().describe("New fee value"),
    },
  },
  async ({ resource, fee }) => {
    const params = new URLSearchParams({ resource, fee: String(fee) });
    try {
      return jsonResult(await bridgeJson(`/city/fees/set?${bridgeQueryString(params)}`));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "cs2_list_objects",
  {
    title: "List standalone trees/plants",
    description:
      "List standalone trees and plants (not building sub-objects) with entity ids and positions. " +
      "Filter by name or spatially. Use the entity id with cs2_demolish to remove them.",
    inputSchema: {
      query: z.string().optional().describe("Prefab-name substring filter"),
      x: z.number().optional().describe("Center X for spatial filter"),
      z: z.number().optional().describe("Center Z for spatial filter"),
      radius: z.number().optional().describe("Radius meters (default 250 with x/z)"),
      limit: z.number().int().min(1).max(500).optional().describe("Max results (default 100)"),
    },
  },
  async ({ query, x, z: zCoord, radius, limit }) => {
    const params = new URLSearchParams();
    if (query) params.set("query", query);
    if (x !== undefined) params.set("x", String(x));
    if (zCoord !== undefined) params.set("z", String(zCoord));
    if (radius !== undefined) params.set("radius", String(radius));
    if (limit) params.set("limit", String(limit));
    try {
      return jsonResult(await bridgeJson(`/city/objects?${bridgeQueryString(params)}`));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "cs2_run_simulation",
  {
    title: "Run simulation for N in-game hours",
    description:
      "Unpause and run the simulation at the given speed, auto-pausing after the requested number of " +
      "in-game hours. Returns immediately with the target frame; poll cs2_game_state (frameIndex) to " +
      "track progress. Use cancel=true to stop early. Reward popups (milestone reached...) that pause " +
      "the game during the run are closed automatically so it keeps going. The core loop for " +
      "autonomous mayoring: act, run time forward, observe results.",
    inputSchema: {
      hours: z.number().min(0.1).max(96).optional().describe("In-game hours to run (required unless cancel)"),
      speed: z.number().min(0.5).max(8).optional().describe("Simulation speed while running (default 4)"),
      cancel: z.boolean().optional().describe("true to cancel a timed run and pause now"),
    },
  },
  async ({ hours, speed, cancel }) => {
    const params = new URLSearchParams();
    if (cancel) params.set("cancel", "true");
    if (hours !== undefined) params.set("hours", String(hours));
    if (speed !== undefined) params.set("speed", String(speed));
    try {
      return jsonResult(await bridgeJson(`/sim/run?${bridgeQueryString(params)}`));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "cs2_dismiss_popups",
  {
    title: "Close reward popups",
    description:
      "Close the game's reward popups (milestone reached, signature building unlocked) by running the same " +
      "handlers as their Close buttons. Such a popup pauses the game; use this when cs2_game_state stays paused " +
      "and a screenshot shows one, then unpause with cs2_set_simulation.",
    inputSchema: {},
  },
  async () => {
    try {
      return jsonResult(await bridgeJson("/sim/dismiss-popups"));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "cs2_save_game",
  {
    title: "Save the game",
    description:
      "Trigger a manual save (asynchronous). Use before large construction batches as a safety net. " +
      "Default name is timestamped 'CS2MCP ...'.",
    inputSchema: {
      name: z.string().optional().describe("Save name (default: timestamped)"),
    },
  },
  async ({ name }) => {
    const params = new URLSearchParams();
    if (name) params.set("name", name);
    try {
      return jsonResult(await bridgeJson(`/game/save?${bridgeQueryString(params)}`));
    } catch (err) {
      return errorResult(err);
    }
  },
);

registerJsonTool(
  "cs2_tiles_info",
  "Get map tile info",
  "Owned/total map tiles, tiles available to purchase and upkeep settings. (Purchasing via API arrives in v0.9.)",
  "/city/tiles",
);

registerJsonTool(
  "cs2_list_districts",
  "List districts",
  "All districts with entity id, center position, polygon size and active policy count.",
  "/districts",
);

server.registerTool(
  "cs2_create_district",
  {
    title: "Create a district",
    description:
      "Draw a district over an area by polygon corners (3-32 points, world meters). Buildings and roads " +
      "inside get assigned to it; district policies can then be applied to just that area.",
    inputSchema: {
      nodes: z.string().describe("Polygon corners 'x1,z1;x2,z2;x3,z3;...' (counter-clockwise)"),
      prefab: z.string().optional().describe("District prefab name (default: the standard district)"),
    },
  },
  async ({ nodes, prefab }) => {
    const params = new URLSearchParams({ nodes });
    if (prefab) params.set("prefab", prefab);
    try {
      return jsonResult(await bridgeJson(`/build/district?${bridgeQueryString(params)}`, 15_000));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "cs2_district_policies",
  {
    title: "List district policies",
    description:
      "Policies available for one district (speed limits, parking fees, combustion ban...) with " +
      "active/locked state. District from cs2_list_districts.",
    inputSchema: {
      index: z.number().int().describe("District entity index"),
      version: z.number().int().describe("District entity version"),
    },
  },
  async ({ index, version }) => {
    try {
      return jsonResult(await bridgeJson(`/district/policies?index=${index}&version=${version}`));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "cs2_set_district_policy",
  {
    title: "Toggle a district policy",
    description: "Activate/deactivate a policy on one district (policy name from cs2_district_policies).",
    inputSchema: {
      index: z.number().int().describe("District entity index"),
      version: z.number().int().describe("District entity version"),
      name: z.string().describe("Policy internal name"),
      active: z.boolean().describe("true to activate"),
      adjustment: z.number().optional().describe("Slider value for slider policies"),
    },
  },
  async ({ index, version, name, active, adjustment }) => {
    const params = new URLSearchParams({
      index: String(index),
      version: String(version),
      name,
      active: String(active),
    });
    if (adjustment !== undefined) params.set("adjustment", String(adjustment));
    try {
      return jsonResult(await bridgeJson(`/district/policies/set?${bridgeQueryString(params)}`));
    } catch (err) {
      return errorResult(err);
    }
  },
);

const transitType = z.enum(["bus", "tram", "metro", "train"]);

/** An entity id (index+version) or a world point; the bridge takes "i:v" or "x,z" items joined by ';'. */
const entityOrPoint = z.union([
  z.object({ index: z.number().int(), version: z.number().int() }),
  z.object({ x: z.number(), z: z.number() }),
]);

function joinEntityOrPoints(items: z.infer<typeof entityOrPoint>[]): string {
  return items.map((item) => ("index" in item ? `${item.index}:${item.version}` : `${item.x},${item.z}`)).join(";");
}

/**
 * The bridge decodes query values with Uri.UnescapeDataString, which keeps '+'
 * literal, so spaces must go out as %20 (URLSearchParams writes '+'; a real '+'
 * is already %2B).
 */
function bridgeQueryString(params: URLSearchParams): string {
  return params.toString().replace(/\+/g, "%20");
}

server.registerTool(
  "cs2_list_transit_stops",
  {
    title: "List public transport stops",
    description:
      "List existing transit stops (bus/tram roadside stops, train/metro station platforms) with entity id, type, " +
      "name, position, owning station building, attached road and the lines already serving each stop. Filter by " +
      "type and/or spatially (sorted by distance when x/z given). prefabs=true also lists placeable roadside stop " +
      "prefabs for cs2_place_transit_stop.",
    inputSchema: {
      type: z.enum(["bus", "tram", "metro", "train", "airplane"]).optional().describe("Only stops of this transport type; airplane lists airport gates (passenger or cargo) and the map's air outside connections"),
      x: z.number().optional().describe("Center X for spatial filter"),
      z: z.number().optional().describe("Center Z for spatial filter"),
      radius: z.number().optional().describe("Radius in meters for spatial filter (default 500)"),
      limit: z.number().int().min(1).max(500).optional().describe("Max results (default 100)"),
      prefabs: z.boolean().optional().describe("Also list placeable roadside stop prefabs"),
    },
  },
  async ({ type, x, z: zCoord, radius, limit, prefabs }) => {
    const params = new URLSearchParams();
    if (type) params.set("type", type);
    if (x !== undefined) params.set("x", String(x));
    if (zCoord !== undefined) params.set("z", String(zCoord));
    if (radius !== undefined) params.set("radius", String(radius));
    if (limit) params.set("limit", String(limit));
    if (prefabs) params.set("prefabs", "true");
    try {
      return jsonResult(await bridgeJson(`/transit/stops?${bridgeQueryString(params)}`));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "cs2_place_transit_stop",
  {
    title: "Place a bus/tram stop on a road",
    description:
      "Place a roadside bus or tram stop at the road nearest to (x, z), on the side of the road where the point is " +
      "(or on a specific road segment via road). Runs through the game's object tool pipeline: the game attaches " +
      "the stop to the road, snaps it to the curb, validates it (sidewalk, lanes, overlap, money) and charges the " +
      "normal cost. Train/metro stops are station buildings: use cs2_place_building for those. Returns the new " +
      "stop's entity id for cs2_create_transit_line. The road segment is regenerated, so its id may change.",
    inputSchema: {
      type: z.enum(["bus", "tram"]).describe("Stop type"),
      x: z.number().describe("World X of a point beside the road (meters)"),
      z: z.number().describe("World Z of a point beside the road (meters)"),
      road: z
        .object({ index: z.number().int(), version: z.number().int() })
        .optional()
        .describe("Force a specific road segment (from cs2_list_roads) instead of the nearest suitable one"),
      radius: z.number().min(4).max(200).optional().describe("Road search radius in meters (default 40)"),
      prefab: z.string().optional().describe("Exact stop prefab name (see cs2_list_transit_stops prefabs=true)"),
      force: z.boolean().optional().describe("Place even if the stop prefab is milestone-locked"),
    },
  },
  async ({ type, x, z: zCoord, road, radius, prefab, force }) => {
    const params = new URLSearchParams({ type, x: String(x), z: String(zCoord) });
    if (road) params.set("road", `${road.index}:${road.version}`);
    if (radius !== undefined) params.set("radius", String(radius));
    if (prefab) params.set("prefab", prefab);
    if (force) params.set("force", "true");
    try {
      return jsonResult(await bridgeJson(`/transit/stops/place?${bridgeQueryString(params)}`, 15_000));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "cs2_create_transit_line",
  {
    title: "Create a public transport line",
    description:
      "Create a bus/tram/metro/train line through existing stops, in order; the line automatically loops back to " +
      "the first stop. Each stop is a stop entity id, a station building id (its matching platform is used) or an " +
      "{x, z} point (snaps to the nearest existing stop of that type within snapRadius). Uses the game's own route " +
      "pipeline: it waits for the game to pathfind every segment, and fails with an explanation (e.g. 'no bus path " +
      "from stop #2 to stop #3') instead of creating a broken line. Needs a depot of the same type for vehicles.",
    inputSchema: {
      type: transitType.describe("Transport type"),
      stops: z.array(entityOrPoint).min(2).max(100).describe("Ordered stops (at least 2 different ones)"),
      name: z.string().max(64).optional().describe("Custom line name (default: the game's 'Bus Line N')"),
      color: z
        .string()
        .regex(/^#?[0-9a-fA-F]{6}$/)
        .optional()
        .describe("Line color as #RRGGBB (default: the game's color for this line type)"),
      snapRadius: z.number().min(5).max(300).optional().describe("Max distance for {x, z} stops to snap (default 60m)"),
      force: z.boolean().optional().describe("Create even if this line type is milestone-locked"),
    },
  },
  async ({ type, stops, name, color, snapRadius, force }) => {
    const params = new URLSearchParams({ type, stops: joinEntityOrPoints(stops) });
    if (name) params.set("name", name);
    if (color) params.set("color", color.startsWith("#") ? color : `#${color}`);
    if (snapRadius !== undefined) params.set("snapRadius", String(snapRadius));
    if (force) params.set("force", "true");
    try {
      return jsonResult(await bridgeJson(`/transit/lines/create?${bridgeQueryString(params)}`, 15_000));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "cs2_list_transit_lines",
  {
    title: "List public transport lines",
    description:
      "List transit lines with the same numbers the game's transportation panel shows: name, number, type, color, " +
      "active/visible, day/night schedule, stop count, vehicles, passengers on board, usage (occupancy) and length. " +
      "includeStops=true adds each stop in order with its waiting passengers. The game keeps no per-line ridership " +
      "history; city-wide passenger series are in cs2_statistics (PassengerCountBus, ...).",
    inputSchema: {
      type: transitType.optional().describe("Only lines of this transport type"),
      query: z.string().optional().describe("Case-insensitive line name substring"),
      includeStops: z.boolean().optional().describe("Include the ordered stop list with waiting passengers"),
      limit: z.number().int().min(1).max(200).optional().describe("Max results (default 50)"),
    },
  },
  async ({ type, query, includeStops, limit }) => {
    const params = new URLSearchParams();
    if (type) params.set("type", type);
    if (query) params.set("query", query);
    if (includeStops) params.set("includeStops", "true");
    if (limit) params.set("limit", String(limit));
    try {
      return jsonResult(await bridgeJson(`/transit/lines?${bridgeQueryString(params)}`));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "cs2_delete_transit_line",
  {
    title: "Delete a public transport line",
    description:
      "Delete one transit line (from cs2_list_transit_lines) exactly like the game's own 'delete line' button. " +
      "Its stops stay in place. Irreversible: double-check the line first.",
    inputSchema: {
      index: z.number().int().describe("Line entity index"),
      version: z.number().int().describe("Line entity version"),
    },
  },
  async ({ index, version }) => {
    try {
      return jsonResult(await bridgeJson(`/transit/lines/delete?index=${index}&version=${version}`));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "cs2_list_map_tiles",
  {
    title: "List map tiles",
    description:
      "List map tiles with entity id, center, bounds, owned flag and natural features (buildable land, fertile " +
      "land, forest, oil, ore, water, fish), plus owned count, remaining tile permits and treasury. Filter by " +
      "ownership and spatially (sorted by distance when x/z given).",
    inputSchema: {
      owned: z.enum(["all", "owned", "unowned"]).optional().describe("Ownership filter (default all)"),
      x: z.number().optional().describe("Center X for spatial filter"),
      z: z.number().optional().describe("Center Z for spatial filter"),
      radius: z.number().optional().describe("Radius in meters for spatial filter (default 3000)"),
      features: z.boolean().optional().describe("Include natural features per tile (default true)"),
      limit: z.number().int().min(1).max(1000).optional().describe("Max results (default 100)"),
    },
  },
  async ({ owned, x, z: zCoord, radius, features, limit }) => {
    const params = new URLSearchParams();
    if (owned) params.set("owned", owned);
    if (x !== undefined) params.set("x", String(x));
    if (zCoord !== undefined) params.set("z", String(zCoord));
    if (radius !== undefined) params.set("radius", String(radius));
    if (features !== undefined) params.set("features", String(features));
    if (limit) params.set("limit", String(limit));
    try {
      return jsonResult(await bridgeJson(`/city/tiles/list?${bridgeQueryString(params)}`));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "cs2_buy_map_tiles",
  {
    title: "Buy map tiles",
    description:
      "Buy one or more unowned map tiles, by tile id (cs2_list_map_tiles) or by a point inside the tile. Uses the " +
      "game's own purchase logic (the Map Tiles panel's Purchase button): the game prices the tiles from their " +
      "features (price rises with tiles owned), requires enough tile permits (from milestones) and money, then " +
      "charges the treasury. Irreversible; returns the actual cost charged.",
    inputSchema: {
      tiles: z.array(entityOrPoint).min(1).max(50).describe("Tiles to buy: {index, version} or {x, z} inside the tile"),
    },
  },
  async ({ tiles }) => {
    const params = new URLSearchParams({ tiles: joinEntityOrPoints(tiles) });
    try {
      return jsonResult(await bridgeJson(`/city/tiles/buy?${bridgeQueryString(params)}`));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "cs2_traffic",
  {
    title: "Traffic report",
    description:
      "Traffic diagnostics with the game's own numbers: the city-wide traffic flow (as the traffic info view " +
      "shows it), the roads with the lowest flow (0-100% per road like the road info panel, with volume and the " +
      "four daily periods) and every lane the game flags as a traffic bottleneck, grouped by road or intersection. " +
      "Filter spatially with x/z/radius. Use before and after road or transit changes to measure their effect; " +
      "values update 32 times per in-game day, so let the simulation run between checks.",
    inputSchema: {
      x: z.number().optional().describe("Center X for spatial filter"),
      z: z.number().optional().describe("Center Z for spatial filter"),
      radius: z.number().optional().describe("Radius in meters for spatial filter (default 1000)"),
      limit: z.number().int().min(1).max(200).optional().describe("How many worst roads to list (default 25)"),
      minVolume: z.number().min(0).optional().describe("Ignore roads with less volume than this when ranking (default 1)"),
    },
  },
  async ({ x, z: zCoord, radius, limit, minVolume }) => {
    const params = new URLSearchParams();
    if (x !== undefined) params.set("x", String(x));
    if (zCoord !== undefined) params.set("z", String(zCoord));
    if (radius !== undefined) params.set("radius", String(radius));
    if (limit) params.set("limit", String(limit));
    if (minVolume !== undefined) params.set("minVolume", String(minVolume));
    try {
      return jsonResult(await bridgeJson(`/city/traffic?${bridgeQueryString(params)}`));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "cs2_vehicles",
  {
    title: "Vehicle census and queue heads",
    description:
      "Every driving road vehicle (parked cars excluded) by type (personal car, taxi, bus, delivery/cargo truck, " +
      "service...) with how many are stopped, and for an area: their destinations (outside the city, residential, " +
      "commercial...) and what stopped vehicles wait for (vehicle ahead, red light, crossing or oncoming traffic). " +
      "queueHeads follows each stopped vehicle's blockers to the head of its queue, so it names the junctions or " +
      "roads actually holding traffic up and how many vehicles are stuck behind each; deadlocks lists loops of " +
      "vehicles blocking each other (gridlock). A live snapshot: repeat it to see what persists.",
    inputSchema: {
      x: z.number().optional().describe("Center X for the area breakdown"),
      z: z.number().optional().describe("Center Z for the area breakdown"),
      radius: z.number().optional().describe("Area radius in meters (default 500)"),
      limit: z.number().int().min(1).max(100).optional().describe("How many queue heads / deadlocks to list (default 15)"),
    },
  },
  async ({ x, z: zCoord, radius, limit }) => {
    const params = new URLSearchParams();
    if (x !== undefined) params.set("x", String(x));
    if (zCoord !== undefined) params.set("z", String(zCoord));
    if (radius !== undefined) params.set("radius", String(radius));
    if (limit) params.set("limit", String(limit));
    try {
      return jsonResult(await bridgeJson(`/city/vehicles?${bridgeQueryString(params)}`));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "cs2_road_graph",
  {
    title: "Road graph of an area",
    description:
      "Road segments in an area with their junction ids (so you can see what connects to what), direction " +
      "(one-way roads run start to end), flow and volume, plus each junction's position, number of roads and " +
      "whether it has traffic lights or is a roundabout. Each segment carries its street name as the game shows it " +
      "(e.g. 'Rosecliff Street'); filter by it with street. Use it to plan road changes before cs2_replace_road, " +
      "cs2_build_road or cs2_demolish.",
    inputSchema: {
      x: z.number().describe("Center X"),
      z: z.number().describe("Center Z"),
      radius: z.number().min(1).max(2000).optional().describe("Radius in meters (default 300)"),
      limit: z.number().int().min(1).max(3000).optional().describe("Max road segments (default 400)"),
      query: z.string().optional().describe("Only prefabs whose name contains this"),
      street: z.string().optional().describe("Only segments whose street name contains this (case-insensitive)"),
      allNets: z
        .boolean()
        .optional()
        .describe("Include every network, not just roads: train/subway/tram tracks (incl. stations' own tracks), paths..."),
    },
  },
  async ({ x, z: zCoord, radius, limit, query, street, allNets }) => {
    const params = new URLSearchParams({ x: String(x), z: String(zCoord) });
    if (radius !== undefined) params.set("radius", String(radius));
    if (limit) params.set("limit", String(limit));
    if (query) params.set("query", query);
    if (street) params.set("street", street);
    if (allNets) params.set("nets", "all");
    try {
      return jsonResult(await bridgeJson(`/city/road-graph?${bridgeQueryString(params)}`));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "cs2_connect_road",
  {
    title: "Build a connected road or track",
    description:
      "Build a road, track or other network segment whose ends join the existing network, like drawing with the " +
      "road tool's snapping: each end snaps to the nearest junction of a compatible network within `snap` meters, " +
      "otherwise splits the nearest compatible segment at that point (a track never joins a road). Ends with " +
      "nothing in range start freely on the terrain. Straight, or curved through cx/cz (needed where tracks must " +
      "leave a junction smoothly). Use for new road links and ramps, and for track spurs to station tracks (find " +
      "those with cs2_road_graph allNets). Validated by the game; costs money like a player build.",
    inputSchema: {
      prefab: z.string().describe("Exact network prefab name (cs2_find_prefabs category road or net)"),
      x1: z.number().describe("Start X"),
      z1: z.number().describe("Start Z"),
      x2: z.number().describe("End X"),
      z2: z.number().describe("End Z"),
      cx: z.number().optional().describe("Curve control point X (with cz)"),
      cz: z.number().optional().describe("Curve control point Z"),
      snap: z.number().min(0).max(50).optional().describe("Snap distance in meters (default 8; 0 = never snap)"),
      e1: z.number().optional().describe(
        "Height of a free (unsnapped) start in meters ABOVE THE TERRAIN under it: >0 bridge/flyover with pillars, " +
        "<0 tunnel. Ignored when the start snaps to a node or segment; it then takes that node's height. The curve " +
        "follows the terrain and is lifted by e1->e2 interpolated linearly along its length."),
      e2: z.number().optional().describe(
        "Height of a free (unsnapped) end in meters above the terrain (same rules as e1). For multi-piece ramps, end " +
        "each piece free at the target height. Start the next piece on that end; it snaps to the new node and inherits " +
        "its height, so the climb is continuous."),
      force: z.boolean().optional().describe("Build even if the prefab is milestone-locked"),
    },
  },
  async ({ prefab, x1, z1, x2, z2, cx, cz, snap, e1, e2, force }) => {
    const params = new URLSearchParams({
      prefab,
      x1: String(x1),
      z1: String(z1),
      x2: String(x2),
      z2: String(z2),
    });
    if (cx !== undefined) params.set("cx", String(cx));
    if (cz !== undefined) params.set("cz", String(cz));
    if (snap !== undefined) params.set("snap", String(snap));
    if (e1 !== undefined) params.set("e1", String(e1));
    if (e2 !== undefined) params.set("e2", String(e2));
    if (force) params.set("force", "true");
    try {
      return jsonResult(await bridgeJson(`/build/road/connect?${bridgeQueryString(params)}`, 15_000));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "cs2_prefab_info",
  {
    title: "Prefab dimensions and placement rules",
    description:
      "Footprint (lot in 8 m cells and meters), size, placement flags (e.g. Shoreline, RoadSide), placement " +
      "offset and cost of a building prefab, or the width and layers of a network prefab. Use before placing " +
      "large buildings such as harbors, stations and cargo terminals.",
    inputSchema: {
      name: z.string().describe("Exact prefab name (cs2_find_prefabs)"),
    },
  },
  async ({ name }) => {
    const params = new URLSearchParams({ name });
    try {
      return jsonResult(await bridgeJson(`/prefabs/info?${bridgeQueryString(params)}`));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "cs2_buildings_near",
  {
    title: "Buildings near a point",
    description:
      "Buildings around a point, nearest first, with kind (residential/commercial/office/industrial/park/service), " +
      "footprint, position and the direction their front faces. Use to find free spots or the building to clear " +
      "before placing a station or depot.",
    inputSchema: {
      x: z.number().describe("Center X"),
      z: z.number().describe("Center Z"),
      radius: z.number().min(1).max(1000).optional().describe("Radius in meters (default 100)"),
      limit: z.number().int().min(1).max(300).optional().describe("Max results (default 40)"),
      query: z.string().optional().describe("Only prefabs whose name contains this"),
    },
  },
  async ({ x, z: zCoord, radius, limit, query }) => {
    const params = new URLSearchParams({ x: String(x), z: String(zCoord) });
    if (radius !== undefined) params.set("radius", String(radius));
    if (limit) params.set("limit", String(limit));
    if (query) params.set("query", query);
    try {
      return jsonResult(await bridgeJson(`/city/buildings/near?${bridgeQueryString(params)}`));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "cs2_place_roadside",
  {
    title: "Place a building against a road",
    description:
      "Place a road-side building (station, depot, service building...) flush against a road segment, facing it: " +
      "at curve position t (0-1) along the segment, on its left or right side as seen driving from the segment's " +
      "start to its end. Position and rotation come from the road's geometry and the building's lot, so the front " +
      "touches the road edge. The game validates the placement; dryRun=true only reports it.",
    inputSchema: {
      prefab: z.string().describe("Exact building prefab name"),
      road: z.object({ index: z.number().int(), version: z.number().int() }).describe("Road segment (cs2_road_graph)"),
      side: z.enum(["left", "right"]).describe("Side of the road, as seen from the segment's start"),
      t: z.number().min(0).max(1).optional().describe("Position along the segment (default 0.5)"),
      gap: z.number().min(0).max(50).optional().describe("Extra distance from the road edge in meters (default 0)"),
      dryRun: z.boolean().optional().describe("Only compute the position and rotation"),
      force: z.boolean().optional().describe("Place even if the prefab is milestone-locked"),
    },
  },
  async ({ prefab, road, side, t, gap, dryRun, force }) => {
    const params = new URLSearchParams({ prefab, road: `${road.index}:${road.version}`, side });
    if (t !== undefined) params.set("t", String(t));
    if (gap !== undefined) params.set("gap", String(gap));
    if (dryRun) params.set("dryRun", "true");
    if (force) params.set("force", "true");
    try {
      return jsonResult(await bridgeJson(`/build/place/roadside?${bridgeQueryString(params)}`, 15_000));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "cs2_place_shoreline",
  {
    title: "Place a building on the shore",
    description:
      "Place a building that must stand on the water's edge (cargo/passenger harbors, water pumps, outlets...) at " +
      "the shoreline nearest a point, positioned and turned to face the land exactly like the game's placement " +
      "tool snaps it (the game then validates it). dryRun=true only reports the computed position and rotation. " +
      "Costs money like a player build.",
    inputSchema: {
      prefab: z.string().describe("Exact building prefab name"),
      x: z.number().describe("X of a point on the water's edge"),
      z: z.number().describe("Z of a point on the water's edge"),
      dryRun: z.boolean().optional().describe("Only compute the position and rotation"),
      force: z.boolean().optional().describe("Place even if the prefab is milestone-locked"),
    },
  },
  async ({ prefab, x, z: zCoord, dryRun, force }) => {
    const params = new URLSearchParams({ prefab, x: String(x), z: String(zCoord) });
    if (dryRun) params.set("dryRun", "true");
    if (force) params.set("force", "true");
    try {
      return jsonResult(await bridgeJson(`/build/place/shoreline?${bridgeQueryString(params)}`, 15_000));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "cs2_replace_road",
  {
    title: "Replace road type",
    description:
      "Change the road type of existing segments in place, like the road tool's Replace mode: e.g. widen a " +
      "highway (Highway Oneway - 2 lanes -> 3 lanes) or turn a street into a one-way one. The game regenerates " +
      "the segments, lanes and zone blocks and validates the result (a wider road can remove buildings it " +
      "overlaps). invert=true flips the drawing direction, which sets the direction of one-way roads. The game " +
      "updates segments in place, so they normally keep their ids; the replaced segments are returned by position.",
    inputSchema: {
      roads: z
        .array(z.object({ index: z.number().int(), version: z.number().int() }))
        .min(1)
        .max(50)
        .describe("Road segments to replace (from cs2_list_roads or cs2_traffic)"),
      prefab: z.string().describe("New road prefab name (cs2_find_prefabs category road)"),
      invert: z.boolean().optional().describe("Flip the drawing direction (one-way roads then run the other way)"),
      force: z.boolean().optional().describe("Use the prefab even if it is milestone-locked"),
    },
  },
  async ({ roads, prefab, invert, force }) => {
    const params = new URLSearchParams({
      roads: roads.map((r) => `${r.index}:${r.version}`).join(";"),
      prefab,
    });
    if (invert !== undefined) params.set("invert", String(invert));
    if (force) params.set("force", "true");
    try {
      return jsonResult(await bridgeJson(`/build/road/replace?${bridgeQueryString(params)}`, 15_000));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "cs2_line_policies",
  {
    title: "Transit line policies",
    description:
      "Policies available for one transit line (ticket price, vehicle count and similar options from the line " +
      "panel) with active state, current adjustment and slider range.",
    inputSchema: {
      index: z.number().int().describe("Line entity index (cs2_list_transit_lines)"),
      version: z.number().int().describe("Line entity version"),
    },
  },
  async ({ index, version }) => {
    const params = new URLSearchParams({ index: String(index), version: String(version) });
    try {
      return jsonResult(await bridgeJson(`/transit/lines/policies?${bridgeQueryString(params)}`));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "cs2_set_line_policy",
  {
    title: "Set transit line policy",
    description:
      "Activate/deactivate a policy on one transit line (name from cs2_line_policies), e.g. the ticket price or " +
      "vehicle count slider, the same way the line panel does.",
    inputSchema: {
      index: z.number().int().describe("Line entity index"),
      version: z.number().int().describe("Line entity version"),
      name: z.string().describe("Policy internal name"),
      active: z.boolean().describe("true to activate"),
      adjustment: z.number().optional().describe("Slider value for slider policies"),
    },
  },
  async ({ index, version, name, active, adjustment }) => {
    const params = new URLSearchParams({
      index: String(index),
      version: String(version),
      name,
      active: String(active),
    });
    if (adjustment !== undefined) params.set("adjustment", String(adjustment));
    try {
      return jsonResult(await bridgeJson(`/transit/lines/policies/set?${bridgeQueryString(params)}`));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "cs2_set_junction_control",
  {
    title: "Set junction traffic control",
    description:
      "Set how one road junction (node id from cs2_road_graph) is controlled, like the game's intersection " +
      "tools: lights = traffic lights, nolights = remove traffic lights, stop = all-way stop, default = the " +
      "game's automatic choice. Needs a junction of 3 or more roads. Save first: this recreates the junction.",
    inputSchema: {
      index: z.number().int().describe("Junction (node) entity index"),
      version: z.number().int().describe("Junction (node) entity version"),
      mode: z.enum(["lights", "nolights", "stop", "default"]).describe("Control to apply"),
    },
  },
  async ({ index, version, mode }) => {
    const params = new URLSearchParams({ index: String(index), version: String(version), mode });
    try {
      return jsonResult(await bridgeJson(`/build/junction?${bridgeQueryString(params)}`, 15_000));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "cs2_place_roundabout",
  {
    title: "Put a roundabout on a junction",
    description:
      "Place a roundabout (or another junction net object) on an existing road junction, like dropping one from " +
      "the game's Roundabouts menu onto an intersection: the game rebuilds the junction as a roundabout of the " +
      "prefab's size. Find prefabs with cs2_find_prefabs category 'netobject' (query 'round'; pick one whose size " +
      "fits between neighbouring junctions) and the junction id with cs2_road_graph. A roundabout already on the " +
      "junction is replaced. Validated by the game (overlap with buildings or nearby junctions fails); costs money. " +
      "Save first; check the result with cs2_road_graph / cs2_traffic.",
    inputSchema: {
      index: z.number().int().describe("Junction (node) entity index from cs2_road_graph"),
      version: z.number().int().describe("Junction (node) entity version"),
      prefab: z.string().describe("Roundabout prefab name from cs2_find_prefabs category 'netobject'"),
      force: z.boolean().optional().describe("Place even if the prefab is locked"),
    },
  },
  async ({ index, version, prefab, force }) => {
    const params = new URLSearchParams({ index: String(index), version: String(version), prefab });
    if (force) params.set("force", "true");
    try {
      return jsonResult(await bridgeJson(`/build/netobject?${bridgeQueryString(params)}`, 15_000));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "cs2_line_vehicles",
  {
    title: "Transit line vehicle models",
    description:
      "Vehicle models a transit line can use (the line panel's vehicle selection): the models currently chosen " +
      "and every candidate for the line's transport type with passenger capacity, role (engine, carriage, " +
      "multipleUnit or vehicle), max speed and the carriages an engine pulls.",
    inputSchema: {
      index: z.number().int().describe("Line entity index (cs2_list_transit_lines)"),
      version: z.number().int().describe("Line entity version"),
    },
  },
  async ({ index, version }) => {
    const params = new URLSearchParams({ index: String(index), version: String(version) });
    try {
      return jsonResult(await bridgeJson(`/transit/lines/vehicles?${bridgeQueryString(params)}`));
    } catch (err) {
      return errorResult(err);
    }
  },
);

server.registerTool(
  "cs2_set_line_vehicles",
  {
    title: "Set transit line vehicle model",
    description:
      "Choose the vehicle model new vehicles on a transit line use, as the line panel's vehicle selection does: " +
      "primary = engine or single vehicle, secondary = carriage (names from cs2_line_vehicles). clear=true goes " +
      "back to a random model per vehicle. Vehicles already running keep their model. This does NOT change how many " +
      "vehicles run: for that use cs2_set_line_policy with the line's vehicle-count policy (see cs2_line_policies, " +
      "'Route Vehicle Count' slider).",
    inputSchema: {
      index: z.number().int().describe("Line entity index"),
      version: z.number().int().describe("Line entity version"),
      primary: z.string().optional().describe("Engine or single-vehicle model name"),
      secondary: z.string().optional().describe("Carriage model name (trains)"),
      clear: z.boolean().optional().describe("Remove the choice (random model per vehicle)"),
      force: z.boolean().optional().describe("Allow a milestone-locked model"),
    },
  },
  async ({ index, version, primary, secondary, clear, force }) => {
    const params = new URLSearchParams({ index: String(index), version: String(version) });
    if (primary !== undefined) params.set("primary", primary);
    if (secondary !== undefined) params.set("secondary", secondary);
    if (clear !== undefined) params.set("clear", String(clear));
    if (force !== undefined) params.set("force", String(force));
    try {
      return jsonResult(await bridgeJson(`/transit/lines/vehicles/set?${bridgeQueryString(params)}`));
    } catch (err) {
      return errorResult(err);
    }
  },
);

// ---------------------------------------------------------------------------
// Token-saving tools: one compact city digest and batched build operations.
// ---------------------------------------------------------------------------

/** Notification types that are routine progress, not problems. */
const ROUTINE_NOTIFICATIONS = new Set(["Leveling Building", "Building Level Up", "Selected"]);

type Json = Record<string, any>;

const pct = (used: number, cap: number) => (cap > 0 ? Math.round((used / cap) * 100) : null);
const xz = (p: Json | undefined) => (p ? `${Math.round(p.x)},${Math.round(p.z)}` : "?");

server.registerTool(
  "cs2_city_digest",
  {
    title: "City digest (one-call review)",
    description:
      "Everything a city review needs in one compact reply: date/speed, population, happiness, health, money, " +
      "budget, power/water/sewage load (%), garbage, residential/commercial/industrial/office demand with the " +
      "strongest factors, zone fill, unspent development points and affordable nodes, problem warnings grouped by " +
      "type with a few locations (routine 'leveling' icons left out), city traffic flow with the worst roads, and " +
      "transit line ridership. Use this instead of calling the individual status tools one by one.",
    inputSchema: {
      warningLocations: z.number().int().min(0).max(20).optional().describe("Locations listed per warning type (default 4)"),
      worstRoads: z.number().int().min(0).max(25).optional().describe("Worst roads to list (default 6)"),
    },
  },
  async ({ warningLocations, worstRoads }) => {
    const perType = warningLocations ?? 4;
    const roadCount = worstRoads ?? 6;
    const paths = {
      state: "/state",
      overview: "/city/overview",
      budget: "/city/budget",
      services: "/city/services",
      demand: "/city/demand",
      zoning: "/city/zoning",
      devtree: "/city/devtree",
      notifications: "/city/notifications?limit=500",
      traffic: `/city/traffic?limit=${Math.max(roadCount, 1)}&minVolume=50`,
      lines: "/transit/lines",
    } as const;
    const keys = Object.keys(paths) as (keyof typeof paths)[];
    const settled = await Promise.allSettled(keys.map((k) => bridgeJson(paths[k], 20_000)));
    const got: Partial<Record<keyof typeof paths, Json>> = {};
    const failed: string[] = [];
    settled.forEach((r, i) => {
      if (r.status === "fulfilled") got[keys[i]] = r.value as Json;
      else failed.push(`${keys[i]}: ${(r.reason as Error).message}`);
    });
    if (!got.overview) return errorResult(new Error(`digest failed: ${failed.join("; ")}`));

    const o = got.overview;
    const sim = got.state?.simulation ?? {};
    const digest: Json = {
      date: o.gameDateTime,
      sim: sim.paused ? "paused" : `x${sim.selectedSpeed}`,
      pop: o.population,
      movingIn: (o.populationWithMoveIn ?? o.population) - o.population,
      happiness: o.averageHappiness,
      health: o.averageHealth,
      money: Math.round(o.money),
      xp: o.xp,
    };

    const b = got.budget;
    if (b) {
      digest.budget = {
        income: Math.round(b.totalIncome),
        expenses: Math.round(Math.abs(b.totalExpenses)),
        balance: Math.round(b.balance),
        loanInterest: Math.round(b.expenses?.LoanInterest ?? 0),
      };
    }

    const s = got.services;
    if (s) {
      const e = s.electricity ?? {};
      const w = s.water ?? {};
      digest.utilities = {
        powerMW: `${Math.round((e.consumption ?? 0) / 1000)}/${Math.round((e.production ?? 0) / 1000)} (${pct(e.consumption, e.production)}%)`,
        powerUnmet: Math.round(((e.consumption ?? 0) - (e.fulfilledConsumption ?? 0)) / 1000) || undefined,
        water: `${Math.round((w.freshConsumption ?? 0) / 1000)}k/${Math.round((w.freshCapacity ?? 0) / 1000)}k (${pct(w.freshConsumption, w.freshCapacity)}%)`,
        sewage: `${Math.round((w.sewageConsumption ?? 0) / 1000)}k/${Math.round((w.sewageCapacity ?? 0) / 1000)}k (${pct(w.sewageConsumption, w.sewageCapacity)}%)`,
        imports: (e.import || w.freshImport) ? { power: e.import, water: w.freshImport } : undefined,
        garbageRate: Math.round(s.garbage?.accumulationRate ?? 0),
      };
    }

    const d = got.demand;
    if (d) {
      const strong = (factors: Json | undefined) =>
        Object.entries(factors ?? {})
          .filter(([, v]) => Math.abs(Number(v)) >= 40)
          .map(([k, v]) => `${k} ${v}`)
          .join(", ") || undefined;
      const r = d.residential ?? {};
      digest.demand = {
        res: r.buildingDemand,
        resFactors: strong(r.factors?.mediumDensity),
        com: d.commercial?.buildingDemand,
        comFactors: strong(d.commercial?.factors),
        ind: d.industrial?.buildingDemand,
        indFactors: strong(d.industrial?.factors),
        off: d.office?.buildingDemand,
        offFactors: strong(d.office?.factors),
      };
    }

    const zn = got.zoning;
    if (zn?.byZone) {
      const zones: Json = {};
      for (const [name, v] of Object.entries(zn.byZone as Json)) {
        zones[name] = `${pct(v.occupied, v.cells)}% of ${v.cells} (${v.empty} empty)`;
      }
      digest.zones = zones;
    }

    const dt = got.devtree;
    if (dt) {
      const pts = dt.points ?? 0;
      digest.devPoints = pts;
      if (pts > 0) {
        digest.devAffordable = (dt.nodes ?? [])
          .filter((n: Json) => !n.purchased && n.allRequirementsPurchased && n.cost <= pts)
          .map((n: Json) => `${n.name}(${n.cost})`);
      }
    }

    const nt = got.notifications;
    if (nt) {
      const byType: Json = {};
      for (const [type, count] of Object.entries((nt.countsByType ?? {}) as Json)) {
        if (ROUTINE_NOTIFICATIONS.has(type)) continue;
        byType[type] = { n: count, at: [] as string[] };
      }
      for (const item of (nt.notifications ?? []) as Json[]) {
        const slot = byType[item.type];
        if (slot && slot.at.length < perType) slot.at.push(xz(item.location));
      }
      digest.warnings = Object.fromEntries(
        Object.entries(byType).map(([t, v]) => [t, perType > 0 ? `${v.n} @ ${v.at.join(" ")}` : v.n]),
      );
    }

    const tr = got.traffic;
    if (tr) {
      digest.traffic = {
        flow: tr.cityTrafficFlowPercent,
        under25: tr.congestedRoads?.below25Percent,
        bottlenecks: tr.bottlenecks?.count,
        worst: ((tr.worstRoads ?? []) as Json[])
          .slice(0, roadCount)
          .map((r) => `${r.prefab} ${xz(r.start)}->${xz(r.end)} ${r.flowPercent}% v${Math.round(r.volume)}`),
      };
    }

    const ln = got.lines;
    if (ln?.lines) {
      digest.transit = (ln.lines as Json[]).map(
        (l) => `${l.name}: ${l.vehicles} veh, ${l.passengersOnBoard} pax, ${Math.round((l.usage ?? 0) * 100)}%${l.active ? "" : " INACTIVE"}`,
      );
    }

    if (failed.length) digest.unavailable = failed;
    return { content: [{ type: "text" as const, text: VERBOSE ? JSON.stringify(digest, null, 2) : JSON.stringify(digest) }] };
  },
);

const segRef = z.object({ index: z.number().int(), version: z.number().int() });

const batchOp = z.discriminatedUnion("op", [
  z.object({ op: z.literal("upgrade"), index: z.number().int(), version: z.number().int(), upgrades: z.string(),
    side: z.enum(["both", "left", "right"]).optional(), remove: z.boolean().optional() }),
  z.object({ op: z.literal("replace"), roads: z.array(segRef).min(1).max(50), prefab: z.string(), invert: z.boolean().optional() }),
  z.object({ op: z.literal("zone"), zone: z.string(), x: z.number(), z: z.number(), radius: z.number().optional() }),
  z.object({ op: z.literal("connect"), prefab: z.string(), x1: z.number(), z1: z.number(), x2: z.number(), z2: z.number(),
    snap: z.number().optional(), cx: z.number().optional(), cz: z.number().optional(), e1: z.number().optional(), e2: z.number().optional() }),
  z.object({ op: z.literal("demolish"), index: z.number().int(), version: z.number().int() }),
  z.object({ op: z.literal("junction"), index: z.number().int(), version: z.number().int(), mode: z.enum(["lights", "nolights", "stop", "default"]) }),
  z.object({ op: z.literal("roundabout"), index: z.number().int(), version: z.number().int(), prefab: z.string() }),
  z.object({ op: z.literal("roadside"), prefab: z.string(), road: segRef, side: z.enum(["left", "right"]), t: z.number().optional(), gap: z.number().optional() }),
  z.object({ op: z.literal("stop"), type: z.enum(["bus", "tram"]), x: z.number(), z: z.number(), prefab: z.string().optional(), radius: z.number().optional() }),
  z.object({ op: z.literal("place"), prefab: z.string(), x: z.number(), z: z.number(), rotation: z.number().optional() }),
]);
type BatchOp = z.infer<typeof batchOp>;

/** Bridge path and query for one batch operation. */
function batchRequest(op: BatchOp): string {
  const p = new URLSearchParams();
  const set = (k: string, v: unknown) => { if (v !== undefined) p.set(k, String(v)); };
  let path: string;
  switch (op.op) {
    case "upgrade": path = "/build/upgrade"; set("index", op.index); set("version", op.version); set("upgrades", op.upgrades);
      set("side", op.side); if (op.remove) set("remove", "true"); break;
    case "replace": path = "/build/road/replace"; set("roads", op.roads.map((r) => `${r.index}:${r.version}`).join(";"));
      set("prefab", op.prefab); set("invert", op.invert); break;
    case "zone": path = "/build/zone"; set("zone", op.zone); set("x", op.x); set("z", op.z); set("radius", op.radius); break;
    case "connect": path = "/build/road/connect"; for (const k of ["prefab", "x1", "z1", "x2", "z2", "snap", "cx", "cz", "e1", "e2"] as const) set(k, op[k]); break;
    case "demolish": path = "/build/demolish"; set("index", op.index); set("version", op.version); break;
    case "junction": path = "/build/junction"; set("index", op.index); set("version", op.version); set("mode", op.mode); break;
    case "roundabout": path = "/build/netobject"; set("index", op.index); set("version", op.version); set("prefab", op.prefab); break;
    case "roadside": path = "/build/place/roadside"; set("prefab", op.prefab); set("road", `${op.road.index}:${op.road.version}`);
      set("side", op.side); set("t", op.t); set("gap", op.gap); break;
    case "stop": path = "/transit/stops/place"; set("type", op.type); set("x", op.x); set("z", op.z); set("prefab", op.prefab); set("radius", op.radius); break;
    case "place": path = "/build/place"; set("prefab", op.prefab); set("x", op.x); set("z", op.z); set("rotation", op.rotation); break;
  }
  return `${path}?${bridgeQueryString(p)}`;
}

/** One-line result: just the ids and numbers needed for follow-up calls. */
function batchSummary(op: BatchOp, r: Json): string {
  switch (op.op) {
    case "stop": return `stop ${r.stop?.index}:${r.stop?.version} @${xz(r.position)}`;
    case "connect": return `segs ${((r.segments ?? []) as Json[]).map((s) => `${s.road.index}:${s.road.version}`).join(",") || "none(nothing built?)"}`;
    case "zone": return `${r.cellsChanged} cells`;
    case "replace": return `${r.replaced} replaced`;
    case "roadside": case "place": return `${r.prefab ?? op.prefab} @${xz(r.position)}`;
    case "demolish": return `removed ${r.prefab}`;
    default: return "ok";
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

server.registerTool(
  "cs2_batch",
  {
    title: "Batch build operations",
    description:
      "Run many build operations in one call, in order (the game applies one build at a time; this waits and " +
      "retries while the previous one finishes). Ops: upgrade (road upgrades incl. tram, remove=true to take off), " +
      "replace (road type), zone, connect (road/track/pipe/path), demolish, junction (lights/nolights/stop), roundabout (net object on a junction), " +
      "roadside (building flush to a road), stop (bus/tram stop), place (building at x,z). Returns one short line per " +
      "op with the new ids. Same semantics and costs as the single-op tools.",
    inputSchema: {
      ops: z.array(batchOp).min(1).max(60).describe("Operations, run in order"),
      stopOnError: z.boolean().optional().describe("Stop at the first failed op (default false: continue)"),
    },
  },
  async ({ ops, stopOnError }) => {
    const lines: string[] = [];
    let ok = 0;
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      let line = "";
      for (let attempt = 0; attempt < 12; attempt++) {
        try {
          const r = (await bridgeJson(batchRequest(op), 20_000)) as Json;
          line = `#${i} ${op.op} ok: ${batchSummary(op, r)}`;
          ok++;
          break;
        } catch (err) {
          const msg = (err as Error).message;
          if (/in progress|retry shortly/i.test(msg) && attempt < 11) {
            await sleep(500);
            continue;
          }
          line = `#${i} ${op.op} FAILED: ${msg.slice(0, 160)}`;
          break;
        }
      }
      lines.push(line);
      if (stopOnError && line.includes("FAILED")) break;
    }
    lines.unshift(`${ok}/${ops.length} ok`);
    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`cs2-mcp 0.8.0 running on stdio (bridge: ${BRIDGE_URL})`);
