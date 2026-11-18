// Vehicle catalogue: dimensions (for both detailed player meshes and instanced traffic) + handling.
export const CAR_SHAPES = {
  hatchback: { L: 3.9, W: 1.75, bodyH: 0.72, cabH: 0.62, cabL: 2.2, cabZ: -0.25, wheelR: 0.32, clearance: 0.18 },
  sedan: { L: 4.6, W: 1.8, bodyH: 0.66, cabH: 0.6, cabL: 2.4, cabZ: -0.15, wheelR: 0.33, clearance: 0.16 },
  suv: { L: 4.75, W: 1.95, bodyH: 0.92, cabH: 0.74, cabL: 2.9, cabZ: -0.3, wheelR: 0.4, clearance: 0.26 },
  sports: { L: 4.4, W: 1.95, bodyH: 0.52, cabH: 0.46, cabL: 1.8, cabZ: -0.25, wheelR: 0.34, clearance: 0.12 },
  taxi: { L: 4.6, W: 1.8, bodyH: 0.66, cabH: 0.6, cabL: 2.4, cabZ: -0.15, wheelR: 0.33, clearance: 0.16, sign: true },
  van: { L: 5.0, W: 2.0, bodyH: 1.15, cabH: 0.85, cabL: 3.6, cabZ: -0.5, wheelR: 0.38, clearance: 0.22 },
  bus: { L: 11, W: 2.55, bodyH: 1.6, cabH: 1.15, cabL: 10.3, cabZ: 0.05, wheelR: 0.5, clearance: 0.3 },
};

/** Player-usable vehicles (also sold at the dealership). */
export const VEHICLES = {
  hatchback: {
    name: 'Zippy Hatchback', kind: 'car', shape: 'hatchback', color: '#2f80ed', price: 0,
    maxSpeed: 38, accel: 7.5, brake: 16, reverse: 9, steer: 0.62, grip: 9, mass: 1100, fuelUse: 0.010,
    desc: 'Nimble city car. Easy to park, cheap to run.',
  },
  sedan: {
    name: 'Comfort Sedan', kind: 'car', shape: 'sedan', color: '#c0392b', price: 900,
    maxSpeed: 46, accel: 8.5, brake: 17, reverse: 9, steer: 0.55, grip: 9.5, mass: 1400, fuelUse: 0.012,
    desc: 'Smooth and stable at highway speed.',
  },
  suv: {
    name: 'Trail SUV', kind: 'car', shape: 'suv', color: '#2d3436', price: 1600,
    maxSpeed: 42, accel: 7.8, brake: 15, reverse: 8, steer: 0.5, grip: 8.5, mass: 1900, fuelUse: 0.016,
    desc: 'Tall, heavy and tough. Shrugs off bumps.',
  },
  sports: {
    name: 'Vortex GT', kind: 'car', shape: 'sports', color: '#f1c40f', price: 3200,
    maxSpeed: 64, accel: 13, brake: 22, reverse: 10, steer: 0.5, grip: 11, mass: 1250, fuelUse: 0.02,
    desc: 'Track-bred coupe. Blistering acceleration — handle with care.',
  },
  taxi: {
    name: 'City Taxi', kind: 'car', shape: 'taxi', color: '#f5c518', price: 1100,
    maxSpeed: 44, accel: 8.2, brake: 17, reverse: 9, steer: 0.56, grip: 9.5, mass: 1400, fuelUse: 0.012,
    desc: 'Earn a little extra on the Food Run and taxi-style jobs.',
  },
  van: {
    name: 'Delivery Van', kind: 'car', shape: 'van', color: '#ecf0f1', price: 0, dealer: false,
    maxSpeed: 34, accel: 6, brake: 14, reverse: 7, steer: 0.5, grip: 8.5, mass: 2400, fuelUse: 0.016,
    desc: 'Boxy and slow, but it gets the job done.',
  },
  bus: {
    name: 'City Bus', kind: 'car', shape: 'bus', color: '#1e88e5', price: 0, dealer: false,
    maxSpeed: 26, accel: 3.6, brake: 10, reverse: 5, steer: 0.42, grip: 8, mass: 11000, fuelUse: 0.03,
    desc: 'Wide turns, long brakes. Mind the corners!',
  },
  scooter: {
    name: 'Breeze Scooter', kind: 'motorcycle', color: '#16a085', price: 0, style: 'scooter',
    maxSpeed: 26, accel: 6.5, brake: 13, reverse: 0, steer: 0.75, grip: 9, mass: 120, fuelUse: 0.005,
    desc: 'Light, slow and easy. Perfect for the promenade.',
  },
  motorcycle: {
    name: 'Street Rider 250', kind: 'motorcycle', color: '#e74c3c', price: 0, style: 'street',
    maxSpeed: 44, accel: 11, brake: 17, reverse: 0, steer: 0.7, grip: 10, mass: 170, fuelUse: 0.008,
    desc: 'Quick, agile commuter bike.',
  },
  sportbike: {
    name: 'Falcon RR', kind: 'motorcycle', color: '#2980b9', price: 2400, style: 'sport',
    maxSpeed: 62, accel: 15, brake: 21, reverse: 0, steer: 0.62, grip: 11, mass: 190, fuelUse: 0.012,
    desc: 'Race replica. Leans hard and pulls harder.',
  },
  bicycle: {
    name: 'City Bicycle', kind: 'bicycle', color: '#27ae60', price: 0, style: 'city',
    maxSpeed: 10, accel: 2.6, brake: 8, reverse: 0, steer: 0.8, grip: 9, mass: 15, fuelUse: 0,
    desc: 'Pedal-powered. Three gears, no fuel needed.',
  },
  roadbike: {
    name: 'Aero Road Bike', kind: 'bicycle', color: '#8e44ad', price: 450, style: 'road',
    maxSpeed: 14, accel: 3.4, brake: 9, reverse: 0, steer: 0.72, grip: 9.5, mass: 9, fuelUse: 0,
    desc: 'Lightweight racer with taller gears.',
  },
};

export const STARTER_VEHICLES = ['hatchback', 'motorcycle', 'bicycle'];
