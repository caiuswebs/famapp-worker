// ===============================
// 🔵 FAMAPP AUTO PAYMENT VERIFIER
// Cloudflare Worker (Gmail API)
// ===============================

// Work with Cloudflare secrets:
const GMAIL_CLIENT_ID = GMAIL_CLIENT_ID_SEC;
const GMAIL_CLIENT_SECRET = GMAIL_CLIENT_SECRET_SEC;
const GMAIL_REFRESH_TOKEN = GMAIL_REFRESH_TOKEN_SEC;
const BOT_WEBHOOK_URL = WEBHOOK_URL_SEC;
const PROJECT_SECRET = PROJECT_SECRET_SEC;

// Decode Gmail body
function decodeBase64(data) {
  try {
    return atob(data.replace(/-/g, "+").replace(/_/g, "/"));
  } catch {
    return "";
  }
}

// Gmail API: Get unread mails
async function getUnreadEmails(token) {
  const res = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages?q=is:unread",
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return res.json();
}

// Gmail API: Get full email
async function getEmail(id, token) {
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return res.json();
}

// Extract payments from email text
function parseFamApp(text) {
  const amount = text.match(/₹(\d+(\.\d+)?)/)?.[1];
  const utr = text.match(/FMPIB\d+/)?.[0];
  const sender = text.match(/from\s([A-Za-z]+)/)?.[1];

  if (!amount || !utr) return null;

  return { amount, utr, sender };
}

// Send webhook to bot
async function sendWebhook(payload) {
  await fetch(BOT_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

// Main Worker
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Simple auth
    if (url.searchParams.get("key") !== PROJECT_SECRET) {
      return new Response("Unauthorized", { status: 401 });
    }

    // Generate Gmail Access Token
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: GMAIL_CLIENT_ID,
        client_secret: GMAIL_CLIENT_SECRET,
        refresh_token: GMAIL_REFRESH_TOKEN,
        grant_type: "refresh_token",
      }),
    });

    const { access_token } = await tokenRes.json();
    if (!access_token) return new Response("Gmail Auth Failed", { status: 500 });

    // Fetch unread emails
    const mails = await getUnreadEmails(access_token);
    if (!mails.messages) return new Response("No unread mails", { status: 200 });

    let processed = [];

    for (const mail of mails.messages) {
      const fullMail = await getEmail(mail.id, access_token);

      const bodyData =
        fullMail.payload.parts?.[0]?.body?.data ||
        fullMail.payload.body?.data ||
        "";

      const text = decodeBase64(bodyData);

      if (!text.includes("FamApp")) continue;

      const pay = parseFamApp(text);
      if (!pay) continue;

      processed.push(pay);
      await sendWebhook(pay);

      // Mark email as read
      await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${mail.id}/modify`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${access_token}` },
          body: JSON.stringify({ removeLabelIds: ["UNREAD"] }),
        }
      );
    }

    return new Response(JSON.stringify({ ok: true, processed }), {
      headers: { "Content-Type": "application/json" },
    });
  }
};
