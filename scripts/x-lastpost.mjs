import 'dotenv/config';
import { TwitterApi } from 'twitter-api-v2';

const c = new TwitterApi({
  appKey: process.env.X_APP_KEY, appSecret: process.env.X_APP_SECRET,
  accessToken: process.env.X_ACCESS_TOKEN, accessSecret: process.env.X_ACCESS_SECRET,
}).readWrite;

// Owned Read: your own timeline, $0.001 per post returned.
const res = await c.v2.userTimeline(process.env.X_USER_ID, {
  max_results: 5,
  'tweet.fields': ['created_at', 'attachments'],
  expansions: ['attachments.media_keys'],
  'media.fields': ['type', 'width', 'height', 'url'],
});
for (const t of res.tweets ?? []) {
  const media = (res.includes?.media ?? []).filter((m) => t.attachments?.media_keys?.includes(m.media_key));
  console.log(`\nhttps://x.com/${process.env.X_HANDLE ?? 'CapitanYOKO'}/status/${t.id}`);
  console.log(`posted ${t.created_at}`);
  console.log(`media: ${media.length ? media.map((m) => `${m.type} ${m.width}x${m.height}`).join(', ') : 'NONE'}`);
  console.log('---');
  console.log(t.text);
}
