using System;
using System.Collections.Generic;

namespace ChennaiOrbit.Data
{
    /// <summary>
    /// C# shape of <c>StreamingAssets/vr/profiles.json</c> — the bundled heat-risk
    /// dataset. This is a direct mirror of the JSON the WebXR build ships, kept
    /// field-for-field so the same numbers drive the game in either engine.
    ///
    /// Unity's JsonUtility only binds public fields whose names match the JSON
    /// keys exactly, which is why everything here is snake_case.
    /// </summary>
    [Serializable]
    public class ProfilesFile
    {
        public string generated_at;
        public Baseline baseline;
        // JsonUtility cannot bind a dictionary, so profiles is re-parsed
        // key-by-key in DataLoader. This field stays for completeness.
        public ProfilesMap profiles;
    }

    [Serializable]
    public class ProfilesMap { }

    [Serializable]
    public class Baseline
    {
        public float value_c;
        public bool measured;
        public string basis;
        public string month;
        public string source;
        public string source_url;
    }

    [Serializable]
    public class ZoneProfile
    {
        public Zone zone;
        public List<Intervention> interventions = new List<Intervention>();
        public Diagnosis diagnosis;
    }

    [Serializable]
    public class Zone
    {
        public string id;
        public string name;
        public string description;
        public string type;

        // [lat, lon]
        public float[] center;
        // [[lat,lon],[lat,lon]] — project study box, NOT an administrative boundary.
        public float[][] bounds;

        public float lst_celsius;
        public float heat_risk_score;
        public string risk_level;
        public string heat_color;
        public float[] heat_color_rgba;

        public float building_density_pct;
        public float green_cover_pct;
        public float road_coverage_pct;
        public float ndvi;

        public Morphology morphology;
        public string estimator_agreement;
        public bool osm_fetched;
        public string osm_fetched_at;

        public bool HasBounds => bounds != null && bounds.Length >= 2
                                 && bounds[0] != null && bounds[0].Length >= 2
                                 && bounds[1] != null && bounds[1].Length >= 2;
        public bool HasCenter => center != null && center.Length >= 2;
    }

    [Serializable]
    public class Morphology
    {
        public bool available;
        public float sky_view_factor;
        public float canyon_aspect_ratio;
        public float plan_area_index;
        public float frontal_area_index;
        public float mean_height_m;
        public int buildings_sampled;
        public float uhi_from_geometry_c;
        public string method;
        public string limits;
        public float building_cover_pct_measured;
        public float green_cover_pct_measured;
    }

    /// <summary>
    /// One cooling measure. Every zone carries a mix of these; four measure
    /// types in the source dataset never received an <c>estimated_area_sqm</c>
    /// (see <see cref="Core.HeatModel.FootprintSqm"/> for how that is handled).
    /// </summary>
    [Serializable]
    public class Intervention
    {
        public string id;
        public string name;
        public string category;   // "green" | "cool_surface" | "water"
        public string icon;

        public float temp_drop;                 // zone-average °C for one unit
        public float local_reference_drop_c;    // effect where it stands
        public float effect_radius_m;
        public float estimated_area_sqm;        // 0 / absent for 4 measure types
        public float area_affected_sqm;
        public float estimated_cost_inr;
        public float cost_per_sqm_inr;

        public string authority;
        public string source;
        public string planning_basis;

        // JsonUtility leaves value types at their default (0) when the key is
        // absent, so "was this field present at all" is inferred by DataLoader
        // and stored here.
        public bool hasEstimatedArea;
    }

    [Serializable]
    public class Diagnosis
    {
        public string primary_cause;
        public List<string> contributing_factors = new List<string>();
        public string urban_context;
        public string vulnerable_populations;
    }
}
