const nodemailer = require('nodemailer');

const sendOtpEmail = async (email, otp) => {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT || 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || `"BillSaaS" <noreply@billsaas.com>`;

  if (!user || !pass) {
    console.log('\n==================================================');
    console.log(`[SANDBOX MODE] Email to: ${email}`);
    console.log(`[SANDBOX MODE] Your 6-Digit OTP is: ${otp}`);
    console.log('==================================================\n');
    return true;
  }

  try {
    const transporter = nodemailer.createTransport({
      host,
      port: Number(port),
      secure: Number(port) === 465, // true for 465, false for other ports
      auth: {
        user,
        pass,
      },
    });

    const info = await transporter.sendMail({
      from,
      to: email,
      subject: 'Verify your BillSaaS Account - OTP',
      text: `Your 6-digit verification code is: ${otp}. This code is valid for 10 minutes.`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
          <h2 style="color: #2563eb; text-align: center;">Welcome to BillSaaS!</h2>
          <p>Thank you for registering. Please use the following One-Time Password (OTP) to verify your account:</p>
          <div style="font-size: 32px; font-weight: bold; text-align: center; color: #2563eb; letter-spacing: 5px; margin: 30px 0; padding: 15px; background-color: #f3f4f6; border-radius: 6px;">
            ${otp}
          </div>
          <p style="color: #ef4444; font-weight: 500;">This verification code is valid for 10 minutes.</p>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;" />
          <p style="font-size: 12px; color: #6b7280; text-align: center;">
            If you did not request this, please ignore this email.
          </p>
        </div>
      `,
    });

    console.log(`Email sent successfully to ${email}. MessageID: ${info.messageId}`);
    return true;
  } catch (error) {
    console.error(`Failed to send email to ${email}:`, error);
    return false;
  }
};

module.exports = { sendOtpEmail };
