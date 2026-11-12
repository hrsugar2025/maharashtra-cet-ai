// Easebuzz Payment Gateway Test Connection Endpoint
// Path: /api/payments/easebuzz/test

import crypto from 'crypto';

export default async function handler(req, res) {
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
    const { merchantKey, key, appId, salt, secretKey, env } = req.body || {};

    const clientKey = (merchantKey || key || appId || process.env.EASEBUZZ_MERCHANT_KEY || process.env.EASEBUZZ_KEY || 'FRHPPBX6RF').trim();
    const clientSalt = (salt || secretKey || process.env.EASEBUZZ_SALT || '45UDY802LV').trim();
    const rawEnv = (env || process.env.EASEBUZZ_ENV || 'production').toString().toLowerCase().trim();
    const isProduction = rawEnv === 'production' || rawEnv === 'live' || rawEnv === 'prod';
    const environment = isProduction ? 'production' : 'sandbox';

    if (!clientKey || !clientSalt) {
      return res.status(400).json({
        success: false,
        message: 'Easebuzz Merchant Key and Salt are required.'
      });
    }

    const payBaseUrl = isProduction ? 'https://pay.easebuzz.in' : 'https://testpay.easebuzz.in';
    const sha512 = (str) => crypto.createHash('sha512').update(str).digest('hex').toLowerCase();

    const testTxnId = ('TEST_' + Date.now()).substring(0, 30);
    const testAmount = '1.00';
    const testProduct = 'Test Connection';
    const testName = 'Test User';
    const testEmail = 'mvmghostel@gmail.com';
    const testPhone = '9999999999';

    // SHA-512 Hash Formula (Strict Order — 16 pipes total):
    // key|txnid|amount|productinfo|firstname|email|udf1|udf2|udf3|udf4|udf5||||||salt
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

    const appUrl = (process.env.NEXT_PUBLIC_APP_URL || 'https://amg-girls-hostel.vercel.app').replace(/\/$/, '');

    const formParams = new URLSearchParams({
      key: clientKey,
      txnid: testTxnId,
      amount: testAmount,
      productinfo: testProduct,
      firstname: testName,
      phone: testPhone,
      email: testEmail,
      surl: `${appUrl}/api/payments/easebuzz/callback`,
      furl: `${appUrl}/api/payments/easebuzz/callback`,
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
