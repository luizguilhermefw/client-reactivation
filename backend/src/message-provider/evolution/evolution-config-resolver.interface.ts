export interface EvolutionProviderConfig {
  apiUrl: string;
  apiKey: string;
  instanceName: string;
  timeoutMs: number;
}

export interface EvolutionConfigResolver {
  resolve(companyId: string): EvolutionProviderConfig;
}
