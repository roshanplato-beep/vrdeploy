import * as THREE from "three";
import { XRHandModelFactory } from "three/addons/webxr/XRHandModelFactory.js";

/**
 * One pointer per XR input source, for controllers and tracked hands alike.
 *
 * What this replaces, and why:
 *
 *   Selection used to come only from the runtime's selectstart event and a ray
 *   fired at the instant of the press. With hands that is close to unusable —
 *   the pinch that fires the event also jerks the ray off the target, and
 *   there is no feedback beforehand telling you whether you were aimed at a
 *   button at all. So the panels looked interactive and were not.
 *
 * Three things fix it, and all three are standard practice for hand tracking:
 *
 *   1. Continuous hover. The ray is cast every frame, not on press, so the
 *      caller can light up the target under the pointer and the press acts on
 *      what was already highlighted rather than on wherever the hand ended up.
 *   2. A pinch detected from joint positions, with hysteresis and a cooldown.
 *      Runtime pinch events vary between browsers and drop out under partial
 *      occlusion; the joints are reported even when the gesture event is not,
 *      and hysteresis stops one pinch registering as several.
 *   3. Direct poke. Touching a panel with a fingertip is what people try first
 *      in a headset, and it needs no aiming at all.
 *
 * Controllers keep event-driven selection, which is reliable for them, and
 * gain a haptic tick on hover and press.
 */

const PINCH_ON = 0.022;
const PINCH_OFF = 0.032;
const PINCH_COOLDOWN_MS = 220;
const POKE_DEPTH = 0.035;
const POKE_RELEASE = 0.06;

export function createPointers(
  renderer,
  rig,
  scene,
  { onSelect, onSqueeze, onRelease },
) {
  const factory = new XRHandModelFactory();
  const pointers = [];
  const raycaster = new THREE.Raycaster();
  const tmpA = new THREE.Vector3(),
    tmpB = new THREE.Vector3(),
    tmpQ = new THREE.Quaternion(),
    tmpN = new THREE.Vector3();

  for (let i = 0; i < 2; i++) {
    const controller = renderer.xr.getController(i);
    const grip = renderer.xr.getControllerGrip(i);
    const hand = renderer.xr.getHand(i);
    rig.add(controller, grip, hand);
    hand.add(factory.createHandModel(hand, "spheres"));

    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.018, 0.075, 4, 8),
      new THREE.MeshLambertMaterial({ color: "#8fc6cc", emissive: "#12333a" }),
    );
    body.rotation.x = Math.PI / 2;
    grip.add(body);

    // A short beam that stops at whatever it hits. A long ray punching through
    // the target reads as "nothing here"; one landing on a surface reads as a
    // pointer.
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0022, 0.0035, 1, 6, 1, true),
      new THREE.MeshBasicMaterial({
        color: "#58eed0",
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      }),
    );
    beam.geometry.translate(0, -0.5, 0);
    beam.geometry.rotateX(-Math.PI / 2);
    controller.add(beam);

    // A disc lying on the hit surface, not a dot floating in front of it, so
    // it is obvious which surface is being pointed at.
    const cursor = new THREE.Mesh(
      new THREE.RingGeometry(0.006, 0.011, 20),
      new THREE.MeshBasicMaterial({
        color: "#d7fff5",
        transparent: true,
        opacity: 0.95,
        depthTest: false,
        side: THREE.DoubleSide,
      }),
    );
    cursor.renderOrder = 90;
    cursor.visible = false;
    scene.add(cursor);

    const pointer = {
      index: i,
      controller,
      grip,
      hand,
      beam,
      cursor,
      body,
      source: null,
      isHand: false,
      hover: null,
      pinched: false,
      pinchAt: 0,
      poking: null,
      selecting: false,
    };
    pointers.push(pointer);

    controller.addEventListener("connected", (e) => {
      pointer.source = e.data;
      pointer.isHand = !!e.data.hand;
      body.visible = !e.data.hand;
      // The hand mesh already shows where the fingers are; a bright beam from
      // the palm on top of that is noise.
      beam.material.opacity = e.data.hand ? 0.32 : 0.55;
    });
    controller.addEventListener("disconnected", () => {
      onRelease?.(pointer);
      pointer.source = null;
      pointer.hover = null;
      pointer.selecting = false;
      cursor.visible = false;
    });
    // Controllers only. Hand pinches are derived from joints below, so that a
    // runtime which does not deliver the events still selects.
    controller.addEventListener("selectstart", () => {
      if (pointer.isHand) return;
      pointer.selecting = true;
      pulse(pointer, 0.4, 18);
      onSelect?.(pointer, pointer.hover);
    });
    controller.addEventListener("selectend", () => {
      if (pointer.isHand) return;
      pointer.selecting = false;
      onRelease?.(pointer);
    });
    controller.addEventListener("squeezestart", () => {
      if (!pointer.isHand) onSqueeze?.(pointer);
    });
    controller.addEventListener("squeezeend", () => {
      if (!pointer.isHand) onRelease?.(pointer);
    });
  }

  /** Fingertip if this is a tracked hand, else the grip. */
  function tipPosition(pointer, target) {
    const joint = pointer.hand?.joints?.["index-finger-tip"];
    if (pointer.isHand && joint && pointer.hand.visible)
      return joint.getWorldPosition(target);
    return pointer.grip.getWorldPosition(target);
  }

  function pinchDistance(pointer) {
    const index = pointer.hand?.joints?.["index-finger-tip"];
    const thumb = pointer.hand?.joints?.["thumb-tip"];
    if (!index || !thumb || !pointer.hand.visible) return null;
    return index
      .getWorldPosition(tmpA)
      .distanceTo(thumb.getWorldPosition(tmpB));
  }

  function castFrom(pointer, targets) {
    pointer.controller.getWorldPosition(tmpA);
    pointer.controller.getWorldQuaternion(tmpQ);
    raycaster.set(tmpA, tmpN.set(0, 0, -1).applyQuaternion(tmpQ));
    return raycaster.intersectObjects(targets, false)[0] || null;
  }

  function pulse(pointer, strength = 0.25, ms = 12) {
    const actuator = pointer.source?.gamepad?.hapticActuators?.[0];
    try {
      actuator?.pulse?.(strength, ms);
    } catch {
      /* haptics are optional */
    }
  }

  return {
    pointers,
    tipPosition,
    /**
     * Raycast every pointer, update hover, and turn pinches and pokes into
     * select callbacks. `pokeTargets` are meshes a fingertip may touch
     * directly; everything else is pointed at.
     */
    update(targets, pokeTargets, now) {
      for (const pointer of pointers) {
        if (!pointer.source) {
          pointer.cursor.visible = false;
          continue;
        }
        if (pointer.isHand && !pointer.hand.visible) {
          pointer.cursor.visible = false;
          pointer.beam.visible = false;
          pointer.hover = null;
          continue;
        }
        pointer.beam.visible = true;

        // --- Direct poke ------------------------------------------------
        // Checked before the ray, because a finger already inside a panel is
        // unambiguous and should not be overridden by whatever the wrist
        // happens to be aimed at.
        let poke = null;
        if (pointer.isHand && pokeTargets.length) {
          const tip = tipPosition(pointer, tmpA);
          for (const mesh of pokeTargets) {
            const half = mesh.userData.halfSize;
            if (!half) continue;
            const local = mesh.worldToLocal(tmpB.copy(tip));
            const limit = pointer.poking === mesh ? POKE_RELEASE : POKE_DEPTH;
            if (
              Math.abs(local.x) <= half.x &&
              Math.abs(local.y) <= half.y &&
              Math.abs(local.z) < limit
            ) {
              poke = {
                object: mesh,
                uv: {
                  x: local.x / (half.x * 2) + 0.5,
                  y: local.y / (half.y * 2) + 0.5,
                },
                point: tip.clone(),
                distance: 0,
              };
              break;
            }
          }
        }

        const hit = poke || castFrom(pointer, targets);
        const changed = hit?.object !== pointer.hover?.object;
        pointer.hover = hit;

        if (hit) {
          pointer.cursor.visible = true;
          pointer.cursor.position.copy(hit.point);
          if (hit.face) {
            tmpN
              .copy(hit.face.normal)
              .transformDirection(hit.object.matrixWorld);
            pointer.cursor.lookAt(tmpN.add(hit.point));
          } else {
            hit.object.getWorldQuaternion(tmpQ);
            pointer.cursor.quaternion.copy(tmpQ);
          }
          pointer.beam.scale.z = poke
            ? 0.02
            : Math.max(0.02, Math.min(hit.distance, 6));
          if (changed && !pointer.isHand) pulse(pointer, 0.12, 8);
        } else {
          pointer.cursor.visible = false;
          pointer.beam.scale.z = 1.2;
        }

        // --- Pinch ------------------------------------------------------
        if (pointer.isHand) {
          const distance = pinchDistance(pointer);
          if (distance !== null) {
            if (!pointer.pinched && distance < PINCH_ON) {
              if (now - pointer.pinchAt > PINCH_COOLDOWN_MS) {
                pointer.pinched = true;
                pointer.selecting = true;
                pointer.pinchAt = now;
                onSelect?.(pointer, pointer.hover);
              }
            } else if (pointer.pinched && distance > PINCH_OFF) {
              pointer.pinched = false;
              pointer.selecting = false;
              onRelease?.(pointer);
            }
          }
          // A poke fires once on entry, like a button press.
          if (poke && pointer.poking !== poke.object) {
            pointer.poking = poke.object;
            onSelect?.(pointer, poke);
          } else if (!poke) {
            pointer.poking = null;
          }
        }
      }
    },
    pulse,
    dispose() {
      for (const pointer of pointers) {
        pointer.cursor.geometry.dispose();
        pointer.cursor.material.dispose();
        pointer.cursor.removeFromParent();
        pointer.beam.geometry.dispose();
        pointer.beam.material.dispose();
      }
    },
  };
}
