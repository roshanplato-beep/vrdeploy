#if UNITY_EDITOR
using System.IO;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.UI;
using ChennaiOrbit.World;
using ChennaiOrbit.Interaction;

namespace ChennaiOrbit.EditorTools
{
    /// <summary>
    /// One-click setup for the Unity port.
    ///
    /// The WebXR original is fully procedural — every mesh, panel and card is
    /// built from code and the dataset — so there are almost no art assets to
    /// import. This generates the few prefabs that are genuinely useful as
    /// drop-in templates, plus a demo scene wired to <see cref="ChennaiOrbitApp"/>.
    ///
    /// Menu: <b>Chennai Orbit ▸ Build Prefabs &amp; Demo Scene</b>
    /// </summary>
    public static class ChennaiOrbitSetup
    {
        const string PrefabDir = "Assets/ChennaiOrbit/Prefabs";
        const string SceneDir = "Assets/ChennaiOrbit/Scenes";

        [MenuItem("Chennai Orbit/Build Prefabs & Demo Scene")]
        public static void BuildAll()
        {
            Directory.CreateDirectory(PrefabDir);
            Directory.CreateDirectory(SceneDir);

            var panel = BuildFloatingPanelPrefab();
            var card = BuildSolutionCardPrefab();
            var marker = BuildZoneMarkerPrefab();
            var rig = BuildRigPrefab();

            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();

            BuildDemoScene(rig);

            EditorUtility.DisplayDialog("Chennai Orbit",
                "Generated:\n" +
                $"• {PrefabDir}/FloatingPanel.prefab\n" +
                $"• {PrefabDir}/SolutionCard.prefab\n" +
                $"• {PrefabDir}/ZoneMarker.prefab\n" +
                $"• {PrefabDir}/ChennaiOrbitRig.prefab\n" +
                $"• {SceneDir}/ChennaiOrbit.unity\n\n" +
                "Open the scene and press Play. See SETUP.md for the required packages and XR settings.",
                "OK");
        }

        static GameObject SavePrefab(GameObject go, string name)
        {
            string path = $"{PrefabDir}/{name}.prefab";
            var prefab = PrefabUtility.SaveAsPrefabAsset(go, path);
            Object.DestroyImmediate(go);
            return prefab;
        }

        // --- FloatingPanel -------------------------------------------------
        static GameObject BuildFloatingPanelPrefab()
        {
            var go = new GameObject("FloatingPanel", typeof(RectTransform));
            var canvas = go.AddComponent<Canvas>();
            canvas.renderMode = RenderMode.WorldSpace;
            go.AddComponent<CanvasScaler>();
            go.AddComponent<GraphicRaycaster>();
            var rt = go.GetComponent<RectTransform>();
            rt.sizeDelta = new Vector2(760, 1080);
            rt.localScale = Vector3.one * (0.46f / 760f);
            var bg = go.AddComponent<Image>();
            bg.color = new Color(0.024f, 0.078f, 0.11f, 0.92f);
            var box = go.AddComponent<BoxCollider>();
            box.size = new Vector3(760, 1080, 4f);
            box.isTrigger = true;
            return SavePrefab(go, "FloatingPanel");
        }

        // --- SolutionCard -------------------------------------------------
        static GameObject BuildSolutionCardPrefab()
        {
            var go = GameObject.CreatePrimitive(PrimitiveType.Quad);
            go.name = "SolutionCard";
            go.transform.localScale = new Vector3(0.26f, 0.32f, 1f);
            var col = go.GetComponent<Collider>();
            if (col) ((MeshCollider)col).convex = true;
            go.AddComponent<SolutionCard>();
            return SavePrefab(go, "SolutionCard");
        }

        // --- ZoneMarker -------------------------------------------------
        static GameObject BuildZoneMarkerPrefab()
        {
            var go = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
            go.name = "ZoneMarker";
            go.transform.localScale = new Vector3(0.42f, 0.08f, 0.42f);
            go.AddComponent<ZoneMarker>();
            go.AddComponent<Grabbable>().kind = GrabKind.City;
            return SavePrefab(go, "ZoneMarker");
        }

        // --- The XR rig + app -------------------------------------------
        static GameObject BuildRigPrefab()
        {
            var root = new GameObject("ChennaiOrbitRig");

            // Camera offset (matches XR Origin's "Camera Offset" child).
            var offset = new GameObject("Camera Offset");
            offset.transform.SetParent(root.transform, false);
            offset.transform.localPosition = new Vector3(0, 0, 0);

            var camGo = new GameObject("Main Camera", typeof(Camera));
            camGo.tag = "MainCamera";
            camGo.transform.SetParent(offset.transform, false);
            var cam = camGo.GetComponent<Camera>();
            cam.clearFlags = CameraClearFlags.SolidColor;
            cam.backgroundColor = Core.Palette.Space;
            cam.nearClipPlane = 0.02f;
            cam.farClipPlane = 400f;

            var left = new GameObject("LeftHand Pointer");
            left.transform.SetParent(offset.transform, false);
            var lp = left.AddComponent<XrPointer>();
            lp.Hand = Handedness.Left; lp.Origin = left.transform;

            var right = new GameObject("RightHand Pointer");
            right.transform.SetParent(offset.transform, false);
            var rp = right.AddComponent<XrPointer>();
            rp.Hand = Handedness.Right; rp.Origin = right.transform;

            var wristAnchor = new GameObject("LeftHand Wrist Anchor");
            wristAnchor.transform.SetParent(left.transform, false);

            var app = root.AddComponent<ChennaiOrbitApp>();
            app.head = camGo.transform;
            app.leftPointer = lp;
            app.rightPointer = rp;
            app.leftHandAnchor = wristAnchor.transform;

            return SavePrefab(root, "ChennaiOrbitRig");
        }

        static void BuildDemoScene(GameObject rigPrefab)
        {
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

            var light = new GameObject("Directional Light", typeof(Light));
            light.GetComponent<Light>().type = LightType.Directional;
            light.transform.rotation = Quaternion.Euler(55, -30, 0);

            var ambient = new GameObject("Fill Light", typeof(Light));
            var fl = ambient.GetComponent<Light>();
            fl.type = LightType.Directional;
            fl.intensity = 0.4f;
            ambient.transform.rotation = Quaternion.Euler(-30, 150, 0);

            PrefabUtility.InstantiatePrefab(rigPrefab, scene);

            string path = $"{SceneDir}/ChennaiOrbit.unity";
            EditorSceneManager.SaveScene(scene, path);
        }
    }
}
#endif
