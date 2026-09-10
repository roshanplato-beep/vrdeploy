using System;
using UnityEngine;
using UnityEngine.XR;

namespace ChennaiOrbit.Interaction
{
    public enum Handedness { Left, Right }

    /// <summary>
    /// Port of <c>src/vr/xr-input.js</c>: one pointer per hand / controller,
    /// with the same behaviours that made hand tracking usable in the WebXR
    /// build —
    ///
    ///  * Continuous hover: the ray is cast every frame, not on press, so the
    ///    press acts on what was already highlighted rather than on wherever
    ///    the pinch jerked the hand.
    ///  * Pinch from joint distance, not runtime events: thumb-tip ↔ index-tip
    ///    with hysteresis (22 mm on / 32 mm off) and a 220 ms cooldown. Joints
    ///    are reported even when the pinch gesture event drops out.
    ///  * Direct poke: a fingertip within 35 mm of a panel presses it.
    ///
    /// Uses Unity XR Hands for joints and the legacy XR Input for controllers.
    /// The C# raycast has no equivalent of three.js's "Sprite needs a camera"
    /// pitfall, so the fix from that bug isn't needed here.
    /// </summary>
    public class XrPointer : MonoBehaviour
    {
        public const float PinchOn = 0.022f;
        public const float PinchOff = 0.032f;
        public const float PinchCooldown = 0.22f;
        public const float PokeDepth = 0.035f;
        public const float PokeRelease = 0.06f;

        public bool IsHand;
        public Handedness Hand = Handedness.Right;
        public Transform Origin;            // controller/grip transform to cast from
        public Transform IndexTip;          // set when hand-tracked
        public Transform ThumbTip;

        public RaycastHit? Hover { get; private set; }
        public bool Selecting { get; private set; }
        public bool Tracked { get; private set; }
        public Vector3 TipPosition => IsHand && IndexTip ? IndexTip.position : (Origin ? Origin.position : transform.position);

        public event Action<XrPointer, RaycastHit?> OnSelect;
        public event Action<XrPointer> OnRelease;
        public event Action<XrPointer> OnSqueeze;

        bool _pinched;
        float _pinchAt = -10f;
        Collider _poking;
        InputDevice _device;

        public LayerMask hitMask = ~0;
        public float maxDistance = 8f;

        void Update()
        {
            Tracked = ResolveTracking();
            if (!Tracked) { Hover = null; return; }

            // --- Direct poke (checked first) ------------------------------
            RaycastHit hit = default;
            bool haveHit = false;

            if (IsHand)
            {
                var tip = TipPosition;
                var overlaps = Physics.OverlapSphere(tip, PokeDepth, hitMask);
                foreach (var col in overlaps)
                {
                    if (col.GetComponentInParent<IPokeable>() == null) continue;
                    hit = new RaycastHit();
                    haveHit = true;
                    if (_poking != col)
                    {
                        _poking = col;
                        OnSelect?.Invoke(this, new RaycastHit()); // poke entry fires once
                    }
                    Hover = null;
                    break;
                }
                if (!haveHit) _poking = null;
            }

            // --- Ray hover ------------------------------------------------
            if (!haveHit && Origin != null)
            {
                if (Physics.Raycast(Origin.position, Origin.forward, out hit, maxDistance, hitMask))
                {
                    Hover = hit;
                }
                else Hover = null;
            }

            // --- Pinch (hand) or trigger (controller) -------------------
            if (IsHand && IndexTip && ThumbTip)
            {
                float d = Vector3.Distance(IndexTip.position, ThumbTip.position);
                if (!_pinched && d < PinchOn && Time.time - _pinchAt > PinchCooldown)
                {
                    _pinched = true; Selecting = true; _pinchAt = Time.time;
                    OnSelect?.Invoke(this, Hover);
                }
                else if (_pinched && d > PinchOff)
                {
                    _pinched = false; Selecting = false;
                    OnRelease?.Invoke(this);
                }
            }
            else if (!IsHand && _device.isValid)
            {
                if (_device.TryGetFeatureValue(CommonUsages.triggerButton, out bool trg))
                {
                    if (trg && !Selecting) { Selecting = true; OnSelect?.Invoke(this, Hover); }
                    else if (!trg && Selecting) { Selecting = false; OnRelease?.Invoke(this); }
                }
                if (_device.TryGetFeatureValue(CommonUsages.gripButton, out bool grip) && grip)
                    OnSqueeze?.Invoke(this);
            }
        }

        bool ResolveTracking()
        {
            if (IsHand)
                return IndexTip != null && ThumbTip != null && IndexTip.gameObject.activeInHierarchy;

            if (!_device.isValid)
            {
                _device = InputDevices.GetDeviceAtXRNode(
                    Hand == Handedness.Left ? XRNode.LeftHand : XRNode.RightHand);
            }
            return _device.isValid && Origin != null;
        }
    }

    /// <summary>Marker for anything a fingertip can poke directly (panels, cards).</summary>
    public interface IPokeable { }
}
