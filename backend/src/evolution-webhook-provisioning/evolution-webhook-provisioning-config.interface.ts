export interface EvolutionWebhookProvisioningConfig {
  apiUrl: string;
  apiKey: string;
  instanceName: string;
  timeoutMs: number;
  publicUrl: string;
  secret: string;
}

export interface EvolutionWebhookProvisioningConfigResolver {
  resolve(companyId: string): EvolutionWebhookProvisioningConfig;
}
