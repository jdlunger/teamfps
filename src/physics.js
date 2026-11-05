// Character controller and collision. The player is an upright cylinder tested
// against axis-aligned boxes and ramps. Runs at a fixed tick, so movement stays
// deterministic and doesn't vary with frame rate.

export const TICK = 1 / 60;

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
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function topAt(c, x, z) {
  if (!c.ramp) return c.maxY;
  const { axis, k, c0 } = c.ramp;
  return c0 + k * (axis === 'x' ? x : z);
}

export function createPlayer(spawn) {
  return {
    x: spawn.x, y: spawn.y, z: spawn.z,
    prevX: spawn.x, prevY: spawn.y, prevZ: spawn.z,
    vx: 0, vy: 0, vz: 0,
    yaw: spawn.yaw,
    grounded: true,
    sinceGrounded: 0,
    sinceJumpPressed: Infinity,
  };
}

export function respawn(p, spawn) {
  Object.assign(p, createPlayer(spawn));
}

// Highest walkable surface under the player's circle, ignoring anything above maxY.
function groundBelow(colliders, x, z, maxY) {
  const r = tuning.radius;
  let best = -Infinity;
  for (const c of colliders) {
    const cx = clamp(x, c.minX, c.maxX);
    const cz = clamp(z, c.minZ, c.maxZ);
    const dx = x - cx, dz = z - cz;
    if (dx * dx + dz * dz >= r * r) continue;
    const top = topAt(c, cx, cz);
    if (top <= maxY && top > best) best = top;
  }
  return best;
}

function collideHorizontal(p, colliders) {
  const r = tuning.radius;
  const head = p.y + tuning.height;
  const stepTop = p.y + tuning.stepHeight;
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
      if (into < 0) { p.vx -= into * nx; p.vz -= into * nz; } // slide along the wall
    }
  }
}

function moveVertical(p, colliders, dt, wasGrounded) {
  const r = tuning.radius;
  p.vy -= tuning.gravity * dt;
  let next = p.y + p.vy * dt;

  if (p.vy > 0) { // ceilings
    const head = p.y + tuning.height;
    for (const c of colliders) {
      if (head > c.minY + 1e-6 || next + tuning.height <= c.minY) continue;
      const dx = p.x - clamp(p.x, c.minX, c.maxX);
      const dz = p.z - clamp(p.z, c.minZ, c.maxZ);
      if (dx * dx + dz * dz >= r * r) continue;
      next = c.minY - tuning.height;
      p.vy = 0;
    }
  }

  const ground = groundBelow(colliders, p.x, p.z, p.y + tuning.stepHeight);
  p.grounded = false;
  if (p.vy > 0) {
    if (next < ground) next = ground; // stepped up mid-jump: keep rising
  } else if (next <= ground) {
    next = ground; p.vy = 0; p.grounded = true;
  } else if (wasGrounded && p.y - ground <= tuning.stepHeight + 0.05) {
    next = ground; p.vy = 0; p.grounded = true; // stay stuck to ramps going down
  }
  p.y = next;
}

// input: { moveX, moveY (each -1..1, +Y forward), sprint, jumpPressed }
export function stepPlayer(p, colliders, input, spawn, dt = TICK) {
  p.prevX = p.x; p.prevY = p.y; p.prevZ = p.z;

  const sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
  let wishX = -sin * input.moveY + cos * input.moveX;
  let wishZ = -cos * input.moveY - sin * input.moveX;
  const wishLen = Math.hypot(wishX, wishZ);
  if (wishLen > 1) { wishX /= wishLen; wishZ /= wishLen; }

  // In the air, no input keeps momentum instead of braking.
  if (p.grounded || wishLen > 0) {
    const speed = input.sprint ? tuning.sprintSpeed : tuning.walkSpeed;
    const accel = p.grounded ? tuning.groundAccel : tuning.airAccel;
    const dvx = wishX * speed - p.vx, dvz = wishZ * speed - p.vz;
    const dv = Math.hypot(dvx, dvz);
    const change = Math.min(1, (accel * dt) / (dv || 1));
    p.vx += dvx * change;
    p.vz += dvz * change;
  }

  p.sinceGrounded = p.grounded ? 0 : p.sinceGrounded + dt;
  p.sinceJumpPressed = input.jumpPressed ? 0 : p.sinceJumpPressed + dt;
  let wasGrounded = p.grounded;
  if (p.sinceJumpPressed <= tuning.jumpBuffer && p.sinceGrounded <= tuning.coyoteTime) {
    p.vy = tuning.jumpVelocity;
    p.grounded = wasGrounded = false;
    p.sinceGrounded = Infinity; // no double jump from coyote time
    p.sinceJumpPressed = Infinity;
  }

  p.x += p.vx * dt;
  p.z += p.vz * dt;
  collideHorizontal(p, colliders);
  moveVertical(p, colliders, dt, wasGrounded);

  if (p.y < tuning.killY) respawn(p, spawn);
}

// Distance along a normalised ray to the first collider, up to maxDist.
// Each collider is treated as a convex shape: the box slabs, plus the sloped
// plane for ramps. Used to keep the camera out of walls; reusable for hitscan.
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
