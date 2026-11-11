using System;
using System.Collections.Concurrent;
using Colossal.Serialization.Entities;
using Game;
using Game.Simulation;
using UnityEngine.Scripting;

namespace CS2MCP
{
    /// <summary>
    /// ECS system that owns the localhost bridge server. Requests arrive on
    /// listener threads, get queued here, and are executed in OnUpdate on the
    /// simulation main thread (the only place ECS access is safe).
    /// Registered at SystemUpdatePhase.UIUpdate so it keeps running while paused.
    /// </summary>
    public sealed partial class BridgeSystem : GameSystemBase
    {
        public const int DefaultPort = 8642;

        public static BridgeSystem Instance { get; private set; }

        private HttpBridgeServer m_Server;
        private RequestHandlers m_Handlers;
        private SimulationSystem m_SimulationSystem;
        private uint m_FrameIndexAtLoad;
        private readonly ConcurrentQueue<BridgeRequest> m_Pending = new ConcurrentQueue<BridgeRequest>();

        /// <summary>
        /// False until the simulation has advanced at least one frame after the
        /// current save finished loading. While false, unlock replay (Locked
        /// component removal, tax parameter unlocks...) may not have run yet,
        /// so lock states read from ECS can be stale.
        /// </summary>
        public bool SimulationHasTickedSinceLoad { get; private set; } = true;

        /// <summary>Frame at which the simulation auto-pauses (0 = disabled).</summary>
        public uint AutoPauseTargetFrame { get; private set; }

        public void SetAutoPause(uint targetFrame)
        {
            AutoPauseTargetFrame = targetFrame;
        }

        /// <summary>Speed a timed run uses; restored after a popup paused the game mid-run.</summary>
        public float AutoRunSpeed { get; set; } = 4f;

        // Game UI systems expose parameterless "clear" handlers that the popups' Close
        // buttons trigger (milestone reached, signature building unlocked). Opening such a
        // popup pauses the game, which would stall a timed run with nobody at the screen.
        private static readonly string[] kPopupClearMethods = { "ClearUnlockedMilestone", "ClearUnlockedSignature" };
        private System.Collections.Generic.List<(object system, System.Reflection.MethodInfo method)> m_PopupClearers;
        private uint m_LastPopupCheckFrame;

        /// <summary>
        /// Invokes every parameterless popup-clear handler found on the game's systems,
        /// exactly as the popups' Close buttons do. Returns the handlers invoked.
        /// </summary>
        public System.Collections.Generic.List<string> DismissPopups()
        {
            if (m_PopupClearers == null)
            {
                m_PopupClearers = new System.Collections.Generic.List<(object, System.Reflection.MethodInfo)>();
                const System.Reflection.BindingFlags flags = System.Reflection.BindingFlags.Instance
                    | System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.NonPublic;
                foreach (Unity.Entities.ComponentSystemBase system in base.World.Systems)
                {
                    foreach (string name in kPopupClearMethods)
                    {
                        System.Reflection.MethodInfo method = system.GetType().GetMethod(name, flags, null, Type.EmptyTypes, null);
                        if (method != null)
                        {
                            m_PopupClearers.Add((system, method));
                        }
                    }
                }
                Mod.Log.Info($"popup clear handlers found: {m_PopupClearers.Count}");
            }
            var invoked = new System.Collections.Generic.List<string>();
            foreach ((object system, System.Reflection.MethodInfo method) in m_PopupClearers)
            {
                try
                {
                    method.Invoke(system, null);
                    invoked.Add(system.GetType().Name + "." + method.Name);
                }
                catch (Exception e)
                {
                    Mod.Log.Warn($"{system.GetType().Name}.{method.Name} failed: {e.InnerException?.Message ?? e.Message}");
                }
            }
            return invoked;
        }

        [Preserve]
        protected override void OnCreate()
        {
            base.OnCreate();
            Instance = this;
            m_Handlers = new RequestHandlers(this);
            m_SimulationSystem = base.World.GetOrCreateSystemManaged<SimulationSystem>();

            int port = DefaultPort;
            string envPort = Environment.GetEnvironmentVariable("CS2MCP_PORT");
            if (!string.IsNullOrEmpty(envPort) && int.TryParse(envPort, out int parsed) && parsed > 0 && parsed < 65536)
            {
                port = parsed;
            }

            m_Server = new HttpBridgeServer(port, m_Pending.Enqueue);
            try
            {
                m_Server.Start();
                Mod.Log.Info($"bridge listening on http://127.0.0.1:{port}");
            }
            catch (Exception e)
            {
                Mod.Log.Error(e, $"failed to start bridge server on port {port}");
                m_Server = null;
            }
        }

        [Preserve]
        protected override void OnGameLoadingComplete(Purpose purpose, GameMode mode)
        {
            base.OnGameLoadingComplete(purpose, mode);
            m_FrameIndexAtLoad = m_SimulationSystem.frameIndex;
            SimulationHasTickedSinceLoad = false;
        }

        [Preserve]
        protected override void OnUpdate()
        {
            if (!SimulationHasTickedSinceLoad && m_SimulationSystem.frameIndex != m_FrameIndexAtLoad)
            {
                SimulationHasTickedSinceLoad = true;
            }
            if (AutoPauseTargetFrame != 0 && m_SimulationSystem.frameIndex >= AutoPauseTargetFrame)
            {
                m_SimulationSystem.selectedSpeed = 0f;
                AutoPauseTargetFrame = 0;
                Mod.Log.Info("timed run finished, simulation auto-paused");
            }
            else if (AutoPauseTargetFrame != 0 && m_SimulationSystem.selectedSpeed == 0f
                && m_SimulationSystem.frameIndex != m_LastPopupCheckFrame)
            {
                // A timed run got paused before its target: a reward popup most likely opened.
                // Close popups and resume, once per stalled frame so a manual pause by the
                // player during a run is only overridden when a popup was actually handled.
                m_LastPopupCheckFrame = m_SimulationSystem.frameIndex;
                if (DismissPopups().Count > 0)
                {
                    m_SimulationSystem.selectedSpeed = AutoRunSpeed;
                    Mod.Log.Info("timed run: closed popups and resumed");
                }
            }
            while (m_Pending.TryDequeue(out BridgeRequest request))
            {
                BridgeResponse response;
                try
                {
                    // A null response means the handler completes the request
                    // asynchronously itself (e.g. screenshots at end-of-frame).
                    response = m_Handlers.Handle(request);
                }
                catch (Exception e)
                {
                    Mod.Log.Warn($"error handling {request.Method} {request.Path}: {e}");
                    response = BridgeResponse.Error(500, $"{e.GetType().Name}: {e.Message}");
                }
                if (response != null)
                {
                    request.Complete(response);
                }
            }
        }

        public void StopServer()
        {
            m_Server?.Stop();
            m_Server = null;
        }

        [Preserve]
        protected override void OnDestroy()
        {
            StopServer();
            if (Instance == this)
            {
                Instance = null;
            }
            base.OnDestroy();
        }
    }
}
