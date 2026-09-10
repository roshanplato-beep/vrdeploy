using System;
using System.Collections;
using System.Collections.Generic;
using System.Text;
using UnityEngine;
using UnityEngine.Networking;
using Newtonsoft.Json.Linq;
using ChennaiOrbit.Data;

namespace ChennaiOrbit.World
{
    /// <summary>
    /// Port of <c>fetchLiveClimate()</c> in <c>src/utils/api.js</c>: one
    /// Open-Meteo call for every zone centre, returning 2 m air temperature.
    ///
    /// This is air temperature, NOT land-surface temperature — the readouts
    /// must keep saying so. If Open-Meteo is unreachable, a reading is simply
    /// absent; no value is ever substituted.
    /// </summary>
    public class WeatherService
    {
        public class Reading
        {
            public string zoneId;
            public float airTempC;
            public float apparentTempC;
            public float humidityPct;
            public float windMps;
            public string observedAtUtc;
            public bool measured = false;
            public string quantity = "2m air temperature";
            public string source = "Open-Meteo";
        }

        const string Endpoint = "https://api.open-meteo.com/v1/forecast";

        public IEnumerator Fetch(List<ZoneProfile> zones, Action<Dictionary<string, Reading>> onDone,
                                 Action<string> onError)
        {
            var pts = new List<Zone>();
            foreach (var z in zones) if (z.zone.HasCenter) pts.Add(z.zone);
            if (pts.Count == 0) { onDone?.Invoke(new Dictionary<string, Reading>()); yield break; }

            var lat = new StringBuilder();
            var lon = new StringBuilder();
            for (int i = 0; i < pts.Count; i++)
            {
                if (i > 0) { lat.Append(','); lon.Append(','); }
                lat.Append(pts[i].center[0].ToString("F4"));
                lon.Append(pts[i].center[1].ToString("F4"));
            }

            string url = $"{Endpoint}?latitude={lat}&longitude={lon}" +
                         "&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m" +
                         "&timezone=UTC&wind_speed_unit=ms";

            using (var req = UnityWebRequest.Get(url))
            {
                req.timeout = 12;
                yield return req.SendWebRequest();
                if (req.result != UnityWebRequest.Result.Success)
                {
                    onError?.Invoke(req.error);
                    yield break;
                }

                var map = new Dictionary<string, Reading>();
                try
                {
                    var token = JToken.Parse(req.downloadHandler.text);
                    var entries = token as JArray ?? new JArray { token };
                    for (int i = 0; i < pts.Count && i < entries.Count; i++)
                    {
                        var cur = entries[i]?["current"];
                        if (cur == null || cur["temperature_2m"] == null) continue;
                        map[pts[i].id] = new Reading
                        {
                            zoneId = pts[i].id,
                            airTempC = (float)cur["temperature_2m"],
                            apparentTempC = (float?)cur["apparent_temperature"] ?? 0f,
                            humidityPct = (float?)cur["relative_humidity_2m"] ?? 0f,
                            windMps = (float?)cur["wind_speed_10m"] ?? 0f,
                            observedAtUtc = (string)cur["time"],
                        };
                    }
                }
                catch (Exception e) { onError?.Invoke(e.Message); yield break; }

                onDone?.Invoke(map);
            }
        }
    }
}
