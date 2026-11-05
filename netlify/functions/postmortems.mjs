import { postmortems } from '../lib/postmortems.mjs';

export default (req, context) => postmortems(req, { env: process.env, fetch }, context.params || {});

export const config = { path: '/api/postmortems/:id' };
