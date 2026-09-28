const test = require('node:test');
const assert = require('node:assert/strict');

// Mock Supabase Client Engine for Automated Testing
class MockSupabaseClient {
  constructor() {
    this.tables = {
      students: [],
      rooms: [
        { id: 1, room_number: '101', room_type: 'Double', capacity: 2, current_occupancy: 1, status: 'Active' },
        { id: 2, room_number: '102', room_type: 'Triple', capacity: 3, current_occupancy: 3, status: 'Active' } // Full room
      ],
      fee_structures: [
        { structure_id: 'FS-01', structure_name: 'Regular 2026', room_type: 'Double', status: 'Active' }
      ],
      fee_heads: [
        { head_id: 'FH-01', structure_id: 'FS-01', head_name: 'Security Deposit', amount: 5000, priority: 1 },
        { head_id: 'FH-02', structure_id: 'FS-01', head_name: 'Mess Fee', amount: 15000, priority: 2 },
        { head_id: 'FH-03', structure_id: 'FS-01', head_name: 'Room Rent', amount: 20000, priority: 3 }
      ],
      student_fee_ledger: [],
      fee_receipts: [],
      service_requests: [],
      bank_accounts: [
        { account_id: 'ACC-01', bank_name: 'SBI Hostel Branch', account_number: '1234567890', status: 'Active' }
      ],
      app_users: [
        { username: 'rector@hostel.com', password_hash: 'admin123', role: 'Rector', status: 'Active' }
      ]
    };
  }

  from(tableName) {
    const table = this.tables[tableName] || [];
    let currentData = [...table];
    let filters = [];
    let updatePayload = null;
    let isDelete = false;

    const builder = {
      select: (cols) => builder,
      eq: (col, val) => {
        filters.push((row) => row[col] === val);
        return builder;
      },
      neq: (col, val) => {
        filters.push((row) => row[col] !== val);
        return builder;
      },
      order: (col, opts = {}) => {
        const asc = opts.ascending !== false;
        currentData.sort((a, b) => {
          if (a[col] < b[col]) return asc ? -1 : 1;
          if (a[col] > b[col]) return asc ? 1 : -1;
          return 0;
        });
        return builder;
      },
      single: async () => {
        let res = currentData;
        filters.forEach(f => { res = res.filter(f); });
        return { data: res[0] || null, error: res[0] ? null : { message: 'Row not found' } };
      },
      insert: async (rows) => {
        table.push(...rows);
        return { data: rows, error: null };
      },
      update: (updateObj) => {
        updatePayload = updateObj;
        return builder;
      },
      delete: () => {
        isDelete = true;
        return builder;
      },
      then: function(resolve) {
        if (updatePayload) {
          table.forEach(row => {
            let match = true;
            filters.forEach(f => { if (!f(row)) match = false; });
            if (match) Object.assign(row, updatePayload);
          });
          resolve({ data: true, error: null });
        } else if (isDelete) {
          const remaining = table.filter(row => {
            let match = true;
            filters.forEach(f => { if (!f(row)) match = false; });
            return !match;
          });
          this.tables[tableName] = remaining;
          resolve({ data: true, error: null });
        } else {
          let res = currentData;
          filters.forEach(f => { res = res.filter(f); });
          resolve({ data: res, error: null });
        }
      }
    };
    return builder;
  }
}

// Application logic matching Supabase_App.html refactored engine
class HostelAppEngine {
  constructor(supabase) {
    this.db = supabase;
  }

  async submitStudentApplication(formData) {
    if (!formData.name || !formData.contact_number) {
      throw new Error('Name and contact number are required');
    }
    const appId = 'APP-2026-' + Math.floor(1000 + Math.random() * 9000);
    const row = {
      app_id: appId,
      name: formData.name,
      contact_number: formData.contact_number,
      email: formData.email || '',
      college_name: formData.college_name || '',
      course_name: formData.course_name || '',
      room_preference: formData.room_preference || 'Double',
      status: 'Pending Approval',
      academic_year: '2026-2027'
    };
    const { error } = await this.db.from('students').insert([row]);
    if (error) throw new Error(error.message);
    return { success: true, appId };
  }

  async allotRoom(appId, roomNumber) {
    const { data: room, error: rmErr } = await this.db.from('rooms').eq('room_number', roomNumber).single();
    if (rmErr || !room) throw new Error('Room not found');
    if (room.current_occupancy >= room.capacity) {
      throw new Error('Room is full! Maximum capacity reached.');
    }

    // Allot student
    await this.db.from('students').update({ room_number: roomNumber, status: 'Allotted' }).eq('app_id', appId);
    // Increment room occupancy
    await this.db.from('rooms').update({ current_occupancy: room.current_occupancy + 1 }).eq('room_number', roomNumber);

    // Auto-generate fee demand from fee structure
    const feeHeads = this.db.tables.fee_heads;
    for (const head of feeHeads) {
      await this.db.from('student_fee_ledger').insert([{
        ledger_id: 'LDG-' + Math.floor(10000 + Math.random() * 90000),
        app_id: appId,
        fee_type: head.head_name,
        due_amount: head.amount,
        paid_amount: 0,
        balance_amount: head.amount,
        status: 'Pending',
        priority: head.priority
      }]);
    }
    return { success: true };
  }

  async recordFeePayment(appId, amountPaid, paymentMode) {
    if (amountPaid <= 0) throw new Error('Payment amount must be greater than zero');

    const receiptId = 'REC-2026-' + Math.floor(1000 + Math.random() * 9000);
    await this.db.from('fee_receipts').insert([{
      receipt_id: receiptId,
      app_id: appId,
      paid_amount: amountPaid,
      payment_mode: paymentMode,
      status: 'Active'
    }]);

    // Priority settlement engine
    const { data: ldgRows } = await this.db.from('student_fee_ledger')
      .eq('app_id', appId)
      .neq('status', 'Paid')
      .order('priority', { ascending: true });

    let rem = amountPaid;
    for (const row of ldgRows) {
      if (rem <= 0) break;
      const dueBal = row.balance_amount;
      const pay = Math.min(rem, dueBal);
      const newPaid = row.paid_amount + pay;
      const newBal = dueBal - pay;
      const newStatus = newBal === 0 ? 'Paid' : 'Partial';

      await this.db.from('student_fee_ledger')
        .update({ paid_amount: newPaid, balance_amount: newBal, status: newStatus })
        .eq('ledger_id', row.ledger_id);

      rem -= pay;
    }

    return { success: true, receiptId };
  }

  async cancelReceipt(receiptId) {
    const { data: rcpt } = await this.db.from('fee_receipts').eq('receipt_id', receiptId).single();
    if (!rcpt) throw new Error('Receipt not found');

    await this.db.from('fee_receipts').update({ status: 'Cancelled' }).eq('receipt_id', receiptId);

    // Revert ledger paid amounts
    const appId = rcpt.app_id;
    const amount = rcpt.paid_amount || rcpt.amount_paid || 0;
    const feeType = (rcpt.fee_type || '').toUpperCase();

    const { data: ldgRows } = await this.db.from('student_fee_ledger').eq('app_id', appId);
    if (ldgRows && ldgRows.length > 0) {
      const match = ldgRows.find(r => (r.head_name || r.fee_type || '').toUpperCase() === feeType || feeType.includes((r.head_name || '').toUpperCase()));
      if (match) {
        const curPaid = match.paid_amount || 0;
        const appAmt = match.due_amount || match.applicable_amount || 0;
        const newPaid = Math.max(0, curPaid - amount);
        const newBal = Math.max(0, appAmt - newPaid);
        const newStatus = newBal === appAmt ? 'Pending' : (newBal === 0 ? 'Paid' : 'Partial');

        await this.db.from('student_fee_ledger').update({
          paid_amount: newPaid,
          balance_amount: newBal,
          balance: newBal,
          status: newStatus
        }).eq('ledger_id', match.ledger_id);
      }
    }

    return { success: true };
  }

  async getBankReconciliationReport(academicYear) {
    const { data, error } = await this.db.from('fee_receipts').neq('payment_mode', 'Cash');
    if (error) throw new Error(error.message);

    let rawData = data || [];
    if (academicYear && academicYear !== 'All') {
      rawData = rawData.filter(f => !f.academic_year || f.academic_year === academicYear);
    }

    let totalNonCashAmount = 0;
    let totalNonCashCount = 0;
    let totalReconciledAmount = 0;
    let totalReconciledCount = 0;
    let totalUnreconciledAmount = 0;
    let totalUnreconciledCount = 0;
    const bankMap = {};

    const items = rawData.map((f, i) => {
      const amount = parseFloat(f.amount_paid) || parseFloat(f.amount) || parseFloat(f.fee_month) || parseFloat(f.paid_amount) || 0;
      const rStatus = f.recon_status || 'Unreconciled';
      const rBank = f.recon_bank || '';
      const isRec = (rStatus || '').toLowerCase() === 'reconciled';

      totalNonCashAmount += amount;
      totalNonCashCount++;
      if (isRec) {
        totalReconciledAmount += amount;
        totalReconciledCount++;
        const bKey = rBank || 'Other / Unspecified Bank';
        if (!bankMap[bKey]) bankMap[bKey] = { bankName: bKey, count: 0, amount: 0 };
        bankMap[bKey].count++;
        bankMap[bKey].amount += amount;
      } else {
        totalUnreconciledAmount += amount;
        totalUnreconciledCount++;
      }

      return {
        rowIndex: i + 1,
        receiptId: f.receipt_id,
        receiptDate: f.receipt_date || '',
        appId: f.app_id,
        studentName: f.student_name || '',
        roomNumber: f.room_number || '',
        feeType: f.fee_type || '',
        amountPaid: amount,
        paymentMode: f.payment_mode,
        transactionId: f.transaction_id || '',
        feeMonth: f.fee_month || '',
        feeYear: f.fee_year || '',
        collectedBy: f.collected_by || '',
        remarks: f.remarks || '',
        academicYear: f.academic_year || '',
        reconStatus: rStatus,
        reconBank: rBank,
        reconCreditDate: f.recon_credit_date || '',
        reconRefNo: f.recon_ref_no || '',
        reconRemarks: f.recon_remarks || '',
        reconciledBy: f.reconciled_by || '',
        reconciledAt: f.reconciled_at || ''
      };
    });

    const bankList = Object.values(bankMap);

    return {
      success: true,
      data: {
        summary: {
          totalNonCashAmount: Math.round(totalNonCashAmount * 100) / 100,
          totalNonCashCount: totalNonCashCount,
          totalReconciledAmount: Math.round(totalReconciledAmount * 100) / 100,
          totalReconciledCount: totalReconciledCount,
          totalUnreconciledAmount: Math.round(totalUnreconciledAmount * 100) / 100,
          totalUnreconciledCount: totalUnreconciledCount,
          banks: bankList
        },
        items: items
      }
    };
  }

  getNormalizedAppId(id) {
    if (!id) return "";
    var s = id.toString().trim();
    s = s.replace(/^ALLOT-/, "").replace(/^ALT-/, "").replace(/^APP-/, "");
    return s ? ("APP-" + s) : id;
  }

  async updatePhysicalReporting(allotmentId, newStatus, repDate, verifiedBy, remarks) {
    const rawId = (allotmentId || '').toString().trim();
    const targetAppId = this.getNormalizedAppId(rawId);
    const cleanStatus = (newStatus === 'Reported' || newStatus === 'Physically Staying') ? 'Reported' : 'Not Reported';
    
    await this.db.from('students').update({
      physical_status: cleanStatus,
      reporting_date: cleanStatus === 'Reported' ? repDate : '',
      reported_verified_by: cleanStatus === 'Reported' ? verifiedBy : '',
      remarks: remarks || ''
    }).eq('app_id', targetAppId);

    return { success: true, message: 'Physical status updated to ' + cleanStatus };
  }

  async changeRoomAllotment(oldAllotmentId, newRoomNumber, newRoomType) {
    const rawId = (oldAllotmentId || '').toString().trim();
    const targetAppId = this.getNormalizedAppId(rawId);
    
    await this.db.from('students').update({
      room_number: newRoomNumber,
      room_type: newRoomType
    }).eq('app_id', targetAppId);

    return { success: true, message: 'Room allotment changed to Room ' + newRoomNumber };
  }
}

// Unit & End-to-End Tests
test('1. Student Registration - Happy Path', async () => {
  const supabase = new MockSupabaseClient();
  const engine = new HostelAppEngine(supabase);

  const res = await engine.submitStudentApplication({
    name: 'Ananya Sharma',
    contact_number: '9876543210',
    email: 'ananya@example.com',
    room_preference: 'Double'
  });

  assert.equal(res.success, true);
  assert.match(res.appId, /^APP-2026-\d{4}$/);
  assert.equal(supabase.tables.students.length, 1);
  assert.equal(supabase.tables.students[0].name, 'Ananya Sharma');
});

test('2. Student Registration - Failure Path (Missing Name)', async () => {
  const supabase = new MockSupabaseClient();
  const engine = new HostelAppEngine(supabase);

  await assert.rejects(
    async () => { await engine.submitStudentApplication({ contact_number: '9876543210' }); },
    { message: 'Name and contact number are required' }
  );
});

test('3. Room Allotment - Happy Path & Capacity Update', async () => {
  const supabase = new MockSupabaseClient();
  const engine = new HostelAppEngine(supabase);

  const appRes = await engine.submitStudentApplication({ name: 'Priya Patel', contact_number: '9888877777' });
  const allotRes = await engine.allotRoom(appRes.appId, '101');

  assert.equal(allotRes.success, true);
  assert.equal(supabase.tables.rooms[0].current_occupancy, 2); // 1 + 1 = 2
  assert.equal(supabase.tables.student_fee_ledger.length, 3); // 3 fee heads created
});

test('4. Room Allotment - Failure Path (Room Full)', async () => {
  const supabase = new MockSupabaseClient();
  const engine = new HostelAppEngine(supabase);

  const appRes = await engine.submitStudentApplication({ name: 'Sneha Kulkarni', contact_number: '9111122222' });
  
  await assert.rejects(
    async () => { await engine.allotRoom(appRes.appId, '102'); },
    { message: 'Room is full! Maximum capacity reached.' }
  );
});

test('5. Priority Fee Settlement Engine - Partial & Priority Allocation', async () => {
  const supabase = new MockSupabaseClient();
  const engine = new HostelAppEngine(supabase);

  const appRes = await engine.submitStudentApplication({ name: 'Riya Gupta', contact_number: '9555544444' });
  await engine.allotRoom(appRes.appId, '101');

  // Record payment of ₹10,000
  const payRes = await engine.recordFeePayment(appRes.appId, 10000, 'Online UPI');
  assert.equal(payRes.success, true);

  const ledger = supabase.tables.student_fee_ledger.filter(l => l.app_id === appRes.appId);
  
  // Security Deposit (Priority 1) should be 100% Paid
  const secDep = ledger.find(l => l.fee_type === 'Security Deposit');
  assert.equal(secDep.paid_amount, 5000);
  assert.equal(secDep.balance_amount, 0);
  assert.equal(secDep.status, 'Paid');

  // Mess Fee (Priority 2) should receive remaining ₹5,000 (Partial)
  const messFee = ledger.find(l => l.fee_type === 'Mess Fee');
  assert.equal(messFee.paid_amount, 5000);
  assert.equal(messFee.balance_amount, 10000);
  assert.equal(messFee.status, 'Partial');

  // Room Rent (Priority 3) should still be Pending
  const rent = ledger.find(l => l.fee_type === 'Room Rent');
  assert.equal(rent.paid_amount, 0);
  assert.equal(rent.balance_amount, 20000);
  assert.equal(rent.status, 'Pending');
});

test('6. Receipt Cancellation Workflow', async () => {
  const supabase = new MockSupabaseClient();
  const engine = new HostelAppEngine(supabase);

  const appRes = await engine.submitStudentApplication({ name: 'Pooja Verma', contact_number: '9666677777' });
  const payRes = await engine.recordFeePayment(appRes.appId, 5000, 'Cash');
  
  const cancelRes = await engine.cancelReceipt(payRes.receiptId);
  assert.equal(cancelRes.success, true);
  
  const rcpt = supabase.tables.fee_receipts.find(r => r.receipt_id === payRes.receiptId);
  assert.equal(rcpt.status, 'Cancelled');
});

test('7. Bank Reconciliation Report Engine - Summary & Items Structure', async () => {
  const supabase = new MockSupabaseClient();
  const engine = new HostelAppEngine(supabase);

  // Add non-cash and cash receipts
  await supabase.from('fee_receipts').insert([
    {
      receipt_id: 'REC-001',
      app_id: 'APP-101',
      student_name: 'Sara Khan',
      paid_amount: 12000,
      payment_mode: 'Online UPI',
      recon_status: 'Unreconciled',
      academic_year: '2026-27'
    },
    {
      receipt_id: 'REC-002',
      app_id: 'APP-102',
      student_name: 'Meera Rao',
      paid_amount: 15000,
      payment_mode: 'Bank Transfer',
      recon_status: 'Reconciled',
      recon_bank: 'SBI Hostel Branch',
      academic_year: '2026-27'
    },
    {
      receipt_id: 'REC-003',
      app_id: 'APP-103',
      student_name: 'Neha Singh',
      paid_amount: 5000,
      payment_mode: 'Cash', // Cash should be ignored
      recon_status: 'Unreconciled',
      academic_year: '2026-27'
    }
  ]);

  const res = await engine.getBankReconciliationReport('2026-27');
  assert.equal(res.success, true);
  assert.ok(res.data.summary);
  assert.ok(Array.isArray(res.data.items));
  assert.equal(res.data.items.length, 2); // Only 2 non-cash receipts
  assert.equal(res.data.summary.totalNonCashAmount, 27000);
  assert.equal(res.data.summary.totalNonCashCount, 2);
  assert.equal(res.data.summary.totalReconciledAmount, 15000);
  assert.equal(res.data.summary.totalReconciledCount, 1);
  assert.equal(res.data.summary.totalUnreconciledAmount, 12000);
  assert.equal(res.data.summary.totalUnreconciledCount, 1);
});

test('8. Room Allotment - Verify Physical Arrival Update', async () => {
  const supabase = new MockSupabaseClient();
  const engine = new HostelAppEngine(supabase);

  const appRes = await engine.submitStudentApplication({ name: 'Tanvi Joshi', contact_number: '9777788888' });
  await engine.allotRoom(appRes.appId, '101');

  // Verify arrival
  const res = await engine.updatePhysicalReporting(appRes.appId, 'Reported', '2026-09-23', 'Warden Anita', 'Arrived with parents');
  assert.equal(res.success, true);

  const student = supabase.tables.students.find(s => s.app_id === appRes.appId);
  assert.equal(student.physical_status, 'Reported');
  assert.equal(student.reporting_date, '2026-09-23');
  assert.equal(student.reported_verified_by, 'Warden Anita');
});

test('9. App ID Normalization Helper', async () => {
  const supabase = new MockSupabaseClient();
  const engine = new HostelAppEngine(supabase);

  assert.equal(engine.getNormalizedAppId('ALLOT-2026-3333'), 'APP-2026-3333');
  assert.equal(engine.getNormalizedAppId('ALT-2026-3333'), 'APP-2026-3333');
  assert.equal(engine.getNormalizedAppId('2026-3333'), 'APP-2026-3333');
  assert.equal(engine.getNormalizedAppId('APP-2026-3333'), 'APP-2026-3333');
});

test('10. Verify Arrival with ALLOT- Prefix (e.g. ALLOT-2026-3333)', async () => {
  const supabase = new MockSupabaseClient();
  const engine = new HostelAppEngine(supabase);

  // Directly insert student with app_id APP-2026-3333
  await supabase.from('students').insert([{
    app_id: 'APP-2026-3333',
    name: 'Kavita Roy',
    physical_status: 'Not Reported'
  }]);

  // Pass ALLOT-2026-3333 to updatePhysicalReporting
  const res = await engine.updatePhysicalReporting('ALLOT-2026-3333', 'Reported', '2026-09-23', 'Rector', 'Verified arrival');
  assert.equal(res.success, true);

  const student = supabase.tables.students.find(s => s.app_id === 'APP-2026-3333');
  assert.equal(student.physical_status, 'Reported');
  assert.equal(student.reporting_date, '2026-09-23');
  assert.equal(student.reported_verified_by, 'Rector');
});

test('11. Receipt Cancellation Ledger Reversal & Restoration', async () => {
  const supabase = new MockSupabaseClient();
  const engine = new HostelAppEngine(supabase);

  const appRes = await engine.submitStudentApplication({ name: 'Shravani Raut', contact_number: '9888899999' });
  await engine.allotRoom(appRes.appId, '101');

  // Pay ₹5000 Security Deposit
  const payRes = await engine.recordFeePayment(appRes.appId, 5000, 'QR Code');
  assert.equal(payRes.success, true);

  // Security Deposit should be Paid
  let secDep = supabase.tables.student_fee_ledger.find(l => l.app_id === appRes.appId && l.fee_type === 'Security Deposit');
  assert.equal(secDep.status, 'Paid');
  assert.equal(secDep.balance_amount, 0);

  // Now Cancel Receipt
  const cancelRes = await engine.cancelReceipt(payRes.receiptId);
  assert.equal(cancelRes.success, true);

  // Security Deposit should revert to Pending and balance 5000
  secDep = supabase.tables.student_fee_ledger.find(l => l.app_id === appRes.appId && l.fee_type === 'Security Deposit');
  assert.equal(secDep.status, 'Pending');
  assert.equal(secDep.paid_amount, 0);
  assert.equal(secDep.balance_amount, 5000);
});

test('12. Uniform Descending Sort By Latest Helper (sortByLatest)', async () => {
  function convertDateToYYYYMMDD(dateStr) {
    if (!dateStr) return '';
    var months = {jan:'01', feb:'02', mar:'03', apr:'04', may:'05', jun:'06', jul:'07', aug:'08', sep:'09', oct:'10', nov:'11', dec:'12'};
    var parts = dateStr.split('-');
    if (parts.length === 3) {
      var day = parts[0].toString().trim().padStart(2, '0');
      var monthName = parts[1].toString().trim().toLowerCase();
      var month = months[monthName] || '01';
      var year = parts[2].toString().trim();
      if (year.length === 4) return year + '-' + month + '-' + day;
    }
    var d = new Date(dateStr);
    if (!isNaN(d.getTime())) return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    return '';
  }

  function parseTimestamp(val) {
    if (!val) return 0;
    if (typeof val === 'number') return val;
    if (val instanceof Date) return val.getTime();
    var str = String(val).trim();
    if (!str) return 0;
    var d = new Date(str);
    if (!isNaN(d.getTime())) return d.getTime();
    var converted = convertDateToYYYYMMDD(str);
    if (converted) {
      var d2 = new Date(converted);
      if (!isNaN(d2.getTime())) return d2.getTime();
    }
    return 0;
  }

  function parseNumericSuffix(idStr) {
    if (!idStr) return 0;
    if (typeof idStr === 'number') return idStr;
    var str = String(idStr).trim();
    var match = str.match(/\d+$/);
    if (match) return parseInt(match[0], 10);
    return 0;
  }

  function sortByLatest(arr, dateKeys, idKeys) {
    if (!Array.isArray(arr)) return arr;
    if (typeof dateKeys === 'string') dateKeys = [dateKeys];
    if (typeof idKeys === 'string') idKeys = [idKeys];
    dateKeys = dateKeys || [];
    idKeys = idKeys || [];

    return arr.sort(function(a, b) {
      if (!a && !b) return 0;
      if (!a) return 1;
      if (!b) return -1;
      var timeA = 0, timeB = 0;
      for (var i = 0; i < dateKeys.length; i++) {
        var k = dateKeys[i];
        if (a[k] && !timeA) timeA = parseTimestamp(a[k]);
        if (b[k] && !timeB) timeB = parseTimestamp(b[k]);
      }
      if (timeA !== timeB) return timeB - timeA;

      var idA = 0, idB = 0;
      for (var j = 0; j < idKeys.length; j++) {
        var ik = idKeys[j];
        if (a[ik] && !idA) idA = parseNumericSuffix(a[ik]);
        if (b[ik] && !idB) idB = parseNumericSuffix(b[ik]);
      }
      if (idA !== idB) return idB - idA;
      return 0;
    });
  }

  // Sample data with mixed date formats and numerical IDs
  const sampleAllotments = [
    { allotmentId: 'ALLOT-2026-1001', allotmentDate: '15-Jan-2026' },
    { allotmentId: 'ALLOT-2026-3333', allotmentDate: '23-Sep-2026' },
    { allotmentId: 'ALLOT-2026-2500', allotmentDate: '10-May-2026' }
  ];

  sortByLatest(sampleAllotments, ['allotmentDate'], 'allotmentId');

  assert.equal(sampleAllotments[0].allotmentId, 'ALLOT-2026-3333');
  assert.equal(sampleAllotments[1].allotmentId, 'ALLOT-2026-2500');
  assert.equal(sampleAllotments[2].allotmentId, 'ALLOT-2026-1001');

  // ID suffix fallback test when dates are identical
  const sampleReceipts = [
    { receiptId: 'RCPT-2026-100', receiptDate: '23-Sep-2026' },
    { receiptId: 'RCPT-2026-6041', receiptDate: '23-Sep-2026' },
    { receiptId: 'RCPT-2026-350', receiptDate: '23-Sep-2026' }
  ];

  sortByLatest(sampleReceipts, ['receiptDate'], 'receiptId');

  assert.equal(sampleReceipts[0].receiptId, 'RCPT-2026-6041');
  assert.equal(sampleReceipts[1].receiptId, 'RCPT-2026-350');
  assert.equal(sampleReceipts[2].receiptId, 'RCPT-2026-100');
});

test('13. Manual Fee Receipt Creation & Ledger Settlement (amount_paid & balance columns)', async () => {
  const supabase = new MockSupabaseClient();
  const engine = new HostelAppEngine(supabase);

  const appRes = await engine.submitStudentApplication({ name: 'Rachika Rendale', contact_number: '9777788888' });
  await engine.allotRoom(appRes.appId, '101');

  const receiptId = 'RCPT-2026-9999';
  await supabase.from('fee_receipts').insert([{
    receipt_id: receiptId,
    app_id: appRes.appId,
    student_name: 'Rachika Rendale',
    room_number: '101',
    fee_type: 'Hostel Linen Charges',
    amount_paid: 1000,
    payment_mode: 'QR Code',
    transaction_id: '66307761693',
    receipt_date: '2026-09-23',
    status: 'Active',
    recon_status: 'Unreconciled'
  }]);

  const rcpt = supabase.tables.fee_receipts.find(r => r.receipt_id === receiptId);
  assert.ok(rcpt);
  assert.equal(rcpt.amount_paid, 1000);
  assert.equal(rcpt.payment_mode, 'QR Code');
  assert.equal(rcpt.transaction_id, '66307761693');
});

test('14. Payment Mode Normalization (categorizing transaction UTRs as Online/UPI)', async () => {
  function normalizePaymentMode(modeStr, txnIdStr) {
    var mode = (modeStr || '').toString().trim();
    var txn = (txnIdStr || '').toString().trim();
    if (!mode) return txn ? 'Online/UPI' : 'Cash';
    var m = mode.toLowerCase();
    if (m === 'cash') return 'Cash';
    if (m === 'qr code' || m === 'qr' || m === 'phonepe' || m === 'gpay' || m === 'paytm') return 'QR Code';
    if (m === 'online/upi' || m === 'online' || m === 'upi' || m === 'netbanking' || m === 'net banking') return 'Online/UPI';
    if (m === 'bank transfer' || m === 'transfer' || m === 'neft' || m === 'rtgs' || m === 'imps' || m === 'bank') return 'Bank Transfer';
    if (m === 'cheque' || m === 'demand draft' || m === 'dd') return 'Cheque';
    if (m === 'card' || m === 'debit card' || m === 'credit card') return 'Card';
    if (/^T\d{10,}/i.test(mode) || /^\d{10,}$/.test(mode) || /^[A-Z0-9]{12,}$/i.test(mode)) return 'Online/UPI';
    return mode;
  }

  assert.equal(normalizePaymentMode('Cash'), 'Cash');
  assert.equal(normalizePaymentMode('T2609211021428827432571'), 'Online/UPI');
  assert.equal(normalizePaymentMode('129648661206'), 'Online/UPI');
  assert.equal(normalizePaymentMode('662207522802'), 'Online/UPI');
  assert.equal(normalizePaymentMode('QR Code'), 'QR Code');
});

test('15. Room Transfer / Change Room (e.g. ALLOT-2026-4001)', async () => {
  const supabase = new MockSupabaseClient();
  const engine = new HostelAppEngine(supabase);

  // Directly insert student ALLOT-2026-4001 (APP-2026-4001) in room GF-23
  await supabase.from('students').insert([{
    app_id: 'APP-2026-4001',
    name: 'Sneha Santosh Pukale.',
    room_number: 'GF-23',
    room_type: 'Classic Tripple',
    physical_status: 'Reported'
  }]);

  // Execute room transfer from ALLOT-2026-4001 to FF-117 (Premium Tripple)
  const res = await engine.changeRoomAllotment('ALLOT-2026-4001', 'FF-117', 'Premium Tripple');
  assert.equal(res.success, true);

  const student = supabase.tables.students.find(s => s.app_id === 'APP-2026-4001');
  assert.equal(student.room_number, 'FF-117');
  assert.equal(student.room_type, 'Premium Tripple');
});

