// Weapons and the characters they hit. Pure simulation with no rendering
// dependency: stepCombat returns events for main.js to show. Runs at the physics tick.
import { createPlayer, stepPlayer, raycast, TICK } from './physics.js';

const TARGET = { radius: 0.4, height: 1.8, hp: 100, downTime: 3, flashTime: 0.15 };
const WANDER = { walkSpeed: 3.5, minLeg: 1.5, maxLeg: 4.5, pauseChance: 0.15, turnRate: 6, stuckSpeed: 0.5 };
const KNOCKBACK = { push: 6, lift: 4 };

const baseTarget = ({ x, y, z }) => ({
  x, y, z,
  radius: TARGET.radius,
  height: TARGET.height,
  maxHp: TARGET.hp,
  hp: TARGET.hp,
  downFor: 0,
  flash: 0,
  ramImmune: 0,
});

// Targets that stand still.
export function createTargets(spots) {
  return spots.map(baseTarget);
}

// Targets with a body driven by the normal player controller, so they collide
// with the level exactly as players do. They come back at a random spot.
export function createWanderers(spots, rand = Math.random) {
  return spots.map((spot) => {
    const yaw = rand() * Math.PI * 2;
    const t = baseTarget(spot);
    t.body = createPlayer({ ...spot, yaw }, { walkSpeed: WANDER.walkSpeed });
    t.home = spot;
    t.spots = spots;
    t.rand = rand;
    t.heading = yaw;
    t.legTime = rand() * WANDER.maxLeg; // so they don't all turn at once
    t.legAge = 0;
    t.walking = true;
    return t;
  });
}

function reviveAtRandomSpot(t) {
  const spot = t.spots[Math.floor(t.rand() * t.spots.length)];
  t.home = spot;
  t.heading = t.rand() * Math.PI * 2;
  t.body = createPlayer({ ...spot, yaw: t.heading }, t.body.tuning);
  t.x = spot.x; t.y = spot.y; t.z = spot.z;
}

// Walks a straight leg in a random direction, then picks another; walls just end
// the leg early. Falls and ledges are fine: they find their own way down.
export function stepWanderers(targets, colliders, dt = TICK) {
  for (const t of targets) {
    if (!t.body) continue;
    const b = t.body;
    const down = t.downFor > 0;
    if (!down) {
      t.legTime -= dt;
      t.legAge += dt;
      const stuck = t.walking && b.grounded && t.legAge > 0.2 && Math.hypot(b.vx, b.vz) < WANDER.stuckSpeed;
      if (t.legTime <= 0 || stuck) {
        t.heading = t.rand() * Math.PI * 2;
        t.legTime = WANDER.minLeg + t.rand() * (WANDER.maxLeg - WANDER.minLeg);
        t.walking = t.rand() >= WANDER.pauseChance;
        t.legAge = 0;
      }
      // Ease towards the new heading the short way round.
      const turn = Math.atan2(Math.sin(t.heading - b.yaw), Math.cos(t.heading - b.yaw));
      b.yaw += turn * Math.min(1, WANDER.turnRate * dt);
    }
    const moveY = !down && t.walking && b.grounded ? 1 : 0;
    stepPlayer(b, colliders, { moveX: 0, moveY, sprint: false, jumpPressed: false }, t.home, dt);
    t.x = b.x; t.y = b.y; t.z = b.z;
  }
}

export function createCombat(kit) {
  return {
    weapon: kit.weapon ?? null,
    cooldown: 0,
    swingElapsed: Infinity,
    swingSide: 1,
    swingPending: false,
    dashSeen: 0,
    dashHits: new Set(),
  };
}

function hurt(target, damage, events, p) {
  if (target.downFor > 0) return;
  target.hp -= damage;
  target.flash = TARGET.flashTime;
  const killed = target.hp <= 0;
  if (killed) {
    target.hp = 0;
    target.downFor = TARGET.downTime;
  }
  if (target.body) {
    const dx = target.x - p.x, dz = target.z - p.z;
    const len = Math.hypot(dx, dz) || 1;
    target.body.vx = (dx / len) * KNOCKBACK.push;
    target.body.vz = (dz / len) * KNOCKBACK.push;
    target.body.vy = KNOCKBACK.lift;
  }
  events.push({ type: 'hit', target, damage, killed });
}

function updateTargets(targets, dt) {
  for (const t of targets) {
    t.flash = Math.max(0, t.flash - dt);
    t.ramImmune = Math.max(0, t.ramImmune - dt);
    if (t.downFor > 0) {
      t.downFor -= dt;
      if (t.downFor <= 0) {
        t.downFor = 0;
        t.hp = t.maxHp;
        if (t.body) reviveAtRandomSpot(t);
      }
    }
  }
}

function overlapsVertically(p, t, slack = 0) {
  return p.y - slack < t.y + t.height && p.y + p.tuning.height + slack > t.y;
}

// True if nothing solid stands between the player's chest and the target's.
function canReach(p, t, colliders, dist) {
  if (dist < 0.1) return true;
  const py = p.y + p.tuning.height / 2, ty = t.y + t.height / 2;
  const len = Math.hypot(t.x - p.x, ty - py, t.z - p.z);
  return raycast(colliders, p.x, py, p.z, (t.x - p.x) / len, (ty - py) / len, (t.z - p.z) / len, len) >= len;
}

function slash(p, c, targets, colliders, events) {
  const w = c.weapon;
  const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
  const minDot = Math.cos(w.arc / 2);
  for (const t of targets) {
    const dx = t.x - p.x, dz = t.z - p.z;
    const dist = Math.hypot(dx, dz);
    if (dist - t.radius > w.range || !overlapsVertically(p, t, 0.5)) continue;
    // A target overlapping the player counts as in front whichever way they face.
    if (dist > t.radius + p.tuning.radius && (dx * fx + dz * fz) / dist < minDot) continue;
    if (canReach(p, t, colliders, dist)) hurt(t, w.damage, events, p);
  }
}

function updateSword(p, c, targets, colliders, input, events, dt) {
  c.swingElapsed += dt;
  if ((input.primary || input.primaryPressed) && c.cooldown <= 0) {
    c.cooldown = c.weapon.interval;
    c.swingElapsed = 0;
    c.swingSide = -c.swingSide;
    c.swingPending = true;
  }
  if (c.swingPending && c.swingElapsed >= c.weapon.hitDelay) {
    c.swingPending = false;
    slash(p, c, targets, colliders, events);
  }
}

function updateDashCuts(p, c, targets, colliders, events) {
  const dash = p.tuning.dash;
  if (!dash) return;
  if (p.dashCount !== c.dashSeen) { // each dash can cut each target once
    c.dashSeen = p.dashCount;
    c.dashHits.clear();
  }
  if (p.dashTime <= 0) return;
  for (const t of targets) {
    if (c.dashHits.has(t) || !overlapsVertically(p, t, 0.5)) continue;
    const dist = Math.hypot(t.x - p.x, t.z - p.z);
    if (dist > t.radius + p.tuning.radius + 0.6 || !canReach(p, t, colliders, dist)) continue;
    c.dashHits.add(t);
    hurt(t, dash.damage, events, p);
  }
}

function updateRam(p, c, targets, events) {
  const w = c.weapon;
  const speed = Math.hypot(p.vx, p.vy, p.vz);
  if (speed < w.minSpeed) return;
  for (const t of targets) {
    if (t.ramImmune > 0 || !overlapsVertically(p, t)) continue;
    if (Math.hypot(t.x - p.x, t.z - p.z) > t.radius + p.tuning.radius) continue;
    t.ramImmune = w.immunity;
    hurt(t, speed * w.damagePerSpeed, events, p);
  }
}

// Distance along a normalised ray to a target's upright cylinder, or Infinity.
function rayToTarget(a, t) {
  const ox = a.x - t.x, oz = a.z - t.z;
  const qa = a.dx * a.dx + a.dz * a.dz;
  if (qa < 1e-9) return Infinity;
  const qb = ox * a.dx + oz * a.dz;
  const qc = ox * ox + oz * oz - t.radius * t.radius;
  const disc = qb * qb - qa * qc;
  if (disc < 0) return Infinity;
  const root = Math.sqrt(disc);
  const near = (-qb - root) / qa;
  const dist = near >= 0 ? near : (-qb + root) / qa;
  if (dist < 0) return Infinity;
  const y = a.y + a.dy * dist;
  return y >= t.y && y <= t.y + t.height ? dist : Infinity;
}

function updateCarbine(p, c, targets, colliders, input, events) {
  if (!input.primary || !input.aim || c.cooldown > 0) return;
  const w = c.weapon, a = input.aim;
  c.cooldown = w.interval;
  let nearest = raycast(colliders, a.x, a.y, a.z, a.dx, a.dy, a.dz, w.range);
  let hit = null;
  for (const t of targets) {
    if (t.downFor > 0) continue;
    const dist = rayToTarget(a, t);
    if (dist < nearest) { nearest = dist; hit = t; }
  }
  events.push({ type: 'shot', x: a.x + a.dx * nearest, y: a.y + a.dy * nearest, z: a.z + a.dz * nearest });
  if (hit) hurt(hit, w.damage, events, p);
}

export function stepCombat(c, p, targets, colliders, input, dt = TICK) {
  const events = [];
  updateTargets(targets, dt);
  c.cooldown = Math.max(0, c.cooldown - dt);
  updateDashCuts(p, c, targets, colliders, events);
  switch (c.weapon?.type) {
    case 'sword': updateSword(p, c, targets, colliders, input, events, dt); break;
    case 'ram': updateRam(p, c, targets, events); break;
    case 'carbine': updateCarbine(p, c, targets, colliders, input, events); break;
  }
  return events;
}
