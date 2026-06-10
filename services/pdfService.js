const PDFDocument = require('pdfkit');
const path = require('path');

/**
 * Generates an elegant print-friendly PDF invoice from a bill and pipes it to the HTTP response stream.
 * @param {object} bill - Mongoose Bill document
 * @param {object|string} businessConfig - Merchant's business settings or businessName string
 * @param {object} res - Express Response object
 */
const generateInvoicePdf = (bill, businessConfig, res) => {
  const doc = new PDFDocument({ margin: 50 });

  // Register Roboto fonts for native Indian Rupee symbol (₹) support
  const fontsDir = path.join(__dirname, '..', 'assets', 'fonts');
  doc.registerFont('Roboto', path.join(fontsDir, 'Roboto-Regular.ttf'));
  doc.registerFont('Roboto-Bold', path.join(fontsDir, 'Roboto-Bold.ttf'));
  doc.registerFont('Roboto-Italic', path.join(fontsDir, 'Roboto-Italic.ttf'));

  // Pipe the document directly to the response
  doc.pipe(res);

  // Parse configuration
  let config = {};
  if (typeof businessConfig === 'string') {
    config.businessName = businessConfig;
  } else {
    config = businessConfig || {};
  }

  const bName = config.businessName || 'MOHURI Invoice';
  const bAddress = config.businessAddress || '';
  const bPhone = config.businessPhone || '';
  const bGstin = config.gstin || '';
  const bFooter = config.invoiceFooter || 'Thank you for your purchase! Please visit us again. 🙏';
  const bLogo = config.logo || '';

  // Styling palette
  const primaryColor = '#093a84'; // Premium MOHURI navy blue
  const secondaryColor = '#0066ff'; // Sky blue accent
  const textColor = '#1f2937'; // Slate dark gray
  const secondaryText = '#6b7280'; // Cool gray
  
  // 1. Header Section (Left Side - Business Details)
  let startX = 50;

  if (bLogo) {
    try {
      const base64Data = bLogo.replace(/^data:image\/\w+;base64,/, "");
      const logoBuffer = Buffer.from(base64Data, 'base64');
      doc.image(logoBuffer, 50, 40, { fit: [50, 50] });
      startX = 115;
    } catch (imgError) {
      console.error('Error drawing merchant logo on PDF:', imgError);
    }
  }

  doc
    .fillColor(primaryColor)
    .fontSize(18)
    .font('Roboto-Bold')
    .text(bName, startX, 45);

  let currentY = 65;

  if (bAddress) {
    doc
      .fillColor(secondaryText)
      .fontSize(8)
      .font('Roboto')
      .text(bAddress, startX, currentY, { width: 250 });
    // Approx height adjustment for address line wrap
    currentY += bAddress.length > 40 ? 22 : 12;
  }

  if (bPhone) {
    doc
      .fillColor(secondaryText)
      .fontSize(8)
      .font('Roboto')
      .text(`Phone: ${bPhone}`, startX, currentY);
    currentY += 12;
  }

  if (bGstin) {
    doc
      .fillColor(secondaryText)
      .fontSize(8)
      .font('Roboto')
      .text(`GSTIN: ${bGstin}`, startX, currentY);
    currentY += 12;
  }

  // Invoice Details (Right-aligned)
  const invoiceId = bill._id.toString().toUpperCase();
  doc
    .fillColor(textColor)
    .fontSize(9)
    .font('Roboto-Bold')
    .text('INVOICE DETAIL', 400, 45, { align: 'right' })
    .font('Roboto')
    .fillColor(secondaryText)
    .text(`Invoice ID: ${invoiceId}`, 400, 60, { align: 'right' })
    .text(`Date: ${new Date(bill.createdAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}`, 400, 72, { align: 'right' });

  // Divider Line
  const dividerY = Math.max(105, currentY + 10);
  doc
    .strokeColor('#e5e7eb')
    .lineWidth(1)
    .moveTo(50, dividerY)
    .lineTo(550, dividerY)
    .stroke();
 
  // 2. Billing Info Section
  const billingInfoY = dividerY + 15;
  doc
    .fillColor(textColor)
    .fontSize(10)
    .font('Roboto-Bold')
    .text('BILL TO:', 50, billingInfoY);
 
  doc
    .font('Roboto')
    .fontSize(10)
    .fillColor(textColor)
    .text(`Customer Name: ${bill.customerName}`, 50, billingInfoY + 18)
    .text(`Contact Phone: ${bill.customerPhone || 'N/A'}`, 50, billingInfoY + 33);
 
  let addressOffsetY = 33;
  if (bill.customerAddress) {
    doc.text(`Customer Address: ${bill.customerAddress}`, 50, billingInfoY + 48, { width: 300 });
    const addressLinesCount = Math.ceil(bill.customerAddress.length / 50);
    addressOffsetY += 15 * addressLinesCount;
  }

  // 3. Items Table Section
  const tableTop = billingInfoY + addressOffsetY + 25;
  
  // Table Headers
  doc
    .fillColor(primaryColor)
    .font('Roboto-Bold')
    .fontSize(9);
 
  doc.text('Item Description', 50, tableTop);
  doc.text('Qty', 260, tableTop, { width: 40, align: 'right' });
  doc.text('Unit Price', 310, tableTop, { width: 70, align: 'right' });
  doc.text('GST (%)', 390, tableTop, { width: 60, align: 'right' });
  doc.text('Amount (₹)', 460, tableTop, { width: 90, align: 'right' });
 
  // Header separator line
  doc
    .strokeColor(primaryColor)
    .lineWidth(1.5)
    .moveTo(50, tableTop + 15)
    .lineTo(550, tableTop + 15)
    .stroke();

  // Table Body Rows
  let y = tableTop + 25;
  doc.font('Roboto').fontSize(9).fillColor(textColor);

  bill.items.forEach((item) => {
    const qty = Number(item.quantity);
    const price = Number(item.price);
    const gst = Number(item.gst);

    const baseVal = price * qty;
    const gstVal = (baseVal * gst) / 100;
    const totalItem = baseVal + gstVal;

    // Draw alternate row background for premium receipt layout
    doc
      .rect(50, y - 4, 500, 18)
      .fill('#f9fafb');
      
    doc.fillColor(textColor); // Restore color

    doc.text(item.productName, 55, y, { width: 195, lineBreak: false });
    doc.text(qty.toString(), 260, y, { width: 40, align: 'right' });
    doc.text(`₹${price.toFixed(2)}`, 310, y, { width: 70, align: 'right' });
    doc.text(`${gst}%`, 390, y, { width: 60, align: 'right' });
    doc.text(`₹${totalItem.toFixed(2)}`, 460, y, { width: 90, align: 'right' });

    y += 20;
  });

  // Table footer line
  doc
    .strokeColor('#cccccc')
    .lineWidth(1)
    .moveTo(50, y)
    .lineTo(550, y)
    .stroke();

  // 4. Totals Block
  let totalsTop = y + 15;
  
  if (bill.paymentType === 'Credit') {
    doc
      .fillColor(textColor)
      .font('Roboto-Bold')
      .fontSize(10)
      .text(`Total Bill Amount: ₹${Number(bill.total).toFixed(2)}`, 50, totalsTop, { align: 'right', width: 500 });
    
    totalsTop += 15;
    
    doc
      .fillColor('#10b981') // Green for paid
      .font('Roboto-Bold')
      .fontSize(10)
      .text(`Amount Paid: ₹${Number(bill.paidAmount || 0).toFixed(2)}`, 50, totalsTop, { align: 'right', width: 500 });
    
    totalsTop += 15;
    
    doc
      .fillColor('#d97706') // Amber for remaining balance / udhaar
      .font('Roboto-Bold')
      .fontSize(12)
      .text(`Remaining Balance (Udhaar): ₹${Number(bill.remainingAmount || 0).toFixed(2)}`, 50, totalsTop, { align: 'right', width: 500 });

    if (bill.dueDate) {
      totalsTop += 18;
      doc
        .fillColor(secondaryText)
        .font('Roboto-Italic')
        .fontSize(9)
        .text(`Payment Due Date: ${new Date(bill.dueDate).toLocaleDateString()}`, 50, totalsTop, { align: 'right', width: 500 });
    }
  } else {
    // Regular 'Paid' bill
    doc
      .fillColor(primaryColor)
      .font('Roboto-Bold')
      .fontSize(14)
      .text(`Grand Total (Paid): ₹${Number(bill.total).toFixed(2)}`, 50, totalsTop, { align: 'right', width: 500 });
  }

  // 5. Invoice Footer
  doc
    .fillColor(secondaryText)
    .font('Roboto-Italic')
    .fontSize(9)
    .text(bFooter, 50, totalsTop + 50, { align: 'center', width: 500 });

  // Finalize the PDF file
  doc.end();
};

module.exports = { generateInvoicePdf };
