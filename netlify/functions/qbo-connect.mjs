import { qboConnect } from '../lib/handlers.mjs';
import { tokenStore } from '../lib/qbo.mjs';

export default (req) => qboConnect(req, {
  env: process.env, store: tokenStore, fetch,
  delay: ms => new Promise(r => setTimeout(r, ms))
});

export const config = { path: '/api/qbo/connect' };
