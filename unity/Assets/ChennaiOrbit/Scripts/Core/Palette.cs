using UnityEngine;

namespace ChennaiOrbit.Core
{
    /// <summary>The holographic palette, ported from <c>src/vr/holo.js</c>.</summary>
    public static class Palette
    {
        public static readonly Color Cyan  = Hex("#58eed0");
        public static readonly Color Ice   = Hex("#9ff4ff");
        public static readonly Color Amber = Hex("#ffa766");
        public static readonly Color Hot   = Hex("#ff7a59");
        public static readonly Color Green = Hex("#69e89c");
        public static readonly Color Water = Hex("#50c1f0");
        public static readonly Color White = Hex("#eafff8");
        public static readonly Color Space = Hex("#04101a");
        public static readonly Color Gold  = Hex("#ffd76a");

        public static Color Hex(string hex)
        {
            return ColorUtility.TryParseHtmlString(hex, out var c) ? c : Color.magenta;
        }

        public static Color ForCategory(string category)
        {
            switch (category)
            {
                case "green": return Green;
                case "cool_surface": return Ice;
                case "water": return Water;
                default: return Green;
            }
        }

        public static string CategoryLabel(string category)
        {
            switch (category)
            {
                case "green": return "GREEN";
                case "cool_surface": return "COOL SURFACE";
                case "water": return "WATER";
                default: return category != null ? category.ToUpperInvariant() : "MEASURE";
            }
        }
    }
}
