using System;
using System.Collections.Generic;
using Colossal.Mathematics;
using Game.Common;
using Game.Net;
using Game.Prefabs;
using Game.Simulation;
using Game.Tools;
using Unity.Collections;
using Unity.Entities;
using Unity.Mathematics;

namespace CS2MCP
{
    /// <summary>
    /// Road changes through BridgeRoadToolSystem: Replace (the road tool's
    /// Replace mode) changes the road type of existing segments, e.g. widen a
    /// highway or turn a two-way street into a one-way one, keeping the nodes,
    /// connections and (where the width allows) the buildings along it; Connect
    /// builds a segment whose ends snap to existing junctions or split existing
    /// segments, so new links, ramps and track spurs are actually joined up.
    /// </summary>
    public sealed partial class RequestHandlers
    {
        private BridgeResponse ConnectRoad(BridgeRequest request)
        {
            if (!TryGetCity(out _, out BridgeResponse error))
            {
                return error;
            }
            if (!request.Query.TryGetValue("prefab", out string prefabName) || string.IsNullOrEmpty(prefabName))
            {
                return BridgeResponse.Error(400, "provide ?prefab=<network prefab name> (see cs2_find_prefabs category road or net)");
            }
            if (!request.TryGetFloat("x1", out float x1) || !request.TryGetFloat("z1", out float z1)
                || !request.TryGetFloat("x2", out float x2) || !request.TryGetFloat("z2", out float z2))
            {
                return BridgeResponse.Error(400, "provide ?x1=&z1=&x2=&z2= world coordinates for both ends");
            }
            float snap = request.TryGetFloat("snap", out float rawSnap) ? math.clamp(rawSnap, 0f, 50f) : 8f;
            if (!TryFindPrefabByName(NetPrefabQuery, prefabName, out Entity prefabEntity, out PrefabBase prefab))
            {
                return BridgeResponse.Error(404, $"unknown network prefab '{prefabName}' (see cs2_find_prefabs category road or net)");
            }
            if (IsLocked(prefabEntity) && !IsForced(request))
            {
                return BridgeResponse.Error(409, $"prefab '{prefab.name}' is locked (milestone not reached); pass force=true to build anyway");
            }
            if (!EntityManager.HasComponent<NetData>(prefabEntity))
            {
                return BridgeResponse.Error(400, $"'{prefab.name}' is not a network prefab");
            }
            NetData netData = EntityManager.GetComponentData<NetData>(prefabEntity);

            TerrainHeightData heightData = World.GetOrCreateSystemManaged<TerrainSystem>().GetHeightData();
            BridgeRoadToolSystem.BuildEnd start = ResolveBuildEnd(new float2(x1, z1), new float2(x2, z2), snap, netData, ref heightData);
            BridgeRoadToolSystem.BuildEnd end = ResolveBuildEnd(new float2(x2, z2), new float2(x1, z1), snap, netData, ref heightData);
            // Free ends can be raised (bridges, flyovers) or lowered (tunnels); snapped ends keep the height of what they join.
            if (start.Entity == Entity.Null && request.TryGetFloat("e1", out float e1))
            {
                start.Elevation = math.clamp(e1, -30f, 60f);
                start.Position.y += start.Elevation;
            }
            if (end.Entity == Entity.Null && request.TryGetFloat("e2", out float e2))
            {
                end.Elevation = math.clamp(e2, -30f, 60f);
                end.Position.y += end.Elevation;
            }
            if (start.Entity != Entity.Null && start.Entity == end.Entity)
            {
                return BridgeResponse.Error(400, "both ends snap to the same junction or segment; move an end or lower snap");
            }
            float length = math.distance(start.Position.xz, end.Position.xz);
            if (length < 4f || length > 1500f)
            {
                return BridgeResponse.Error(400, $"segment length after snapping is {length:F0}m; it must be 4-1500m");
            }

            Bezier4x3 bezier;
            if (request.TryGetFloat("cx", out float cx) & request.TryGetFloat("cz", out float cz))
            {
                // Quadratic bezier through the control point, elevated to cubic.
                float3 a = start.Position;
                float3 d = end.Position;
                float3 m = new float3(cx, math.lerp(a.y, d.y, 0.5f), cz);
                bezier = new Bezier4x3(a, a + (m - a) * (2f / 3f), d + (m - d) * (2f / 3f), d);
            }
            else
            {
                bezier = NetUtils.StraightCurve(start.Position, end.Position);
            }
            // Follow the terrain between the ends, then lift the middle by the
            // interpolated end elevations (as cs2_build_road does for bridges).
            Curve raw = new Curve { m_Bezier = bezier, m_Length = MathUtils.Length(bezier) };
            bezier = NetUtils.AdjustPosition(raw, start.Entity != Entity.Null, false, end.Entity != Entity.Null, ref heightData).m_Bezier;
            bezier.b.y += math.lerp(start.Elevation, end.Elevation, 1f / 3f);
            bezier.c.y += math.lerp(start.Elevation, end.Elevation, 2f / 3f);
            bezier.a = start.Position;
            bezier.d = end.Position;

            if (TransitToolsBusy(out error))
            {
                return error;
            }
            BridgeRoadToolSystem tool = World.GetOrCreateSystemManaged<BridgeRoadToolSystem>();
            if (!tool.TryQueueBuild(prefabEntity, prefab, start, end, bezier, request))
            {
                return BridgeResponse.Error(409, "another road operation is in progress, retry shortly");
            }
            // Completed asynchronously by BridgeRoadToolSystem over the next tool frames.
            return null;
        }

        /// <summary>
        /// Snap like the road tool: the nearest junction of a compatible network
        /// within the snap distance, else the nearest compatible segment (split
        /// there, or its end node when the point is at an end), else a free point
        /// on the terrain. Compatible = the networks' layers can connect (so a
        /// track never joins a road).
        /// </summary>
        private BridgeRoadToolSystem.BuildEnd ResolveBuildEnd(float2 point, float2 toward, float snap, NetData netData, ref TerrainHeightData heightData)
        {
            Entity bestNode = Entity.Null;
            float bestNodeDistance = snap;
            Entity bestEdge = Entity.Null;
            float bestEdgeDistance = snap;
            float bestT = 0f;
            using (NativeArray<Entity> edges = NetEdgeQuery.ToEntityArray(Allocator.Temp))
            {
                foreach (Entity edge in edges)
                {
                    Entity edgePrefab = EntityManager.GetComponentData<PrefabRef>(edge).m_Prefab;
                    if (!EntityManager.HasComponent<NetData>(edgePrefab))
                    {
                        continue;
                    }
                    NetData other = EntityManager.GetComponentData<NetData>(edgePrefab);
                    if ((netData.m_ConnectLayers & other.m_RequiredLayers) == 0 && (other.m_ConnectLayers & netData.m_RequiredLayers) == 0)
                    {
                        continue;
                    }
                    Bezier4x3 curve = EntityManager.GetComponentData<Curve>(edge).m_Bezier;
                    float2 min = math.min(math.min(curve.a.xz, curve.b.xz), math.min(curve.c.xz, curve.d.xz));
                    float2 max = math.max(math.max(curve.a.xz, curve.b.xz), math.max(curve.c.xz, curve.d.xz));
                    if (math.any(point < min - snap) || math.any(point > max + snap))
                    {
                        continue;
                    }
                    Edge ends = EntityManager.GetComponentData<Edge>(edge);
                    foreach (Entity node in new[] { ends.m_Start, ends.m_End })
                    {
                        float nodeDistance = math.distance(EntityManager.GetComponentData<Node>(node).m_Position.xz, point);
                        if (nodeDistance < bestNodeDistance)
                        {
                            bestNodeDistance = nodeDistance;
                            bestNode = node;
                        }
                    }
                    if (!AllowEdgeSplit(edge))
                    {
                        // Like the net tool: a segment owned by a building or asset
                        // (one of its sub-nets) can only be joined at its end nodes.
                        continue;
                    }
                    float edgeDistance = MathUtils.Distance(curve.xz, point, out float t);
                    if (edgeDistance < bestEdgeDistance)
                    {
                        bestEdgeDistance = edgeDistance;
                        bestEdge = edge;
                        bestT = t;
                    }
                }
            }

            // Orphan nodes (no segment starts or ends there) are never reached
            // through the segments above. A building's network connection point
            // is such a node: a sub-net node of a transformer, power plant,
            // pumping station... whose prefab carries e.g. ElectricityConnectionData,
            // and which the player's power line or pipe snaps to.
            FindConnectionNode(point, toward, netData, ref bestNode, ref bestNodeDistance, bestEdge == Entity.Null, out Entity connectionBuilding);

            var result = new BridgeRoadToolSystem.BuildEnd();
            result.Building = connectionBuilding;
            if (bestNode == Entity.Null && bestEdge != Entity.Null && (bestT < 0.02f || bestT > 0.98f))
            {
                Edge ends = EntityManager.GetComponentData<Edge>(bestEdge);
                bestNode = bestT < 0.02f ? ends.m_Start : ends.m_End;
            }
            if (bestNode != Entity.Null)
            {
                result.Entity = bestNode;
                result.Position = EntityManager.GetComponentData<Node>(bestNode).m_Position;
                result.Elevation = EntityManager.HasComponent<Game.Net.Elevation>(bestNode)
                    ? math.csum(EntityManager.GetComponentData<Game.Net.Elevation>(bestNode).m_Elevation) * 0.5f
                    : 0f;
            }
            else if (bestEdge != Entity.Null)
            {
                result.Entity = bestEdge;
                result.Split = bestT;
                result.Position = MathUtils.Position(EntityManager.GetComponentData<Curve>(bestEdge).m_Bezier, bestT);
                result.Elevation = EntityManager.HasComponent<Game.Net.Elevation>(bestEdge)
                    ? math.csum(EntityManager.GetComponentData<Game.Net.Elevation>(bestEdge).m_Elevation) * 0.5f
                    : 0f;
            }
            else
            {
                result.Position = new float3(point.x, 0f, point.y);
                result.Position.y = TerrainUtils.SampleHeight(ref heightData, result.Position);
            }
            return result;
        }

        /// <summary>
        /// Mirrors NetToolSystem.SnapJob.NetIterator.HandleCurve: outside the
        /// editor, a segment owned by anything but an unowned segment (i.e. a
        /// building's or asset's sub-net) cannot be split mid-way.
        /// </summary>
        private bool AllowEdgeSplit(Entity edge)
        {
            if (!EntityManager.HasComponent<Owner>(edge))
            {
                return true;
            }
            Entity owner = EntityManager.GetComponentData<Owner>(edge).m_Owner;
            return EntityManager.HasComponent<Edge>(owner) && !EntityManager.HasComponent<Owner>(owner);
        }

        private EntityQuery m_NetNodeQuery;
        private bool m_NetNodeQueryCreated;

        /// <summary>Every network node with its connected-edge buffer.</summary>
        private EntityQuery NetNodeQuery
        {
            get
            {
                if (!m_NetNodeQueryCreated)
                {
                    m_NetNodeQuery = EntityManager.CreateEntityQuery(new EntityQueryDesc
                    {
                        All = new[]
                        {
                            ComponentType.ReadOnly<Node>(),
                            ComponentType.ReadOnly<PrefabRef>(),
                            ComponentType.ReadOnly<ConnectedEdge>(),
                        },
                        None = new[]
                        {
                            ComponentType.ReadOnly<Deleted>(),
                            ComponentType.ReadOnly<Temp>(),
                        },
                    });
                    m_NetNodeQueryCreated = true;
                }
                return m_NetNodeQuery;
            }
        }

        /// <summary>
        /// Orphan nodes of a compatible network (NetToolSystem.SnapJob snaps to
        /// these through HandleGeometry): within snap distance they compete with
        /// the other junctions by distance. When nothing else is in range
        /// (allowBuildingFallback) and the point lies on the lot of a building
        /// that owns such a node, the end snaps to that building's connection
        /// point, so a power line can be connected by naming the building's
        /// position.
        /// </summary>
        private void FindConnectionNode(float2 point, float2 toward, NetData netData, ref Entity bestNode, ref float bestNodeDistance,
            bool allowBuildingFallback, out Entity connectionBuilding)
        {
            connectionBuilding = Entity.Null;
            Entity fallbackNode = Entity.Null;
            Entity fallbackBuilding = Entity.Null;
            float fallbackDistance = float.MaxValue;
            using (NativeArray<Entity> nodes = NetNodeQuery.ToEntityArray(Allocator.Temp))
            {
                foreach (Entity node in nodes)
                {
                    DynamicBuffer<ConnectedEdge> connected = EntityManager.GetBuffer<ConnectedEdge>(node, isReadOnly: true);
                    bool orphan = true;
                    for (int i = 0; i < connected.Length; i++)
                    {
                        Edge ends = EntityManager.GetComponentData<Edge>(connected[i].m_Edge);
                        if (ends.m_Start == node || ends.m_End == node)
                        {
                            orphan = false;
                            break;
                        }
                    }
                    if (!orphan)
                    {
                        continue;
                    }
                    Entity nodePrefab = EntityManager.GetComponentData<PrefabRef>(node).m_Prefab;
                    if (!EntityManager.HasComponent<NetData>(nodePrefab))
                    {
                        continue;
                    }
                    NetData other = EntityManager.GetComponentData<NetData>(nodePrefab);
                    if ((netData.m_ConnectLayers & other.m_RequiredLayers) == 0 && (other.m_ConnectLayers & netData.m_RequiredLayers) == 0)
                    {
                        continue;
                    }
                    float distance = math.distance(EntityManager.GetComponentData<Node>(node).m_Position.xz, point);
                    if (distance < bestNodeDistance)
                    {
                        bestNodeDistance = distance;
                        bestNode = node;
                        connectionBuilding = OwningBuilding(node);
                        allowBuildingFallback = false;
                        continue;
                    }
                    if (allowBuildingFallback && bestNode == Entity.Null && math.distance(EntityManager.GetComponentData<Node>(node).m_Position.xz, toward) < fallbackDistance)
                    {
                        Entity building = OwningBuilding(node);
                        if (building != Entity.Null && OnBuildingLot(node, point))
                        {
                            fallbackDistance = math.distance(EntityManager.GetComponentData<Node>(node).m_Position.xz, toward);
                            fallbackNode = node;
                            fallbackBuilding = building;
                        }
                    }
                }
            }
            if (allowBuildingFallback && bestNode == Entity.Null && fallbackNode != Entity.Null)
            {
                bestNode = fallbackNode;
                bestNodeDistance = math.distance(EntityManager.GetComponentData<Node>(fallbackNode).m_Position.xz, point);
                connectionBuilding = fallbackBuilding;
            }
        }

        /// <summary>The top-level object (building) in a sub-net's owner chain, or Null.</summary>
        private Entity OwningBuilding(Entity entity)
        {
            Entity owner = Entity.Null;
            for (int depth = 0; depth < 8 && EntityManager.HasComponent<Owner>(entity); depth++)
            {
                entity = EntityManager.GetComponentData<Owner>(entity).m_Owner;
                if (!EntityManager.Exists(entity))
                {
                    break;
                }
                if (EntityManager.HasComponent<Game.Objects.Transform>(entity))
                {
                    owner = entity;
                }
            }
            return owner;
        }

        /// <summary>Whether the point is on the lot of a building or extension in the node's owner chain.</summary>
        private bool OnBuildingLot(Entity node, float2 point)
        {
            Entity entity = node;
            for (int depth = 0; depth < 8 && EntityManager.HasComponent<Owner>(entity); depth++)
            {
                entity = EntityManager.GetComponentData<Owner>(entity).m_Owner;
                if (!EntityManager.Exists(entity))
                {
                    break;
                }
                if (!EntityManager.HasComponent<Game.Objects.Transform>(entity) || !EntityManager.HasComponent<PrefabRef>(entity))
                {
                    continue;
                }
                Entity prefab = EntityManager.GetComponentData<PrefabRef>(entity).m_Prefab;
                int2 lot;
                if (EntityManager.HasComponent<BuildingData>(prefab))
                {
                    lot = EntityManager.GetComponentData<BuildingData>(prefab).m_LotSize;
                }
                else if (EntityManager.HasComponent<BuildingExtensionData>(prefab))
                {
                    lot = EntityManager.GetComponentData<BuildingExtensionData>(prefab).m_LotSize;
                }
                else
                {
                    continue;
                }
                Game.Objects.Transform transform = EntityManager.GetComponentData<Game.Objects.Transform>(entity);
                float3 offset = new float3(point.x, transform.m_Position.y, point.y) - transform.m_Position;
                float3 local = math.mul(math.inverse(transform.m_Rotation), offset);
                // Lot sizes are in 8m cells; allow a few meters beyond the edge.
                if (math.abs(local.x) <= lot.x * 4f + 4f && math.abs(local.z) <= lot.y * 4f + 4f)
                {
                    return true;
                }
            }
            return false;
        }

        private BridgeResponse ReplaceRoad(BridgeRequest request)
        {
            if (!TryGetCity(out _, out BridgeResponse error))
            {
                return error;
            }
            if (!request.Query.TryGetValue("prefab", out string prefabName) || string.IsNullOrEmpty(prefabName))
            {
                return BridgeResponse.Error(400, "provide ?prefab=<road prefab name> (see cs2_find_prefabs category road)");
            }
            if (!request.Query.TryGetValue("roads", out string rawRoads) || string.IsNullOrEmpty(rawRoads))
            {
                return BridgeResponse.Error(400,
                    "provide ?roads=<list separated by ';'>, each 'index:version' of a road segment from cs2_list_roads");
            }
            string[] items = rawRoads.Split(new[] { ';' }, StringSplitOptions.RemoveEmptyEntries);
            if (items.Length > 50)
            {
                return BridgeResponse.Error(400, "too many segments in one replacement (max 50)");
            }

            var edges = new List<Entity>();
            for (int i = 0; i < items.Length; i++)
            {
                string item = items[i].Trim();
                if (!TryParseEntityRef(item, out Entity edge) || !EntityManager.Exists(edge)
                    || !EntityManager.HasComponent<Edge>(edge) || !EntityManager.HasComponent<Curve>(edge)
                    || !EntityManager.HasComponent<Composition>(edge))
                {
                    return BridgeResponse.Error(404, $"segment #{i + 1} ('{item}') is not an existing road segment (use index:version from cs2_list_roads)");
                }
                if (EntityManager.HasComponent<Temp>(edge) || EntityManager.HasComponent<Deleted>(edge))
                {
                    return BridgeResponse.Error(409, $"segment #{i + 1} ('{item}') is being modified; retry shortly");
                }
                if (EntityManager.HasComponent<Owner>(edge))
                {
                    return BridgeResponse.Error(409,
                        $"segment #{i + 1} ('{item}') belongs to a building or asset (e.g. an interchange); replace the owner instead");
                }
                if (!edges.Contains(edge))
                {
                    edges.Add(edge);
                }
            }

            if (!TryFindPrefabByName(RoadPrefabQuery, prefabName, out Entity prefabEntity, out PrefabBase prefab))
            {
                return BridgeResponse.Error(404, $"no road prefab named '{prefabName}' (see cs2_find_prefabs category road)");
            }
            if (IsLocked(prefabEntity) && !IsForced(request))
            {
                return BridgeResponse.Error(409, $"road prefab '{prefab.name}' is locked (milestone not reached); pass force=true to use it anyway");
            }
            bool invert = request.TryGetBool("invert", out bool rawInvert) && rawInvert;
            if (TransitToolsBusy(out error))
            {
                return error;
            }

            BridgeRoadToolSystem tool = World.GetOrCreateSystemManaged<BridgeRoadToolSystem>();
            if (!tool.TryQueueReplace(edges.ToArray(), prefabEntity, prefab, invert, request))
            {
                return BridgeResponse.Error(409, "another road operation is in progress, retry shortly");
            }
            // Completed asynchronously by BridgeRoadToolSystem over the next tool frames.
            return null;
        }
    }
}
