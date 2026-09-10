using UnityEngine;

namespace ChennaiOrbit
{
    public enum GrabKind { Globe, Chennai, City, Layer }

    /// <summary>Something a hand or controller can grab to move / rotate / scale.
    /// Ported from the <c>userData.grab</c> tags in the WebXR scene.</summary>
    public class Grabbable : MonoBehaviour
    {
        public GrabKind kind = GrabKind.City;
        public int layerIndex = -1;
    }

    /// <summary>A numbered zone marker on the tabletop — pinch to inspect.</summary>
    public class ZoneMarker : MonoBehaviour { public string zoneId; }

    /// <summary>The globe's "ENTER CHENNAI" card / marker — pinch to descend.</summary>
    public class EnterTarget : MonoBehaviour { }

    /// <summary>The globe's thermal-view toggle card.</summary>
    public class ThermalToggleTarget : MonoBehaviour { }

    /// <summary>A floating solution card above a selected zone.</summary>
    public class SolutionCard : MonoBehaviour { public int slot; public string interventionId; }

    /// <summary>A placed cooling measure on the map — pinch to remove this one.</summary>
    public class PlacedMeasure : MonoBehaviour { public string zoneId; public int uid; }
}
