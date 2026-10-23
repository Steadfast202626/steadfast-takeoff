// Background function (runs up to 15 minutes): joins the parts of a drawing and attaches it on Monday.com.
// It has no /api address. Only upload.mjs calls it, with a signed task.
import { getStore } from '@netlify/blobs';
import { finishUpload } from '../lib/jobs.mjs';

const uploads = async () => getStore({ name: 'uploads', consistency: 'strong' });

export default (req) => finishUpload(req, { env: process.env, fetch, uploads });
