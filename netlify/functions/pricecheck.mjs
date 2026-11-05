import { pricecheck } from '../lib/pricecheck.mjs';
import { tokenStore } from '../lib/qbo.mjs';

export default (req) => pricecheck(req, { env: process.env, fetch, store: tokenStore });

export const config = { path: '/api/pricecheck' };
