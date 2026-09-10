// =====================================================================
// Block Appraisals - Engagement Agreement field builder
// Zap step 3 - Code by Zapier (JavaScript). Runs AFTER 02-parse-webhook.js.
// Single deterministic step. Replaces the Anthropic "Send Message" step
// + its parser entirely.
//
// INPUT: map the trigger's raw JSON to an input variable named "body"
//        (recommended), OR map each field individually as input vars.
//        Field names expected: appraisalScenario, clientList,
//        clientAddressList, propertyList, contactPersonList,
//        additionalIntendedUsersList, appraisalEffectiveDate, dateOfDeath,
//        decedentName, twoStageRequired, inspectionType, appraisalFee,
//        estimatedTurnaround, email
//
// PLURALIZATION
// -------------
// Copy strings below use inline tokens: {key:singular|plural}
// The token resolves to the plural form when counts[key] > 1.
//
//   {p:property|properties}   p = number of properties on the engagement
//                                 (drives appraisals, reports, valuations,
//                                 inspections, sites)
//   {c:|s}                    c = number of named clients
//   {u:|s}                    u = number of additional intended users
//   {a:|s}                    a = LOCAL count for the block being rendered
//                                 (addresses in a requirement group, in an
//                                 approach group, or for one contact person)
//
// Empty singular is allowed: 'report{p:|s}' -> report / reports
// Possessives: building{a:'s|s'} -> building's / buildings'
//
// ADDRESS LENGTH
// --------------
// cpropertylist states each property in FULL (street, city, state, zip).
// Every other section restates addresses SHORT (street line only), because
// repeating "Brooklyn, NY 11232" nine times reads as noise. See shortAddress.
// =====================================================================

// ---------- EDITABLE COPY / CONFIG ----------------------------------

// A requirement line beginning with NOTE_MARKER renders as a plain line
// (no "* " bullet), preceded by a blank line. Use it for caveats/notes
// that should sit inside a requirement block without being a bullet.
const NOTE_MARKER = '::PLAIN::';

const CONDO_BULLETS = [
  'Common charge bill{a:|s} as of the effective date, where applicable.',
  'Name{a:|s} and contact details of the managing agent{a:|s} or board member{a:|s}.'
];

const COOP_BULLETS = [
  '{a:A copy|Copies} of {a:a maintenance bill|maintenance bills} as of the effective date, where applicable.',
  '{a:A copy|Copies} of the stock certificate{a:|s}, where applicable.',
  'Name{a:|s} and contact details of the managing agent{a:|s} or board member{a:|s}.',
  '{a:A cooperative questionnaire|Cooperative questionnaires} completed by the managing agent{a:|s} or board member{a:|s}, if applicable.',
  NOTE_MARKER + `If the managing agent{a:|s} {a:charges|charge} a fee for the cooperative questionnaire{a:|s}, {a:this cost|these costs} will be billed separately and {a:is|are} the client{c:'s|s'} responsibility.`
];

const COMMERCIAL_BULLETS = [
  `{a:A copy|Copies} of the building{a:'s|s'} rent roll{a:|s} including room counts for all residential units, monthly rents, and lease dates for all units (where applicable).`,
  'Copies of all leases that encumber the subject {a:property|properties} (where applicable).',
  '{a:A copy|Copies} of the expense page{a:|s} from the most recent tax return{a:|s}, if available, pertaining to the subject building{a:|s}.'
];

const LAND_BULLETS = [
  'Zoning {a:analysis|analyses} prepared by an architect, if applicable.',
  'Survey{a:|s} of the {a:property|properties}, if applicable.'
];

const SCENARIO_MAP = {
  'Divorce / Matrimonial': 'According to your instructions, the purpose of the appraisal{p:|s} is to determine fair market value for divorce proceedings.',
  'Partition / Buyout': 'According to your instructions, the purpose of the appraisal{p:|s} is to determine fair market value for purposes of partnership dissolution and/or buyout.',
  'Bankruptcy / Litigation': 'According to your instructions, the purpose of the appraisal{p:|s} is to determine fair market value for bankruptcy proceedings.',
  'Date of Death': 'According to your instructions, the purpose of the appraisal{p:|s} is to determine fair market value for estate settlement.',
  'Estate Planning': 'According to your instructions, the purpose of the appraisal{p:|s} is to determine fair market value for estate planning purposes.',
  'Gift Tax': 'According to your instructions, the purpose of the appraisal{p:|s} is to determine fair market value for gift tax purposes.',
  'Tax Appeal / Certiorari': 'According to your instructions, the purpose of the appraisal{p:|s} is to estimate the market value{p:|s} of the subject {p:property|properties} for use in connection with a real estate tax appeal (Certiorari).',
  'Pre-Listing (Seller)': 'The purpose of the appraisal{p:|s} is to estimate the market value{p:|s} of the subject {p:property|properties} for advisory purposes, including assisting the client{c:|s} in determining an appropriate asking price.',
  'Purchase Decision (Buyer)': 'The purpose of the appraisal{p:|s} is to estimate the market value{p:|s} of the subject {p:property|properties} for advisory purposes, including assisting the client{c:|s} in determining an appropriate purchase price.',
  'Buyout (Co-owner / Family)': 'According to your instructions, the purpose of the appraisal{p:|s} is to determine fair market value for purposes of partnership dissolution and/or buyout.',
  'Immigration / Asset Verification': 'According to your instructions, the purpose of the appraisal{p:|s} is to estimate the market value{p:|s} of the subject {p:property|properties} for asset verification purposes in connection with an immigration matter.',
  'Financial Disclosure': 'The purpose of the appraisal{p:|s} is to estimate the market value{p:|s} of the subject {p:property|properties} for financial disclosure purposes.',
  'Co-op Board / Limited Scope': 'According to your instructions, the purpose of the appraisal{p:|s} is to determine fair market value of the subject cooperative apartment{p:|s} for review by the cooperative board{p:|s} and/or managing agent{p:|s}.',
  'Measurement / Consulting': 'According to your instructions, the purpose of this assignment is to determine and/or verify the square footage of the subject {p:property|properties} due to {p:a potential discrepancy|potential discrepancies} with publicly available records, for use in marketing and listing purposes.',
  'Insurance / Replacement Cost': 'According to your instructions, the purpose of the appraisal{p:|s} is to estimate the replacement cost{p:|s} of the subject {p:property|properties} for insurable value.',
  'Internal Asset Management': `According to your instructions, the purpose of the appraisal{p:|s} is to estimate the current market value{p:|s} of the subject {p:property|properties} for the client{c:'s|s'} internal asset management and planning purposes.`
};

const GIFT_TAX_DONOR_TEMPLATE = `According to your instructions, the purpose of the appraisal{p:|s} is to determine fair market value for gifting {donor}'s interest in the above-mentioned {p:property|properties}.`;

const LITIGATION_SCENARIOS = [
  'Divorce / Matrimonial',
  'Partition / Buyout',
  'Bankruptcy / Litigation',
  'Tax Appeal / Certiorari',
  'Buyout (Co-owner / Family)'
];

// crequest: lead-in line that sits directly above cpropertylist.
// Scenarios in INSURABLE_SCENARIOS get the replacement-cost wording instead
// of the standard appraisal wording.
const REQUEST_STANDARD = 'At your request, the following {p:property|properties} will be appraised for this assignment:';
const REQUEST_INSURABLE = 'At your request, the insurable value{p:|s} of the following {p:property|properties} will be estimated for this assignment:';

const INSURABLE_SCENARIOS = [
  'Insurance / Replacement Cost'
];

// Inspection / scope paragraph. {inspection} is substituted with the raw
// inspectionType value; if that field is empty the token drops out cleanly
// and the sentence still reads "based on our inspection".
const INSPECTION_STANDARD = '{p:An appraisal|Appraisals} of the above {p:property|properties} {p:includes|include} {p:a complete description|complete descriptions} of the {p:property|properties} based on our {inspection} {p:inspection|inspections} and information available in public records as well as provided by the client{c:|s}. In addition, the subject {p:site|sites}, highest and best use, neighborhood, applicable zoning regulation{p:|s}, purpose and scope of the {p:analysis|analyses}, and market conditions are all summarized in the report{p:|s}.';

const INSPECTION_INSURABLE = 'The insurable value{p:|s} of the above {p:property|properties} {p:includes|include} {p:a full description|full descriptions} of the {p:property|properties} based on our {inspection} {p:inspection|inspections} and information available in public records, as well as information provided by the client{c:|s}, in support of our opinion{p:|s} of insurable value.';

const LITIGATION_CLAUSE = `In the event that we are required by subpoena or other legal processes to provide testimony or produce documents relating to our services under this agreement, whether in court, deposition, arbitration or in any other proceeding, and regardless of the identity of the party requiring such testimony or production of documents, the client{c:|s} {c:agrees|agree} to compensate us for the time incurred for our services in connection with the above, at our hourly rate prevalent at that time, and to reimburse our reasonable actual expenses. The client{c:|s} also {c:agrees|agree} to supply court transcripts of any testimony rendered upon request.`;

const FEE_PLACEHOLDER = '$900';
const TURNAROUND_DEFAULT = 'two weeks';

// Turnaround paragraph. {turnaround} is substituted with the estimatedTurnaround
// value, falling back to TURNAROUND_DEFAULT when the field arrives empty.
const TURNAROUND_SENTENCE = 'After receiving the payment and any requested information, and assuming that we are given access to the {p:property|properties} in a timely manner, we anticipate that we will require approximately {turnaround} for completion of the {p:report|reports}, or sooner if possible.';

// Fee copy. {fee} is substituted with the resolved fee value.
// The sentence renders on EVERY agreement. The table block is appended only
// on litigation scenarios.
const FEE_SENTENCE = 'As discussed, the total fee for this assignment is {fee}. Payment for the appraisal{p:|s} will be due at the time of {p:inspection|inspections} or sooner.';

// Markers consumed by the post-generation Apps Script, which styles the
// heading (bold + italic + underline) and converts the delimited rows into a
// borderless two-column table, then deletes the marker paragraphs.
const FEE_TABLE_START = '::FEETABLE::';
const FEE_TABLE_END = '::ENDFEETABLE::';
const FEE_COL_DELIM = '{TAB}';   // splits label column from value column
const FEE_CELL_BREAK = '{BR}';   // line break WITHIN the value cell
const FEE_TABLE_HEADING = 'Summary of Fees:';

// Dot leaders are literal characters (no API support for tab-stop leaders).
// Counts are tuned so all three labels terminate at roughly the same x in
// Times New Roman 12pt. Nudge the dot counts here if the column looks ragged.
// An empty row pair renders as a vertical spacer.
const FEE_TABLE_ROWS = [
  ['Appraisal Report{p:|s}..............................................', '{fee}'],
  ['Expert witness testimony or deposition............', '$3,000 per full day' + FEE_CELL_BREAK + '$2,000 per half day'],
  ['', ''],
  ['Additional conference or research time............', '$  500 per hour']
];

const APPROACH_TAIL = 'Consideration will be given to all applicable approaches to value based on the nature of the {p:property|properties}, the scope of work, the intended use of the appraisal{p:|s}, and the availability of relevant market data. The report{p:|s} {p:is|are} expected to include {p:a floorplan|floorplans}, {p:location map|location maps}, and photographs of {p:the subject property|each of the subject properties} and comparable sales, as applicable.';

// Above this many properties, capproachlist DROPS the per-address valuation
// sentences and runs opening + APPROACH_TAIL only. Listing which approach
// applies to which of nine addresses reads as a wall; the tail already says
// consideration is given to all applicable approaches. At or below the
// threshold the per-address sentences render (with short addresses).
const APPROACH_DETAIL_MAX_PROPERTIES = 3;

const TWO_STAGE_EXPLANATION = 'This assignment will be completed in two stages. First, we will analyze the Highest and Best Use of the {p:property|properties}, including whether a greater return would be achieved if the {p:property|properties} were considered for development versus {p:its|their} current use as improved. Second, the {p:property|properties} will be valued in accordance with {p:its|their} concluded Highest and Best Use, either as currently improved or as {p:a development site|development sites}.';

const TWO_STAGE_ASSUMPTIONS = `Our valuation{p:|s} will be based on the following assumptions: that the subject {p:property|properties} {p:is|are} not encumbered by any leases; that any existing improvements could be demolished (if applicable); that the {p:site|sites} would be available for development to {p:its|their} Highest and Best Use; and that there is no environmental contamination, and the {p:site|sites} {p:is|are} "clean". The value opinion{p:|s} of the subject {p:property|properties} will be at {p:its|their} Highest and Best Use. In addition, if we determine that the Highest and Best Use of the {p:site|sites} is that of {p:a development site|development sites}, the estimated cost of demolition of the existing improvements will be deducted from the final valuation{p:|s}.`;

// Appended to cappraisaldate on Date of Death engagements, so the effective
// date is tied to the death rather than left as a bare date.
// {decedent} is substituted with the decedent's name in "First Last" order.
// Drops out silently when decedentName is empty.
const DOD_DATE_SUFFIX = ', the date of the death of {decedent}';

const OUT_MONTHS = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'June', 'July', 'Aug.', 'Sep.', 'Oct.', 'Nov.', 'Dec.'];

// When a property has no contact person listed, the client(s) become the
// contact. Set to 'Mx. ' to carry the honorific into those sentences (which
// also makes the Apps Script recolor pass flag them for review).
const CLIENT_CONTACT_HONORIFIC = '';

// Source fields for client phone / email. These arrive as SINGLE top-level
// fields on the payload, not per-client lists, so they attach to the FIRST
// client only. With two or more clients there is no way to tell whose
// details these are, and duplicating them onto everyone would be worse.
const CLIENT_PHONE_FIELD = 'phone';
const CLIENT_EMAIL_FIELD = 'email';

// ---------- HELPERS -------------------------------------------------

function splitPipes(str) {
  return String(str || '')
    .split('|')
    .map(s => s.trim())
    .filter(s => s && s.toLowerCase() !== 'null');
}

// Same split, but empty slots are KEPT so that segment index N still lines up
// with property index N. splitPipes drops empties, which silently shifts every
// contact onto the wrong property as soon as one property has no contact
// person listed.
function splitPipesPositional(str) {
  return String(str || '')
    .split('|')
    .map(function (s) {
      const t = s.trim();
      return t.toLowerCase() === 'null' ? '' : t;
    });
}

// "Last, First" -> "First Last". No comma -> returned as-is.
function reverseName(name) {
  const s = String(name || '').trim();
  if (!s) return '';
  const idx = s.indexOf(',');
  if (idx === -1) return s;
  const last = s.slice(0, idx).trim();
  const first = s.slice(idx + 1).trim();
  return (first + ' ' + last).trim();
}

function joinWithAnd(items) {
  const arr = items.filter(x => x !== undefined && x !== null && String(x).length > 0);
  if (arr.length === 0) return '';
  if (arr.length === 1) return arr[0];
  if (arr.length === 2) return arr[0] + ' and ' + arr[1];
  return arr.slice(0, -1).join(', ') + ' and ' + arr[arr.length - 1];
}

const STREET_SUFFIX_RE = /\b(Street|St|Avenue|Ave|Drive|Dr|Road|Rd|Boulevard|Blvd|Lane|Ln|Court|Ct|Place|Pl|Terrace|Ter|Trail|Trl|Way|Circle|Cir|Parkway|Pkwy|Highway|Hwy|Loop|Run|Crossing|Xing|Square|Sq)\.?\b/gi;
const UNIT_RE = /^(#\S+|Apt\.?|Apartment|Unit|Suite|Ste\.?|Fl\.?|Floor|Rm\.?|Room)$/i;
const STATE_ZIP_RE = /^[A-Za-z]{2}\.?\s+\d{5}(-\d{4})?$/;

// Brooklyn's lettered avenues ("24 Avenue T", "1919 Avenue J"): the single
// letter after the suffix is part of the street name, not the start of the
// city. Without this, "24 Avenue T Brooklyn" splits as "24 Avenue" / "T
// Brooklyn".
const LETTER_STREET_RE = /^[A-Za-z]$/;

// Break "Street..., City, ST ZIP" into two lines: street line + "City, ST ZIP".
function breakAddress(address) {
  const parts = String(address || '').split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];

  if (parts.length === 2) {
    // Missing comma between street and city, e.g.
    // "500 Westover Drive Sanford" + "NC 27330"
    if (!STATE_ZIP_RE.test(parts[1])) return parts.join(', ');

    const streetPart = parts[0];
    // Find the LAST street suffix occurrence
    let match, lastMatch = null;
    STREET_SUFFIX_RE.lastIndex = 0;
    while ((match = STREET_SUFFIX_RE.exec(streetPart)) !== null) {
      lastMatch = match;
    }
    if (!lastMatch) return parts.join(', '); // can't safely split, leave as-is

    let streetEnd = lastMatch.index + lastMatch[0].length;
    let remainder = streetPart.slice(streetEnd).trim();

    // Keep unit designators with the street line: "Dr Apt 4B Sanford"
    let tokens = remainder.split(/\s+/).filter(Boolean);
    while (tokens.length > 1 && UNIT_RE.test(tokens[0])) {
      // consume designator + its value (e.g. "Apt" + "4B"), or just "#4B"
      const consumed = /^#/.test(tokens[0]) ? 1 : 2;
      const consumedStr = tokens.slice(0, consumed).join(' ');
      streetEnd = streetPart.indexOf(consumedStr, streetEnd) + consumedStr.length;
      tokens = tokens.slice(consumed);
    }

    // Lettered avenue: keep the letter with the street line.
    if (tokens.length > 1 && LETTER_STREET_RE.test(tokens[0])) {
      streetEnd = streetPart.indexOf(tokens[0], streetEnd) + tokens[0].length;
      tokens = tokens.slice(1);
    }

    const city = tokens.join(' ').trim();
    if (!city) return parts.join(', '); // suffix was the last word, no city to split off

    const streetLine = streetPart.slice(0, streetEnd).trim();
    return streetLine + '\n' + city + ', ' + parts[1];
  }

  // 3+ parts: original behavior
  const cityLine = parts.slice(-2).join(', ');
  const streetLine = parts.slice(0, -2).join(', ');
  return streetLine + '\n' + cityLine;
}

// "267-269 41st Street Brooklyn, NY 11232" -> "267-269 41st Street"
// Used by every section EXCEPT cpropertylist, which states properties in full.
// Falls back to the untouched address whenever breakAddress cannot identify a
// city, so an address it can't parse is never truncated into nonsense.
function shortAddress(address) {
  const broken = breakAddress(address);
  const idx = broken.indexOf('\n');
  return idx === -1 ? String(address || '').trim() : broken.slice(0, idx);
}

const MONTH_LOOKUP = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7,
  sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10,
  dec: 11, december: 11
};

// Reformat various date inputs to "Mon. DD, YYYY" (May/June/July spelled out).
function formatFriendlyDate(input) {
  const s = String(input || '').trim();
  if (!s) return '';
  let day, monthIdx, year, m;

  m = s.match(/^(\d{1,2})-([A-Za-z]+)-(\d{4})$/); // 27-NOV-2025
  if (m) { day = +m[1]; monthIdx = MONTH_LOOKUP[m[2].toLowerCase()]; year = m[3]; }

  if (monthIdx === undefined) {
    m = s.match(/^([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/); // November 27, 2025 / Nov. 27, 2025
    if (m) { monthIdx = MONTH_LOOKUP[m[1].toLowerCase()]; day = +m[2]; year = m[3]; }
  }
  if (monthIdx === undefined) {
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); // MM/DD/YYYY
    if (m) { monthIdx = (+m[1]) - 1; day = +m[2]; year = m[3]; }
  }
  if (monthIdx === undefined) {
    m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/); // YYYY-MM-DD
    if (m) { year = m[1]; monthIdx = (+m[2]) - 1; day = +m[3]; }
  }

  if (monthIdx === undefined || monthIdx < 0 || monthIdx > 11 || !day || !year) {
    return s; // unparseable -> pass through untouched
  }
  return OUT_MONTHS[monthIdx] + ' ' + day + ', ' + year;
}

// Normalize a fee to whole dollars with comma separators.
// "$950.00" -> "$950"   "1200" -> "$1,200"   "950.6" -> "$951"
// Anything that isn't a plain number passes through untouched, so a value
// like "TBD" or "$900 per property" won't get mangled.
function formatFee(input) {
  const s = String(input || '').trim();
  if (!s) return '';
  const cleaned = s.replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return s;
  const whole = Math.round(parseFloat(cleaned));
  return '$' + String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function parseProperties(propertyList) {
  return splitPipes(propertyList).map(entry => {
    const idx = entry.indexOf(',');
    const typeSubtypePart = idx === -1 ? entry.trim() : entry.slice(0, idx).trim();
    const address = idx === -1 ? '' : entry.slice(idx + 1).trim();
    const ts = typeSubtypePart.split(/\s+/);
    const type = ts[0] || '';
    const subtype = ts.slice(1).join(' ') || '';
    return { type, subtype, address };
  });
}

// Loose type matching: case-insensitive, punctuation and space tolerant.
// Falls back to the raw trimmed value so an unexpected type still shows up
// in the label rather than vanishing.
function normalizeType(input) {
  const t = String(input || '').toLowerCase().replace(/[^a-z]/g, '');
  if (t.indexOf('resid') === 0) return 'Residential';
  if (t.indexOf('comm') === 0) return 'Commercial';
  if (t.indexOf('land') === 0 || t.indexOf('vacant') === 0) return 'Land';
  return String(input || '').trim();
}

// "Condo", "condominium", "CONDOS" -> Condo
// "Co-op", "co op", "Cooperative", "coops" -> Co-op
// Anything unrecognized returns '' so the lookup falls through to the base
// type bullets instead of erroring.
function normalizeSubtype(input) {
  const s = String(input || '').toLowerCase().replace(/[^a-z]/g, '');
  if (!s) return '';
  if (s.indexOf('condo') === 0) return 'Condo';
  if (s.indexOf('coop') === 0) return 'Co-op';
  return '';
}

function getRequirements(rawType, rawSubtype) {
  const type = normalizeType(rawType);
  const subtype = normalizeSubtype(rawSubtype);
  let lines = [];
  if (type === 'Residential') {
    if (subtype === 'Condo') lines = lines.concat(CONDO_BULLETS);
    else if (subtype === 'Co-op') lines = lines.concat(COOP_BULLETS);
  } else if (type === 'Commercial') {
    lines = lines.concat(COMMERCIAL_BULLETS);
    if (subtype === 'Condo') lines = lines.concat(CONDO_BULLETS);
    else if (subtype === 'Co-op') lines = lines.concat(COOP_BULLETS);
  } else if (type === 'Land') {
    lines = lines.concat(LAND_BULLETS);
    if (subtype === 'Condo') lines = lines.concat(CONDO_BULLETS);
    else if (subtype === 'Co-op') lines = lines.concat(COOP_BULLETS);
  }
  return lines;
}

function approachFor(rawType) {
  return normalizeType(rawType) === 'Commercial'
    ? 'Income Approach and Sales Comparison Approach'
    : 'Sales Comparison Approach';
}

// Group items preserving first-appearance order, keyed by a string.
function groupByKey(items, keyFn) {
  const order = [];
  const map = {};
  items.forEach(it => {
    const k = keyFn(it);
    if (!map[k]) { map[k] = []; order.push(k); }
    map[k].push(it);
  });
  return order.map(k => ({ key: k, items: map[k] }));
}

// ---------- READ INPUT ----------------------------------------------

let src = inputData;
if (inputData.body) {
  try { src = JSON.parse(inputData.body); } catch (e) { src = inputData; }
}

// Treat null / "null" as empty across all fields
Object.keys(src).forEach(k => {
  const v = src[k];
  if (v === null || v === undefined) {
    src[k] = '';
  } else if (typeof v === 'string' && v.trim().toLowerCase() === 'null') {
    src[k] = '';
  }
});

const appraisalScenario = String(src.appraisalScenario || '').trim();
const twoStage = String(src.twoStageRequired || '').trim().toLowerCase() === 'yes';

const clientNames = splitPipes(src.clientList);
const clientAddresses = splitPipes(src.clientAddressList);
const clientPhone = String(src[CLIENT_PHONE_FIELD] || '').trim();
const clientEmail = String(src[CLIENT_EMAIL_FIELD] || '').trim();
const clients = clientNames.map((n, i) => ({
  fullName: reverseName(n),
  lastName: (String(n).indexOf(',') !== -1 ? String(n).slice(0, String(n).indexOf(',')).trim() : String(n).trim()),
  address: clientAddresses[i] || '',
  phone: i === 0 ? clientPhone : '',
  email: i === 0 ? clientEmail : ''
}));

const properties = parseProperties(src.propertyList);
const auNames = splitPipes(src.additionalIntendedUsersList).map(reverseName);

// ---------- PLURALIZATION ENGINE ------------------------------------

const COUNTS = {
  p: properties.length,   // properties -> appraisals, reports, valuations,
                          // inspections, sites
  c: clients.length,      // named clients
  u: auNames.length,      // additional intended users
  a: properties.length    // default local count; overridden per block
};

// Resolve {key:singular|plural} tokens. Plural wins when count > 1.
const PLURAL_TOKEN_RE = /\{(\w+):([^|{}]*)\|([^{}]*)\}/g;
function fill(str, extra) {
  const counts = extra ? Object.assign({}, COUNTS, extra) : COUNTS;
  return String(str).replace(PLURAL_TOKEN_RE, function (m, key, sing, plur) {
    return (counts[key] || 0) > 1 ? plur : sing;
  });
}

// Render a requirement line: plain (note) lines get a leading blank line and
// no bullet; everything else gets a "* " bullet. Counts resolve here so the
// grouping upstream can key off the raw, unfilled templates.
function renderReqLine(line, counts) {
  if (line.indexOf(NOTE_MARKER) === 0) {
    return '\n' + fill(line.slice(NOTE_MARKER.length), counts);
  }
  return '* ' + fill(line, counts);
}

// ---------- clistheader1 / clistheader2 -----------------------------

let clistheader1 = '';
let clistheader2 = '';

// clistheader2 is names-only, unaffected by scenario.
clistheader2 = clients.map(c => 'Mx. ' + c.fullName).join('\nand\n');

if (appraisalScenario === 'Date of Death') {
  const estateLine = 'The Estate of ' + reverseName(src.decedentName);
  const addrs = clients.map(c => c.address);
  const allSame = addrs.every(a => a === addrs[0]);
  if (allSame) {
    const coLine = 'c/o ' + clients.map(c => 'Mx. ' + c.fullName).join(', ');
    clistheader1 = estateLine + '\n' + coLine + '\n' + breakAddress(addrs[0]);
  } else {
    const blocks = clients.map(c => 'c/o Mx. ' + c.fullName + '\n' + breakAddress(c.address));
    clistheader1 = estateLine + '\n' + blocks.join('\nand\n');
  }
} else {
  clistheader1 = clients
    .map(c => 'Mx. ' + c.fullName + '\n' + breakAddress(c.address))
    .join('\nand\n');
}

// ---------- clistgreeting -------------------------------------------

const clistgreeting = 'Dear ' + joinWithAnd(clients.map(c => 'Mx. ' + c.lastName)) + ',';

// ---------- crequest ------------------------------------------------

const crequest = fill(
  INSURABLE_SCENARIOS.indexOf(appraisalScenario) !== -1
    ? REQUEST_INSURABLE
    : REQUEST_STANDARD
);

// ---------- cpropertylist -------------------------------------------
// The one section that states every address in FULL.

const cpropertylist = properties.map(p => {
  const label = p.subtype ? (p.type + ' ' + p.subtype) : p.type;
  return '* ' + p.address + ' - ' + label;
}).join('\n');

// ---------- cpropertyreqs -------------------------------------------

const reqItems = properties
  .map(p => ({ address: p.address, reqs: getRequirements(p.type, p.subtype) }))
  .filter(x => x.reqs.length > 0);

let cpropertyreqs = '';
if (reqItems.length > 0) {
  const groups = groupByKey(reqItems, x => x.reqs.join('~~'));
  const blocks = groups.map(g => {
    const addresses = g.items.map(x => shortAddress(x.address));
    const local = { a: addresses.length };
    const label = addresses.length > 1 ? 'properties' : 'property';
    const bullets = g.items[0].reqs.map(line => renderReqLine(line, local)).join('\n');
    return 'For the ' + label + ' at ' + joinWithAnd(addresses) + ':\n\n' + bullets;
  });
  cpropertyreqs = 'In order to complete this assignment, we will need the following:\n\n' + blocks.join('\n\n');
}

// ---------- capproachlist -------------------------------------------

let capproachlist = '';
if (properties.length > 0) {
  const withApproach = properties.map(p => ({ address: shortAddress(p.address), approach: approachFor(p.type) }));
  const groups = groupByKey(withApproach, x => x.approach);
  const multiGroup = groups.length > 1;
  const valuationSentences = groups.map(g => {
    const isCommercial = g.key === 'Income Approach and Sales Comparison Approach';
    const local = { a: g.items.length };
    const clause = fill(isCommercial
      ? 'the two most commonly utilized methods to estimate value of properties similar to the subject {a:property|properties} are the Income Approach and Sales Comparison Approach'
      : 'the most commonly utilized method to estimate value of properties similar to the subject {a:property|properties} is the Sales Comparison Approach', local);
    if (!multiGroup) {
      return clause.charAt(0).toUpperCase() + clause.slice(1) + '.';
    }
    return 'For ' + joinWithAnd(g.items.map(x => x.address)) + ', ' + clause + '.';
  });
  let opening = fill('The appraisal{p:|s} will be communicated in a written Appraisal Report format.');
  if (properties.length <= APPROACH_DETAIL_MAX_PROPERTIES) {
    valuationSentences.forEach(s => { opening += ' ' + s; });
  }

  if (twoStage) {
    opening += ' ' + fill(TWO_STAGE_EXPLANATION);
    capproachlist = opening + '\n\n' + fill(TWO_STAGE_ASSUMPTIONS);
  } else {
    capproachlist = opening + ' ' + fill(APPROACH_TAIL);
  }
}

// ---------- cappraisaldate ------------------------------------------

const dodFriendly = formatFriendlyDate(src.dateOfDeath);
const effFriendly = formatFriendlyDate(src.appraisalEffectiveDate);
let cappraisaldate;
if (dodFriendly) {
  const decedent = reverseName(src.decedentName);
  cappraisaldate = fill('The effective date of the valuation{p:|s} will be ')
    + dodFriendly
    + (decedent ? DOD_DATE_SUFFIX.replace('{decedent}', decedent) : '')
    + '.';
} else if (effFriendly) {
  cappraisaldate = fill('The effective date of the valuation{p:|s} will be ') + effFriendly + '.';
} else {
  cappraisaldate = fill('The effective date of the valuation{p:|s} will be the date of {p:inspection|inspections}.');
}

// ---------- cappraisalscenario --------------------------------------

let cappraisalscenario = fill(SCENARIO_MAP[appraisalScenario] || '');
if (appraisalScenario === 'Gift Tax') {
  const donor = reverseName(src.nameOfDonor);
  if (donor) {
    cappraisalscenario = fill(GIFT_TAX_DONOR_TEMPLATE).replace('{donor}', donor);
  }
}

// ---------- ccontactlist --------------------------------------------

const contactSegments = splitPipesPositional(src.contactPersonList);
const contactOrder = [];
const contactMap = {};

// Fallback used when a property has no contact person listed: the client(s)
// themselves, carrying whatever phone/email the intake supplied.
const clientContactFallback = clients
  .filter(function (c) { return c.fullName; })
  .map(function (c) {
    return { name: CLIENT_CONTACT_HONORIFIC + c.fullName, phone: c.phone, email: c.email };
  });

// Walk PROPERTIES, not segments, so a property past the end of the contact
// list still gets a contact assigned.
properties.forEach(function (prop, i) {
  const address = prop.address;
  if (!address) return;

  const segment = contactSegments[i] || '';
  let entries = (segment.match(/\[([^\]]+)\]/g) || []).map(function (match) {
    const parts = match.slice(1, -1).split(',').map(function (s) { return s.trim(); });
    return { name: parts[0] || '', phone: parts[1] || '', email: parts[2] || '' };
  }).filter(function (e) { return e.name || e.phone || e.email; });

  if (entries.length === 0) entries = clientContactFallback;

  entries.forEach(function (e) {
    const key = e.name + '|' + e.phone + '|' + e.email;
    if (!contactMap[key]) {
      contactMap[key] = { name: e.name, phone: e.phone, email: e.email, addresses: [] };
      contactOrder.push(key);
    }
    contactMap[key].addresses.push(address);
  });
});
// Dedupe addresses within each contact (the same address can arrive twice if
// two property rows carry the same address string), then merge contacts who
// cover the identical set of addresses into a single sentence so the address
// is never stated more than once. Grouping keys off the FULL address; only the
// rendered sentence shortens.
const ccontactlist = (function () {
  const contacts = contactOrder.map(function (key) {
    const c = contactMap[key];
    const seen = {};
    const addresses = c.addresses.filter(function (addr) {
      if (seen[addr]) return false;
      seen[addr] = true;
      return true;
    });
    return {
      details: [c.name, c.phone, c.email].filter(Boolean).join(', '),
      addresses: addresses
    };
  });

  const groups = groupByKey(contacts, function (c) { return c.addresses.join('~~'); });

  return groups.map(function (g) {
    const addresses = g.items[0].addresses;
    const details = joinWithAnd(g.items.map(function (c) { return c.details; }));
    const tail = fill(
      ' will be the contact {n:person|persons} for all relevant information and access for the {a:inspection|inspections} of ',
      { a: addresses.length, n: g.items.length }
    );
    return details + tail + joinWithAnd(addresses.map(shortAddress)) + '.';
  }).join('\n\n');
})();

// ---------- cadditionalusers ----------------------------------------

let cadditionalusers = '';
if (auNames.length > 0) {
  const sentence = fill('The client{c:|s} {c:has|have} identified ')
    + joinWithAnd(auNames)
    + fill(' as {u:an additional intended user|additional intended users} of the report{p:|s}.');
  cadditionalusers = '\n' + sentence + '\n';
}

// ---------- clitigation ---------------------------------------------

let clitigation = '';
if (LITIGATION_SCENARIOS.indexOf(appraisalScenario) !== -1) {
  clitigation = '\n' + fill(LITIGATION_CLAUSE) + '\n';
}

// ---------- cappraisalfee -------------------------------------------

const feeRaw = String(src.appraisalFee || '').trim();
const feeValue = formatFee(feeRaw) || FEE_PLACEHOLDER;

// The fee sentence renders on every agreement, litigation or not.
let cappraisalfee = fill(FEE_SENTENCE).split('{fee}').join(feeValue);

// Litigation scenarios additionally get the fee schedule table. Emitted as a
// marker-wrapped, tab-delimited block for the Apps Script to convert.
if (clitigation) {
  const tableRows = FEE_TABLE_ROWS.map(function (row) {
    return fill(row[0]).split('{fee}').join(feeValue)
      + FEE_COL_DELIM
      + fill(row[1]).split('{fee}').join(feeValue);
  }).join('\n');

  cappraisalfee += '\n\n'
    + FEE_TABLE_START + '\n'
    + FEE_TABLE_HEADING + '\n'
    + tableRows + '\n'
    + FEE_TABLE_END;
}

// ---------- inspectiontype (scope paragraph) ------------------------

const inspectionTypeValue = String(src.inspectionType || '').trim();
const inspectionParagraph = fill(
  INSURABLE_SCENARIOS.indexOf(appraisalScenario) !== -1
    ? INSPECTION_INSURABLE
    : INSPECTION_STANDARD
).split('{inspection} ').join(inspectionTypeValue ? inspectionTypeValue + ' ' : '');

// ---------- estimatedturnaround (turnaround paragraph) --------------

const turnaroundValue = String(src.estimatedTurnaround || '').trim() || TURNAROUND_DEFAULT;
const turnaroundParagraph = fill(TURNAROUND_SENTENCE)
  .split('{turnaround}').join(turnaroundValue);

// ---------- currentDate (New York) ----------------------------------

const nyParts = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', year: 'numeric', month: 'numeric', day: 'numeric'
}).formatToParts(new Date());
const getPart = (t) => nyParts.find(p => p.type === t).value;
const currentDate = OUT_MONTHS[parseInt(getPart('month'), 10) - 1] + ' ' + parseInt(getPart('day'), 10) + ', ' + getPart('year');

// ---------- RETURN --------------------------------------------------

output = {
  clistheader1,
  clistheader2,
  clistgreeting,
  crequest,
  cpropertylist,
  cpropertyreqs,
  capproachlist,
  cappraisaldate,
  cappraisalscenario,
  ccontactlist,
  cadditionalusers,
  clitigation,
  cappraisalfee,
  currentDate,
  // passthrough values so the Google Docs step can map everything from this one step
  inspectiontype: inspectionParagraph,
  agreementfee: feeValue,
  estimatedturnaround: turnaroundParagraph,
  email: String(src.email || '')
};
