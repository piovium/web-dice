import type * as THREE from "three";

export interface PhysicsWorldConfig {
  gravity: [number, number, number];
  timestep: number;
}

export interface RigidBodyConfig {
  type: "static" | "dynamic";
  translation: [number, number, number];
  rotation: [number, number, number, number];
}

export interface ColliderConfig {
  shape:
    | { kind: "cuboid"; halfExtents: [number, number, number] }
    | { kind: "convexHull"; points: Float32Array };
  mass: number;
  restitution: number;
}

export interface BodyTransform {
  translation: THREE.Vector3;
  rotation: THREE.Quaternion;
}

export interface DiceSimResult {
  initRotation: THREE.QuaternionLike;
  finalUpFace: number;
  sleepTime: number;
}

export interface IPhysicsBackend {
  init(): Promise<void>;
  createWorld(options: {
    diceCount: number;
    initRotations: THREE.QuaternionLike[];
    convexHullPoints: Float32Array;
    worldConfig: PhysicsWorldConfig;
    colliderConfig: ColliderConfig;
  }): IPhysicsWorld;
}

export interface IPhysicsWorld {
  step(): BodyTransform[];
  isSleeping(index: number): boolean;
  dispose(): void;
}
