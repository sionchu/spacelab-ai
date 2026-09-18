import type { CreateMassInput } from "./types";

export type BuildingPresetId =
  | "house"
  | "retail"
  | "office"
  | "factory"
  | "warehouse"
  | "farm";

export type BuildingPreset = {
  id: BuildingPresetId;
  label: string;
  shortLabel: string;
  description: string;
  floorsLabel: string;
  silhouette: "house" | "retail" | "tower" | "factory" | "warehouse" | "farm";
  input: CreateMassInput;
};

export const buildingPresets: BuildingPreset[] = [
  {
    id: "house",
    label: "단독주택",
    shortLabel: "주택",
    description: "2층 규모의 소형 주거 매스",
    floorsLabel: "2층 · 7.2m",
    silhouette: "house",
    input: {
      name: "단독주택",
      intent: "단독주택 초기 배치안",
      footprint: { kind: "rectangle", widthM: 12, depthM: 10 },
      heightM: 7.2,
      floors: 2,
    },
  },
  {
    id: "retail",
    label: "저층 상가",
    shortLabel: "상가",
    description: "넓은 전면을 둔 저층 상업 매스",
    floorsLabel: "3층 · 12m",
    silhouette: "retail",
    input: {
      name: "저층 상가",
      intent: "저층 상업시설 초기 배치안",
      footprint: { kind: "rectangle", widthM: 24, depthM: 18 },
      heightM: 12,
      floors: 3,
    },
  },
  {
    id: "office",
    label: "업무시설",
    shortLabel: "업무",
    description: "중층 업무시설 기본 매스",
    floorsLabel: "6층 · 24m",
    silhouette: "tower",
    input: {
      name: "업무시설",
      intent: "중층 업무시설 초기 배치안",
      footprint: { kind: "rectangle", widthM: 28, depthM: 22 },
      heightM: 24,
      floors: 6,
    },
  },
  {
    id: "factory",
    label: "공장동",
    shortLabel: "공장",
    description: "층고가 높은 장방형 생산시설",
    floorsLabel: "1층 · 12m",
    silhouette: "factory",
    input: {
      name: "공장동",
      intent: "공장동 초기 배치안",
      footprint: { kind: "rectangle", widthM: 48, depthM: 30 },
      heightM: 12,
      floors: 1,
    },
  },
  {
    id: "warehouse",
    label: "창고동",
    shortLabel: "창고",
    description: "대면적 단층 물류·보관시설",
    floorsLabel: "1층 · 10m",
    silhouette: "warehouse",
    input: {
      name: "창고동",
      intent: "창고동 초기 배치안",
      footprint: { kind: "rectangle", widthM: 54, depthM: 34 },
      heightM: 10,
      floors: 1,
    },
  },
  {
    id: "farm",
    label: "농가 시설",
    shortLabel: "농가",
    description: "저층 장방형 농업시설",
    floorsLabel: "1층 · 8m",
    silhouette: "farm",
    input: {
      name: "농가 시설",
      intent: "농업시설 초기 배치안",
      footprint: { kind: "rectangle", widthM: 36, depthM: 18 },
      heightM: 8,
      floors: 1,
    },
  },
];
