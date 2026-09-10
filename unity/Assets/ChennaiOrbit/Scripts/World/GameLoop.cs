using System;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;
using ChennaiOrbit.Core;
using ChennaiOrbit.Data;

namespace ChennaiOrbit.World
{
    /// <summary>
    /// Port of <c>src/vr/game.js</c>: pick a zone, place as many of its
    /// measures as the zone's own land can hold, watch it respond.
    ///
    /// Nothing here caps you at one of each measure. What limits you is real:
    /// each zone's buildable land (non-built, non-road area, from its own
    /// coverage data) and each measure's own footprint. Dropping a measure
    /// near the zone's gold-ringed building-density hotspot cools more than the
    /// same measure in a quiet corner — the "optimal placement" reward, read
    /// off the same footprint data the tabletop is built from.
    /// </summary>
    public class GameLoop : MonoBehaviour
    {
        public event Action OnChanged;
        public string SelectedZoneId { get; private set; }
        public bool BeforeMode { get; private set; }

        class Placed
        {
            public int uid;
            public string interventionId;
            public float effectiveness;
            public SolutionFactory.Solution solution;
        }

        readonly Dictionary<string, List<Placed>> _placed = new Dictionary<string, List<Placed>>();
        readonly Dictionary<string, float> _buildableCache = new Dictionary<string, float>();
        int _uid = 1;

        CityBuilder _city;
        List<ZoneProfile> _zones;
        Baseline _baseline;
        Audio.AmbientAudio _audio;

        public void Init(CityBuilder city, List<ZoneProfile> zones, Baseline baseline, Audio.AmbientAudio audio)
        {
            _city = city; _zones = zones; _baseline = baseline; _audio = audio;
        }

        ZoneProfile Zone(string id) => _zones.FirstOrDefault(z => z.zone.id == id);
        List<Placed> PlacementsFor(string id) => _placed.TryGetValue(id, out var l) ? l : (_placed[id] = new List<Placed>());

        public float BuildableFor(string id)
        {
            if (!_buildableCache.TryGetValue(id, out var v))
            {
                var z = Zone(id);
                v = z != null ? HeatModel.BuildableAreaSqm(z.zone) : 0f;
                _buildableCache[id] = v;
            }
            return v;
        }

        public float UsedAreaFor(string id)
        {
            var z = Zone(id);
            if (z == null) return 0f;
            var byId = z.interventions.ToDictionary(i => i.id);
            float sum = 0f;
            foreach (var p in PlacementsFor(id))
                if (byId.TryGetValue(p.interventionId, out var it))
                    sum += HeatModel.FootprintSqm(it).Sqm;
            return sum;
        }

        public float RemainingAreaFor(string id) => Mathf.Max(0f, BuildableFor(id) - UsedAreaFor(id));

        public int RoomFor(string id, Intervention item)
            => HeatModel.MaxCountFor(item, RemainingAreaFor(id));

        public int CountPlaced(string id, string interventionId)
            => PlacementsFor(id).Count(p => p.interventionId == interventionId);

        public struct Capacity
        {
            public float buildableSqm, usedSqm, remainingSqm, pct;
        }

        public Capacity CapacityFor(string id)
        {
            float b = BuildableFor(id), u = UsedAreaFor(id);
            return new Capacity
            {
                buildableSqm = b,
                usedSqm = u,
                remainingSqm = Mathf.Max(0f, b - u),
                pct = b > 0f ? Mathf.Min(1f, u / b) : 1f,
            };
        }

        public HeatModel.ImpactResult ResultFor(string id)
        {
            var z = Zone(id);
            if (z == null) return default;
            var placements = PlacementsFor(id)
                .Select(p => new HeatModel.Placement { interventionId = p.interventionId, effectiveness = p.effectiveness })
                .ToList();
            return HeatModel.ImpactPlacements(z.interventions, placements, _baseline?.value_c, z.zone.lst_celsius);
        }

        public HeatModel.ImpactResult CeilingFor(string id)
        {
            var z = Zone(id);
            return z == null ? default
                : HeatModel.CeilingFor(z.interventions, _baseline?.value_c, z.zone.lst_celsius);
        }

        // --- Selection ----------------------------------------------------

        readonly List<GameObject> _cards = new List<GameObject>();

        public void Select(string id)
        {
            var zp = Zone(id);
            if (zp == null) return;
            SelectedZoneId = id;
            _city.Select(id);
            SpawnCards(zp);
            _audio?.Ping();
            OnChanged?.Invoke();
        }

        /// <summary>Three floating cards above the selected zone — pinch one to
        /// lift a measure. Port of refreshCards() in game.js.</summary>
        void SpawnCards(ZoneProfile zp)
        {
            foreach (var c in _cards) if (c) Destroy(c);
            _cards.Clear();

            var cc = HeatModel.ProjectLatLon(zp.zone.center);
            for (int i = 0; i < zp.interventions.Count && i < 3; i++)
            {
                var item = zp.interventions[i];
                var go = GameObject.CreatePrimitive(PrimitiveType.Quad);
                go.name = "Card_" + item.id;
                go.transform.SetParent(_city.Root, false);
                go.transform.localPosition = new Vector3(cc.x + (i - 1) * 0.32f, 4.6f, cc.y);
                go.transform.localScale = new Vector3(0.26f, 0.32f, 1f);
                go.GetComponent<Renderer>().sharedMaterial =
                    HoloFactory.Glow(Palette.ForCategory(item.category), 0.16f);
                var col = go.GetComponent<Collider>();
                if (col is MeshCollider mc) mc.convex = true;
                if (col) col.isTrigger = true;
                var card = go.AddComponent<SolutionCard>();
                card.slot = i;
                card.interventionId = item.id;

                var body = SolutionFactory.BuildBody(item.category, Palette.ForCategory(item.category), go.transform);
                body.transform.localPosition = new Vector3(0, 0.9f, 0.1f);
                body.transform.localScale = Vector3.one * 0.14f;

                _cards.Add(go);
            }
        }

        public IReadOnlyList<GameObject> Cards => _cards;

        // --- Placement --------------------------------------------------

        /// <summary>Effectiveness 0.5–1.0 from distance to the zone's real
        /// building-density hotspot.</summary>
        public float EffectivenessAt(string zoneId, Vector2 localXz)
        {
            var hot = _city.HotspotFor(zoneId);
            if (hot == null) return 0.85f;
            var z = Zone(zoneId).zone;
            var b0 = HeatModel.ProjectLatLon(z.bounds[0]);
            var b1 = HeatModel.ProjectLatLon(z.bounds[1]);
            float radius = Mathf.Max(0.05f,
                new Vector2(Mathf.Abs(b0.x - b1.x), Mathf.Abs(b0.z - b1.z)).magnitude / 2f);
            float dist = Vector2.Distance(localXz, hot.Value);
            return Mathf.Clamp(1f - 0.5f * (dist / radius), 0.5f, 1f);
        }

        /// <summary>Try to place one instance. Returns false (and pings) when
        /// the zone's buildable land is full.</summary>
        public bool TryPlace(string zoneId, Intervention item, Vector2 localXz, Transform parent)
        {
            if (RoomFor(zoneId, item) <= 0)
            {
                _audio?.Ping();
                OnChanged?.Invoke();
                return false;
            }

            float eff = EffectivenessAt(zoneId, localXz);
            var sol = SolutionFactory.Create(item, ghost: false);
            sol.Effectiveness = eff;
            sol.Root.transform.SetParent(parent, false);
            sol.Root.transform.localPosition = new Vector3(localXz.x, 0.02f, localXz.y);
            sol.Land();
            sol.SetValid(eff > 0.75f);

            int uid = _uid++;
            var pm = sol.Root.AddComponent<PlacedMeasure>();
            pm.zoneId = zoneId; pm.uid = uid;
            foreach (var col in sol.Root.GetComponentsInChildren<Collider>()) col.enabled = true;

            PlacementsFor(zoneId).Add(new Placed
            {
                uid = uid,
                interventionId = item.id,
                effectiveness = eff,
                solution = sol,
            });

            BeforeMode = false;
            _audio?.Ping();
            Recolour(zoneId);
            OnChanged?.Invoke();
            return true;
        }

        public void Remove(string zoneId, int uid)
        {
            var list = PlacementsFor(zoneId);
            int i = list.FindIndex(p => p.uid == uid);
            if (i < 0) return;
            Destroy(list[i].solution.Root);
            list.RemoveAt(i);
            BeforeMode = false;
            _audio?.Ping();
            Recolour(zoneId);
            OnChanged?.Invoke();
        }

        public void ClearZone(string zoneId)
        {
            foreach (var p in PlacementsFor(zoneId).ToArray()) Remove(zoneId, p.uid);
        }

        public void SetBefore(bool before)
        {
            BeforeMode = before;
            foreach (var list in _placed.Values)
                foreach (var p in list)
                    p.solution.Root.SetActive(!before);
            OnChanged?.Invoke();
        }

        void Recolour(string zoneId)
        {
            var r = BeforeMode ? default : ResultFor(zoneId);
            _city.ApplyCooling(zoneId, r.drop);
        }

        void Update()
        {
            float dt = Time.deltaTime, t = Time.time;
            foreach (var list in _placed.Values)
                foreach (var p in list)
                    p.solution.Tick(dt, t);
        }
    }
}
