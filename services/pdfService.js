const PDFDocument = require('pdfkit');
const path = require('path');

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
    pdfMargin = 50;
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
  const bFooter = config.invoiceFooter || 'Thank you for your purchase! 🙏';
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
    // ---- STANDARD INVOICE LAYOUT (A4 & A5) ----
    const fsHeader = isA5 ? 14 : 18;
    const fsLabel = isA5 ? 7 : 8;
    const fsNormal = isA5 ? 8 : 10;
    const fsLarge = isA5 ? 12 : 14;

    let startX = margin;
    let headerY = currentY;

    if (bLogo) {
      try {
        const base64Data = bLogo.replace(/^data:image\/\w+;base64,/, "");
        const logoBuffer = Buffer.from(base64Data, 'base64');
        const logoSize = isA5 ? 40 : 50;
        doc.image(logoBuffer, startX, headerY, { fit: [logoSize, logoSize] });
        startX += logoSize + 15;
      } catch (imgError) {
        console.error('Error drawing merchant logo on PDF:', imgError);
      }
    }

    doc.fillColor(primaryColor).fontSize(fsHeader).font('Roboto-Bold').text(bName, startX, headerY);
    currentY = doc.y + 5;

    doc.fillColor(secondaryText).fontSize(fsLabel).font('Roboto');
    if (bAddress) {
      doc.text(bAddress, startX, currentY, { width: contentWidth / 2 });
      currentY = doc.y + 2;
    }
    if (bPhone) {
      doc.text(`Phone: ${bPhone}`, startX, currentY);
      currentY = doc.y + 2;
    }
    if (bGstin) {
      doc.text(`GSTIN: ${bGstin}`, startX, currentY);
      currentY = doc.y + 2;
    }

    // Invoice Details (Right-aligned)
    const invoiceId = bill._id.toString().toUpperCase();
    doc.fillColor(textColor).fontSize(fsNormal).font('Roboto-Bold').text('INVOICE DETAIL', margin, headerY, { align: 'right', width: contentWidth });
    let invY = doc.y + 3;
    doc.font('Roboto').fillColor(secondaryText).fontSize(fsLabel);
    doc.text(`Invoice ID: ${invoiceId}`, margin, invY, { align: 'right', width: contentWidth });
    invY = doc.y + 2;
    doc.text(`Date: ${new Date(bill.createdAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}`, margin, invY, { align: 'right', width: contentWidth });

    // Divider Line
    const dividerY = Math.max(currentY, invY) + 15;
    doc.strokeColor('#e5e7eb').lineWidth(1).moveTo(margin, dividerY).lineTo(pageWidth - margin, dividerY).stroke();
 
    // Billing Info Section
    const billingInfoY = dividerY + 15;
    doc.fillColor(textColor).fontSize(fsNormal).font('Roboto-Bold').text('BILL TO:', margin, billingInfoY);
    currentY = doc.y + 3;
 
    doc.font('Roboto').fontSize(fsNormal).fillColor(textColor);
    doc.text(`Customer Name: ${bill.customerName}`, margin, currentY);
    currentY = doc.y + 3;
    doc.text(`Contact Phone: ${bill.customerPhone || 'N/A'}`, margin, currentY);
    currentY = doc.y + 3;
 
    if (bill.customerAddress) {
      doc.text(`Customer Address: ${bill.customerAddress}`, margin, currentY, { width: contentWidth / 2 });
      currentY = doc.y + 3;
    }

    // Items Table Section
    const tableTop = currentY + 20;
    
    const col1 = margin; // Item (approx 35%)
    const col2 = margin + contentWidth * 0.40; // Qty (15%)
    const col3 = margin + contentWidth * 0.55; // Unit Price (15%)
    const col4 = margin + contentWidth * 0.70; // GST (15%)
    const col5 = margin + contentWidth * 0.85; // Amount (15%)
    
    const w1 = contentWidth * 0.38;
    const w2 = contentWidth * 0.13;
    const w3 = contentWidth * 0.13;
    const w4 = contentWidth * 0.13;
    const w5 = contentWidth * 0.15;

    // Table Headers
    doc.fillColor(primaryColor).font('Roboto-Bold').fontSize(fsNormal - 1);
   
    doc.text('Item Description', col1, tableTop);
    doc.text('Qty', col2, tableTop, { width: w2, align: 'right' });
    doc.text('Unit Price', col3, tableTop, { width: w3, align: 'right' });
    doc.text('GST (%)', col4, tableTop, { width: w4, align: 'right' });
    doc.text('Amount (₹)', col5, tableTop, { width: w5, align: 'right' });
   
    doc.strokeColor(primaryColor).lineWidth(1.5).moveTo(margin, tableTop + 15).lineTo(pageWidth - margin, tableTop + 15).stroke();

    // Table Body Rows
    let y = tableTop + 25;
    doc.font('Roboto').fontSize(fsNormal - 1).fillColor(textColor);

    bill.items.forEach((item) => {
      const qty = Number(item.quantity);
      const price = Number(item.price);
      const gst = Number(item.gst);
      const baseVal = price * qty;
      const gstVal = (baseVal * gst) / 100;
      const totalItem = baseVal + gstVal;

      doc.rect(margin, y - 4, contentWidth, 18).fill('#f9fafb');
      doc.fillColor(textColor);

      const unitSuffix = item.unit === 'kg' ? ' kg' : ' pcs';
      const qtyText = `${qty}${unitSuffix}`;

      doc.text(item.productName, col1 + 5, y, { width: w1 - 5, lineBreak: false });
      doc.text(qtyText, col2, y, { width: w2, align: 'right' });
      doc.text(`₹${price.toFixed(2)}`, col3, y, { width: w3, align: 'right' });
      doc.text(`${gst}%`, col4, y, { width: w4, align: 'right' });
      doc.text(`₹${totalItem.toFixed(2)}`, col5, y, { width: w5, align: 'right' });

      y += 20;
    });

    doc.strokeColor('#cccccc').lineWidth(1).moveTo(margin, y).lineTo(pageWidth - margin, y).stroke();

    // Totals Block
    let totalsTop = y + 15;
    
    if (config.qrCodeBuffer) {
      try {
        const qrSize = isA5 ? 60 : 80;
        doc.image(config.qrCodeBuffer, margin, totalsTop, { fit: [qrSize, qrSize] });
        doc.fillColor(textColor).font('Roboto-Bold').fontSize(fsLabel).text('Scan to Pay via UPI', margin, totalsTop + qrSize + 5);
        if (config.upiId) {
          doc.fillColor(secondaryText).font('Roboto').fontSize(fsLabel - 1).text(config.upiId, margin, totalsTop + qrSize + 15, { width: 150 });
        }
      } catch (qrDrawError) {
        console.error('Error drawing QR Code on PDF:', qrDrawError);
      }
    }
    
    if (bill.paymentType === 'Credit') {
      doc.fillColor(textColor).font('Roboto-Bold').fontSize(fsNormal).text(`Total Bill Amount: ₹${Number(bill.total).toFixed(2)}`, margin, totalsTop, { align: 'right', width: contentWidth });
      totalsTop += 15;
      
      doc.fillColor('#10b981').font('Roboto-Bold').fontSize(fsNormal).text(`Amount Paid: ₹${Number(bill.paidAmount || 0).toFixed(2)}`, margin, totalsTop, { align: 'right', width: contentWidth });
      totalsTop += 15;
      
      doc.fillColor('#d97706').font('Roboto-Bold').fontSize(fsLarge).text(`Remaining Balance (Udhaar): ₹${Number(bill.remainingAmount || 0).toFixed(2)}`, margin, totalsTop, { align: 'right', width: contentWidth });

      if (bill.dueDate) {
        totalsTop += 18;
        doc.fillColor(secondaryText).font('Roboto-Italic').fontSize(fsNormal - 1).text(`Payment Due Date: ${new Date(bill.dueDate).toLocaleDateString()}`, margin, totalsTop, { align: 'right', width: contentWidth });
      }
    } else {
      doc.fillColor(primaryColor).font('Roboto-Bold').fontSize(fsLarge).text(`Grand Total (Paid): ₹${Number(bill.total).toFixed(2)}`, margin, totalsTop, { align: 'right', width: contentWidth });
    }

    let footerY = totalsTop + 60;
    if (bill.paymentType === 'Credit') footerY = totalsTop + (bill.dueDate ? 80 : 65);
    if (config.qrCodeBuffer) footerY = Math.max(footerY, totalsTop + 115);

    doc.fillColor(secondaryText).font('Roboto-Italic').fontSize(fsNormal - 1).text(bFooter, margin, footerY, { align: 'center', width: contentWidth });
  }

  doc.end();
};

module.exports = { generateInvoicePdf };
