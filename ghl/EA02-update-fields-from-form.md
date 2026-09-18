# GHL workflow "EA02. Update Fields from Form"

The bridge between the intake form and the Zap. The form POSTs snake_case
keys to this workflow's inbound webhook; the workflow writes them to the
contact's custom fields, then a Webhook action fires the Zap's Catch Hook
(step 1) with the camelCase body below.

Custom-field IDs the form reads back (`CF` map in `lead-info-form.html`)
must match the fields this workflow writes.

## Webhook action body (to Zapier Catch Hook)

Every key here is a step 2 input. Add a key here, add it to step 2.

```json
{
  "appraisalScenario": "{{contact.appraisal_scenario}}",
  "clientList": "{{contact.client_list}}",
  "propertyList": "{{contact.property_list}}",
  "clientAddressList": "{{contact.client_address_list}}",
  "clientEmailList": "{{contact.client_email_list}}",
  "clientPhoneList": "{{contact.client_phone_list}}",
  "clientCompanyList": "{{contact.client_company_list}}",
  "contactPersonList": "{{contact.contact_person_list}}",
  "additionalIntendedUsersList": "{{contact.additional_intended_users_list}}",
  "appraisalEffectiveDate": "{{contact.appraisal_effective_date}}",
  "dateOfDeath": "{{contact.date_of_death}}",
  "decedentName": "{{contact.name_of_the_decedent}}",
  "partialInterestRequired": "{{contact.partial_interest_required}}",
  "partialInterestPercentage": "{{contact.partial_interest_percentage}}",
  "coopBoardName": "{{contact.coop_board_name}}",
  "representationType": "{{contact.representation_type}}",
  "twoStageRequired": "{{contact.two_stage}}",
  "inspectionType": "{{contact.inspection_type}}",
  "nameOfDonor": "{{contact.name_of_donor}}",
  "appraisalFee": "{{contact.agreement_fee}}",
  "estimatedTurnaround": "{{contact.estimated_turnaround}}",
  "participantsList": "",
  "name": "{{contact.name}}",
  "email": "{{contact.email}}",
  "phone": "{{contact.phone}}"
}
```

## Custom fields (contact)

| Form key | GHL field | ID |
|---|---|---|
| `client_list` | Client List | `yC6JeXFRW3MJxPpa6X5Z` |
| `client_address_list` | Client Address List | `qNftvFNpOGwG8vrfYrbT` |
| `client_email_list` | Client Email List | `RRFyaXglFBh8fVvG36IB` |
| `client_phone_list` | Client Phone List | `WfvUWHXbLc9oB4yzvCGt` |
| `client_company_list` | Client Company List | _TODO — create, paste ID here and in the form `CF` map_ |

(Full map lives in the `CF` object in `lead-info-form.html`.)
