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

/** 轻量三维向量（避免与 three 实例绑定） */
export interface Vec3Like {
  x: number;
  y: number;
  z: number;
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
    /** 覆盖默认初始散布位置（重投"原地下落"用）；y 为下落起始高度。
     *  缺省：diceInitPosition + board.diceInitHeight */
    initPositions?: readonly Vec3Like[];
    /** 初始角速度（rad/s），缺省 0（静止下落） */
    angularVelocities?: readonly Vec3Like[];
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
