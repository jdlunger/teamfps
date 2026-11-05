// Placeholder character built from primitives. Faces -Z; feet at the origin.
import * as THREE from 'three';

export function createCharacter(teamHex = 0x3f7fe0) {
  const group = new THREE.Group();
  const team = new THREE.MeshLambertMaterial({ color: teamHex });
  const dark = new THREE.MeshLambertMaterial({ color: 0x2a2f38 });
  const visor = new THREE.MeshLambertMaterial({ color: 0xbff4ff, emissive: 0x2a7f90 });

  const add = (parent, geometry, material, x, y, z) => {
    const m = new THREE.Mesh(geometry, material);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };

  add(group, new THREE.BoxGeometry(0.56, 0.68, 0.32), team, 0, 1.1, 0);        // torso
  add(group, new THREE.BoxGeometry(0.38, 0.5, 0.18), dark, 0, 1.14, 0.25);     // backpack
  add(group, new THREE.BoxGeometry(0.32, 0.32, 0.32), dark, 0, 1.62, 0);       // head
  add(group, new THREE.BoxGeometry(0.26, 0.1, 0.05), visor, 0, 1.65, -0.17);   // visor

  // Limbs pivot from the hip and shoulder, so the meshes hang below their group.
  const limb = (x, pivotY, length, width, material) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, pivotY, 0);
    add(pivot, new THREE.BoxGeometry(width, length, width), material, 0, -length / 2, 0);
    group.add(pivot);
    return pivot;
  };
  const legL = limb(-0.15, 0.78, 0.78, 0.2, dark);
  const legR = limb(0.15, 0.78, 0.78, 0.2, dark);
  const armL = limb(-0.37, 1.42, 0.66, 0.15, team);
  const armR = limb(0.37, 1.42, 0.66, 0.15, team);

  let phase = 0;

  // speed is horizontal m/s.
  group.userData.animate = (dt, speed, grounded) => {
    let swing;
    if (grounded) {
      phase += speed * dt * 1.5;
      swing = Math.sin(phase) * Math.min(1, speed / 7) * 0.8;
    } else {
      swing = 0.45; // fixed mid-stride pose in the air
    }
    legL.rotation.x = swing;
    legR.rotation.x = -swing;
    armL.rotation.x = -swing * 0.8;
    armR.rotation.x = swing * 0.8;
  };

  return group;
}
