import * as THREE from 'three';
import { colliders, spawns } from './level.js';
import { createPlayer, respawn, stepPlayer, raycast, TICK } from './physics.js';
import { buildWorld } from './world.js';
import { createCharacter } from './character.js';

const CAMERA = {
  distance: 4.2,
  eyeHeight: 1.55,
  shoulder: 0.6,
  wallMargin: 0.25,
  sensitivity: 0.0022,
  maxPitch: 1.35,
};

const overlay = document.getElementById('overlay');
const statsEl = document.getElementById('stats');
const crosshair = document.getElementById('crosshair');

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
const player = createPlayer(spawn);
const character = createCharacter();
scene.add(character);

// Starts at native resolution (capped at 1.5x). If the machine can't hold frame
// rate, drops in steps; it never steps back up, to avoid visible oscillation.
let pixelRatio = Math.min(window.devicePixelRatio, 1.5);

function resize() {
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ------------------------------------------------------------------ input ---

const keys = new Set();
let jumpQueued = false;
let pitch = -0.1;
let shoulderSide = 1;
const isLocked = () => document.pointerLockElement === canvas;

window.addEventListener('keydown', (e) => {
  if (!isLocked()) return;
  if (e.code === 'Space') {
    e.preventDefault();
    if (!e.repeat) jumpQueued = true;
  }
  if (e.repeat) return;
  if (e.code === 'KeyV') shoulderSide = -shoulderSide;
  if (e.code === 'KeyR') {
    respawn(player, spawn);
    pitch = -0.1;
  }
  keys.add(e.code);
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

document.addEventListener('mousemove', (e) => {
  if (!isLocked()) return;
  // Some browsers occasionally report a huge jump in pointer lock; ignore those.
  if (Math.abs(e.movementX) > 500 || Math.abs(e.movementY) > 500) return;
  player.yaw -= e.movementX * CAMERA.sensitivity;
  pitch -= e.movementY * CAMERA.sensitivity;
  pitch = Math.max(-CAMERA.maxPitch, Math.min(CAMERA.maxPitch, pitch));
});

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
canvas.addEventListener('click', () => { if (!isLocked()) lockPointer(); });

document.addEventListener('pointerlockchange', () => {
  const locked = isLocked();
  overlay.hidden = locked;
  crosshair.hidden = !locked;
  if (locked) overlay.querySelector('h1').textContent = 'Paused';
  else keys.clear();
});

function readInput() {
  const axis = (pos, neg) => (keys.has(pos) ? 1 : 0) - (keys.has(neg) ? 1 : 0);
  const input = {
    moveX: axis('KeyD', 'KeyA'),
    moveY: axis('KeyW', 'KeyS'),
    sprint: keys.has('ShiftLeft') || keys.has('ShiftRight'),
    jumpPressed: jumpQueued,
  };
  jumpQueued = false;
  return input;
}

// ----------------------------------------------------------------- camera ---

let smoothFeetY = player.y;
let cameraDist = CAMERA.distance;
let shoulderBlend = 1;

function updateCamera(x, y, z, dt) {
  // Smooths out the small height pops from walking up ledges.
  smoothFeetY += (y - smoothFeetY) * (1 - Math.exp(-22 * dt));
  shoulderBlend += (shoulderSide - shoulderBlend) * (1 - Math.exp(-12 * dt));

  const sinY = Math.sin(player.yaw), cosY = Math.cos(player.yaw);
  const cosP = Math.cos(pitch), sinP = Math.sin(pitch);
  const headY = smoothFeetY + CAMERA.eyeHeight;

  // Move out to the shoulder, stopping short of any wall beside the player.
  const side = Math.sign(shoulderBlend) || 1;
  const reach = Math.abs(shoulderBlend) * CAMERA.shoulder;
  const clear = raycast(colliders, x, headY, z, cosY * side, 0, -sinY * side, reach + CAMERA.wallMargin);
  const offset = Math.max(0, clear - CAMERA.wallMargin) * side;
  const px = x + cosY * offset;
  const pz = z - sinY * offset;

  // Cast backwards from there. Pull in instantly on a hit; ease back out after.
  const bx = sinY * cosP, by = -sinP, bz = cosY * cosP;
  const hit = raycast(colliders, px, headY, pz, bx, by, bz, CAMERA.distance + CAMERA.wallMargin);
  const target = Math.max(0.05, hit - CAMERA.wallMargin);
  cameraDist = target < cameraDist ? target : cameraDist + (target - cameraDist) * (1 - Math.exp(-7 * dt));

  camera.position.set(px + bx * cameraDist, headY + by * cameraDist, pz + bz * cameraDist);
  camera.rotation.set(pitch, player.yaw, 0);
  character.visible = cameraDist > 1; // hide the model rather than look inside it
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
    `height ${player.y.toFixed(1)} m · speed ${Math.hypot(player.vx, player.vz).toFixed(1)} m/s`;

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

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;

  accumulator += dt;
  while (accumulator >= TICK) {
    stepPlayer(player, colliders, isLocked() ? readInput() : { moveX: 0, moveY: 0, sprint: false, jumpPressed: false }, spawn);
    accumulator -= TICK;
  }

  // Render between the last two physics states, so motion is smooth at any refresh rate.
  const a = accumulator / TICK;
  const x = player.prevX + (player.x - player.prevX) * a;
  const y = player.prevY + (player.y - player.prevY) * a;
  const z = player.prevZ + (player.z - player.prevZ) * a;

  character.position.set(x, y, z);
  character.rotation.y = player.yaw;
  character.userData.animate(dt, Math.hypot(player.vx, player.vz), player.grounded);
  updateCamera(x, y, z, dt);

  renderer.render(scene, camera);
  updateStats(dt);
}

// Console access for tweaking while prototyping.
window.game = { player, renderer, scene, camera, setPitch: (v) => { pitch = v; } };

requestAnimationFrame(frame);
