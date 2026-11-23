// Easebuzz Backend Payment Initiation Endpoint
// Path: /api/payments/easebuzz/initiate

import crypto from 'crypto';

// Supabase REST client configuration for resolving student full name
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://bhfiyrorfxvabquxmeiv.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.NEXT_PUBLIC_SUPABASE_KEY || 'sb_publishable_woMsdVpSPa7mKfHOeGGK8Q_paTZlW3K';

async function supabaseFetch(endpoint, options = {}) {
  const url = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${endpoint}`;
  const headers = {
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  try {
    const res = await fetch(url, { ...options, headers });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    return { ok: false, status: 500, error: err.message };
  }
}

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
    const {
      merchantKey,
      key,
      appId,
      salt,
      secretKey,
      env,
      txnid,
      linkId,
      studentId,
      student_id,
      feeId,
      fee_id,
      academicYear,
      academic_year,
      amount,
      productinfo,
      purpose,
      firstname,
      customerName,
      studentName,
      phone,
      customerPhone,
      email,
      customerEmail,
      udf1,
      udf2,
      udf3,
      udf4,
      udf5
    } = req.body || {};

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

    // Unique transaction ID: TXN_${Date.now()}_${studentId} or passed txnid/linkId
    const sId = (studentId || student_id || udf1 || 'STD').toString().replace(/[^a-zA-Z0-9]/g, '');
    const generatedTxnId = (txnid || linkId || `TXN_${Date.now()}_${sId}`)
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .substring(0, 36);

    // Amount: String formatted to 2 decimals (e.g. "50000.00")
    const numAmt = parseFloat(amount);
    if (isNaN(numAmt) || numAmt <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid payment amount.' });
    }
    const formattedAmount = numAmt.toFixed(2);

    // productinfo: Fee head / description (alphanumeric & spaces only)
    const rawProductInfo = (productinfo || purpose || 'Hostel Fee').toString();
    const sanitizedProductInfo = rawProductInfo
      .replace(/[^a-zA-Z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 80) || 'Hostel Fee';

    // Customer / Student Full Name:
    // Easebuzz payment gateway uses the mandatory 'firstname' parameter to display the Customer Name in the Merchant Gateway Dashboard reports.
    // We sanitize alphanumeric characters and spaces without truncating or splitting the student's full name.
    let rawName = (firstname || customerName || studentName || '').toString().trim();

    // If name is missing, generic ('Student'), or only a single word, attempt to fetch the student's full registered name from Supabase
    if ((!rawName || !rawName.includes(' ') || rawName.toLowerCase() === 'student') && (studentId || student_id || feeId || fee_id || udf1 || udf2)) {
      try {
        const sLookupId = (studentId || student_id || udf1 || '').toString().trim();
        const fLookupId = (feeId || fee_id || udf2 || '').toString().trim();

        if (sLookupId) {
          const sRes = await supabaseFetch(`students?app_id=eq.${encodeURIComponent(sLookupId)}&select=full_name`);
          if (sRes.ok && Array.isArray(sRes.data) && sRes.data.length > 0 && sRes.data[0].full_name) {
            rawName = sRes.data[0].full_name;
          }
        }

        if ((!rawName || !rawName.includes(' ')) && fLookupId) {
          const lRes = await supabaseFetch(`student_fee_ledger?ledger_id=eq.${encodeURIComponent(fLookupId)}&select=student_name`);
          if (lRes.ok && Array.isArray(lRes.data) && lRes.data.length > 0 && lRes.data[0].student_name) {
            rawName = lRes.data[0].student_name;
          }
        }
      } catch (err) {
        console.warn('Fallback student full name lookup warning:', err.message);
      }
    }

    if (!rawName) rawName = 'Hostel Student';

    // Easebuzz allows alphanumeric characters and spaces in firstname (up to 50 chars)
    const studentFullName = rawName
      .replace(/[^a-zA-Z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 50) || 'Hostel Student';

    // phone: 10-digit mobile number
    let cleanPhone = (phone || customerPhone || '').toString().replace(/\D/g, '');
    if (cleanPhone.length > 10) cleanPhone = cleanPhone.slice(-10);
    if (cleanPhone.length !== 10) cleanPhone = '9999999999';

    // email: Student email (fallback: mvmghostel@gmail.com)
    const rawEmail = (email || customerEmail || '').toString().trim();
    const sanitizedEmail = (rawEmail && rawEmail.includes('@')) ? rawEmail : 'mvmghostel@gmail.com';

    // App URL for callback
    const appUrl = (process.env.NEXT_PUBLIC_APP_URL || 'https://amg-girls-hostel.vercel.app').replace(/\/$/, '');
    const callbackUrl = `${appUrl}/api/payments/easebuzz/callback`;

    // UDFs: udf1: student_id, udf2: fee_id, udf3: academic_year, udf4: "", udf5: ""
    const finalUdf1 = (udf1 || studentId || student_id || '').toString().substring(0, 50);
    const finalUdf2 = (udf2 || feeId || fee_id || '').toString().substring(0, 50);
    const finalUdf3 = (udf3 || academicYear || academic_year || '2026-27').toString().substring(0, 50);
    const finalUdf4 = (udf4 || '').toString().substring(0, 50);
    const finalUdf5 = (udf5 || '').toString().substring(0, 50);

    // SHA-512 Hash Formula (Strict Order — 16 pipes total):
    // key|txnid|amount|productinfo|firstname|email|udf1|udf2|udf3|udf4|udf5||||||salt
    const hashSequence = [
      clientKey,
      generatedTxnId,
      formattedAmount,
      sanitizedProductInfo,
      studentFullName,
      sanitizedEmail,
      finalUdf1,
      finalUdf2,
      finalUdf3,
      finalUdf4,
      finalUdf5,
      '', '', '', '', '',
      clientSalt
    ].join('|');

    const requestHash = sha512(hashSequence);

    const formParams = new URLSearchParams({
      key: clientKey,
      txnid: generatedTxnId,
      amount: formattedAmount,
      productinfo: sanitizedProductInfo,
      firstname: studentFullName,
      phone: cleanPhone,
      email: sanitizedEmail,
      surl: callbackUrl,
      furl: callbackUrl,
      hash: requestHash,
      udf1: finalUdf1,
      udf2: finalUdf2,
      udf3: finalUdf3,
      udf4: finalUdf4,
      udf5: finalUdf5,
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
      data: accessKey,
      accessKey: accessKey,
      paymentUrl: paymentUrl,
      linkUrl: paymentUrl,
      linkQrCode: qrCodeUrl,
      txnid: generatedTxnId,
      linkId: generatedTxnId,
      amount: parseFloat(formattedAmount),
      currency: 'INR',
      status: 1
    });

  } catch (error) {
    console.error('Easebuzz Initiate Payment Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error: ' + error.message
    });
  }
}
