import { Injectable } from '@nestjs/common';
import type {
  EvolutionInstanceConnectionState,
  EvolutionInstanceProvisioningClient,
  EvolutionInstanceSnapshot,
} from './evolution-instance-provisioning-client.interface';
import { EvolutionInstanceProvisioningError } from './evolution-instance-provisioning-client.interface';

interface EvolutionHttpConfig {
  apiUrl: string;
  apiKey: string;
  timeoutMs: number;
}

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
    return this.parseSnapshot(instances[0]);
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
      const instanceSnapshot = await this.inspectInstance(instanceName);
      return {
        ...connectionSnapshot,
        ...(instanceSnapshot?.connectedPhone !== undefined
          ? { connectedPhone: instanceSnapshot.connectedPhone }
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
    const response = await this.request(
      `${config.apiUrl}/instance/connect/${encodeURIComponent(instanceName)}`,
      {
        method: 'GET',
        headers: { apikey: config.apiKey },
      },
      config.timeoutMs,
    );

    if (!response.ok) throw this.operationError();
    return this.parseSnapshot(await this.readJson(response));
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
    const rawState =
      this.stringValue(instance?.state) ??
      this.stringValue(instance?.status) ??
      this.stringValue(instance?.connectionStatus) ??
      this.stringValue(body.state) ??
      this.stringValue(body.status) ??
      this.stringValue(body.connectionStatus);
    const qrCode = this.findQrCode(body, instance);
    const connectedPhone =
      this.connectedPhoneValue(body.number) ??
      this.connectedPhoneValue(instance?.number);

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
