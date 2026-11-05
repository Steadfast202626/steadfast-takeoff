import { jobs } from '../lib/jobs.mjs';

export default (req, context) => jobs(req, { env: process.env, fetch }, context.params || {});

export const config = { path: ['/api/jobs', '/api/jobs/:id'] };
