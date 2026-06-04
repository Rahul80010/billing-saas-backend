const PDFDocument = require('pdfkit');

/**
 * Generates an elegant print-friendly PDF invoice from a bill and pipes it to the HTTP response stream.
 * @param {object} bill - Mongoose Bill document
 * @param {string} businessName - Merchant's business name
 * @param {object} res - Express Response object
 */
const generateInvoicePdf = (bill, businessName, res) => {
  const doc = new PDFDocument({ margin: 50 });

  // Pipe the document directly to the response
  doc.pipe(res);

  // Styling palette
  const primaryColor = '#093a84'; // Premium MOHURI navy blue
  const secondaryColor = '#0066ff'; // Sky blue accent
  const textColor = '#1f2937'; // Slate dark gray
  const secondaryText = '#6b7280'; // Cool gray
  
  // 1. Header Section
  doc
    .fillColor(primaryColor)
    .fontSize(22)
    .font('Helvetica-Bold')
    .text(businessName || 'MOHURI Invoice', 50, 50);

  doc
    .fillColor(secondaryText)
    .fontSize(10)
    .font('Helvetica')
    .text('Tax Invoice / Receipt', 50, 75);

  // Invoice Details (Right-aligned)
  const invoiceId = bill._id.toString().toUpperCase();
  doc
    .fillColor(textColor)
    .fontSize(9)
    .font('Helvetica-Bold')
    .text('INVOICE DETAIL', 400, 50, { align: 'right' })
    .font('Helvetica')
    .fillColor(secondaryText)
    .text(`Invoice ID: ${invoiceId}`, 400, 65, { align: 'right' })
    .text(`Date: ${new Date(bill.createdAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}`, 400, 78, { align: 'right' });

  // Divider Line
  doc
    .strokeColor('#e5e7eb')
    .lineWidth(1)
    .moveTo(50, 100)
    .lineTo(550, 100)
    .stroke();

  // 2. Billing Info Section
  doc
    .fillColor(textColor)
    .fontSize(10)
    .font('Helvetica-Bold')
    .text('BILL TO:', 50, 120);

  doc
    .font('Helvetica')
    .fontSize(10)
    .fillColor(textColor)
    .text(`Customer Name: ${bill.customerName}`, 50, 138)
    .text(`Contact Phone: ${bill.customerPhone || 'N/A'}`, 50, 153);

  // 3. Items Table Section
  const tableTop = 190;
  
  // Table Headers
  doc
    .fillColor(primaryColor)
    .font('Helvetica-Bold')
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
  doc.font('Helvetica').fontSize(9).fillColor(textColor);

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
  const totalsTop = y + 15;
  
  doc
    .fillColor(primaryColor)
    .font('Helvetica-Bold')
    .fontSize(14)
    .text(`Grand Total: ₹${Number(bill.total).toFixed(2)}`, 50, totalsTop, { align: 'right', width: 500 });

  // 5. Invoice Footer
  doc
    .fillColor(secondaryText)
    .font('Helvetica-Oblique')
    .fontSize(9)
    .text('Thank you for your purchase! Please visit us again. 🙏', 50, totalsTop + 50, { align: 'center', width: 500 });

  // Finalize the PDF file
  doc.end();
};

module.exports = { generateInvoicePdf };
