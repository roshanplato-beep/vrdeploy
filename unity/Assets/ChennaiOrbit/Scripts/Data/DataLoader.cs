using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using UnityEngine;
using UnityEngine.Networking;
using Newtonsoft.Json.Linq;

namespace ChennaiOrbit.Data
{
    /// <summary>
    /// Loads the two bundled datasets from StreamingAssets and parses them with
    /// Newtonsoft.Json (JsonUtility can't handle the keyed <c>profiles</c> map
    /// or the jagged coordinate arrays).
    ///
    /// Mirrors <c>src/utils/api.js</c> + the fetch in <c>src/vr/city.js</c>:
    /// zones come out sorted hottest-first, exactly as the WebXR build serves
    /// them.
    ///
    /// Add <c>com.unity.nuget.newtonsoft-json</c> via Package Manager if it
    /// isn't already pulled in by another package.
    /// </summary>
    public static class DataLoader
    {
        public class LoadedData
        {
            public Baseline baseline;
            public List<ZoneProfile> profilesHottestFirst = new List<ZoneProfile>();
            public Dictionary<string, ZoneProfile> byId = new Dictionary<string, ZoneProfile>();
            public OsmFile osm;
            public string profilesSourceLabel = "Bundled model snapshot";
        }

        static string PathFor(string rel)
        {
            return Path.Combine(Application.streamingAssetsPath, "vr", rel);
        }

        /// <summary>
        /// Reads one StreamingAssets file. On Android (Quest) StreamingAssets
        /// lives inside the APK and must go through UnityWebRequest; on desktop
        /// a plain file read is fine. This handles both.
        /// </summary>
        public static IEnumerator ReadTextFile(string absolutePath, Action<string> onText, Action<string> onError)
        {
            bool needsWebRequest = absolutePath.Contains("://");
            if (!needsWebRequest)
            {
                string text = null;
                string err = null;
                try { text = File.ReadAllText(absolutePath); }
                catch (Exception e) { err = e.Message; }
                if (err != null) onError?.Invoke(err); else onText?.Invoke(text);
                yield break;
            }

            using (var req = UnityWebRequest.Get(absolutePath))
            {
                yield return req.SendWebRequest();
                if (req.result != UnityWebRequest.Result.Success)
                    onError?.Invoke(req.error);
                else
                    onText?.Invoke(req.downloadHandler.text);
            }
        }

        public static IEnumerator Load(Action<LoadedData> onDone, Action<string> onError)
        {
            var data = new LoadedData();

            // --- profiles.json ------------------------------------------------
            string profilesText = null;
            yield return ReadTextFile(PathFor("profiles.json"),
                t => profilesText = t,
                e => onError?.Invoke("profiles.json: " + e));
            if (profilesText == null) yield break;

            try
            {
                var root = JObject.Parse(profilesText);
                data.baseline = new Baseline
                {
                    value_c = (float?)root["baseline"]?["value_c"] ?? 0f,
                    measured = (bool?)root["baseline"]?["measured"] ?? false,
                    basis = (string)root["baseline"]?["basis"],
                    month = (string)root["baseline"]?["month"],
                    source = (string)root["baseline"]?["source"],
                    source_url = (string)root["baseline"]?["source_url"],
                };
                var gen = (string)root["generated_at"];
                if (!string.IsNullOrEmpty(gen) && gen.Length >= 10)
                    data.profilesSourceLabel = "Bundled model snapshot · " + gen.Substring(0, 10);

                var profiles = (JObject)root["profiles"];
                foreach (var kv in profiles)
                {
                    var zp = ParseZoneProfile((JObject)kv.Value);
                    if (zp?.zone == null) continue;
                    data.byId[zp.zone.id] = zp;
                    data.profilesHottestFirst.Add(zp);
                }
                data.profilesHottestFirst.Sort(
                    (a, b) => b.zone.heat_risk_score.CompareTo(a.zone.heat_risk_score));
            }
            catch (Exception e)
            {
                onError?.Invoke("profiles.json parse: " + e.Message);
                yield break;
            }

            // --- chennai-osm.json ------------------------------------------
            string osmText = null;
            yield return ReadTextFile(PathFor("chennai-osm.json"),
                t => osmText = t,
                e => Debug.LogWarning("chennai-osm.json unavailable: " + e));
            if (osmText != null)
            {
                try { data.osm = ParseOsm(osmText); }
                catch (Exception e) { Debug.LogWarning("chennai-osm.json parse: " + e.Message); }
            }

            onDone?.Invoke(data);
        }

        static ZoneProfile ParseZoneProfile(JObject o)
        {
            var zp = new ZoneProfile();
            var z = (JObject)o["zone"];
            if (z == null) return zp;

            zp.zone = new Zone
            {
                id = (string)z["id"],
                name = (string)z["name"],
                description = (string)z["description"],
                type = (string)z["type"],
                center = ToFloatArray(z["center"]),
                bounds = ToFloatMatrix(z["bounds"]),
                lst_celsius = (float?)z["lst_celsius"] ?? 0f,
                heat_risk_score = (float?)z["heat_risk_score"] ?? 0f,
                risk_level = (string)z["risk_level"],
                heat_color = (string)z["heat_color"] ?? "#ffa766",
                building_density_pct = (float?)z["building_density_pct"] ?? 0f,
                green_cover_pct = (float?)z["green_cover_pct"] ?? 0f,
                road_coverage_pct = (float?)z["road_coverage_pct"] ?? 0f,
                ndvi = (float?)z["ndvi"] ?? 0f,
                osm_fetched = (bool?)z["osm_fetched"] ?? false,
                osm_fetched_at = (string)z["osm_fetched_at"],
            };
            var m = (JObject)z["morphology"];
            if (m != null)
                zp.zone.morphology = new Morphology
                {
                    available = (bool?)m["available"] ?? false,
                    buildings_sampled = (int?)m["buildings_sampled"] ?? 0,
                    mean_height_m = (float?)m["mean_height_m"] ?? 0f,
                    building_cover_pct_measured = (float?)m["building_cover_pct_measured"] ?? 0f,
                    green_cover_pct_measured = (float?)m["green_cover_pct_measured"] ?? 0f,
                };

            var arr = (JArray)o["interventions"];
            if (arr != null)
                foreach (var it in arr)
                {
                    var i = (JObject)it;
                    bool hasArea = i["estimated_area_sqm"] != null &&
                                   i["estimated_area_sqm"].Type != JTokenType.Null;
                    zp.interventions.Add(new Intervention
                    {
                        id = (string)i["id"],
                        name = (string)i["name"],
                        category = (string)i["category"],
                        icon = (string)i["icon"],
                        temp_drop = (float?)i["temp_drop"] ?? 0f,
                        local_reference_drop_c = (float?)i["local_reference_drop_c"] ?? 0f,
                        effect_radius_m = (float?)i["effect_radius_m"] ?? 300f,
                        estimated_area_sqm = hasArea ? (float)i["estimated_area_sqm"] : 0f,
                        area_affected_sqm = (float?)i["area_affected_sqm"] ?? 0f,
                        estimated_cost_inr = (float?)i["estimated_cost_inr"] ?? 0f,
                        cost_per_sqm_inr = (float?)i["cost_per_sqm_inr"] ?? 0f,
                        authority = (string)i["authority"],
                        source = (string)i["source"],
                        planning_basis = (string)i["planning_basis"],
                        hasEstimatedArea = hasArea,
                    });
                }

            var d = (JObject)o["diagnosis"];
            if (d != null)
            {
                zp.diagnosis = new Diagnosis
                {
                    primary_cause = (string)d["primary_cause"],
                    urban_context = (string)d["urban_context"],
                    vulnerable_populations = (string)d["vulnerable_populations"],
                };
                var cf = (JArray)d["contributing_factors"];
                if (cf != null) foreach (var f in cf) zp.diagnosis.contributing_factors.Add((string)f);
            }
            return zp;
        }

        static OsmFile ParseOsm(string text)
        {
            var root = JObject.Parse(text);
            var file = new OsmFile
            {
                source = (string)root["source"],
                license = (string)root["license"],
                fetchedAt = (string)root["fetchedAt"],
                note = (string)root["note"],
            };
            var feats = (JArray)root["features"];
            if (feats != null)
            {
                file.features.Capacity = feats.Count;
                foreach (var ft in feats)
                {
                    var f = (JObject)ft;
                    var pts = (JArray)f["points"];
                    if (pts == null || pts.Count == 0) continue;
                    var flat = new float[pts.Count * 2];
                    for (int k = 0; k < pts.Count; k++)
                    {
                        var pair = (JArray)pts[k];
                        flat[k * 2] = (float)pair[0];
                        flat[k * 2 + 1] = (float)pair[1];
                    }
                    file.features.Add(new OsmFeature
                    {
                        id = (long?)f["id"] ?? 0,
                        kind = (string)f["kind"],
                        name = (string)f["name"],
                        height = (float?)f["height"] ?? 0f,
                        pointsFlat = flat,
                    });
                }
            }
            return file;
        }

        static float[] ToFloatArray(JToken t)
        {
            if (t is JArray a)
            {
                var r = new float[a.Count];
                for (int i = 0; i < a.Count; i++) r[i] = (float)a[i];
                return r;
            }
            return null;
        }

        static float[][] ToFloatMatrix(JToken t)
        {
            if (t is JArray a)
            {
                var r = new float[a.Count][];
                for (int i = 0; i < a.Count; i++) r[i] = ToFloatArray(a[i]);
                return r;
            }
            return null;
        }
    }
}
