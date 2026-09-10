using System.Collections.Generic;
using UnityEngine;

namespace ChennaiOrbit.Core
{
    /// <summary>
    /// The holographic vocabulary from <c>src/vr/holo.js</c> as Unity meshes and
    /// materials: additive unlit "glow" surfaces, additive line work, rotating
    /// reticles, expanding pulse rings, corner brackets.
    ///
    /// Materials are unlit + additive to match the WebXR build and because that
    /// is the cheapest thing a Quest can draw, and these elements are all over
    /// the city at once.
    /// </summary>
    public static class HoloFactory
    {
        static Shader _unlitColor;
        static Shader UnlitColor
        {
            get
            {
                if (_unlitColor == null)
                    _unlitColor = Shader.Find("Universal Render Pipeline/Unlit")
                                  ?? Shader.Find("Unlit/Color");
                return _unlitColor;
            }
        }

        /// <summary>Additive glow. Does not write depth, so overlapping holograms build up.</summary>
        public static Material Glow(Color color, float opacity = 0.7f)
        {
            var m = new Material(UnlitColor);
            var c = color; c.a = opacity;
            if (m.HasProperty("_BaseColor")) m.SetColor("_BaseColor", c);
            if (m.HasProperty("_Color")) m.SetColor("_Color", c);
            // Additive, no ZWrite, render after opaque geometry.
            m.SetFloat("_Surface", 1f);            // transparent (URP)
            m.SetFloat("_Blend", 1f);              // additive (URP)
            m.SetInt("_SrcBlend", (int)UnityEngine.Rendering.BlendMode.SrcAlpha);
            m.SetInt("_DstBlend", (int)UnityEngine.Rendering.BlendMode.One);
            m.SetInt("_ZWrite", 0);
            m.SetInt("_Cull", (int)UnityEngine.Rendering.CullMode.Off);
            m.renderQueue = (int)UnityEngine.Rendering.RenderQueue.Transparent;
            m.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
            return m;
        }

        public static Material Lambert(Color color, Color emissive)
        {
            var shader = Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Standard");
            var m = new Material(shader);
            if (m.HasProperty("_BaseColor")) m.SetColor("_BaseColor", color);
            if (m.HasProperty("_Color")) m.SetColor("_Color", color);
            if (m.HasProperty("_EmissionColor"))
            {
                m.SetColor("_EmissionColor", emissive);
                m.EnableKeyword("_EMISSION");
            }
            if (m.HasProperty("_Smoothness")) m.SetFloat("_Smoothness", 0.1f);
            if (m.HasProperty("_Metallic")) m.SetFloat("_Metallic", 0f);
            return m;
        }

        // --- Flat disc / ring in the XZ plane -------------------------------

        public static Mesh Disc(float radius, int segments = 32)
        {
            var verts = new List<Vector3> { Vector3.zero };
            var tris = new List<int>();
            for (int i = 0; i <= segments; i++)
            {
                float a = (float)i / segments * Mathf.PI * 2f;
                verts.Add(new Vector3(Mathf.Cos(a) * radius, 0f, Mathf.Sin(a) * radius));
            }
            for (int i = 1; i <= segments; i++) { tris.Add(0); tris.Add(i + 1); tris.Add(i); }
            var m = new Mesh();
            m.SetVertices(verts); m.SetTriangles(tris, 0); m.RecalculateNormals(); m.RecalculateBounds();
            return m;
        }

        public static Mesh Ring(float inner, float outer, int segments = 40)
        {
            var verts = new List<Vector3>();
            var tris = new List<int>();
            for (int i = 0; i <= segments; i++)
            {
                float a = (float)i / segments * Mathf.PI * 2f;
                float cs = Mathf.Cos(a), sn = Mathf.Sin(a);
                verts.Add(new Vector3(cs * inner, 0f, sn * inner));
                verts.Add(new Vector3(cs * outer, 0f, sn * outer));
            }
            for (int i = 0; i < segments; i++)
            {
                int b = i * 2;
                tris.Add(b); tris.Add(b + 1); tris.Add(b + 2);
                tris.Add(b + 1); tris.Add(b + 3); tris.Add(b + 2);
            }
            var m = new Mesh();
            m.SetVertices(verts); m.SetTriangles(tris, 0); m.RecalculateNormals(); m.RecalculateBounds();
            return m;
        }

        /// <summary>An extruded polygon (building footprint) in the XZ plane, rising +Y.</summary>
        public static Mesh ExtrudePolygon(IList<Vector2> ring, float height)
        {
            var poly = new List<Vector2>(ring);
            if (poly.Count >= 2 && (poly[0] - poly[poly.Count - 1]).sqrMagnitude < 1e-9f)
                poly.RemoveAt(poly.Count - 1);
            if (poly.Count < 3) return null;

            var indices = Triangulate(poly);
            if (indices == null) return null;

            var verts = new List<Vector3>();
            var tris = new List<int>();

            // Top cap
            foreach (var p in poly) verts.Add(new Vector3(p.x, height, p.y));
            foreach (var t in indices) tris.Add(t);

            // Walls
            int baseTop = 0;
            for (int i = 0; i < poly.Count; i++)
            {
                int j = (i + 1) % poly.Count;
                int a = verts.Count;
                verts.Add(new Vector3(poly[i].x, 0f, poly[i].y));
                verts.Add(new Vector3(poly[j].x, 0f, poly[j].y));
                verts.Add(new Vector3(poly[i].x, height, poly[i].y));
                verts.Add(new Vector3(poly[j].x, height, poly[j].y));
                tris.Add(a); tris.Add(a + 2); tris.Add(a + 1);
                tris.Add(a + 1); tris.Add(a + 2); tris.Add(a + 3);
            }

            var m = new Mesh();
            if (verts.Count > 65000) m.indexFormat = UnityEngine.Rendering.IndexFormat.UInt32;
            m.SetVertices(verts); m.SetTriangles(tris, 0);
            m.RecalculateNormals(); m.RecalculateBounds();
            return m;
        }

        /// <summary>Ear-clipping triangulation for a simple polygon. Returns null on failure.</summary>
        public static List<int> Triangulate(IList<Vector2> poly)
        {
            int n = poly.Count;
            if (n < 3) return null;
            var result = new List<int>();
            var idx = new List<int>();
            float area = 0f;
            for (int i = 0; i < n; i++)
            {
                var a = poly[i]; var b = poly[(i + 1) % n];
                area += a.x * b.y - b.x * a.y;
            }
            bool ccw = area > 0f;
            for (int i = 0; i < n; i++) idx.Add(ccw ? i : n - 1 - i);

            int guard = 0;
            while (idx.Count > 3 && guard++ < n * n)
            {
                bool clipped = false;
                for (int i = 0; i < idx.Count; i++)
                {
                    int i0 = idx[(i + idx.Count - 1) % idx.Count];
                    int i1 = idx[i];
                    int i2 = idx[(i + 1) % idx.Count];
                    Vector2 a = poly[i0], b = poly[i1], c = poly[i2];
                    float cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
                    if (cross <= 0f) continue; // reflex
                    bool hasInside = false;
                    for (int k = 0; k < idx.Count; k++)
                    {
                        int p = idx[k];
                        if (p == i0 || p == i1 || p == i2) continue;
                        if (PointInTriangle(poly[p], a, b, c)) { hasInside = true; break; }
                    }
                    if (hasInside) continue;
                    result.Add(i0); result.Add(i1); result.Add(i2);
                    idx.RemoveAt(i);
                    clipped = true;
                    break;
                }
                if (!clipped) break;
            }
            if (idx.Count == 3) { result.Add(idx[0]); result.Add(idx[1]); result.Add(idx[2]); }
            return result;
        }

        static bool PointInTriangle(Vector2 p, Vector2 a, Vector2 b, Vector2 c)
        {
            float d1 = Sign(p, a, b), d2 = Sign(p, b, c), d3 = Sign(p, c, a);
            bool neg = (d1 < 0) || (d2 < 0) || (d3 < 0);
            bool pos = (d1 > 0) || (d2 > 0) || (d3 > 0);
            return !(neg && pos);
        }
        static float Sign(Vector2 p1, Vector2 p2, Vector2 p3)
            => (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y);

        // --- Line strips as thin quads (URP has no wide GL lines) -----------

        public static GameObject LineLoop(IList<Vector3> pts, Color color, float width = 0.004f, string name = "line")
        {
            var go = new GameObject(name);
            var lr = go.AddComponent<LineRenderer>();
            lr.useWorldSpace = false;
            lr.loop = true;
            lr.positionCount = pts.Count;
            for (int i = 0; i < pts.Count; i++) lr.SetPosition(i, pts[i]);
            lr.widthMultiplier = width;
            lr.numCapVertices = 2;
            lr.material = Glow(color, color.a <= 0 ? 0.8f : color.a);
            lr.textureMode = LineTextureMode.Stretch;
            return go;
        }
    }
}
