import 'dotenv/config';
import { TwitterApi } from 'twitter-api-v2';

// App-only (OAuth 2.0 bearer) is what the usage endpoint wants.
const app = new TwitterApi({ appKey: process.env.X_APP_KEY, appSecret: process.env.X_APP_SECRET });
try {
  const bearer = await app.appLogin();
  const usage = await bearer.v2.get('usage/tweets');
  console.log('usage:', JSON.stringify(usage, null, 2).slice(0, 1200));
} catch (e) {
  console.log('usage failed:', e?.code, JSON.stringify(e?.data ?? e?.message ?? e).slice(0, 400));
}
