using System;
using System.Collections;
using UnityEngine;
using UnityEngine.Networking;
using ChennaiOrbit.Core;

namespace ChennaiOrbit.World
{
    /// <summary>
    /// Port of <c>src/vr/globe.js</c>: the held planet that is the game's title
    /// screen and first interaction. Spin it with a hand; pinch the Chennai
    /// marker (or the ENTER card) to descend into the tabletop city.
    ///
    /// The thermal toggle loads real NASA MODIS land-surface-temperature
    /// imagery live from NASA's public, keyless GIBS WMS service and paints it
    /// onto the sphere. If the fetch fails, the globe stays on the stylised map
    /// and says the live layer is unavailable — it never invents a plausible
    /// thermal image. Dark gaps in the real layer are cloud cover the
    /// instrument could not see through, not zero temperature; the card says so.
    /// </summary>
    public class GlobeController : MonoBehaviour
    {
        public const float EarthRadius = 0.42f;

        public Transform Root { get; private set; }
        public Transform Sphere { get; private set; }
        public Transform ChennaiMarker { get; private set; }
        public Transform EnterCard { get; private set; }
        public Transform ThermalCard { get; private set; }

        public bool ThermalOn { get; private set; }
        public event Action<string> OnThermalStatus;

        Material _sphereMat;
        Texture2D _stylised;
        Texture2D _thermal;
        bool _thermalLoading;
        float _spin = 0.06f;
        float _time;

        public void Build(Transform parent)
        {
            Root = new GameObject("Globe").transform;
            Root.SetParent(parent, false);
            Root.localPosition = new Vector3(0f, 1.35f, -0.85f);

            var sphere = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            sphere.name = "Earth";
            sphere.transform.SetParent(Root, false);
            sphere.transform.localScale = Vector3.one * (EarthRadius * 2f);
            _stylised = StylisedEarthTexture();
            _sphereMat = HoloFactory.Lambert(Color.white, Palette.Hex("#04211f"));
            if (_sphereMat.HasProperty("_BaseMap")) _sphereMat.SetTexture("_BaseMap", _stylised);
            if (_sphereMat.HasProperty("_MainTex")) _sphereMat.SetTexture("_MainTex", _stylised);
            sphere.GetComponent<Renderer>().sharedMaterial = _sphereMat;
            var grab = sphere.AddComponent<Grabbable>();
            grab.kind = GrabKind.Globe;
            Sphere = sphere.transform;

            // Chennai marker on the surface.
            Vector3 dir = ChennaiDirection();
            var marker = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            marker.name = "ChennaiMarker";
            marker.transform.SetParent(Root, false);
            marker.transform.localPosition = dir * EarthRadius;
            marker.transform.localScale = Vector3.one * 0.024f;
            marker.GetComponent<Renderer>().sharedMaterial = HoloFactory.Glow(Palette.Hot, 0.95f);
            marker.AddComponent<EnterTarget>();
            ChennaiMarker = marker.transform;

            EnterCard = MakeCard("EnterCard", dir * (EarthRadius * 1.55f), Palette.Amber).transform;
            EnterCard.gameObject.AddComponent<EnterTarget>();

            ThermalCard = MakeCard("ThermalCard", -dir * (EarthRadius * 1.5f), Palette.Ice).transform;
            ThermalCard.gameObject.AddComponent<ThermalToggleTarget>();

            SetThermalCardText("THERMAL VIEW: OFF — pinch to load live NASA data");
        }

        GameObject MakeCard(string name, Vector3 localPos, Color tint)
        {
            var go = GameObject.CreatePrimitive(PrimitiveType.Quad);
            go.name = name;
            go.transform.SetParent(Root, false);
            go.transform.localPosition = localPos;
            go.transform.localScale = new Vector3(0.24f, 0.09f, 1f);
            var mr = go.GetComponent<Renderer>();
            mr.sharedMaterial = HoloFactory.Glow(tint, 0.85f);
            var col = go.GetComponent<Collider>();
            if (col) col.isTrigger = true;
            return go;
        }

        void SetThermalCardText(string status) => OnThermalStatus?.Invoke(status);

        void Update()
        {
            _time += Time.deltaTime;
            Root.Rotate(0f, _spin * Time.deltaTime * Mathf.Rad2Deg, 0f, Space.Self);
            if (ChennaiMarker)
                ChennaiMarker.localScale = Vector3.one * (0.024f * (1f + 0.25f * Mathf.Sin(_time * 3f)));
        }

        public void SetSpin(float rad) => _spin = rad;

        // --- NASA GIBS thermal layer ---------------------------------------

        public void ToggleThermal(MonoBehaviour host) => host.StartCoroutine(ToggleRoutine());

        IEnumerator ToggleRoutine()
        {
            if (_thermalLoading) yield break;

            if (ThermalOn)
            {
                ThermalOn = false;
                SetSphereTexture(_stylised);
                SetThermalCardText("THERMAL VIEW: OFF — pinch to load live NASA data");
                yield break;
            }

            _thermalLoading = true;
            SetThermalCardText("LOADING… NASA GIBS · MODIS Terra LST");

            string date = DateTime.UtcNow.AddDays(-3).ToString("yyyy-MM-dd");
            string url =
                "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?" +
                "SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&" +
                "LAYERS=MODIS_Terra_Land_Surface_Temp_Day&CRS=EPSG:4326&" +
                "BBOX=-90,-180,90,180&WIDTH=2048&HEIGHT=1024&" +
                "FORMAT=image/png&TRANSPARENT=TRUE&TIME=" + date;

            using (var req = UnityWebRequestTexture.GetTexture(url))
            {
                req.timeout = 20;
                yield return req.SendWebRequest();
                if (req.result == UnityWebRequest.Result.Success)
                {
                    _thermal = DownloadHandlerTexture.GetContent(req);
                    SetSphereTexture(_thermal);
                    ThermalOn = true;
                    SetThermalCardText($"THERMAL VIEW: ON — MODIS Terra LST · {date} · NASA GIBS\nDark gaps = cloud cover, not zero °C");
                }
                else
                {
                    SetThermalCardText("THERMAL VIEW UNAVAILABLE — live NASA imagery could not be reached; showing the stylised map");
                }
            }
            _thermalLoading = false;
        }

        void SetSphereTexture(Texture2D tex)
        {
            if (_sphereMat.HasProperty("_BaseMap")) _sphereMat.SetTexture("_BaseMap", tex);
            if (_sphereMat.HasProperty("_MainTex")) _sphereMat.SetTexture("_MainTex", tex);
        }

        // --- Stylised continents (port of drawEarthTexture) ----------------

        static readonly float[][][] Landmasses =
        {
            new[]{ new[]{-17f,15f}, new[]{-10f,5f}, new[]{10f,4f}, new[]{15f,-5f}, new[]{20f,-20f}, new[]{35f,-25f}, new[]{40f,-10f}, new[]{45f,10f}, new[]{38f,18f}, new[]{32f,30f}, new[]{10f,32f}, new[]{-10f,32f}, new[]{-17f,20f} },
            new[]{ new[]{-9f,36f}, new[]{-9f,44f}, new[]{0f,50f}, new[]{15f,55f}, new[]{30f,60f}, new[]{40f,45f}, new[]{28f,40f}, new[]{18f,40f}, new[]{10f,36f}, new[]{-2f,37f} },
            new[]{ new[]{28f,40f}, new[]{45f,45f}, new[]{60f,55f}, new[]{90f,60f}, new[]{130f,60f}, new[]{140f,45f}, new[]{125f,25f}, new[]{105f,10f}, new[]{95f,5f}, new[]{80f,8f}, new[]{68f,20f}, new[]{60f,25f}, new[]{45f,30f}, new[]{35f,35f} },
            new[]{ new[]{68f,24f}, new[]{80f,22f}, new[]{88f,22f}, new[]{92f,18f}, new[]{85f,10f}, new[]{77f,8f}, new[]{72f,15f}, new[]{68f,24f} },
            new[]{ new[]{113f,-22f}, new[]{125f,-15f}, new[]{142f,-11f}, new[]{153f,-27f}, new[]{145f,-38f}, new[]{130f,-32f}, new[]{115f,-33f}, new[]{113f,-22f} },
            new[]{ new[]{-165f,65f}, new[]{-140f,68f}, new[]{-95f,70f}, new[]{-70f,60f}, new[]{-55f,50f}, new[]{-65f,42f}, new[]{-80f,25f}, new[]{-97f,20f}, new[]{-110f,25f}, new[]{-124f,40f}, new[]{-130f,55f}, new[]{-165f,65f} },
            new[]{ new[]{-80f,10f}, new[]{-60f,10f}, new[]{-50f,0f}, new[]{-35f,-8f}, new[]{-40f,-22f}, new[]{-58f,-35f}, new[]{-70f,-30f}, new[]{-75f,-15f}, new[]{-80f,10f} },
        };

        static Texture2D StylisedEarthTexture()
        {
            const int W = 1024, H = 512;
            var tex = new Texture2D(W, H, TextureFormat.RGBA32, false);
            var ocean = Palette.Hex("#062733");
            var pixels = new Color32[W * H];
            for (int y = 0; y < H; y++)
            {
                float f = y / (float)H;
                var row = Color.Lerp(Palette.Hex("#04333d"), Palette.Hex("#02151d"), f);
                for (int x = 0; x < W; x++) pixels[y * W + x] = row;
            }
            tex.SetPixels32(pixels);

            var land = Palette.Hex("#0f5a52");
            foreach (var poly in Landmasses)
                FillPoly(tex, poly, land, W, H);
            // India brighter.
            FillPoly(tex, Landmasses[3], new Color(1f, 0.65f, 0.4f, 1f), W, H);
            tex.Apply();
            return tex;
        }

        static void FillPoly(Texture2D tex, float[][] lonlat, Color c, int W, int H)
        {
            var pts = new Vector2[lonlat.Length];
            float minY = H, maxY = 0;
            for (int i = 0; i < lonlat.Length; i++)
            {
                float x = (lonlat[i][0] + 180f) / 360f * W;
                float y = (90f - lonlat[i][1]) / 180f * H;
                pts[i] = new Vector2(x, y);
                minY = Mathf.Min(minY, y); maxY = Mathf.Max(maxY, y);
            }
            for (int y = Mathf.Max(0, (int)minY); y < Mathf.Min(H, (int)maxY + 1); y++)
            {
                var xs = new System.Collections.Generic.List<float>();
                for (int i = 0; i < pts.Length; i++)
                {
                    var a = pts[i]; var b = pts[(i + 1) % pts.Length];
                    if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y))
                        xs.Add(a.x + (y - a.y) / (b.y - a.y) * (b.x - a.x));
                }
                xs.Sort();
                for (int k = 0; k + 1 < xs.Count; k += 2)
                    for (int x = Mathf.Max(0, (int)xs[k]); x < Mathf.Min(W, (int)xs[k + 1]); x++)
                        tex.SetPixel(x, y, c);
            }
        }

        public static Vector3 ChennaiDirection()
        {
            float lat = 13.0827f, lon = 80.2707f;
            float phi = (90f - lat) * Mathf.Deg2Rad;
            float theta = (lon + 180f) * Mathf.Deg2Rad;
            return new Vector3(
                -Mathf.Sin(phi) * Mathf.Cos(theta),
                Mathf.Cos(phi),
                Mathf.Sin(phi) * Mathf.Sin(theta)).normalized;
        }

        public void SetVisible(bool v) => Root.gameObject.SetActive(v);
    }
}
