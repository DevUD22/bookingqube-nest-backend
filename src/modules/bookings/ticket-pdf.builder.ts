import PDFDocument = require('pdfkit');
import * as QRCode from 'qrcode';

export type TicketCardTheme = {
  accent: string;
  accentSoft: string;
  accentDark: string;
};

export type TicketCardAddon = {
  title: string;
  quantity: number;
  priceLabel: string;
};

export type TicketCardModel = {
  theme: TicketCardTheme;
  passLabel: string;
  tagLine: string;
  eventTitle: string;
  ticketSubtitle: string;
  dateLabel: string;
  sessionLabel: string;
  briefingLabel: string;
  venueLabel: string;
  directionsUrl: string | null;
  attendeeName: string;
  paidLabel: string;
  scanCode: string;
  ticketExtraText: string;
  disclaimer: string;
  contactPhone: string;
  addons: TicketCardAddon[];
};

export const TICKET_CARD_THEMES: TicketCardTheme[] = [
  {
    accent: '#8B5CF6',
    accentSoft: '#EDE9FE',
    accentDark: '#6D28D9',
  },
  {
    accent: '#F472B6',
    accentSoft: '#FCE7F3',
    accentDark: '#DB2777',
  },
];

const PAGE_MARGIN_X = 22;
const PAGE_MARGIN_Y = 20;
const CARD_GAP = 10;
const ACCENT_WIDTH = 5;
const FOOTER_HEIGHT = 24;
const ADDON_ROW_HEIGHT = 16;
const QR_SIZE = 78;

/**
 * Builds the modern BookingQube card ticket PDF (same layout as legacy v2 card format),
 * with an optional ADD-ONS block when the order included add-ons.
 */
export async function buildTicketCardsPdf(
  cards: TicketCardModel[],
  logoBuffer: Buffer | null,
): Promise<Buffer> {
  if (cards.length === 0) {
    throw new Error('No ticket cards to render.');
  }

  const qrBuffers = await Promise.all(
    cards.map((card) =>
      QRCode.toBuffer(card.scanCode, {
        type: 'png',
        margin: 1,
        width: 140,
        errorCorrectionLevel: 'M',
      }),
    ),
  );

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 0,
      info: {
        Title: 'BookingQube Tickets',
        Author: 'BookingQube',
      },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk as Buffer));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const contentWidth = pageWidth - PAGE_MARGIN_X * 2;
    const pageBottom = pageHeight - PAGE_MARGIN_Y;
    let cursorY = PAGE_MARGIN_Y;

    cards.forEach((card, index) => {
      const cardHeight = measureCardHeight(card);

      if (index > 0 && cursorY + cardHeight > pageBottom) {
        doc.addPage();
        cursorY = PAGE_MARGIN_Y;
      }

      drawTicketCard(
        doc,
        card,
        logoBuffer,
        qrBuffers[index],
        PAGE_MARGIN_X,
        cursorY,
        contentWidth,
        cardHeight,
      );
      cursorY += cardHeight + CARD_GAP;
    });

    doc.end();
  });
}

function measureCardHeight(card: TicketCardModel): number {
  // Main column content (top → bottom, before footer)
  let mainHeight = 8; // top pad
  mainHeight += 20; // logo / pills
  mainHeight += 16; // event title
  mainHeight += 12; // ticket subtitle
  mainHeight += 26; // date / session / briefing
  mainHeight += card.directionsUrl ? 32 : 26; // venue / attendee / paid
  if (card.addons.length > 0) {
    const addonCount = Math.min(card.addons.length, 3);
    mainHeight += 10; // ADD-ONS label
    mainHeight += addonCount * ADDON_ROW_HEIGHT;
    if (card.addons.length > 3) {
      mainHeight += 8;
    }
  }
  mainHeight += 6; // bottom pad above footer

  // Stub column content (QR + labels)
  const stubHeight = 8 + 12 + QR_SIZE + 6 + 7 + 18 + 10 + 4;

  return Math.max(mainHeight, stubHeight) + FOOTER_HEIGHT;
}

function drawTicketCard(
  doc: PDFKit.PDFDocument,
  card: TicketCardModel,
  logoBuffer: Buffer | null,
  qrBuffer: Buffer,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const { accent, accentSoft, accentDark } = card.theme;
  const radius = 10;
  const stubRatio = 0.3;
  const stubWidth = width * stubRatio;
  const mainWidth = width - stubWidth;
  const bodyHeight = height - FOOTER_HEIGHT;

  // Soft shadow shell
  doc.save();
  doc.roundedRect(x + 1, y + 2, width, height, radius).fill('#CBD5E1');
  doc.restore();

  // Card background
  doc.save();
  doc.roundedRect(x, y, width, height, radius).fill('#FFFFFF');
  doc.restore();

  // Left accent bar
  doc.save();
  doc.rect(x, y + radius, ACCENT_WIDTH, height - radius * 2).fill(accent);
  doc
    .moveTo(x, y + radius)
    .quadraticCurveTo(x, y, x + radius, y)
    .lineTo(x + ACCENT_WIDTH, y)
    .lineTo(x + ACCENT_WIDTH, y + radius)
    .fill(accent);
  doc
    .moveTo(x, y + height - radius)
    .quadraticCurveTo(x, y + height, x + radius, y + height)
    .lineTo(x + ACCENT_WIDTH, y + height)
    .lineTo(x + ACCENT_WIDTH, y + height - radius)
    .fill(accent);
  doc.restore();

  // Card border
  doc.save();
  doc.roundedRect(x, y, width, height, radius).lineWidth(1).strokeColor('#E5E7EB').stroke();
  doc.restore();

  // Stub background
  doc.save();
  doc.rect(x + mainWidth, y + 1, stubWidth - 1, bodyHeight - 1).fill(accentSoft);
  doc.restore();

  // Dashed divider
  doc.save();
  doc
    .moveTo(x + mainWidth, y + 8)
    .lineTo(x + mainWidth, y + bodyHeight - 8)
    .dash(3, { space: 3 })
    .lineWidth(1.25)
    .strokeColor('#D1D5DB')
    .stroke();
  doc.undash();
  doc.restore();

  const mainLeft = x + ACCENT_WIDTH + 8;
  const mainRight = x + mainWidth - 8;
  const mainInnerWidth = mainRight - mainLeft;
  let cursorY = y + 8;

  // Brand + pills
  if (logoBuffer) {
    try {
      doc.image(logoBuffer, mainLeft, cursorY, { fit: [100, 18] });
    } catch {
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#111827').text('BookingQube', mainLeft, cursorY + 2);
    }
  } else {
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#111827').text('BookingQube', mainLeft, cursorY + 2);
  }

  const pillY = cursorY + 1;
  doc.font('Helvetica-Bold').fontSize(6);
  const passPillWidth = Math.min(88, doc.widthOfString(card.passLabel) + 14);
  drawPill(
    doc,
    mainRight - passPillWidth,
    pillY,
    passPillWidth,
    12,
    accentSoft,
    accentDark,
    card.passLabel,
  );
  const tagWidth = Math.min(92, doc.widthOfString(card.tagLine) + 14);
  drawPill(
    doc,
    mainRight - passPillWidth - tagWidth - 4,
    pillY,
    tagWidth,
    12,
    '#F3F4F6',
    '#374151',
    card.tagLine,
  );

  cursorY += 20;
  doc
    .font('Helvetica-Bold')
    .fontSize(13)
    .fillColor('#111827')
    .text(card.eventTitle, mainLeft, cursorY, {
      width: mainInnerWidth,
      lineGap: 0,
      height: 16,
      ellipsis: true,
    });
  cursorY += 16;

  doc
    .font('Helvetica-Bold')
    .fontSize(8.5)
    .fillColor(accent)
    .text(card.ticketSubtitle, mainLeft, cursorY, {
      width: mainInnerWidth,
      height: 11,
      ellipsis: true,
    });
  cursorY += 12;

  const colWidth = mainInnerWidth / 3;
  drawLabeledValue(doc, mainLeft, cursorY, colWidth - 6, 'DATE', card.dateLabel);
  drawLabeledValue(doc, mainLeft + colWidth, cursorY, colWidth - 6, 'SESSION', card.sessionLabel);
  drawLabeledValue(
    doc,
    mainLeft + colWidth * 2,
    cursorY,
    colWidth - 2,
    'ARRIVE FOR BRIEFING',
    card.briefingLabel,
    accent,
  );

  cursorY += 26;
  drawLabeledValue(doc, mainLeft, cursorY, colWidth - 6, 'VENUE', card.venueLabel || '—', '#111827', 8);
  if (card.directionsUrl) {
    doc
      .font('Helvetica-Bold')
      .fontSize(7)
      .fillColor(accent)
      .text('↗ Get directions', mainLeft, cursorY + 20, {
        width: colWidth - 6,
        link: card.directionsUrl,
        underline: false,
      });
  }
  drawLabeledValue(doc, mainLeft + colWidth, cursorY, colWidth - 6, 'ATTENDEE', card.attendeeName || '—');
  drawLabeledValue(
    doc,
    mainLeft + colWidth * 2,
    cursorY,
    colWidth - 2,
    'PAID',
    card.paidLabel,
    accent,
    11,
  );

  cursorY += card.directionsUrl ? 32 : 26;

  if (card.addons.length > 0) {
    doc.font('Helvetica-Bold').fontSize(6.5).fillColor('#9CA3AF').text('ADD-ONS', mainLeft, cursorY);
    cursorY += 10;

    const maxAddonRows = 3;
    const visibleAddons = card.addons.slice(0, maxAddonRows);
    for (const addon of visibleAddons) {
      const rowTop = cursorY;
      doc
        .roundedRect(mainLeft, rowTop, mainInnerWidth, 14, 3)
        .lineWidth(0.75)
        .strokeColor('#E5E7EB')
        .stroke();
      doc
        .font('Helvetica-Bold')
        .fontSize(7.5)
        .fillColor('#111827')
        .text(addon.title, mainLeft + 5, rowTop + 3, {
          width: mainInnerWidth * 0.55,
          lineBreak: false,
          ellipsis: true,
        });
      doc
        .font('Helvetica')
        .fontSize(7)
        .fillColor('#6B7280')
        .text(`Qty ${addon.quantity}`, mainLeft + mainInnerWidth * 0.55, rowTop + 3.5, {
          width: mainInnerWidth * 0.18,
          lineBreak: false,
        });
      doc
        .font('Helvetica-Bold')
        .fontSize(7.5)
        .fillColor(accent)
        .text(addon.priceLabel, mainLeft + mainInnerWidth * 0.72, rowTop + 3, {
          width: mainInnerWidth * 0.28 - 6,
          align: 'right',
          lineBreak: false,
        });
      cursorY += ADDON_ROW_HEIGHT;
    }

    if (card.addons.length > maxAddonRows) {
      doc
        .font('Helvetica')
        .fontSize(6.5)
        .fillColor('#6B7280')
        .text(`+${card.addons.length - maxAddonRows} more add-on(s)`, mainLeft, cursorY);
    }
  }

  // Stub / QR
  const stubLeft = x + mainWidth;
  const stubCenterX = stubLeft + stubWidth / 2;
  let stubY = y + 8;

  doc
    .font('Helvetica-Bold')
    .fontSize(6.5)
    .fillColor(accentDark)
    .text('SCAN AT ENTRANCE', stubLeft + 6, stubY, {
      width: stubWidth - 12,
      align: 'center',
      characterSpacing: 0.4,
    });
  stubY += 12;

  const qrSize = Math.min(QR_SIZE, stubWidth - 22);
  const qrX = stubCenterX - qrSize / 2;
  doc
    .roundedRect(qrX - 3, stubY - 3, qrSize + 6, qrSize + 6, 5)
    .lineWidth(1)
    .fillAndStroke('#FFFFFF', '#E5E7EB');
  doc.image(qrBuffer, qrX, stubY, { fit: [qrSize, qrSize] });
  stubY += qrSize + 6;

  doc
    .font('Helvetica-Bold')
    .fontSize(5.5)
    .fillColor('#9CA3AF')
    .text('TICKET ID', stubLeft + 6, stubY, {
      width: stubWidth - 12,
      align: 'center',
      characterSpacing: 0.35,
    });
  stubY += 7;

  const ticketIdText =
    card.ticketExtraText !== '' ? `${card.scanCode}  ${card.ticketExtraText}` : card.scanCode;
  doc
    .font('Helvetica-Bold')
    .fontSize(6)
    .fillColor('#111827')
    .text(ticketIdText, stubLeft + 6, stubY, {
      width: stubWidth - 12,
      align: 'center',
    });
  stubY = doc.y + 2;

  doc
    .font('Helvetica')
    .fontSize(5.5)
    .fillColor('#9CA3AF')
    .text('One scan · one entry', stubLeft + 6, stubY, {
      width: stubWidth - 12,
      align: 'center',
    });

  // Footer
  const footerY = y + bodyHeight;
  doc
    .moveTo(x + 1, footerY)
    .lineTo(x + width - 1, footerY)
    .lineWidth(1)
    .strokeColor('#F3F4F6')
    .stroke();

  doc
    .font('Helvetica')
    .fontSize(5.5)
    .fillColor('#9CA3AF')
    .text(card.disclaimer, x + 10, footerY + 5, {
      width: width * 0.7,
      lineGap: 0,
      height: 14,
    });

  doc
    .font('Helvetica')
    .fontSize(6.5)
    .fillColor('#9CA3AF')
    .text(`☎ ${card.contactPhone}`, x + width * 0.72, footerY + 6, {
      width: width * 0.28 - 10,
      align: 'right',
    });
}

function drawPill(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  width: number,
  height: number,
  bg: string,
  fg: string,
  label: string,
) {
  doc.save();
  doc.roundedRect(x, y, width, height, height / 2).fill(bg);
  doc
    .font('Helvetica-Bold')
    .fontSize(6)
    .fillColor(fg)
    .text(label, x + 3, y + (height - 6.5) / 2, {
      width: width - 6,
      align: 'center',
      lineBreak: false,
      ellipsis: true,
    });
  doc.restore();
}

function drawLabeledValue(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  width: number,
  label: string,
  value: string,
  valueColor = '#111827',
  valueSize = 8.5,
) {
  doc.font('Helvetica-Bold').fontSize(6).fillColor('#9CA3AF').text(label, x, y, {
    width,
    characterSpacing: 0.35,
  });
  doc
    .font('Helvetica-Bold')
    .fontSize(valueSize)
    .fillColor(valueColor)
    .text(value || '—', x, y + 8, {
      width,
      lineGap: 0,
      height: 16,
      ellipsis: true,
    });
}
