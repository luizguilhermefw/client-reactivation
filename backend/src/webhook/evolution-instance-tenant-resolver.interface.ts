export interface EvolutionInstanceTenantResolver {
  resolveCompanyId(instanceName: string): Promise<string | null>;
}

export const EVOLUTION_INSTANCE_TENANT_RESOLVER = Symbol(
  'EVOLUTION_INSTANCE_TENANT_RESOLVER',
);
