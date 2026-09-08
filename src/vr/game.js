import * as THREE from "three";
import { HOLO, glow, wire, label, reticle, brackets, pulseRing } from "./holo";
import { CATEGORY, buildBody, createSolution } from "./solutions";
import { impact, money, project } from "./model";

/**
 * The loop: pick a zone, choose one of its three measures, put it down on the
 * map, watch the zone respond.
 *
 * Everything the player touches is an object in the world. There is no panel
 * of buttons standing in for the city — the cards hang over the zone they
 * belong to, the measure is carried in the hand, and the result is shown by
 * the map changing colour under it. The numbers on the readouts are the
 * dataset's own: each zone ships exactly three interventions with a modelled
 * cooling figure, a cost, and an effect radius, and none of those are scaled
 * up here to make the game feel better.
 *
 * A measure may only be dropped inside the zone it belongs to. That is the
 * rule the data implies rather than an arbitrary one: the cooling and cost
 * figures were computed for that zone's area and building stock, so a cool
 * roof budget for T. Nagar means nothing dropped over the sea.
 */

// Sized for reading across the tabletop, roughly a metre and a half away,
// where a card any smaller turns into three illegible grey lines.
const CARD_W = 0.26;
const CARD_H = 0.32;
const CARD_LIFT = 0.34; // Metres above the tabletop.

export function createGame({ scene, city, zones, audio, onChange }) {
  const group = new THREE.Group();
  scene.add(group);

  const cardGroup = new THREE.Group();
  cardGroup.visible = false;
  group.add(cardGroup);

  const state = {
    zoneId: null,
    details: {},
    chosen: {},
    placed: new Map(), // zoneId -> Map(interventionId -> solution)
    carrying: null,
    before: false,
  };

  // --- Selection frame on the map -----------------------------------------
  const frame = new THREE.Group();
  frame.visible = false;
  city.root.add(frame);
  const selectRing = reticle(1.6, HOLO.cyan, 36);
  frame.add(selectRing.group);
  let selectBrackets = null;

  // --- Readout above the zone ---------------------------------------------
  const readout = label(640, 320, 0.16);
  readout.sprite.visible = false;
  group.add(readout.sprite);

  const hint = label(768, 96, 0.045);
  hint.sprite.visible = false;
  group.add(hint.sprite);

  // --- Cards ---------------------------------------------------------------
  const cards = [];
  for (let i = 0; i < 3; i++) {
    const card = new THREE.Group();

    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(CARD_W, CARD_H),
      glow(HOLO.cyan, 0.14),
    );
    plate.userData.card = i;
    // So a fingertip can press the card directly, not only point at it.
    plate.userData.halfSize = { x: CARD_W / 2, y: CARD_H / 2 };
    card.add(plate);

    const edgePoints = [];
    const w = CARD_W / 2,
      h = CARD_H / 2;
    for (const [ax, ay, bx, by] of [
      [-w, h, w, h],
      [w, h, w, -h],
      [w, -h, -w, -h],
      [-w, -h, -w, h],
    ])
      edgePoints.push(ax, ay, 0, bx, by, 0);
    const edgeGeometry = new THREE.BufferGeometry();
    edgeGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(edgePoints, 3),
    );
    const edge = new THREE.LineSegments(edgeGeometry, wire(HOLO.cyan, 0.85));
    card.add(edge);

    const text = label(512, 360, CARD_H * 0.8);
    text.sprite.position.set(0, -CARD_H * 0.08, 0.004);
    card.add(text.sprite);

    // The measure itself, spinning above its card, so the thing you pick up
    // is the thing you were shown.
    const icon = new THREE.Group();
    icon.position.set(0, CARD_H * 0.3, 0.02);
    icon.scale.setScalar(0.16);
    card.add(icon);

    group.add(card);
    card.visible = false;
    cards.push({ card, plate, edge, text, icon, intervention: null, iconBody: null });
  }

  // --- Placement ghost ------------------------------------------------------
  let ghost = null;
  const dropBeam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.004, 0.004, 1, 6),
    glow(HOLO.cyan, 0.4),
  );
  dropBeam.visible = false;
  group.add(dropBeam);

  const commitPulse = pulseRing(0.3, HOLO.cyan);
  commitPulse.mesh.visible = false;
  group.add(commitPulse.mesh);

  const tmp = new THREE.Vector3(),
    tmpB = new THREE.Vector3();

  function zoneById(id) {
    return zones.find((z) => z.id === id) || null;
  }

  function chosenFor(id) {
    return state.chosen[id] || [];
  }

  function resultFor(id) {
    return impact(state.details[id]?.interventions || [], chosenFor(id));
  }

  /** Zone bounds in city-local units, as [minX, maxX, minZ, maxZ]. */
  function zoneBox(zone) {
    const a = project(zone.bounds[0]),
      b = project(zone.bounds[1]);
    return [
      Math.min(a[0], b[0]),
      Math.max(a[0], b[0]),
      Math.min(a[1], b[1]),
      Math.max(a[1], b[1]),
    ];
  }

  /**
   * Pull a drop point into the zone it belongs to.
   *
   * Rejecting anything outside the box was technically right and miserable to
   * play: a study zone is two or three kilometres across on a twenty-four
   * kilometre map, so most honest attempts to place a measure landed just
   * outside it and simply vanished. Clamping keeps the constraint that made
   * the rejection right — the measure ends up in the zone whose area and
   * building stock produced its cost and cooling figures — while letting the
   * player aim roughly and watch it snap home.
   */
  function clampToZone(zone, x, z) {
    const [minX, maxX, minZ, maxZ] = zoneBox(zone);
    const inset = Math.min(0.3, (maxX - minX) * 0.15, (maxZ - minZ) * 0.15);
    return [
      Math.min(Math.max(x, minX + inset), maxX - inset),
      Math.min(Math.max(z, minZ + inset), maxZ - inset),
    ];
  }

  // --- Public: selection ----------------------------------------------------
  function select(id) {
    const zone = zoneById(id);
    if (!zone) return;
    state.zoneId = id;
    city.select(id);

    const [minX, maxX, minZ, maxZ] = zoneBox(zone);
    frame.position.set((minX + maxX) / 2, 0.09, (minZ + maxZ) / 2);
    selectBrackets?.lines.removeFromParent();
    selectBrackets?.dispose();
    selectBrackets = brackets(maxX - minX, maxZ - minZ, HOLO.cyan);
    frame.add(selectBrackets.lines);
    frame.visible = true;

    refreshCards();
    audio?.ping();
    onChange?.(state.zoneId);
  }

  function refreshCards() {
    const zone = zoneById(state.zoneId);
    const list = state.details[state.zoneId]?.interventions || [];
    cardGroup.visible = !!zone;
    cards.forEach((slot, i) => {
      const item = list[i];
      slot.intervention = item || null;
      slot.card.visible = !!item && !!zone;
      if (!item) return;

      const category = CATEGORY[item.category] || CATEGORY.green;
      const placed = chosenFor(state.zoneId).includes(item.id);

      slot.plate.userData.interventionId = item.id;
      slot.plate.material.color.set(placed ? category.color : HOLO.cyan);
      slot.plate.material.opacity = placed ? 0.26 : 0.14;
      slot.edge.material.color.set(placed ? category.color : HOLO.cyan);

      // Two numbers, because one alone misleads. The local drop is what the
      // measure does where it stands; the zone average is that effect spread
      // over the whole study area, which is far smaller and easy to mistake
      // for the measure being useless.
      slot.text.write([
        [category.label, 26, category.color, 700],
        [item.name, 34, HOLO.white, 650],
        [`−${(item.local_reference_drop_c ?? 0).toFixed(1)}°C local`, 32, HOLO.amber, 700],
        [`−${item.temp_drop.toFixed(3)}°C zone average`, 24, "#8fb6c2", 500],
        [`${money(item.estimated_cost_inr)} · ${item.effect_radius_m} m`, 25, HOLO.white, 500],
        [placed ? "PLACED — pinch to remove" : "PINCH TO LIFT", 24, category.color, 700],
      ]);

      if (!slot.iconBody) {
        slot.iconBody = buildBody(item.category, category.color);
        slot.icon.add(slot.iconBody);
      }
      slot.icon.visible = !placed;
    });
    refreshReadout();
  }

  function refreshReadout() {
    const zone = zoneById(state.zoneId);
    if (!zone) {
      readout.sprite.visible = false;
      hint.sprite.visible = false;
      return;
    }
    const list = state.details[state.zoneId]?.interventions || [];
    const r = state.before ? { drop: 0, total: 0 } : resultFor(state.zoneId);
    const available = impact(list, list.map((i) => i.id)).drop;
    const share = available > 0 ? Math.min(1, r.drop / available) : 0;
    const bars = 20;
    const filled = Math.round(share * bars);

    readout.write([
      [zone.name, 44, HOLO.white, 700],
      [`${(zone.lst_celsius - r.drop).toFixed(2)}°C`, 76, HOLO.amber, 700],
      [`−${r.drop.toFixed(2)}°C of ${available.toFixed(2)}°C available`, 28, HOLO.cyan, 600],
      ["█".repeat(filled) + "░".repeat(bars - filled), 26, HOLO.cyan, 500],
      [r.total ? `${money(r.total)} committed` : "no measures placed", 28, HOLO.white, 500],
    ]);
    readout.sprite.visible = true;

    hint.write([
      [
        state.carrying
          ? "Release over the map — it snaps into the zone"
          : "Pinch a card to lift a measure",
        30,
        HOLO.cyan,
        600,
      ],
    ]);
    hint.sprite.visible = true;
  }

  // --- Public: carrying and placing -----------------------------------------
  function liftCard(index, pointer) {
    const slot = cards[index];
    if (!slot?.intervention || state.carrying) return false;
    const item = slot.intervention;

    // Pinching a card whose measure is already down takes it back off the map.
    if (chosenFor(state.zoneId).includes(item.id)) {
      removePlaced(state.zoneId, item.id);
      return true;
    }

    ghost = createSolution(item, { ghost: true });
    city.root.add(ghost.root);
    state.carrying = { item, pointer, valid: false };
    dropBeam.visible = true;
    audio?.ping();
    refreshCards();
    return true;
  }

  /** Lift by intervention id — the entry point the flat UI uses. */
  function liftById(id, pointer) {
    const index = (state.details[state.zoneId]?.interventions || []).findIndex(
      (i) => i.id === id,
    );
    return index >= 0 ? liftCard(index, pointer) : false;
  }

  /** Commit whatever is being carried, if it is over its own zone. */
  function drop() {
    if (!state.carrying) return;
    const { item, valid } = state.carrying;
    const position = ghost.root.position.clone();
    ghost.dispose();
    ghost.root.removeFromParent();
    ghost = null;
    dropBeam.visible = false;
    state.carrying = null;

    if (!valid) {
      refreshCards();
      return;
    }

    commit(item, position);
  }

  /** Place a measure at the centre of its zone, or take it away again. */
  function toggleAtCentre(interventionId) {
    const zone = zoneById(state.zoneId);
    if (!zone) return;
    if (chosenFor(state.zoneId).includes(interventionId)) {
      removePlaced(state.zoneId, interventionId);
      return;
    }
    const item = (state.details[state.zoneId]?.interventions || []).find(
      (i) => i.id === interventionId,
    );
    if (!item) return;
    const [x, z] = project(zone.center);
    commit(item, new THREE.Vector3(x, 0.02, z));
  }

  /** Materialise a measure at a point in city-local space. */
  function commit(item, position) {
    const solution = createSolution(item);
    solution.root.position.copy(position);
    solution.land();
    city.root.add(solution.root);
    if (!state.placed.has(state.zoneId)) state.placed.set(state.zoneId, new Map());
    state.placed.get(state.zoneId).set(item.id, solution);
    solution.root.traverse((o) => {
      o.userData.placed = { zoneId: state.zoneId, interventionId: item.id };
    });

    const set = new Set(chosenFor(state.zoneId));
    set.add(item.id);
    state.chosen[state.zoneId] = [...set];
    state.before = false;

    city.root.localToWorld(tmp.copy(position));
    commitPulse.mesh.position.copy(tmp);
    commitPulse.mesh.visible = true;
    commitPulse.fire();

    audio?.ping();
    refreshCards();
    onChange?.(state.zoneId);
  }

  function removePlaced(zoneId, interventionId) {
    const solution = state.placed.get(zoneId)?.get(interventionId);
    if (solution) {
      solution.dispose();
      solution.root.removeFromParent();
      state.placed.get(zoneId).delete(interventionId);
    }
    state.chosen[zoneId] = chosenFor(zoneId).filter((i) => i !== interventionId);
    state.before = false;
    audio?.ping();
    refreshCards();
    onChange?.(state.zoneId);
  }

  function reset(zoneId = state.zoneId) {
    for (const id of chosenFor(zoneId)) removePlaced(zoneId, id);
  }

  function resetAll() {
    for (const id of Array.from(state.placed.keys())) reset(id);
    state.chosen = {};
    refreshCards();
    onChange?.(state.zoneId);
  }

  /**
   * Route a press. Returns true when the game consumed it, so the caller does
   * not also treat it as a grab of the city itself.
   */
  function press(hit, pointer) {
    if (state.carrying) {
      drop();
      return true;
    }
    if (!hit) return false;
    const data = hit.object.userData;
    if (data.card !== undefined) return liftCard(data.card, pointer);
    if (data.placed) {
      removePlaced(data.placed.zoneId, data.placed.interventionId);
      return true;
    }
    if (data.zoneId) {
      select(data.zoneId);
      return true;
    }
    return false;
  }

  /** Release of the press that lifted a measure also commits it. */
  function release() {
    if (state.carrying) drop();
  }

  // --- Per-frame ------------------------------------------------------------
  const cardTarget = new THREE.Vector3();

  function update(dt, time, camera, groundHit) {
    selectRing.spin(dt);
    commitPulse.update(dt);

    const zone = zoneById(state.zoneId);
    if (zone) {
      const [minX, maxX, minZ, maxZ] = zoneBox(zone);
      city.root.localToWorld(
        cardTarget.set((minX + maxX) / 2, 0.1, (minZ + maxZ) / 2),
      );
      const lift = CARD_LIFT;
      camera.getWorldPosition(tmp);

      // Cards fan out across the viewer's line of sight, not the world axes,
      // so they are always readable from where the player happens to stand.
      tmpB.copy(tmp).sub(cardTarget);
      tmpB.y = 0;
      tmpB.normalize();
      const right = new THREE.Vector3(-tmpB.z, 0, tmpB.x);

      cards.forEach((slot, i) => {
        if (!slot.card.visible) return;
        const offset = (i - 1) * (CARD_W + 0.05);
        slot.card.position
          .copy(cardTarget)
          .addScaledVector(right, offset)
          .addScaledVector(tmpB, 0.06);
        slot.card.position.y = cardTarget.y + lift + Math.sin(time * 1.2 + i) * 0.006;
        slot.card.lookAt(tmp);
        slot.icon.rotation.y += dt * 0.8;
      });

      readout.sprite.position
        .copy(cardTarget)
        .addScaledVector(tmpB, 0.02)
        .setY(cardTarget.y + lift + CARD_H * 0.9);
      hint.sprite.position
        .copy(cardTarget)
        .addScaledVector(tmpB, 0.02)
        .setY(cardTarget.y + lift - CARD_H * 0.72);
    }

    // Carry: the measure slides along the map under the pointer, so you can
    // see the ground it would cover before letting go.
    if (state.carrying && ghost) {
      if (groundHit && zone) {
        city.root.worldToLocal(tmp.copy(groundHit.point));
        const [x, z] = clampToZone(zone, tmp.x, tmp.z);
        // Eased rather than snapped, so the pull towards the zone is legible
        // as a magnet instead of looking like a broken cursor.
        ghost.root.position.x += (x - ghost.root.position.x) * 0.35;
        ghost.root.position.z += (z - ghost.root.position.z) * 0.35;
        ghost.root.position.y = 0.02;
        state.carrying.valid = true;
        ghost.setValid(true);

        const tip = state.carrying.pointer;
        if (tip?.grip) {
          tip.grip.getWorldPosition(tmpB);
          city.root.localToWorld(tmp.copy(ghost.root.position));
          const length = tmpB.distanceTo(tmp);
          dropBeam.visible = length > 0.02;
          dropBeam.position.copy(tmpB).add(tmp).multiplyScalar(0.5);
          dropBeam.scale.set(1, length, 1);
          dropBeam.lookAt(tmp);
          dropBeam.rotateX(Math.PI / 2);
        }
      } else {
        state.carrying.valid = false;
        ghost.setValid(false);
      }
      ghost.update(dt, time);
    }

    for (const perZone of state.placed.values())
      for (const solution of perZone.values()) solution.update(dt, time);
  }

  return {
    group,
    state,
    select,
    toggleAtCentre,
    liftById,
    press,
    release,
    reset,
    resetAll,
    chosenFor,
    resultFor,
    setDetails(details) {
      state.details = details || {};
      refreshCards();
    },
    setBefore(before) {
      state.before = before;
      for (const perZone of state.placed.values())
        for (const solution of perZone.values())
          solution.root.visible = !before;
      refreshCards();
    },
    /** Everything a pointer may hit that belongs to the game. */
    targets() {
      const list = cards.filter((c) => c.card.visible).map((c) => c.plate);
      for (const perZone of state.placed.values())
        for (const solution of perZone.values()) list.push(...solution.root.children);
      return list;
    },
    /** Cards a fingertip may press directly. */
    pokeTargets() {
      return cards.filter((c) => c.card.visible).map((c) => c.plate);
    },
    isCarrying() {
      return !!state.carrying;
    },
    update,
    dispose() {
      cards.forEach((slot) => {
        slot.text.dispose();
        slot.plate.geometry.dispose();
        slot.plate.material.dispose();
        slot.edge.geometry.dispose();
        slot.edge.material.dispose();
      });
      readout.dispose();
      hint.dispose();
      selectRing.dispose();
      selectBrackets?.dispose();
      commitPulse.dispose();
      ghost?.dispose();
      for (const perZone of state.placed.values())
        for (const solution of perZone.values()) solution.dispose();
      dropBeam.geometry.dispose();
      dropBeam.material.dispose();
    },
  };
}
