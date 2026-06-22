export type JsonBlob = Record<string, unknown>;

export type QuickDocument = JsonBlob & {
  id: string;
  created_at: string;
  updated_at: string;
};

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

export type QuickLoginStartResponse = QuickAnonymousSession & {
  authorizationUrl: string;
  returnTo: string;
};

export type QuickLoginResponse =
  | (QuickAuthenticatedSession & {
      mode?: string;
      returnTo?: string;
    })
  | QuickLoginStartResponse;

export type QuickSite = {
  site: string;
  url: string;
  exists: true;
  hasIndex: boolean;
  lastDeployedAt?: string;
  lastDeployedBy?: QuickUser;
  fileCount?: number;
  thumbnailUrl?: string;
};

export type QuickSitesResponse = {
  sites: QuickSite[];
};
