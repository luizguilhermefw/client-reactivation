export interface MetaCloudProviderConfig {
  accessToken: string;
  phoneNumberId: string;
  graphVersion: string;
  timeoutMs: number;
}

export interface MetaCloudConfigResolver {
  resolve(
    companyId: string,
    messagingChannelId: string,
  ): Promise<MetaCloudProviderConfig>;
}
