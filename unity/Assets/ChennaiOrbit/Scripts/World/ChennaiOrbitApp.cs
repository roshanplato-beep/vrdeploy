using System.Collections;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;
using ChennaiOrbit.Core;
using ChennaiOrbit.Data;
using ChennaiOrbit.Interaction;
using ChennaiOrbit.Audio;

namespace ChennaiOrbit.World
{
    /// <summary>
    /// Top-level orchestrator, port of the core of <c>src/vr/scene.js</c>:
    /// loads the data, builds the globe and the city, runs the
    /// globe → diving → city state machine, and keeps the three in-world
    /// panels (wrist HUD, zone list, zone detail + land capacity + cost) in
    /// sync with the game.
    ///
    /// Put this on one GameObject under your XR Origin. It creates everything
    /// else at runtime — the WebXR build is fully procedural, so there are no
    /// art prefabs to wire, only the XR rig and this component.
    /// </summary>
    public class ChennaiOrbitApp : MonoBehaviour
    {
        public enum Mode { Loading, Globe, Diving, City }
        public Mode CurrentMode { get; private set; } = Mode.Loading;

        [Header("XR (assign from your rig)")]
        public Transform head;                       // Main Camera transform
        public XrPointer leftPointer;
        public XrPointer rightPointer;
        public Transform leftHandAnchor;             // for the wrist HUD

        [Header("Tuning")]
        public float diveSeconds = 1.1f;

        CityBuilder _city;
        GlobeController _globe;
        GameLoop _game;
        AmbientAudio _audio;
        WeatherService _weather = new WeatherService();

        DataLoader.LoadedData _data;
        Dictionary<string, WeatherService.Reading> _readings = new Dictionary<string, WeatherService.Reading>();

        WorldPanel _wrist, _zoneList, _zoneDetail;
        int _zoneListPage;
        const int ZonesPerPage = 6;

        SolutionFactory.Solution _carry;
        XrPointer _carryPointer;
        Intervention _carryItem;

        IEnumerator Start()
        {
            _audio = gameObject.AddComponent<AmbientAudio>();

            string err = null;
            yield return DataLoader.Load(d => _data = d, e => err = e);
            if (_data == null)
            {
                Debug.LogError("Chennai Orbit: data load failed — " + err);
                yield break;
            }

            _globe = gameObject.AddComponent<GlobeController>();
            _globe.Build(transform);
            _globe.OnThermalStatus += s => { if (_wrist) RefreshWrist(); };

            _city = gameObject.AddComponent<CityBuilder>();
            yield return _city.Build(_data.profilesHottestFirst, _data.baseline, _data.osm,
                                     msg => Debug.Log("[Chennai Orbit] " + msg));

            _game = gameObject.AddComponent<GameLoop>();
            _game.Init(_city, _data.profilesHottestFirst, _data.baseline, _audio);
            _game.OnChanged += RefreshPanels;

            BuildPanels();
            WirePointers();

            _city.SetVisible(false);
            _globe.SetVisible(true);
            SetMode(Mode.Globe);

            StartCoroutine(RefreshWeatherLoop());
        }

        // --- Panels ------------------------------------------------------

        void BuildPanels()
        {
            _wrist = WorldPanel.Create("WristHUD", 0.16f, 0.13f, 560);
            if (leftHandAnchor) _wrist.transform.SetParent(leftHandAnchor, false);
            _wrist.transform.localPosition = new Vector3(0.01f, 0.05f, -0.05f);
            _wrist.transform.localRotation = Quaternion.Euler(-30f, 20f, 8f);

            _zoneList = WorldPanel.Create("ZoneList", 0.46f, 0.66f, 760);
            _zoneDetail = WorldPanel.Create("ZoneDetail", 0.46f, 0.66f, 760);
            _zoneList.gameObject.SetActive(false);
            _zoneDetail.gameObject.SetActive(false);
        }

        void RefreshPanels()
        {
            RefreshWrist();
            RefreshZoneList();
            RefreshZoneDetail();
        }

        void RefreshWrist()
        {
            if (_wrist == null) return;
            if (CurrentMode == Mode.Globe)
            {
                _wrist.Begin("Spin the world", "CHENNAI ORBIT");
                _wrist.AddLabel("Pinch the marker over India, or the ENTER card, to descend.", 20, WorldPanel.Body);
                _wrist.AddButton(_globe != null && _globe.ThermalOn ? "Thermal: on" : "Live thermal view",
                    () => _globe.ToggleThermal(this), _globe != null && _globe.ThermalOn);
                return;
            }
            var id = _game.SelectedZoneId;
            var r = id != null ? _game.ResultFor(id) : default;
            _wrist.Begin($"-{r.drop:0.00}°C · {HeatModel.Money(r.total)}", "CHENNAI ORBIT");
            _wrist.AddButton(_game.BeforeMode ? "After" : "Before", () => _game.SetBefore(!_game.BeforeMode), _game.BeforeMode);
            _wrist.AddButton("Clear zone", () => { if (id != null) _game.ClearZone(id); });
            _wrist.AddButton("Return to orbit", Ascend);
        }

        void RefreshZoneList()
        {
            if (_zoneList == null || CurrentMode != Mode.City) { if (_zoneList) _zoneList.gameObject.SetActive(false); return; }
            _zoneList.gameObject.SetActive(true);
            var zones = _data.profilesHottestFirst;
            int pages = Mathf.CeilToInt(zones.Count / (float)ZonesPerPage);
            _zoneListPage = Mathf.Clamp(_zoneListPage, 0, pages - 1);

            _zoneList.Begin($"Page {_zoneListPage + 1} / {pages}", "18 HOTSPOTS · PICK A ZONE");
            for (int i = _zoneListPage * ZonesPerPage; i < Mathf.Min(zones.Count, (_zoneListPage + 1) * ZonesPerPage); i++)
            {
                var z = zones[i].zone;
                bool active = z.id == _game.SelectedZoneId;
                string label = $"{(i + 1):00}  {z.name}  ·  {z.risk_level} · {z.lst_celsius:0.0}°C";
                _zoneList.AddButton(label, () => _game.Select(z.id), active);
            }
            _zoneList.AddButton("◀ Prev", () => { _zoneListPage = (_zoneListPage - 1 + pages) % pages; RefreshZoneList(); });
            _zoneList.AddButton("Next ▶", () => { _zoneListPage = (_zoneListPage + 1) % pages; RefreshZoneList(); });
        }

        void RefreshZoneDetail()
        {
            if (_zoneDetail == null || CurrentMode != Mode.City || _game.SelectedZoneId == null)
            { if (_zoneDetail) _zoneDetail.gameObject.SetActive(false); return; }
            _zoneDetail.gameObject.SetActive(true);

            var id = _game.SelectedZoneId;
            var zp = _data.profilesHottestFirst.First(z => z.zone.id == id);
            var z = zp.zone;
            var r = _game.BeforeMode ? default : _game.ResultFor(id);
            var ceiling = _game.CeilingFor(id);
            var cap = _game.CapacityFor(id);
            _readings.TryGetValue(id, out var reading);

            _zoneDetail.Begin(z.name, "ZONE DETAIL & CAPACITY");
            _zoneDetail.AddStat($"{(z.lst_celsius - r.drop):0.00}°C", "Modelled surface temperature now", WorldPanel.Warm);
            _zoneDetail.AddRow("Baseline zone temperature", $"{z.lst_celsius:0.00}°C");
            _zoneDetail.AddRow("Cooling achieved", $"-{r.drop:0.00}°C of {ceiling.drop:0.00}°C ceiling");
            _zoneDetail.AddRow("Open-Meteo reading",
                reading != null ? $"{reading.airTempC:0.0}°C air (live)" : "Live weather unavailable");

            _zoneDetail.AddLabel("LAND CAPACITY", 20, WorldPanel.Accent, FontStyle.Bold);
            _zoneDetail.AddRow("Buildable land (this zone)", $"{cap.buildableSqm:n0} m²");
            _zoneDetail.AddRow("Used by placed measures", $"{cap.usedSqm:n0} m² ({cap.pct * 100f:0}%)");
            _zoneDetail.AddBar(cap.pct, cap.pct > 0.9f ? WorldPanel.Warm : WorldPanel.Accent);

            _zoneDetail.AddLabel("COST", 20, WorldPanel.Accent, FontStyle.Bold);
            _zoneDetail.AddRow("Measures placed", $"{r.count}");
            _zoneDetail.AddRow("Material cost", HeatModel.Money(r.material));
            _zoneDetail.AddRow("Total incl. install + contingency", HeatModel.Money(r.total));

            _zoneDetail.AddLabel(
                "Costs are catalogue assumptions, not contractor quotes. Cooling keeps 75% of its sum once more than one measure category is placed, and can never model a zone cooler than the study's own rural baseline.",
                16, WorldPanel.Muted);
        }

        // --- State machine ---------------------------------------------

        void SetMode(Mode m)
        {
            CurrentMode = m;
            RefreshPanels();
        }

        public void Dive()
        {
            if (CurrentMode != Mode.Globe) return;
            StartCoroutine(DiveRoutine());
        }

        IEnumerator DiveRoutine()
        {
            SetMode(Mode.Diving);
            _audio.Enable();
            float t = 0f;
            var g = _globe.Root;
            var startScale = g.localScale;
            while (t < 1f)
            {
                t += Time.deltaTime / diveSeconds;
                float eased = 1f - Mathf.Pow(1f - Mathf.Clamp01(t), 3f);
                g.localScale = Vector3.Lerp(startScale, Vector3.one * 0.0001f, eased);
                yield return null;
            }
            _globe.SetVisible(false);
            g.localScale = startScale;
            _city.SetVisible(true);
            _city.Root.localPosition = new Vector3(-0.18f, 0.85f, -1.7f);

            if (_game.SelectedZoneId == null)
                _game.Select(_data.profilesHottestFirst[0].zone.id);
            SetMode(Mode.City);
        }

        public void Ascend()
        {
            if (CurrentMode != Mode.City) return;
            _city.SetVisible(false);
            _zoneList.gameObject.SetActive(false);
            _zoneDetail.gameObject.SetActive(false);
            _globe.SetVisible(true);
            SetMode(Mode.Globe);
        }

        // --- Pointer wiring ------------------------------------------

        void WirePointers()
        {
            foreach (var p in new[] { leftPointer, rightPointer })
            {
                if (p == null) continue;
                p.OnSelect += HandleSelect;
                p.OnRelease += HandleRelease;
            }
        }

        void HandleSelect(XrPointer p, RaycastHit? hit)
        {
            if (_carry != null) { CommitCarry(); return; }
            if (hit == null || hit.Value.collider == null) return;
            var go = hit.Value.collider.gameObject;

            if (CurrentMode == Mode.Globe)
            {
                if (go.GetComponentInParent<EnterTarget>() != null) { Dive(); return; }
                if (go.GetComponentInParent<ThermalToggleTarget>() != null) { _globe.ToggleThermal(this); return; }
                return;
            }

            if (CurrentMode != Mode.City) return;

            var placed = go.GetComponentInParent<PlacedMeasure>();
            if (placed != null) { _game.Remove(placed.zoneId, placed.uid); return; }

            var marker = go.GetComponentInParent<ZoneMarker>();
            if (marker != null) { _game.Select(marker.zoneId); return; }

            var card = go.GetComponentInParent<SolutionCard>();
            if (card != null) { LiftCard(card, p); return; }
        }

        void HandleRelease(XrPointer p)
        {
            if (_carry != null && _carryPointer == p) CommitCarry();
        }

        void LiftCard(SolutionCard card, XrPointer p)
        {
            var zp = _data.profilesHottestFirst.First(z => z.zone.id == _game.SelectedZoneId);
            var item = zp.interventions.FirstOrDefault(i => i.id == card.interventionId);
            if (item == null) return;
            if (_game.RoomFor(_game.SelectedZoneId, item) <= 0) { _audio.Ping(); return; }

            _carryItem = item;
            _carryPointer = p;
            _carry = SolutionFactory.Create(item, ghost: true);
            _carry.Root.transform.SetParent(_city.Root, false);
        }

        void CommitCarry()
        {
            if (_carry == null) return;
            var local = _carry.Root.transform.localPosition;
            Destroy(_carry.Root);
            _carry = null;
            _game.TryPlace(_game.SelectedZoneId, _carryItem, new Vector2(local.x, local.z), _city.Root);
            _carryPointer = null;
        }

        void Update()
        {
            if (_globe != null && CurrentMode == Mode.Globe)
            {
                // One-hand grab spins the globe (handled by a Grab component in
                // a full build); here the idle ambient rotation is enough for
                // the state machine to be exercised.
            }

            if (_carry != null && _carryPointer != null && _carryPointer.Tracked)
            {
                // Slide the ghost along the map under the pointer, clamped into
                // the selected zone (port of clampToZone).
                var z = _data.profilesHottestFirst.First(x => x.zone.id == _game.SelectedZoneId).zone;
                var b0 = HeatModel.ProjectLatLon(z.bounds[0]);
                var b1 = HeatModel.ProjectLatLon(z.bounds[1]);
                float minX = Mathf.Min(b0.x, b1.x), maxX = Mathf.Max(b0.x, b1.x);
                float minZ = Mathf.Min(b0.z, b1.z), maxZ = Mathf.Max(b0.z, b1.z);

                Vector3 world = _carryPointer.TipPosition;
                Vector3 local = _city.Root.InverseTransformPoint(world);
                local.x = Mathf.Clamp(local.x, minX, maxX);
                local.z = Mathf.Clamp(local.z, minZ, maxZ);
                local.y = 0.02f;
                _carry.Root.transform.localPosition = Vector3.Lerp(
                    _carry.Root.transform.localPosition, local, 0.35f);

                float eff = _game.EffectivenessAt(z.id, new Vector2(local.x, local.z));
                _carry.SetValid(eff > 0.75f);
            }

            // Billboard the floating windows toward the head.
            if (head != null && CurrentMode == Mode.City && _zoneList.gameObject.activeSelf)
            {
                Vector3 anchor = _city.Root.position;
                _zoneList.transform.position = anchor + new Vector3(-1.05f, 0.34f, 0.15f);
                _zoneDetail.transform.position = anchor + new Vector3(1.05f, 0.34f, 0.15f);
                _zoneList.FaceToward(head.position);
                _zoneDetail.FaceToward(head.position);
            }
        }

        IEnumerator RefreshWeatherLoop()
        {
            var wait = new WaitForSeconds(120f);
            while (true)
            {
                yield return _weather.Fetch(_data.profilesHottestFirst,
                    map => { _readings = map; RefreshZoneDetail(); },
                    e => Debug.LogWarning("Weather unavailable: " + e));
                yield return wait;
            }
        }
    }
}
