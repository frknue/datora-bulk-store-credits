import nodemailer from "nodemailer";

export interface ContactMessageInput {
  subject: string;
  name: string;
  email: string;
  message: string;
  shopName: string;
}

export type ContactSendResult =
  | { ok: true }
  | { ok: false; reason: "invalid" | "send_failed" };

function isValidEmail(address: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address);
}

export async function sendContactMessage(
  input: ContactMessageInput,
): Promise<ContactSendResult> {
  const { subject, name, email, message, shopName } = input;

  if (!subject || !name || !email || !message || !isValidEmail(email)) {
    return { ok: false, reason: "invalid" };
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || "587"),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    tls: {
      ciphers: "SSLv3",
    },
  });

  const emailHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Email</title>
      <style>
      .email-container {
        font-family: Arial, sans-serif;
        color: #333;
        padding: 20px;
        max-width: 600px;
        margin: auto;
        border: 1px solid #ddd;
        border-radius: 5px;
        box-shadow: 0px 0px 10px rgba(0,0,0,0.1);
      }
      .header {
        background-color: #f4f4f4;
        padding: 10px;
        border-bottom: 1px solid #ddd;
        text-align: center;
      }
      .content {
        padding: 20px;
      }
      </style>
    </head>
    <body>
      <div class="email-container">
        <div class="header">
          <h2>New Message Received</h2>
          <p>From Datora | Bulk Gift Cards App</p>
        </div>
        <div class="content">
          <p><strong>Subject:</strong> ${subject}</p>
          <p><strong>From:</strong> ${name} (${email})</p>
          <p><strong>Shop Name:</strong> ${shopName}</p>
          <p><strong>Message:</strong></p>
          <p>${message.replace(/\n/g, "<br>")}</p>
        </div>
      </div>
    </body>
    </html>
  `;

  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to: process.env.SMTP_FROM,
      replyTo: email,
      subject,
      html: emailHtml,
    });
    return { ok: true };
  } catch (error) {
    console.error("Error sending contact email:", error);
    return { ok: false, reason: "send_failed" };
  }
}
