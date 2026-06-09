const nodemailer = require('nodemailer');
const dns = require('dns').promises;

// Resolve host to IPv4 address dynamically to prevent IPv6 ENETUNREACH issues on cloud hosts like Railway
const resolveIPv4 = async (hostname) => {
  try {
    const result = await dns.lookup(hostname, { family: 4 });
    console.log(`[DNS] Resolved ${hostname} to IPv4: ${result.address}`);
    return result.address;
  } catch (error) {
    console.warn(`[DNS] Failed to resolve ${hostname} to IPv4, using original hostname:`, error.message);
    return hostname;
  }
};

const sendOtpEmail = async (email, otp, type = 'verify') => {
  const resendApiKey = process.env.RESEND_API_KEY;
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT || 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || `"MOHURI by Detalogy" <noreply@mohuri.com>`;

  // Configure text and templates based on type
  const isReset = type === 'reset';
  const subject = isReset ? 'Reset your MOHURI Password - OTP' : 'Verify your MOHURI Account - OTP';
  const actionText = isReset ? 'reset your password' : 'verify your account';
  const headingText = isReset ? 'MOHURI - Reset Password Request' : 'Welcome to MOHURI by Detalogy!';
  
  const text = `Your 6-digit verification code to ${actionText} is: ${otp}. This code is valid for 10 minutes.`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
      <h2 style="color: #2563eb; text-align: center;">${headingText}</h2>
      <p>Please use the following One-Time Password (OTP) to ${actionText}:</p>
      <div style="font-size: 32px; font-weight: bold; text-align: center; color: #2563eb; letter-spacing: 5px; margin: 30px 0; padding: 15px; background-color: #f3f4f6; border-radius: 6px;">
        ${otp}
      </div>
      <p style="color: #ef4444; font-weight: 500;">This verification code is valid for 10 minutes.</p>
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;" />
      <p style="font-size: 12px; color: #6b7280; text-align: center;">
        If you did not request this, please ignore this email.
      </p>
    </div>
  `;

  // 1. Try Nodemailer SMTP if credentials are fully configured
  if (user && pass && host) {
    try {
      console.log(`[SMTP] Sending ${type} email to: ${email}`);
      const resolvedHost = await resolveIPv4(host);
      const transporter = nodemailer.createTransport({
        host: resolvedHost,
        port: Number(port),
        secure: Number(port) === 465, // true for 465, false for other ports
        auth: {
          user,
          pass,
        },
        tls: {
          servername: host, // Critical for certificate validation against original hostname
        }
      });

      const info = await transporter.sendMail({
        from,
        to: email,
        subject,
        text,
        html,
      });

      console.log(`[SMTP] Email sent successfully to ${email}. MessageID: ${info.messageId}`);
      return true;
    } catch (error) {
      console.error(`[SMTP] Failed to send email to ${email}:`, error);
      // Fallback to Resend or Sandbox if SMTP fails
    }
  }

  // 2. Try sending via Resend API (HTTP POST over Port 443)
  if (resendApiKey) {
    try {
      console.log(`[Resend] Sending ${type} email to: ${email}`);
      const resendFrom = process.env.RESEND_FROM || 'onboarding@resend.dev';
      
      let response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${resendApiKey}`
        },
        body: JSON.stringify({
          from: resendFrom,
          to: email,
          subject,
          text,
          html
        })
      });

      let data = await response.json();

      // Defensive Retry: If custom sender fails, retry using verified onboarding@resend.dev fallback
      if (!response.ok && resendFrom !== 'onboarding@resend.dev') {
        console.warn(`[Resend] Failed with custom sender "${resendFrom}". Retrying with "onboarding@resend.dev"...`);
        response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${resendApiKey}`
          },
          body: JSON.stringify({
            from: 'onboarding@resend.dev',
            to: email,
            subject,
            text,
            html
          })
        });
        data = await response.json();
      }

      if (response.ok) {
        console.log(`[Resend] Email sent successfully to ${email}. ID: ${data.id}`);
        return true;
      } else {
        console.error('[Resend] API error response:', data);
      }
    } catch (resendError) {
      console.error('[Resend] API connection failed:', resendError);
    }
  }

  // 3. Fallback to Sandbox Mode (local console & log file)
  console.log('\n==================================================');
  console.log(`[SANDBOX MODE] Email to: ${email}`);
  console.log(`[SANDBOX MODE] Type: ${type}`);
  console.log(`[SANDBOX MODE] Your 6-Digit OTP is: ${otp}`);
  console.log('==================================================\n');

  // Also write to a local log file in the project root so user can easily read it
  try {
    const fs = require('fs');
    const path = require('path');
    const logPath = path.join(__dirname, '../otp-debug.log');
    const logMessage = `[${new Date().toLocaleString()}] Email: ${email} | Type: ${type} | OTP: ${otp}\n`;
    fs.appendFileSync(logPath, logMessage);
  } catch (fsErr) {
    console.error('Failed to write OTP to debug file:', fsErr.message);
  }

  return true;
};

module.exports = { sendOtpEmail };
