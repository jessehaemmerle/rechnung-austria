import { amt, pct, qty, xml, type EModel } from './model';
import type { Address } from '../types';

/** ebInterface verwendet die Steuerkategorien: S, AA (ermäßigt), E (befreit), AE (Reverse Charge), K (ig. Lieferung) */
function ebCategory(category: string, rate: number): string {
  if (category === 'S') return rate === 20 ? 'S' : 'AA';
  return category;
}

function address(name: string, a: Address, email: string, contact = ''): string {
  return `<Address>
      <Name>${xml(name)}</Name>
      <Street>${xml(a.street)}</Street>
      <Town>${xml(a.city)}</Town>
      <ZIP>${xml(a.zip)}</ZIP>
      <Country CountryCode="${xml(a.country.toUpperCase())}"/>
      ${email ? `<Email>${xml(email)}</Email>` : ''}
    </Address>${contact ? `\n    <Contact><Name>${xml(contact)}</Name></Contact>` : ''}`;
}

/** Erzeugt ein ebInterface 6.1 XML (österreichischer E-Rechnungsstandard, E-Rechnung.gv.at). */
export function toEbInterface(m: EModel): string {
  const { doc, seller, buyer } = m;
  const lang = doc.language === 'de' ? 'ger' : 'eng';
  const delivery =
    doc.serviceDateTo && doc.serviceDateTo !== doc.serviceDateFrom
      ? `<Period><FromDate>${doc.serviceDateFrom}</FromDate><ToDate>${doc.serviceDateTo}</ToDate></Period>`
      : `<Date>${doc.serviceDateFrom}</Date>`;
  // Ohne UID ist laut ebInterface "00000000" anzugeben (z. B. Kleinunternehmer).
  const sellerUid = seller.vatId.replace(/\s/g, '') || '00000000';
  const buyerUid = buyer.vatId.replace(/\s/g, '') || '00000000';

  const items = m.lines
    .map(
      (l) => `      <ListLineItem>
        <PositionNumber>${l.position}</PositionNumber>
        <Description>${xml(l.description)}</Description>
        <Quantity Unit="${xml(l.unitCode)}">${qty(l.quantity)}</Quantity>
        <UnitPrice>${amt(l.unitPrice)}</UnitPrice>${
          l.discount
            ? `
        <ReductionAndSurchargeListLineItemDetails>
          <ReductionListLineItem>
            <BaseAmount>${amt(l.net + l.discount)}</BaseAmount>
            <Percentage>${pct(l.discountPercent)}</Percentage>
            <Amount>${amt(l.discount)}</Amount>
          </ReductionListLineItem>
        </ReductionAndSurchargeListLineItemDetails>`
            : ''
        }
        <TaxItem>
          <TaxableAmount>${amt(l.net)}</TaxableAmount>
          <TaxPercent TaxCategoryCode="${ebCategory(l.category, l.rate)}">${pct(l.rate)}</TaxPercent>
          <TaxAmount>${amt(Math.round((l.net * l.rate) / 100))}</TaxAmount>
        </TaxItem>
        <LineItemAmount>${amt(l.net)}</LineItemAmount>
      </ListLineItem>`,
    )
    .join('\n');

  const taxItems = m.groups
    .map(
      (g) => `    <TaxItem>
      <TaxableAmount>${amt(g.net)}</TaxableAmount>
      <TaxPercent TaxCategoryCode="${ebCategory(g.category, g.rate)}">${pct(g.rate)}</TaxPercent>
      <TaxAmount>${amt(g.vat)}</TaxAmount>
    </TaxItem>`,
    )
    .join('\n');

  const related = m.isCredit && m.sourceNumber
    ? `\n  <CancelledOriginalDocument>
    <InvoiceNumber>${xml(m.sourceNumber)}</InvoiceNumber>
    <InvoiceDate>${m.sourceDate}</InvoiceDate>
    <DocumentType>Invoice</DocumentType>
  </CancelledOriginalDocument>`
    : '';

  const payment = seller.iban
    ? `  <PaymentMethod>
    <UniversalBankTransaction>
      <BeneficiaryAccount>
        ${seller.bic ? `<BIC>${xml(seller.bic.replace(/\s/g, ''))}</BIC>` : ''}
        <IBAN>${xml(seller.iban.replace(/\s/g, ''))}</IBAN>
        <BankAccountOwner>${xml(seller.name)}</BankAccountOwner>
      </BeneficiaryAccount>
      <PaymentReference>${xml(doc.number)}</PaymentReference>
    </UniversalBankTransaction>
  </PaymentMethod>`
    : `  <PaymentMethod><NoPayment/></PaymentMethod>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="http://www.ebinterface.at/schema/6p1/" GeneratingSystem="Rechnung Austria" DocumentType="${m.isCredit ? 'InvoiceCorrection' : 'Invoice'}" InvoiceCurrency="EUR" Language="${lang}">
  <InvoiceNumber>${xml(doc.number)}</InvoiceNumber>
  <InvoiceDate>${doc.issueDate}</InvoiceDate>${related}
  <Delivery>${delivery}</Delivery>
  <Biller>
    <VATIdentificationNumber>${xml(sellerUid)}</VATIdentificationNumber>
    ${address(seller.name, seller.address, seller.email, seller.owner)}
  </Biller>
  <InvoiceRecipient>
    <VATIdentificationNumber>${xml(buyerUid)}</VATIdentificationNumber>
    ${buyer.buyerReference ? `<OrderReference><OrderID>${xml(buyer.buyerReference)}</OrderID></OrderReference>` : ''}
    ${address(buyer.name, buyer.address, buyer.email, buyer.contactPerson)}
  </InvoiceRecipient>
  <Details>
    <ItemList>
${items}
    </ItemList>
  </Details>
  <Tax>
${taxItems}
  </Tax>
  <TotalGrossAmount>${amt(m.gross)}</TotalGrossAmount>${m.prepaid ? `\n  <PrepaidAmount>${amt(m.prepaid)}</PrepaidAmount>` : ''}
  <PayableAmount>${amt(m.payable)}</PayableAmount>
${payment}
  ${doc.dueDate ? `<PaymentConditions><DueDate>${doc.dueDate}</DueDate></PaymentConditions>` : ''}
  ${m.exemptionReason ? `<Comment>${xml(m.exemptionReason)}</Comment>` : ''}
</Invoice>
`;
}
