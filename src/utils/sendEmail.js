const nodemailer = require('nodemailer');

/**
 * Send email using Nodemailer
 * @param {Object} options - Email options
 * @param {string} options.email - Recipient email
 * @param {string} options.subject - Email subject
 * @param {string} options.html - HTML content
 * @param {string} [options.text] - Plain text content (optional)
 */
const sendEmail = async (options) => {
  // Create transporter based on environment
  let transporter;

  if (process.env.NODE_ENV === 'production') {
    // Production: Use real email service (e.g., SendGrid, Mailgun, SES)
    // Example with SendGrid:
    if (process.env.EMAIL_SERVICE === 'sendgrid') {
      transporter = nodemailer.createTransport({
        service: 'SendGrid',
        auth: {
          user: process.env.SENDGRID_USERNAME,
          pass: process.env.SENDGRID_API_KEY,
        },
      });
    }
    // Example with Gmail:
    else if (process.env.EMAIL_SERVICE === 'gmail') {
      transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS, // Use app-specific password
        },
      });
    }
    // Generic SMTP:
    else {
      transporter = nodemailer.createTransport({
        host: process.env.EMAIL_HOST,
        port: process.env.EMAIL_PORT,
        secure: process.env.EMAIL_PORT === '465', // true for 465, false for other ports
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS,
        },
      });
    }
  } else {
    // Development: Use Mailtrap or Ethereal for testing
    // Mailtrap (recommended for development)
    if (process.env.MAILTRAP_USER && process.env.MAILTRAP_PASS) {
      transporter = nodemailer.createTransport({
        host: 'sandbox.smtp.mailtrap.io',
        port: 2525,
        auth: {
          user: process.env.MAILTRAP_USER,
          pass: process.env.MAILTRAP_PASS,
        },
      });
    }
    // Fallback: Create test account with Ethereal
    else {
      const testAccount = await nodemailer.createTestAccount();
      transporter = nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        auth: {
          user: testAccount.user,
          pass: testAccount.pass,
        },
      });
    }
  }

  // Email template wrapper
  const htmlTemplate = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${options.subject}</title>
      <style>
        body {
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          line-height: 1.6;
          color: #333;
          max-width: 600px;
          margin: 0 auto;
          padding: 20px;
          background-color: #f5f5f5;
        }
        .email-container {
          background-color: #ffffff;
          border-radius: 12px;
          padding: 32px;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        }
        .logo {
          text-align: center;
          margin-bottom: 24px;
        }
        .logo-text {
          font-size: 28px;
          font-weight: bold;
          background: linear-gradient(135deg, #3377ff 0%, #06c7ae 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }
        h2 {
          color: #1a1a2e;
          margin-top: 0;
        }
        p {
          color: #555;
          margin: 12px 0;
        }
        a {
          color: #3377ff;
        }
        .footer {
          text-align: center;
          margin-top: 32px;
          padding-top: 24px;
          border-top: 1px solid #eee;
          color: #888;
          font-size: 12px;
        }
      </style>
    </head>
    <body>
      <div class="email-container">
        <div class="logo">
          <span class="logo-text">AIRhub</span>
        </div>
        ${options.html}
        <div class="footer">
          <p>© ${new Date().getFullYear()} AIRhub. All rights reserved.</p>
          <p>This is an automated message, please do not reply directly to this email.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  // Mail options
  const mailOptions = {
    from: `"AIRhub" <${process.env.EMAIL_FROM || 'noreply@airhub.com'}>`,
    to: options.email,
    subject: options.subject,
    html: htmlTemplate,
    text: options.text || options.html.replace(/<[^>]*>/g, ''), // Strip HTML for plain text
  };

  // Send email
  const info = await transporter.sendMail(mailOptions);

  // Log preview URL in development (for Ethereal)
  if (process.env.NODE_ENV !== 'production' && info.messageId) {
    console.log('📧 Email sent:', info.messageId);
    const previewUrl = nodemailer.getTestMessageUrl(info);
    if (previewUrl) {
      console.log('📧 Preview URL:', previewUrl);
    }
  }

  return info;
};

/**
 * Send welcome email to new user
 */
const sendWelcomeEmail = async (user) => {
  await sendEmail({
    email: user.email,
    subject: 'Welcome to AIRhub!',
    html: `
      <h2>Welcome to AIRhub, ${user.name}!</h2>
      <p>Thank you for registering with AIRhub - AI Remote Hub.</p>
      <p>Your account is currently pending approval. Once an administrator approves your account, you will be able to log in and start using the platform.</p>
      <p>We'll send you another email once your account has been approved.</p>
      <br>
      <p>Best regards,</p>
      <p>The AIRhub Team</p>
    `,
  });
};

/**
 * Send approval notification email
 */
const sendApprovalEmail = async (user) => {
  const loginUrl = `${process.env.FRONTEND_URL}/auth/login`;
  
  await sendEmail({
    email: user.email,
    subject: 'Your AIRhub Account Has Been Approved!',
    html: `
      <h2>Good news, ${user.name}!</h2>
      <p>Your AIRhub account has been approved by an administrator.</p>
      <p>You can now log in and start using the platform:</p>
      <a href="${loginUrl}" style="display: inline-block; padding: 12px 24px; background-color: #3377ff; color: white; text-decoration: none; border-radius: 8px; margin: 16px 0;">Log In to AIRhub</a>
      <br>
      <p>Best regards,</p>
      <p>The AIRhub Team</p>
    `,
  });
};

/**
 * Send rejection notification email
 */
const sendRejectionEmail = async (user, reason = null) => {
  await sendEmail({
    email: user.email,
    subject: 'AIRhub Account Registration Update',
    html: `
      <h2>Hello ${user.name},</h2>
      <p>We regret to inform you that your AIRhub account registration could not be approved at this time.</p>
      ${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ''}
      <p>If you believe this was a mistake or would like more information, please contact our support team.</p>
      <br>
      <p>Best regards,</p>
      <p>The AIRhub Team</p>
    `,
  });
};

module.exports = sendEmail;
module.exports.sendWelcomeEmail = sendWelcomeEmail;
module.exports.sendApprovalEmail = sendApprovalEmail;
module.exports.sendRejectionEmail = sendRejectionEmail;