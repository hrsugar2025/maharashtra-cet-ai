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
      amount,
      purpose,
      customerPhone,
      customerName,
      customerEmail,
      udf1,
      udf2,
      udf3,
      udf4,
      udf5
    } = req.body || {};

    // Determine credentials & environment (request body overrides env vars)
    const clientKey = (merchantKey || key || appId || process.env.EASEBUZZ_KEY || process.env.EASEBUZZ_MERCHANT_KEY || '').trim();
    const clientSalt = (salt || secretKey || process.env.EASEBUZZ_SALT || '').trim();
    const rawEnv = (env || process.env.EASEBUZZ_ENV || 'sandbox').toString().toLowerCase().trim();
    const isProduction = rawEnv === 'production' || rawEnv === 'live' || rawEnv === 'prod';
    const environment = isProduction ? 'production' : 'sandbox';

    if (!clientKey || !clientSalt) {
      return res.status(400).json({
        success: false,
        message: 'Easebuzz Merchant Key and Salt are required. Please configure them in Payment Gateway Settings.'
      });
    }

    const payBaseUrl = isProduction ? 'https://pay.easebuzz.in' : 'https://testpay.easebuzz.in';
    const retrieveBaseUrls = isProduction
      ? ['https://dashboard.easebuzz.in', 'https://pay.easebuzz.in']
      : ['https://testpay.easebuzz.in', 'https://testdashboard.easebuzz.in'];

    // Helper: calculate SHA-512
    const sha512 = (str) => crypto.createHash('sha512').update(str).digest('hex');

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

    // ──────────────── ACTION: CHECK STATUS / RETRIEVE ────────────────
    if (action === 'check_status') {
      const queryTxnId = (txnid || linkId || '').toString().trim();
      if (!queryTxnId) {
        return res.status(400).json({ success: false, message: 'Transaction ID (txnid/linkId) is required to check payment status.' });
      }

      // Hash sequence for Easebuzz Transaction v2 retrieve:
      // sha512(key|txnid|salt)
      const retrieveHash = sha512(`${clientKey}|${queryTxnId}|${clientSalt}`);

      const retrieveParams = new URLSearchParams({
        key: clientKey,
        txnid: queryTxnId,
        hash: retrieveHash
      });

      let responseData = null;
      let lastError = null;

      // Try retrieve endpoints (dashboard and pay)
      for (const baseUrl of retrieveBaseUrls) {
        try {
          const resObj = await fetch(`${baseUrl}/transaction/v2/retrieve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: retrieveParams.toString()
          });

          if (resObj.ok) {
            responseData = await resObj.json();
            if (responseData && (responseData.status === true || responseData.status === 1 || responseData.data)) {
              break;
            }
          }
        } catch (err) {
          lastError = err;
        }
      }

      if (!responseData) {
        return res.status(400).json({
          success: false,
          message: lastError ? ('Failed to retrieve transaction: ' + lastError.message) : 'No response from Easebuzz for this transaction.',
          linkStatus: 'PENDING',
          isPaid: false
        });
      }

      const txnData = responseData.data || {};
      const txnStatus = (txnData.status || (responseData.status === true ? 'success' : 'pending')).toString().toLowerCase();
      const isPaid = txnStatus === 'success';

      const amountPaid = parseFloat(txnData.net_amount_debit || txnData.amount || amount || 0);

      return res.status(200).json({
        success: true,
        linkId: queryTxnId,
        txnid: queryTxnId,
        linkStatus: isPaid ? 'PAID' : txnStatus.toUpperCase(),
        isPaid: isPaid,
        amount: parseFloat(txnData.amount || amount || 0),
        amountPaid: amountPaid,
        easepayid: txnData.easepayid || '',
        orderId: txnData.easepayid || queryTxnId,
        bankRefNum: txnData.bank_ref_num || '',
        paymentMode: txnData.mode || 'Easebuzz Online',
        updatedAt: txnData.addedon || new Date().toISOString()
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
