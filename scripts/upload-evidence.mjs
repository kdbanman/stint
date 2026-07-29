#!/usr/bin/env node
/**
 * Upload evidence binaries to the public R2 evidence bucket (issue #256).
 *
 *   node scripts/upload-evidence.mjs <prefix> <file...>
 *   e.g. node scripts/upload-evidence.mjs qa-evidence/issue-260 shots/broken.gif
 *        node scripts/upload-evidence.mjs acceptance/evidence/issue-261 before.png after.png
 *
 * Uploads each file to <prefix>/<basename> and prints the public URL.
 * Needs env: STINT_R2_ACCOUNT_ID, STINT_R2_ACCESS_KEY_ID, STINT_R2_SECRET_ACCESS_KEY.
 * Zero dependencies — hand-rolled SigV4 over node:crypto + fetch.
 * Refuses files over 5 MB: GitHub's Camo proxy drops larger images.
 */
import { createHash, createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

const BUCKET = process.env.STINT_R2_BUCKET ?? 'stint-evidence';
const PUBLIC_HOST = 'https://pub-110c939d8c384d6c9e201e5f888c1288.r2.dev';
const LIMIT = 5_000_000;
const TYPES = { png: 'image/png', gif: 'image/gif', webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg', mp4: 'video/mp4', txt: 'text/plain', md: 'text/markdown' };

const acct = process.env.STINT_R2_ACCOUNT_ID, key = process.env.STINT_R2_ACCESS_KEY_ID, secret = process.env.STINT_R2_SECRET_ACCESS_KEY;
if (!acct || !key || !secret) { console.error('set STINT_R2_ACCOUNT_ID / STINT_R2_ACCESS_KEY_ID / STINT_R2_SECRET_ACCESS_KEY'); process.exit(1); }
const [prefix, ...files] = process.argv.slice(2);
if (!prefix || !files.length) { console.error('usage: upload-evidence.mjs <prefix> <file...>'); process.exit(1); }

const sha256 = (d) => createHash('sha256').update(d).digest('hex');
const hmac = (k, d) => createHmac('sha256', k).update(d).digest();

async function put(objKey, body, type) {
  const host = `${acct}.r2.cloudflarestorage.com`;
  const now = new Date().toISOString().replace(/[-:]|\.\d{3}/g, '');
  const [date, amzDate] = [now.slice(0, 8), now];
  const payloadHash = sha256(body);
  const canonicalUri = `/${BUCKET}/` + objKey.split('/').map(encodeURIComponent).join('/');
  const headers = `content-type:${type}\nhost:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';
  const canonical = `PUT\n${canonicalUri}\n\n${headers}\n${signedHeaders}\n${payloadHash}`;
  const scope = `${date}/auto/s3/aws4_request`;
  const toSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256(canonical)}`;
  const sig = createHmac('sha256', hmac(hmac(hmac(hmac(`AWS4${secret}`, date), 'auto'), 's3'), 'aws4_request')).update(toSign).digest('hex');
  const res = await fetch(`https://${host}${canonicalUri}`, {
    method: 'PUT', body,
    headers: { 'Content-Type': type, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate,
      Authorization: `AWS4-HMAC-SHA256 Credential=${key}/${scope}, SignedHeaders=${signedHeaders}, Signature=${sig}` },
  });
  if (!res.ok) throw new Error(`PUT ${objKey}: ${res.status} ${await res.text()}`);
}

for (const f of files) {
  const body = await readFile(f);
  if (body.length > LIMIT) { console.error(`REFUSED ${f}: ${(body.length / 1e6).toFixed(1)} MB > 5 MB — re-encode first (see qa-gif-authoring)`); process.exitCode = 1; continue; }
  const objKey = `${prefix.replace(/\/$/, '')}/${basename(f)}`;
  const type = TYPES[f.split('.').pop().toLowerCase()] ?? 'application/octet-stream';
  await put(objKey, body, type);
  console.log(`${PUBLIC_HOST}/${objKey}`);
}
