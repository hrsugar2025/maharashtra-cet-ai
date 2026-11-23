// Easebuzz Payment Gateway Serverless API Handler
// Supports Sandbox (Test) and Production (Live) environments

import crypto from 'crypto';

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
    const {
      action,
      merchantKey,
      key,
      appId,
      salt,
      secretKey,
      env,
      linkId,
      txnid,
      easepayid,
      amount,
      purpose,
      customerPhone,
      customerName,
      customerEmail,
      merchantEmail,
      udf1,
      udf2,
      udf3,
      udf4,
      udf5
    } = req.body || {};

    // Determine credentials & environment (request body overrides env vars)
    const clientKey = (merchantKey || key || appId || process.env.EASEBUZZ_KEY || process.env.EASEBUZZ_MERCHANT_KEY || 'FRHPPBX6RF').trim();
    const clientSalt = (salt || secretKey || process.env.EASEBUZZ_SALT || '45UDY802LV').trim();
    const rawEnv = (env || process.env.EASEBUZZ_ENV || 'production').toString().toLowerCase().trim();
    const isProduction = rawEnv === 'production' || rawEnv === 'live' || rawEnv === 'prod';
    const environment = isProduction ? 'production' : 'sandbox';

    if (!clientKey || !clientSalt) {
      return res.status(400).json({
        success: false,
        message: 'Easebuzz Merchant Key and Salt are required. Please configure them in Payment Gateway Settings.'
      });
    }

    const payBaseUrl = isProduction ? 'https://pay.easebuzz.in' : 'https://testpay.easebuzz.in';
    const dashboardBaseUrl = isProduction ? 'https://dashboard.easebuzz.in' : 'https://testdashboard.easebuzz.in';

    // Helper: calculate SHA-512
    const sha512 = (str) => crypto.createHash('sha512').update(str).digest('hex').toLowerCase();

    // ──────────────── ACTION: TEST CONNECTION ────────────────
    if (action === 'test_connection') {
      try {
        const testTxnId = ('TEST_' + Date.now()).substring(0, 30);
        const testAmount = '1.00';
        const testProduct = 'Test Connection';
        const testName = 'Test User';
        const testEmail = 'test@amghostel.com';
        const testPhone = '9999999999';

        // Hash sequence for initiateLink:
        // sha512(key|txnid|amount|productinfo|firstname|email|udf1|udf2|udf3|udf4|udf5|udf6|udf7|udf8|udf9|udf10|salt)
        const hashSequence = [
          clientKey,
          testTxnId,
          testAmount,
          testProduct,
          testName,
          testEmail,
          '', '', '', '', '', '', '', '', '', '',
          clientSalt
        ].join('|');

        const testHash = sha512(hashSequence);

        const formParams = new URLSearchParams({
          key: clientKey,
          txnid: testTxnId,
          amount: testAmount,
          productinfo: testProduct,
          firstname: testName,
          phone: testPhone,
          email: testEmail,
          surl: 'https://amg-girls-hostel.vercel.app/',
          furl: 'https://amg-girls-hostel.vercel.app/',
          hash: testHash,
          udf1: '',
          udf2: '',
          udf3: '',
          udf4: '',
          udf5: '',
          udf6: '',
          udf7: '',
          udf8: '',
          udf9: '',
          udf10: ''
        });

        const testRes = await fetch(`${payBaseUrl}/payment/initiateLink`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: formParams.toString()
        });

        const testData = await testRes.json();

        if (testData.status === 1) {
          return res.status(200).json({
            success: true,
            message: `Successfully connected to Easebuzz ${environment.toUpperCase()} gateway! Credentials verified.`,
            env: environment
          });
        }

        // If status is 0, check error details
        const errMsg = testData.data || testData.error_desc || JSON.stringify(testData);
        const isAuthError = /invalid|unauthorized|hash mismatch|inactive|key|salt/i.test(errMsg);

        return res.status(400).json({
          success: false,
          message: isAuthError
            ? `Easebuzz authentication failed: ${errMsg}. Please verify your Merchant Key and Salt.`
            : `Easebuzz returned: ${errMsg}`,
          details: testData
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

      // Format amount strictly with 2 decimals
      const formattedAmount = Number(linkAmt).toFixed(2);

      // Sanitize phone number (last 10 digits)
      let phone = (customerPhone || '').replace(/\D/g, '');
      if (phone.length > 10) phone = phone.slice(-10);
      if (phone.length !== 10) phone = '9999999999';

      // Sanitize customer name (alphanumeric & spaces, max 50 chars)
      const sanitizedName = (customerName || 'Hostel Student')
        .replace(/[^a-zA-Z0-9\s]/g, '')
        .trim()
        .substring(0, 50) || 'Student';

      // Sanitize customer email
      const email = (customerEmail && customerEmail.includes('@'))
        ? customerEmail.trim()
        : 'student@amghostel.com';

      // Product info / purpose
      const productInfo = (purpose || 'Hostel Fee')
        .replace(/[^a-zA-Z0-9\s_-]/g, ' ')
        .trim()
        .substring(0, 80) || 'Hostel Fee';

      // Generate unique transaction ID (max 40 chars)
      const generatedTxnId = (txnid || linkId || ('EB_' + Date.now().toString().slice(-8) + '_' + Math.floor(100 + Math.random() * 900)))
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .substring(0, 36);

      const u1 = (udf1 || '').toString().substring(0, 50);
      const u2 = (udf2 || '').toString().substring(0, 50);
      const u3 = (udf3 || '').toString().substring(0, 50);
      const u4 = (udf4 || '').toString().substring(0, 50);
      const u5 = (udf5 || '').toString().substring(0, 50);

      // Hash sequence for initiateLink:
      // sha512(key|txnid|amount|productinfo|firstname|email|udf1|udf2|udf3|udf4|udf5|udf6|udf7|udf8|udf9|udf10|salt)
      const hashSequence = [
        clientKey,
        generatedTxnId,
        formattedAmount,
        productInfo,
        sanitizedName,
        email,
        u1, u2, u3, u4, u5, '', '', '', '', '',
        clientSalt
      ].join('|');

      const requestHash = sha512(hashSequence);

      const callbackUrl = 'https://amg-girls-hostel.vercel.app/';

      const formParams = new URLSearchParams({
        key: clientKey,
        txnid: generatedTxnId,
        amount: formattedAmount,
        productinfo: productInfo,
        firstname: sanitizedName,
        phone: phone,
        email: email,
        surl: callbackUrl,
        furl: callbackUrl,
        hash: requestHash,
        udf1: u1,
        udf2: u2,
        udf3: u3,
        udf4: u4,
        udf5: u5,
        udf6: '',
        udf7: '',
        udf8: '',
        udf9: '',
        udf10: ''
      });

      const response = await fetch(`${payBaseUrl}/payment/initiateLink`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formParams.toString()
      });

      const responseData = await response.json();

      if (responseData.status !== 1) {
        return res.status(400).json({
          success: false,
          message: responseData.data || responseData.error_desc || 'Failed to generate payment link from Easebuzz.',
          details: responseData
        });
      }

      const accessKey = responseData.data;
      const paymentUrl = `${payBaseUrl}/pay/${accessKey}`;
      const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(paymentUrl)}`;

      return res.status(200).json({
        success: true,
        linkId: generatedTxnId,
        txnid: generatedTxnId,
        accessKey: accessKey,
        linkUrl: paymentUrl,
        linkQrCode: qrCodeUrl,
        linkStatus: 'PENDING',
        amount: parseFloat(formattedAmount),
        currency: 'INR',
        createdAt: new Date().toISOString()
      });
    }

    // ──────────────── ACTION: CHECK STATUS / VERIFY PAYMENT ────────────────
    if (action === 'check_status' || action === 'verify_payment') {
      // Accept txnid (merchant internal ID like TXN_...) or easepayid (Easebuzz-generated like E2611...)
      const queryInput = (txnid || linkId || easepayid || '').toString().trim();
      const expectedAmount = amount !== undefined && amount !== null && amount !== '' ? parseFloat(amount) : null;

      if (!queryInput) {
        return res.status(400).json({
          success: false,
          isPaid: false,
          linkStatus: 'FAILED',
          message: 'Transaction ID (txnid or Easebuzz easepayid) is required to verify Easebuzz payment status.'
        });
      }

      // Detect if the input looks like an easepayid (Easebuzz-generated IDs start with 'E' followed by digits/letters)
      // Merchant txnids typically look like TXN_..., APP_..., EB_... etc.
      const looksLikeEasepayid = /^E\d{4,}/i.test(queryInput);

      let responseData = null;
      let lastError = null;
      let rawPayload = null;

      // Helper: single retrieve by merchant txnid
      const retrieveByTxnid = async (tid) => {
        const h = sha512(`${clientKey}|${tid}|${clientSalt}`);
        const params = new URLSearchParams({ key: clientKey, txnid: tid, hash: h });
        const res = await fetch(`${dashboardBaseUrl}/transaction/v2/retrieve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params.toString()
        });
        if (!res.ok) return null;
        const json = await res.json();
        if (json && (json.status === true || json.status === 1)) {
          return (typeof json.msg === 'object' && json.msg !== null) ? json.msg
               : (typeof json.data === 'object' && json.data !== null) ? json.data
               : null;
        }
        return null;
      };

      // Helper: search by date range (tries up to 3 days back to catch timezone differences)
      const searchByDate = async (q) => {
        const pad = (n) => String(n).padStart(2, '0');
        for (let daysBack = 0; daysBack <= 2; daysBack++) {
          try {
            const d = new Date();
            d.setDate(d.getDate() - daysBack);
            const dateStr = `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;

            // Easebuzz Transaction Date API: hash = sha512(key|merchant_email|date|date|salt)
            // The merchant_email field can be empty string if unknown — use '' as fallback
            const mEmail = (merchantEmail || customerEmail || '').trim();
            const dateHashStr = `${clientKey}|${mEmail}|${dateStr}|${dateStr}|${clientSalt}`;
            const dateHash = sha512(dateHashStr);

            // Try both the v2/retrieve/date endpoint and the v1/date endpoint
            const endpoints = [
              `${dashboardBaseUrl}/transaction/v2/retrieve/date`,
              `${payBaseUrl}/transaction/v1/date`
            ];

            for (const endpoint of endpoints) {
              try {
                const dateRes = await fetch(endpoint, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    key: clientKey,
                    merchant_email: mEmail,
                    hash: dateHash,
                    start_date: dateStr,
                    end_date: dateStr,
                    date_range: { start_date: dateStr, end_date: dateStr }
                  })
                });
                if (!dateRes.ok) continue;
                const dateData = await dateRes.json();
                const rows = Array.isArray(dateData) ? dateData
                           : Array.isArray(dateData.data) ? dateData.data
                           : Array.isArray(dateData.msg) ? dateData.msg
                           : null;
                if (rows && rows.length > 0) {
                  const ql = q.toLowerCase().trim();
                  const found = rows.find((t) =>
                    (t.txnid && t.txnid.toLowerCase() === ql) ||
                    (t.easepayid && t.easepayid.toLowerCase() === ql)
                  );
                  if (found) return found;
                }
              } catch (_) {}
            }
          } catch (_) {}
        }
        return null;
      };

      // ── Strategy ──────────────────────────────────────────────────────────
      // If input looks like an easepayid (E26...) → go straight to date search
      // If input looks like a merchant txnid (TXN_...) → try single retrieve first, then date search
      // ─────────────────────────────────────────────────────────────────────

      if (!looksLikeEasepayid) {
        // 1a. Try direct single retrieve by txnid
        try {
          rawPayload = await retrieveByTxnid(queryInput);
        } catch (err) {
          lastError = err;
        }
      }

      // 2. Date-based search (runs if txnid retrieve missed, OR if input is an easepayid)
      if (!rawPayload) {
        try {
          const found = await searchByDate(queryInput);
          if (found) {
            rawPayload = found;
            // If found by easepayid, do a full single retrieve using the merchant txnid for all fields
            if (found.txnid && found.txnid.toLowerCase() !== queryInput.toLowerCase()) {
              try {
                const full = await retrieveByTxnid(found.txnid);
                if (full) rawPayload = full;
              } catch (_) {}
            }
          }
        } catch (dateErr) {
          console.warn('Date fallback search error:', dateErr);
        }
      }

      // Ensure data payload is an object (handles array wrapper if any)
      const txnData = Array.isArray(rawPayload) ? rawPayload[0] : rawPayload;

      if (!txnData) {
        const errorDesc = (responseData && typeof responseData.msg === 'string' ? responseData.msg : '')
          || (responseData && typeof responseData.data === 'string' ? responseData.data : '')
          || (responseData && responseData.error_desc ? responseData.error_desc : '')
          || (responseData && typeof responseData.error === 'string' ? responseData.error : '')
          || (lastError ? ('Network error: ' + lastError.message) : 'Transaction record not found in Easebuzz.');

        const isEasepayId = looksLikeEasepayid;
        const hint = isEasepayId
          ? ` (Searched by Easebuzz ID: ${queryInput}. Ensure this transaction belongs to your merchant account and occurred today or in the last 2 days.)`
          : '';
        return res.status(200).json({
          success: false,
          isPaid: false,
          linkStatus: 'NOT_FOUND',
          message: `Easebuzz transaction record not found: ${errorDesc}.${hint} Payment has not been collected.`,
          details: responseData
        });
      }

      // Strictly verify status is 'success' (case-insensitive)
      const rawTxnStatus = (txnData.status || '').toString().trim().toLowerCase();
      const isPaid = (rawTxnStatus === 'success');
      const settledAmount = parseFloat(txnData.net_amount_debit || txnData.total_debit_amount || txnData.amount || 0);

      if (!isPaid) {
        const statusMap = {
          'usercancelled': 'User Cancelled',
          'pending': 'Pending',
          'initiated': 'Initiated / Not Completed',
          'failed': 'Failed',
          'dropped': 'Dropped',
          'bounced': 'Bounced'
        };
        const friendlyStatus = statusMap[rawTxnStatus] || (rawTxnStatus ? rawTxnStatus.toUpperCase() : 'UNCONFIRMED');
        return res.status(200).json({
          success: false,
          isPaid: false,
          linkStatus: friendlyStatus.toUpperCase(),
          txnid: txnData.txnid || queryTxnId,
          easepayid: txnData.easepayid || '',
          amount: parseFloat(txnData.amount || txnData.total_debit_amount || 0),
          amountPaid: settledAmount,
          message: `Payment status in Easebuzz is "${friendlyStatus}". Funds are NOT credited/collected. Receipt cannot be generated.`,
          details: txnData
        });
      }

      // Amount verification: settled amount must match receipt amount if specified
      if (expectedAmount !== null && !isNaN(expectedAmount) && expectedAmount > 0) {
        if (Math.abs(settledAmount - expectedAmount) > 0.01 && settledAmount < expectedAmount) {
          return res.status(200).json({
            success: false,
            isPaid: false,
            linkStatus: 'AMOUNT_MISMATCH',
            txnid: txnData.txnid || queryTxnId,
            easepayid: txnData.easepayid || '',
            amountExpected: expectedAmount,
            amountPaid: settledAmount,
            message: `Amount mismatch in Easebuzz! Expected ₹${expectedAmount.toFixed(2)}, but Easebuzz collected ₹${settledAmount.toFixed(2)}. Receipt cannot be generated.`,
            details: txnData
          });
        }
      }

      const verifiedTime = new Date().toISOString();
      return res.status(200).json({
        success: true,
        isPaid: true,
        linkStatus: 'PAID',
        linkId: queryTxnId,
        txnid: txnData.txnid || queryTxnId,
        easepayid: txnData.easepayid || '',
        orderId: txnData.easepayid || queryTxnId,
        amount: parseFloat(txnData.amount || txnData.total_debit_amount || settledAmount),
        amountPaid: settledAmount,
        bankRefNum: txnData.bank_ref_num || '',
        paymentMode: txnData.mode || 'Easebuzz Online',
        upiVa: txnData.upi_va || '',
        updatedAt: txnData.addedon || verifiedTime,
        verifiedAt: verifiedTime,
        verificationSource: 'Easebuzz Transaction v2 API',
        message: 'Payment confirmed and verified in Easebuzz.'
      });
    }

    return res.status(400).json({ success: false, message: 'Invalid action specified.' });

  } catch (error) {
    console.error('Easebuzz API Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error: ' + error.message
    });
  }
}
