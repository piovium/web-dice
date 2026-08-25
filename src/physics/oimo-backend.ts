import { oimo as OIMO } from "oimophysics";
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
  DICE_SIZE,
} from "../config";

// 正八面体体积 = sqrt(2)/3 * R^3，R 为 OctahedronGeometry 的 radius
const OCTAHEDRON_VOLUME = (Math.sqrt(2) / 3) * Math.pow(DICE_SIZE, 3);

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
      convexHullPoints,
      worldConfig,
      colliderConfig,
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
      -BOUNDARY_THICKNESS / 2,
      0,
      [CHESSBOARD_LENGTH / 2, BOUNDARY_THICKNESS / 2, CHESSBOARD_WIDTH / 2],
    );

    // 四面围墙
    addStaticBody(
      CHESSBOARD_LENGTH / 2 + BOUNDARY_THICKNESS / 2,
      BOUNDARY_HEIGHT / 2,
      0,
      [BOUNDARY_THICKNESS / 2, BOUNDARY_HEIGHT / 2, CHESSBOARD_WIDTH / 2],
    );
    addStaticBody(
      -CHESSBOARD_LENGTH / 2 + BOUNDARY_THICKNESS / 2,
      BOUNDARY_HEIGHT / 2,
      0,
      [BOUNDARY_THICKNESS / 2, BOUNDARY_HEIGHT / 2, CHESSBOARD_WIDTH / 2],
    );
    addStaticBody(
      0,
      BOUNDARY_HEIGHT / 2,
      CHESSBOARD_WIDTH / 2 + BOUNDARY_THICKNESS / 2,
      [CHESSBOARD_LENGTH / 2, BOUNDARY_HEIGHT / 2, BOUNDARY_THICKNESS / 2],
    );
    addStaticBody(
      0,
      BOUNDARY_HEIGHT / 2,
      -CHESSBOARD_WIDTH / 2 + BOUNDARY_THICKNESS / 2,
      [CHESSBOARD_LENGTH / 2, BOUNDARY_HEIGHT / 2, BOUNDARY_THICKNESS / 2],
    );

    // 骰子
    const bodies: OIMO.dynamics.rigidbody.RigidBody[] = [];
    for (let i = 0; i < diceCount; i++) {
      const { x, z } = diceInitPosition(i, diceCount);
      const rot = initRotations[i];

      const config = new OIMO.dynamics.rigidbody.RigidBodyConfig();
      config.type = OIMO.dynamics.rigidbody.RigidBodyType.DYNAMIC;
      config.position = new OIMO.common.Vec3(x, DICE_INIT_HEIGHT, z);
      config.rotation = new OIMO.common.Mat3(1, 0, 0, 0, 1, 0, 0, 0, 1);
      config.linearDamping = 0.05;
      config.angularDamping = 0.05;

      const body = new OIMO.dynamics.rigidbody.RigidBody(config);

      const euler = new THREE.Euler().setFromQuaternion(
        new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w),
        "XYZ",
      );
      body.setRotationXyz(
        new OIMO.common.Vec3(euler.x, euler.y, euler.z),
      );

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
      shapeConfig.density = colliderConfig.mass / OCTAHEDRON_VOLUME;

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
