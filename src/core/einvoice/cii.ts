import { amt, pct, qty, xml, type EModel, type TaxCategory } from './model';
import type { Address } from '../types';

const d8 = (iso: string) => iso.replace(/-/g, '');
const date = (iso: string) => `<udt:DateTimeString format="102">${d8(iso)}</udt:DateTimeString>`;

function addr(a: Address): string {
  return `<ram:PostalTradeAddress>
          <ram:PostcodeCode>${xml(a.zip)}</ram:PostcodeCode>
          <ram:LineOne>${xml(a.street)}</ram:LineOne>
          <ram:CityName>${xml(a.city)}</ram:CityName>
          <ram:CountryID>${xml(a.country.toUpperCase())}</ram:CountryID>
        </ram:PostalTradeAddress>`;
}

/** Reihenfolge laut CII-Schema: CalculatedAmount, TypeCode, ExemptionReason, BasisAmount, CategoryCode, ExemptionReasonCode, RateApplicablePercent */
function tradeTax(m: EModel, category: TaxCategory, rate: number, header?: { net: number; vat: number }): string {
  const exempt = category !== 'S' && category !== 'Z' && !!m.exemptionReason && !!header;
  return [
    header ? `<ram:CalculatedAmount>${amt(header.vat)}</ram:CalculatedAmount>` : '',
    '<ram:TypeCode>VAT</ram:TypeCode>',
    exempt ? `<ram:ExemptionReason>${xml(m.exemptionReason)}</ram:ExemptionReason>` : '',
    header ? `<ram:BasisAmount>${amt(header.net)}</ram:BasisAmount>` : '',
    `<ram:CategoryCode>${category}</ram:CategoryCode>`,
    exempt && m.exemptionCode ? `<ram:ExemptionReasonCode>${m.exemptionCode}</ram:ExemptionReasonCode>` : '',
    `<ram:RateApplicablePercent>${pct(rate)}</ram:RateApplicablePercent>`,
  ].join('');
}

/**
 * UN/CEFACT Cross Industry Invoice (Factur-X 1.0 / ZUGFeRD 2.x, Profil EN 16931).
 * Wird als factur-x.xml in das PDF eingebettet.
 */
export function toCii(m: EModel): string {
  const { doc, seller, buyer } = m;
  const s = m.isCredit ? -1 : 1;

  const lines = m.lines
    .map(
      (l) => `    <ram:IncludedSupplyChainTradeLineItem>
      <ram:AssociatedDocumentLineDocument><ram:LineID>${l.position}</ram:LineID></ram:AssociatedDocumentLineDocument>
      <ram:SpecifiedTradeProduct><ram:Name>${xml(l.description)}</ram:Name></ram:SpecifiedTradeProduct>
      <ram:SpecifiedLineTradeAgreement>
        ${l.discount ? `<ram:GrossPriceProductTradePrice><ram:ChargeAmount>${amt(l.unitPrice)}</ram:ChargeAmount></ram:GrossPriceProductTradePrice>` : ''}
        <ram:NetPriceProductTradePrice><ram:ChargeAmount>${l.discount ? (Math.round(((s * l.net) / (s * l.quantity)) * 100) / 10000).toFixed(4) : amt(l.unitPrice)}</ram:ChargeAmount></ram:NetPriceProductTradePrice>
      </ram:SpecifiedLineTradeAgreement>
      <ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="${xml(l.unitCode)}">${qty(s * l.quantity)}</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery>
      <ram:SpecifiedLineTradeSettlement>
        <ram:ApplicableTradeTax>${tradeTax(m, l.category, l.rate)}</ram:ApplicableTradeTax>
        <ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>${amt(s * l.net)}</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation>
      </ram:SpecifiedLineTradeSettlement>
    </ram:IncludedSupplyChainTradeLineItem>`,
    )
    .join('\n');

  const taxes = m.groups
    .map((g) => `      <ram:ApplicableTradeTax>${tradeTax(m, g.category, g.rate, { net: s * g.net, vat: s * g.vat })}</ram:ApplicableTradeTax>`)
    .join('\n');

  const period = doc.serviceDateTo && doc.serviceDateTo !== doc.serviceDateFrom
    ? `<ram:BillingSpecifiedPeriod><ram:StartDateTime>${date(doc.serviceDateFrom)}</ram:StartDateTime><ram:EndDateTime>${date(doc.serviceDateTo)}</ram:EndDateTime></ram:BillingSpecifiedPeriod>`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"
  xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100"
  xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100"
  xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
  <rsm:ExchangedDocumentContext>
    <ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>urn:cen.eu:en16931:2017</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter>
  </rsm:ExchangedDocumentContext>
  <rsm:ExchangedDocument>
    <ram:ID>${xml(doc.number)}</ram:ID>
    <ram:TypeCode>${m.isCredit ? '381' : '380'}</ram:TypeCode>
    <ram:IssueDateTime>${date(doc.issueDate)}</ram:IssueDateTime>
    ${m.exemptionReason ? `<ram:IncludedNote><ram:Content>${xml(m.exemptionReason)}</ram:Content></ram:IncludedNote>` : ''}
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>
${lines}
    <ram:ApplicableHeaderTradeAgreement>
      ${buyer.buyerReference ? `<ram:BuyerReference>${xml(buyer.buyerReference)}</ram:BuyerReference>` : ''}
      <ram:SellerTradeParty>
        ${!seller.vatId && seller.taxNumber ? `<ram:ID>${xml(seller.taxNumber)}</ram:ID>` : ''}
        <ram:Name>${xml(seller.name)}</ram:Name>
        ${seller.owner || seller.email ? `<ram:DefinedTradeContact>${seller.owner ? `<ram:PersonName>${xml(seller.owner)}</ram:PersonName>` : ''}${seller.phone ? `<ram:TelephoneUniversalCommunication><ram:CompleteNumber>${xml(seller.phone)}</ram:CompleteNumber></ram:TelephoneUniversalCommunication>` : ''}${seller.email ? `<ram:EmailURIUniversalCommunication><ram:URIID>${xml(seller.email)}</ram:URIID></ram:EmailURIUniversalCommunication>` : ''}</ram:DefinedTradeContact>` : ''}
        ${addr(seller.address)}
        ${seller.email ? `<ram:URIUniversalCommunication><ram:URIID schemeID="EM">${xml(seller.email)}</ram:URIID></ram:URIUniversalCommunication>` : ''}
        ${seller.vatId ? `<ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${xml(seller.vatId.replace(/\s/g, ''))}</ram:ID></ram:SpecifiedTaxRegistration>` : ''}
        ${seller.taxNumber ? `<ram:SpecifiedTaxRegistration><ram:ID schemeID="FC">${xml(seller.taxNumber)}</ram:ID></ram:SpecifiedTaxRegistration>` : ''}
      </ram:SellerTradeParty>
      <ram:BuyerTradeParty>
        <ram:Name>${xml(buyer.name)}</ram:Name>
        ${addr(buyer.address)}
        ${buyer.email ? `<ram:URIUniversalCommunication><ram:URIID schemeID="EM">${xml(buyer.email)}</ram:URIID></ram:URIUniversalCommunication>` : ''}
        ${buyer.vatId ? `<ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${xml(buyer.vatId.replace(/\s/g, ''))}</ram:ID></ram:SpecifiedTaxRegistration>` : ''}
      </ram:BuyerTradeParty>
    </ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeDelivery>
      ${doc.taxCase === 'ig_delivery' ? `<ram:ShipToTradeParty><ram:PostalTradeAddress><ram:CountryID>${xml(buyer.address.country.toUpperCase())}</ram:CountryID></ram:PostalTradeAddress></ram:ShipToTradeParty>` : ''}
      ${!period && doc.serviceDateFrom ? `<ram:ActualDeliverySupplyChainEvent><ram:OccurrenceDateTime>${date(doc.serviceDateFrom)}</ram:OccurrenceDateTime></ram:ActualDeliverySupplyChainEvent>` : ''}
    </ram:ApplicableHeaderTradeDelivery>
    <ram:ApplicableHeaderTradeSettlement>
      <ram:PaymentReference>${xml(doc.number)}</ram:PaymentReference>
      <ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>
      ${seller.iban ? `<ram:SpecifiedTradeSettlementPaymentMeans>
        <ram:TypeCode>58</ram:TypeCode>
        <ram:PayeePartyCreditorFinancialAccount><ram:IBANID>${xml(seller.iban.replace(/\s/g, ''))}</ram:IBANID><ram:AccountName>${xml(seller.name)}</ram:AccountName></ram:PayeePartyCreditorFinancialAccount>
        ${seller.bic ? `<ram:PayeeSpecifiedCreditorFinancialInstitution><ram:BICID>${xml(seller.bic.replace(/\s/g, ''))}</ram:BICID></ram:PayeeSpecifiedCreditorFinancialInstitution>` : ''}
      </ram:SpecifiedTradeSettlementPaymentMeans>` : ''}
${taxes}
      ${period}
      ${doc.dueDate ? `<ram:SpecifiedTradePaymentTerms><ram:DueDateDateTime>${date(doc.dueDate)}</ram:DueDateDateTime></ram:SpecifiedTradePaymentTerms>` : ''}
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:LineTotalAmount>${amt(s * m.net)}</ram:LineTotalAmount>
        <ram:TaxBasisTotalAmount>${amt(s * m.net)}</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="EUR">${amt(s * m.vat)}</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>${amt(s * m.gross)}</ram:GrandTotalAmount>
        ${m.prepaid ? `<ram:TotalPrepaidAmount>${amt(s * m.prepaid)}</ram:TotalPrepaidAmount>` : ''}
        <ram:DuePayableAmount>${amt(s * m.payable)}</ram:DuePayableAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
      ${m.isCredit && m.sourceNumber ? `<ram:InvoiceReferencedDocument><ram:IssuerAssignedID>${xml(m.sourceNumber)}</ram:IssuerAssignedID><ram:FormattedIssueDateTime><qdt:DateTimeString format="102">${d8(m.sourceDate)}</qdt:DateTimeString></ram:FormattedIssueDateTime></ram:InvoiceReferencedDocument>` : ''}
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>
`;
}
