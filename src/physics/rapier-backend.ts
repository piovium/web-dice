import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import type {
  BodyTransform,
  ColliderConfig,
  IPhysicsBackend,
  IPhysicsWorld,
  PhysicsWorldConfig,
} from "./types";
import { calcFinalUpFace, diceInitPosition } from "./shared";
import {
  BOUNDARY_HEIGHT,
  BOUNDARY_THICKNESS,
  CHESSBOARD_LENGTH,
  CHESSBOARD_WIDTH,
  DICE_INIT_HEIGHT,
} from "../config";

export class PhysicsBackend implements IPhysicsBackend {
  private initialized = false;

  async init(): Promise<void> {
    if (this.initialized) return;
    await RAPIER.init();
    this.initialized = true;
  }

  createWorld(
    options: Parameters<IPhysicsBackend["createWorld"]>[0],
  ): IPhysicsWorld {
    const {
      diceCount,
      initRotations,
      convexHullPoints,
      worldConfig,
      colliderConfig,
    } = options;

    const gravity = new RAPIER.Vector3(...worldConfig.gravity);
    const world = new RAPIER.World(gravity);
    world.timestep = worldConfig.timestep;

    const floorBody = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(
        0,
        -BOUNDARY_THICKNESS / 2,
        0,
      ),
    );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(
        CHESSBOARD_LENGTH / 2,
        BOUNDARY_THICKNESS / 2,
        CHESSBOARD_WIDTH / 2,
      ),
      floorBody,
    );

    const wallConfigs = [
      { x: CHESSBOARD_LENGTH / 2 + BOUNDARY_THICKNESS / 2, z: 0, isX: true },
      { x: -CHESSBOARD_LENGTH / 2 + BOUNDARY_THICKNESS / 2, z: 0, isX: true },
      { x: 0, z: CHESSBOARD_WIDTH / 2 + BOUNDARY_THICKNESS / 2, isX: false },
      { x: 0, z: -CHESSBOARD_WIDTH / 2 + BOUNDARY_THICKNESS / 2, isX: false },
    ];
    for (const wall of wallConfigs) {
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(
          wall.x,
          BOUNDARY_HEIGHT / 2,
          wall.z,
        ),
      );
      const shape = wall.isX
        ? RAPIER.ColliderDesc.cuboid(
            BOUNDARY_THICKNESS / 2,
            BOUNDARY_HEIGHT / 2,
            CHESSBOARD_WIDTH / 2,
          )
        : RAPIER.ColliderDesc.cuboid(
            CHESSBOARD_LENGTH / 2,
            BOUNDARY_HEIGHT / 2,
            BOUNDARY_THICKNESS / 2,
          );
      world.createCollider(shape, body);
    }

    const bodies: RAPIER.RigidBody[] = [];
    for (let i = 0; i < diceCount; i++) {
      const { x, z } = diceInitPosition(i, diceCount);
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(x, DICE_INIT_HEIGHT, z)
          .setRotation(initRotations[i]),
      );
      let shape: RAPIER.ColliderDesc;
      if (colliderConfig.shape.kind === "convexHull") {
        shape = RAPIER.ColliderDesc.convexHull(colliderConfig.shape.points)!;
      } else {
        const he = colliderConfig.shape.halfExtents;
        shape = RAPIER.ColliderDesc.cuboid(he[0], he[1], he[2]);
      }
      shape.setMass(colliderConfig.mass);
      shape.setRestitution(colliderConfig.restitution);
      world.createCollider(shape, body);
      bodies.push(body);
    }

    return {
      step: () => {
        world.step();
        return bodies.map((body) => ({
          translation: new THREE.Vector3().copy(body.translation()),
          rotation: new THREE.Quaternion().copy(body.rotation()),
        }));
      },
      isSleeping: (index: number) => bodies[index].isSleeping(),
      dispose: () => {
        // Rapier World has no explicit free; rely on GC.
      },
    };
  }
}
