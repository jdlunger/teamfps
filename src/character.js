// Character models built from primitives. Each faces -Z with its feet at the
// origin. userData.animate(dt, player, combat) poses the model from simulation state.
import * as THREE from 'three';

const lambert = (color, extra) => new THREE.MeshLambertMaterial({ color, ...extra });

function add(parent, geometry, material, x, y, z) {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}

// Limbs pivot from the hip and shoulder, so the meshes hang below their group.
function limb(parent, x, pivotY, length, width, material) {
  const pivot = new THREE.Group();
  pivot.position.set(x, pivotY, 0);
  add(pivot, new THREE.BoxGeometry(width, length, width), material, 0, -length / 2, 0);
  parent.add(pivot);
  return pivot;
}

// Returns a function advancing the walk cycle: leg swing in radians.
function createGait() {
  let phase = 0;
  return (dt, p) => {
    if (!p.grounded) return 0.45; // fixed mid-stride pose in the air
    const speed = Math.hypot(p.vx, p.vz);
    phase += speed * dt * 1.5;
    return Math.sin(phase) * Math.min(1, speed / 7) * 0.8;
  };
}

function createRecruit(group, teamHex) {
  const team = lambert(teamHex);
  const dark = lambert(0x2a2f38);
  const visor = lambert(0xbff4ff, { emissive: 0x2a7f90 });

  add(group, new THREE.BoxGeometry(0.56, 0.68, 0.32), team, 0, 1.1, 0);        // torso
  add(group, new THREE.BoxGeometry(0.38, 0.5, 0.18), dark, 0, 1.14, 0.25);     // backpack
  add(group, new THREE.BoxGeometry(0.32, 0.32, 0.32), dark, 0, 1.62, 0);       // head
  add(group, new THREE.BoxGeometry(0.26, 0.1, 0.05), visor, 0, 1.65, -0.17);   // visor

  const legL = limb(group, -0.15, 0.78, 0.78, 0.2, dark);
  const legR = limb(group, 0.15, 0.78, 0.78, 0.2, dark);
  const armL = limb(group, -0.37, 1.42, 0.66, 0.15, team);
  const armR = limb(group, 0.37, 1.42, 0.66, 0.15, team);
  const gait = createGait();

  return (dt, p) => {
    const swing = gait(dt, p);
    legL.rotation.x = swing;
    legR.rotation.x = -swing;
    armL.rotation.x = -swing * 0.8;
    armR.rotation.x = swing * 0.8;
  };
}

function createShade(group, teamHex, kit) {
  const body = new THREE.Group();
  group.add(body);
  const cloth = lambert(0x20222e);
  const wrap = lambert(0x2f3242);
  const team = lambert(teamHex);
  const skin = lambert(0xc99a78);
  const steel = lambert(0xdfe7ee, { emissive: 0x39454f });

  add(body, new THREE.BoxGeometry(0.44, 0.62, 0.26), cloth, 0, 1.04, 0);        // torso
  add(body, new THREE.BoxGeometry(0.46, 0.09, 0.28), team, 0, 0.8, 0);          // sash
  add(body, new THREE.BoxGeometry(0.28, 0.3, 0.28), wrap, 0, 1.52, 0);          // head wrap
  add(body, new THREE.BoxGeometry(0.22, 0.06, 0.03), skin, 0, 1.56, -0.145);    // eye slit
  add(body, new THREE.BoxGeometry(0.3, 0.05, 0.3), team, 0, 1.63, 0);           // headband

  // Scarf tails stream out behind, further the faster the character moves.
  const scarf = new THREE.Group();
  scarf.position.set(0, 1.32, 0.14);
  add(scarf, new THREE.BoxGeometry(0.1, 0.03, 0.75), team, -0.07, 0, 0.37);
  add(scarf, new THREE.BoxGeometry(0.1, 0.03, 0.55), team, 0.07, -0.03, 0.27);
  body.add(scarf);

  const legL = limb(body, -0.13, 0.74, 0.74, 0.17, cloth);
  const legR = limb(body, 0.13, 0.74, 0.74, 0.17, cloth);
  const armL = limb(body, -0.3, 1.32, 0.62, 0.13, wrap);
  const armR = limb(body, 0.3, 1.32, 0.62, 0.13, wrap);
  armR.rotation.order = 'YXZ'; // so a slash sweeps around the character's vertical axis

  const sword = new THREE.Group();
  sword.position.set(0, -0.62, 0);
  add(sword, new THREE.BoxGeometry(0.035, 0.07, 1.05), steel, 0, 0, -0.62);     // blade
  add(sword, new THREE.BoxGeometry(0.14, 0.14, 0.03), team, 0, 0, -0.09);       // guard
  add(sword, new THREE.BoxGeometry(0.04, 0.04, 0.22), cloth, 0, 0, 0.02);       // grip
  armR.add(sword);

  // Short-lived arc showing the slash's actual reach and width.
  const { arc, range } = kit.weapon;
  const trailGeometry = new THREE.RingGeometry(0.55, range, 24, 1, Math.PI / 2 - arc / 2, arc);
  trailGeometry.rotateX(-Math.PI / 2);
  const trail = new THREE.Mesh(trailGeometry, new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, side: THREE.DoubleSide, depthWrite: false,
  }));
  trail.position.y = 1.15;
  trail.visible = false;
  group.add(trail);

  const SWING_TIME = 0.22;
  const SWORD_SWING = -0.9;  // blade reaches forward from the arm
  const SWORD_READY = -0.1;  // blade held up, so it shows over the shoulder from behind
  const gait = createGait();

  return (dt, p, combat) => {
    const swing = gait(dt, p);
    const dashing = p.dashTime > 0;
    const speed = Math.hypot(p.vx, p.vz);
    body.rotation.x += ((dashing ? -0.7 : 0) - body.rotation.x) * (1 - Math.exp(-18 * dt));
    scarf.rotation.x = Math.max(-0.1, 0.75 - speed * 0.075) + Math.sin(performance.now() * 0.012) * 0.06;

    legL.rotation.x = swing;
    legR.rotation.x = -swing;
    armL.rotation.x = dashing ? -1 : -swing * 0.8;

    const t = combat.swingElapsed / SWING_TIME;
    if (t < 1) {
      const eased = 1 - (1 - t) * (1 - t);
      armR.rotation.set(1.4, combat.swingSide * (1.3 - 2.6 * eased), 0);
      sword.rotation.x = SWORD_SWING;
      trail.visible = true;
      trail.rotation.z = combat.swingSide * 0.18;
      trail.material.opacity = 0.6 * (1 - t);
    } else {
      armR.rotation.set(dashing ? -0.9 : 1.05, 0, 0);
      sword.rotation.x = dashing ? SWORD_SWING : SWORD_READY;
      trail.visible = false;
    }
  };
}

// Steel with a band of team-coloured hazard stripes and rows of rivets, so the
// rolling is easy to read. The band goes round the sphere's equator.
function createBallTexture(teamHex) {
  const w = 512, h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const g = canvas.getContext('2d');
  g.fillStyle = '#6a7079';
  g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(0,0,0,0.28)';
  for (let x = 0; x < w; x += w / 8) g.fillRect(x, 0, 3, h);       // plate seams
  g.fillRect(0, h * 0.2, w, 3);
  g.fillRect(0, h * 0.8, w, 3);

  g.fillStyle = `#${teamHex.toString(16).padStart(6, '0')}`;
  g.fillRect(0, h * 0.38, w, h * 0.24);
  g.fillStyle = '#1b1d22';
  for (let x = -40; x < w; x += 40) {
    g.beginPath();
    g.moveTo(x, h * 0.62);
    g.lineTo(x + 20, h * 0.62);
    g.lineTo(x + 50, h * 0.38);
    g.lineTo(x + 30, h * 0.38);
    g.fill();
  }

  for (const y of [h * 0.29, h * 0.71]) {
    for (let x = w / 32; x < w; x += w / 16) {
      g.fillStyle = 'rgba(255,255,255,0.45)';
      g.beginPath();
      g.arc(x, y, 5, 0, Math.PI * 2);
      g.fill();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

function createTonne(group, teamHex, kit) {
  const radius = kit.tuning.radius;
  const shell = new THREE.Group();
  shell.position.y = radius;
  add(shell, new THREE.SphereGeometry(radius, 32, 20), lambert(0xffffff, { map: createBallTexture(teamHex) }), 0, 0, 0);
  group.add(shell);

  // The cab stays upright while the shell rolls beneath it.
  const metal = lambert(0x363a42);
  const cab = new THREE.Group();
  cab.position.y = radius * 1.92;
  const dome = add(cab, new THREE.SphereGeometry(0.3, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), metal, 0, 0, 0);
  dome.scale.y = 0.75;
  add(cab, new THREE.SphereGeometry(0.075, 10, 8), lambert(0xffc36a, { emissive: 0xd9711c }), 0, 0.1, -0.25); // eye
  add(cab, new THREE.BoxGeometry(0.1, 0.1, 0.42), lambert(teamHex), 0.2, 0.06, -0.08);                        // hook launcher
  group.add(cab);

  // Rolling happens in world space, then the model's own yaw is cancelled out, so
  // the shell turns with its direction of travel rather than with the camera.
  const roll = new THREE.Quaternion();
  const step = new THREE.Quaternion();
  const axis = new THREE.Vector3();
  const yawInverse = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);

  return (dt, p) => {
    const speed = Math.hypot(p.vx, p.vz);
    if (speed > 0.01) {
      axis.set(-p.vz, 0, p.vx).divideScalar(speed).negate();
      roll.premultiply(step.setFromAxisAngle(axis, (speed / radius) * dt)).normalize();
    }
    yawInverse.setFromAxisAngle(up, -group.rotation.y);
    shell.quaternion.copy(yawInverse).multiply(roll);
  };
}

function createSkylark(group, teamHex) {
  const team = lambert(teamHex);
  const suit = lambert(0xe9e4d6);
  const dark = lambert(0x2a2f38);
  const visor = lambert(0xffd98a, { emissive: 0x8a5a18 });

  add(group, new THREE.BoxGeometry(0.5, 0.66, 0.3), suit, 0, 1.1, 0);           // torso
  add(group, new THREE.BoxGeometry(0.52, 0.2, 0.32), team, 0, 1.3, 0);          // chest band
  add(group, new THREE.BoxGeometry(0.3, 0.3, 0.3), team, 0, 1.6, 0);            // helmet
  add(group, new THREE.BoxGeometry(0.25, 0.12, 0.05), visor, 0, 1.62, -0.16);   // visor

  const tanks = [-0.15, 0.15].map((x) =>
    add(group, new THREE.CylinderGeometry(0.11, 0.11, 0.62, 12), dark, x, 1.14, 0.26));
  const flameGeometry = new THREE.ConeGeometry(0.1, 0.7, 10);
  flameGeometry.rotateX(Math.PI); // tip pointing down
  const flameMaterial = new THREE.MeshBasicMaterial({ color: 0xffb347 });
  const flames = tanks.map((tank) => {
    const flame = new THREE.Mesh(flameGeometry, flameMaterial);
    flame.position.set(tank.position.x, 0.5, 0.26);
    flame.visible = false;
    group.add(flame);
    return flame;
  });

  const legL = limb(group, -0.14, 0.78, 0.78, 0.19, suit);
  const legR = limb(group, 0.14, 0.78, 0.78, 0.19, suit);
  const armL = limb(group, -0.34, 1.42, 0.64, 0.14, suit);
  const armR = limb(group, 0.34, 1.42, 0.64, 0.14, suit);

  // Lies along the arm, so raising the arm points the gun forward.
  add(armR, new THREE.BoxGeometry(0.09, 0.62, 0.14), dark, 0, -0.78, 0);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, -1.1, 0);
  armR.add(muzzle);
  group.userData.muzzle = muzzle;
  armR.rotation.x = Math.PI / 2;
  armL.rotation.x = 1.15;
  armL.rotation.z = -0.35;

  const gait = createGait();
  return (dt, p) => {
    const swing = gait(dt, p);
    legL.rotation.x = swing;
    legR.rotation.x = -swing;
    for (const flame of flames) {
      flame.visible = p.jetting;
      flame.scale.y = 0.8 + Math.random() * 0.5;
    }
  };
}

const builders = { recruit: createRecruit, shade: createShade, tonne: createTonne, skylark: createSkylark };

export function createCharacter(kit, teamHex = 0x3f7fe0) {
  const group = new THREE.Group();
  group.userData.animate = builders[kit.id](group, teamHex, kit);
  return group;
}

// Thin straight line between two points: the grapple rope and carbine tracers.
export function createBeam(radius, color) {
  const geometry = new THREE.CylinderGeometry(radius, radius, 1, 6);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color }));
  mesh.visible = false;
  mesh.frustumCulled = false;
  const up = new THREE.Vector3(0, 1, 0);
  const dir = new THREE.Vector3();
  mesh.userData.setEnds = (ax, ay, az, bx, by, bz) => {
    dir.set(bx - ax, by - ay, bz - az);
    const length = dir.length();
    mesh.scale.set(1, length, 1);
    mesh.position.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
    mesh.quaternion.setFromUnitVectors(up, dir.divideScalar(length || 1));
  };
  return mesh;
}

// The model for a wandering target: a recruit in the other team's colour with a
// health bar overhead. Topples while down, flashes when hit.
export function createTargetView(kit) {
  const view = new THREE.Group();
  view.rotation.order = 'YXZ';
  const model = createCharacter(kit, 0xe0703f);
  view.add(model);

  const materials = new Set();
  model.traverse((o) => { if (o.isMesh) materials.add(o.material); });
  const baseEmissive = new Map([...materials].map((m) => [m, m.emissive.getHex()]));

  const BAR_WIDTH = 0.9;
  const bar = (color, renderOrder) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ color, depthWrite: false, fog: false }));
    s.position.y = 2.15;
    s.scale.set(BAR_WIDTH, 0.09, 1);
    s.renderOrder = renderOrder;
    view.add(s);
    return s;
  };
  const back = bar(0x1b1d22, 1);
  const fill = bar(0xe8503a, 2);

  let flashing = false;
  view.userData.sync = (t, x, y, z, dt) => {
    view.position.set(x, y, z);
    view.rotation.y = t.body.yaw;
    model.userData.animate(dt, t.body);

    const down = t.downFor > 0;
    view.rotation.x += ((down ? -Math.PI / 2 : 0) - view.rotation.x) * (1 - Math.exp(-14 * dt));
    back.visible = fill.visible = !down && t.hp < t.maxHp;
    fill.scale.x = BAR_WIDTH * (t.hp / t.maxHp);

    const flash = t.flash > 0;
    if (flash !== flashing) {
      flashing = flash;
      for (const m of materials) m.emissive.setHex(flash ? 0x777777 : baseEmissive.get(m));
    }
  };
  return view;
}
