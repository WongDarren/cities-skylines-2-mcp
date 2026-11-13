using System.Collections.Generic;
using System.Linq;
using Game.City;
using Game.Prefabs;
using Game.Simulation;
using Unity.Collections;
using Unity.Entities;
using Unity.Mathematics;

namespace CS2MCP
{
    /// <summary>
    /// Milestone progress. Milestones are prefab entities with MilestoneData
    /// (index, cumulative XP required, rewards); the reached index is the
    /// MilestoneLevel singleton and the city's XP is CitySystem.XP, the same
    /// values MilestoneSystem compares each update to advance milestones.
    /// </summary>
    public sealed partial class RequestHandlers
    {
        private EntityQuery m_MilestoneQuery;
        private EntityQuery m_MilestoneLevelQuery;
        private bool m_MilestoneQueriesCreated;

        private BridgeResponse GetMilestones()
        {
            if (!TryGetCity(out _, out BridgeResponse error))
            {
                return error;
            }
            if (!m_MilestoneQueriesCreated)
            {
                m_MilestoneQuery = EntityManager.CreateEntityQuery(ComponentType.ReadOnly<MilestoneData>());
                m_MilestoneLevelQuery = EntityManager.CreateEntityQuery(ComponentType.ReadOnly<MilestoneLevel>());
                m_MilestoneQueriesCreated = true;
            }

            int xp = World.GetOrCreateSystemManaged<CitySystem>().XP;
            int achieved = m_MilestoneLevelQuery.CalculateEntityCount() > 0
                ? m_MilestoneLevelQuery.GetSingleton<MilestoneLevel>().m_AchievedMilestone
                : 0;
            PrefabSystem prefabSystem = World.GetOrCreateSystemManaged<PrefabSystem>();
            var dictionary = Game.SceneFlow.GameManager.instance?.localizationManager?.activeDictionary;

            var rows = new List<(MilestoneData data, string name, string title)>();
            using (NativeArray<Entity> entities = m_MilestoneQuery.ToEntityArray(Allocator.Temp))
            {
                foreach (Entity entity in entities)
                {
                    MilestoneData data = EntityManager.GetComponentData<MilestoneData>(entity);
                    PrefabBase prefab = prefabSystem.GetPrefab<PrefabBase>(entity);
                    string title = null;
                    if (dictionary != null)
                    {
                        if (!dictionary.TryGetValue($"Progression.MILESTONE_NAME:{data.m_Index}", out title) && prefab != null)
                        {
                            dictionary.TryGetValue($"Assets.NAME[{prefab.name}]", out title);
                        }
                    }
                    rows.Add((data, prefab != null ? prefab.name : null, title));
                }
            }
            rows.Sort((a, b) => a.data.m_Index.CompareTo(b.data.m_Index));

            var milestones = rows.Select(r => new
            {
                index = r.data.m_Index,
                name = r.name,
                title = r.title,
                xpRequired = r.data.m_XpRequried,
                reached = r.data.m_Index <= achieved,
                xpToGo = math.max(0, r.data.m_XpRequried - xp),
                rewardMoney = r.data.m_Reward,
                devTreePoints = r.data.m_DevTreePoints,
                mapTiles = r.data.m_MapTiles,
                loanLimit = r.data.m_LoanLimit,
                major = r.data.m_Major,
                isVictory = r.data.m_IsVictory,
            }).ToList();

            var current = rows.FirstOrDefault(r => r.data.m_Index == achieved);
            var next = rows.FirstOrDefault(r => r.data.m_Index == achieved + 1);
            bool hasNext = next.data.m_Index == achieved + 1 && next.name != null;
            int lastRequired = current.name != null ? current.data.m_XpRequried : 0;

            return BridgeResponse.Json(new
            {
                currentMilestone = new
                {
                    index = achieved,
                    name = current.name,
                    title = current.title,
                    xpRequired = lastRequired,
                },
                xp,
                nextMilestone = hasNext
                    ? new
                    {
                        index = next.data.m_Index,
                        name = next.name,
                        title = next.title,
                        xpRequired = next.data.m_XpRequried,
                        xpToGo = math.max(0, next.data.m_XpRequried - xp),
                        progress = next.data.m_XpRequried > lastRequired
                            ? math.saturate((float)(xp - lastRequired) / (next.data.m_XpRequried - lastRequired))
                            : 1f,
                    }
                    : null,
                maxMilestone = rows.Count > 0 ? rows[rows.Count - 1].data.m_Index : 0,
                milestones,
                note = "xpRequired is the city's cumulative XP needed to reach that milestone (CitySystem.XP, the same value " +
                       "the game compares). Rewards are granted on reaching it: rewardMoney is added to the treasury, loanLimit " +
                       "raises the credit limit, devTreePoints and mapTiles are the development points and tile permits it adds. " +
                       "XP comes from population growth, happiness and building/service placement.",
            });
        }
    }
}
