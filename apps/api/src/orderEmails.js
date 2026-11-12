import { pool } from "./db.js";
import { sendTransactionalEmail } from "./mail.js";

const STORE_NAME = "Danube Milano";
const SUPPORT_EMAIL = process.env.EMAIL_FROM || "";
const BRAND = {
  ivory: "#faf7f2",
  charcoal: "#1f1d1b",
  bronze: "#8a6a3b",
  bronzeDark: "#6d5230",
  line: "#e6ddd0",
  muted: "#6b655d",
};

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatMoney(fils, currency = "AED") {
  const amount = (Number(fils) / 100).toFixed(2);
  return `${currency} ${amount}`;
}

export function formatDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-AE", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(date);
}

const STATUS_LABELS = {
  placed: "Placed",
  processing: "Preparing",
  shipped: "Dispatched",
  delivered: "Delivered",
  completed: "Completed",
  cancelled: "Cancelled",
};

const PAYMENT_LABELS = {
  unpaid: "Unpaid — cash on delivery",
  paid: "Paid",
  unknown: "Not recorded",
};

const EVENTS = {
  created: {
    subject: (order) => `Your ${STORE_NAME} order ${order.orderNumber} is confirmed`,
    heading: "Order confirmed",
    intro: (order) => `Thank you, ${order.name}. We've received your order and will begin preparing it shortly.`,
    includeItems: true,
  },
  processing: {
    subject: (order) => `Your ${STORE_NAME} order ${order.orderNumber} is being prepared`,
    heading: "We're preparing your order",
    intro: (order) => `Good news, ${order.name} — your order is now being prepared for dispatch.`,
    includeItems: false,
  },
  shipped: {
    subject: (order) => `Your ${STORE_NAME} order ${order.orderNumber} has shipped`,
    heading: "Your order is on its way",
    intro: (order) => `${order.name}, your order has been dispatched and is on its way to you.`,
    includeItems: false,
  },
  delivered: {
    subject: (order) => `Your ${STORE_NAME} order ${order.orderNumber} has been delivered`,
    heading: "Your order has been delivered",
    intro: (order) => `${order.name}, your order has been delivered. We hope you love it.`,
    includeItems: false,
  },
  cancelled: {
    subject: (order) => `Your ${STORE_NAME} order ${order.orderNumber} was cancelled`,
    heading: "Your order was cancelled",
    intro: (order) => `${order.name}, your order has been cancelled and its items have been returned to stock.`,
    includeItems: false,
  },
};

function detailRows(order, event) {
  const rows = [
    ["Order number", order.orderNumber],
    ["Order date", formatDate(order.createdAt)],
    ["Status", STATUS_LABELS[order.status] || order.status],
  ];
  if (event === "created") {
    rows.push(["Payment method", "Cash on Delivery"]);
    rows.push(["Payment status", PAYMENT_LABELS[order.paymentStatus] || order.paymentStatus]);
  }
  return rows;
}

function itemsSection(order) {
  const rows = order.items
    .map((item) => {
      const lineTotal = item.unitPriceFils * item.quantity;
      return `<tr>
        <td style="padding:10px 12px;border-top:1px solid ${BRAND.line};font-family:Arial,Helvetica,sans-serif;font-size:14px;color:${BRAND.charcoal};">${escapeHtml(item.productName)}<br><span style="font-size:12px;color:${BRAND.muted};">SKU ${escapeHtml(item.sku)}</span></td>
        <td align="center" style="padding:10px 8px;border-top:1px solid ${BRAND.line};font-family:Arial,Helvetica,sans-serif;font-size:14px;color:${BRAND.charcoal};">${escapeHtml(item.quantity)}</td>
        <td align="right" style="padding:10px 8px;border-top:1px solid ${BRAND.line};font-family:Arial,Helvetica,sans-serif;font-size:14px;color:${BRAND.charcoal};">${escapeHtml(formatMoney(item.unitPriceFils, order.currency))}</td>
        <td align="right" style="padding:10px 12px;border-top:1px solid ${BRAND.line};font-family:Arial,Helvetica,sans-serif;font-size:14px;color:${BRAND.charcoal};">${escapeHtml(formatMoney(lineTotal, order.currency))}</td>
      </tr>`;
    })
    .join("");
  const subtotal = order.items.reduce((sum, item) => sum + item.unitPriceFils * item.quantity, 0);
  return `<tr><td style="padding:22px 32px 0 32px;">
      <h2 style="margin:0 0 12px 0;font-family:Georgia,'Times New Roman',serif;font-size:16px;color:${BRAND.charcoal};">Items</h2>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${BRAND.line};border-collapse:collapse;">
        <tr>
          <th align="left" style="padding:10px 12px;background:${BRAND.ivory};font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:${BRAND.muted};">Item</th>
          <th align="center" style="padding:10px 8px;background:${BRAND.ivory};font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:${BRAND.muted};">Qty</th>
          <th align="right" style="padding:10px 8px;background:${BRAND.ivory};font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:${BRAND.muted};">Unit</th>
          <th align="right" style="padding:10px 12px;background:${BRAND.ivory};font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:${BRAND.muted};">Total</th>
        </tr>
        ${rows}
      </table>
    </td></tr>
    <tr><td style="padding:16px 32px 0 32px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr><td style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:${BRAND.muted};padding:4px 0;">Subtotal</td><td align="right" style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:${BRAND.charcoal};padding:4px 0;">${escapeHtml(formatMoney(subtotal, order.currency))}</td></tr>
        <tr><td style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:${BRAND.charcoal};padding:8px 0;border-top:1px solid ${BRAND.line};font-weight:bold;">Total</td><td align="right" style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:${BRAND.charcoal};padding:8px 0;border-top:1px solid ${BRAND.line};font-weight:bold;">${escapeHtml(formatMoney(order.totalFils, order.currency))}</td></tr>
      </table>
    </td></tr>`;
}

function trackingSection(order) {
  if (!order.trackingNumber) return "";
  const link = order.trackingUrl
    ? ` <a href="${escapeHtml(order.trackingUrl)}" style="color:${BRAND.bronze};text-decoration:underline;">Track your parcel</a>`
    : "";
  return `<tr><td style="padding:22px 32px 0 32px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.ivory};border:1px solid ${BRAND.line};">
        <tr><td style="padding:14px 16px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:${BRAND.charcoal};"><strong>Carrier:</strong> ${escapeHtml(order.carrier || "Not provided")}</td></tr>
        <tr><td style="padding:0 16px 14px 16px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:${BRAND.charcoal};"><strong>Tracking number:</strong> ${escapeHtml(order.trackingNumber)}${link}</td></tr>
      </table>
    </td></tr>`;
}

export function renderOrderEmail(event, order) {
  const config = EVENTS[event];
  if (!config) throw new Error(`Unknown order email event: ${event}`);
  const subject = config.subject(order);
  const intro = config.intro(order);
  const detail = detailRows(order, event)
    .map(
      ([label, value]) =>
        `<tr><td style="padding:6px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:${BRAND.muted};">${escapeHtml(label)}</td><td align="right" style="padding:6px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:${BRAND.charcoal};">${escapeHtml(value)}</td></tr>`,
    )
    .join("");
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.ivory};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.ivory};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid ${BRAND.line};border-collapse:collapse;">
<tr><td style="padding:26px 32px 10px 32px;border-bottom:2px solid ${BRAND.bronze};"><p style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:12px;letter-spacing:3px;text-transform:uppercase;color:${BRAND.bronze};">${STORE_NAME}</p></td></tr>
<tr><td style="padding:26px 32px 0 32px;">
<h1 style="margin:0 0 10px 0;font-family:Georgia,'Times New Roman',serif;font-size:24px;line-height:1.3;color:${BRAND.charcoal};">${escapeHtml(config.heading)}</h1>
<p style="margin:0 0 20px 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:${BRAND.muted};">${escapeHtml(intro)}</p>
</td></tr>
<tr><td style="padding:0 32px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.ivory};border:1px solid ${BRAND.line};border-collapse:collapse;">
${detail}
</table>
</td></tr>
${config.includeItems ? itemsSection(order) : ""}
${trackingSection(order)}
<tr><td style="padding:24px 32px 28px 32px;">
<p style="margin:0 0 6px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.6;color:${BRAND.muted};">You can view this order in your account or on the device you used to check out.</p>
<p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:${BRAND.muted};">This is a transactional message from ${STORE_NAME}. Please do not reply to this email.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  const textLines = [config.heading, "", intro, "", ...detailRows(order, event).map(([label, value]) => `${label}: ${value}`)];
  if (config.includeItems) {
    textLines.push("", "Items:");
    for (const item of order.items) {
      textLines.push(`- ${item.productName} (SKU ${item.sku}) x ${item.quantity} — ${formatMoney(item.unitPriceFils * item.quantity, order.currency)}`);
    }
    const subtotal = order.items.reduce((sum, item) => sum + item.unitPriceFils * item.quantity, 0);
    textLines.push("", `Subtotal: ${formatMoney(subtotal, order.currency)}`, `Total: ${formatMoney(order.totalFils, order.currency)}`);
  }
  if (order.trackingNumber) {
    textLines.push("", `Carrier: ${order.carrier || "Not provided"}`, `Tracking number: ${order.trackingNumber}`);
    if (order.trackingUrl) textLines.push(`Track your parcel: ${order.trackingUrl}`);
  }
  textLines.push("", "You can view this order in your account or on the device you used to check out.", "", `— ${STORE_NAME}`);

  return { subject, html, text: textLines.join("\n") };
}

export function prepareOrderEmail(event, order) {
  const mail = renderOrderEmail(event, order);
  return {
    to: order.email,
    subject: mail.subject,
    htmlContent: mail.html,
    textContent: mail.text,
  };
}

export async function sendOrderEmail(event, order) {
  if (!EVENTS[event] || !order?.email) return false;
  try {
    await sendTransactionalEmail(prepareOrderEmail(event, order));
    return true;
  } catch (error) {
    console.error(`Order ${event} email delivery failed`);
    return false;
  }
}

export async function loadOrderForEmail(orderId) {
  const [rows] = await pool.execute(
    `SELECT id, customer_name, customer_email, currency, total_fils, status, payment_status,
            carrier, tracking_number, tracking_url, created_at
     FROM orders WHERE id = ?`,
    [orderId],
  );
  if (!rows.length) return null;
  const row = rows[0];
  const [items] = await pool.execute(
    "SELECT product_name, sku, unit_price_fils, quantity FROM order_items WHERE order_id = ? ORDER BY id",
    [orderId],
  );
  return {
    orderNumber: `DM-${String(row.id).padStart(8, "0")}`,
    name: row.customer_name,
    email: row.customer_email,
    currency: row.currency,
    totalFils: row.total_fils,
    status: row.status,
    paymentStatus: row.payment_status,
    carrier: row.carrier,
    trackingNumber: row.tracking_number,
    trackingUrl: row.tracking_url,
    createdAt: row.created_at,
    items: items.map((item) => ({
      productName: item.product_name,
      sku: item.sku,
      unitPriceFils: item.unit_price_fils,
      quantity: item.quantity,
    })),
  };
}

export async function sendOrderEmailById(event, orderId) {
  try {
    const order = await loadOrderForEmail(orderId);
    if (!order) return false;
    return await sendOrderEmail(event, order);
  } catch (error) {
    console.error(`Order ${event} email delivery failed`);
    return false;
  }
}