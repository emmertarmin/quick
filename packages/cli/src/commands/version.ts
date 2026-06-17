import type { CommandDefinition } from "../cli/types.js";
import { printVersion } from "../version.js";

export const versionCommand: CommandDefinition = {
  name: "version",
  aliases: ["v"],
  summary: "Show version",
  description: "Print the installed quick version.",
  examples: ["quick version", "quick --version"],
  execute: async () => {
    printVersion();
  },
};
