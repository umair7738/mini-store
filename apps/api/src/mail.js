import { HttpError } from "./validation.js";

const BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email";

export function isEmailConfigured() {
  return Boolean(process.env.BREVO_API_KEY && process.env.EMAIL_FROM);
}

function sender() {
  const raw = String(process.env.EMAIL_FROM || "").trim();
  const match = raw.match(/^(.*)<([^>]+)>$/);
  const email = (match ? match[2] : raw).trim();
  const name = (process.env.EMAIL_FROM_NAME || (match ? match[1] : "") || "Danube Milano").trim();
  return name ? { email, name } : { email };
}

export async function sendTransactionalEmail({ to, subject, htmlContent }) {
  if (!isEmailConfigured()) throw new HttpError(503, "EMAIL_NOT_CONFIGURED", "Email is not configured");
  try {
    const response = await fetch(BREVO_ENDPOINT, {
      method: "POST",
      headers: {
        "api-key": process.env.BREVO_API_KEY,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ sender: sender(), to: [{ email: to }], subject, htmlContent }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      console.error(`Transactional email delivery failed with status ${response.status}`);
      throw new HttpError(503, "EMAIL_FAILED", "Email could not be sent");
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    console.error("Transactional email delivery failed");
    throw new HttpError(503, "EMAIL_FAILED", "Email could not be sent");
  }
}

export async function sendVerificationEmail(address, token) {
  const link = `${process.env.WEB_ORIGIN}/account/verify#${token}`;
  await sendTransactionalEmail({
    to: address,
    subject: "Verify your Danube Milano account",
    htmlContent: `<p>Use this link within one hour to verify your email and set a password:</p><p><a href="${link}">Verify your account</a></p>`,
  });
}

export async function sendOrderRecoveryEmail(address, token) {
  const link = `${process.env.WEB_ORIGIN}/orders/recover#${token}`;
  await sendTransactionalEmail({
    to: address,
    subject: "Verify your Danube Milano order",
    htmlContent: `<p>Use this secure link within 15 minutes to access your order:</p><p><a href="${link}">View your order</a></p>`,
  });
}
