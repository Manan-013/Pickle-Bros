import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * Character heads (built by tools/build-characters.mjs into public/characters/). Each file is
 * loaded once; players get their own copy. The head's origin is the base of its neck.
 */

const loader = new GLTFLoader();
const cache = new Map<string, Promise<THREE.Object3D>>();

function load(id: string): Promise<THREE.Object3D> {
  let p = cache.get(id);
  if (!p) {
    p = loader.loadAsync(`${import.meta.env.BASE_URL}characters/${id}.glb`).then((gltf) => {
      gltf.scene.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.castShadow = true;
          const m = o.material as THREE.MeshStandardMaterial;
          // Heads without a texture (built from the STL) are coloured per vertex.
          if (!m.map && o.geometry.getAttribute('color')) m.vertexColors = true;
        }
      });
      return gltf.scene;
    });
    cache.set(id, p);
  }
  return p;
}

/** A fresh copy of a character's head (shares geometry and textures with other copies). */
export async function loadHead(id: string): Promise<THREE.Object3D> {
  return (await load(id)).clone(true);
}

/** Start downloading heads early (e.g. while the menu is showing). */
export function preloadHeads(ids: string[]): void {
  for (const id of ids) void load(id).catch(() => cache.delete(id));
}
