using UnityEngine;
using ChennaiOrbit.Core;
using ChennaiOrbit.Data;

namespace ChennaiOrbit.World
{
    /// <summary>
    /// Port of <c>src/vr/solutions.js</c>: the three cooling measures as
    /// procedural objects you pick up and put down — no model files.
    ///
    /// Units are the city's own (1 = 1 km). The effect radius is drawn true to
    /// the data (<c>effect_radius_m / 1000</c>), never inflated, because the
    /// smallness of one measure against a 24 km city is the honest fact.
    /// </summary>
    public static class SolutionFactory
    {
        const float Size = 0.42f; // footprint in km

        public class Solution
        {
            public GameObject Root;
            public Intervention Intervention;
            public float Radius;
            public float Effectiveness = 1f;
            Renderer _field, _outline;
            float _born;
            bool _ghost;

            public void Land() => _born = 0f;

            public void Tick(float dt, float time)
            {
                if (_born < 1f)
                {
                    _born = Mathf.Min(1f, _born + dt * 2.4f);
                    float eased = 1f - Mathf.Pow(1f - _born, 3f);
                    Root.transform.localScale = Vector3.one * (eased * (1f + 0.18f * Mathf.Sin(_born * Mathf.PI)));
                }
            }

            public void SetValid(bool valid)
            {
                var c = valid ? Palette.ForCategory(Intervention.category) : Palette.Hot;
                Paint(_field, c);
                Paint(_outline, c);
            }
            static void Paint(Renderer r, Color c)
            {
                if (r == null) return;
                var m = r.material; c.a = 0.5f;
                if (m.HasProperty("_BaseColor")) m.SetColor("_BaseColor", c);
                if (m.HasProperty("_Color")) m.SetColor("_Color", c);
            }

            internal void Wire(Renderer field, Renderer outline, bool ghost)
            { _field = field; _outline = outline; _ghost = ghost; _born = ghost ? 1f : 0f; }
        }

        public static Solution Create(Intervention intervention, bool ghost)
        {
            var color = Palette.ForCategory(intervention.category);
            var root = new GameObject($"Solution_{intervention.id}{(ghost ? "_ghost" : "")}");

            BuildBody(intervention.category, color, root.transform);

            float radius = Mathf.Max(0.12f, intervention.effect_radius_m / 1000f);

            var field = MakeFlat(HoloFactory.Ring(radius * 0.985f, radius, 56),
                                 color, ghost ? 0.75f : 0.4f, root.transform, 0.003f, "Field");
            var fill = MakeFlat(HoloFactory.Disc(radius, 40),
                                color, ghost ? 0.1f : 0.05f, root.transform, 0.002f, "Fill");
            var outline = MakeOutline(color, root.transform);

            var sol = new Solution
            {
                Root = root,
                Intervention = intervention,
                Radius = radius,
            };
            sol.Wire(field.GetComponent<Renderer>(), outline, ghost);
            root.transform.localScale = ghost ? Vector3.one : Vector3.one * 0.001f;

            if (!ghost)
            {
                // One trigger collider on the root so a placed measure can be
                // pinched for removal (the procedural sub-meshes have none).
                var sc = root.AddComponent<SphereCollider>();
                sc.radius = Size * 0.9f;
                sc.isTrigger = true;
            }
            return sol;
        }

        public static GameObject BuildBody(string category, Color color, Transform parent)
        {
            switch (category)
            {
                case "cool_surface": return Roofs(color, parent);
                case "water": return Basin(color, parent);
                default: return Trees(color, parent);
            }
        }

        static GameObject Trees(Color color, Transform parent)
        {
            var g = new GameObject("green");
            g.transform.SetParent(parent, false);
            MakeFlat(HoloFactory.Disc(Size, 28), color, 0.32f, g.transform, 0.004f, "Canopy");
            float trunk = Size * 0.9f;
            for (int i = 0; i < 14; i++)
            {
                float a = i * 2.39996f;
                float r = Size * 0.78f * Mathf.Sqrt(i / 14f);
                float s = 0.7f + ((i * 37) % 10) / 22f;
                var cone = GameObject.CreatePrimitive(PrimitiveType.Cylinder); // stand-in cone
                cone.transform.SetParent(g.transform, false);
                cone.transform.localPosition = new Vector3(Mathf.Cos(a) * r, trunk * s / 2f, Mathf.Sin(a) * r);
                cone.transform.localScale = new Vector3(Size * 0.34f * s, trunk * s / 2f, Size * 0.34f * s);
                cone.GetComponent<Renderer>().sharedMaterial = HoloFactory.Glow(color, 0.85f);
                Object.Destroy(cone.GetComponent<Collider>());
            }
            return g;
        }

        static GameObject Roofs(Color color, Transform parent)
        {
            var g = new GameObject("cool_surface");
            g.transform.SetParent(parent, false);
            for (int i = 0; i < 12; i++)
            {
                int col = i % 4, row = i / 4;
                var plate = GameObject.CreatePrimitive(PrimitiveType.Cube);
                plate.transform.SetParent(g.transform, false);
                plate.transform.localPosition = new Vector3(
                    (col - 1.5f) * Size * 0.44f,
                    Size * (0.1f + ((i * 53) % 7) * 0.035f),
                    (row - 1) * Size * 0.46f);
                plate.transform.localScale = new Vector3(Size * 0.34f, Size * 0.06f, Size * 0.34f);
                plate.transform.localRotation = Quaternion.Euler(0, ((i * 29) % 8) * 5.2f, 0);
                plate.GetComponent<Renderer>().sharedMaterial = HoloFactory.Glow(color, 0.7f);
                Object.Destroy(plate.GetComponent<Collider>());
            }
            MakeFlat(HoloFactory.Disc(Size, 24), color, 0.16f, g.transform, Size * 0.4f, "Shimmer");
            return g;
        }

        static GameObject Basin(Color color, Transform parent)
        {
            var g = new GameObject("water");
            g.transform.SetParent(parent, false);
            MakeFlat(HoloFactory.Disc(Size * 0.92f, 32), color, 0.5f, g.transform, 0.006f, "Water");
            for (int i = 0; i < 3; i++)
                MakeFlat(HoloFactory.Ring(Size * (0.3f + i * 0.22f), Size * (0.34f + i * 0.22f), 32),
                         color, 0.5f - i * 0.12f, g.transform, 0.012f + i * 0.002f, $"Ripple{i}");
            return g;
        }

        static GameObject MakeFlat(Mesh mesh, Color color, float opacity, Transform parent, float y, string name)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            go.transform.localPosition = new Vector3(0, y, 0);
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            go.AddComponent<MeshRenderer>().sharedMaterial = HoloFactory.Glow(color, opacity);
            return go;
        }

        static Renderer MakeOutline(Color color, Transform parent)
        {
            var pts = new System.Collections.Generic.List<Vector3>();
            for (int i = 0; i <= 24; i++)
            {
                float a = (float)i / 24 * Mathf.PI * 2f;
                pts.Add(new Vector3(Mathf.Cos(a) * Size, 0.008f, Mathf.Sin(a) * Size));
            }
            var go = HoloFactory.LineLoop(pts, color, 0.006f, "Outline");
            go.transform.SetParent(parent, false);
            return go.GetComponent<Renderer>();
        }
    }
}
