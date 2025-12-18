
export enum RiskLevel {
  NORMAL = 'NORMAL',
  ATTENTION = 'ATTENTION',
  HIGH = 'HIGH',
}

export enum DocStatus {
  PENDING = 'PENDING',
  REVIEWING = 'REVIEWING',
  MISSING_INFO = 'MISSING_INFO',
  APPROVED = 'APPROVED',
}

export interface Ship {
  id: string;
  name: string;
  cnName?: string;
  mmsi: string;
  flag: string;
  type: string;
  eta: string; // ISO string
  etd: string; // ISO string
  draught?: number;
  length?: number;
  width?: number;
  dwt?: number;
  dest?: string;
  etaUtc?: number;
  lastTime?: string;
  lastTimeUtc?: number;
  riskLevel: RiskLevel;
  riskReason?: string;
  docStatus: DocStatus;
  lastPort: string;
  agent: string;
}

export interface WorkloadStat {
  timeSlot: string;
  count: number;
  riskHigh: number;
  riskAttention: number;
}

// Shipxy API Types
export interface ShipxyShip {
  mmsi: number;
  ship_name: string;
  ship_cnname?: string;
  imo: number;
  dwt: number;
  ship_type: string;
  length: number;
  width: number;
  draught: number;
  preport_cnname: string;
  last_time: string;
  last_time_utc: number;
  eta: string;
  eta_utc: number;
  dest: string;
  ship_flag: string;
}

export interface ShipxyResponse {
  status: number;
  msg: string;
  total: number;
  data: ShipxyShip[];
}

export interface ShipEvent {
  id?: string | number;
  port_code: string;
  mmsi: string;
  ship_flag?: string;
  event_type: string;
  detail: string;
  detected_at: number;
}
