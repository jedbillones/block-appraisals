# Zap step 4 — Webhooks by Zapier, POST to GHL

No code. Ships every field step 3 returns to the GoHighLevel inbound webhook
so GHL holds the rendered copy alongside the contact.

- **URL** — the LeadConnector inbound hook,
  `https://services.leadconnectorhq.com/hooks/<location>/webhook-trigger/<id>`.
  The live value lives in the Zap itself and is deliberately not committed:
  anyone holding that URL can POST into the GHL account, and this repo has a
  GitHub remote.
- **Payload Type** — `Json`
- **Data** — one row per step 3 output key, each mapped to the matching
  `3. …` field. Key name and step-3 key are identical.

## Data rows

| Key | Source |
|---|---|
| `clistheader1` | 3. Clistheader 1 |
| `clistheader2` | 3. Clistheader 2 |
| `clistgreeting` | 3. Clistgreeting |
| `crequest` | 3. Crequest |
| `cpropertylist` | 3. Cpropertylist |
| `cpropertyreqs` | 3. Cpropertyreqs |
| `capproachlist` | 3. Capproachlist |
| `cappraisaldate` | 3. Cappraisaldate |
| `cappraisalscenario` | 3. Cappraisalscenario |
| `ccontactlist` | 3. Ccontactlist |
| `cadditionalusers` | 3. Cadditionalusers |
| `clitigation` | 3. Clitigation |
| `cappraisalfee` | 3. Cappraisalfee |
| `csignatureblock` | 3. Csignatureblock |
| `currentDate` | 3. CurrentDate |
| `inspectiontype` | 3. Inspectiontype |
| `agreementfee` | 3. Agreementfee |
| `estimatedturnaround` | 3. Estimatedturnaround |
| `cemaillist` | 3. Cemaillist |
| `email` | 3. Email |

Adding an output key to step 3 means adding its row here too, or the value
never reaches GHL.
