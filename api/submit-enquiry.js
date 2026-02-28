const { Resend } = require('resend');
const nodemailer = require('nodemailer');
const { neon } = require('@neondatabase/serverless');

// Initialize services
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.ionos.co.uk',
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  let sql;
  try {
    const { name, email, phone, enquiryType, message, marketing, submittedAt } = req.body;

    // Validation
    if (!name || !email || !phone || !enquiryType) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    // Connect to Neon database if URL exists
    if (process.env.POSTGRES_URL) {
      try {
        sql = neon(process.env.POSTGRES_URL);
      } catch (dbErr) {
        console.error('Database connection failed:', dbErr);
        // Continue without database - email is primary
      }
    }

    // Save to database if connected
    let dbSaved = false;
    if (sql) {
      try {
        await sql`
          CREATE TABLE IF NOT EXISTS enquiries (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            email VARCHAR(255) NOT NULL,
            phone VARCHAR(50) NOT NULL,
            enquiry_type VARCHAR(100) NOT NULL,
            message TEXT,
            marketing_consent BOOLEAN DEFAULT false,
            submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            status VARCHAR(50) DEFAULT 'new'
          )
        `;
        
        await sql`
          INSERT INTO enquiries (name, email, phone, enquiry_type, message, marketing_consent, submitted_at)
          VALUES (${name}, ${email}, ${phone}, ${enquiryType}, ${message || null}, ${marketing || false}, ${submittedAt || new Date().toISOString()})
        `;
        dbSaved = true;
      } catch (dbErr) {
        console.error('Database save failed:', dbErr);
        // Continue - email is primary
      }
    }

    // Format enquiry type for display
    const enquiryTypeLabels = {
      'general': 'General Question',
      'booking': 'Booking Enquiry',
      'pass-guarantee': 'Pass Guarantee Programme',
      'bulk-packages': 'Bulk Packages',
      'availability': 'Check Availability'
    };

    const formattedType = enquiryTypeLabels[enquiryType] || enquiryType;

    // Build email content
    const emailSubject = `New Enquiry: ${formattedType} from ${name}`;
    const emailHtml = `
      <div style="font-family: 'Lato', sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; color: #272727;">
        <div style="text-align: center; margin-bottom: 32px;">
          <h2 style="font-family: 'Bricolage Grotesque', sans-serif; color: #f58321; margin: 0; font-size: 28px;">CoachCarter</h2>
          <p style="color: #797879; margin: 8px 0 0 0; font-size: 14px;">New Website Enquiry</p>
        </div>
        
        <div style="background: #f9f9f9; border-radius: 16px; padding: 32px; border: 1px solid #e0e0e0;">
          <div style="margin-bottom: 24px;">
            <label style="display: block; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: #797879; margin-bottom: 4px; font-weight: 700;">Enquiry Type</label>
            <div style="font-size: 18px; font-weight: 700; color: #f58321;">${formattedType}</div>
          </div>
          
          <div style="margin-bottom: 20px;">
            <label style="display: block; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: #797879; margin-bottom: 4px; font-weight: 700;">Name</label>
            <div style="font-size: 16px;">${name}</div>
          </div>
          
          <div style="margin-bottom: 20px;">
            <label style="display: block; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: #797879; margin-bottom: 4px; font-weight: 700;">Email</label>
            <div style="font-size: 16px;"><a href="mailto:${email}" style="color: #272727;">${email}</a></div>
          </div>
          
          <div style="margin-bottom: 20px;">
            <label style="display: block; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: #797879; margin-bottom: 4px; font-weight: 700;">Phone</label>
            <div style="font-size: 16px;"><a href="tel:${phone}" style="color: #272727;">${phone}</a></div>
          </div>
          
          ${message ? `
          <div style="margin-bottom: 20px;">
            <label style="display: block; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: #797879; margin-bottom: 4px; font-weight: 700;">Message</label>
            <div style="font-size: 16px; line-height: 1.6; white-space: pre-wrap;">${message.replace(/\n/g, '<br>')}</div>
          </div>
          ` : ''}
          
          <div style="margin-top: 24px; padding-top: 24px; border-top: 1px solid #e0e0e0;">
            <div style="font-size: 12px; color: #797879;">
              <strong>Marketing Consent:</strong> ${marketing ? 'Yes' : 'No'}<br>
              <strong>Database Saved:</strong> ${dbSaved ? 'Yes' : 'No (email only)'}<br>
              <strong>Submitted:</strong> ${new Date(submittedAt || Date.now()).toLocaleString('en-GB')}
            </div>
          </div>
        </div>
        
        <div style="text-align: center; margin-top: 32px; font-size: 12px; color: #797879;">
          <p>This enquiry was submitted via the CoachCarter website.</p>
          <p style="margin-top: 16px;">
            <a href="mailto:${email}?subject=Re: Your enquiry to CoachCarter" style="background: #f58321; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: 700; margin-right: 8px;">Reply to ${name}</a>
            <a href="tel:${phone}" style="background: #272727; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: 700;">Call ${phone}</a>
          </p>
        </div>
      </div>
    `;

    const emailText = `
New Enquiry from CoachCarter Website

Type: ${formattedType}
Name: ${name}
Email: ${email}
Phone: ${phone}
Marketing Consent: ${marketing ? 'Yes' : 'No'}
Database Saved: ${dbSaved ? 'Yes' : 'No'}

Message:
${message || 'No message provided'}

Submitted: ${new Date(submittedAt || Date.now()).toLocaleString('en-GB')}
    `;

    // Send email (Resend primary, Nodemailer fallback)
    let emailSent = false;
    const toEmail = process.env.STAFF_EMAIL || 'fraser@coachcarter.uk';
    const fromEmail = 'enquiries@coachcarter.uk';

    if (resend) {
      try {
        const { error } = await resend.emails.send({
          from: `CoachCarter <${fromEmail}>`,
          to: [toEmail],
          subject: emailSubject,
          html: emailHtml,
          text: emailText,
          reply_to: email
        });
        
        if (!error) {
          emailSent = true;
        } else {
          console.error('Resend error:', error);
        }
      } catch (resendErr) {
        console.error('Resend failed:', resendErr);
      }
    }

    if (!emailSent) {
      await transporter.sendMail({
        from: `"CoachCarter" <${process.env.SMTP_USER}>`,
        to: toEmail,
        subject: emailSubject,
        html: emailHtml,
        text: emailText,
        replyTo: email
      });
    }

    res.status(200).json({ 
      success: true, 
      message: 'Enquiry submitted successfully',
      dbSaved: dbSaved
    });

  } catch (err) {
    console.error('Error processing enquiry:', err);
    res.status(500).json({ error: 'Failed to process enquiry. Please try again or contact us directly at fraser@coachcarter.uk' });
  }
};
