/**
 * One consistent "press E" interaction system.
 * Static interactables are registered once; vehicles, pedestrians and benches are queried live.
 * Each candidate: { label, action, dist, priority }.
 */
export class InteractionSystem {
  constructor(game) {
    this.game = game;
    this.items = [];
    this.current = null;
  }

  /**
   * @param {object} item { id, x, z, radius, label: string|fn, action: fn, when?: 'foot'|'vehicle'|'any', enabled?: fn, priority? }
   */
  register(item) {
    this.items.push({ when: 'foot', priority: 1, radius: 2.2, ...item });
    return item;
  }

  remove(id) {
    this.items = this.items.filter((i) => i.id !== id);
  }

  update() {
    const g = this.game;
    const p = g.player;
    const inVehicle = !!p.vehicle;
    const px = p.vehicle ? p.vehicle.x : p.pos.x;
    const pz = p.vehicle ? p.vehicle.z : p.pos.z;
    let best = null;
    const consider = (c) => {
      if (!best || c.priority > best.priority || (c.priority === best.priority && c.dist < best.dist)) best = c;
    };
    if (!g.uiBlocking && p.seat) {
      consider({ label: 'Stand up', action: () => g.playerController.standUp(), dist: 0, priority: 10 });
    } else if (!g.uiBlocking) {
      for (const it of this.items) {
        if (it.when === 'foot' && inVehicle) continue;
        if (it.when === 'vehicle' && !inVehicle) continue;
        if (it.interior !== undefined && it.interior !== (p.interior ? p.interior.id : null)) continue;
        const d = Math.hypot(it.x - px, it.z - pz);
        if (d > it.radius) continue;
        if (it.enabled && !it.enabled()) continue;
        consider({ label: typeof it.label === 'function' ? it.label() : it.label, action: it.action, dist: d, priority: it.priority });
      }
      if (!inVehicle && !p.seat && !p.interior) {
        const v = g.vehicles.nearestEnterable(px, pz, 2.6);
        if (v) {
          const verb = v.kind === 'car' ? 'Drive' : 'Ride';
          const tag = v.rental ? 'shared ' : v.street || v.borrowed ? 'this ' : '';
          consider({ label: `${verb} ${tag}${v.spec.name}`, action: () => g.playerController.enterVehicle(v), dist: 0.5, priority: 3 });
        } else {
          // any AI traffic car or parked car can be taken
          const ref = g.traffic.nearestBorrowable(px, pz, 2.4);
          if (ref) {
            const moving = ref.kind === 'traffic' && Math.abs(ref.car.speed) > 2.5;
            const what = ref.car.shape === 'bus' ? 'bus' : ref.car.shape === 'van' ? 'van' : ref.car.shape === 'taxi' ? 'taxi' : 'car';
            consider({
              label: moving ? `Stand in front of the ${what} to stop it` : ref.kind === 'traffic' ? `Get in this ${what} (driver steps out)` : `Get in this parked ${what}`,
              action: () => g.vehicles.borrow(ref), dist: 0.6, priority: 2.5,
            });
          }
        }
        const npc = g.npcManager.nearestTalkable(px, pz, 2.3);
        if (npc && npc.state !== 'sit') consider({ label: npc.named ? `Talk to ${npc.named.name}` : 'Say hello', action: () => g.npcManager.talkTo(npc), dist: 1, priority: npc.named ? 4 : 0 });
        // benches
        for (const b of g.ctx.benches) {
          const d = Math.hypot(b.x - px, b.z - pz);
          if (d < 1.6 && !b.occupied) { consider({ label: 'Sit on bench', action: () => g.playerController.sit(b), dist: d, priority: 0.5 }); break; }
        }
      }
      if (inVehicle) consider({ label: `Exit ${p.vehicle.spec.name}`, action: () => g.playerController.exitVehicle(), dist: 99, priority: -1 });
    }
    this.current = best;
    g.hud.setPrompt(best ? best.label : null);
    if (best && g.input.justPressed('interact')) best.action();
  }
}
