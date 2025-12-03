export default {
  async fetch(request, env) {
    // --- 1. SECURITY & METHOD CHECK ---
    // Webhooks should only accept POST requests
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }
    
    // NOTE: For better security, you should verify the source (e.g., check for a Google signature)
    // but for now, we trust the connection established by the users.watch command.

    let mailId;

    try {
      const body = await request.json();
      
      // The Pub/Sub message data is nested and Base64 encoded
      const pubSubData = body.message.data; 
      
      // Decode the Base64 payload to get the actual Gmail API notification
      const decodedJson = atob(pubSubData);
      const notification = JSON.parse(decodedJson);
      
      // We only care if the user's historyId changed, indicating new mail,
      // but we still need to use a search to confirm it's a payment email.
      // We don't get the message ID directly, so we proceed to search.
      
    } catch (e) {
      console.error("Error decoding webhook payload:", e);
      return new Response("Invalid Webhook Payload", { status: 400 });
    }
    
    // --- AUTH & GET ACCESS TOKEN (Keep this logic) ---
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
    
    // --- 2. SEARCH FOR UNREAD PAYMENT EMAILS (Refined Polling) ---
    // The Pub/Sub notification only tells us *something* happened. 
    // We search the inbox *only* for unread payment emails since the last notification.
    const paymentQuery = 'is:unread from:(FamApp) subject:("Money Transferred" OR "Payment Received")'; 
    
    const mailListRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(paymentQuery)}`,
      { headers: { Authorization: `Bearer ${access_token}` } }
    );

    const mailList = await mailListRes.json();
    
    if (!mailList.messages || mailList.messages.length === 0) {
      // Respond 200 OK even if no payment email is found to avoid Google resending the notification.
      return new Response("Notification received, but no matching payment email found.", { status: 200 });
    }
    
    let processed = [];
    
    // --- 3. PROCESS EACH EMAIL (Same Logic) ---
    for (const mail of mailList.messages) {
      // Existing processing logic remains here...
      const mailRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${mail.id}?format=full`,
        { headers: { Authorization: `Bearer ${access_token}` } }
      );

      const mailData = await mailRes.json();
      const raw = mailData.payload.parts?.[0]?.body?.data || mailData.payload.body?.data;
      if (!raw) continue;

      const text = atob(raw.replace(/-/g, '+').replace(/_/g, '/')); // Handle Base64-URL encoding

      // Only process FAMAPP emails
      if (!text.includes("FamApp")) continue;

      // Extract info (assuming these regex patterns still work for your emails)
      const amount = text.match(/₹(\d+(\.\d+)?)/)?.[1];
      const utr = text.match(/FMPIB\d+/)?.[0];
      const sender = text.match(/from\s([A-Za-z]+)/)?.[1];

      if (!amount || !utr) continue;

      const payment = { amount, utr, sender, messageId: mail.id };
      processed.push(payment);

      // Send to your BOT
      await fetch(env.BOT_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payment)
      });

      // Mark email as READ
      await fetch(
        `https://www.googleapis.com/gmail/v1/users/me/messages/${mail.id}/modify`,
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
