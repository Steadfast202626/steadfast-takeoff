import { getStore } from '@netlify/blobs';
import { upload } from '../lib/jobs.mjs';

const uploads = async () => getStore({ name: 'uploads', consistency: 'strong' });

export default (req, context) => upload(req, { env: process.env, fetch, uploads, origin: new URL(req.url).origin }, context.params || {});

export const config = { path: ['/api/uploads/:upload', '/api/uploads/:upload/:part'] };
