// Vercel API route to cancel Sneha's partial accommodation charge
// This endpoint forwards a request to the existing Apps Script web‑app
// which performs the actual ledger and receipt updates.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }

  try {
    // Apps Script Web App URL (replace with your deployed URL if different)
    const scriptUrl = 'https://script.google.com/macros/s/AKfycbxYOUR_SCRIPT_ID/exec';

    // Payload expected by the Apps Script function cancelSnehaPartialAccommodation
    const payload = {
      action: 'cancelSnehaPartialAccommodation',
      // The appId for Sneha (found in the sheet)
      appId: 'APP-2026-4001',
      amount: 1000
    };

    const response = await fetch(scriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (data.success) {
      return res.status(200).json({ success: true, message: 'Accommodation charge cancelled successfully.' });
    } else {
      return res.status(400).json({ success: false, message: data.message || 'Cancellation failed.' });
    }
  } catch (e) {
    console.error('Error in cancelSneha API:', e);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
}
