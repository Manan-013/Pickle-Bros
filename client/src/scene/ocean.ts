import * as THREE from 'three';

/**
 * The beach's ocean: a sloping shoreline of wet sand, water that's turquoise in the shallows and
 * deep blue offshore, rolling waves (bigger further out), sun glints, sky reflection and foam
 * along the shore and on wave crests. Plus a gradient sky dome.
 */

/** Where the sand meets the water (world z); the sea lies beyond it (more negative z). */
export const SHORE_Z = -18.2;
/** Where dry sand stops and the beach starts sloping into the water. */
export const SAND_EDGE_Z = -16.5;

const SEA_LEVEL = -0.12;

const vertex = /* glsl */ `
  uniform float uTime;
  uniform float uShoreZ;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vHeight;

  // A few travelling waves; returns height and adds its slope to grad.
  float wave(vec2 p, vec2 dir, float k, float speed, float amp, inout vec2 grad) {
    float phase = dot(p, dir) * k + uTime * speed;
    grad += dir * k * amp * cos(phase);
    return amp * sin(phase);
  }

  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    // Calm right at the shore, full swell further out.
    float out_ = smoothstep(0.0, 22.0, uShoreZ - world.z);
    float calm = 0.25 + 0.75 * out_;
    vec2 grad = vec2(0.0);
    float h = 0.0;
    h += wave(world.xz, normalize(vec2(0.15, 1.0)), 0.18, 1.1, 0.32 * calm, grad);
    h += wave(world.xz, normalize(vec2(-0.6, 1.0)), 0.31, 1.6, 0.14 * calm, grad);
    h += wave(world.xz, normalize(vec2(0.8, 0.6)), 0.57, 2.3, 0.06 * calm, grad);
    h += wave(world.xz, normalize(vec2(-0.3, -1.0)), 1.1, 3.1, 0.025, grad);
    world.y += h;
    vHeight = h;
    vNormal = normalize(vec3(-grad.x, 1.0, -grad.y));
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const fragment = /* glsl */ `
  uniform float uTime;
  uniform float uShoreZ;
  uniform vec3 uShallow;
  uniform vec3 uDeep;
  uniform vec3 uSky;
  uniform vec3 uSunDir;
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vHeight;

  void main() {
    vec3 n = normalize(vNormal);
    vec3 v = normalize(cameraPosition - vWorld);
    float dist = uShoreZ - vWorld.z;

    // Shallow turquoise near the beach, deep blue offshore.
    vec3 col = mix(uShallow, uDeep, smoothstep(0.0, 30.0, dist));
    // The sky reflects more at glancing angles.
    float fresnel = pow(1.0 - max(dot(n, v), 0.0), 4.0);
    col = mix(col, uSky, fresnel * 0.55);
    // Sun glints.
    vec3 h = normalize(uSunDir + v);
    col += vec3(1.0, 0.97, 0.9) * pow(max(dot(n, h), 0.0), 220.0) * 1.4;

    // Foam: a wavy band washing up and back along the shore, and white caps on crests.
    float wash = sin(vWorld.x * 0.33 + uTime * 0.7) * 0.5 + sin(vWorld.x * 0.91 - uTime * 1.2) * 0.25;
    float surge = sin(uTime * 0.55) * 0.6;
    float shore = 1.0 - smoothstep(0.0, 1.3, dist + wash + surge);
    float lace = smoothstep(0.55, 0.9, sin(vWorld.x * 2.3 + vWorld.z * 1.7 + uTime * 1.5) * 0.5 + 0.5);
    float caps = smoothstep(0.3, 0.42, vHeight) * (0.5 + 0.5 * lace);
    col = mix(col, vec3(0.96, 0.98, 1.0), clamp(shore * 0.95 + caps * 0.6, 0.0, 1.0));

    // Fade into the haze at the horizon.
    float d = length(cameraPosition - vWorld);
    col = mix(col, uFogColor, smoothstep(uFogNear, uFogFar, d));
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export interface Ocean {
  update(time: number): void;
}

export function buildOcean(g: THREE.Group, fog: { color: number; near: number; far: number }): Ocean {
  // Sky dome: deep blue overhead fading to a pale horizon.
  const skyGeo = new THREE.SphereGeometry(180, 32, 16);
  const top = new THREE.Color(0x3f8fe0);
  const horizon = new THREE.Color(0xd6efff);
  const colors: number[] = [];
  const pos = skyGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const t = THREE.MathUtils.clamp(pos.getY(i) / 180, 0, 1);
    const c = horizon.clone().lerp(top, Math.pow(t, 0.6));
    colors.push(c.r, c.g, c.b);
  }
  skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.add(new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false })));

  // The beach shelf: wet sand sloping from the dry sand down under the water.
  const shelfLength = 8;
  const shelf = new THREE.Mesh(
    new THREE.PlaneGeometry(400, shelfLength),
    new THREE.MeshStandardMaterial({ color: 0xc4a46e, roughness: 0.55 }),
  );
  const drop = 0.6;
  // Tilted so its far edge dips under the water.
  shelf.rotation.x = -Math.PI / 2 - Math.atan2(drop, shelfLength);
  shelf.position.set(0, -0.01 - drop / 2, SAND_EDGE_Z - shelfLength / 2);
  shelf.receiveShadow = true;
  g.add(shelf);
  // A darker damp strip just above the water line.
  const damp = new THREE.Mesh(new THREE.PlaneGeometry(400, 2.2), new THREE.MeshStandardMaterial({ color: 0xd4b882, roughness: 0.7 }));
  damp.rotation.x = -Math.PI / 2;
  damp.position.set(0, -0.006, SAND_EDGE_Z + 1.1);
  damp.receiveShadow = true;
  g.add(damp);

  // The water.
  const geo = new THREE.PlaneGeometry(420, 110, 210, 70);
  geo.rotateX(-Math.PI / 2);
  const uniforms = {
    uTime: { value: 0 },
    uShoreZ: { value: SHORE_Z },
    uShallow: { value: new THREE.Color(0x2fc7c9) },
    uDeep: { value: new THREE.Color(0x0b4f93) },
    uSky: { value: new THREE.Color(0xbfe3ff) },
    uSunDir: { value: new THREE.Vector3(0.3, 0.6, -1).normalize() },
    uFogColor: { value: new THREE.Color(fog.color) },
    uFogNear: { value: fog.near },
    uFogFar: { value: fog.far },
  };
  const water = new THREE.Mesh(geo, new THREE.ShaderMaterial({ uniforms, vertexShader: vertex, fragmentShader: fragment }));
  water.position.set(0, SEA_LEVEL, SHORE_Z - 55 + 1.5);
  g.add(water);

  return {
    update(time: number) {
      uniforms.uTime.value = time;
    },
  };
}
