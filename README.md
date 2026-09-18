# Block Appraisals — Engagement Agreement System

Source of truth for every script in the Block Appraisals engagement agreement
Zap ("Copy Builder + Create Draft in OneDrive"). Edit here first, then paste
into Zapier.

## Zap steps

| # | Zapier step | File |
|---|---|---|
| 0½ | GHL workflow "EA02. Update Fields from Form" | [ghl/EA02-update-fields-from-form.md](ghl/EA02-update-fields-from-form.md) — writes form keys to custom fields, fires the Zap with the camelCase body |
| 1 | Webhooks by Zapier — Catch Hook | _(no code — receives the body above)_ |
| 2 | Code by Zapier — Run Javascript | [zapier/02-parse-webhook.js](zapier/02-parse-webhook.js) — flattens the raw webhook body into cleaned string fields |
| 3 | Code by Zapier — Run Javascript | [zapier/03-copybuilder.js](zapier/03-copybuilder.js) — the field builder; renders every paragraph of the agreement |
| 4 | Webhooks by Zapier — POST | [zapier/04-post-to-ghl.md](zapier/04-post-to-ghl.md) — ships step 3's output to the GHL inbound webhook |
| 0 | Intake form (GHL page) | [lead-info-form.html](lead-info-form.html) — posts the payload to the GHL inbound webhook that starts the chain |
| 5 | Google Docs | [template/Engagement Agreement Template.docx](template/Engagement%20Agreement%20Template.docx) — the `{{placeholder}}` template step 3's output fills |

Every `{{placeholder}}` in the template is a step 3 output key. Adding a
section means: render it in step 3, add its row in step 4, drop the
placeholder into the template, re-upload the template.

After step 5, the Zap POSTs the new doc's ID to a Google Apps Script web
app — [apps-script/doc-processor.gs](apps-script/doc-processor.gs) — which
collapses blank runs, converts `* ` lines to bullets, builds the
`::FEETABLE::` block into a real table, recolors `Mx.`, and borders the
footer. Its `SHARED_TOKEN` is set in the Apps Script editor, not committed.

## Testing

`test/run.js` runs a fixture through steps 2 and 3 exactly as Zapier does
(bare `inputData` in, bare `output` out, via `vm`).

```bash
node test/run.js
```

```bash
node test/run.js 01 capproachlist cappraisaldate
```

First arg filters fixtures by filename prefix; the rest filter output fields.
Fixtures in `fixtures/` are real webhook payloads captured from the Zap.

## Documentation

[docs/Block Appraisals - Engagement Agreement Automation - System Documentation.docx](docs/Block%20Appraisals%20-%20Engagement%20Agreement%20Automation%20-%20System%20Documentation.docx)
is the client-facing system description (v1.1). Update it when the
behaviour described in it changes, not for every code edit.

## Tools

`tools/sweep-duplicates.js` runs the intake form's duplicate-contact match
across the whole GHL contact list and writes a CSV of clusters. Dry run by
default; `--tag` applies the `potential-duplicate-contact` tag to every
non-master member. Needs `GHL_PIT_TOKEN` in the environment.

```bash
node tools/sweep-duplicates.js
```

## Conventions

- One file per Zap step, prefixed with the step number.
- Header comment in each file names the step and its Input Data mapping.
- Zapier Code steps return a plain object; keep every output a string.
- Copy lives in the `const` block at the top of step 3, not in the logic.
  Pluralization uses inline `{key:singular|plural}` tokens — see that file's
  header.
- `cpropertylist` states addresses in full; every other section shortens to
  the street line via `shortAddress`.
