import { drawing } from '../lib/jobs.mjs';

export default (req, context) => drawing(req, { env: process.env, fetch }, context.params || {});

export const config = { path: '/api/jobs/:id/drawings/:asset' };
