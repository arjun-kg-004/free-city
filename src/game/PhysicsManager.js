import RAPIER from '@dimforge/rapier3d-compat';
import { COLLISION, groups } from '../config.js';

/**
 * Thin wrapper around a Rapier world.
 * Everything that moves (player, vehicles, traffic) is kinematic and resolved with
 * Rapier's character controller, which keeps the simulation stable at any frame rate.
 */
export class PhysicsManager {
  static async init() {
    await RAPIER.init();
    return new PhysicsManager();
  }

  constructor() {
    this.RAPIER = RAPIER;
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.staticGroups = groups(COLLISION.STATIC);
    this.staticCount = 0;
  }

  /** Static box collider. rotY in radians around Y. */
  addBox(x, y, z, hx, hy, hz, rotY = 0) {
    const desc = RAPIER.ColliderDesc.cuboid(hx, hy, hz)
      .setTranslation(x, y, z)
      .setCollisionGroups(this.staticGroups);
    if (rotY) desc.setRotation(quatY(rotY));
    this.staticCount++;
    return this.world.createCollider(desc);
  }

  addCylinder(x, y, z, halfHeight, radius) {
    const desc = RAPIER.ColliderDesc.cylinder(halfHeight, radius)
      .setTranslation(x, y, z)
      .setCollisionGroups(this.staticGroups);
    this.staticCount++;
    return this.world.createCollider(desc);
  }

  /** Thin wall between two points on the ground plane. */
  addWall(x0, z0, x1, z1, height = 2, thickness = 0.4, y0 = 0) {
    const dx = x1 - x0, dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    if (len < 0.01) return null;
    const rot = Math.atan2(dx, dz);
    return this.addBox((x0 + x1) / 2, y0 + height / 2, (z0 + z1) / 2, thickness / 2, height / 2, len / 2, rot);
  }

  createKinematic(x, y, z, colliderDesc, membership, filter = 0xffff) {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y, z)
    );
    colliderDesc.setCollisionGroups(groups(membership, filter));
    const collider = this.world.createCollider(colliderDesc, body);
    return { body, collider };
  }

  createController(offset = 0.04) {
    const cc = this.world.createCharacterController(offset);
    cc.setApplyImpulsesToDynamicBodies(false);
    return cc;
  }

  /** Ray cast against static geometry only. Returns hit distance or null. */
  raycastStatic(origin, dir, maxDist) {
    const ray = new RAPIER.Ray(origin, dir);
    const hit = this.world.castRay(ray, maxDist, true, undefined, groups(0xffff, COLLISION.STATIC));
    return hit ? hit.timeOfImpact ?? hit.toi : null;
  }

  /** True if a box at the given pose would overlap something solid (used to find a safe exit spot). */
  boxBlocked(x, y, z, hx, hy, hz, rotY = 0, excludeCollider = null) {
    const shape = new RAPIER.Cuboid(hx, hy, hz);
    let blocked = false;
    this.world.intersectionsWithShape(
      { x, y, z },
      quatY(rotY),
      shape,
      (col) => {
        if (excludeCollider && col.handle === excludeCollider.handle) return true;
        blocked = true;
        return false;
      },
      undefined,
      groups(0xffff, COLLISION.STATIC | COLLISION.VEHICLE | COLLISION.TRAFFIC)
    );
    return blocked;
  }

  step(dt) {
    this.world.timestep = Math.min(Math.max(dt, 1 / 240), 1 / 20);
    this.world.step();
  }
}

export function quatY(a) {
  return { x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) };
}
