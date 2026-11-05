import { flagPrice } from '../lib/postmortems.mjs';

export default (req) => flagPrice(req, { env: process.env, fetch });

export const config = { path: '/api/pricebook/flag' };
