import crypto from "crypto";

export function decryptGiftCard(text: string): string {
  const ENCRYPTION_KEY = process.env.GIFT_CARD_ENCRYPTION_KEY || "";

  const textParts = text.split(":");

  if (textParts.length < 2) {
    throw new Error("Invalid input string. It must contain an IV and encrypted data.");
  }

  const ivString = textParts.shift() as string;
  const iv = Buffer.from(ivString, "hex");

  const encryptedText = Buffer.from(textParts.join(":"), "hex");

  const decipher = crypto.createDecipheriv(
    "aes-256-cbc",
    Buffer.from(ENCRYPTION_KEY, "hex"),
    iv,
  );

  let decrypted = decipher.update(encryptedText);
  decrypted = Buffer.concat([decrypted, decipher.final()]);

  return decrypted.toString();
}

export function encryptGiftCard(text: string): string {
  const ENCRYPTION_KEY = process.env.GIFT_CARD_ENCRYPTION_KEY || "";
  const iv = crypto.randomBytes(16);

  const cipher = crypto.createCipheriv(
    "aes-256-cbc",
    Buffer.from(ENCRYPTION_KEY, "hex"),
    iv,
  );

  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);

  return iv.toString("hex") + ":" + encrypted.toString("hex");
}
