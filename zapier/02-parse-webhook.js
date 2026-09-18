// =====================================================================
// Block Appraisals - Engagement Agreement parse step
// Zap step 2 - Code by Zapier (JavaScript). Runs BEFORE copybuilder.js.
// Input Data: body = Object.to_json( 1. Raw Output: {...} )
// Maps the trigger's raw JSON body to flat, cleaned string fields.
// =====================================================================

const parsed = JSON.parse(inputData.body);

const clean = (val) => {
  if (val === null || val === undefined) return '';
  const str = String(val).trim();
  return (str.toLowerCase() === 'null') ? '' : str;
};

return {
  appraisalScenario: clean(parsed.appraisalScenario),
  clientList: clean(parsed.clientList),
  clientAddressList: clean(parsed.clientAddressList),
  clientEmailList: clean(parsed.clientEmailList),
  clientPhoneList: clean(parsed.clientPhoneList),
  clientCompanyList: clean(parsed.clientCompanyList),
  propertyList: clean(parsed.propertyList),
  contactPersonList: clean(parsed.contactPersonList),
  additionalIntendedUsersList: clean(parsed.additionalIntendedUsersList),
  appraisalEffectiveDate: clean(parsed.appraisalEffectiveDate),
  dateOfDeath: clean(parsed.dateOfDeath),
  decedentName: clean(parsed.decedentName),
  nameOfDonor: clean(parsed.nameOfDonor),
  inspectionType: clean(parsed.inspectionType),
  appraisalFee: clean(parsed.appraisalFee),
  estimatedTurnaround: clean(parsed.estimatedTurnaround),
  email: clean(parsed.email),
  phone: clean(parsed.phone),
  partialInterestRequired: clean(parsed.partialInterestRequired),
  partialInterestPercentage: clean(parsed.partialInterestPercentage),
  twoStageRequired: clean(parsed.twoStageRequired),
  coopBoardName: clean(parsed.coopBoardName),
  representationType: clean(parsed.representationType),
  participantsList: clean(parsed.participantsList)
};
