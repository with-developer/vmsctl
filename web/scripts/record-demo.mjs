// Records what the dashboard asks of `vmsctl server demo`, for the static live demo (site/demo): the answers are saved as one JSON
// file, which the demo build reads instead of a server (src/lib/demoApi.ts). The demo fleet is made up, so nothing here is real data.
//
// usage: node scripts/record-demo.mjs BASE_URL READ_TOKEN OUT.json
import { writeFileSync } from "node:fs";
import { demoKey as key } from "../src/lib/demoKey.js";

const [base, token, out] = process.argv.slice(2);
if (!base || !token || !out) {
  console.error("usage: node scripts/record-demo.mjs BASE_URL READ_TOKEN OUT.json");
  process.exit(2);
}

const STALE = 7;
const data = {};

async function get(path, { optional = false } = {}) {
  const res = await fetch(base + path, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    if (optional) return null;
    throw new Error(`${path}: ${res.status}`);
  }
  return res.json();
}

async function record(path, opts) {
  const body = await get(path, opts);
  if (body !== null) data[key(path)] = body;
  return body;
}

// The pages that count controls ask for the chosen profile: each of them is recorded for every profile of the demo fleet.
const profiles = ((await record("/api/v1/profiles"))?.profiles ?? []).map((p) => p.id);
const withProfile = (path, p) => path + (path.includes("?") ? "&" : "?") + "profile=" + encodeURIComponent(p);

const latest = new Set();
const pairs = new Set();
const controls = new Map();
const assets = new Map();
for (const p of profiles) {
  await record(withProfile(`/api/v1/overview?staleDays=${STALE}`, p));
  for (const days of [7, 30, 90]) await record(withProfile(`/api/v1/trend?days=${days}`, p));
  for (const c of (await record(withProfile("/api/v1/controls", p)))?.controls ?? []) controls.set(`${c.profile}/${c.id}`, c);
  await record(withProfile(`/api/v1/matrix?staleDays=${STALE}`, p));

  // Every host and image the lists can show: the list of each kind in full (the demo filters and sorts it itself).
  const hosts = await record(withProfile(`/api/v1/hosts?staleDays=${STALE}&limit=500&kind=host`, p));
  const images = await record(withProfile(`/api/v1/hosts?staleDays=${STALE}&limit=500&kind=image`, p), { optional: true });
  // The demo filters the recorded list itself, so the list must be complete.
  if ((hosts?.total ?? 0) > 500 || (images?.total ?? 0) > 500) throw new Error("the demo fleet is larger than one page of 500: record it in pages");
  for (const h of [...(hosts?.hosts ?? []), ...(images?.hosts ?? [])]) {
    assets.set(h.id, h);
    const detail = await record(withProfile(`/api/v1/hosts/${h.id}?staleDays=${STALE}`, p));
    if (detail.scans?.length) latest.add(detail.scans[0].id);
    // The "compare" button of a scan in the history: it asks for the scan and the one before it.
    for (let i = 0; i + 1 < (detail.scans?.length ?? 0); i++) pairs.add(`${detail.scans[i + 1].id}/${detail.scans[i].id}`);
  }
}
// What does not depend on the profile, once.
for (const id of assets.keys()) await record(`/api/v1/hosts/${id}/agent`, { optional: true });
for (const pair of pairs) {
  const [older, newer] = pair.split("/");
  await record(`/api/v1/diff?old=${older}&new=${newer}`, { optional: true });
}
for (const id of latest) await record(`/api/v1/scans/${id}`);
for (const c of controls.values()) {
  await record(`/api/v1/controls/${encodeURIComponent(c.profile)}/${encodeURIComponent(c.id)}?staleDays=${STALE}`);
}

// When it was recorded: the demo moves every time forward by the age of the file, so "41 minutes ago" stays that.
data.__recordedAt = new Date().toISOString();
writeFileSync(out, JSON.stringify(data));
const kb = Math.round(JSON.stringify(data).length / 1024);
console.error(`recorded ${Object.keys(data).length} answers, ${kb} KB, ${profiles.length} profiles, ${assets.size} hosts and images, ${controls.size} controls`);
