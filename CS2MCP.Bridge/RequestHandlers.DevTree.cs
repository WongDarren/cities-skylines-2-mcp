using System;
using System.Collections.Generic;
using Game.City;
using Game.Prefabs;
using Unity.Collections;
using Unity.Entities;

namespace CS2MCP
{
    /// <summary>
    /// Development tree (the "progression" upgrades bought with development
    /// points). Nodes are prefab entities with DevTreeNodeData; a node is bought
    /// once its Locked component is disabled. Purchases go through
    /// DevTreeSystem.Purchase, the same call the game's Progression panel makes,
    /// so point spending, requirement checks and unlock events stay the game's.
    /// </summary>
    public sealed partial class RequestHandlers
    {
        private EntityQuery m_DevTreeNodeQuery;
        private bool m_DevTreeNodeQueryCreated;

        private EntityQuery DevTreeNodeQuery
        {
            get
            {
                if (!m_DevTreeNodeQueryCreated)
                {
                    m_DevTreeNodeQuery = EntityManager.CreateEntityQuery(ComponentType.ReadOnly<DevTreeNodeData>());
                    m_DevTreeNodeQueryCreated = true;
                }
                return m_DevTreeNodeQuery;
            }
        }

        private BridgeResponse GetDevTree()
        {
            if (!TryGetCity(out _, out BridgeResponse error))
            {
                return error;
            }

            PrefabSystem prefabSystem = World.GetOrCreateSystemManaged<PrefabSystem>();
            DevTreeSystem devTree = World.GetOrCreateSystemManaged<DevTreeSystem>();
            int points = devTree.points;

            var nodes = new List<object>();
            using (NativeArray<Entity> entities = DevTreeNodeQuery.ToEntityArray(Allocator.Temp))
            {
                foreach (Entity entity in entities)
                {
                    DevTreeNodePrefab prefab = prefabSystem.GetPrefab<DevTreeNodePrefab>(entity);
                    if (prefab == null)
                    {
                        continue;
                    }
                    DevTreeNodeData data = EntityManager.GetComponentData<DevTreeNodeData>(entity);
                    bool purchased = !IsLocked(entity);
                    bool serviceUnlocked = data.m_Service == Entity.Null || !IsLocked(data.m_Service);

                    var requirements = new List<string>();
                    bool anyRequirementMet = false;
                    bool allRequirementsMet = true;
                    if (EntityManager.HasBuffer<DevTreeNodeRequirement>(entity))
                    {
                        DynamicBuffer<DevTreeNodeRequirement> reqs =
                            EntityManager.GetBuffer<DevTreeNodeRequirement>(entity, isReadOnly: true);
                        for (int i = 0; i < reqs.Length; i++)
                        {
                            Entity req = reqs[i].m_Node;
                            if (req == Entity.Null)
                            {
                                continue;
                            }
                            DevTreeNodePrefab reqPrefab = prefabSystem.GetPrefab<DevTreeNodePrefab>(req);
                            requirements.Add(reqPrefab != null ? reqPrefab.name : req.ToString());
                            bool met = !IsLocked(req);
                            anyRequirementMet |= met;
                            allRequirementsMet &= met;
                        }
                    }
                    bool requirementsMet = requirements.Count == 0 || anyRequirementMet;

                    nodes.Add(new
                    {
                        name = prefab.name,
                        service = data.m_Service != Entity.Null
                            ? prefabSystem.GetPrefab<PrefabBase>(data.m_Service)?.name
                            : null,
                        cost = data.m_Cost,
                        purchased,
                        serviceUnlocked,
                        requirements,
                        allRequirementsPurchased = requirements.Count == 0 || allRequirementsMet,
                        affordable = !purchased && serviceUnlocked && requirementsMet && data.m_Cost <= points,
                    });
                }
            }

            return BridgeResponse.Json(new
            {
                points,
                note = "buy with /city/devtree/purchase?name=<node name>; 'affordable' assumes a node needs any one " +
                       "of its listed requirements (the game validates the purchase itself)",
                nodes,
            });
        }

        private BridgeResponse PurchaseDevTreeNode(BridgeRequest request)
        {
            if (!TryGetCity(out _, out BridgeResponse error))
            {
                return error;
            }
            if (!request.Query.TryGetValue("name", out string nodeName) || string.IsNullOrEmpty(nodeName))
            {
                return BridgeResponse.Error(400, "provide ?name=<node name from /city/devtree>");
            }

            PrefabSystem prefabSystem = World.GetOrCreateSystemManaged<PrefabSystem>();
            DevTreeSystem devTree = World.GetOrCreateSystemManaged<DevTreeSystem>();
            using (NativeArray<Entity> entities = DevTreeNodeQuery.ToEntityArray(Allocator.Temp))
            {
                foreach (Entity entity in entities)
                {
                    DevTreeNodePrefab prefab = prefabSystem.GetPrefab<DevTreeNodePrefab>(entity);
                    if (prefab == null || !string.Equals(prefab.name, nodeName, StringComparison.OrdinalIgnoreCase))
                    {
                        continue;
                    }
                    if (!IsLocked(entity))
                    {
                        return BridgeResponse.Error(409, $"'{prefab.name}' is already purchased");
                    }
                    DevTreeNodeData data = EntityManager.GetComponentData<DevTreeNodeData>(entity);
                    int before = devTree.points;
                    if (data.m_Cost > before)
                    {
                        return BridgeResponse.Error(409, $"'{prefab.name}' costs {data.m_Cost} points; only {before} available");
                    }
                    if (data.m_Service != Entity.Null && IsLocked(data.m_Service))
                    {
                        return BridgeResponse.Error(409, $"'{prefab.name}' needs its service unlocked by a milestone first");
                    }

                    devTree.Purchase(entity);
                    return BridgeResponse.Json(new
                    {
                        requested = prefab.name,
                        cost = data.m_Cost,
                        pointsBefore = before,
                        pointsAfter = devTree.points,
                        note = "the game applies the unlock at end of frame; re-list /city/devtree to confirm " +
                               "(points unchanged = the game refused, usually a missing prerequisite)",
                    });
                }
            }

            return BridgeResponse.Error(404, $"unknown dev tree node '{nodeName}'; list names via /city/devtree");
        }
    }
}
