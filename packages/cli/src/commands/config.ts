import type { CommandDefinition } from "../cli/types.js";
import { loadConfig, printConfig, setConfigValue } from "../config/config.js";
import { isConfigKey } from "../config/types.js";
import { getConfigPath } from "../config/xdg.js";

const configGetCommand: CommandDefinition = {
  name: "get",
  summary: "Show config values",
  description: "Show the full Quick CLI config or one config value.",
  arguments: [
    {
      name: "key",
      description: "Config key to read. Currently supported: remote",
    },
  ],
  examples: ["quick config get", "quick config get remote"],
  execute: async ({ positionals }) => {
    const [key, extra] = positionals;

    if (extra !== undefined) {
      throw new Error("Too many arguments. Usage: quick config get [key]");
    }

    const config = await loadConfig();

    if (key === undefined) {
      printConfig(config);
      return;
    }

    if (!isConfigKey(key)) {
      throw new Error(`Unknown config key: ${key}`);
    }

    const value = config[key];
    if (value !== undefined) {
      console.log(value);
    }
  },
};

const configSetCommand: CommandDefinition = {
  name: "set",
  summary: "Set a config value",
  description: "Create or update the Quick CLI config file with a config value.",
  arguments: [
    {
      name: "key",
      description: "Config key to set. Currently supported: remote",
      required: true,
    },
    {
      name: "value",
      description: "Value to store for the config key",
      required: true,
    },
  ],
  examples: ["quick config set remote https://quick.example.com"],
  execute: async ({ positionals }) => {
    const [key, value, extra] = positionals;

    if (key === undefined || value === undefined) {
      throw new Error("Missing arguments. Usage: quick config set <key> <value>");
    }

    if (extra !== undefined) {
      throw new Error("Too many arguments. Usage: quick config set <key> <value>");
    }

    if (!isConfigKey(key)) {
      throw new Error(`Unknown config key: ${key}`);
    }

    await setConfigValue(key, value);
    console.log(`${key} = ${value}`);
  },
};

const configPathCommand: CommandDefinition = {
  name: "path",
  summary: "Show config file path",
  description: "Print the XDG config.json path used by the Quick CLI.",
  examples: ["quick config path"],
  execute: async ({ positionals }) => {
    if (positionals.length > 0) {
      throw new Error("Too many arguments. Usage: quick config path");
    }

    console.log(getConfigPath());
  },
};

export const configCommand: CommandDefinition = {
  name: "config",
  summary: "Inspect and update CLI config",
  description: "Inspect and update the XDG config used by the Quick CLI.",
  subcommands: [configGetCommand, configSetCommand, configPathCommand],
  examples: ["quick config", "quick config get remote", "quick config set remote https://quick.example.com", "quick config path"],
  execute: async ({ positionals }) => {
    if (positionals.length > 0) {
      throw new Error(`Unknown subcommand for config: ${positionals[0]}`);
    }

    console.log(getConfigPath());
    printConfig(await loadConfig());
  },
};
