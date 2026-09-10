using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

namespace ChennaiOrbit.Interaction
{
    /// <summary>
    /// The in-world flat surface, ported from <c>src/vr/panel.js</c> in idea:
    /// one panel per surface, hit regions share coordinates with drawing, and
    /// buttons are kept large enough to hit with a tracked hand (MIN_TARGET).
    ///
    /// Where the WebXR build paints a &lt;canvas&gt; texture, this uses a
    /// world-space uGUI Canvas — the direct Unity equivalent — so hands,
    /// controllers and mouse activate identical UI. Buttons are real
    /// <see cref="Button"/>s; the pointer raycasts them like anything else and
    /// they are marked <see cref="IPokeable"/> for fingertip presses.
    ///
    /// This is the wrist HUD and the two floating windows (zone list, zone
    /// detail + land capacity + cost) from the WebXR build.
    /// </summary>
    [RequireComponent(typeof(RectTransform))]
    public class WorldPanel : MonoBehaviour, IPokeable
    {
        /// <summary>Smallest button height, ~4° at reading distance.</summary>
        public const float MinTargetPx = 92f;

        public static readonly Color Accent  = Core.Palette.Cyan;
        public static readonly Color Primary = Core.Palette.White;
        public static readonly Color Body    = new Color(0.71f, 0.83f, 0.85f);
        public static readonly Color Muted   = new Color(0.50f, 0.64f, 0.69f);
        public static readonly Color Warm    = Core.Palette.Amber;

        RectTransform _content;
        VerticalLayoutGroup _layout;
        readonly List<GameObject> _rows = new List<GameObject>();
        Font _font;

        public static WorldPanel Create(string name, float worldWidth, float worldHeight, int pxWidth = 760)
        {
            var go = new GameObject(name, typeof(RectTransform));
            var canvas = go.AddComponent<Canvas>();
            canvas.renderMode = RenderMode.WorldSpace;
            go.AddComponent<CanvasScaler>();
            var gr = go.AddComponent<GraphicRaycaster>();

            int pxHeight = Mathf.RoundToInt(pxWidth * worldHeight / worldWidth);
            var rt = go.GetComponent<RectTransform>();
            rt.sizeDelta = new Vector2(pxWidth, pxHeight);
            rt.localScale = Vector3.one * (worldWidth / pxWidth);

            // Glass background.
            var bg = go.AddComponent<Image>();
            bg.color = new Color(0.024f, 0.078f, 0.11f, 0.92f);

            // Box collider so the XrPointer ray + poke sphere can hit it.
            var box = go.AddComponent<BoxCollider>();
            box.size = new Vector3(pxWidth, pxHeight, 4f);
            box.isTrigger = true;

            var panel = go.AddComponent<WorldPanel>();
            panel._font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf")
                          ?? Resources.GetBuiltinResource<Font>("Arial.ttf");

            var contentGo = new GameObject("Content", typeof(RectTransform));
            contentGo.transform.SetParent(go.transform, false);
            var crt = contentGo.GetComponent<RectTransform>();
            crt.anchorMin = new Vector2(0, 0); crt.anchorMax = new Vector2(1, 1);
            crt.offsetMin = new Vector2(28, 28); crt.offsetMax = new Vector2(-28, -28);
            panel._content = crt;
            panel._layout = contentGo.AddComponent<VerticalLayoutGroup>();
            panel._layout.spacing = 10;
            panel._layout.childControlWidth = true;
            panel._layout.childForceExpandWidth = true;
            panel._layout.childControlHeight = true;

            return panel;
        }

        public void Begin(string title, string kicker = "CHENNAI ORBIT")
        {
            foreach (var r in _rows) Destroy(r);
            _rows.Clear();
            AddLabel(kicker, 22, Accent, FontStyle.Bold);
            AddLabel(title, 40, Primary, FontStyle.Bold);
        }

        public Text AddLabel(string text, int size, Color color, FontStyle style = FontStyle.Normal)
        {
            var go = new GameObject("Label", typeof(RectTransform));
            go.transform.SetParent(_content, false);
            var t = go.AddComponent<Text>();
            t.font = _font;
            t.text = text;
            t.fontSize = size;
            t.color = color;
            t.fontStyle = style;
            t.horizontalOverflow = HorizontalWrapMode.Wrap;
            t.verticalOverflow = VerticalWrapMode.Overflow;
            var le = go.AddComponent<LayoutElement>();
            le.minHeight = size * 1.4f;
            _rows.Add(go);
            return t;
        }

        public void AddRow(string label, string value)
        {
            var go = new GameObject("Row", typeof(RectTransform));
            go.transform.SetParent(_content, false);
            var h = go.AddComponent<HorizontalLayoutGroup>();
            h.childForceExpandWidth = true;
            go.AddComponent<LayoutElement>().minHeight = 34;

            var l = MakeChildText(go.transform, label, 24, Body);
            l.alignment = TextAnchor.MiddleLeft;
            var v = MakeChildText(go.transform, value, 24, Primary, FontStyle.Bold);
            v.alignment = TextAnchor.MiddleRight;
            _rows.Add(go);
        }

        public void AddStat(string value, string caption, Color color)
        {
            AddLabel(value, 60, color, FontStyle.Bold);
            AddLabel(caption, 22, Muted);
        }

        public void AddBar(float fraction01, Color fill)
        {
            var go = new GameObject("Bar", typeof(RectTransform));
            go.transform.SetParent(_content, false);
            go.AddComponent<LayoutElement>().minHeight = 18;
            var back = go.AddComponent<Image>();
            back.color = new Color(1, 1, 1, 0.08f);
            var fillGo = new GameObject("Fill", typeof(RectTransform));
            fillGo.transform.SetParent(go.transform, false);
            var frt = fillGo.GetComponent<RectTransform>();
            frt.anchorMin = Vector2.zero;
            frt.anchorMax = new Vector2(Mathf.Clamp01(fraction01), 1);
            frt.offsetMin = Vector2.zero; frt.offsetMax = Vector2.zero;
            fillGo.AddComponent<Image>().color = fill;
            _rows.Add(go);
        }

        public Button AddButton(string label, Action onClick, bool active = false)
        {
            var go = new GameObject("Button", typeof(RectTransform));
            go.transform.SetParent(_content, false);
            go.AddComponent<LayoutElement>().minHeight = MinTargetPx;
            var img = go.AddComponent<Image>();
            img.color = active ? new Color(0.07f, 0.40f, 0.37f) : new Color(0.075f, 0.20f, 0.25f, 0.92f);
            var btn = go.AddComponent<Button>();
            btn.targetGraphic = img;
            btn.onClick.AddListener(() => onClick?.Invoke());
            var t = MakeChildText(go.transform, label, 26, active ? new Color(0.79f, 1f, 0.91f) : new Color(0.86f, 0.95f, 0.96f), FontStyle.Bold);
            t.alignment = TextAnchor.MiddleCenter;
            _rows.Add(go);
            return btn;
        }

        Text MakeChildText(Transform parent, string s, int size, Color color, FontStyle style = FontStyle.Normal)
        {
            var go = new GameObject("T", typeof(RectTransform));
            go.transform.SetParent(parent, false);
            var t = go.AddComponent<Text>();
            t.font = _font; t.text = s; t.fontSize = size; t.color = color; t.fontStyle = style;
            var rt = go.GetComponent<RectTransform>();
            rt.anchorMin = Vector2.zero; rt.anchorMax = Vector2.one;
            rt.offsetMin = new Vector2(6, 0); rt.offsetMax = new Vector2(-6, 0);
            return t;
        }

        /// <summary>Face the given world position, yaw + pitch (billboard).</summary>
        public void FaceToward(Vector3 worldPos)
        {
            var dir = transform.position - worldPos;
            if (dir.sqrMagnitude > 1e-6f)
                transform.rotation = Quaternion.LookRotation(dir.normalized, Vector3.up);
        }
    }
}
