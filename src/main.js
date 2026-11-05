import * as THREE from 'three';
import { colliders, spawns, wanderSpots } from './level.js';
import { createPlayer, respawn, stepPlayer, raycast, TICK } from './physics.js';
import { createCombat, createWanderers, stepCombat, stepWanderers } from './combat.js';
import { buildWorld } from './world.js';
import { createBeam, createCharacter, createTargetView } from './character.js';
import { roster } from './roster.js';

const CAMERA_DEFAULTS = {
  distance: 4.2,
  eyeHeight: 1.55,
  shoulder: 0.6,
  wallMargin: 0.25,
  sensitivity: 0.0022,
  maxPitch: 1.35,
};
const TRACER_TIME = 0.05;
const HIT_MARKER_TIME = 0.12;

const overlay = document.getElementById('overlay');
const statsEl = document.getElementById('stats');
const crosshair = document.getElementById('crosshair');
const metersEl = document.getElementById('meters');
const controlsEl = document.getElementById('controls');
const changeBtn = document.getElementById('change');
const selectEl = document.getElementById('select');
const cardsEl = document.getElementById('cards');
const deployBtn = document.getElementById('deploy');

// --------------------------------------------------------------- renderer ---

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
} catch (err) {
  overlay.querySelector('h1').textContent = 'WebGL2 is unavailable';
  overlay.querySelector('p').textContent = 'This prototype needs a browser with WebGL2 and hardware acceleration enabled.';
  throw err;
}
const canvas = renderer.domElement;
document.body.prepend(canvas);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 500);
camera.rotation.order = 'YXZ';

buildWorld(scene, renderer, colliders);

const spawn = spawns.A;
const rope = createBeam(0.035, 0x23262c);
const tracer = createBeam(0.018, 0xfff0b0);
const hook = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 0), new THREE.MeshLambertMaterial({ color: 0x23262c }));
hook.visible = false;
scene.add(rope, tracer, hook);

const wanderers = createWanderers(wanderSpots);
const recruitKit = roster.find((k) => k.id === 'recruit');
const wandererViews = wanderers.map(() => {
  const view = createTargetView(recruitKit);
  scene.add(view);
  return view;
});

// Current character. Set by chooseCharacter.
let kit, player, combat, character, cam;
let mode = 'select'; // 'select' on the character screen, 'play' in the arena

// Camera state.
let pitch = -0.1;
let shoulderSide = 1;
let smoothFeetY = 0;
let cameraDist = CAMERA_DEFAULTS.distance;
let shoulderBlend = 1;
// The ray through the crosshair. The camera sits on this ray, behind the player;
// starting at the pivot stops it hitting anything between the camera and the player.
const aim = { x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: -1 };

// Starts at native resolution (capped at 1.5x). If the machine can't hold frame
// rate, drops in steps; it never steps back up, to avoid visible oscillation.
let pixelRatio = Math.min(window.devicePixelRatio, 1.5);

// ---------------------------------------------------------- select screen ---

const preview = new THREE.Scene();
preview.background = new THREE.Color(0x141b26);
preview.add(new THREE.HemisphereLight(0xdcecff, 0x4c4a48, 2.2));
const previewSun = new THREE.DirectionalLight(0xfff3df, 2.4);
previewSun.position.set(2, 4, 3);
preview.add(previewSun);
const plinth = new THREE.Mesh(
  new THREE.CylinderGeometry(1.25, 1.3, 0.14, 48),
  new THREE.MeshLambertMaterial({ color: 0x2c3646 }),
);
plinth.position.y = -0.07;
preview.add(plinth);
const previewCamera = new THREE.PerspectiveCamera(34, 1, 0.1, 50);

const previewModels = new Map();
const gameModels = new Map();
const previewPlayer = createPlayer(spawn);
let previewCombat = createCombat(recruitKit);
let previewYaw = -0.5;
let shownPreview = null;

function showPreview() {
  if (shownPreview) preview.remove(shownPreview);
  if (!previewModels.has(kit.id)) previewModels.set(kit.id, createCharacter(kit));
  shownPreview = previewModels.get(kit.id);
  previewCombat = createCombat(kit);
  preview.add(shownPreview);
}

function buildCards() {
  for (const k of roster) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'card';
    card.dataset.id = k.id;
    const h2 = document.createElement('h2');
    h2.textContent = k.name;
    const role = document.createElement('div');
    role.className = 'role';
    role.textContent = k.role;
    const blurb = document.createElement('p');
    blurb.className = 'blurb';
    blurb.textContent = k.blurb;
    const list = document.createElement('ul');
    for (const a of k.abilities) {
      const li = document.createElement('li');
      const name = document.createElement('b');
      name.textContent = a.name;
      const input = document.createElement('span');
      input.textContent = ` · ${a.input}`;
      li.append(name, input);
      li.title = a.text;
      list.append(li);
    }
    card.append(h2, role, blurb, list);
    card.addEventListener('click', () => chooseCharacter(k));
    card.addEventListener('dblclick', deploy);
    cardsEl.append(card);
  }
}

function chooseCharacter(k) {
  kit = k;
  if (character) scene.remove(character);
  if (!gameModels.has(k.id)) gameModels.set(k.id, createCharacter(k));
  character = gameModels.get(k.id);
  scene.add(character);
  cam = { ...CAMERA_DEFAULTS, ...k.camera };
  player = createPlayer(spawn, k.tuning);
  combat = createCombat(k);
  resetCamera();
  buildControls();
  buildMeters();
  showPreview();
  for (const card of cardsEl.children) card.setAttribute('aria-pressed', String(card.dataset.id === k.id));
}

function resetCamera() {
  pitch = -0.1;
  smoothFeetY = player.y;
  cameraDist = cam.distance;
  rope.visible = hook.visible = false;
}

function buildControls() {
  for (const el of controlsEl.querySelectorAll('.kit')) el.remove();
  for (const a of kit.abilities) {
    const dt = document.createElement('dt');
    dt.className = 'kit';
    dt.textContent = a.input;
    const dd = document.createElement('dd');
    dd.className = 'kit';
    dd.textContent = `${a.name}: ${a.text}`;
    controlsEl.append(dt, dd);
  }
}

function enterSelect() {
  mode = 'select';
  if (isLocked()) document.exitPointerLock();
  selectEl.hidden = false;
  overlay.hidden = true;
  crosshair.hidden = true;
  metersEl.hidden = true;
  keys.clear();
  buttons.clear();
}

function deploy() {
  mode = 'play';
  selectEl.hidden = true;
  chooseCharacter(kit); // always starts fresh at spawn
  overlay.querySelector('h1').textContent = kit.name;
  changeBtn.hidden = false;
  overlay.hidden = false; // stays up if the browser refuses the pointer lock; a click retries
  metersEl.hidden = false;
  accumulator = 0;
  lockPointer();
}

deployBtn.addEventListener('click', deploy);
changeBtn.addEventListener('click', (e) => {
  e.stopPropagation(); // otherwise the overlay would also resume the game
  enterSelect();
});

window.addEventListener('keydown', (e) => {
  if (mode !== 'select' || e.repeat) return;
  const number = Number(e.key);
  if (number >= 1 && number <= roster.length) chooseCharacter(roster[number - 1]);
  const step = e.code === 'ArrowRight' ? 1 : e.code === 'ArrowLeft' ? -1 : 0;
  if (step) chooseCharacter(roster[(roster.indexOf(kit) + step + roster.length) % roster.length]);
  if (e.code === 'Enter') {
    e.preventDefault();
    deploy();
  }
});

// ------------------------------------------------------------------- HUD ---

function buildMeters() {
  metersEl.textContent = '';
  const t = kit.tuning;
  const rows = [];
  if (t.dash) rows.push(['Dash', () => 1 - player.dashCooldown / t.dash.cooldown]);
  if (t.grapple) rows.push(['Hook', () => (player.rope ? 1 : 1 - player.grappleCooldown / t.grapple.cooldown)]);
  if (t.jet) rows.push(['Fuel', () => player.fuel]);
  metersEl.meters = rows.map(([label, value]) => {
    const el = document.createElement('div');
    el.className = 'meter';
    el.textContent = label;
    const track = document.createElement('div');
    track.className = 'meter-track';
    const fill = document.createElement('div');
    fill.className = 'meter-fill';
    track.append(fill);
    el.append(track);
    metersEl.append(el);
    return { fill, value };
  });
}

function updateHud() {
  for (const { fill, value } of metersEl.meters) {
    const v = value();
    fill.style.width = `${(v * 100).toFixed(1)}%`;
    fill.classList.toggle('ready', v >= 1);
  }
  // Shows when the hook has something to catch.
  const g = kit.tuning.grapple;
  const inRange = !!g && !player.rope &&
    raycast(colliders, aim.x, aim.y, aim.z, aim.dx, aim.dy, aim.dz, g.range) < g.range;
  crosshair.classList.toggle('in-range', inRange);
}

let hitMarkerFor = 0;
let tracerFor = 0;
const muzzlePoint = new THREE.Vector3();

function showEvents(events) {
  for (const ev of events) {
    if (ev.type === 'hit') hitMarkerFor = HIT_MARKER_TIME;
    if (ev.type === 'shot') {
      character.userData.muzzle.getWorldPosition(muzzlePoint);
      tracer.userData.setEnds(muzzlePoint.x, muzzlePoint.y, muzzlePoint.z, ev.x, ev.y, ev.z);
      tracer.visible = true;
      tracerFor = TRACER_TIME;
    }
  }
}

function resize() {
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = previewCamera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  previewCamera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ------------------------------------------------------------------ input ---

const keys = new Set();
const buttons = new Set();
let jumpQueued = false;
let primaryQueued = false;
let secondaryQueued = false;
const isLocked = () => document.pointerLockElement === canvas;

window.addEventListener('keydown', (e) => {
  if (!isLocked()) return;
  if (e.code === 'Space') {
    e.preventDefault();
    if (!e.repeat) jumpQueued = true;
  }
  if (e.repeat) return;
  if (e.code === 'KeyV') shoulderSide = -shoulderSide;
  if (e.code === 'KeyC') {
    enterSelect();
    return;
  }
  if (e.code === 'KeyR') {
    respawn(player, spawn);
    resetCamera();
  }
  keys.add(e.code);
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => {
  keys.clear();
  buttons.clear();
});

document.addEventListener('mousemove', (e) => {
  if (!isLocked()) return;
  // Some browsers occasionally report a huge jump in pointer lock; ignore those.
  if (Math.abs(e.movementX) > 500 || Math.abs(e.movementY) > 500) return;
  player.yaw -= e.movementX * cam.sensitivity;
  pitch -= e.movementY * cam.sensitivity;
  pitch = Math.max(-cam.maxPitch, Math.min(cam.maxPitch, pitch));
});

document.addEventListener('mousedown', (e) => {
  if (!isLocked()) return;
  buttons.add(e.button);
  if (e.button === 0) primaryQueued = true;
  if (e.button === 2) secondaryQueued = true;
});
document.addEventListener('mouseup', (e) => buttons.delete(e.button));
document.addEventListener('contextmenu', (e) => e.preventDefault());

async function lockPointer() {
  try {
    await canvas.requestPointerLock({ unadjustedMovement: true }); // raw mouse input
  } catch {
    // Raw input isn't supported everywhere. This also fails briefly after Esc,
    // while the browser enforces its re-lock cooldown; a later click recovers.
    try { await canvas.requestPointerLock(); } catch { /* overlay stays visible */ }
  }
}
overlay.addEventListener('click', lockPointer);
canvas.addEventListener('click', () => { if (mode === 'play' && !isLocked()) lockPointer(); });

document.addEventListener('pointerlockchange', () => {
  const locked = isLocked();
  overlay.hidden = locked || mode === 'select';
  crosshair.hidden = !locked;
  if (locked) overlay.querySelector('h1').textContent = 'Paused';
  else {
    keys.clear();
    buttons.clear();
  }
});

const IDLE_INPUT = { moveX: 0, moveY: 0, sprint: false, jumpPressed: false };

function readInput() {
  const axis = (pos, neg) => (keys.has(pos) ? 1 : 0) - (keys.has(neg) ? 1 : 0);
  const input = {
    moveX: axis('KeyD', 'KeyA'),
    moveY: axis('KeyW', 'KeyS'),
    sprint: keys.has('ShiftLeft') || keys.has('ShiftRight'),
    jumpPressed: jumpQueued,
    jumpHeld: keys.has('Space'),
    primary: buttons.has(0),
    primaryPressed: primaryQueued,
    secondaryPressed: secondaryQueued,
    aim,
  };
  jumpQueued = primaryQueued = secondaryQueued = false;
  return input;
}

// ----------------------------------------------------------------- camera ---

function updateCamera(x, y, z, dt) {
  // Smooths out the small height pops from walking up ledges.
  smoothFeetY += (y - smoothFeetY) * (1 - Math.exp(-22 * dt));
  shoulderBlend += (shoulderSide - shoulderBlend) * (1 - Math.exp(-12 * dt));

  const sinY = Math.sin(player.yaw), cosY = Math.cos(player.yaw);
  const cosP = Math.cos(pitch), sinP = Math.sin(pitch);
  const headY = smoothFeetY + cam.eyeHeight;

  // Move out to the shoulder, stopping short of any wall beside the player.
  const side = Math.sign(shoulderBlend) || 1;
  const reach = Math.abs(shoulderBlend) * cam.shoulder;
  const clear = raycast(colliders, x, headY, z, cosY * side, 0, -sinY * side, reach + cam.wallMargin);
  const offset = Math.max(0, clear - cam.wallMargin) * side;
  const px = x + cosY * offset;
  const pz = z - sinY * offset;

  // Cast backwards from there. Pull in instantly on a hit; ease back out after.
  const bx = sinY * cosP, by = -sinP, bz = cosY * cosP;
  const hit = raycast(colliders, px, headY, pz, bx, by, bz, cam.distance + cam.wallMargin);
  const target = Math.max(0.05, hit - cam.wallMargin);
  cameraDist = target < cameraDist ? target : cameraDist + (target - cameraDist) * (1 - Math.exp(-7 * dt));

  camera.position.set(px + bx * cameraDist, headY + by * cameraDist, pz + bz * cameraDist);
  camera.rotation.set(pitch, player.yaw, 0);
  // Hide the model rather than look inside it.
  character.visible = cameraDist > Math.max(1, player.tuning.radius * 2);

  aim.x = px; aim.y = headY; aim.z = pz;
  aim.dx = -bx; aim.dy = -by; aim.dz = -bz;
}

// -------------------------------------------------------------- main loop ---

let last = performance.now();
let accumulator = 0;
let statFrames = 0, statTime = 0, slowWindows = 0;

function updateStats(dt) {
  statFrames++;
  statTime += dt;
  if (statTime < 0.5) return;
  const avg = statTime / statFrames;
  statsEl.textContent =
    `${Math.round(1 / avg)} fps · ${(avg * 1000).toFixed(1)} ms · ` +
    `${renderer.info.render.calls} draws · ${pixelRatio.toFixed(2)}x\n` +
    (mode === 'play' ? `height ${player.y.toFixed(1)} m · speed ${Math.hypot(player.vx, player.vz).toFixed(1)} m/s` : '');

  // Only judge performance while playing; idle or background tabs throttle.
  if (isLocked() && !document.hidden) {
    slowWindows = avg > 1 / 45 ? slowWindows + 1 : 0;
    if (slowWindows >= 3 && pixelRatio > 0.6) {
      pixelRatio = Math.max(0.6, pixelRatio - 0.2);
      slowWindows = 0;
      resize();
    }
  }
  statFrames = 0;
  statTime = 0;
}

function renderSelect(dt) {
  previewYaw += dt * 0.55;
  shownPreview.rotation.y = previewYaw;
  shownPreview.userData.animate(dt, previewPlayer, previewCombat);
  // Looks down at a point below the model, which sits it above the cards.
  previewCamera.position.set(0, 1.4, 9.4);
  previewCamera.lookAt(0, 0.1, 0);
  renderer.render(preview, previewCamera);
}

function renderPlay(dt) {
  accumulator += dt;
  while (accumulator >= TICK) {
    const input = isLocked() ? readInput() : IDLE_INPUT;
    stepPlayer(player, colliders, input, spawn);
    stepWanderers(wanderers, colliders);
    showEvents(stepCombat(combat, player, wanderers, colliders, input));
    accumulator -= TICK;
  }

  // Render between the last two physics states, so motion is smooth at any refresh rate.
  const a = accumulator / TICK;
  const lerp = (from, to) => from + (to - from) * a;
  const x = lerp(player.prevX, player.x);
  const y = lerp(player.prevY, player.y);
  const z = lerp(player.prevZ, player.z);

  character.position.set(x, y, z);
  character.rotation.y = player.yaw;
  character.userData.animate(dt, player, combat);
  updateCamera(x, y, z, dt);

  wanderers.forEach((t, i) => {
    const b = t.body;
    wandererViews[i].userData.sync(t, lerp(b.prevX, b.x), lerp(b.prevY, b.y), lerp(b.prevZ, b.z), dt);
  });

  rope.visible = hook.visible = !!player.rope;
  if (player.rope) {
    const r = player.rope;
    rope.userData.setEnds(x, y + player.tuning.height / 2, z, r.x, r.y, r.z);
    hook.position.set(r.x, r.y, r.z);
  }
  if (tracerFor > 0) {
    tracerFor -= dt;
    if (tracerFor <= 0) tracer.visible = false;
  }
  if (hitMarkerFor > 0) hitMarkerFor -= dt;
  crosshair.classList.toggle('hit', hitMarkerFor > 0);

  updateHud();
  renderer.render(scene, camera);
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  updateStats(dt); // first: a resolution drop clears the canvas, so it must happen before rendering
  if (mode === 'select') renderSelect(dt);
  else renderPlay(dt);
}

// Console access for tweaking while prototyping.
window.game = {
  get player() { return player; },
  get kit() { return kit; },
  wanderers, roster, renderer, scene, camera, aim,
  setPitch: (v) => { pitch = v; },
};

buildCards();
chooseCharacter(roster[0]);
enterSelect();
requestAnimationFrame(frame);
