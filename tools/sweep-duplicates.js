#!/usr/bin/env node
// =====================================================================
// Block Appraisals - potential-duplicate contact sweep (local)
//
// Runs the intake form's duplicate-match logic across the WHOLE GHL
// contact list instead of against one loaded contact. Same address
// extraction, same normalization, same Dice+Jaccard similarity, same
// MIN_SCORE, so anything this flags the form would flag too.
//
// Zero dependencies. Node 18+ (native fetch).
//
// Auth: a Private Integration Token, never committed. Set it in the env:
//   PowerShell:  $env:GHL_PIT_TOKEN='pit-...'; node tools/sweep-duplicates.js
//   bash:        GHL_PIT_TOKEN=pit-... node tools/sweep-duplicates.js
//
// Options:
//   --out <file>        CSV path (default: sweep-duplicates-<date>.csv)
//   --min-score <n>     similarity threshold, 0..1 (default MATCH.MIN_SCORE)
//   --limit <n>         stop after fetching n contacts (for a quick trial)
//   --tag               WRITE: apply MATCH.DUP_TAG to every cluster member
//                       except its master (earliest dateAdded). Dry-run
//                       without it. Never tags a contact already tagged.
//   --include-tagged    also report contacts that already carry DUP_TAG
//
// Output: one CSV row per contact in a cluster, plus a console summary.
// No merge is ever performed; tagging is the only write, and only with --tag.
// =====================================================================

const fs = require('fs');
const path = require('path');

// ---------- CONFIG (mirrors lead-info-form.html) ---------------------

const LOCATION_ID = process.env.GHL_LOCATION_ID || 'iLvogjPhjDQFnI1DEE15';
const PIT_TOKEN   = process.env.GHL_PIT_TOKEN || '';
const API_BASE    = 'https://services.leadconnectorhq.com';
const API_VERSION = '2021-07-28';
const PAGE_SIZE   = 100;

const MATCH = {
  PLACEHOLDER_DOMAIN: 'blockappraisals.com',
  MIN_SCORE: 0.45,
  DUP_TAG: 'potential-duplicate-contact'
};

// Address-bearing custom field IDs (all four are read and scored).
const ADDR_CF = {
  client_address_list: 'qNftvFNpOGwG8vrfYrbT',
  property_addresses:  'NQPTwDR22oiN0JL5sKqz',
  cpropertylist:       '9JxOWq0zEq7qFN2yqOIf',
  property_list:       '4dASGQZrC4vur2n2Tiuc'
};
const ADDR_LIKE = /^\d+[A-Za-z]?(-\d+)?\s+\S/;

const ABBR = {
  street:'st', st:'st', avenue:'ave', ave:'ave', av:'ave',
  boulevard:'blvd', blvd:'blvd', drive:'dr', dr:'dr',
  road:'rd', rd:'rd', lane:'ln', ln:'ln', court:'ct', ct:'ct',
  place:'pl', pl:'pl', terrace:'ter', ter:'ter', trail:'trl', trl:'trl',
  parkway:'pkwy', pkwy:'pkwy', highway:'hwy', hwy:'hwy',
  apartment:'apt', apt:'apt', suite:'ste', ste:'ste', unit:'unit',
  floor:'fl', fl:'fl', north:'n', south:'s', east:'e', west:'w'
};

// ---------- ARGS -----------------------------------------------------

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i === -1 ? def : args[i + 1]; };
const flag = (name) => args.includes(name);

const OUT_FILE      = opt('--out', `sweep-duplicates-${new Date().toISOString().slice(0, 10)}.csv`);
const MIN_SCORE     = parseFloat(opt('--min-score', MATCH.MIN_SCORE));
const LIMIT         = parseInt(opt('--limit', '0'), 10) || 0;
const DO_TAG        = flag('--tag');
const INCLUDE_TAGGED = flag('--include-tagged');

if (!PIT_TOKEN) {
  console.error('GHL_PIT_TOKEN is not set. Export the Private Integration Token and re-run.');
  process.exit(1);
}

// ---------- ADDRESS EXTRACTION (verbatim from the form) --------------

function cfVal(contact, fieldId) {
  const arr = contact.customFields || contact.customField || [];
  for (const f of arr) if (f.id === fieldId) return f.value == null ? '' : String(f.value);
  return '';
}
function stripBlockLot(a) {
  a = (a || '').replace(/,\s*Lot\s+[^,]+\s*$/i, '').replace(/,\s*Block\s+[^,]+\s*$/i, '');
  return a.replace(/,\s*$/, '').trim();
}
function fromPropertyList(v) {
  return (v || '').split('|').map(e => {
    e = e.trim(); if (!e) return '';
    const i = e.indexOf(',');
    return stripBlockLot(i < 0 ? e : e.slice(i + 1).trim());
  }).filter(Boolean);
}
function fromCPropertyList(v) {
  return (v || '').split(/\r?\n/).map(l => {
    l = l.trim().replace(/^\*\s*/, '');
    const dash = l.lastIndexOf(' - ');
    if (dash > -1) l = l.slice(0, dash);
    return stripBlockLot(l.trim());
  }).filter(Boolean);
}
function fromPlain(v) {
  return (v || '').split(/[|\r\n]+/).map(s => stripBlockLot(s.trim())).filter(Boolean);
}
function displayName(c) {
  if (!c) return '(no name)';
  return c.contactName ||
    [c.firstName, c.lastName].filter(Boolean).join(' ') ||
    [c.firstNameLowerCase, c.lastNameLowerCase].filter(Boolean).join(' ') ||
    '(no name)';
}
function addressFromName(nm) {
  nm = (nm || '').trim();
  if (!nm || nm === '(no name)') return '';
  if (ADDR_LIKE.test(nm)) return nm;
  const parts = fromPropertyList(nm);
  return (parts.length && ADDR_LIKE.test(parts[0])) ? parts[0] : '';
}
function normAddr(s) {
  s = (s || '').toLowerCase().replace(/[.,#]/g, ' ').replace(/[^a-z0-9\s]/g, ' ');
  return s.split(/\s+/).filter(Boolean).map(t => ABBR[t] || t).join(' ').trim();
}
function uniqAddrs(list) {
  const seen = {}; const res = [];
  list.forEach(a => { a = (a || '').trim(); const k = normAddr(a); if (a && k && !seen[k]) { seen[k] = 1; res.push(a); } });
  return res;
}
function candidateAddresses(contact) {
  let out = [];
  if (contact.address1) out.push(String(contact.address1));
  const nmAddr = addressFromName(displayName(contact));
  if (nmAddr) out.push(nmAddr);
  out = out.concat(fromPlain(cfVal(contact, ADDR_CF.client_address_list)));
  out = out.concat(fromPlain(cfVal(contact, ADDR_CF.property_addresses)));
  out = out.concat(fromCPropertyList(cfVal(contact, ADDR_CF.cpropertylist)));
  out = out.concat(fromPropertyList(cfVal(contact, ADDR_CF.property_list)));
  return uniqAddrs(out);
}
function isPlaceholder(c) { return ((c && c.email) || '').toLowerCase().includes('@' + MATCH.PLACEHOLDER_DOMAIN); }
function hasDupTag(c) { return ((c && c.tags) || []).some(t => String(t).toLowerCase() === MATCH.DUP_TAG); }

// ---------- SIMILARITY (verbatim from the form) ----------------------

function bigrams(s) {
  const b = {}; s = s.replace(/\s+/g, '');
  for (let i = 0; i < s.length - 1; i++) { const g = s.substr(i, 2); b[g] = (b[g] || 0) + 1; }
  return b;
}
function dice(a, b) {
  const ba = bigrams(a), bb = bigrams(b); let inter = 0, sa = 0, sb = 0;
  for (const k in ba) { sa += ba[k]; if (bb[k]) inter += Math.min(ba[k], bb[k]); }
  for (const k in bb) sb += bb[k];
  return (sa + sb) ? (2 * inter) / (sa + sb) : 0;
}
function jaccard(a, b) {
  const A = {}, B = {}; let inter = 0, uni = 0;
  a.forEach(t => { A[t] = 1; }); b.forEach(t => { B[t] = 1; });
  for (const k in A) { uni++; if (B[k]) inter++; }
  for (const k in B) if (!A[k]) uni++;
  return uni ? inter / uni : 0;
}
function addrSimilarity(a, b) {
  const na = normAddr(a), nb = normAddr(b);
  if (!na || !nb) return 0;
  let score = 0.5 * dice(na, nb) + 0.5 * jaccard(na.split(' '), nb.split(' '));
  const numA = (na.match(/^\d+/) || [])[0], numB = (nb.match(/^\d+/) || [])[0];
  if (numA && numB) score = (numA === numB) ? Math.min(1, score + 0.15) : score * 0.5;
  return score;
}
// Blocking key per address: "123 main" when a house number + street word
// exists, else the zip. Pairs are only scored when they share a key, which
// is what the form's OR search does server-side. The key is taken from the
// NORMALIZED address so "401 East 60th" and "401 E 60th" block together.
function blockKeys(addr) {
  const keys = [];
  const n = normAddr(addr);
  const m = n.match(/^(\d+[a-z]?(?:-\d+)?)\s+([a-z0-9]+)/);
  if (m) keys.push(m[1] + ' ' + m[2]);
  else { const zip = (addr.match(/\b\d{5}\b/) || [])[0]; if (zip) keys.push('zip:' + zip); }
  return keys;
}

// ---------- GHL API --------------------------------------------------

function headers() {
  return { Authorization: `Bearer ${PIT_TOKEN}`, Version: API_VERSION, 'Content-Type': 'application/json', Accept: 'application/json' };
}
async function ghl(method, url, body) {
  const res = await fetch(API_BASE + url, { method, headers: headers(), body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${url} -> HTTP ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : {};
}
// Search endpoint returns customFields inline, which the form relies on.
async function fetchAllContacts() {
  const all = [];
  for (let page = 1; ; page++) {
    const d = await ghl('POST', '/contacts/search', { locationId: LOCATION_ID, page, pageLimit: PAGE_SIZE });
    const batch = d.contacts || [];
    all.push(...batch);
    process.stderr.write(`\rfetched ${all.length}${d.total ? ' / ' + d.total : ''}`);
    if (batch.length < PAGE_SIZE) break;
    if (LIMIT && all.length >= LIMIT) break;
  }
  process.stderr.write('\n');
  return LIMIT ? all.slice(0, LIMIT) : all;
}
async function tagContact(id) {
  await ghl('POST', `/contacts/${id}/tags`, { tags: [MATCH.DUP_TAG] });
}

// ---------- CLUSTERING -----------------------------------------------

// Union-find so A~B and B~C land in one cluster even if A and C never scored.
function makeUF() {
  const parent = {};
  const find = x => {
    if (parent[x] === undefined) parent[x] = x;
    while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
    return x;
  };
  const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[a] = b; };
  return { find, union };
}

function csvCell(v) {
  v = v == null ? '' : String(v);
  return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}

// ---------- MAIN -----------------------------------------------------

(async () => {
  console.error(`Sweeping location ${LOCATION_ID} (min score ${MIN_SCORE}${DO_TAG ? ', TAGGING ENABLED' : ', dry run'})`);
  const contacts = await fetchAllContacts();

  // Address list per contact, and the blocking index.
  const addrs = {};       // id -> [address]
  const byKey = {};       // blocking key -> Set(id)
  const byId = {};
  let withAddr = 0;
  for (const c of contacts) {
    if (!c || !c.id) continue;
    if (!INCLUDE_TAGGED && hasDupTag(c)) continue;
    byId[c.id] = c;
    const a = candidateAddresses(c);
    if (!a.length) continue;
    withAddr++;
    addrs[c.id] = a;
    for (const addr of a) for (const k of blockKeys(addr)) (byKey[k] ||= new Set()).add(c.id);
  }
  console.error(`${contacts.length} contacts, ${withAddr} with at least one address, ${Object.keys(byKey).length} blocking keys`);

  // Score every pair sharing a blocking key, once.
  const uf = makeUF();
  const pairScore = {};   // "a|b" (sorted) -> {score, addrA, addrB}
  for (const ids of Object.values(byKey)) {
    const list = [...ids];
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const [a, b] = list[i] < list[j] ? [list[i], list[j]] : [list[j], list[i]];
      const key = a + '|' + b;
      if (pairScore[key]) continue;
      let best = 0, bestA = '', bestB = '';
      for (const x of addrs[a]) for (const y of addrs[b]) { const s = addrSimilarity(x, y); if (s > best) { best = s; bestA = x; bestB = y; } }
      pairScore[key] = { score: best, addrA: bestA, addrB: bestB };
      if (best >= MIN_SCORE) uf.union(a, b);
    }
  }

  // Assemble clusters.
  const clusters = {};
  for (const id of Object.keys(addrs)) { const root = uf.find(id); (clusters[root] ||= []).push(id); }
  const groups = Object.values(clusters).filter(g => g.length > 1);
  groups.sort((x, y) => y.length - x.length);

  // Per-member best score within its cluster, for the report.
  const bestIn = (id, group) => {
    let best = 0, via = '';
    for (const other of group) {
      if (other === id) continue;
      const key = id < other ? id + '|' + other : other + '|' + id;
      const p = pairScore[key];
      if (p && p.score > best) { best = p.score; via = id < other ? p.addrA : p.addrB; }
    }
    return { best, via };
  };

  // CSV
  const rows = [['cluster', 'master', 'contact_id', 'name', 'email', 'phone', 'date_added', 'best_score', 'matched_address', 'flags']];
  let members = 0;
  groups.forEach((group, gi) => {
    // Master = earliest dateAdded; ties broken by id for determinism.
    const master = [...group].sort((a, b) => (byId[a].dateAdded || '').localeCompare(byId[b].dateAdded || '') || a.localeCompare(b))[0];
    for (const id of group) {
      const c = byId[id];
      const { best, via } = bestIn(id, group);
      const flags = [isPlaceholder(c) && 'placeholder', hasDupTag(c) && 'already-tagged'].filter(Boolean).join(' ');
      rows.push([gi + 1, id === master ? 'MASTER' : '', id, displayName(c), c.email || '', c.phone || '', c.dateAdded || '', best.toFixed(2), via, flags]);
      members++;
    }
  });
  fs.writeFileSync(OUT_FILE, rows.map(r => r.map(csvCell).join(',')).join('\n') + '\n', 'utf8');

  // Console summary
  console.log(`\n${groups.length} cluster(s), ${members} contact(s) involved. CSV: ${path.resolve(OUT_FILE)}\n`);
  groups.slice(0, 25).forEach((group, gi) => {
    console.log(`#${gi + 1}  (${group.length})`);
    const master = rows.find(r => r[0] === gi + 1 && r[1] === 'MASTER')[2];
    for (const id of group) {
      const c = byId[id]; const { best, via } = bestIn(id, group);
      console.log(`   ${id === master ? '★' : ' '} ${displayName(c).padEnd(34).slice(0, 34)} ${(c.email || '').padEnd(32).slice(0, 32)} ${best.toFixed(2)}  ${via}`);
    }
  });
  if (groups.length > 25) console.log(`... ${groups.length - 25} more in the CSV`);

  // Optional write
  if (DO_TAG) {
    const toTag = [];
    groups.forEach((group, gi) => {
      const master = rows.find(r => r[0] === gi + 1 && r[1] === 'MASTER')[2];
      for (const id of group) if (id !== master && !hasDupTag(byId[id])) toTag.push(id);
    });
    console.log(`\nTagging ${toTag.length} contact(s) as "${MATCH.DUP_TAG}" ...`);
    let ok = 0, bad = 0;
    for (const id of toTag) {
      try { await tagContact(id); ok++; }
      catch (e) { bad++; console.error(`  ${id}: ${e.message}`); }
      await new Promise(r => setTimeout(r, 120)); // stay under GHL's burst limit
    }
    console.log(`Tagged ${ok}, failed ${bad}.`);
  } else if (groups.length) {
    console.log(`\nDry run. Review the CSV, then re-run with --tag to tag every non-master member.`);
  }
})().catch(e => { console.error('\n' + e.message); process.exit(1); });
