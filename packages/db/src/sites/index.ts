import type { QuickUser } from "@quick/shared";
import { db } from "../client";
import { Sites, type SiteRow } from "./sites.sql";

export type SiteMetadata = {
  site: string;
  exists: true;
  lastDeployedAt: string;
  lastDeployedBy: {
    id: string;
    email?: string;
    name?: string;
  };
  fileCount: number;
};

export type SiteDeployInput = {
  site: string;
  deployer: QuickUser;
  deployedAt: string;
  fileCount: number;
};

function rowToMetadata(row: SiteRow): SiteMetadata {
  return {
    site: row.name,
    exists: true,
    lastDeployedAt: row.lastDeployedAt,
    lastDeployedBy: {
      id: row.lastDeployedById,
      ...(row.lastDeployedByEmail ? { email: row.lastDeployedByEmail } : {}),
      ...(row.lastDeployedByName ? { name: row.lastDeployedByName } : {}),
    },
    fileCount: row.fileCount,
  };
}

export const sites = {
  all() {
    return Sites.all(db).map(rowToMetadata);
  },

  get(site: string) {
    const row = Sites.getByName(db, site);
    return row ? rowToMetadata(row) : undefined;
  },

  recordDeploy(input: SiteDeployInput) {
    return rowToMetadata(
      Sites.upsert(db, {
        name: input.site,
        lastDeployedAt: input.deployedAt,
        lastDeployedById: input.deployer.id,
        lastDeployedByEmail: input.deployer.email,
        lastDeployedByName: input.deployer.name,
        fileCount: input.fileCount,
      }),
    );
  },
};
