using System;
using System.Collections.Generic;

namespace ChennaiOrbit.Data
{
    /// <summary>
    /// C# shape of <c>StreamingAssets/vr/chennai-osm.json</c> (~6.5 MB):
    /// 29,399 OpenStreetMap features — 21,664 buildings, plus roads, water,
    /// coastline and parks — sampled within ~700 m of each study zone.
    ///
    /// From the file's own note: untagged building heights fall back to 9 m,
    /// and height is exaggerated 4× for tabletop readability. <c>points</c>
    /// are [lon, lat] pairs.
    /// </summary>
    [Serializable]
    public class OsmFile
    {
        public string source;
        public string license;
        public string fetchedAt;
        public float[] bbox;      // [minLat, minLon, maxLat, maxLon]
        public string note;
        public List<OsmFeature> features = new List<OsmFeature>();
    }

    [Serializable]
    public class OsmFeature
    {
        public long id;
        public string kind;       // "building" | "road" | "water" | "green" | "coast"
        public string name;
        public float height;
        // Flattened [lon0,lat0, lon1,lat1, ...] because JsonUtility cannot bind
        // a jagged float[][]. DataLoader repacks the raw JSON into this shape.
        public float[] pointsFlat;

        public int PointCount => pointsFlat == null ? 0 : pointsFlat.Length / 2;
        public float Lon(int i) => pointsFlat[i * 2];
        public float Lat(int i) => pointsFlat[i * 2 + 1];
    }
}
