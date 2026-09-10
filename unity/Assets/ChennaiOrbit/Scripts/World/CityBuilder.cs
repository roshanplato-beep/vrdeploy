using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using ChennaiOrbit.Core;
using ChennaiOrbit.Data;

namespace ChennaiOrbit.World
{
    /// <summary>
    /// Port of <c>src/vr/city.js</c>: turns the bundled OpenStreetMap snapshot
    /// into the tabletop model — extruded building footprints, road / water /
    /// coast / park line work, a per-zone heat plate, a numbered marker, and
    /// each zone's real building-density hotspot.
    ///
    /// The projection is <see cref="HeatModel.Project"/> (1 unit = 1 km). The
    /// whole city is parented under one transform scaled to ~0.073 so the
    /// ~24 km study area is about 1.75 m across in the headset.
    /// </summary>
    public class CityBuilder : MonoBehaviour
    {
        public Transform Root { get; private set; }
        public Transform GrabSurface { get; private set; }

        public readonly Dictionary<string, Vector2> Hotspots = new Dictionary<string, Vector2>();
        public readonly Dictionary<string, Transform> ZoneMarkers = new Dictionary<string, Transform>();
        public readonly Dictionary<string, Renderer> HeatPlates = new Dictionary<string, Renderer>();
        readonly Dictionary<string, GameObject> _hotspotMarkers = new Dictionary<string, GameObject>();

        const float CityScale = 0.073f;
        // OSM heights are already exaggerated 4x in the file; this is the extra
        // scene-unit scaling city.js applies (0.004 per metre).
        const float HeightUnit = 0.004f;

        List<ZoneProfile> _zones;
        Baseline _baseline;

        public IEnumerator Build(List<ZoneProfile> zones, Baseline baseline, OsmFile osm,
                                 System.Action<string> onProgress)
        {
            _zones = zones;
            _baseline = baseline;

            Root = new GameObject("City").transform;
            Root.SetParent(transform, false);
            Root.localScale = Vector3.one * CityScale;
            Root.gameObject.SetActive(false);

            // Study-box bounds in projected units.
            var nw = HeatModel.Project(13.14f, 80.08f);
            var se = HeatModel.Project(12.88f, 80.30f);
            float width = se.x - nw.x;
            float depth = nw.z - se.z;
            float cx = (nw.x + se.x) * 0.5f;
            float cz = (nw.z + se.z) * 0.5f;

            // Grabbable base slab.
            var slab = GameObject.CreatePrimitive(PrimitiveType.Cube);
            slab.name = "CityBase";
            slab.transform.SetParent(Root, false);
            slab.transform.localPosition = new Vector3(cx, -0.13f, cz);
            slab.transform.localScale = new Vector3(width + 0.5f, 0.2f, depth + 0.5f);
            slab.GetComponent<Renderer>().sharedMaterial = HoloFactory.Lambert(Palette.Hex("#09262f"), Palette.Hex("#04131a"));
            slab.tag = "Untagged";
            GrabSurface = slab.transform;
            var grab = slab.AddComponent<Grabbable>();
            grab.kind = GrabKind.City;

            onProgress?.Invoke("Reading Chennai geography…");
            yield return null;

            // --- Sort features per zone, accumulate hotspots -----------------
            var byZone = new Dictionary<string, List<List<Vector2>>>();
            var hotAccum = new Dictionary<string, (double sx, double sz, double w)>();
            foreach (var z in zones) { byZone[z.zone.id] = new List<List<Vector2>>(); hotAccum[z.zone.id] = (0, 0, 0); }

            var roads = new List<List<Vector2>>();
            var water = new List<List<Vector2>>();
            var coast = new List<List<Vector2>>();
            var parks = new List<List<Vector2>>();
            var heights = new List<float>();

            if (osm != null)
            {
                int processed = 0, total = osm.features.Count;
                foreach (var f in osm.features)
                {
                    var pts = new List<Vector2>(f.PointCount);
                    for (int i = 0; i < f.PointCount; i++)
                    {
                        var xz = HeatModel.Project(f.Lat(i), f.Lon(i));
                        pts.Add(new Vector2(xz.x, xz.z));
                    }

                    if (f.kind == "building")
                    {
                        if (pts.Count >= 4)
                        {
                            Vector2 c = Vector2.zero;
                            foreach (var p in pts) c += p;
                            c /= pts.Count;

                            string nearest = zones[0].zone.id;
                            float best = float.MaxValue;
                            foreach (var z in zones)
                            {
                                var zc = HeatModel.ProjectLatLon(z.zone.center);
                                float d = (new Vector2(zc.x, zc.z) - c).sqrMagnitude;
                                if (d < best) { best = d; nearest = z.zone.id; }
                            }
                            byZone[nearest].Add(pts);
                            heights.Add(Mathf.Min(150f, f.height > 0 ? f.height : 9f) * HeightUnit);

                            double area = 0;
                            for (int i = 0; i < pts.Count; i++)
                            {
                                var a = pts[i]; var b = pts[(i + 1) % pts.Count];
                                area += a.x * b.y - b.x * a.y;
                            }
                            area = System.Math.Max(1e-6, System.Math.Abs(area) / 2.0);
                            var acc = hotAccum[nearest];
                            hotAccum[nearest] = (acc.sx + c.x * area, acc.sz + c.y * area, acc.w + area);
                        }
                    }
                    else if (f.kind == "road") roads.Add(pts);
                    else if (f.kind == "coast") coast.Add(pts);
                    else if (f.kind == "water") water.Add(pts);
                    else parks.Add(pts);

                    if (++processed % 2000 == 0)
                    {
                        onProgress?.Invoke($"Building Chennai · {Mathf.RoundToInt(processed * 100f / total)}%");
                        yield return null;
                    }
                }
            }

            AddLineWork(roads, 0.032f, Palette.Hex("#acd4ce"));
            AddLineWork(water, 0.04f, Palette.Hex("#55ccf5"));
            AddLineWork(coast, 0.04f, Palette.Hex("#79ecff"));

            // --- Per zone: heat plate, buildings, marker, hotspot ---------
            var buildingMat = HoloFactory.Lambert(Palette.Hex("#aac6c9"), Palette.Hex("#0b2b33"));
            int zi = 0;
            foreach (var zp in zones)
            {
                var zone = zp.zone;
                var cc = HeatModel.ProjectLatLon(zone.center);
                var b0 = HeatModel.ProjectLatLon(zone.bounds[0]);
                var b1 = HeatModel.ProjectLatLon(zone.bounds[1]);
                float minX = Mathf.Min(b0.x, b1.x), maxX = Mathf.Max(b0.x, b1.x);
                float minZ = Mathf.Min(b0.z, b1.z), maxZ = Mathf.Max(b0.z, b1.z);

                var plate = new GameObject($"Heat_{zone.id}");
                plate.transform.SetParent(Root, false);
                plate.transform.localPosition = new Vector3((minX + maxX) / 2f, 0.06f, (minZ + maxZ) / 2f);
                var pf = plate.AddComponent<MeshFilter>();
                pf.sharedMesh = QuadXZ(maxX - minX, maxZ - minZ);
                var pr = plate.AddComponent<MeshRenderer>();
                pr.sharedMaterial = HoloFactory.Glow(Palette.Hex(zone.heat_color), 0.3f);
                HeatPlates[zone.id] = pr;

                // Merge this zone's footprints into one mesh.
                var footprints = byZone[zone.id];
                if (footprints.Count > 0)
                {
                    var combine = new List<CombineInstance>();
                    for (int k = 0; k < footprints.Count; k++)
                    {
                        var m = HoloFactory.ExtrudePolygon(footprints[k], 0.035f + 0.04f);
                        if (m == null) continue;
                        combine.Add(new CombineInstance { mesh = m, transform = Matrix4x4.identity });
                        if (combine.Count > 8000) break; // safety for very dense zones
                    }
                    if (combine.Count > 0)
                    {
                        var merged = new Mesh { indexFormat = UnityEngine.Rendering.IndexFormat.UInt32 };
                        merged.CombineMeshes(combine.ToArray(), true, false);
                        var bo = new GameObject($"Buildings_{zone.id}");
                        bo.transform.SetParent(Root, false);
                        bo.AddComponent<MeshFilter>().sharedMesh = merged;
                        bo.AddComponent<MeshRenderer>().sharedMaterial = buildingMat;
                    }
                }

                // Hotspot: area-weighted centroid of the real footprints.
                var ha = hotAccum[zone.id];
                Vector2 hot = ha.w > 0
                    ? new Vector2((float)(ha.sx / ha.w), (float)(ha.sz / ha.w))
                    : new Vector2(cc.x, cc.z);
                Hotspots[zone.id] = hot;

                var hotMarker = new GameObject($"Hotspot_{zone.id}");
                hotMarker.transform.SetParent(Root, false);
                hotMarker.transform.localPosition = new Vector3(hot.x, 0.075f, hot.y);
                var hmf = hotMarker.AddComponent<MeshFilter>();
                hmf.sharedMesh = HoloFactory.Ring(0.16f, 0.2f, 28);
                hotMarker.AddComponent<MeshRenderer>().sharedMaterial = HoloFactory.Glow(Palette.Gold, 0.85f);
                hotMarker.SetActive(false);
                _hotspotMarkers[zone.id] = hotMarker;

                // Numbered, grabbable marker.
                var marker = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
                marker.name = $"Marker_{zone.id}";
                marker.transform.SetParent(Root, false);
                marker.transform.localPosition = new Vector3(cc.x, 0.23f, cc.z);
                marker.transform.localScale = new Vector3(0.42f, 0.08f, 0.42f);
                marker.GetComponent<Renderer>().sharedMaterial = HoloFactory.Glow(Palette.Hex(zone.heat_color), 1f);
                var zm = marker.AddComponent<ZoneMarker>();
                zm.zoneId = zone.id;
                ZoneMarkers[zone.id] = marker.transform;

                zi++;
                if (zi % 4 == 0) yield return null;
            }

            onProgress?.Invoke(osm != null
                ? $"{CountBuildings(osm):n0} mapped footprints loaded"
                : "Building footprints unavailable; map annotations remain usable");
        }

        static int CountBuildings(OsmFile osm)
        {
            int n = 0;
            foreach (var f in osm.features) if (f.kind == "building") n++;
            return n;
        }

        void AddLineWork(List<List<Vector2>> lines, float y, Color color)
        {
            var nw = HeatModel.Project(13.14f, 80.08f);
            var se = HeatModel.Project(12.88f, 80.30f);
            var pts = new List<Vector3>();
            foreach (var line in lines)
                for (int i = 1; i < line.Count; i++)
                {
                    if (HeatModel.ClipSegment(line[i - 1].x, line[i - 1].y, line[i].x, line[i].y,
                        nw.x, nw.z, se.x, se.z, out var x0, out var z0, out var x1, out var z1))
                    {
                        pts.Add(new Vector3(x0, y, z0));
                        pts.Add(new Vector3(x1, y, z1));
                    }
                }
            if (pts.Count == 0) return;
            var go = new GameObject("LineWork");
            go.transform.SetParent(Root, false);
            var mesh = new Mesh { indexFormat = UnityEngine.Rendering.IndexFormat.UInt32 };
            mesh.SetVertices(pts);
            var idx = new int[pts.Count];
            for (int i = 0; i < pts.Count; i++) idx[i] = i;
            mesh.SetIndices(idx, MeshTopology.Lines, 0);
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            var mr = go.AddComponent<MeshRenderer>();
            var mat = HoloFactory.Glow(color, 0.7f);
            mr.sharedMaterial = mat;
        }

        static Mesh QuadXZ(float w, float d)
        {
            var m = new Mesh();
            float hw = w / 2f, hd = d / 2f;
            m.SetVertices(new List<Vector3> {
                new Vector3(-hw, 0, -hd), new Vector3(hw, 0, -hd),
                new Vector3(hw, 0, hd), new Vector3(-hw, 0, hd)
            });
            m.SetTriangles(new[] { 0, 2, 1, 0, 3, 2 }, 0);
            m.RecalculateNormals(); m.RecalculateBounds();
            return m;
        }

        public Vector2? HotspotFor(string id)
            => Hotspots.TryGetValue(id, out var h) ? h : (Vector2?)null;

        public void Select(string id)
        {
            foreach (var kv in _hotspotMarkers) kv.Value.SetActive(kv.Key == id);
        }

        /// <summary>Lerp a zone's heat plate toward blue in proportion to cooling.</summary>
        public void ApplyCooling(string id, float drop)
        {
            if (!HeatPlates.TryGetValue(id, out var r)) return;
            var zone = _zones.Find(z => z.zone.id == id).zone;
            var from = Palette.Hex(zone.heat_color);
            var col = Color.Lerp(from, Palette.Hex("#3b82f6"), Mathf.Min(0.9f, drop / 4f));
            col.a = 0.3f;
            var m = r.material;
            if (m.HasProperty("_BaseColor")) m.SetColor("_BaseColor", col);
            if (m.HasProperty("_Color")) m.SetColor("_Color", col);
        }

        public void SetVisible(bool v) => Root.gameObject.SetActive(v);
    }
}
