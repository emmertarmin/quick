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
