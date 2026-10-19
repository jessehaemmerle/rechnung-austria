import { amt, pct, qty, xml, type EModel, type TaxCategory } from './model';
import type { Address } from '../types';

const XRECHNUNG_ID = 'urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0';

function postal(a: Address): string {
  return `<cac:PostalAddress>
        <cbc:StreetName>${xml(a.street)}</cbc:StreetName>
        <cbc:CityName>${xml(a.city)}</cbc:CityName>
        <cbc:PostalZone>${xml(a.zip)}</cbc:PostalZone>
        <cac:Country><cbc:IdentificationCode>${xml(a.country.toUpperCase())}</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>`;
}

function taxCategory(m: EModel, category: TaxCategory, rate: number, tag = 'cac:TaxCategory'): string {
  const reason = category !== 'S' && m.exemptionReason
    ? `\n          ${m.exemptionCode ? `<cbc:TaxExemptionReasonCode>${m.exemptionCode}</cbc:TaxExemptionReasonCode>\n          ` : ''}<cbc:TaxExemptionReason>${xml(m.exemptionReason)}</cbc:TaxExemptionReason>`
    : '';
  return `<${tag}>
          <cbc:ID>${category}</cbc:ID>
          <cbc:Percent>${pct(rate)}</cbc:Percent>${tag === 'cac:TaxCategory' ? reason : ''}
          <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
        </${tag}>`;
}

/**
 * EN 16931 UBL 2.1 (Profil XRechnung 3.0). Stornos werden als CreditNote mit
 * positiven Beträgen und Verweis auf die Originalrechnung ausgegeben.
 */
export function toUbl(m: EModel): string {
  const { doc, seller, buyer } = m;
  const root = m.isCredit ? 'CreditNote' : 'Invoice';
  const s = m.isCredit ? -1 : 1;
  const qtyTag = m.isCredit ? 'cbc:CreditedQuantity' : 'cbc:InvoicedQuantity';
  const lineTag = m.isCredit ? 'cac:CreditNoteLine' : 'cac:InvoiceLine';

  const sellerTax = [
    seller.vatId ? `<cac:PartyTaxScheme><cbc:CompanyID>${xml(seller.vatId.replace(/\s/g, ''))}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>` : '',
    !seller.vatId && seller.taxNumber ? `<cac:PartyTaxScheme><cbc:CompanyID>${xml(seller.taxNumber)}</cbc:CompanyID><cac:TaxScheme><cbc:ID>FC</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>` : '',
  ].join('');

  const lines = m.lines
    .map((l) => {
      const allowance = l.discount
        ? `
      <cac:AllowanceCharge>
        <cbc:ChargeIndicator>false</cbc:ChargeIndicator>
        <cbc:AllowanceChargeReason>Rabatt</cbc:AllowanceChargeReason>
        <cbc:MultiplierFactorNumeric>${pct(l.discountPercent)}</cbc:MultiplierFactorNumeric>
        <cbc:Amount currencyID="EUR">${amt(s * l.discount)}</cbc:Amount>
        <cbc:BaseAmount currencyID="EUR">${amt(s * (l.net + l.discount))}</cbc:BaseAmount>
      </cac:AllowanceCharge>`
        : '';
      return `    <${lineTag}>
      <cbc:ID>${l.position}</cbc:ID>
      <${qtyTag} unitCode="${xml(l.unitCode)}">${qty(s * l.quantity)}</${qtyTag}>
      <cbc:LineExtensionAmount currencyID="EUR">${amt(s * l.net)}</cbc:LineExtensionAmount>${allowance}
      <cac:Item>
        <cbc:Name>${xml(l.description.split('\n')[0].slice(0, 200))}</cbc:Name>
        ${taxCategory(m, l.category, l.rate, 'cac:ClassifiedTaxCategory')}
      </cac:Item>
      <cac:Price><cbc:PriceAmount currencyID="EUR">${amt(l.unitPrice)}</cbc:PriceAmount></cac:Price>
    </${lineTag}>`;
    })
    .join('\n');

  const subtotals = m.groups
    .map(
      (g) => `    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="EUR">${amt(s * g.net)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="EUR">${amt(s * g.vat)}</cbc:TaxAmount>
      ${taxCategory(m, g.category, g.rate)}
    </cac:TaxSubtotal>`,
    )
    .join('\n');

  const period =
    doc.serviceDateTo && doc.serviceDateTo !== doc.serviceDateFrom
      ? `<cac:InvoicePeriod><cbc:StartDate>${doc.serviceDateFrom}</cbc:StartDate><cbc:EndDate>${doc.serviceDateTo}</cbc:EndDate></cac:InvoicePeriod>`
      : '';
  const deliveryDate = !period && doc.serviceDateFrom
    ? `<cac:Delivery><cbc:ActualDeliveryDate>${doc.serviceDateFrom}</cbc:ActualDeliveryDate></cac:Delivery>`
    : '';
  const billingRef = m.isCredit && m.sourceNumber
    ? `<cac:BillingReference><cac:InvoiceDocumentReference><cbc:ID>${xml(m.sourceNumber)}</cbc:ID><cbc:IssueDate>${m.sourceDate}</cbc:IssueDate></cac:InvoiceDocumentReference></cac:BillingReference>`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<${root} xmlns="urn:oasis:names:specification:ubl:schema:xsd:${root}-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>${XRECHNUNG_ID}</cbc:CustomizationID>
  <cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</cbc:ProfileID>
  <cbc:ID>${xml(doc.number)}</cbc:ID>
  <cbc:IssueDate>${doc.issueDate}</cbc:IssueDate>
  ${!m.isCredit && doc.dueDate ? `<cbc:DueDate>${doc.dueDate}</cbc:DueDate>` : ''}
  <cbc:${root}TypeCode>${m.isCredit ? '381' : '380'}</cbc:${root}TypeCode>
  ${m.exemptionReason ? `<cbc:Note>${xml(m.exemptionReason)}</cbc:Note>` : ''}
  <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
  <cbc:BuyerReference>${xml(buyer.buyerReference || buyer.number || doc.number)}</cbc:BuyerReference>
  ${period}
  ${billingRef}
  <cac:AccountingSupplierParty>
    <cac:Party>
      ${seller.email ? `<cbc:EndpointID schemeID="EM">${xml(seller.email)}</cbc:EndpointID>` : ''}
      <cac:PartyName><cbc:Name>${xml(seller.name)}</cbc:Name></cac:PartyName>
      ${postal(seller.address)}
      ${sellerTax}
      <cac:PartyLegalEntity><cbc:RegistrationName>${xml(seller.name)}</cbc:RegistrationName></cac:PartyLegalEntity>
      <cac:Contact>
        <cbc:Name>${xml(seller.owner || seller.name)}</cbc:Name>
        ${seller.phone ? `<cbc:Telephone>${xml(seller.phone)}</cbc:Telephone>` : ''}
        ${seller.email ? `<cbc:ElectronicMail>${xml(seller.email)}</cbc:ElectronicMail>` : ''}
      </cac:Contact>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      ${buyer.email ? `<cbc:EndpointID schemeID="EM">${xml(buyer.email)}</cbc:EndpointID>` : ''}
      <cac:PartyName><cbc:Name>${xml(buyer.name)}</cbc:Name></cac:PartyName>
      ${postal(buyer.address)}
      ${buyer.vatId ? `<cac:PartyTaxScheme><cbc:CompanyID>${xml(buyer.vatId.replace(/\s/g, ''))}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>` : ''}
      <cac:PartyLegalEntity><cbc:RegistrationName>${xml(buyer.name)}</cbc:RegistrationName></cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>
  ${deliveryDate}
  ${seller.iban ? `<cac:PaymentMeans>
    <cbc:PaymentMeansCode>58</cbc:PaymentMeansCode>
    <cbc:PaymentID>${xml(doc.number)}</cbc:PaymentID>
    <cac:PayeeFinancialAccount>
      <cbc:ID>${xml(seller.iban.replace(/\s/g, ''))}</cbc:ID>
      <cbc:Name>${xml(seller.name)}</cbc:Name>
      ${seller.bic ? `<cac:FinancialInstitutionBranch><cbc:ID>${xml(seller.bic.replace(/\s/g, ''))}</cbc:ID></cac:FinancialInstitutionBranch>` : ''}
    </cac:PayeeFinancialAccount>
  </cac:PaymentMeans>` : ''}
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="EUR">${amt(s * m.vat)}</cbc:TaxAmount>
${subtotals}
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="EUR">${amt(s * m.net)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="EUR">${amt(s * m.net)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="EUR">${amt(s * m.gross)}</cbc:TaxInclusiveAmount>
    ${m.prepaid ? `<cbc:PrepaidAmount currencyID="EUR">${amt(s * m.prepaid)}</cbc:PrepaidAmount>` : ''}
    <cbc:PayableAmount currencyID="EUR">${amt(s * m.payable)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
${lines}
</${root}>
`;
}
