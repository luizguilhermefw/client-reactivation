import { Injectable } from '@nestjs/common';
import type {
  EvolutionInstanceConnectionState,
  EvolutionInstanceProvisioningClient,
  EvolutionInstanceSnapshot,
  EvolutionPairingCodeSnapshot,
} from './evolution-instance-provisioning-client.interface';
import { EvolutionInstanceProvisioningError } from './evolution-instance-provisioning-client.interface';

interface EvolutionHttpConfig {
  apiUrl: string;
  apiKey: string;
  timeoutMs: number;
}

type EvolutionConnectArtifact = 'QR_CODE' | 'PAIRING_CODE';

@Injectable()
export class EnvEvolutionInstanceProvisioningClient implements EvolutionInstanceProvisioningClient {
  private static readonly DEFAULT_TIMEOUT_MS = 10_000;
  private static readonly MAX_QR_CODE_LENGTH = 5_000_000;

  async createInstance(
    instanceName: string,
  ): Promise<EvolutionInstanceSnapshot> {
    const config = this.getConfig();
    const response = await this.request(
      `${config.apiUrl}/instance/create`,
      {
        method: 'POST',
        headers: {
          apikey: config.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          instanceName,
          integration: 'WHATSAPP-BAILEYS',
          qrcode: true,
        }),
      },
      config.timeoutMs,
    );

    if (!response.ok) throw this.operationError();
    return this.parseSnapshot(await this.readJson(response));
  }

  async inspectInstance(
    instanceName: string,
  ): Promise<EvolutionInstanceSnapshot | null> {
    const config = this.getConfig();
    const instance = await this.fetchInstanceRecord(instanceName, config);
    return instance ? this.parseSnapshot(instance) : null;
  }

  private async fetchInstanceRecord(
    instanceName: string,
    config: EvolutionHttpConfig,
  ): Promise<Record<string, unknown> | null> {
    const response = await this.request(
      `${config.apiUrl}/instance/fetchInstances?instanceName=${encodeURIComponent(instanceName)}`,
      {
        method: 'GET',
        headers: { apikey: config.apiKey },
      },
      config.timeoutMs,
    );

    if (response.status === 404) return null;
    if (!response.ok) throw this.operationError();

    const body = await this.readJson(response);
    const instances = Array.isArray(body)
      ? body
      : this.isRecord(body) && Array.isArray(body.instances)
        ? body.instances
        : [];
    if (instances.length === 0) return null;
    if (!this.isRecord(instances[0])) throw this.operationError();
    return instances[0];
  }

  async getConnectionState(
    instanceName: string,
  ): Promise<EvolutionInstanceSnapshot> {
    const config = this.getConfig();
    const response = await this.request(
      `${config.apiUrl}/instance/connectionState/${encodeURIComponent(instanceName)}`,
      {
        method: 'GET',
        headers: { apikey: config.apiKey },
      },
      config.timeoutMs,
    );

    if (!response.ok) throw this.operationError();
    const connectionSnapshot = this.parseSnapshot(
      await this.readJson(response),
    );

    try {
      const instance = await this.fetchInstanceRecord(instanceName, config);
      const connectedNumber = instance
        ? this.findConnectedNumber(instance)
        : undefined;
      const staleDeviceRemoved =
        connectionSnapshot.connectionStatus === 'CONNECTED' &&
        connectedNumber === undefined &&
        instance !== null &&
        this.isStaleDeviceRemoved(instance);
      const connectedPhone = staleDeviceRemoved
        ? undefined
        : connectedNumber ??
          (instance ? this.findOwnerJidPhone(instance) : undefined);

      return {
        ...connectionSnapshot,
        ...(staleDeviceRemoved
          ? { connectionStatus: 'DISCONNECTED' as const }
          : {}),
        ...(connectedPhone !== undefined
          ? { connectedPhone }
          : {}),
      };
    } catch {
      // The connection-state endpoint remains authoritative. Failure to read
      // optional instance metadata must not invalidate a known technical state.
      return connectionSnapshot;
    }
  }

  async getQrCode(instanceName: string): Promise<EvolutionInstanceSnapshot> {
    const config = this.getConfig();
    const result = await this.connectWithStaleRecovery(
      instanceName,
      config,
      'QR_CODE',
    );
    const snapshot = this.parseSnapshot(result.body);

    if (result.recovered && !snapshot.qrCode) throw this.operationError();
    return snapshot;
  }

  async getPairingCode(
    instanceName: string,
    phone: string,
  ): Promise<EvolutionPairingCodeSnapshot> {
    const config = this.getConfig();
    const result = await this.connectWithStaleRecovery(
      instanceName,
      config,
      'PAIRING_CODE',
      phone,
    );
    return this.parsePairingCodeSnapshot(result.body);
  }

  private async connectWithStaleRecovery(
    instanceName: string,
    config: EvolutionHttpConfig,
    artifact: EvolutionConnectArtifact,
    phone?: string,
  ): Promise<{ body: unknown; recovered: boolean }> {
    const firstBody = await this.requestConnect(
      instanceName,
      config,
      phone,
    );
    if (this.hasConnectArtifact(firstBody, artifact)) {
      return { body: firstBody, recovered: false };
    }

    if (
      !(await this.isConfirmedStaleDeviceRemoved(
        instanceName,
        config,
        firstBody,
      ))
    ) {
      return { body: firstBody, recovered: false };
    }

    await this.logoutInstance(instanceName, config);
    return {
      body: await this.requestConnect(instanceName, config, phone),
      recovered: true,
    };
  }

  private async requestConnect(
    instanceName: string,
    config: EvolutionHttpConfig,
    phone?: string,
  ): Promise<unknown> {
    const query = phone === undefined ? '' : `?number=${encodeURIComponent(phone)}`;
    const response = await this.request(
      `${config.apiUrl}/instance/connect/${encodeURIComponent(instanceName)}${query}`,
      {
        method: 'GET',
        headers: { apikey: config.apiKey },
      },
      config.timeoutMs,
    );

    if (!response.ok) throw this.operationError();
    return this.readJson(response);
  }

  private async logoutInstance(
    instanceName: string,
    config: EvolutionHttpConfig,
  ): Promise<void> {
    const response = await this.request(
      `${config.apiUrl}/instance/logout/${encodeURIComponent(instanceName)}`,
      {
        method: 'DELETE',
        headers: { apikey: config.apiKey },
      },
      config.timeoutMs,
    );

    if (!response.ok) throw this.operationError();
  }

  private hasConnectArtifact(
    body: unknown,
    artifact: EvolutionConnectArtifact,
  ): boolean {
    if (!this.isRecord(body)) return false;
    const instance = this.isRecord(body.instance) ? body.instance : undefined;

    if (artifact === 'QR_CODE') {
      return this.findQrCode(body, instance) !== undefined;
    }

    const qrcode = this.isRecord(body.qrcode) ? body.qrcode : undefined;
    return (
      this.stringValue(body.pairingCode) !== undefined ||
      this.stringValue(instance?.pairingCode) !== undefined ||
      this.stringValue(qrcode?.pairingCode) !== undefined
    );
  }

  private async isConfirmedStaleDeviceRemoved(
    instanceName: string,
    config: EvolutionHttpConfig,
    connectBody: unknown,
  ): Promise<boolean> {
    if (!this.isRecord(connectBody)) return false;
    const connectInstance = this.isRecord(connectBody.instance)
      ? connectBody.instance
      : undefined;
    const rawState = this.findRawState(connectBody, connectInstance);

    try {
      if (this.normalizeState(rawState, undefined) !== 'CONNECTED') {
        return false;
      }
    } catch {
      return false;
    }

    let instance: Record<string, unknown> | null;
    try {
      instance = await this.fetchInstanceRecord(instanceName, config);
    } catch {
      return false;
    }

    return (
      instance !== null &&
      this.findConnectedNumber(connectBody, connectInstance) === undefined &&
      this.findConnectedNumber(instance) === undefined &&
      this.isStaleDeviceRemoved(instance)
    );
  }

  private getConfig(): EvolutionHttpConfig {
    const apiUrl = process.env.EVOLUTION_API_URL?.trim().replace(/\/+$/, '');
    const apiKey = process.env.EVOLUTION_API_KEY?.trim();
    const configuredTimeout = Number(process.env.EVOLUTION_REQUEST_TIMEOUT_MS);
    const timeoutMs =
      Number.isFinite(configuredTimeout) && configuredTimeout > 0
        ? configuredTimeout
        : EnvEvolutionInstanceProvisioningClient.DEFAULT_TIMEOUT_MS;

    if (!apiUrl || !apiKey || !this.isHttpUrl(apiUrl)) {
      throw new EvolutionInstanceProvisioningError(
        'Evolution instance configuration is incomplete',
      );
    }

    return { apiUrl, apiKey, timeoutMs };
  }

  private async request(
    url: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch {
      throw this.operationError();
    } finally {
      clearTimeout(timeout);
    }
  }

  private async readJson(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      throw this.operationError();
    }
  }

  private parseSnapshot(body: unknown): EvolutionInstanceSnapshot {
    if (!this.isRecord(body)) throw this.operationError();

    const instance = this.isRecord(body.instance) ? body.instance : undefined;
    const rawState = this.findRawState(body, instance);
    const qrCode = this.findQrCode(body, instance);
    const connectedPhone = this.findConnectedPhone(body, instance);

    if (!rawState && !qrCode) throw this.operationError();

    return {
      connectionStatus: this.normalizeState(rawState, qrCode),
      ...(qrCode ? { qrCode } : {}),
      ...(connectedPhone !== undefined ? { connectedPhone } : {}),
    };
  }

  private connectedPhoneValue(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value : undefined;
  }

  private findConnectedPhone(
    body: Record<string, unknown>,
    instance?: Record<string, unknown>,
  ): string | undefined {
    return (
      this.findConnectedNumber(body, instance) ??
      this.findOwnerJidPhone(body, instance)
    );
  }

  private findConnectedNumber(
    body: Record<string, unknown>,
    instance?: Record<string, unknown>,
  ): string | undefined {
    return (
      this.connectedPhoneValue(body.number) ??
      this.connectedPhoneValue(instance?.number)
    );
  }

  private findOwnerJidPhone(
    body: Record<string, unknown>,
    instance?: Record<string, unknown>,
  ): string | undefined {
    return (
      this.ownerJidPhoneValue(body.ownerJid) ??
      this.ownerJidPhoneValue(instance?.ownerJid)
    );
  }

  private ownerJidPhoneValue(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;

    const match = /^(\d+)@s\.whatsapp\.net$/.exec(value.trim());
    return match?.[1];
  }

  private isStaleDeviceRemoved(instance: Record<string, unknown>): boolean {
    if (instance.disconnectionReasonCode !== 401) return false;

    const rawDisconnection = instance.disconnectionObject;
    let disconnection: unknown;

    if (typeof rawDisconnection === 'string') {
      try {
        disconnection = JSON.parse(rawDisconnection) as unknown;
      } catch {
        return false;
      }
    } else {
      disconnection = rawDisconnection;
    }

    return this.hasDeviceRemovedConflict(disconnection);
  }

  private hasDeviceRemovedConflict(value: unknown, depth = 0): boolean {
    if (depth > 10 || value === null || typeof value !== 'object') {
      return false;
    }

    if (Array.isArray(value)) {
      return value.some((item) =>
        this.hasDeviceRemovedConflict(item, depth + 1),
      );
    }

    const record = value as Record<string, unknown>;
    const attributes = this.isRecord(record.attrs) ? record.attrs : undefined;
    const conflict = this.isRecord(record.conflict)
      ? record.conflict
      : undefined;

    if (
      (record.tag === 'conflict' && attributes?.type === 'device_removed') ||
      conflict?.type === 'device_removed'
    ) {
      return true;
    }

    return Object.values(record).some((item) =>
      this.hasDeviceRemovedConflict(item, depth + 1),
    );
  }

  private parsePairingCodeSnapshot(
    body: unknown,
  ): EvolutionPairingCodeSnapshot {
    if (!this.isRecord(body)) throw this.operationError();

    const instance = this.isRecord(body.instance) ? body.instance : undefined;
    const qrcode = this.isRecord(body.qrcode) ? body.qrcode : undefined;
    const pairingCode =
      this.stringValue(body.pairingCode) ??
      this.stringValue(instance?.pairingCode) ??
      this.stringValue(qrcode?.pairingCode);

    if (!pairingCode) throw this.operationError();

    const rawState = this.findRawState(body, instance);
    return {
      connectionStatus: rawState
        ? this.normalizeState(rawState, undefined)
        : 'WAITING_QR',
      pairingCode,
    };
  }

  private findRawState(
    body: Record<string, unknown>,
    instance?: Record<string, unknown>,
  ): string | undefined {
    return (
      this.stringValue(instance?.state) ??
      this.stringValue(instance?.status) ??
      this.stringValue(instance?.connectionStatus) ??
      this.stringValue(body.state) ??
      this.stringValue(body.status) ??
      this.stringValue(body.connectionStatus)
    );
  }

  private findQrCode(
    body: Record<string, unknown>,
    instance?: Record<string, unknown>,
  ): string | undefined {
    const containers = [body.qrcode, instance?.qrcode, body];

    for (const value of containers) {
      if (!this.isRecord(value)) continue;
      const candidate =
        this.stringValue(value.base64) ?? this.stringValue(value.code);
      if (
        candidate &&
        candidate.length <=
          EnvEvolutionInstanceProvisioningClient.MAX_QR_CODE_LENGTH
      ) {
        return candidate;
      }
    }

    return undefined;
  }

  private normalizeState(
    state: string | undefined,
    qrCode: string | undefined,
  ): EvolutionInstanceConnectionState {
    switch (state?.trim().toLowerCase()) {
      case 'open':
      case 'connected':
        return 'CONNECTED';
      case 'connecting':
        return 'WAITING_QR';
      case 'close':
      case 'closed':
      case 'disconnected':
        return qrCode ? 'WAITING_QR' : 'DISCONNECTED';
      case 'created':
      case 'provisioning':
        return qrCode ? 'WAITING_QR' : 'PROVISIONING';
      default:
        if (qrCode) return 'WAITING_QR';
        throw this.operationError();
    }
  }

  private stringValue(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }

  private isHttpUrl(value: string): boolean {
    try {
      const parsed = new URL(value);
      return (
        (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
        Boolean(parsed.hostname) &&
        !parsed.username &&
        !parsed.password
      );
    } catch {
      return false;
    }
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private operationError(): EvolutionInstanceProvisioningError {
    return new EvolutionInstanceProvisioningError();
  }
}
