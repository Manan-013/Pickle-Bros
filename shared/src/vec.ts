export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const cloneVec = (a: Vec3): Vec3 => ({ x: a.x, y: a.y, z: a.z });
