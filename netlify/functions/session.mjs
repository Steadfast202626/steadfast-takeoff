import { session } from '../lib/jobs.mjs';

export default (req) => session(req, { env: process.env, fetch });

export const config = { path: '/api/session' };
