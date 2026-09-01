import { TwitterApi, type TwitterApiReadWrite } from 'twitter-api-v2';
import { config, hasXCredentials } from '../config';
import { log } from '../logger';

const l = log('x');

let rw: TwitterApiReadWrite | null = null;

function client(): TwitterApiReadWrite {
  if (rw) return rw;
  if (!hasXCredentials()) throw new Error('X credentials missing. Set X_APP_KEY / X_APP_SECRET / X_ACCESS_TOKEN / X_ACCESS_SECRET, or keep DRY_RUN=true.');
  rw = new TwitterApi({
    appKey: config.x.appKey,
    appSecret: config.x.appSecret,
    accessToken: config.x.accessToken,
    accessSecret: config.x.accessSecret,
  }).readWrite;
  return rw;
}

export interface PostInput { text: string; media?: Buffer; replyTo?: string }

export async function postToX(input: PostInput): Promise<string> {
  const c = client();
  let mediaIds: string[] | undefined;

  if (input.media) {
    const id = await c.v1.uploadMedia(input.media, { mimeType: 'image/png' });
    mediaIds = [id];
  }

  const res = await c.v2.tweet({
    text: input.text,
    ...(mediaIds ? { media: { media_ids: mediaIds as [string] } } : {}),
    ...(input.replyTo ? { reply: { in_reply_to_tweet_id: input.replyTo } } : {}),
  });

  l.info(`posted ${res.data.id}`);
  return res.data.id;
}

export async function whoAmI(): Promise<{ id: string; username: string }> {
  const me = await client().v2.me();
  return { id: me.data.id, username: me.data.username };
}

export interface Mention { id: string; text: string; authorId?: string }

/**
 * Mentions need read access, which the X free tier does not grant.
 * Module D stays off until the account has a plan that allows it.
 */
export async function fetchMentions(sinceId: string | null): Promise<Mention[]> {
  const userId = config.x.userId || (await whoAmI()).id;
  const res = await client().v2.userMentionTimeline(userId, {
    max_results: 20,
    ...(sinceId ? { since_id: sinceId } : {}),
    'tweet.fields': ['author_id', 'created_at', 'text'],
  });
  const out: Mention[] = [];
  for (const t of res.tweets ?? []) out.push({ id: t.id, text: t.text, authorId: t.author_id });
  return out.reverse();
}
