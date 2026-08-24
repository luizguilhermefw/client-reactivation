export type EvolutionInstanceConnectionState =
  | 'PROVISIONING'
  | 'WAITING_QR'
  | 'CONNECTED'
  | 'DISCONNECTED';

export interface EvolutionInstanceSnapshot {
  connectionStatus: EvolutionInstanceConnectionState;
  qrCode?: string;
  connectedPhone?: string;
}

export interface EvolutionInstanceProvisioningClient {
  createInstance(instanceName: string): Promise<EvolutionInstanceSnapshot>;
  inspectInstance(
    instanceName: string,
  ): Promise<EvolutionInstanceSnapshot | null>;
  getConnectionState(instanceName: string): Promise<EvolutionInstanceSnapshot>;
  getQrCode(instanceName: string): Promise<EvolutionInstanceSnapshot>;
}

export class EvolutionInstanceProvisioningError extends Error {
  constructor(message = 'Evolution instance operation failed') {
    super(message);
    this.name = 'EvolutionInstanceProvisioningError';
  }
}
