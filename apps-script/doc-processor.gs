/**
 * Block Appraisals - post-generation Google Doc processor (Web App).
 *
 * Runs as a Zapier step AFTER Zap 3 creates the agreement Doc from the
 * template, and BEFORE the docx export step. Passes:
 *   1. Blank collapse - merge fields that resolve to empty, plus the
 *                 leading/trailing newlines the builder wraps around
 *                 optional blocks, stack up blank paragraphs. Collapse
 *                 any run of them down to MAX_BLANK_PARAGRAPHS. Runs
 *                 first so every later pass reads a settled document.
 *                 Body only; footers are left alone because the footer
 *                 border pass targets their first paragraph by position.
 *   2. Bullets  - convert the builder's "* " marker lines into native
 *                 Google Docs bullets (survive the .docx export clean).
 *                 Body only; "* " lines never appear in headers/footers.
 *   3. Fee table - convert the builder's ::FEETABLE:: marker block into a
 *                 styled heading plus a borderless two-column table with
 *                 zero cell padding and zero paragraph spacing, so the
 *                 rows sit tight under one another. Only present on
 *                 litigation scenarios. Runs after the bullet pass and
 *                 before the style-only passes, since it is the last
 *                 pass that shifts document indices.
 *   4. Recolor  - color every "Mx." instance so Scott can spot the
 *                 honorific during review. Sweeps the body AND every
 *                 header and footer (the running header carries the
 *                 client names via {{clistheader2}}).
 *   5. Footer border - applies a solid black top border to the first
 *                 paragraph of every footer segment (sits above the
 *                 footer content, like a divider from the body), so
 *                 it survives the .docx export as a real OOXML
 *                 paragraph border instead of Google's native
 *                 horizontal-line element.
 *
 * Uses the advanced Google Docs service (identifier: Docs) throughout.
 *
 * SETUP (see the deployment guide):
 *   1. Editor > Services (+) > add "Google Docs API"  (identifier: Docs)
 *   2. Deploy > New deployment > Web app
 *        Execute as:      Me
 *        Who has access:  Anyone
 *   3. Set SHARED_TOKEN below, and send the same value as "token" in the
 *      Zap's POST body alongside "documentId".
 *   4. Script owner must be the SAME Google account that owns the
 *      generated docs (the one wired into Zapier), or every run 403s.
 *   Re-run _test after pasting to re-authorize scopes.
 */

// Shared secret. The live value is set in the Apps Script editor and mirrored
// in the Zap; it is deliberately NOT committed to the repo. When pasting this
// file over the deployed script, keep the deployed value on this line.
var SHARED_TOKEN = 'REPLACE_WITH_DEPLOYED_TOKEN';

// ---- Blank paragraph collapse config -------------------------------------
// Maximum consecutive blank paragraphs allowed between two content
// paragraphs. 1 means "at most one empty line of space", which is what the
// agreement template calls for. Set to 0 to remove blank lines entirely.
var MAX_BLANK_PARAGRAPHS = 1;

// Treat a paragraph containing only spaces or tabs as blank. Merge fields
// that resolve to a lone space are otherwise invisible but still count as
// content. Set false to collapse only truly empty paragraphs.
var BLANK_INCLUDES_WHITESPACE = true;

// The literal prefix the field builder emits at the start of each bullet line.
var BULLET_MARKER = '* ';

// Google Docs built-in bullet preset: filled disc at the top level.
var BULLET_PRESET = 'BULLET_DISC_CIRCLE_SQUARE';

// ---- Mx. recolor config -------------------------------------------------
// Set to '' (empty string) to skip that effect. Hex like '#RRGGBB'.
// CONFIRM THESE with Jed before relying on them.
var MX_FOREGROUND = '#FF0000';  // text color applied to "Mx."
var MX_BACKGROUND = '';         // highlight color behind "Mx." ('' = none)
var MX_BOLD       = false;      // also bold the "Mx." text
var MX_LITERAL    = 'Mx.';      // the exact literal recolored

// ---- Footer border config ------------------------------------------------
// Applies a solid top border to the first paragraph of every footer
// segment, so it sits above the footer content like a divider from the
// body text. Survives the .docx export as a real OOXML paragraph border
// instead of Google's native horizontal-line element (which the export
// drops or converts inconsistently).
var FOOTER_BORDER_COLOR    = '#000000'; // black
var FOOTER_BORDER_WIDTH_PT = 1.5;       // thickness in points

// ---- Fee schedule table config -------------------------------------------
// Markers and delimiters must match the constants in copybuilder.js exactly.
// The builder emits, as consecutive body paragraphs:
//
//   ::FEETABLE::
//   Summary of Fees:
//   Appraisal Reports..........{TAB}$1,600
//   Expert witness testimony....{TAB}$3,000 per full day{BR}$2,000 per half day
//   Additional conference.......{TAB}$  500 per hour
//   ::ENDFEETABLE::
//
// The first line inside the markers is the heading. Every line after it is
// a table row: label before {TAB}, value after. {BR} splits the value cell
// into multiple lines. The builder emits no spacer rows; the table is meant
// to read as one tight block.
var FEE_TABLE_START  = '::FEETABLE::';
var FEE_TABLE_END    = '::ENDFEETABLE::';
var FEE_COL_DELIM    = '{TAB}';
var FEE_CELL_BREAK   = '{BR}';

// Heading styling. Set any to false to skip that effect.
var FEE_HEADING_BOLD      = true;
var FEE_HEADING_ITALIC    = true;
var FEE_HEADING_UNDERLINE = true;

// Blank paragraphs between the heading and the first row: 0 or 1.
// The Docs API inserts its own newline before every table, which is where
// the single blank comes from. (An earlier version added a second explicit
// spacer on top of that, which is why the gap used to be two lines.)
var FEE_HEADING_GAP_LINES = 1;

// Geometry in points. 72pt = 1 inch. A Letter page with 1in margins gives a
// 468pt body width, so COL1 + COL2 must stay at or under that.
var FEE_INDENT_PT     = 43;   // left indent of the block, as col 0 padding
var FEE_COL1_WIDTH_PT = 275;  // label column (includes the indent)
var FEE_COL2_WIDTH_PT = 190;  // value column
var FEE_BORDER_COLOR  = '#000000';

function doPost(e) {
  try {
    var payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');

    if (payload.token !== SHARED_TOKEN) {
      return json_({ ok: false, error: 'bad token' });
    }

    var documentId = payload.documentId || payload.document_id || '';
    if (!documentId) {
      return json_({ ok: false, error: 'missing documentId' });
    }

    var collapsed = collapseBlankParagraphs_(documentId);
    var bulleted = convertMarkerLinesToBullets_(documentId);
    var feeTabled = buildFeeTable_(documentId);
    var recolored = recolorMx_(documentId);
    var bordered = addFooterBorder_(documentId);

    return json_({
      ok: true,
      documentId: documentId,
      collapsed: collapsed,
      bulleted: bulleted,
      feeTabled: feeTabled,
      recolored: recolored,
      bordered: bordered
    });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

/**
 * Collapses every run of consecutive blank body paragraphs down to
 * MAX_BLANK_PARAGRAPHS. A run is broken by any non-paragraph element, so a
 * table or section break never gets merged across.
 *
 * For each over-long run the deletion spans from the FIRST blank's start
 * index to the start index of the blank we intend to keep, which means the
 * surviving paragraph is the last one in the run. Keeping the last rather
 * than the first matters at the end of the document: Docs refuses to delete
 * the body's final newline, and this range never touches it. The arithmetic
 * also holds for whitespace-only paragraphs of any length, since the range
 * is bounded by element indices rather than an assumed one character each.
 *
 * Requests are sorted descending so each deletion sits above the next and no
 * index is invalidated mid-batch.
 * Returns the number of paragraphs removed.
 */
function collapseBlankParagraphs_(documentId) {
  var doc = Docs.Documents.get(documentId);
  var content = (doc.body && doc.body.content) || [];

  var runs = [];
  var current = [];

  for (var i = 0; i < content.length; i++) {
    if (isBlankParagraph_(content[i])) {
      current.push(content[i]);
    } else {
      if (current.length > MAX_BLANK_PARAGRAPHS) runs.push(current);
      current = [];
    }
  }
  if (current.length > MAX_BLANK_PARAGRAPHS) runs.push(current);
  if (runs.length === 0) return 0;

  var requests = [];
  var removed = 0;

  for (var r = 0; r < runs.length; r++) {
    var run = runs[r];
    var keepFrom = run[run.length - MAX_BLANK_PARAGRAPHS];
    var startIndex = run[0].startIndex;
    var endIndex = keepFrom.startIndex;

    if (endIndex <= startIndex) continue;

    requests.push({
      deleteContentRange: { range: { startIndex: startIndex, endIndex: endIndex } }
    });
    removed += run.length - MAX_BLANK_PARAGRAPHS;
  }

  if (requests.length === 0) return 0;

  requests.sort(function (a, b) {
    return b.deleteContentRange.range.startIndex - a.deleteContentRange.range.startIndex;
  });

  Docs.Documents.batchUpdate({ requests: requests }, documentId);
  return removed;
}

/**
 * True when a structural element is a paragraph carrying no visible content.
 * A bulleted paragraph is never blank (an empty bullet still renders), and
 * any page break, horizontal rule, inline image, footnote, person chip, or
 * rich link counts as content even with no text alongside it.
 */
function isBlankParagraph_(el) {
  var p = el.paragraph;
  if (!p) return false;
  if (p.bullet) return false;

  var elements = p.elements || [];
  var text = '';

  for (var i = 0; i < elements.length; i++) {
    var pe = elements[i];
    if (pe.textRun) {
      text += pe.textRun.content || '';
    } else if (pe.pageBreak || pe.columnBreak || pe.horizontalRule ||
               pe.inlineObjectElement || pe.footnoteReference ||
               pe.person || pe.richLink || pe.autoText || pe.equation) {
      return false;
    }
  }

  text = text.replace(/\n/g, '');
  return BLANK_INCLUDES_WHITESPACE ? text.trim() === '' : text === '';
}

/**
 * Finds every top-level BODY paragraph whose text starts with BULLET_MARKER,
 * turns it into a native bullet, and strips the literal "* " marker.
 * Table cells (the signature block) are skipped since we only walk the
 * top-level body content. Processes bottom-up so deleting the marker in a
 * lower paragraph never shifts the index of a paragraph above it.
 * Returns the number of paragraphs converted.
 */
function convertMarkerLinesToBullets_(documentId) {
  var doc = Docs.Documents.get(documentId);
  var content = (doc.body && doc.body.content) || [];
  var targets = [];

  for (var i = 0; i < content.length; i++) {
    var el = content[i];
    if (!el.paragraph) continue; // skip tables, section breaks, etc.

    var runs = el.paragraph.elements || [];
    var text = '';
    for (var j = 0; j < runs.length; j++) {
      if (runs[j].textRun && runs[j].textRun.content) {
        text += runs[j].textRun.content;
      }
    }

    if (text.indexOf(BULLET_MARKER) === 0) {
      targets.push({ start: el.startIndex, end: el.endIndex });
    }
  }

  targets.sort(function (a, b) { return b.start - a.start; });

  for (var k = 0; k < targets.length; k++) {
    var t = targets[k];
    Docs.Documents.batchUpdate({
      requests: [
        {
          createParagraphBullets: {
            range: { startIndex: t.start, endIndex: t.end },
            bulletPreset: BULLET_PRESET
          }
        },
        {
          deleteContentRange: {
            range: { startIndex: t.start, endIndex: t.start + BULLET_MARKER.length }
          }
        }
      ]
    }, documentId);
  }

  return targets.length;
}

/**
 * Locates the ::FEETABLE:: block in the body, deletes it, and rebuilds it as
 * a styled heading paragraph and a borderless two-column table, with
 * FEE_HEADING_GAP_LINES blank paragraphs between them.
 *
 * Runs in two batches. The first deletes the marker block and inserts the
 * heading plus an empty table shell, because insertTable gives no handle to
 * the cells it creates. The second re-reads the document to get the real cell
 * indices, then styles the table and fills the cells bottom-up so no
 * insertion invalidates an index below it.
 *
 * Spacing: insertTable always inserts a newline before the table. Inserting
 * AFTER the heading's own newline leaves that forced newline as one blank
 * paragraph (gap = 1). Inserting AT the heading's newline splits the heading
 * paragraph there, so the table sits directly under it and the heading's
 * newline becomes an empty paragraph after the table (gap = 0). Either way
 * no explicit spacer is written, and the heading, gap paragraph and every
 * cell paragraph get zero space-above/below and single line spacing so the
 * doc's Normal style cannot loosen the block.
 *
 * Returns 1 if a block was converted, 0 if no block was present (the normal
 * case for every non-litigation agreement).
 */
function buildFeeTable_(documentId) {
  var doc = Docs.Documents.get(documentId);
  var content = (doc.body && doc.body.content) || [];

  var startEl = null;
  var endEl = null;
  var lines = [];

  for (var i = 0; i < content.length; i++) {
    var el = content[i];
    if (!el.paragraph) continue;

    var text = elementText_(el.paragraph);

    if (!startEl) {
      if (text.trim() === FEE_TABLE_START) startEl = el;
    } else if (text.trim() === FEE_TABLE_END) {
      endEl = el;
      break;
    } else {
      lines.push(text);
    }
  }

  // No markers, or a heading with no rows: leave the document alone.
  if (!startEl || !endEl || lines.length < 2) return 0;

  var headingText = lines[0];
  var rows = lines.slice(1).map(function (line) {
    var parts = line.split(FEE_COL_DELIM);
    return {
      label: parts[0] || '',
      value: (parts.length > 1 ? parts[1] : '').split(FEE_CELL_BREAK).join('\n')
    };
  });

  var anchor = startEl.startIndex || 0;
  var headingBlock = headingText + '\n'; // the heading paragraph, nothing else
  var tableInsertAt = FEE_HEADING_GAP_LINES > 0
    ? anchor + headingBlock.length   // after the heading's newline -> 1 blank
    : anchor + headingText.length;   // at the heading's newline   -> 0 blank

  // --- Batch 1: clear the markers, write the heading, insert the shell ---
  var setup = [
    { deleteContentRange: { range: { startIndex: anchor, endIndex: endEl.endIndex } } },
    { insertText: { location: { index: anchor }, text: headingBlock } }
  ];

  var headingFields = feeHeadingFields_();
  if (headingFields) {
    setup.push({
      updateTextStyle: {
        range: { startIndex: anchor, endIndex: anchor + headingText.length },
        textStyle: feeHeadingStyle_(),
        fields: headingFields
      }
    });
  }

  // Heading paragraph: no space-after, so the gap is exactly the blank
  // paragraph (or nothing), not blank + inherited paragraph spacing.
  setup.push(tightParagraphRequest_(anchor, anchor + headingBlock.length));

  setup.push({
    insertTable: {
      location: { index: tableInsertAt },
      rows: rows.length,
      columns: 2
    }
  });

  Docs.Documents.batchUpdate({ requests: setup }, documentId);

  // --- Batch 2: style the shell, then fill it bottom-up ---
  var tableEl = findTableAtOrAfter_(documentId, anchor);
  if (!tableEl) return 0;

  var tableStart = { index: tableEl.startIndex };
  var tableRows = tableEl.table.tableRows || [];
  var requests = [];

  // The forced newline before the table is the gap paragraph; its trailing
  // newline sits at tableStart - 1. Pin its spacing too.
  if (FEE_HEADING_GAP_LINES > 0 && tableEl.startIndex > 0) {
    requests.push(tightParagraphRequest_(tableEl.startIndex - 1, tableEl.startIndex));
  }

  // Column widths first. Neither this nor the cell styling shifts indices,
  // so the cell locations read above stay valid for the inserts below.
  requests.push(columnWidthRequest_(tableStart, 0, FEE_COL1_WIDTH_PT));
  requests.push(columnWidthRequest_(tableStart, 1, FEE_COL2_WIDTH_PT));

  // Borderless everywhere. Left padding on column 0 only, which is what
  // indents the whole block off the margin.
  requests.push(cellStyleRequest_(tableStart, tableRows.length, 0, FEE_INDENT_PT));
  requests.push(cellStyleRequest_(tableStart, tableRows.length, 1, 0));

  // Every cell's (still empty) paragraph: zero spacing, single line height.
  // Text inserted into it below, including {BR} continuation lines, inherits
  // this. Paragraph style updates do not shift indices.
  for (var pr = 0; pr < tableRows.length; pr++) {
    var pcells = tableRows[pr].tableCells || [];
    for (var pc = 0; pc < pcells.length; pc++) {
      var para = pcells[pc].content && pcells[pc].content[0];
      if (!para) continue;
      requests.push(tightParagraphRequest_(para.startIndex, para.endIndex));
    }
  }

  for (var r = tableRows.length - 1; r >= 0; r--) {
    var cells = tableRows[r].tableCells || [];
    for (var c = cells.length - 1; c >= 0; c--) {
      var cellText = (c === 0) ? rows[r].label : rows[r].value;
      if (!cellText) continue; // a row with no value in that column

      requests.push({
        insertText: {
          location: { index: cells[c].content[0].startIndex },
          text: cellText
        }
      });
    }
  }

  Docs.Documents.batchUpdate({ requests: requests }, documentId);
  return 1;
}

/**
 * Colors every "Mx." across the body and every header/footer segment.
 * updateTextStyle does not shift indices, so all edits go in one batch.
 * Returns the number of instances recolored.
 */
function recolorMx_(documentId) {
  var textStyle = {};
  var fields = [];
  if (MX_FOREGROUND) { textStyle.foregroundColor = optionalColor_(MX_FOREGROUND); fields.push('foregroundColor'); }
  if (MX_BACKGROUND) { textStyle.backgroundColor = optionalColor_(MX_BACKGROUND); fields.push('backgroundColor'); }
  if (MX_BOLD)       { textStyle.bold = true;                                     fields.push('bold'); }
  if (fields.length === 0) return 0;

  var doc = Docs.Documents.get(documentId);
  var ranges = [];

  collectMxRanges_((doc.body && doc.body.content) || [], '', ranges);
  var seg;
  if (doc.headers) { for (seg in doc.headers) collectMxRanges_((doc.headers[seg] || {}).content || [], seg, ranges); }
  if (doc.footers) { for (seg in doc.footers) collectMxRanges_((doc.footers[seg] || {}).content || [], seg, ranges); }

  if (ranges.length === 0) return 0;

  var fieldMask = fields.join(',');
  var requests = ranges.map(function (r) {
    var range = { startIndex: r.startIndex, endIndex: r.endIndex };
    if (r.segmentId) range.segmentId = r.segmentId; // body = omit for empty id
    return { updateTextStyle: { range: range, textStyle: textStyle, fields: fieldMask } };
  });

  Docs.Documents.batchUpdate({ requests: requests }, documentId);
  return ranges.length;
}

/**
 * Applies a solid black top border to the first paragraph of every
 * footer segment, so the line sits above the footer content (like a
 * divider dropping down from the body) rather than below it. Skips a
 * segment if it has no paragraph content. Returns the number of footer
 * segments bordered.
 */
function addFooterBorder_(documentId) {
  var doc = Docs.Documents.get(documentId);
  if (!doc.footers) return 0;

  var requests = [];

  for (var segmentId in doc.footers) {
    var content = (doc.footers[segmentId] || {}).content || [];
    var firstParagraphEl = null;

    for (var i = 0; i < content.length; i++) {
      if (content[i].paragraph) { firstParagraphEl = content[i]; break; }
    }
    if (!firstParagraphEl) continue;

    var range = {
      startIndex: firstParagraphEl.startIndex || 0,
      endIndex: firstParagraphEl.endIndex,
      segmentId: segmentId
    };

    Logger.log('footer segment %s range: %s', segmentId, JSON.stringify(range));

    requests.push({
      updateParagraphStyle: {
        range: range,
        paragraphStyle: {
          borderTop: {
            color: optionalColor_(FOOTER_BORDER_COLOR),
            width: { magnitude: FOOTER_BORDER_WIDTH_PT, unit: 'PT' },
            padding: { magnitude: 1, unit: 'PT' },
            dashStyle: 'SOLID'
          }
        },
        fields: 'borderTop'
      }
    });
  }

  if (requests.length === 0) return 0;

  Docs.Documents.batchUpdate({ requests: requests }, documentId);
  return requests.length;
}

/**
 * Scans a content array (body, header, or footer) for MX_LITERAL and pushes
 * {segmentId, startIndex, endIndex} ranges into `out`. Accumulates only
 * consecutive text runs within a paragraph, flushing at any non-text element,
 * so a match can never be faked across an inline object or field gap.
 */
function collectMxRanges_(content, segmentId, out) {
  for (var i = 0; i < content.length; i++) {
    var p = content[i].paragraph;
    if (!p || !p.elements) continue;

    var text = '';
    var idxMap = [];

    var flush = function () {
      if (!text) return;
      var pos = text.indexOf(MX_LITERAL);
      while (pos !== -1) {
        out.push({
          segmentId: segmentId,
          startIndex: idxMap[pos],
          endIndex: idxMap[pos + MX_LITERAL.length - 1] + 1
        });
        pos = text.indexOf(MX_LITERAL, pos + MX_LITERAL.length);
      }
      text = '';
      idxMap = [];
    };

    for (var j = 0; j < p.elements.length; j++) {
      var pe = p.elements[j];
      if (pe.textRun && pe.textRun.content) {
        var c = pe.textRun.content;
        var base = pe.startIndex;
        for (var k = 0; k < c.length; k++) { idxMap.push(base + k); }
        text += c;
      } else {
        flush();
      }
    }
    flush();
  }
}

// ---- Fee table helpers ---------------------------------------------------

/**
 * Concatenates a paragraph's text runs and drops the trailing paragraph mark.
 */
function elementText_(paragraph) {
  var runs = (paragraph && paragraph.elements) || [];
  var text = '';
  for (var i = 0; i < runs.length; i++) {
    if (runs[i].textRun && runs[i].textRun.content) {
      text += runs[i].textRun.content;
    }
  }
  return text.replace(/\n+$/, '');
}

/**
 * Re-reads the document and returns the first table element at or after the
 * given index. Called right after insertTable to get the real cell indices.
 */
function findTableAtOrAfter_(documentId, index) {
  var doc = Docs.Documents.get(documentId);
  var content = (doc.body && doc.body.content) || [];

  for (var i = 0; i < content.length; i++) {
    if (content[i].table && (content[i].startIndex || 0) >= index) {
      return content[i];
    }
  }
  return null;
}

function columnWidthRequest_(tableStart, columnIndex, widthPt) {
  return {
    updateTableColumnProperties: {
      tableStartLocation: tableStart,
      columnIndices: [columnIndex],
      tableColumnProperties: {
        widthType: 'FIXED_WIDTH',
        width: { magnitude: widthPt, unit: 'PT' }
      },
      fields: 'widthType,width'
    }
  };
}

/**
 * Zero-width borders on all four sides, zero padding except the left padding
 * that indents the column off the margin.
 */
function cellStyleRequest_(tableStart, rowCount, columnIndex, paddingLeftPt) {
  var invisible = {
    color: optionalColor_(FEE_BORDER_COLOR),
    width: { magnitude: 0, unit: 'PT' },
    dashStyle: 'SOLID'
  };

  return {
    updateTableCellStyle: {
      tableRange: {
        tableCellLocation: {
          tableStartLocation: tableStart,
          rowIndex: 0,
          columnIndex: columnIndex
        },
        rowSpan: rowCount,
        columnSpan: 1
      },
      tableCellStyle: {
        borderTop: invisible,
        borderBottom: invisible,
        borderLeft: invisible,
        borderRight: invisible,
        paddingLeft: { magnitude: paddingLeftPt, unit: 'PT' },
        paddingRight: { magnitude: 0, unit: 'PT' },
        paddingTop: { magnitude: 0, unit: 'PT' },
        paddingBottom: { magnitude: 0, unit: 'PT' }
      },
      fields: 'borderTop,borderBottom,borderLeft,borderRight,paddingLeft,paddingRight,paddingTop,paddingBottom'
    }
  };
}

/**
 * Zero space above/below and single line spacing on every paragraph the
 * range touches. Used on the fee heading, the gap paragraph, and each table
 * cell so the block stays tight whatever the doc's Normal style says.
 */
function tightParagraphRequest_(startIndex, endIndex) {
  return {
    updateParagraphStyle: {
      range: { startIndex: startIndex, endIndex: endIndex },
      paragraphStyle: {
        spaceAbove: { magnitude: 0, unit: 'PT' },
        spaceBelow: { magnitude: 0, unit: 'PT' },
        lineSpacing: 100
      },
      fields: 'spaceAbove,spaceBelow,lineSpacing'
    }
  };
}

function feeHeadingStyle_() {
  var style = {};
  if (FEE_HEADING_BOLD)      style.bold = true;
  if (FEE_HEADING_ITALIC)    style.italic = true;
  if (FEE_HEADING_UNDERLINE) style.underline = true;
  return style;
}

function feeHeadingFields_() {
  var fields = [];
  if (FEE_HEADING_BOLD)      fields.push('bold');
  if (FEE_HEADING_ITALIC)    fields.push('italic');
  if (FEE_HEADING_UNDERLINE) fields.push('underline');
  return fields.join(',');
}

// ---- Shared helpers ------------------------------------------------------

function optionalColor_(hex) {
  return { color: { rgbColor: hexToRgb_(hex) } };
}

function hexToRgb_(hex) {
  var h = String(hex).replace('#', '');
  if (h.length === 3) { h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]; }
  var n = parseInt(h, 16);
  return {
    red:   ((n >> 16) & 255) / 255,
    green: ((n >> 8) & 255) / 255,
    blue:  (n & 255) / 255
  };
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Run once from the editor to authorize scopes and smoke-test against a
 * real GENERATED doc (not the template - it has no "* " lines or "Mx.").
 * Use a multi-page one so the continuation-header "Mx." gets exercised.
 * For the fee table pass, use a LITIGATION scenario doc; on any other
 * scenario buildFeeTable_ correctly returns 0 because no markers exist.
 */
function _test() {
  var id = '1GA_o7ncBf8uUPcVcbaSsaecQgcvBeCZgEioK9IChSlU';
  Logger.log('collapsed: ' + collapseBlankParagraphs_(id));
  Logger.log('bulleted: ' + convertMarkerLinesToBullets_(id));
  Logger.log('feeTabled: ' + buildFeeTable_(id));
  Logger.log('recolored: ' + recolorMx_(id));
  Logger.log('bordered: ' + addFooterBorder_(id));
}
