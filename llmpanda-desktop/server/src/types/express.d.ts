import type { SessionUser } from '../services/auth.js';

// requireAuth attaches the resolved dashboard session (incl. active org) to the
// request. Declared here so every route sees `req.user` typed.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser;
      id?: string;
    }
  }
}

export {};
