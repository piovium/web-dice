import type * as THREE from "three";
import type { DiceWorldConfig } from "../config";

export interface PhysicsWorldConfig {
  gravity: [number, number, number];
  timestep: number;
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
    /** 已按 diceScale 预缩放的凸包顶点（x,y,z 交错） */
    convexHullPoints: Float32Array;
    /** 骰子缩放系数（n>8 时 <1；用于体积/密度换算） */
    diceScale: number;
    worldConfig: PhysicsWorldConfig;
    colliderConfig: ColliderConfig;
    /** 棋盘尺寸等世界参数（显式传参，替代旧全局 config） */
    board: DiceWorldConfig;
  }): IPhysicsWorld;
}

export interface IPhysicsWorld {
  step(): BodyTransform[];
  isSleeping(index: number): boolean;
  dispose(): void;
}
