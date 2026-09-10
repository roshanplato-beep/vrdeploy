using System;
using System.Collections.Generic;
using System.Globalization;
using ChennaiOrbit.Data;

namespace ChennaiOrbit.Core
{
    /// <summary>
    /// Faithful port of <c>src/vr/model.js</c>: the projection, the cooling /
    /// cost model, and the land-capacity model.
    ///
    /// The rule this whole project is built on — never dress up a number —
    /// lives here. Every formula matches the WebXR build so the two give the
    /// same result for the same placements.
    /// </summary>
    public static class HeatModel
    {
        // --- Projection ----------------------------------------------------
        // Local equirectangular projection. 1 unit = 1 km at latitude 13°N.
        // x = (lon - 80.19) * 108.45 ;  z = -(lat - 13.01) * 111.32
        public struct Xz { public float x, z; public Xz(float x, float z) { this.x = x; this.z = z; } }

        public static Xz Project(float lat, float lon)
        {
            return new Xz((lon - 80.19f) * 108.45f, -(lat - 13.01f) * 111.32f);
        }

        public static Xz ProjectLatLon(float[] latLon) => Project(latLon[0], latLon[1]);

        /// <summary>INR, grouped the Indian way (₹1,23,45,678).</summary>
        public static string Money(double value)
        {
            if (double.IsNaN(value) || double.IsInfinity(value)) value = 0;
            long v = (long)Math.Round(value);
            var ci = new CultureInfo("en-IN");
            return "₹" + v.ToString("#,##0", ci);
        }

        // --- Land capacity ----------------------------------------------------

        /// <summary>Area of a zone's study box, in m². Uses the same projection
        /// as everything else (km²·1e6).</summary>
        public static float ZoneAreaSqm(Zone zone)
        {
            if (!zone.HasBounds) return 0f;
            var a = ProjectLatLon(zone.bounds[0]);
            var b = ProjectLatLon(zone.bounds[1]);
            return Math.Abs(a.x - b.x) * Math.Abs(a.z - b.z) * 1_000_000f;
        }

        /// <summary>
        /// Land actually available to build cooling measures on: the zone minus
        /// what its own coverage data says is already buildings and roads.
        /// This is what makes "place as many parks as you like" a real
        /// constraint instead of an unlimited resource.
        /// </summary>
        public static float BuildableAreaSqm(Zone zone)
        {
            float built = zone.building_density_pct + zone.road_coverage_pct;
            float availablePct = Math.Max(0f, 100f - built);
            return ZoneAreaSqm(zone) * (availablePct / 100f);
        }

        // Four of the twelve measures (misting corridors, shade structures,
        // water-body restoration, street tree planting) were never sized in the
        // source dataset — they attach to existing infrastructure rather than
        // claiming new land. A ₹/m² rate borrowed from a *priced sibling in the
        // same category* turns their cost into an area the same way those
        // siblings' own rates were built. Not invented from nothing — but a
        // stand-in, so FootprintSqm reports which case it used.
        static readonly Dictionary<string, float> CategoryRateFallbackInrPerSqm = new Dictionary<string, float>
        {
            { "green", 3000f },
            { "cool_surface", 155f },
            { "water", 800f },
        };

        public enum FootprintSource { Measured, Estimated }

        public struct Footprint
        {
            public float Sqm;
            public FootprintSource Source;
            public bool IsEstimated => Source == FootprintSource.Estimated;
        }

        public static Footprint FootprintSqm(Intervention item)
        {
            if (item.hasEstimatedArea && item.estimated_area_sqm > 0f)
                return new Footprint { Sqm = item.estimated_area_sqm, Source = FootprintSource.Measured };

            if (CategoryRateFallbackInrPerSqm.TryGetValue(item.category ?? "", out var rate)
                && rate > 0f && item.estimated_cost_inr > 0f)
                return new Footprint { Sqm = item.estimated_cost_inr / rate, Source = FootprintSource.Estimated };

            return new Footprint { Sqm = 400f, Source = FootprintSource.Estimated };
        }

        /// <summary>How many of this one measure could physically fit in the
        /// remaining land.</summary>
        public static int MaxCountFor(Intervention item, float buildableSqm)
        {
            float footprint = FootprintSqm(item).Sqm;
            if (footprint <= 0f) footprint = 1f;
            return Math.Max(0, (int)Math.Floor(buildableSqm / footprint));
        }

        // --- Impact ----------------------------------------------------------

        public struct Placement
        {
            public string interventionId;
            public float effectiveness;   // 0.5 – 1.0, from where in the zone it sits
        }

        public struct ImpactResult
        {
            public float drop;             // °C, capped at the rural baseline
            public bool cappedByBaseline;
            public float material;         // ₹ before install / contingency
            public float total;            // ₹ incl. 1.3 × 1.1
            public int count;
            public List<string> byCategory;
        }

        /// <summary>
        /// The result of an arbitrary number of placed measures.
        ///
        /// Cooling keeps 75% of its sum once more than one *category* is in
        /// play (the overlap rule), and the total is additionally capped so a
        /// zone can never be modelled as cooling past the study's own rural
        /// baseline — you can green a whole zone, but you cannot out-cool the
        /// climate it sits in.
        /// </summary>
        public static ImpactResult ImpactPlacements(
            IReadOnlyList<Intervention> interventions,
            IReadOnlyList<Placement> placements,
            float? baselineC = null,
            float? lstC = null)
        {
            var byId = new Dictionary<string, Intervention>();
            foreach (var i in interventions) byId[i.id] = i;

            var categories = new List<string>();
            float rawDrop = 0f, material = 0f;
            int count = 0;

            foreach (var p in placements)
            {
                if (!byId.TryGetValue(p.interventionId, out var item)) continue;
                count++;
                float eff = p.effectiveness <= 0f ? 1f : p.effectiveness;
                rawDrop += item.temp_drop * eff;
                material += item.estimated_cost_inr;
                if (!categories.Contains(item.category)) categories.Add(item.category);
            }

            float damped = rawDrop * (categories.Count > 1 ? 0.75f : 1f);

            float ceiling = float.PositiveInfinity;
            if (baselineC.HasValue && lstC.HasValue)
                ceiling = Math.Max(0f, lstC.Value - baselineC.Value);

            float drop = Math.Min(damped, ceiling);

            return new ImpactResult
            {
                drop = (float)Math.Round(drop * 100f) / 100f,
                cappedByBaseline = damped > ceiling,
                material = material,
                total = (float)Math.Round(material * 1.3f * 1.1f),
                count = count,
                byCategory = categories,
            };
        }

        /// <summary>The ceiling: a single one of each measure — the reference
        /// figure the original build showed as "available here".</summary>
        public static ImpactResult CeilingFor(
            IReadOnlyList<Intervention> interventions, float? baselineC, float? lstC)
        {
            var one = new List<Placement>();
            foreach (var i in interventions)
                one.Add(new Placement { interventionId = i.id, effectiveness = 1f });
            return ImpactPlacements(interventions, one, baselineC, lstC);
        }

        // --- Liang–Barsky segment clip (ports clipSegment) -------------------
        public static bool ClipSegment(
            float ax, float az, float bx, float bz,
            float xmin, float zmin, float xmax, float zmax,
            out float cx0, out float cz0, out float cx1, out float cz1)
        {
            cx0 = cz0 = cx1 = cz1 = 0f;
            float dx = bx - ax, dz = bz - az;
            float lo = 0f, hi = 1f;

            (float p, float q)[] edges =
            {
                (-dx, ax - xmin),
                (dx, xmax - ax),
                (-dz, az - zmin),
                (dz, zmax - az),
            };
            foreach (var (p, q) in edges)
            {
                if (p == 0f) { if (q < 0f) return false; continue; }
                float r = q / p;
                if (p < 0f) lo = Math.Max(lo, r);
                else hi = Math.Min(hi, r);
                if (lo > hi) return false;
            }
            cx0 = ax + lo * dx; cz0 = az + lo * dz;
            cx1 = ax + hi * dx; cz1 = az + hi * dz;
            return true;
        }
    }
}
