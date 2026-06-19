export type QuickUser = {
  id: string;
  email?: string;
  name?: string;
};

export type QuickAuthenticatedSession = {
  authenticated: true;
  user: QuickUser;
};

export type QuickAnonymousSession = {
  authenticated: false;
  user: null;
};

export type QuickSessionResponse = QuickAuthenticatedSession | QuickAnonymousSession;

export type QuickSiteStats = {
  site: string;
  url: string;
  exists: boolean;
  hasIndex: boolean;
  inspectedAt: string;
  deployment: null | {
    lastDeployedAt: string;
    lastDeployedBy: QuickUser;
    fileCount: number;
  };
  source: {
    fileCount: number;
    directoryCount: number;
    totalBytes: number;
    textFileCount: number;
    binaryFileCount: number;
    lineCount: number;
    extensions: { extension: string; files: number; bytes: number; lines: number }[];
    largestFiles: { path: string; bytes: number }[];
    apiUsage: {
      sdkImport: boolean;
      usesAuth: boolean;
      usesIdentity: boolean;
      usesFiles: boolean;
      usesRealtime: boolean;
      collections: string[];
      realtimeChannels: string[];
      realtimePresence: string[];
    };
  };
  database: {
    collectionCount: number;
    userCollectionCount: number;
    internalCollectionCount: number;
    documentCount: number;
    approxBytes: number;
    collections: {
      collection: string;
      documentCount: number;
      approxBytes: number;
      oldestCreatedAt: string | null;
      newestUpdatedAt: string | null;
      internal: boolean;
    }[];
  };
  files: {
    count: number;
    bytes: number;
    contentTypes: { contentType: string; files: number; bytes: number }[];
    largest: { id: string; name: string; content_type: string; size: number; created_at: string; updated_at: string }[];
    missingBlobs: string[];
    orphanBlobs: string[];
  };
  health: {
    checks: { name: string; status: string; count?: number }[];
    warnings: string[];
  };
};
