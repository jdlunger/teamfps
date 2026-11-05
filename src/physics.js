// Character controller and collision. The player is an upright cylinder tested
// against axis-aligned boxes and ramps. Runs at a fixed tick, so movement stays
// deterministic and doesn't vary with frame rate.

export const TICK = 1 / 60;

// Baseline values. Characters override these in roster.js; optional abilities
// (dash, jet, grapple) only exist on characters that define them.
export const tuning = {
  radius: 0.4,
  height: 1.8,
  stepHeight: 0.45,   // ledges this low are walked up without jumping
  walkSpeed: 7,
  sprintSpeed: 10,
  groundAccel: 60,
  airAccel: 18,
  gravity: 24,
  jumpVelocity: 8.4,  // apex of about 1.47m
  coyoteTime: 0.1,    // can still jump this long after leaving a ledge
  jumpBuffer: 0.1,    // a jump pressed this long before landing still fires
  killY: -20,
  airJumps: 0,
  momentum: false,    // keeps speed like a rolling object instead of stopping on a dime
  rollFriction: 0,    // momentum only: deceleration on the ground, m/s^2
  bounce: 0,          // fraction of a hard impact's speed returned
  maxSpeed: Infinity,
};

const BOUNCE_MIN_WALL_SPEED = 4;
const BOUNCE_MIN_LANDING_SPEED = 9;
const ROPE_CLEARANCE = 0.15; // the last stretch of rope may touch the surface it's hooked to

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function topAt(c, x, z) {
  if (!c.ramp) return c.maxY;
  const { axis, k, c0 } = c.ramp;
  return c0 + k * (axis === 'x' ? x : z);
}

export function createPlayer(spawn, overrides = {}) {
  const t = { ...tuning, ...overrides };
  return {
    tuning: t,
    x: spawn.x, y: spawn.y, z: spawn.z,
    prevX: spawn.x, prevY: spawn.y, prevZ: spawn.z,
    vx: 0, vy: 0, vz: 0,
    yaw: spawn.yaw,
    grounded: true,
    groundRamp: null,
    sinceGrounded: 0,
    sinceJumpPressed: Infinity,
    airJumpsLeft: t.airJumps,
    dashTime: 0, dashCooldown: 0, dashCount: 0, dashX: 0, dashY: 0, dashZ: 0,
    fuel: 1, jetting: false,
    rope: null, grappleCooldown: 0,
  };
}

export function respawn(p, spawn) {
  Object.assign(p, createPlayer(spawn, p.tuning));
}

// Highest walkable surface under the player's circle, ignoring anything above maxY.
function groundBelow(p, colliders, maxY) {
  const r = p.tuning.radius;
  let best = -Infinity;
  p.groundRamp = null;
  for (const c of colliders) {
    const cx = clamp(p.x, c.minX, c.maxX);
    const cz = clamp(p.z, c.minZ, c.maxZ);
    const dx = p.x - cx, dz = p.z - cz;
    if (dx * dx + dz * dz >= r * r) continue;
    const top = topAt(c, cx, cz);
    if (top <= maxY && top > best) {
      best = top;
      p.groundRamp = c.ramp;
    }
  }
  return best;
}

function collideHorizontal(p, colliders) {
  const t = p.tuning;
  const r = t.radius;
  const head = p.y + t.height;
  const stepTop = p.y + t.stepHeight;
  for (let pass = 0; pass < 2; pass++) { // second pass settles inside corners
    for (const c of colliders) {
      const cx = clamp(p.x, c.minX, c.maxX);
      const cz = clamp(p.z, c.minZ, c.maxZ);
      const dx = p.x - cx, dz = p.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      // Below the step limit, or entirely overhead: not an obstacle.
      if (topAt(c, cx, cz) <= stepTop || head <= c.minY) continue;

      let nx, nz, depth;
      if (d2 > 1e-9) {
        const d = Math.sqrt(d2);
        nx = dx / d; nz = dz / d; depth = r - d;
      } else {
        // Centre is inside the footprint: leave through the nearest side.
        const exits = [
          [p.x - c.minX, -1, 0], [c.maxX - p.x, 1, 0],
          [p.z - c.minZ, 0, -1], [c.maxZ - p.z, 0, 1],
        ].sort((a, b) => a[0] - b[0]);
        depth = exits[0][0] + r; nx = exits[0][1]; nz = exits[0][2];
      }
      p.x += nx * depth;
      p.z += nz * depth;
      const into = p.vx * nx + p.vz * nz;
      if (into < 0) { // slide along the wall, rebounding if hit hard enough
        const push = into * (-into > BOUNCE_MIN_WALL_SPEED ? 1 + t.bounce : 1);
        p.vx -= push * nx;
        p.vz -= push * nz;
      }
    }
  }
  keepInsideArena(p, colliders);
}

// Jets and hooks can get above the boundary walls, so the floor's edge also acts
// as an invisible wall at every height.
function keepInsideArena(p, colliders) {
  const floor = colliders.find((c) => c.kind === 'floor');
  if (!floor) return;
  const r = p.tuning.radius;
  const x = clamp(p.x, floor.minX + r, floor.maxX - r);
  const z = clamp(p.z, floor.minZ + r, floor.maxZ - r);
  if (x !== p.x) { p.x = x; p.vx = 0; }
  if (z !== p.z) { p.z = z; p.vz = 0; }
}

function moveVertical(p, colliders, dt, wasGrounded) {
  const t = p.tuning;
  const r = t.radius;
  p.vy -= t.gravity * dt;
  let next = p.y + p.vy * dt;

  if (p.vy > 0) { // ceilings
    const head = p.y + t.height;
    for (const c of colliders) {
      if (head > c.minY + 1e-6 || next + t.height <= c.minY) continue;
      const dx = p.x - clamp(p.x, c.minX, c.maxX);
      const dz = p.z - clamp(p.z, c.minZ, c.maxZ);
      if (dx * dx + dz * dz >= r * r) continue;
      next = c.minY - t.height;
      p.vy = 0;
    }
  }

  const ground = groundBelow(p, colliders, p.y + t.stepHeight);
  p.grounded = false;
  if (p.vy > 0) {
    if (next < ground) next = ground; // stepped up mid-jump: keep rising
  } else if (next <= ground) {
    const impact = -p.vy;
    next = ground;
    if (t.bounce > 0 && impact > BOUNCE_MIN_LANDING_SPEED) {
      p.vy = impact * t.bounce;
    } else {
      p.vy = 0; p.grounded = true;
    }
  } else if (wasGrounded && p.y - ground <= t.stepHeight + 0.05) {
    next = ground; p.vy = 0; p.grounded = true; // stay stuck to ramps going down
  }
  p.y = next;
}

// Standard movement: accelerate towards the wished velocity. In the air, no input
// keeps momentum instead of braking.
function walk(p, wishX, wishZ, wishLen, input, dt) {
  const t = p.tuning;
  if (!p.grounded && wishLen === 0) return;
  const speed = input.sprint ? t.sprintSpeed : t.walkSpeed;
  const accel = p.grounded ? t.groundAccel : t.airAccel;
  const dvx = wishX * speed - p.vx, dvz = wishZ * speed - p.vz;
  const dv = Math.hypot(dvx, dvz);
  const change = Math.min(1, (accel * dt) / (dv || 1));
  p.vx += dvx * change;
  p.vz += dvz * change;
}

// Rolling movement: input only pushes up to the top speed and never brakes extra
// speed gained from slopes or a grapple. Friction and slopes do the rest.
function roll(p, wishX, wishZ, input, dt) {
  const t = p.tuning;
  if (p.grounded) {
    const speed = Math.hypot(p.vx, p.vz);
    if (speed > 0) {
      const scale = Math.max(0, speed - t.rollFriction * dt) / speed;
      p.vx *= scale;
      p.vz *= scale;
    }
    if (p.groundRamp) {
      const { axis, k } = p.groundRamp;
      const downhill = (t.gravity * k) / (1 + k * k) * dt;
      if (axis === 'x') p.vx -= downhill; else p.vz -= downhill;
    }
  }
  const top = input.sprint ? t.sprintSpeed : t.walkSpeed;
  const along = p.vx * wishX + p.vz * wishZ;
  const accel = p.grounded ? t.groundAccel : t.airAccel;
  const push = clamp(top - along, 0, accel * dt);
  p.vx += wishX * push;
  p.vz += wishZ * push;
}

function jump(p, input, dt) {
  const t = p.tuning;
  p.sinceGrounded = p.grounded ? 0 : p.sinceGrounded + dt;
  p.sinceJumpPressed = input.jumpPressed ? 0 : p.sinceJumpPressed + dt;
  if (p.grounded) p.airJumpsLeft = t.airJumps;

  const fromGround = p.sinceJumpPressed <= t.jumpBuffer && p.sinceGrounded <= t.coyoteTime;
  const fromAir = !fromGround && input.jumpPressed && p.airJumpsLeft > 0;
  if (!fromGround && !fromAir) return false;
  if (fromAir) p.airJumpsLeft--;
  p.vy = t.jumpVelocity;
  p.grounded = false;
  p.sinceGrounded = Infinity; // no double jump from coyote time
  p.sinceJumpPressed = Infinity;
  return true;
}

// Dashes along the aim direction; returns true while the dash owns the player's velocity.
function updateDash(p, input, dt) {
  const d = p.tuning.dash;
  if (!d) return false;
  p.dashCooldown = Math.max(0, p.dashCooldown - dt);

  if (input.secondaryPressed && p.dashTime <= 0 && p.dashCooldown === 0) {
    let dx = input.aim ? input.aim.dx : -Math.sin(p.yaw);
    let dy = input.aim ? input.aim.dy : 0;
    let dz = input.aim ? input.aim.dz : -Math.cos(p.yaw);
    if (p.grounded && dy < 0) { // looking down while standing: skim the floor
      dy = 0;
      const len = Math.hypot(dx, dz) || 1;
      dx /= len; dz /= len;
    }
    p.dashX = dx; p.dashY = dy; p.dashZ = dz;
    p.dashTime = d.time;
    p.dashCooldown = d.cooldown;
    p.dashCount++;
  }
  if (p.dashTime <= 0) return false;

  p.dashTime -= dt;
  const speed = p.dashTime > 0 ? d.speed : p.tuning.sprintSpeed; // last tick: drop to a run
  p.vx = p.dashX * speed;
  p.vy = p.dashY * speed;
  p.vz = p.dashZ * speed;
  return true;
}

function updateJet(p, input, dt) {
  const j = p.tuning.jet;
  if (!j) return;
  p.jetting = !p.grounded && !!input.jumpHeld && p.fuel > 0;
  if (p.jetting) {
    p.fuel = Math.max(0, p.fuel - dt / j.duration);
    if (p.vy < j.maxRise) p.vy = Math.min(j.maxRise, p.vy + j.thrust * dt);
  } else if (p.grounded) {
    p.fuel = Math.min(1, p.fuel + dt / j.recharge);
  }
}

// Hook anywhere the aim ray reaches, while holding primary. The rope is a maximum
// length that keeps shrinking, so the player swings and is reeled in. Pulling
// through velocity (not position) keeps collision responsible for all movement.
function updateGrapple(p, colliders, input, dt) {
  const g = p.tuning.grapple;
  if (!g) return;
  p.grappleCooldown = Math.max(0, p.grappleCooldown - dt);
  const cy = p.y + p.tuning.height / 2;
  const release = () => { p.rope = null; p.grappleCooldown = g.cooldown; };

  if (input.primaryPressed && !p.rope && p.grappleCooldown === 0 && input.aim) {
    const a = input.aim;
    const hit = raycast(colliders, a.x, a.y, a.z, a.dx, a.dy, a.dz, g.range);
    if (hit < g.range) {
      const x = a.x + a.dx * hit, y = a.y + a.dy * hit, z = a.z + a.dz * hit;
      const length = Math.hypot(x - p.x, y - cy, z - p.z);
      if (!ropeBlocked(colliders, p.x, cy, p.z, x, y, z, length)) p.rope = { x, y, z, length };
    }
  }
  if (!p.rope) return;
  if (!input.primary && !input.primaryPressed) { release(); return; }

  const rope = p.rope;
  const ax = p.x - rope.x, ay = cy - rope.y, az = p.z - rope.z;
  const dist = Math.hypot(ax, ay, az);
  if (ropeBlocked(colliders, p.x, cy, p.z, rope.x, rope.y, rope.z, dist)) { release(); return; }

  rope.length = Math.max(g.minLength, rope.length - g.reel * dt);
  if (dist <= rope.length) return;
  const nx = ax / dist, ny = ay / dist, nz = az / dist;
  const outward = p.vx * nx + p.vy * ny + p.vz * nz;
  const wanted = -Math.min((dist - rope.length) / dt, g.maxPull);
  if (outward > wanted) {
    const dv = wanted - outward;
    p.vx += nx * dv; p.vy += ny * dv; p.vz += nz * dv;
  }
}

function ropeBlocked(colliders, x, y, z, ax, ay, az, dist) {
  if (dist <= ROPE_CLEARANCE) return false;
  const reach = dist - ROPE_CLEARANCE;
  return raycast(colliders, x, y, z, (ax - x) / dist, (ay - y) / dist, (az - z) / dist, reach) < reach;
}

function limitSpeed(p) {
  const max = p.tuning.maxSpeed;
  const speed = Math.hypot(p.vx, p.vy, p.vz);
  if (speed <= max) return;
  const scale = max / speed;
  p.vx *= scale; p.vy *= scale; p.vz *= scale;
}

// input: { moveX, moveY (each -1..1, +Y forward), sprint, jumpPressed } plus, for
// abilities: jumpHeld, primary, primaryPressed, secondaryPressed and
// aim { x, y, z, dx, dy, dz }, the ray through the crosshair.
export function stepPlayer(p, colliders, input, spawn, dt = TICK) {
  const t = p.tuning;
  p.prevX = p.x; p.prevY = p.y; p.prevZ = p.z;

  const sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
  let wishX = -sin * input.moveY + cos * input.moveX;
  let wishZ = -cos * input.moveY - sin * input.moveX;
  const wishLen = Math.hypot(wishX, wishZ);
  if (wishLen > 1) { wishX /= wishLen; wishZ /= wishLen; }

  let wasGrounded = p.grounded;
  if (!updateDash(p, input, dt)) {
    if (t.momentum) roll(p, wishX, wishZ, input, dt);
    else walk(p, wishX, wishZ, wishLen, input, dt);
    if (jump(p, input, dt)) wasGrounded = false;
  } else {
    wasGrounded = false; // a dash can leave the ground without being stuck back to it
  }
  updateJet(p, input, dt);
  updateGrapple(p, colliders, input, dt);
  limitSpeed(p);

  p.x += p.vx * dt;
  p.z += p.vz * dt;
  collideHorizontal(p, colliders);
  moveVertical(p, colliders, dt, wasGrounded);

  if (p.y < t.killY) respawn(p, spawn);
}

// Distance along a normalised ray to the first collider, up to maxDist.
// Each collider is treated as a convex shape: the box slabs, plus the sloped
// plane for ramps. Used for the camera, the grapple and hitscan.
export function raycast(colliders, ox, oy, oz, dx, dy, dz, maxDist) {
  let nearest = maxDist;
  for (const c of colliders) {
    let t0 = 0, t1 = nearest;
    const slabs = [[ox, dx, c.minX, c.maxX], [oy, dy, c.minY, c.maxY], [oz, dz, c.minZ, c.maxZ]];
    let miss = false;
    for (const [o, d, lo, hi] of slabs) {
      if (Math.abs(d) < 1e-9) {
        if (o < lo || o > hi) { miss = true; break; }
      } else {
        const a = (lo - o) / d, b = (hi - o) / d;
        t0 = Math.max(t0, Math.min(a, b));
        t1 = Math.min(t1, Math.max(a, b));
        if (t0 > t1) { miss = true; break; }
      }
    }
    if (miss) continue;
    if (c.ramp) {
      // Keep only the part of the ray under the slope: f(t) = y - height <= 0.
      const { axis, k, c0 } = c.ramp;
      const f0 = oy - (c0 + k * (axis === 'x' ? ox : oz));
      const fd = dy - k * (axis === 'x' ? dx : dz);
      if (Math.abs(fd) < 1e-9) {
        if (f0 > 0) continue;
      } else if (fd > 0) {
        t1 = Math.min(t1, -f0 / fd);
      } else {
        t0 = Math.max(t0, -f0 / fd);
      }
      if (t0 > t1) continue;
    }
    nearest = t0;
  }
  return nearest;
}
