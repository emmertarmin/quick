export type QuickConfig = {
  remote?: string;
};

export const configKeys = ["remote"] as const;
export type ConfigKey = (typeof configKeys)[number];

export function isConfigKey(value: string): value is ConfigKey {
  return configKeys.includes(value as ConfigKey);
}
