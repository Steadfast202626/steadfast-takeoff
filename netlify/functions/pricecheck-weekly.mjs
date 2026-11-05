// The weekly price check: Mondays at 14:00 UTC (7 a.m. in Edmonton in winter, 8 a.m. in summer).
// It has no /api address; Netlify runs it on the schedule. It reads QuickBooks and marks moved
// prices "check" on the Monday.com Price book board. It never changes a cost.
import { runPriceCheck } from '../lib/pricecheck.mjs';
import { tokenStore } from '../lib/qbo.mjs';

export default async () => {
  try {
    const out = await runPriceCheck(process.env, { fetch, store: tokenStore }, 7);
    console.log('Price check: ' + out.flags.length + ' moved, ' + out.written + ' marked check, ' + out.bills + ' bills');
  } catch (e) {
    console.error('Price check did not run: ' + e.message);
  }
};

export const config = { schedule: '0 14 * * 1' };
