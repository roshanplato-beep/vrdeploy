import * as THREE from "three";
import { HOLO, glow, wire, label, reticle, brackets, pulseRing } from "./holo";
import { CATEGORY, buildBody, createSolution } from "./solutions";
import { impactPlacements, money, project, buildableAreaSqm, maxCountFor, footprintSqm } from "./model";

/**
 * The loop: pick a zone, place as many of its three measures as the zone's
 * own land can hold, watch the zone respond.
 *
 * Nothing here artificially limits you to one of each measure — a real city
 * can build more than one pocket park. What limits you is the same thing
 * that limits a real planning department: land. Every zone's buildable area
 * is computed from its own building-density and road-coverage figures (the
 * dataset's own numbers, not invented ones), and each measure has a real
 * footprint (`estimated_area_sqm`) from the same dataset. Once the zone's
 * buildable land is spoken for, a card refuses to lift another instance —
 * clearly, not silently — rather than pretending there's always room.
 *
 * Where you drop a measure also matters. Each zone carries a real hotspot —
 * the area-weighted centroid of its own mapped building footprints, i.e.
 * where the built mass (and so the heat retention) actually concentrates.
 * A measure placed near it counts at full strength; one placed in a quiet
 * corner of the zone counts for less. That's the "optimal placement" the
 * game rewards, and it's read off the same building data the rest of the
 * project uses, not a hidden game-only value.
 */

const CARD_W = 0.26;
const CARD_H = 0.32;
const CARD_LIFT = 0.34;

export function createGame({ scene, city, zones, audio, baseline, onChange, onRefused }) {
  const group = new THREE.Group();
  scene.add(group);

  const cardGroup = new THREE.Group();
  cardGroup.visible = false;
  group.add(cardGroup);

  const state = {
    zoneId: null,
    details: {},
    placed: new Map(), // zoneId -> Array<{ uid, interventionId, solution, effectiveness }>
    carrying: null,
    before: false,
  };
  let uidCounter = 1;
  const capacityCache = new Map(); // zoneId -> buildableAreaSqm

  // --- Selection frame on the map -----------------------------------------
  const frame = new THREE.Group();
  frame.visible = false;
  city.root.add(frame);
  const selectRing = reticle(1.6, HOLO.cyan, 36);
  frame.add(selectRing.group);
  let selectBrackets = null;

  // --- Readout above the zone ---------------------------------------------
  const readout = label(640, 360, 0.17);
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
    edgeGeometry.setAttribute("position", new THREE.Float32BufferAttribute(edgePoints, 3));
    const edge = new THREE.LineSegments(edgeGeometry, wire(HOLO.cyan, 0.85));
    card.add(edge);

    const text = label(512, 400, CARD_H * 0.9);
    text.sprite.position.set(0, -CARD_H * 0.1, 0.004);
    card.add(text.sprite);

    const icon = new THREE.Group();
    icon.position.set(0, CARD_H * 0.34, 0.02);
    icon.scale.setScalar(0.14);
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

  const refusedFlash = pulseRing(0.5, HOLO.hot);
  refusedFlash.mesh.visible = false;
  group.add(refusedFlash.mesh);

  const tmp = new THREE.Vector3(),
    tmpB = new THREE.Vector3();

  function zoneById(id) {
    return zones.find((z) => z.id === id) || null;
  }

  function buildableFor(zoneId) {
    if (!capacityCache.has(zoneId)) {
      const zone = zoneById(zoneId);
      capacityCache.set(zoneId, zone ? buildableAreaSqm(zone) : 0);
    }
    return capacityCache.get(zoneId);
  }

  function placementsFor(id) {
    return state.placed.get(id) || [];
  }

  /** Total footprint already committed in this zone, across every category. */
  function usedAreaFor(id) {
    const list = state.details[id]?.interventions || [];
    const byId = new Map(list.map((i) => [i.id, i]));
    return placementsFor(id).reduce((s, p) => {
      const item = byId.get(p.interventionId);
      return s + (item ? footprintSqm(item).sqm : 0);
    }, 0);
  }

  /** How much more land this zone has to give, in m². */
  function remainingAreaFor(id) {
    return Math.max(0, buildableFor(id) - usedAreaFor(id));
  }

  function countPlaced(id, interventionId) {
    return placementsFor(id).filter((p) => p.interventionId === interventionId).length;
  }

  /** How many *more* of this one measure could still fit, given what's already down. */
  function roomFor(id, item) {
    return maxCountFor(item, remainingAreaFor(id));
  }

  function chosenFor(id) {
    return placementsFor(id).map((p) => p.interventionId);
  }

  function resultFor(id) {
    const zone = zoneById(id);
    const list = state.details[id]?.interventions || [];
    return impactPlacements(
      list,
      placementsFor(id).map((p) => ({ interventionId: p.interventionId, effectiveness: p.effectiveness })),
      { baselineC: baseline?.value_c, lstC: zone?.lst_celsius },
    );
  }

  /** The ceiling: what a single one of each measure would achieve — the same reference figure the original build used. */
  function ceilingFor(id) {
    const list = state.details[id]?.interventions || [];
    const zone = zoneById(id);
    return impactPlacements(
      list,
      list.map((i) => ({ interventionId: i.id, effectiveness: 1 })),
      { baselineC: baseline?.value_c, lstC: zone?.lst_celsius },
    );
  }

  function capacityFor(id) {
    const buildableSqm = buildableFor(id);
    const usedSqm = usedAreaFor(id);
    return {
      buildableSqm,
      usedSqm,
      remainingSqm: Math.max(0, buildableSqm - usedSqm),
      pct: buildableSqm > 0 ? Math.min(1, usedSqm / buildableSqm) : 1,
    };
  }

  function zoneBox(zone) {
    const a = project(zone.bounds[0]),
      b = project(zone.bounds[1]);
    return [Math.min(a[0], b[0]), Math.max(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[1], b[1])];
  }

  function clampToZone(zone, x, z) {
    const [minX, maxX, minZ, maxZ] = zoneBox(zone);
    const inset = Math.min(0.3, (maxX - minX) * 0.15, (maxZ - minZ) * 0.15);
    return [
      Math.min(Math.max(x, minX + inset), maxX - inset),
      Math.min(Math.max(z, minZ + inset), maxZ - inset),
    ];
  }

  /**
   * How well a spot works: 1.0 exactly on the zone's real building-density
   * hotspot, fading to 0.5 at the zone's far edge. Grounded in the same
   * mapped-footprint data the tabletop itself is built from.
   */
  function effectivenessAt(zone, x, z) {
    const hotspot = city.hotspotFor?.(zone.id);
    if (!hotspot) return 0.85;
    const [minX, maxX, minZ, maxZ] = zoneBox(zone);
    const radius = Math.max(0.05, Math.hypot(maxX - minX, maxZ - minZ) / 2);
    const distance = Math.hypot(x - hotspot[0], z - hotspot[1]);
    return THREE.MathUtils.clamp(1 - 0.5 * (distance / radius), 0.5, 1);
  }

  function refuse(reasonText) {
    audio?.ping();
    hint.write([[reasonText, 28, HOLO.hot, 700]]);
    hint.sprite.visible = true;
    const zone = zoneById(state.zoneId);
    if (zone) {
      const [x, z] = project(zone.center);
      city.root.localToWorld(tmp.set(x, 0.15, z));
      refusedFlash.mesh.position.copy(tmp);
      refusedFlash.mesh.visible = true;
      refusedFlash.fire();
    }
    onRefused?.(reasonText);
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
      if (!item || !zone) return;

      const category = CATEGORY[item.category] || CATEGORY.green;
      const count = countPlaced(state.zoneId, item.id);
      const room = roomFor(state.zoneId, item);
      const full = room <= 0;

      slot.plate.userData.interventionId = item.id;
      slot.plate.material.color.set(count > 0 ? category.color : HOLO.cyan);
      slot.plate.material.opacity = count > 0 ? 0.26 : 0.14;
      slot.edge.material.color.set(full ? HOLO.hot : count > 0 ? category.color : HOLO.cyan);

      const statusLine = full
        ? "NO ROOM LEFT IN ZONE"
        : count > 0
          ? `${count} placed · pinch for another`
          : "PINCH TO LIFT";
      const footprint = footprintSqm(item);
      const areaLabel = `${Math.round(footprint.sqm).toLocaleString()} m² each${footprint.source === "estimated" ? " (estimated)" : ""} · room for ${room} more`;

      slot.text.write([
        [category.label, 25, category.color, 700],
        [item.name, 32, HOLO.white, 650],
        [`−${(item.local_reference_drop_c ?? 0).toFixed(1)}°C local · ${money(item.estimated_cost_inr)} each`, 22, HOLO.amber, 650],
        [areaLabel, 19, "#8fb6c2", 500],
        [`${item.effect_radius_m} m radius`, 20, "#8fb6c2", 500],
        [statusLine, 23, full ? HOLO.hot : category.color, 700],
        [count > 0 ? "Pinch a placed one on the map to remove it" : "", 17, "#7fa4b0", 500],
      ]);

      if (!slot.iconBody) {
        slot.iconBody = buildBody(item.category, category.color);
        slot.icon.add(slot.iconBody);
      }
      slot.icon.visible = true;
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
    const r = state.before ? { drop: 0, total: 0, count: 0 } : resultFor(state.zoneId);
    const available = ceilingFor(state.zoneId).drop;
    const cap = capacityFor(state.zoneId);
    const share = available > 0 ? Math.min(1, r.drop / available) : 0;
    const bars = 20;
    const filled = Math.round(share * bars);
    const landBars = 14;
    const landFilled = Math.round(cap.pct * landBars);

    readout.write([
      [zone.name, 42, HOLO.white, 700],
      [`${(zone.lst_celsius - r.drop).toFixed(2)}°C`, 70, HOLO.amber, 700],
      [`−${r.drop.toFixed(2)}°C · ${r.count} measure${r.count === 1 ? "" : "s"} placed`, 26, HOLO.cyan, 600],
      ["█".repeat(filled) + "░".repeat(bars - filled), 24, HOLO.cyan, 500],
      [`Land used: ${(cap.pct * 100).toFixed(0)}% of ${Math.round(cap.buildableSqm).toLocaleString()} m² buildable`, 22, "#8fb6c2", 500],
      ["▓".repeat(landFilled) + "░".repeat(landBars - landFilled), 22, HOLO.amber, 500],
      [r.total ? `${money(r.total)} committed` : "no measures placed", 26, HOLO.white, 500],
    ]);
    readout.sprite.visible = true;

    hint.write([
      [
        state.carrying
          ? "Release near the gold ring for full effect"
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

    if (roomFor(state.zoneId, item) <= 0) {
      const zone = zoneById(state.zoneId);
      refuse(`No room left in ${zone?.name || "this zone"}'s buildable land`);
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

  function liftById(id, pointer) {
    const index = (state.details[state.zoneId]?.interventions || []).findIndex((i) => i.id === id);
    return index >= 0 ? liftCard(index, pointer) : false;
  }

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
    if (roomFor(state.zoneId, item) <= 0) {
      const zone = zoneById(state.zoneId);
      refuse(`No room left in ${zone?.name || "this zone"}'s buildable land`);
      return;
    }
    commit(item, position);
  }

  /** Desktop convenience: click removes the most recent instance, or places one at the zone's hotspot if none are down. */
  function toggleAtCentre(interventionId) {
    const zone = zoneById(state.zoneId);
    if (!zone) return;
    const placements = placementsFor(state.zoneId);
    const last = [...placements].reverse().find((p) => p.interventionId === interventionId);
    if (last) {
      removePlaced(state.zoneId, last.uid);
      return;
    }
    const item = (state.details[state.zoneId]?.interventions || []).find((i) => i.id === interventionId);
    if (!item) return;
    if (roomFor(state.zoneId, item) <= 0) {
      refuse(`No room left in ${zone.name}'s buildable land`);
      return;
    }
    const hotspot = city.hotspotFor?.(zone.id) || project(zone.center);
    commit(item, new THREE.Vector3(hotspot[0], 0.02, hotspot[1]));
  }

  function commit(item, position) {
    const zone = zoneById(state.zoneId);
    const effectiveness = effectivenessAt(zone, position.x, position.z);
    const solution = createSolution(item);
    solution.root.position.copy(position);
    solution.land();
    city.root.add(solution.root);

    const uid = uidCounter++;
    if (!state.placed.has(state.zoneId)) state.placed.set(state.zoneId, []);
    state.placed.get(state.zoneId).push({ uid, interventionId: item.id, solution, effectiveness });
    solution.root.traverse((o) => {
      o.userData.placed = { zoneId: state.zoneId, uid };
    });
    // A placement near the zone's real hotspot keeps its category colour; a
    // weak one (dropped far from where the built mass actually is) lands
    // tinted toward amber, so the "optimal spot" reward is legible the
    // instant you let go, not buried in a readout you have to go read.
    solution.setValid(effectiveness > 0.75);

    state.before = false;

    city.root.localToWorld(tmp.copy(position));
    commitPulse.mesh.position.copy(tmp);
    commitPulse.mesh.scale.setScalar(0.6 + effectiveness * 0.6);
    commitPulse.mesh.visible = true;
    commitPulse.fire();

    audio?.ping();
    refreshCards();
    onChange?.(state.zoneId);
  }

  function removePlaced(zoneId, uid) {
    const list = state.placed.get(zoneId);
    const index = list?.findIndex((p) => p.uid === uid) ?? -1;
    if (index >= 0) {
      const [entry] = list.splice(index, 1);
      entry.solution.dispose();
      entry.solution.root.removeFromParent();
    }
    state.before = false;
    audio?.ping();
    refreshCards();
    onChange?.(zoneId);
  }

  function reset(zoneId = state.zoneId) {
    for (const p of [...placementsFor(zoneId)]) removePlaced(zoneId, p.uid);
  }

  function resetAll() {
    for (const id of Array.from(state.placed.keys())) reset(id);
    refreshCards();
    onChange?.(state.zoneId);
  }

  function press(hit, pointer) {
    if (state.carrying) {
      drop();
      return true;
    }
    if (!hit) return false;
    const data = hit.object.userData;
    if (data.card !== undefined) return liftCard(data.card, pointer);
    if (data.placed) {
      removePlaced(data.placed.zoneId, data.placed.uid);
      return true;
    }
    if (data.zoneId) {
      select(data.zoneId);
      return true;
    }
    return false;
  }

  function release() {
    if (state.carrying) drop();
  }

  // --- Per-frame ------------------------------------------------------------
  const cardTarget = new THREE.Vector3();

  function update(dt, time, camera, groundHit) {
    selectRing.spin(dt);
    commitPulse.update(dt);
    refusedFlash.update(dt);

    const zone = zoneById(state.zoneId);
    if (zone) {
      const [minX, maxX, minZ, maxZ] = zoneBox(zone);
      city.root.localToWorld(cardTarget.set((minX + maxX) / 2, 0.1, (minZ + maxZ) / 2));
      const lift = CARD_LIFT;
      camera.getWorldPosition(tmp);

      tmpB.copy(tmp).sub(cardTarget);
      tmpB.y = 0;
      tmpB.normalize();
      const right = new THREE.Vector3(-tmpB.z, 0, tmpB.x);

      cards.forEach((slot, i) => {
        if (!slot.card.visible) return;
        const offset = (i - 1) * (CARD_W + 0.05);
        slot.card.position.copy(cardTarget).addScaledVector(right, offset).addScaledVector(tmpB, 0.06);
        slot.card.position.y = cardTarget.y + lift + Math.sin(time * 1.2 + i) * 0.006;
        slot.card.lookAt(tmp);
        slot.icon.rotation.y += dt * 0.8;
      });

      readout.sprite.position.copy(cardTarget).addScaledVector(tmpB, 0.02).setY(cardTarget.y + lift + CARD_H * 0.95);
      hint.sprite.position.copy(cardTarget).addScaledVector(tmpB, 0.02).setY(cardTarget.y + lift - CARD_H * 0.78);
    }

    if (state.carrying && ghost) {
      if (groundHit && zone) {
        city.root.worldToLocal(tmp.copy(groundHit.point));
        const [x, z] = clampToZone(zone, tmp.x, tmp.z);
        ghost.root.position.x += (x - ghost.root.position.x) * 0.35;
        ghost.root.position.z += (z - ghost.root.position.z) * 0.35;
        ghost.root.position.y = 0.02;
        state.carrying.valid = true;
        // Preview the effectiveness at the ghost's current spot: full colour
        // near the hotspot, a duller tint further away, so the player can see
        // the "optimal placement" reward before committing to it.
        const eff = effectivenessAt(zone, ghost.root.position.x, ghost.root.position.z);
        ghost.setValid(eff > 0.75);

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
      for (const p of perZone) p.solution.update(dt, time);
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
    ceilingFor,
    capacityFor,
    roomFor,
    countPlaced,
    setDetails(details) {
      state.details = details || {};
      capacityCache.clear();
      refreshCards();
    },
    setBefore(before) {
      state.before = before;
      for (const perZone of state.placed.values())
        for (const p of perZone) p.solution.root.visible = !before;
      refreshCards();
    },
    targets() {
      const list = cards.filter((c) => c.card.visible).map((c) => c.plate);
      for (const perZone of state.placed.values())
        for (const p of perZone) list.push(...p.solution.root.children);
      return list;
    },
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
      refusedFlash.dispose();
      ghost?.dispose();
      for (const perZone of state.placed.values())
        for (const p of perZone) p.solution.dispose();
      dropBeam.geometry.dispose();
      dropBeam.material.dispose();
    },
  };
}
