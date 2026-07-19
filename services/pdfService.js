const PDFDocument = require('pdfkit');
const path = require('path');

/**
 * Helper to convert numbers into Indian numbering words (Rupees and Paise)
 */
const numberToIndianWords = (num) => {
  if (num === 0) return 'Zero Rupees';
  const a = ['', 'One ', 'Two ', 'Three ', 'Four ', 'Five ', 'Six ', 'Seven ', 'Eight ', 'Nine ', 'Ten ', 'Eleven ', 'Twelve ', 'Thirteen ', 'Fourteen ', 'Fifteen ', 'Sixteen ', 'Seventeen ', 'Eighteen ', 'Nineteen '];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const g = ['', 'Thousand', 'Lakh', 'Crore'];

  const helper = (n) => {
    let str = '';
    if (n > 99) {
      str += a[Math.floor(n / 100)] + 'Hundred ';
      n %= 100;
    }
    if (n > 19) {
      str += b[Math.floor(n / 10)] + ' ' + a[n % 10];
    } else if (n > 0) {
      str += a[n];
    }
    return str.trim();
  };

  let cleanNum = Math.floor(num);
  let words = '';

  // Process the last 3 digits
  let last3 = cleanNum % 1000;
  if (last3 > 0) {
    words = helper(last3) + ' ';
  }
  cleanNum = Math.floor(cleanNum / 1000);

  // Process pairs of digits (Thousand, Lakh, Crore)
  const steps = [100, 100, 100]; // Thousand, Lakh, Crore
  for (let i = 0; i < 3 && cleanNum > 0; i++) {
    let step = steps[i];
    let val = cleanNum % step;
    if (val > 0) {
      words = helper(val) + ' ' + g[i + 1] + ' ' + words;
    }
    cleanNum = Math.floor(cleanNum / step);
  }

  // Handle paise if present
  let paise = Math.round((num - Math.floor(num)) * 100);
  let paiseWords = '';
  if (paise > 0) {
    paiseWords = ' and ' + helper(paise) + ' Paise';
  }

  return (words.trim() + paiseWords + ' Rupees Only').replace(/\s+/g, ' ');
};

/**
 * Draws a premium, high-quality vector folding hands (namaste) icon on the PDF doc.
 */
const drawNamaste = (doc, x, y, size = 10) => {
  doc.save();
  doc.translate(x, y);
  doc.scale(size / 100);
  doc.lineWidth(5);
  doc.strokeColor('#b45309').fillColor('#fef3c7'); // Gold outline with warm light fill
  
  // Draw Joined Hands Path (Wider for natural proportion)
  doc.moveTo(50, 10)
     .quadraticCurveTo(20, 35, 25, 68)
     .quadraticCurveTo(32, 85, 47, 90)
     .lineTo(53, 90)
     .quadraticCurveTo(68, 85, 75, 68)
     .quadraticCurveTo(80, 35, 50, 10)
     .closePath()
     .fillAndStroke();
     
  // Center divide line between the two hands
  doc.moveTo(50, 10)
     .lineTo(50, 75)
     .stroke();
     
  doc.restore();
};

/**
 * Generates an elegant print-friendly PDF invoice from a bill and pipes it to the HTTP response stream.
 * @param {object} bill - Mongoose Bill document
 * @param {object|string} businessConfig - Merchant's business settings or businessName string
 * @param {object} res - Express Response object
 */
const generateInvoicePdf = (bill, businessConfig, res) => {
  let config = {};
  if (typeof businessConfig === 'string') {
    config.businessName = businessConfig;
  } else {
    config = businessConfig || {};
  }

  const paperSizeStr = config.paperSize || 'A4';
  let pdfSize, pdfMargin;
  
  if (paperSizeStr === '2 inch') {
    pdfSize = [164, 1000]; // 58mm width
    pdfMargin = 10;
  } else if (paperSizeStr === '3 inch') {
    pdfSize = [226, 1000]; // 80mm width
    pdfMargin = 15;
  } else if (paperSizeStr === 'A5') {
    pdfSize = 'A5';
    pdfMargin = 30;
  } else {
    pdfSize = 'A4';
    pdfMargin = 40; // Default grid margin is 40 points (approx 0.55 in)
  }

  const doc = new PDFDocument({ size: pdfSize, margin: pdfMargin });

  // Register Roboto fonts for native Indian Rupee symbol (₹) support
  const fontsDir = path.join(__dirname, '..', 'assets', 'fonts');
  doc.registerFont('Roboto', path.join(fontsDir, 'Roboto-Regular.ttf'));
  doc.registerFont('Roboto-Bold', path.join(fontsDir, 'Roboto-Bold.ttf'));
  doc.registerFont('Roboto-Italic', path.join(fontsDir, 'Roboto-Italic.ttf'));

  // Pipe the document directly to the response
  doc.pipe(res);

  const bName = config.businessName || 'MOHURI Invoice';
  const bAddress = config.businessAddress || '';
  const bPhone = config.businessPhone || '';
  const bGstin = config.gstin || '';
  const bFooterRaw = config.invoiceFooter || 'Thank you for your purchase! Please visit us again.';
  const bFooter = bFooterRaw.replace(/[\uD800-\uDFFF]./g, '').trim();
  const bLogo = config.logo || '';
  
  const primaryColor = config.primaryColor || '#093a84';
  const secondaryColor = config.secondaryColor || '#0066ff';
  const textColor = '#1f2937';
  const secondaryText = '#6b7280';
  
  const pageWidth = doc.page.width;
  const margin = pdfMargin;
  const contentWidth = pageWidth - (margin * 2);
  const isReceipt = paperSizeStr === '2 inch' || paperSizeStr === '3 inch';
  const isA5 = paperSizeStr === 'A5';
  
  let currentY = margin;

  if (isReceipt) {
    // ---- RECEIPT LAYOUT (2 inch & 3 inch) ----
    doc.fillColor(textColor).font('Roboto-Bold').fontSize(isReceipt && paperSizeStr === '2 inch' ? 12 : 14);
    doc.text(bName, margin, currentY, { align: 'center', width: contentWidth });
    currentY = doc.y + 2;

    doc.font('Roboto').fontSize(8).fillColor(secondaryText);
    if (bAddress) {
      doc.text(bAddress, margin, currentY, { align: 'center', width: contentWidth });
      currentY = doc.y + 2;
    }
    if (bPhone) {
      doc.text(`Phone: ${bPhone}`, margin, currentY, { align: 'center', width: contentWidth });
      currentY = doc.y + 2;
    }
    if (bGstin) {
      doc.text(`GSTIN: ${bGstin}`, margin, currentY, { align: 'center', width: contentWidth });
      currentY = doc.y + 2;
    }
    
    // Divider
    currentY += 5;
    doc.strokeColor('#e5e7eb').lineWidth(1).moveTo(margin, currentY).lineTo(pageWidth - margin, currentY).stroke();
    currentY += 5;
    
    // Invoice details
    doc.font('Roboto').fontSize(8).fillColor(textColor);
    const invoiceId = bill._id.toString().toUpperCase().slice(-6);
    doc.text(`INV: ${invoiceId}`, margin, currentY);
    doc.text(`Date: ${new Date(bill.createdAt).toLocaleDateString()}`, margin, currentY, { align: 'right', width: contentWidth });
    currentY = doc.y + 2;
    
    doc.text(`Customer: ${bill.customerName}`, margin, currentY);
    currentY = doc.y + 5;
    
    // Items header
    doc.strokeColor('#e5e7eb').lineWidth(1).moveTo(margin, currentY).lineTo(pageWidth - margin, currentY).stroke();
    currentY += 3;
    doc.font('Roboto-Bold').fontSize(8);
    const itemWidth = contentWidth * 0.5;
    const qtyWidth = contentWidth * 0.15;
    const amtWidth = contentWidth * 0.35;
    
    doc.text('Item', margin, currentY, { width: itemWidth });
    doc.text('Qty', margin + itemWidth, currentY, { width: qtyWidth, align: 'right' });
    doc.text('Amount', margin + itemWidth + qtyWidth, currentY, { width: amtWidth, align: 'right' });
    currentY = doc.y + 3;
    doc.strokeColor('#e5e7eb').lineWidth(1).moveTo(margin, currentY).lineTo(pageWidth - margin, currentY).stroke();
    currentY += 3;
    
    // Items
    doc.font('Roboto').fontSize(8);
    bill.items.forEach(item => {
      const qty = Number(item.quantity);
      const price = Number(item.price);
      const gst = Number(item.gst);
      const baseVal = price * qty;
      const gstVal = (baseVal * gst) / 100;
      const totalItem = baseVal + gstVal;
      
      const startY = currentY;
      doc.text(item.productName, margin, currentY, { width: itemWidth });
      const nextY = doc.y; // To handle multiline item names
      doc.text(`${qty}`, margin + itemWidth, startY, { width: qtyWidth, align: 'right' });
      doc.text(`Rs ${totalItem.toFixed(2)}`, margin + itemWidth + qtyWidth, startY, { width: amtWidth, align: 'right' });
      
      currentY = nextY + 2;
    });
    
    currentY += 2;
    doc.strokeColor('#e5e7eb').lineWidth(1).moveTo(margin, currentY).lineTo(pageWidth - margin, currentY).stroke();
    currentY += 5;
    
    // Totals
    doc.font('Roboto-Bold').fontSize(9);
    doc.text(`Total: Rs ${Number(bill.total).toFixed(2)}`, margin, currentY, { align: 'right', width: contentWidth });
    currentY = doc.y + 2;
    
    if (bill.paymentType === 'Credit') {
      doc.fontSize(8).fillColor('#10b981').text(`Paid: Rs ${Number(bill.paidAmount || 0).toFixed(2)}`, margin, currentY, { align: 'right', width: contentWidth });
      currentY = doc.y + 2;
      doc.fillColor('#d97706').text(`Due: Rs ${Number(bill.remainingAmount || 0).toFixed(2)}`, margin, currentY, { align: 'right', width: contentWidth });
      currentY = doc.y + 2;
    }
    
    // QR Code
    if (config.qrCodeBuffer) {
      currentY += 5;
      const qrSize = paperSizeStr === '2 inch' ? 60 : 80;
      doc.image(config.qrCodeBuffer, (pageWidth - qrSize) / 2, currentY, { fit: [qrSize, qrSize] });
      currentY += qrSize + 5;
      doc.fillColor(textColor).fontSize(7).text('Scan to Pay', margin, currentY, { align: 'center', width: contentWidth });
      currentY = doc.y + 2;
    }
    
    // Footer
    currentY += 10;
    doc.fillColor(secondaryText).font('Roboto-Italic').fontSize(7).text(bFooter, margin, currentY, { align: 'center', width: contentWidth });
    
  } else {
    // ---- PROFESSIONAL INDIAN TAX INVOICE LAYOUT (A4 & A5) ----
    
    // Extracted PAN from GSTIN if not manually entered
    const panNum = config.panNumber || (bGstin.length === 15 ? bGstin.slice(2, 12).toUpperCase() : '');

    // Common styling configs
    doc.strokeColor('#000000').lineWidth(0.5);

    // 1. Merchant Header Info (Left) and TAX INVOICE detail box (Right)
    const headerBoxHeight = isA5 ? 90 : 120;
    const rightColX = isA5 ? 270 : 340;
    const rightColWidth = pageWidth - margin - rightColX;

    // Draw top border box
    doc.rect(margin, currentY, contentWidth, headerBoxHeight).stroke();
    
    // Draw column splitter inside top box
    doc.moveTo(rightColX, currentY).lineTo(rightColX, currentY + headerBoxHeight).stroke();

    // Render Company/Merchant Details (Left Column)
    let leftX = margin + 10;
    let textY = currentY + 10;

    // Draw logo if it exists
    if (bLogo) {
      try {
        const base64Data = bLogo.replace(/^data:image\/\w+;base64,/, "");
        const logoBuffer = Buffer.from(base64Data, 'base64');
        const logoSize = isA5 ? 32 : 45;
        doc.image(logoBuffer, leftX, textY, { fit: [logoSize, logoSize] });
        leftX += logoSize + 10;
      } catch (imgError) {
        console.error('Error drawing logo on PDF:', imgError);
      }
    }

    doc.fillColor(textColor).font('Roboto-Bold').fontSize(isA5 ? 11 : 14).text(bName, leftX, textY);
    textY = doc.y + 2;
    
    doc.font('Roboto').fontSize(isA5 ? 7 : 8).fillColor(textColor);
    if (bAddress) {
      doc.text(bAddress, leftX, textY, { width: rightColX - leftX - 10 });
      textY = doc.y + 2;
    }
    
    if (bPhone) {
      doc.text(`Mobile : ${bPhone}`, leftX, textY);
      textY = doc.y + 2;
    }
    if (config.businessEmail) {
      doc.text(`Email : ${config.businessEmail}`, leftX, textY);
      textY = doc.y + 2;
    }

    if (bGstin) {
      doc.text(`GSTIN : ${bGstin}`, leftX, textY);
      textY = doc.y + 2;
    }
    if (panNum) {
      doc.text(`PAN Number : ${panNum}`, leftX, textY);
      textY = doc.y + 2;
    }

    // Render Invoice Info (Right Column)
    let rightX = rightColX + 10;
    let rightY = currentY + 10;

    doc.fillColor(textColor).font('Roboto-Bold').fontSize(isA5 ? 12 : 14).text('TAX INVOICE', rightX, rightY);
    rightY = doc.y + 4;

    // ORIGINAL FOR RECIPIENT tag
    const badgeW = isA5 ? 100 : 130;
    const badgeH = isA5 ? 12 : 14;
    doc.rect(rightX, rightY, badgeW, badgeH).fillColor('#f3f4f6').fillAndStroke('#f3f4f6', '#cccccc');
    doc.fillColor(textColor).font('Roboto-Bold').fontSize(isA5 ? 6 : 7).text('ORIGINAL FOR RECIPIENT', rightX, rightY + (isA5 ? 2.5 : 3.5), { align: 'center', width: badgeW });
    rightY += badgeH + 6;

    // Invoice details table inside right header box
    doc.font('Roboto').fontSize(isA5 ? 7 : 8.5).fillColor(textColor);
    const detailsRow = (label, val) => {
      doc.font('Roboto').text(label, rightX, rightY);
      doc.font('Roboto-Bold').text(val, rightX + (isA5 ? 55 : 75), rightY, { width: rightColWidth - (isA5 ? 70 : 95), align: 'right' });
      rightY = doc.y + 2.5;
    };

    const invoiceNo = `INV-${bill._id.toString().toUpperCase().slice(-6)}`;
    detailsRow('Invoice No.', invoiceNo);
    detailsRow('Invoice Date', new Date(bill.createdAt).toLocaleDateString('en-IN', { dateStyle: 'medium' }));
    
    if (bill.paymentType === 'Credit' && bill.dueDate) {
      detailsRow('Due Date', new Date(bill.dueDate).toLocaleDateString('en-IN', { dateStyle: 'medium' }));
    }

    currentY += headerBoxHeight;

    // 2. BILL TO & SHIP TO Box
    const clientBoxHeight = isA5 ? 45 : 60;
    doc.rect(margin, currentY, contentWidth, clientBoxHeight).stroke();
    
    // Header divider line (horizontal)
    const clientHeaderH = isA5 ? 13 : 16;
    doc.rect(margin, currentY, contentWidth, clientHeaderH).fillColor('#f3f4f6').fillAndStroke('#f3f4f6', '#cccccc');
    
    doc.fillColor(textColor).font('Roboto-Bold').fontSize(isA5 ? 7 : 8);
    doc.text('BILL TO', margin + 10, currentY + (isA5 ? 3 : 4));
    doc.text('SHIP TO', (pageWidth / 2) + 5, currentY + (isA5 ? 3 : 4));

    // Vertical splitter for client boxes
    doc.moveTo(pageWidth / 2, currentY).lineTo(pageWidth / 2, currentY + clientBoxHeight).stroke();

    // Client Details Content
    let clientY = currentY + clientHeaderH + 4;
    doc.fillColor(textColor).fontSize(isA5 ? 7.5 : 9.5);
    
    // BILL TO
    doc.font('Roboto-Bold').text(bill.customerName, margin + 10, clientY);
    if (bill.customerPhone && bill.customerPhone !== '+91') {
      doc.font('Roboto').fontSize(isA5 ? 6.5 : 8).text(`Mob: ${bill.customerPhone}`, margin + 10, doc.y + 1);
    }
    if (bill.customerAddress) {
      doc.font('Roboto').fontSize(isA5 ? 6.5 : 8).text(`Place of Supply: ${bill.customerAddress}`, margin + 10, doc.y + 1);
    }

    // SHIP TO
    doc.font('Roboto-Bold').fontSize(isA5 ? 7.5 : 9.5).text(bill.customerName, (pageWidth / 2) + 10, clientY);
    if (bill.customerPhone && bill.customerPhone !== '+91') {
      doc.font('Roboto').fontSize(isA5 ? 6.5 : 8).text(`Mob: ${bill.customerPhone}`, (pageWidth / 2) + 10, doc.y + 1);
    }
    if (bill.customerAddress) {
      doc.font('Roboto').fontSize(isA5 ? 6.5 : 8).text(`Delivery Address: ${bill.customerAddress}`, (pageWidth / 2) + 10, doc.y + 1, { width: (contentWidth / 2) - 15 });
    }

    currentY += clientBoxHeight;

    // 3. Items Table Header
    const tableHeaderH = isA5 ? 16 : 20;
    doc.rect(margin, currentY, contentWidth, tableHeaderH).fillColor('#f3f4f6');
    
    // Column coordinates definitions
    const colX = {
      sno: margin,
      items: margin + (isA5 ? 25 : 30),
      hsn: margin + contentWidth - (isA5 ? 200 : 255),
      qty: margin + contentWidth - (isA5 ? 150 : 190),
      rate: margin + contentWidth - (isA5 ? 110 : 140),
      tax: margin + contentWidth - (isA5 ? 60 : 75),
      amount: margin + contentWidth - (isA5 ? 35 : 45),
    };

    doc.fillColor(textColor).font('Roboto-Bold').fontSize(isA5 ? 7 : 8);
    
    doc.text('S.NO.', colX.sno + 5, currentY + (isA5 ? 4 : 5.5));
    doc.text('ITEMS', colX.items + 5, currentY + (isA5 ? 4 : 5.5));
    doc.text('HSN', colX.hsn, currentY + (isA5 ? 4 : 5.5), { width: colX.qty - colX.hsn, align: 'center' });
    doc.text('QTY.', colX.qty, currentY + (isA5 ? 4 : 5.5), { width: colX.rate - colX.qty, align: 'center' });
    doc.text('RATE', colX.rate, currentY + (isA5 ? 4 : 5.5), { width: colX.tax - colX.rate, align: 'center' });
    doc.text('TAX', colX.tax, currentY + (isA5 ? 4 : 5.5), { width: colX.amount - colX.tax, align: 'center' });
    doc.text('AMOUNT', colX.amount, currentY + (isA5 ? 4 : 5.5), { width: (pageWidth - margin) - colX.amount - 5, align: 'right' });

    currentY += tableHeaderH;
    const tableBodyStartY = currentY;

    // Render Table Rows
    doc.font('Roboto').fontSize(isA5 ? 7 : 8.5).fillColor(textColor);
    
    let totalQty = 0;
    let totalTaxVal = 0;
    let totalTaxableVal = 0;

    bill.items.forEach((item, index) => {
      const qty = Number(item.quantity);
      const price = Number(item.price); // Exclusive base price
      const gst = Number(item.gst || 0);
      
      const baseVal = price * qty;
      const gstVal = (baseVal * gst) / 100;
      const totalItem = baseVal + gstVal;

      totalQty += qty;
      totalTaxVal += gstVal;
      totalTaxableVal += baseVal;

      const rowHeight = isA5 ? 18 : 24;
      const itemTextY = currentY + (isA5 ? 4.5 : 6.5);

      // Draw light zebra rows
      if (index % 2 === 1) {
        doc.rect(margin, currentY, contentWidth, rowHeight).fill('#f9fafb');
        doc.fillColor(textColor);
      }

      // Draw Sno
      doc.text(`${index + 1}`, colX.sno + 5, itemTextY);
      
      // Draw item name & optional barcode/desc
      doc.text(item.productName, colX.items + 5, itemTextY, { width: colX.hsn - colX.items - 10, lineBreak: false });
      
      // Draw HSN
      doc.text(item.hsn || '84733030', colX.hsn, itemTextY, { width: colX.qty - colX.hsn, align: 'center' });
      
      // Draw QTY
      const unit = item.unit === 'kg' ? ' KG' : ' PCS';
      doc.text(`${qty}${unit}`, colX.qty, itemTextY, { width: colX.rate - colX.qty, align: 'center' });
      
      // Draw RATE (base exclusive)
      doc.text(`₹${price.toFixed(2)}`, colX.rate, itemTextY, { width: colX.tax - colX.rate, align: 'center' });
      
      // Draw TAX rate & amount
      doc.text(`₹${gstVal.toFixed(2)}\n(${gst}%)`, colX.tax, itemTextY - (isA5 ? 1 : 2.5), { width: colX.amount - colX.tax, align: 'center' });
      
      // Draw AMOUNT
      doc.text(`₹${totalItem.toFixed(2)}`, colX.amount, itemTextY, { width: (pageWidth - margin) - colX.amount - 5, align: 'right' });

      currentY += rowHeight;
    });

    const tableBottomY = currentY;

    // 4. SUBTOTAL ROW
    const subtotalH = isA5 ? 16 : 20;
    doc.rect(margin, tableBottomY, contentWidth, subtotalH).fillColor('#f3f4f6');
    doc.fillColor(textColor).font('Roboto-Bold').fontSize(isA5 ? 7 : 8);

    doc.text('SUBTOTAL', colX.items + 5, tableBottomY + (isA5 ? 4 : 5.5));
    doc.text(`${totalQty} PCS`, colX.qty, tableBottomY + (isA5 ? 4 : 5.5), { width: colX.rate - colX.qty, align: 'center' });
    doc.text(`₹${totalTaxVal.toFixed(2)}`, colX.tax, tableBottomY + (isA5 ? 4 : 5.5), { width: colX.amount - colX.tax, align: 'center' });
    doc.text(`₹${Number(bill.total).toFixed(2)}`, colX.amount, tableBottomY + (isA5 ? 4 : 5.5), { width: (pageWidth - margin) - colX.amount - 5, align: 'right' });

    currentY = tableBottomY + subtotalH;

    // --- DRAW CRITICAL GRID LINES FOR THE TABLE GRID ---
    // This draws one outer clean rectangle around the whole table (header + body + subtotal)
    doc.strokeColor('#000000').lineWidth(0.5);
    doc.rect(margin, tableBodyStartY - tableHeaderH, contentWidth, currentY - (tableBodyStartY - tableHeaderH)).stroke();

    // Draw horizontal dividers
    doc.moveTo(margin, tableBodyStartY).lineTo(pageWidth - margin, tableBodyStartY).stroke(); // Header/Body line
    doc.moveTo(margin, tableBottomY).lineTo(pageWidth - margin, tableBottomY).stroke(); // Body/Subtotal line
    
    // Draw intermediate row lines
    let tempY = tableBodyStartY;
    bill.items.forEach(() => {
      const rowHeight = isA5 ? 18 : 24;
      tempY += rowHeight;
      if (tempY < tableBottomY) {
        doc.moveTo(margin, tempY).lineTo(pageWidth - margin, tempY).stroke();
      }
    });

    // Draw vertical column splitters cutting through header, body, and subtotal
    const columnsToDraw = [colX.items, colX.hsn, colX.qty, colX.rate, colX.tax, colX.amount];
    columnsToDraw.forEach(x => {
      doc.moveTo(x, tableBodyStartY - tableHeaderH).lineTo(x, currentY).stroke();
    });

    // 5. SPLIT FOOTER (Bank Details + QR on Left | Tax Calculations & Totals on Right)
    const footerH = isA5 ? 115 : 155;
    doc.rect(margin, currentY, contentWidth, footerH).stroke();

    // Draw vertical divider down center
    const splitX = pageWidth / 2;
    doc.moveTo(splitX, currentY).lineTo(splitX, currentY + footerH).stroke();

    // LEFT COLUMN (Bank Details & QR Payment)
    let leftFooterY = currentY + 8;
    const leftFooterPaddingX = margin + 10;
    
    // Render Bank Details if defined
    const bankDetailsName = config.bankAccountName || config.businessName || bName;
    const bankIFSC = config.bankIfsc || '';
    const bankAcc = config.bankAccountNo || '';
    const bankTitle = config.bankName || '';

    if (bankAcc || bankIFSC) {
      doc.fillColor(textColor).font('Roboto-Bold').fontSize(isA5 ? 7 : 8.5).text('BANK DETAILS', leftFooterPaddingX, leftFooterY);
      leftFooterY = doc.y + 3;
      
      doc.font('Roboto').fontSize(isA5 ? 6 : 7.5);
      const rowItem = (label, val) => {
        doc.font('Roboto-Bold').text(label, leftFooterPaddingX, leftFooterY, { width: 50, lineBreak: false });
        doc.font('Roboto').text(val, leftFooterPaddingX + (isA5 ? 40 : 50), leftFooterY);
        leftFooterY = doc.y + 1.5;
      };

      rowItem('Name:', bankDetailsName);
      if (bankIFSC) rowItem('IFSC Code:', bankIFSC);
      if (bankAcc) rowItem('Account No:', bankAcc);
      if (bankTitle) rowItem('Bank:', bankTitle);
    }

    // Render Payment QR Code (shifted higher to prevent overlapping logo rows)
    let qrTopY = currentY + (isA5 ? 40 : 12);
    if (config.upiId) {
      doc.fillColor(textColor).font('Roboto-Bold').fontSize(isA5 ? 7 : 8.5).text('PAYMENT QR CODE', leftFooterPaddingX, qrTopY);
      doc.font('Roboto').fontSize(isA5 ? 6 : 7).text(`UPI ID: ${config.upiId}`, leftFooterPaddingX, doc.y + 2);

      if (config.qrCodeBuffer) {
        try {
          const qrSize = isA5 ? 50 : 72;
          doc.image(config.qrCodeBuffer, splitX - qrSize - 12, qrTopY, { fit: [qrSize, qrSize] });

          // Draw official central UPI logo overlay in the center of the QR code
          const qrCenterX = (splitX - 12) - (qrSize / 2);
          const qrCenterY = qrTopY + (qrSize / 2);
          const patchSize = isA5 ? 10 : 14;
          
          doc.roundedRect(qrCenterX - (patchSize / 2), qrCenterY - (patchSize / 2), patchSize, patchSize, 1).fill('#ffffff');
          
          // Render logo text and lines inside the patch
          const textOffset = isA5 ? 4 : 5.5;
          doc.fillColor('#0f3f7a').font('Roboto-Bold').fontSize(isA5 ? 3.5 : 4.5).text('UPI', qrCenterX - textOffset, qrCenterY - (isA5 ? 1.5 : 2));
          
          const strokeW = isA5 ? 0.6 : 0.8;
          doc.lineWidth(strokeW);
          doc.strokeColor('#0f3f7a').moveTo(qrCenterX + (isA5 ? 1.5 : 2.5), qrCenterY + (isA5 ? 2 : 2.5)).lineTo(qrCenterX + (isA5 ? 2.5 : 4), qrCenterY - (isA5 ? 2 : 2.5)).stroke();
          doc.strokeColor('#2e8b57').moveTo(qrCenterX + (isA5 ? 3 : 4.5), qrCenterY + (isA5 ? 2 : 2.5)).lineTo(qrCenterX + (isA5 ? 4 : 6), qrCenterY - (isA5 ? 2 : 2.5)).stroke();
          
          // Render UPI Apps Logo Row under the QR Code
          const rowY = qrTopY + qrSize + 4;
          const startLogoX = qrCenterX - 37.5; // Width of row is approx 75px

          // 1. PhonePe Logo (Real Image with Vector Fallback)
          try {
            const phonepePath = path.join(__dirname, '..', 'assets', 'images', 'phonepe.png');
            doc.image(phonepePath, startLogoX, rowY, { height: 11 });
          } catch (e) {
            doc.roundedRect(startLogoX, rowY, 11, 11, 2).fill('#5f259f');
            doc.fillColor('#ffffff').font('Roboto-Bold').fontSize(5.5).text('Pe', startLogoX + 1.5, rowY + 2.5);
          }

          // 2. GPay Logo (Real Image with Vector Fallback)
          try {
            const gpayPath = path.join(__dirname, '..', 'assets', 'images', 'gpay.png');
            doc.image(gpayPath, startLogoX + 20, rowY - 1.5, { height: 14 });
          } catch (e) {
            doc.roundedRect(startLogoX + 20, rowY, 20, 11, 2).fillColor('#ffffff').strokeColor('#d1d5db').lineWidth(0.5).stroke();
            doc.fillColor('#4285f4').font('Roboto-Bold').fontSize(5.5).text('G', startLogoX + 22, rowY + 2.5);
            doc.fillColor('#5e6368').font('Roboto-Bold').fontSize(5.5).text('Pay', startLogoX + 27, rowY + 2.5);
          }

          // 3. Paytm Logo (shifted right)
          doc.fillColor('#002e6e').font('Roboto-Bold').fontSize(5.5).text('pay', startLogoX + 41, rowY + 2.5);
          doc.fillColor('#00baf2').font('Roboto-Bold').fontSize(5.5).text('tm', startLogoX + 50, rowY + 2.5);

          // 4. UPI Logo (shifted right)
          doc.fillColor('#0f3f7a').font('Roboto-Bold').fontSize(6).text('UPI', startLogoX + 61, rowY + 2);
          doc.lineWidth(1).strokeColor('#0f3f7a').moveTo(startLogoX + 73, rowY + 8).lineTo(startLogoX + 75, rowY + 4).stroke();
          doc.lineWidth(1).strokeColor('#2e8b57').moveTo(startLogoX + 75, rowY + 8).lineTo(startLogoX + 77, rowY + 4).stroke();

        } catch (qrErr) {
          console.error('Failed to draw QR buffer on PDF invoice:', qrErr);
        }
      }
    }

    // RIGHT COLUMN (GST calculation, received totals and words representation with perfect vertical steps)
    let rightFooterY = currentY + 12;
    const rightFooterPaddingX = splitX + 10;
    const valColWidth = (pageWidth - margin) - rightFooterPaddingX;

    const totalsRow = (label, val, isBold = false) => {
      doc.fillColor(textColor).font(isBold ? 'Roboto-Bold' : 'Roboto').fontSize(isA5 ? 7 : 8.5);
      doc.text(label, rightFooterPaddingX, rightFooterY);
      doc.text(`₹${val}`, rightFooterPaddingX, rightFooterY, { width: valColWidth - 10, align: 'right' });
      rightFooterY += isA5 ? 12 : 16;
    };

    // Calculate split tax variables
    const taxableAmt = totalTaxableVal;
    const cgstVal = totalTaxVal / 2;
    const sgstVal = totalTaxVal / 2;

    totalsRow('Taxable Amount', taxableAmt.toFixed(2));
    totalsRow('CGST', cgstVal.toFixed(2));
    totalsRow('SGST', sgstVal.toFixed(2));
    totalsRow('Total Amount', Number(bill.total).toFixed(2), true);
    totalsRow('Received Amount', Number(bill.paidAmount || 0).toFixed(2));
    
    // Remaining Balance
    const remainingAmt = bill.remainingAmount || 0;
    totalsRow('Current Balance', remainingAmt.toFixed(2), remainingAmt > 0.01);

    // Total Amount In Words
    doc.strokeColor('#cccccc').lineWidth(0.25).moveTo(splitX, currentY + (isA5 ? 88 : 114)).lineTo(pageWidth - margin, currentY + (isA5 ? 88 : 114)).stroke();

    doc.fillColor(textColor).font('Roboto-Bold').fontSize(isA5 ? 6.5 : 7.5).text('Total Amount (in words)', rightFooterPaddingX, currentY + (isA5 ? 92 : 118));
    
    const wordsText = numberToIndianWords(bill.total);
    doc.font('Roboto-Italic').fontSize(isA5 ? 6 : 7).fillColor(secondaryText).text(wordsText, rightFooterPaddingX, currentY + (isA5 ? 100 : 128), { width: valColWidth - 10 });

    currentY += footerH;

    // 6. BOTTOM FOOTER & AUTHORISED SIGNATURE
    const bottomSpace = isA5 ? 15 : 25;
    currentY += bottomSpace;

    if (bFooter) {
      doc.fillColor(secondaryText).font('Roboto-Italic').fontSize(isA5 ? 6.5 : 8);
      doc.text(bFooter, margin + 10, currentY, { width: contentWidth - 245, align: 'left' });
    }

    doc.fillColor(textColor).font('Roboto').fontSize(isA5 ? 7.5 : 9);
    doc.text(`Authorised Signature for ${bName}`, pageWidth - margin - 230, currentY + 10, { width: 220, align: 'right' });

    // 7. GLOBAL INNER BORDER BOX
    doc.strokeColor('#000000').lineWidth(0.75).rect(margin, margin, contentWidth, doc.page.height - (margin * 2)).stroke();
  }

  doc.end();
};

module.exports = { generateInvoicePdf };
