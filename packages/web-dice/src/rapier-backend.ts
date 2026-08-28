import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import type {
  BodyTransform,
  IPhysicsBackend,
  IPhysicsWorld,
} from "web-dice-core";
import { diceInitPosition } from "web-dice-core";

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
      initPositions,
      angularVelocities,
      convexHullPoints,
      worldConfig,
      colliderConfig,
      board,
    } = options;

    const gravity = new RAPIER.Vector3(...worldConfig.gravity);
    const world = new RAPIER.World(gravity);
    world.timestep = worldConfig.timestep;

    const floorBody = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(
        0,
        -board.boundaryThickness / 2,
        0,
      ),
    );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(
        board.boardLength / 2,
        board.boundaryThickness / 2,
        board.boardWidth / 2,
      ),
      floorBody,
    );

    const wallConfigs = [
      { x: board.boardLength / 2 + board.boundaryThickness / 2, z: 0, isX: true },
      { x: -board.boardLength / 2 + board.boundaryThickness / 2, z: 0, isX: true },
      { x: 0, z: board.boardWidth / 2 + board.boundaryThickness / 2, isX: false },
      { x: 0, z: -board.boardWidth / 2 + board.boundaryThickness / 2, isX: false },
    ];
    for (const wall of wallConfigs) {
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(
          wall.x,
          board.boundaryHeight / 2,
          wall.z,
        ),
      );
      const shape = wall.isX
        ? RAPIER.ColliderDesc.cuboid(
            board.boundaryThickness / 2,
            board.boundaryHeight / 2,
            board.boardWidth / 2,
          )
        : RAPIER.ColliderDesc.cuboid(
            board.boardLength / 2,
            board.boundaryHeight / 2,
            board.boundaryThickness / 2,
          );
      world.createCollider(shape, body);
    }

    const bodies: RAPIER.RigidBody[] = [];
    for (let i = 0; i < diceCount; i++) {
      const fallback = diceInitPosition(board, i, diceCount);
      const init = initPositions?.[i];
      const x = init ? init.x : fallback.x;
      const y = init ? init.y : board.diceInitHeight;
      const z = init ? init.z : fallback.z;
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(x, y, z)
          .setRotation(initRotations[i]),
      );
      const angularVelocity = angularVelocities?.[i];
      if (angularVelocity) {
        body.setAngvel(
          new RAPIER.Vector3(
            angularVelocity.x,
            angularVelocity.y,
            angularVelocity.z,
          ),
          true,
        );
      }
      const shape = RAPIER.ColliderDesc.convexHull(convexHullPoints)!;
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
