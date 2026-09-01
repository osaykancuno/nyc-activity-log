import 'dotenv/config';
import { TwitterApi } from 'twitter-api-v2';

const c = new TwitterApi({
  appKey: process.env.X_APP_KEY, appSecret: process.env.X_APP_SECRET,
  accessToken: process.env.X_ACCESS_TOKEN, accessSecret: process.env.X_ACCESS_SECRET,
}).readWrite;

const show = (label, e) => {
  const d = e?.data ?? {};
  console.log(`${label.padEnd(18)} ${e?.code ?? '?'} ${d.title ?? ''} ${d.detail ?? e?.message ?? ''}`.trim());
};

try { const me = await c.v2.me(); console.log('me                 ok  @' + me.data.username); } catch (e) { show('me', e); }
try { const u = await c.v2.get('usage/tweets'); console.log('usage              ok ', JSON.stringify(u.data)); } catch (e) { show('usage', e); }
try { const id = await c.v1.uploadMedia(Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c4944415408d763f8ffff3f0005fe02fea735d2740000000049454e44ae426082','hex'), { mimeType: 'image/png' }); console.log('media upload       ok  id ' + id); } catch (e) { show('media upload', e); }
try { const t = await c.v2.tweet({ text: 'connection check ' + Date.now() }); console.log('text-only post     ok  ' + t.data.id); await c.v2.deleteTweet(t.data.id); console.log('deleted it again'); } catch (e) { show('text-only post', e); }
