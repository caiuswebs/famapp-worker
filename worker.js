export default {
  async fetch(request, env) {
    // --- AUTH ---
    const url = new URL(request.url);
    if (url.searchParams.get("key") !== env.PROJECT_SECRET) {
      return new Response("Unauthorized", { status: 401 });
    }

    // --- STEP 1: GET GOOGLE ACCESS TOKEN ---
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: env.GMAIL_CLIENT_ID,
        client_secret: env.GMAIL_CLIENT_SECRET,
        refresh_token: env.GMAIL_REFRESH_TOKEN,
        grant_type: "refresh_token"
      })
    });

    const { access_token } = await tokenRes.json();
    if (!access_token) return new Response("TOKEN ERROR", { status: 500 });

    // --- STEP 2: GET UNREAD EMAILS ---
    const mailListRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=is:unread`,
      { headers: { Authorization: `Bearer ${access_token}` } }
    );

    const mailList = await mailListRes.json();

    if (!mailList.messages || mailList.messages.length === 0) {
      return new Response("NO NEW EMAILS");
    }

    let processed = [];

    // --- STEP 3: PROCESS EACH EMAIL ---
    for (const mail of mailList.messages) {
      const mailRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${mail.id}?format=full`,
        { headers: { Authorization: `Bearer ${access_token}` } }
      );

      const mailData = await mailRes.json();
      const raw = mailData.payload.parts?.[0]?.body?.data || mailData.payload.body?.data;
      if (!raw) continue;

      const text = atob(raw);

      // Only process FAMAPP emails
      if (!text.includes("FamApp")) continue;

      // Extract info
      const amount = text.match(/₹(\d+(\.\d+)?)/)?.[1];
      const utr = text.match(/FMPIB\d+/)?.[0];
      const sender = text.match(/from\s([A-Za-z]+)/)?.[1];

      if (!amount || !utr) continue;

      const payment = { amount, utr, sender };
      processed.push(payment);

      // Send to your BOT
      await fetch(env.BOT_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payment)
      });

      // Mark email as READ
      await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${mail.id}/modify`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${access_token}` },
          body: JSON.stringify({ removeLabelIds: ["UNREAD"] })
        }
      );
    }

    return new Response(JSON.stringify({ status: "OK", processed }), {
      headers: { "Content-Type": "application/json" }
    });
  }
};
