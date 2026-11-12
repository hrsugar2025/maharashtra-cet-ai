// Easebuzz Callback & S2S Webhook Handler
// Handles both POST (from Easebuzz) and GET (browser return)

import crypto from 'crypto';

// Supabase REST client configuration
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://bhfiyrorfxvabquxmeiv.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.NEXT_PUBLIC_SUPABASE_KEY || 'sb_publishable_woMsdVpSPa7mKfHOeGGK8Q_paTZlW3K';

function sha512(str) {
  return crypto.createHash('sha512').update(str).digest('hex').toLowerCase();
}

// Helper for Supabase REST API requests
async function supabaseFetch(endpoint, options = {}) {
  const url = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${endpoint}`;
  const headers = {
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': options.prefer || 'return=representation',
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

// Generate unique receipt ID e.g. RCPT-2026-XXXX
function generateReceiptId(year) {
  const y = (year || new Date().getFullYear()).toString().substring(0, 4);
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `RCPT-${y}-${rand}`;
}

export async function processEasebuzzPayment(body) {
  const clientSalt = (process.env.EASEBUZZ_SALT || '45UDY802LV').trim();
  const clientKey = (process.env.EASEBUZZ_MERCHANT_KEY || process.env.EASEBUZZ_KEY || 'FRHPPBX6RF').trim();

  const {
    txnid = '',
    amount = '',
    productinfo = '',
    firstname = '',
    email = '',
    status = '',
    hash = '',
    key = clientKey,
    easepayid = '',
    mode = 'UPI',
    udf1 = '',
    udf2 = '',
    udf3 = '',
    udf4 = '',
    udf5 = ''
  } = body || {};

  // Verify Reverse SHA-512 Hash Formula:
  // salt|status||||||udf5|udf4|udf3|udf2|udf1|email|firstname|productinfo|amount|txnid|key
  const reverseHashSequence = [
    clientSalt,
    status,
    '', '', '', '', '', '',
    udf5,
    udf4,
    udf3,
    udf2,
    udf1,
    email,
    firstname,
    productinfo,
    amount,
    txnid,
    key
  ].join('|');

  const computedHash = sha512(reverseHashSequence);

  if (!hash || computedHash !== hash.toLowerCase()) {
    console.error('Hash verification failed!', {
      received: hash ? hash.toLowerCase() : null,
      computed: computedHash,
      sequence: reverseHashSequence
    });
    return {
      success: false,
      status: 400,
      message: 'Hash verification failed. Invalid Easebuzz reverse signature.'
    };
  }

  // Idempotent Database Update & WhatsApp Receipt
  // Check if txnid already marked PAID / SUCCESS in fee_receipts
  const checkReceipt = await supabaseFetch(`fee_receipts?transaction_id=eq.${encodeURIComponent(txnid)}&select=*`);
  if (checkReceipt.ok && Array.isArray(checkReceipt.data) && checkReceipt.data.length > 0) {
    // Already processed idempotently
    return {
      success: true,
      alreadyProcessed: true,
      receiptId: checkReceipt.data[0].receipt_id,
      receipt: checkReceipt.data[0],
      message: 'Transaction has already been processed successfully.'
    };
  }

  // Also check if easepayid already recorded
  if (easepayid) {
    const checkEasepay = await supabaseFetch(`fee_receipts?transaction_id=eq.${encodeURIComponent(easepayid)}&select=*`);
    if (checkEasepay.ok && Array.isArray(checkEasepay.data) && checkEasepay.data.length > 0) {
      return {
        success: true,
        alreadyProcessed: true,
        receiptId: checkEasepay.data[0].receipt_id,
        receipt: checkEasepay.data[0],
        message: 'Payment has already been processed successfully.'
      };
    }
  }

  if (status.toLowerCase() === 'success') {
    const paidAmt = parseFloat(amount) || 0;
    const ledgerId = udf1 || udf2 || '';
    const academicYear = udf3 || '2026-27';
    const txnRecordId = easepayid || txnid;
    const paymentMode = `Online (${mode || 'Easebuzz'})`;
    const isoDate = new Date().toISOString().split('T')[0];
    const receiptId = generateReceiptId(academicYear);

    let studentAppId = udf1 || '';
    let studentName = firstname || 'Hostel Student';
    let roomNo = '';
    let headName = productinfo || 'Hostel Fee';
    let month = '';

    // If ledgerId is provided, retrieve & update the student fee ledger
    if (ledgerId) {
      const ledgerRes = await supabaseFetch(`student_fee_ledger?ledger_id=eq.${encodeURIComponent(ledgerId)}&select=*`);
      if (ledgerRes.ok && Array.isArray(ledgerRes.data) && ledgerRes.data.length > 0) {
        const ldg = ledgerRes.data[0];
        studentAppId = ldg.app_id || studentAppId;
        studentName = ldg.student_name || studentName;
        headName = ldg.head_name || headName;
        month = ldg.applicable_month || '';

        const currentPaid = parseFloat(ldg.paid_amount) || 0;
        const applicableAmt = parseFloat(ldg.applicable_amount) || 0;
        const newPaid = currentPaid + paidAmt;
        const newBal = Math.max(0, applicableAmt - newPaid);
        const newStatus = newBal <= 0 ? 'Paid' : 'Partial';

        await supabaseFetch(`student_fee_ledger?ledger_id=eq.${encodeURIComponent(ledgerId)}`, {
          method: 'PATCH',
          body: JSON.stringify({
            paid_amount: newPaid,
            balance: newBal,
            status: newStatus
          })
        });
      }
    }

    // Lookup room number if studentAppId is available
    if (studentAppId) {
      const studentRes = await supabaseFetch(`students?app_id=eq.${encodeURIComponent(studentAppId)}&select=room_number,name`);
      if (studentRes.ok && Array.isArray(studentRes.data) && studentRes.data.length > 0) {
        roomNo = studentRes.data[0].room_number || '';
        if (studentRes.data[0].name) studentName = studentRes.data[0].name;
      }
    }

    // Insert into fee_receipts
    const receiptRow = {
      receipt_id: receiptId,
      receipt_date: isoDate,
      app_id: studentAppId,
      student_name: studentName,
      room_number: roomNo,
      fee_type: headName,
      fee_month: month,
      academic_year: academicYear,
      amount_paid: paidAmt,
      payment_mode: paymentMode,
      transaction_id: txnRecordId,
      remarks: `Paid online via Easebuzz (${txnid}) - EasepayID: ${easepayid}`,
      collected_by: 'Easebuzz Gateway',
      status: 'Active',
      recon_status: 'Unreconciled'
    };

    await supabaseFetch('fee_receipts', {
      method: 'POST',
      body: JSON.stringify([receiptRow])
    });

    return {
      success: true,
      isPaid: true,
      receiptId: receiptId,
      receipt: receiptRow,
      easepayid: easepayid,
      txnid: txnid,
      amount: paidAmt,
      message: 'Payment recorded and verified successfully.'
    };
  }

  return {
    success: false,
    isPaid: false,
    status: status,
    txnid: txnid,
    message: `Payment status was not successful: ${status}`
  };
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

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || 'https://amg-girls-hostel.vercel.app').replace(/\/$/, '');

  try {
    let body = req.body || {};
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        const params = new URLSearchParams(body);
        body = Object.fromEntries(params.entries());
      }
    }

    // If GET request, user redirected back by browser
    if (req.method === 'GET') {
      const queryParams = req.query || {};
      const statusParam = queryParams.status || 'unknown';
      const txnParam = queryParams.txnid || '';
      return res.redirect(302, `${appUrl}/?payment_status=${encodeURIComponent(statusParam)}&txnid=${encodeURIComponent(txnParam)}`);
    }

    const result = await processEasebuzzPayment(body);

    // If request has Accept: text/html or comes from a browser form POST (surl/furl)
    const isBrowserPost = req.headers['content-type']?.includes('application/x-www-form-urlencoded') ||
                          req.headers['accept']?.includes('text/html');

    if (isBrowserPost) {
      const statusParam = body.status || (result.success ? 'success' : 'failure');
      const receiptIdParam = result.receiptId || '';
      const txnParam = body.txnid || '';
      return res.redirect(302, `${appUrl}/?payment_status=${encodeURIComponent(statusParam)}&receipt_id=${encodeURIComponent(receiptIdParam)}&txnid=${encodeURIComponent(txnParam)}`);
    }

    if (!result.success && result.status === 400) {
      return res.status(400).json(result);
    }

    return res.status(200).json(result);
  } catch (err) {
    console.error('Easebuzz Callback Error:', err);
    return res.status(500).json({ success: false, message: 'Internal error: ' + err.message });
  }
}
