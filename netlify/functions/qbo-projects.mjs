import { qboProjects } from '../lib/pricecheck.mjs';
import { tokenStore } from '../lib/qbo.mjs';

export default (req, context) => qboProjects(req, { env: process.env, fetch, store: tokenStore }, context.params || {});

export const config = { path: ['/api/qbo/projects', '/api/qbo/projects/:id/costs'] };
