import { oimo as OIMO } from "oimophysics";
import * as THREE from "three";
import type { IPhysicsBackend, IPhysicsWorld } from "web-dice-core";
import { diceInitPosition } from "web-dice-core";

// 正八面体体积 = sqrt(2)/3 * R^3，R �?OctahedronGeometry �?radius
const OCTAHEDRON_VOLUME = (size: number) => (Math.sqrt(2) / 3) * Math.pow(size, 3);

export class PhysicsBackend implements IPhysicsBackend {
  async init(): Promise<void> {
    // OimoPhysics 是纯 JS，无需异步初始化
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
      diceScale,
    } = options;

    const gravity = new OIMO.common.Vec3(...worldConfig.gravity);
    const world = new OIMO.dynamics.World(
      OIMO.collision.broadphase.BroadPhaseType.BVH,
      gravity,
    );

    const addStaticBody = (
      tx: number,
      ty: number,
      tz: number,
      halfExtents: [number, number, number],
    ) => {
      const config = new OIMO.dynamics.rigidbody.RigidBodyConfig();
      config.type = OIMO.dynamics.rigidbody.RigidBodyType.STATIC;
      config.position = new OIMO.common.Vec3(tx, ty, tz);
      config.rotation = new OIMO.common.Mat3(1, 0, 0, 0, 1, 0, 0, 0, 1);

      const body = new OIMO.dynamics.rigidbody.RigidBody(config);

      const shapeConfig = new OIMO.dynamics.rigidbody.ShapeConfig();
      shapeConfig.geometry = new OIMO.collision.geometry.BoxGeometry(
        new OIMO.common.Vec3(...halfExtents),
      );
      shapeConfig.friction = 0.5;
      shapeConfig.restitution = 0.2;

      body.addShape(new OIMO.dynamics.rigidbody.Shape(shapeConfig));
      world.addRigidBody(body);
    };

    // 地面
    addStaticBody(
      0,
      -board.boundaryThickness / 2,
      0,
      [
        board.boardLength / 2,
        board.boundaryThickness / 2,
        board.boardWidth / 2,
      ],
    );

    // 四面围墙
    addStaticBody(
      board.boardLength / 2 + board.boundaryThickness / 2,
      board.boundaryHeight / 2,
      0,
      [board.boundaryThickness / 2, board.boundaryHeight / 2, board.boardWidth / 2],
    );
    addStaticBody(
      -board.boardLength / 2 + board.boundaryThickness / 2,
      board.boundaryHeight / 2,
      0,
      [board.boundaryThickness / 2, board.boundaryHeight / 2, board.boardWidth / 2],
    );
    addStaticBody(
      0,
      board.boundaryHeight / 2,
      board.boardWidth / 2 + board.boundaryThickness / 2,
      [board.boardLength / 2, board.boundaryHeight / 2, board.boundaryThickness / 2],
    );
    addStaticBody(
      0,
      board.boundaryHeight / 2,
      -board.boardWidth / 2 + board.boundaryThickness / 2,
      [board.boardLength / 2, board.boundaryHeight / 2, board.boundaryThickness / 2],
    );

    // 骰子
    const bodies: OIMO.dynamics.rigidbody.RigidBody[] = [];
    for (let i = 0; i < diceCount; i++) {
      const fallback = diceInitPosition(board, i, diceCount);
      const init = initPositions?.[i];
      const x = init ? init.x : fallback.x;
      const y = init ? init.y : board.diceInitHeight;
      const z = init ? init.z : fallback.z;
      const rot = initRotations[i];

      const config = new OIMO.dynamics.rigidbody.RigidBodyConfig();
      config.type = OIMO.dynamics.rigidbody.RigidBodyType.DYNAMIC;
      config.position = new OIMO.common.Vec3(x, board.diceInitHeight, z);
      config.rotation = new OIMO.common.Mat3(1, 0, 0, 0, 1, 0, 0, 0, 1);
      config.linearDamping = 0.05;
      config.angularDamping = 0.05;

      const body = new OIMO.dynamics.rigidbody.RigidBody(config);

      const euler = new THREE.Euler().setFromQuaternion(
        new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w),
        "XYZ",
      );
      body.setRotationXyz(new OIMO.common.Vec3(euler.x, euler.y, euler.z));

      const angularVelocity = angularVelocities?.[i];
      if (angularVelocity) {
        body.setAngularVelocity(
          new OIMO.common.Vec3(
            angularVelocity.x,
            angularVelocity.y,
            angularVelocity.z,
          ),
        );
      }

      const shapeConfig = new OIMO.dynamics.rigidbody.ShapeConfig();
      shapeConfig.geometry = new OIMO.collision.geometry.ConvexHullGeometry(
        Array.from(
          { length: convexHullPoints.length / 3 },
          (_, j) =>
            new OIMO.common.Vec3(
              convexHullPoints[j * 3],
              convexHullPoints[j * 3 + 1],
              convexHullPoints[j * 3 + 2],
            ),
        ),
      );
      shapeConfig.restitution = colliderConfig.restitution;
      shapeConfig.friction = 0.5;
      // 凸包已预缩放，有效体积 = 基础体积 * scale^3；质量保持不变
      const effectiveVolume =
        OCTAHEDRON_VOLUME(board.diceSize) * Math.pow(diceScale, 3);
      shapeConfig.density = colliderConfig.mass / effectiveVolume;

      body.addShape(new OIMO.dynamics.rigidbody.Shape(shapeConfig));
      world.addRigidBody(body);
      bodies.push(body);
    }

    return {
      step: () => {
        world.step(worldConfig.timestep);
        return bodies.map((body) => {
          const pos = body.getPosition();
          const quat = body.getOrientation();
          return {
            translation: new THREE.Vector3(pos.x, pos.y, pos.z),
            rotation: new THREE.Quaternion(quat.x, quat.y, quat.z, quat.w),
          };
        });
      },
      isSleeping: (index: number) => bodies[index].isSleeping(),
      dispose: () => {
        // Oimo World 没有显式 clear API；依赖 GC。
      },
    };
  }
}
