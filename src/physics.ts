import RAPIER from "@dimforge/rapier3d";
import * as THREE from "three";
import {
  BOUNDARY_HEIGHT,
  BOUNDARY_THICKNESS,
  CHESSBOARD_LENGTH,
  CHESSBOARD_WIDTH,
  DICE_INIT_HEIGHT,
  DICE_MASS,
  DICE_RESTITUTION,
  SIMULATE_DT,
} from "./config";
import { diceGeometryPoints } from "./geometries";

const gravity = new RAPIER.Vector3(0.0, -9.81, 0.0);

function setupFloor(world: RAPIER.World) {
  const floorBody = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(0, -BOUNDARY_THICKNESS / 2, 0),
  );
  const floorShape = RAPIER.ColliderDesc.cuboid(
    CHESSBOARD_LENGTH / 2,
    BOUNDARY_THICKNESS / 2,
    CHESSBOARD_WIDTH / 2,
  );
  world.createCollider(floorShape, floorBody);
}

function setupBoundary(world: RAPIER.World) {
  const boundaryBody1 = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(
      CHESSBOARD_LENGTH / 2 + BOUNDARY_THICKNESS / 2,
      BOUNDARY_HEIGHT / 2,
      0,
    ),
  );
  const boundaryBody2 = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(
      -CHESSBOARD_LENGTH / 2 + BOUNDARY_THICKNESS / 2,
      BOUNDARY_HEIGHT / 2,
      0,
    ),
  );
  const boundaryShapeX = RAPIER.ColliderDesc.cuboid(
    BOUNDARY_THICKNESS / 2,
    BOUNDARY_HEIGHT / 2,
    CHESSBOARD_WIDTH / 2,
  );
  world.createCollider(boundaryShapeX, boundaryBody1);
  world.createCollider(boundaryShapeX, boundaryBody2);

  const boundaryBody3 = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(
      0,
      BOUNDARY_HEIGHT / 2,
      CHESSBOARD_WIDTH / 2 + BOUNDARY_THICKNESS / 2,
    ),
  );
  const boundaryBody4 = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(
      0,
      BOUNDARY_HEIGHT / 2,
      -CHESSBOARD_WIDTH / 2 + BOUNDARY_THICKNESS / 2,
    ),
  );
  const boundaryShapeZ = RAPIER.ColliderDesc.cuboid(
    CHESSBOARD_LENGTH / 2,
    BOUNDARY_HEIGHT / 2,
    BOUNDARY_THICKNESS / 2,
  );
  world.createCollider(boundaryShapeZ, boundaryBody3);
  world.createCollider(boundaryShapeZ, boundaryBody4);
}

function setupEnv() {
  const world = new RAPIER.World(gravity);
  world.timestep = SIMULATE_DT;
  setupFloor(world);
  setupBoundary(world);
  return world;
}

function setupDice(
  x: number,
  z: number,
  rotation: RAPIER.Rotation,
  world: RAPIER.World,
): RAPIER.RigidBody {
  const diceBody = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, DICE_INIT_HEIGHT, z)
      .setRotation(rotation),
  );
  const diceShape = RAPIER.ColliderDesc.convexHull(diceGeometryPoints)!
    .setMass(DICE_MASS)
    .setRestitution(DICE_RESTITUTION);
  world.createCollider(diceShape, diceBody);
  return diceBody;
}

function diceInitPosition(index: number, total: number) {
  const diceInitCols = Math.min(total, 4);
  const diceInitRows = Math.ceil(total / diceInitCols);
  const diceColsGap = 3;
  const diceRowsGap = 4;
  return {
    x: ((index % diceInitCols) - (diceInitCols - 1) / 2) * diceColsGap,
    z:
      (Math.floor(index / diceInitCols) - (diceInitRows - 1) / 2) * diceRowsGap,
  };
}

export interface SimulateResult {
  initRotation: THREE.QuaternionLike;
  finalUpFace: number;
  sleepTime: number;
}

export function preSimulate(diceCount: number): SimulateResult[] {
  const world = setupEnv();
  const bodies: {
    initRotation: THREE.QuaternionLike;
    body: RAPIER.RigidBody;
  }[] = [];
  for (let i = 0; i < diceCount; i++) {
    const initRotation = new THREE.Quaternion().random();
    const { x, z } = diceInitPosition(i, diceCount);
    const body = setupDice(x, z, initRotation, world);
    bodies.push({ initRotation, body });
  }
  let time = 0;
  const results = new Map<number, SimulateResult>();
  while (results.size < diceCount) {
    world.step();
    time += world.timestep;
    for (let i = 0; i < bodies.length; i++) {
      const { initRotation, body } = bodies[i];
      if (results.has(i)) {
        continue;
      }
      const rotation = new THREE.Quaternion().copy(body.rotation()).invert();
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(rotation);
      if (body.isSleeping()) {
        const finalUpFace = 
          (+(up.x > 0) << 2) | (+(up.y > 0) << 1) | +(up.z > 0)
        ;
        results.set(i, { initRotation, finalUpFace, sleepTime: time });
      }
    }
  }
  return Array.from({ length: diceCount }, (_, i) => results.get(i)!);
}

export function simulate(initRotations: THREE.QuaternionLike[]) {
  const world = setupEnv();
  const bodies: RAPIER.RigidBody[] = [];
  for (let i = 0; i < initRotations.length; i++) {
    const { x, z } = diceInitPosition(i, initRotations.length);
    const body = setupDice(x, z, initRotations[i], world);
    bodies.push(body);
  }
  return {
    step: () => {
      world.step();
      return bodies.map((body) => ({
        translation: body.translation(),
        rotation: body.rotation(),
      }));
    },
  };
}
