// Cashfree Payment Gateway Serverless API Handler
// Supports Sandbox (Test) and Production (Live) environments

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed. Use POST.' });
  }

  try {
    const { action, appId, secretKey, env, linkId, amount, purpose, customerPhone, customerName, customerEmail } = req.body || {};

    // Determine credentials & environment (priority: request body overrides env vars)
    const clientAppId = appId || process.env.CASHFREE_APP_ID || '';
    const clientSecret = secretKey || process.env.CASHFREE_SECRET_KEY || '';
    const environment = (env || process.env.CASHFREE_ENV || 'sandbox').toLowerCase();

    if (!clientAppId || !clientSecret) {
      return res.status(400).json({
        success: false,
        message: 'Cashfree App ID and Secret Key are required. Please configure them in Payment Gateway Settings.'
      });
    }

    const baseUrl = environment === 'production'
      ? 'https://api.cashfree.com/pg'
      : 'https://sandbox.cashfree.com/pg';

    const headers = {
      'Content-Type': 'application/json',
      'x-client-id': clientAppId.trim(),
      'x-client-secret': clientSecret.trim(),
      'x-api-version': '2023-08-01'
    };

    // ──────────────── ACTION: TEST CONNECTION ────────────────
    if (action === 'test_connection') {
      // Test credentials with a lightweight status check or sandbox request
      try {
        const testRes = await fetch(`${baseUrl}/links`, {
          method: 'GET',
          headers: headers
        });
        const testData = await testRes.json();
        if (testRes.status === 401 || testRes.status === 403) {
          return res.status(400).json({
            success: false,
            message: 'Authentication failed. Please verify your Cashfree App ID and Secret Key.'
          });
        }
        return res.status(200).json({
          success: true,
          message: `Successfully connected to Cashfree ${environment.toUpperCase()} environment!`,
          env: environment
        });
      } catch (err) {
        return res.status(500).json({
          success: false,
          message: 'Connection failed: ' + err.message
        });
      }
    }

    // ──────────────── ACTION: CREATE PAYMENT LINK ────────────────
    if (action === 'create_link') {
      const linkAmt = parseFloat(amount);
      if (!linkAmt || linkAmt <= 0) {
        return res.status(400).json({ success: false, message: 'Invalid payment amount.' });
      }

      // Sanitize phone number (remove non-digits, ensure 10 digits for Indian standard)
      let phone = (customerPhone || '').replace(/\D/g, '');
      if (phone.length > 10) {
        phone = phone.slice(-10);
      }
      if (phone.length !== 10) {
        phone = '9999999999'; // fallback safe placeholder for payment link generation
      }

      const generatedLinkId = (linkId || ('AMG_' + Date.now() + '_' + Math.floor(100 + Math.random() * 900))).replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 45);

      const payload = {
        link_id: generatedLinkId,
        link_amount: Math.round(linkAmt * 100) / 100,
        link_currency: 'INR',
        link_purpose: (purpose || 'AMG Hostel Fee').substring(0, 100),
        customer_details: {
          customer_phone: phone,
          customer_name: (customerName || 'Hostel Student').substring(0, 50),
          customer_email: (customerEmail && customerEmail.includes('@')) ? customerEmail.trim() : 'student@amghostel.com'
        },
        link_notify: {
          send_sms: false,
          send_email: false
        },
        link_auto_reminders: false
      };

      const response = await fetch(`${baseUrl}/links`, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(payload)
      });

      const responseData = await response.json();

      if (!response.ok) {
        return res.status(response.status).json({
          success: false,
          message: responseData.message || responseData.description || 'Failed to generate payment link from Cashfree.',
          details: responseData
        });
      }

      return res.status(200).json({
        success: true,
        linkId: responseData.link_id,
        linkUrl: responseData.link_url,
        linkQrCode: responseData.link_qrcode,
        linkStatus: responseData.link_status,
        amount: responseData.link_amount,
        currency: responseData.link_currency,
        createdAt: responseData.link_created_at
      });
    }

    // ──────────────── ACTION: CHECK STATUS ────────────────
    if (action === 'check_status') {
      if (!linkId) {
        return res.status(400).json({ success: false, message: 'linkId is required to check payment status.' });
      }

      const response = await fetch(`${baseUrl}/links/${encodeURIComponent(linkId)}`, {
        method: 'GET',
        headers: headers
      });

      const responseData = await response.json();

      if (!response.ok) {
        return res.status(response.status).json({
          success: false,
          message: responseData.message || 'Failed to fetch status from Cashfree.',
          details: responseData
        });
      }

      // link_status can be: 'ACTIVE', 'PAID', 'CANCELLED', 'EXPIRED', 'TERMINATED'
      const isPaid = responseData.link_status === 'PAID';

      return res.status(200).json({
        success: true,
        linkId: responseData.link_id,
        linkStatus: responseData.link_status,
        isPaid: isPaid,
        amount: responseData.link_amount,
        amountPaid: responseData.link_amount_paid || (isPaid ? responseData.link_amount : 0),
        linkUrl: responseData.link_url,
        linkQrCode: responseData.link_qrcode,
        orderId: responseData.order_id || '',
        updatedAt: responseData.link_updated_at || responseData.link_created_at
      });
    }

    return res.status(400).json({ success: false, message: 'Invalid action specified.' });

  } catch (error) {
    console.error('Cashfree API Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error: ' + error.message
    });
  }
}
