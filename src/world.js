// Turns level data into one merged mesh (a single draw call) and builds the
// sky and lights. Everything is generated in code, with no assets to download.
import * as THREE from 'three';
import { topAt } from './physics.js';

// World direction towards the sun. The sky and shadows both use this.
export const SUN_DIR = new THREE.Vector3(0.5, 0.85, 0.3).normalize();
const HORIZON = new THREE.Color(0xd5e4ee);

const palette = {
  floor: { top: 0x737a82 },
  neutral: { side: 0xa4abb4, top: 0xe6e4da },
  A: { side: 0x7690bb, top: 0xc9dcf5, wall: 0x6f85ab },
  B: { side: 0xc58d6b, top: 0xf6dcc8, wall: 0xae8064 },
  rampTop: 0xe6c04f, // same on both sides: yellow always means "a way up"
};

function createGridTexture(renderer) {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, size, size);
  // Faint speckle so large surfaces don't look completely flat.
  for (let i = 0; i < 1400; i++) {
    g.fillStyle = `rgba(0,0,0,${Math.random() * 0.035})`;
    g.fillRect(Math.random() * size, Math.random() * size, 3, 3);
  }
  // One tile is 4m: a strong line every 4m and a light one every 2m.
  g.fillStyle = 'rgba(0,0,0,0.13)';
  g.fillRect(size / 2 - 1, 0, 2, size);
  g.fillRect(0, size / 2 - 1, size, 2);
  g.fillStyle = 'rgba(0,0,0,0.3)';
  g.fillRect(0, 0, 4, size);
  g.fillRect(0, 0, size, 4);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return tex;
}

function buildGeometry(colliders) {
  const positions = [], normals = [], uvs = [], colors = [], indices = [];
  const TILE = 4;
  const scratch = new THREE.Color();

  // corners are [x, y, z] in counter-clockwise order seen from outside;
  // shades holds one brightness multiplier per corner.
  function quad(corners, normal, hex, shades) {
    const base = positions.length / 3;
    corners.forEach(([x, y, z], i) => {
      positions.push(x, y, z);
      normals.push(...normal);
      if (Math.abs(normal[0]) > 0.9) uvs.push(z / TILE, y / TILE);
      else if (Math.abs(normal[2]) > 0.9) uvs.push(x / TILE, y / TILE);
      else uvs.push(x / TILE, z / TILE);
      scratch.setHex(hex).multiplyScalar(shades[i]);
      colors.push(scratch.r, scratch.g, scratch.b);
    });
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  for (const c of colliders) {
    const { minX: x0, maxX: x1, minZ: z0, maxZ: z1, minY: y0 } = c;
    const ha = topAt(c, x0, z0), hb = topAt(c, x1, z0);
    const hc = topAt(c, x1, z1), hd = topAt(c, x0, z1);

    const pal = c.kind === 'floor' ? palette.floor : palette[c.team];
    const sideHex = c.kind === 'wall' ? pal.wall ?? pal.side : pal.side;
    const topHex = c.ramp ? palette.rampTop : c.kind === 'wall' ? sideHex : pal.top;

    // Top. Its normal is tilted for ramps.
    const ux = x1 - x0, uz = z1 - z0;
    const n = new THREE.Vector3(-(hb - ha) * uz, ux * uz, -(hd - ha) * ux).normalize();
    quad([[x0, ha, z0], [x0, hd, z1], [x1, hc, z1], [x1, hb, z0]], n.toArray(), topHex, [1, 1, 1, 1]);
    if (c.kind === 'floor') continue;

    // Sides darken towards their base: cheap fake ambient occlusion that makes
    // each block's height easy to read.
    const sides = [
      [[x1, z0, hb], [x0, z0, ha], [0, 0, -1]],
      [[x0, z1, hd], [x1, z1, hc], [0, 0, 1]],
      [[x0, z0, ha], [x0, z1, hd], [-1, 0, 0]],
      [[x1, z1, hc], [x1, z0, hb], [1, 0, 0]],
    ];
    const baseShade = y0 > 0 ? 0.8 : 0.58;
    for (const [[ax, az, ah], [bx, bz, bh], normal] of sides) {
      if (ah <= y0 && bh <= y0) continue;
      quad([[ax, y0, az], [bx, y0, bz], [bx, bh, bz], [ax, ah, az]], normal, sideHex, [baseShade, baseShade, 1, 1]);
    }

    // Underside, for anything floating above the floor.
    if (y0 > 0) {
      quad([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0], sideHex, [0.55, 0.55, 0.55, 0.55]);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  return geo;
}

// ------------------------------------------------------------------- sky ---

const fract = (v) => v - Math.floor(v);
const hash = (x, y) => fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453);

function valueNoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy), b = hash(ix + 1, iy);
  const c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x, y) {
  let sum = 0, amp = 0.5;
  for (let i = 0; i < 5; i++) {
    sum += amp * valueNoise(x, y);
    x = x * 2.03 + 17; y = y * 2.03 + 9;
    amp *= 0.5;
  }
  return sum;
}

const smoothstep = (a, b, v) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Returns sRGB bytes for a normalised world direction.
function skyColor(x, y, z, out) {
  const up = Math.max(0, y);
  const t = Math.pow(up, 0.55);
  let r = 205 + (54 - 205) * t;
  let g = 225 + (120 - 225) * t;
  let b = 240 + (205 - 240) * t;

  if (y < 0) { // haze below the horizon, normally hidden by the walls
    const d = Math.min(1, -y * 3);
    r += (150 - r) * d; g += (160 - g) * d; b += (172 - b) * d;
  }

  const sun = x * SUN_DIR.x + y * SUN_DIR.y + z * SUN_DIR.z;
  if (y > 0.01) {
    // Project onto a flat cloud layer overhead; fade clouds out near the horizon.
    const scale = 1.6 / (y + 0.18);
    const n = fbm(x * scale + 3.1, z * scale + 7.7);
    const cover = smoothstep(0.47, 0.72, n) * smoothstep(0.02, 0.22, y);
    const shade = 225 + 30 * smoothstep(0.5, 0.75, n);
    r += (shade - r) * cover; g += (shade - g) * cover; b += (shade - b) * cover;
  }
  const glow = Math.pow(Math.max(0, sun), 90) * 0.55 + smoothstep(0.9993, 0.9997, sun);
  r += (255 - r) * Math.min(1, glow);
  g += (250 - g) * Math.min(1, glow);
  b += (232 - b) * Math.min(1, glow);

  out[0] = r; out[1] = g; out[2] = b;
}

function createSkyTexture(size = 384) {
  // Cube face axes, as [s axis, t axis, face direction] in cubemap convention.
  const faces = [
    [[0, 0, -1], [0, -1, 0], [1, 0, 0]],   // +X
    [[0, 0, 1], [0, -1, 0], [-1, 0, 0]],   // -X
    [[1, 0, 0], [0, 0, 1], [0, 1, 0]],     // +Y
    [[1, 0, 0], [0, 0, -1], [0, -1, 0]],   // -Y
    [[1, 0, 0], [0, -1, 0], [0, 0, 1]],    // +Z
    [[-1, 0, 0], [0, -1, 0], [0, 0, -1]],  // -Z
  ];
  const rgb = [0, 0, 0];
  const images = faces.map(([s, t, f]) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(size, size);
    let i = 0;
    for (let py = 0; py < size; py++) {
      const v = ((py + 0.5) / size) * 2 - 1;
      for (let px = 0; px < size; px++) {
        const u = ((px + 0.5) / size) * 2 - 1;
        const gx = s[0] * u + t[0] * v + f[0];
        const gy = s[1] * u + t[1] * v + f[1];
        const gz = s[2] * u + t[2] * v + f[2];
        const len = Math.hypot(gx, gy, gz);
        // three.js mirrors X when sampling cube textures, so undo that here.
        skyColor(-gx / len, gy / len, gz / len, rgb);
        img.data[i++] = rgb[0];
        img.data[i++] = rgb[1];
        img.data[i++] = rgb[2];
        img.data[i++] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  });

  const tex = new THREE.CubeTexture(images);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

// ----------------------------------------------------------------- scene ---

export function buildWorld(scene, renderer, colliders) {
  scene.background = createSkyTexture();
  scene.fog = new THREE.Fog(HORIZON, 70, 320);

  scene.add(new THREE.HemisphereLight(0xdcecff, 0x8c8678, 1.8));

  const sun = new THREE.DirectionalLight(0xfff3df, 1.9);
  sun.position.copy(SUN_DIR).multiplyScalar(120);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  // Sized to the whole arena, so the shadow map never needs to follow the player.
  Object.assign(sun.shadow.camera, { left: -95, right: 95, top: 80, bottom: -80, near: 10, far: 260 });
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);

  const mesh = new THREE.Mesh(
    buildGeometry(colliders),
    new THREE.MeshLambertMaterial({ map: createGridTexture(renderer), vertexColors: true }),
  );
  mesh.castShadow = mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}
