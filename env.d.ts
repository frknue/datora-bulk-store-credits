/// <reference types="vite/client" />
/// <reference types="@react-router/node" />

declare module "luxon" {
  export class DateTime {
    static fromISO(
      text: string,
      opts?: { zone?: string },
    ): DateTime;
    toUTC(): DateTime;
    toISO(): string | null;
  }
}

declare module "nodemailer" {
  interface TransportOptions {
    host?: string;
    port?: number;
    secure?: boolean;
    auth?: { user?: string; pass?: string };
    tls?: { ciphers?: string };
  }
  interface MailOptions {
    from?: string;
    to?: string;
    replyTo?: string;
    subject?: string;
    text?: string;
    html?: string;
  }
  interface Transporter {
    sendMail(options: MailOptions): Promise<{ messageId: string }>;
  }
  function createTransport(options: TransportOptions): Transporter;
  export default { createTransport };
}
