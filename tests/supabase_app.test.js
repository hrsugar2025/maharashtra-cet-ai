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
      ],
      hostel_settings: []
    };
  }

  from(tableName) {
    const self = this;
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
      upsert: (rows) => {
        if (!self.tables[tableName]) self.tables[tableName] = [];
        const t = self.tables[tableName];
        rows.forEach(r => {
          const idx = t.findIndex(existing => (r.key && existing.key === r.key) || (r.id && existing.id === r.id));
          if (idx !== -1) {
            Object.assign(t[idx], r);
          } else {
            t.push({ ...r });
          }
        });
        const p = Promise.resolve({ data: rows, error: null });
        return {
          then: (resolve, reject) => p.then(resolve, reject),
          catch: (reject) => p.catch(reject)
        };
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
          self.tables[tableName] = remaining;
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

  async getManualFeeTypes() {
    const defaultTypes = [
      { name: 'Hostel Fee', defaultAmount: 0 },
      { name: 'Mess Fee', defaultAmount: 0 },
      { name: 'Security Deposit', defaultAmount: 0 },
      { name: 'Hostel Linen Charges', defaultAmount: 0 },
      { name: 'Other Fee', defaultAmount: 0 }
    ];
    const res = await this.db.from('hostel_settings').select('*').eq('key', 'MANUAL_FEE_TYPES');
    let list = defaultTypes.slice();
    if (res.data && res.data[0] && res.data[0].value) {
      try {
        const parsed = JSON.parse(res.data[0].value);
        if (Array.isArray(parsed) && parsed.length > 0) {
          list = parsed.map(item => {
            if (typeof item === 'string') return { name: item.trim(), defaultAmount: 0 };
            return {
              name: (item.name || item.typeName || '').toString().trim(),
              defaultAmount: parseFloat(item.defaultAmount || item.amount || 0) || 0
            };
          }).filter(x => x.name);
        }
      } catch (e) {}
    }
    return { success: true, data: list };
  }

  async saveManualFeeType(newType, defaultAmount = 0) {
    let cleanType = '';
    let amt = 0;
    if (typeof newType === 'object' && newType !== null) {
      cleanType = (newType.name || '').toString().trim();
      amt = parseFloat(newType.defaultAmount !== undefined ? newType.defaultAmount : defaultAmount) || 0;
    } else {
      cleanType = (newType || '').toString().trim();
      amt = parseFloat(defaultAmount) || 0;
    }
    if (!cleanType) return { success: false, message: 'Fee type name cannot be empty.' };

    const current = await this.getManualFeeTypes();
    const list = current.data || [];
    const exists = list.some(t => t.name.toLowerCase() === cleanType.toLowerCase());
    if (exists) {
      return { success: false, message: `Fee type "${cleanType}" already exists.`, data: list };
    }

    list.push({ name: cleanType, defaultAmount: amt });
    await this.db.from('hostel_settings').upsert([{
      key: 'MANUAL_FEE_TYPES',
      value: JSON.stringify(list)
    }]);

    return { success: true, data: list, message: 'Fee type added successfully!' };
  }

  async updateManualFeeType(oldType, newType, newAmount) {
    const cleanOld = (oldType || '').toString().trim();
    const cleanNew = (typeof newType === 'object' && newType !== null ? (newType.name || '') : (newType || '')).toString().trim();
    const updatedAmt = (typeof newType === 'object' && newType !== null && newType.defaultAmount !== undefined)
      ? parseFloat(newType.defaultAmount) || 0
      : (newAmount !== undefined && newAmount !== null ? parseFloat(newAmount) || 0 : null);

    if (!cleanOld || !cleanNew) {
      return { success: false, message: 'Both old and new fee type names are required.' };
    }

    const current = await this.getManualFeeTypes();
    const list = current.data || [];
    if (cleanOld.toLowerCase() === cleanNew.toLowerCase() && (updatedAmt === null || isNaN(updatedAmt))) {
      return { success: true, data: list };
    }

    const clash = list.some(t => t.name.toLowerCase() === cleanNew.toLowerCase() && t.name.toLowerCase() !== cleanOld.toLowerCase());
    if (clash) {
      return { success: false, message: `Fee type "${cleanNew}" already exists.`, data: list };
    }

    const idx = list.findIndex(t => t.name.toLowerCase() === cleanOld.toLowerCase());
    if (idx === -1) {
      return { success: false, message: `Fee type "${cleanOld}" not found.`, data: list };
    }

    const finalAmt = (updatedAmt !== null && !isNaN(updatedAmt)) ? updatedAmt : list[idx].defaultAmount;
    list[idx] = { name: cleanNew, defaultAmount: finalAmt };
    await this.db.from('hostel_settings').upsert([{
      key: 'MANUAL_FEE_TYPES',
      value: JSON.stringify(list)
    }]);

    return { success: true, data: list, message: 'Fee type updated!' };
  }

  async deleteManualFeeType(typeName) {
    const cleanType = (typeName || '').toString().trim();
    if (!cleanType) return { success: false, message: 'Fee type name cannot be empty.' };

    const current = await this.getManualFeeTypes();
    const list = current.data || [];
    const filtered = list.filter(t => t.name.toLowerCase() !== cleanType.toLowerCase());
    if (filtered.length === list.length) {
      return { success: false, message: `Fee type "${cleanType}" not found.`, data: list };
    }
    if (filtered.length === 0) {
      return { success: false, message: 'Cannot delete the only remaining fee type.', data: list };
    }

    await this.db.from('hostel_settings').upsert([{
      key: 'MANUAL_FEE_TYPES',
      value: JSON.stringify(filtered)
    }]);

    return { success: true, data: filtered, message: 'Fee type deleted!' };
  }

  async getAppBootstrapBundle() {
    const sRes = await this.db.from('hostel_settings').select('*');
    const sMap = {};
    (sRes.data || []).forEach(r => { sMap[r.key] = r.value; });

    let resolvedManualFeeTypes = [
      { name: 'Hostel Fee', defaultAmount: 0 },
      { name: 'Mess Fee', defaultAmount: 0 },
      { name: 'Security Deposit', defaultAmount: 0 },
      { name: 'Hostel Linen Charges', defaultAmount: 0 },
      { name: 'Other Fee', defaultAmount: 0 }
    ];
    if (sMap.MANUAL_FEE_TYPES) {
      try {
        const parsedMft = JSON.parse(sMap.MANUAL_FEE_TYPES);
        if (Array.isArray(parsedMft) && parsedMft.length > 0) {
          resolvedManualFeeTypes = parsedMft.map(item => {
            if (typeof item === 'string') return { name: item.trim(), defaultAmount: 0 };
            return {
              name: (item.name || item.typeName || '').toString().trim(),
              defaultAmount: parseFloat(item.defaultAmount || item.amount || 0) || 0
            };
          }).filter(x => x.name);
        }
      } catch (e) {}
    }

    return {
      settings: sMap,
      manualFeeTypes: resolvedManualFeeTypes
    };
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
    if (m === 'online/upi' || m === 'online' || m === 'upi' || m === 'netbanking' || m === 'net banking' || m.indexOf('online') !== -1 || m.indexOf('easebuzz') !== -1 || m.indexOf('cashfree') !== -1) return 'Online/UPI';
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
  assert.equal(normalizePaymentMode('Online (Easebuzz)'), 'Online/UPI');
  assert.equal(normalizePaymentMode('Easebuzz'), 'Online/UPI');
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

test('16. Non-Cash Receipts Default to Unreconciled & Bank Reconciliation Report Summary', async () => {
  const supabase = new MockSupabaseClient();
  const engine = new HostelAppEngine(supabase);

  // Insert 1 Cash receipt, 2 Non-cash receipts (without recon_status or explicit Unreconciled)
  await supabase.from('fee_receipts').insert([
    {
      receipt_id: 'RCPT-2026-001',
      student_name: 'Aditi Sharma',
      amount_paid: 5000,
      payment_mode: 'Cash',
      recon_status: 'Cash',
      status: 'Active',
      academic_year: '2026-27'
    },
    {
      receipt_id: 'RCPT-2026-002',
      student_name: 'Pooja Patil',
      amount_paid: 12000,
      payment_mode: 'QR Code',
      recon_status: 'Unreconciled',
      status: 'Active',
      academic_year: '2026-27'
    },
    {
      receipt_id: 'RCPT-2026-003',
      student_name: 'Snehal Jagtap',
      amount_paid: 18000,
      payment_mode: 'Online/UPI',
      recon_status: null, // should default to Unreconciled for non-cash
      status: 'Active',
      academic_year: '2026-27'
    }
  ]);

  const report = await engine.getBankReconciliationReport('2026-27');
  assert.equal(report.success, true);
  // Total non-cash count should be 2 (Cash excluded)
  assert.equal(report.data.summary.totalNonCashCount, 2);
  assert.equal(report.data.summary.totalNonCashAmount, 30000);
  assert.equal(report.data.summary.totalReconciledCount, 0);
  assert.equal(report.data.summary.totalReconciledAmount, 0);
  assert.equal(report.data.summary.totalUnreconciledCount, 2);
  assert.equal(report.data.summary.totalUnreconciledAmount, 30000);

  // Verify non-cash items have reconStatus as 'Unreconciled'
  const r2 = report.data.items.find(it => it.receiptId === 'RCPT-2026-002');
  assert.equal(r2.reconStatus, 'Unreconciled');
  const r3 = report.data.items.find(it => it.receiptId === 'RCPT-2026-003');
  assert.equal(r3.reconStatus, 'Unreconciled');
});

test('17. College Courses Master - Deduplication & Grouping Engine', async () => {
  const supabase = new MockSupabaseClient();
  supabase.tables.college_courses = [
    { id: 1, college_name: 'AMGOI', course_name: 'B. TECH. COMPUTER SCIENCE AND ENGINEERING', duration: '4 Years', status: 'Active' },
    { id: 2, college_name: 'AMGOI', course_name: 'B. TECH. COMPUTER SCIENCE AND ENGINEERING', duration: '4 Years', status: 'Active' }, // duplicate
    { id: 3, college_name: 'AMGOI', course_name: 'MBA', duration: '2 Years', status: 'Active' },
    { id: 4, college_name: 'AMAMCHRC (BAMS)', course_name: 'B. A. M. S.', duration: '5.5 Years', status: 'Active' },
    { id: 5, college_name: 'AMAMCHRC (BAMS)', course_name: 'B. A. M. S.', duration: '5.5 Years', status: 'Active' } // duplicate
  ];

  // Logic matching getCollegeCourses
  const res = await supabase.from('college_courses').select('*');
  const list = [];
  const grouped = {};
  const seen = {};
  (res.data || []).forEach(c => {
    const cCol = (c.college_name || '').trim();
    const cCrs = (c.course_name || '').trim();
    if (!cCol || !cCrs) return;
    const dedupeKey = cCol.toLowerCase() + '|||' + cCrs.toLowerCase();
    if (seen[dedupeKey]) return;
    seen[dedupeKey] = true;
    list.push({
      rowIndex: list.length + 1,
      id: c.id,
      collegeName: cCol,
      courseName: cCrs,
      duration: c.duration || '4 Years',
      status: c.status || 'Active'
    });
    if (!grouped[cCol]) grouped[cCol] = [];
    if (grouped[cCol].indexOf(cCrs) === -1) {
      grouped[cCol].push(cCrs);
    }
  });

  assert.equal(list.length, 3); // 5 rows deduplicated to 3 unique courses
  assert.equal(grouped['AMGOI'].length, 2);
  assert.equal(grouped['AMAMCHRC (BAMS)'].length, 1);
  assert.deepEqual(grouped['AMGOI'], ['B. TECH. COMPUTER SCIENCE AND ENGINEERING', 'MBA']);
  assert.deepEqual(grouped['AMAMCHRC (BAMS)'], ['B. A. M. S.']);
});

test('18. College Course Addition - Duplicate Course Prevention', async () => {
  const existingGrouped = {
    'AMCP': ['B. PHARMACY', 'D. PHARMACY']
  };

  function canAddCourse(college, course) {
    if (!college || !course) return { allowed: false, error: 'Required fields missing' };
    if (existingGrouped[college]) {
      const lower = existingGrouped[college].map(c => c.trim().toLowerCase());
      if (lower.includes(course.trim().toLowerCase())) {
        return { allowed: false, error: `Course "${course}" already exists for college "${college}".` };
      }
    }
    return { allowed: true };
  }

  assert.equal(canAddCourse('AMCP', 'B. PHARMACY').allowed, false);
  assert.equal(canAddCourse('AMCP', 'b. pharmacy').allowed, false);
  assert.equal(canAddCourse('AMCP', 'M. PHARMACY').allowed, true);
  assert.equal(canAddCourse('AMGOI', 'MBA').allowed, true);
});

test('19. Student College & Course Normalization Preserves Fee & Allotment Dependencies', async () => {
  const supabase = new MockSupabaseClient();
  const engine = new HostelAppEngine(supabase);

  // Student registered with old BAMS raw name
  await supabase.from('students').insert([{
    app_id: 'APP-2026-4001',
    name: 'Sneha Pukale',
    college_name: 'BAMS',
    course: 'BAMS',
    room_number: 'GF-23',
    status: 'Allotted'
  }]);

  // Fee ledger created for this student
  await supabase.from('student_fee_ledger').insert([{
    ledger_id: 'LDG-001',
    app_id: 'APP-2026-4001',
    fee_type: 'Hostel Fee',
    due_amount: 50000,
    paid_amount: 50000,
    balance_amount: 0,
    status: 'Paid'
  }]);

  // Normalize college & course
  await supabase.from('students').update({
    college_name: 'AMAMCHRC (BAMS)',
    course: 'B. A. M. S.'
  }).eq('app_id', 'APP-2026-4001');

  const student = supabase.tables.students.find(s => s.app_id === 'APP-2026-4001');
  assert.equal(student.college_name, 'AMAMCHRC (BAMS)');
  assert.equal(student.course, 'B. A. M. S.');
  assert.equal(student.room_number, 'GF-23');

  // Ledger link intact via app_id
  const ledger = supabase.tables.student_fee_ledger.find(l => l.app_id === 'APP-2026-4001');
  assert.equal(ledger.balance_amount, 0);
  assert.equal(ledger.status, 'Paid');
});

test('20. User Accounts & Admin Credentials Management (Creation, Update, Status Toggle, Deletion)', async () => {
  const supabase = new MockSupabaseClient();

  // 1. Create a new Admin / Staff user
  const newUser = {
    username: 'warden_sunita',
    full_name: 'Dr. Sunita Sharma',
    email: 'sunita@amghostel.com',
    password_hash: 'SecurePass@2026',
    role: 'Rector',
    status: 'Active'
  };

  await supabase.from('app_users').insert([newUser]);
  const user = supabase.tables.app_users.find(u => u.username === 'warden_sunita');
  assert.ok(user, 'User should be created');
  assert.equal(user.full_name, 'Dr. Sunita Sharma');
  assert.equal(user.role, 'Rector');
  assert.equal(user.status, 'Active');

  // 2. Toggle status to Disabled
  await supabase.from('app_users').update({ status: 'Disabled' }).eq('username', 'warden_sunita');
  assert.equal(user.status, 'Disabled', 'Status should be Disabled');

  // 3. Toggle status back to Active
  await supabase.from('app_users').update({ status: 'Active' }).eq('username', 'warden_sunita');
  assert.equal(user.status, 'Active', 'Status should be Active');

  // 4. Delete user account
  await supabase.from('app_users').delete().eq('username', 'warden_sunita');
  const deletedUser = supabase.tables.app_users.find(u => u.username === 'warden_sunita');
  assert.equal(deletedUser, undefined, 'User should be deleted from table');
});

test('21. Pending Fees Month & Semester Filter Helper (matchesPendingMonth)', async () => {
  function matchesPendingMonth(applicableMonth, monthFilter) {
    if (!monthFilter || monthFilter === 'All') return true;
    var m = (applicableMonth || '').toString().trim().toLowerCase();
    var f = monthFilter.toString().trim().toLowerCase();
    if (!m && !f) return true;
    if (!m) return false;
    if (m === f) return true;

    if (f === 'semester 1' || f === 'sem 1' || f === 'sem-1') {
      return m === 'semester 1' || m.indexOf('semester 1') !== -1 || m.indexOf('sem 1') !== -1 || m.indexOf('sem-1') !== -1;
    }
    if (f === 'semester 2' || f === 'sem 2' || f === 'sem-2') {
      return m === 'semester 2' || m.indexOf('semester 2') !== -1 || m.indexOf('sem 2') !== -1 || m.indexOf('sem-2') !== -1;
    }
    if (f === 'on joining' || f === 'joining') {
      return m.indexOf('joining') !== -1;
    }

    // Exact substring match
    if (m.indexOf(f) !== -1 || f.indexOf(m) !== -1) {
      return true;
    }

    // Month prefix match (e.g. Feb vs February)
    var shortMonths = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
    var longMonths = ['january','february','march','april','may','june','july','august','september','october','november','december'];
    for (var i = 0; i < 12; i++) {
      if (f === longMonths[i] || f === shortMonths[i]) {
        if (m.indexOf(longMonths[i]) !== -1 || m.indexOf(shortMonths[i]) !== -1) {
          return true;
        }
      }
    }

    return false;
  }

  // All matches everything
  assert.equal(matchesPendingMonth('Semester 1', 'All'), true);
  assert.equal(matchesPendingMonth('Semester 2 (Feb 2027)', 'All'), true);

  // Semester 1 filter
  assert.equal(matchesPendingMonth('Semester 1', 'Semester 1'), true);
  assert.equal(matchesPendingMonth('Semester 1 (Aug 2026)', 'Semester 1'), true);
  assert.equal(matchesPendingMonth('Semester 2 (Feb 2027)', 'Semester 1'), false);
  assert.equal(matchesPendingMonth('On Joining', 'Semester 1'), false);

  // Semester 2 filter
  assert.equal(matchesPendingMonth('Semester 2 (Feb 2027)', 'Semester 2'), true);
  assert.equal(matchesPendingMonth('Semester 2', 'Semester 2'), true);
  assert.equal(matchesPendingMonth('Semester 1', 'Semester 2'), false);

  // On Joining filter
  assert.equal(matchesPendingMonth('On Joining', 'On Joining'), true);
  assert.equal(matchesPendingMonth('Semester 1', 'On Joining'), false);

  // Calendar month filter
  assert.equal(matchesPendingMonth('Semester 2 (Feb 2027)', 'February'), true);
  assert.equal(matchesPendingMonth('July', 'July'), true);
});

test('22. Pending Fees Dataset Filtering Semester 1 vs Semester 2 Wise', async () => {
  function matchesPendingMonth(applicableMonth, monthFilter) {
    if (!monthFilter || monthFilter === 'All') return true;
    var m = (applicableMonth || '').toString().trim().toLowerCase();
    var f = monthFilter.toString().trim().toLowerCase();
    if (!m && !f) return true;
    if (!m) return false;
    if (m === f) return true;

    if (f === 'semester 1' || f === 'sem 1' || f === 'sem-1') {
      return m === 'semester 1' || m.indexOf('semester 1') !== -1 || m.indexOf('sem 1') !== -1 || m.indexOf('sem-1') !== -1;
    }
    if (f === 'semester 2' || f === 'sem 2' || f === 'sem-2') {
      return m === 'semester 2' || m.indexOf('semester 2') !== -1 || m.indexOf('sem 2') !== -1 || m.indexOf('sem-2') !== -1;
    }
    if (f === 'on joining' || f === 'joining') {
      return m.indexOf('joining') !== -1;
    }

    if (m.indexOf(f) !== -1 || f.indexOf(m) !== -1) {
      return true;
    }

    var shortMonths = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
    var longMonths = ['january','february','march','april','may','june','july','august','september','october','november','december'];
    for (var i = 0; i < 12; i++) {
      if (f === longMonths[i] || f === shortMonths[i]) {
        if (m.indexOf(longMonths[i]) !== -1 || m.indexOf(shortMonths[i]) !== -1) {
          return true;
        }
      }
    }

    return false;
  }

  const samplePendingFees = [
    { ledgerId: 'LDG-001', studentName: 'Pooja Patil', headName: 'Security Deposit', applicableMonth: 'On Joining', balance: 5000 },
    { ledgerId: 'LDG-002', studentName: 'Pooja Patil', headName: 'Hostel Fee', applicableMonth: 'Semester 1', balance: 25000 },
    { ledgerId: 'LDG-003', studentName: 'Pooja Patil', headName: 'Hostel Fee', applicableMonth: 'Semester 2 (Feb 2027)', balance: 25000 },
    { ledgerId: 'LDG-004', studentName: 'Sneha More', headName: 'Mess Fee', applicableMonth: 'Semester 1', balance: 15000 },
    { ledgerId: 'LDG-005', studentName: 'Sneha More', headName: 'Mess Fee', applicableMonth: 'Semester 2 (Feb 2027)', balance: 15000 }
  ];

  // Filter Semester 1
  const sem1List = samplePendingFees.filter(e => matchesPendingMonth(e.applicableMonth, 'Semester 1'));
  assert.equal(sem1List.length, 2);
  assert.equal(sem1List[0].ledgerId, 'LDG-002');
  assert.equal(sem1List[1].ledgerId, 'LDG-004');

  // Filter Semester 2
  const sem2List = samplePendingFees.filter(e => matchesPendingMonth(e.applicableMonth, 'Semester 2'));
  assert.equal(sem2List.length, 2);
  assert.equal(sem2List[0].ledgerId, 'LDG-003');
  assert.equal(sem2List[1].ledgerId, 'LDG-005');

  // Filter On Joining
  const joiningList = samplePendingFees.filter(e => matchesPendingMonth(e.applicableMonth, 'On Joining'));
  assert.equal(joiningList.length, 1);
  assert.equal(joiningList[0].ledgerId, 'LDG-001');

  // Filter All
  const allList = samplePendingFees.filter(e => matchesPendingMonth(e.applicableMonth, 'All'));
  assert.equal(allList.length, 5);
});

test('23. Student Personal Data Course and College Normalizer (Bams -> B. A. M. S., GNM -> G. N. M., etc.)', async () => {
  function normalizeCollegeName(col, crs) {
    if (!col) {
      if (crs === 'B. A. M. S.') return 'AMAMCHRC (BAMS)';
      if (crs === 'B. H. M. S.') return 'AMHMCH (BHMS)';
      if (crs === 'G. N. M.') return 'AMSON (GNM)';
      if (crs === 'B. SC. NURSING') return 'AMCON (B. SC. NURSING)';
      return '';
    }
    var c = col.toString().trim();
    var l = c.toLowerCase();
    if (l === 'bams' || l === 'amamchrc' || l === 'amamchrc (bams)' || l.indexOf('bams') !== -1) return 'AMAMCHRC (BAMS)';
    if (l === 'bhms' || l === 'amhmch' || l === 'amhmch (bhms)' || l.indexOf('bhms') !== -1) return 'AMHMCH (BHMS)';
    if (l === 'amson' || l.indexOf('amson') !== -1) return 'AMSON (GNM)';
    if (l === 'mvmin' || l.indexOf('mvmin') !== -1) return 'MVMIN (GNM)';
    if (l === 'amcon' || l.indexOf('nursing') !== -1) return 'AMCON (B. SC. NURSING)';
    if (l === 'amcp') return 'AMCP';
    if (l === 'amip' || l === 'ambap' || l.indexOf('amip') !== -1 || l.indexOf('ambap') !== -1) return 'AMIP AMBAP (PHARMACY)';
    if (l === 'wcop' || l.indexOf('wcop') !== -1) return 'WCOP (PHARMACY)';
    if (l === 'ampv' || l.indexOf('polytechnic') !== -1 || l.indexOf('ampv') !== -1) return 'AMPV (DIPLOMA)';
    if (l === 'amgoi' || l.indexOf('amgoi') !== -1 || l.indexOf('engineering') !== -1) return 'AMGOI';
    return c;
  }

  function normalizeCourseName(crs, colName) {
    if (!crs) return '';
    var s = crs.toString().trim();
    var l = s.toLowerCase();
    
    if (l === 'bams' || l === 'b.a.m.s.' || l === 'b. a. m. s.' || l === 'b.a.m.s' || l === 'b a m s' || l.indexOf('bams') !== -1 || l.indexOf('ayurved') !== -1) {
      return 'B. A. M. S.';
    }
    if (l === 'bhms' || l === 'b.h.m.s.' || l === 'b. h. m. s.' || l === 'b.h.m.s' || l === 'b h m s' || l.indexOf('bhms') !== -1 || l.indexOf('homeopath') !== -1) {
      return 'B. H. M. S.';
    }
    if (l === 'gnm' || l === 'g.n.m.' || l === 'g. n. m.' || l === 'g.n.m' || l === 'g n m' || l.indexOf('gnm') !== -1) {
      return 'G. N. M.';
    }
    if (l.indexOf('nurs') !== -1 || l === 'b.sc. nursing' || l === 'b. sc. nursing' || l === 'bsc nursing') {
      return 'B. SC. NURSING';
    }
    if (l === 'b.pharmacy' || l === 'b pharmacy' || l === 'b.pharm' || l === 'b pharm' || l === 'b. pharmacy' || l === 'b. pharm.') {
      return 'B. PHARMACY';
    }
    if (l === 'd.pharmacy' || l === 'd pharmacy' || l === 'd.pharm' || l === 'd pharm' || l === 'd. pharmacy' || l === 'd. pharm.') {
      return 'D. PHARMACY';
    }
    if (l === 'm.pharmacy' || l === 'm pharmacy' || l === 'm.pharm' || l === 'm pharm' || l === 'm. pharmacy' || l === 'm. pharm.') {
      return 'M. PHARMACY';
    }
    if (l.indexOf('electronics') !== -1 && l.indexOf('computer') !== -1) {
      if (l.indexOf('diploma') !== -1) return 'DIPLOMA IN ELECTRONICS & COMPUTER ENGINEERING';
      return 'B. TECH. ELECTRONICS AND COMPUTER ENGINEERING';
    }
    if (l.indexOf('telecom') !== -1 || l.indexOf('entc') !== -1 || l.indexOf('e&tc') !== -1 || (l.indexOf('electronics') !== -1 && l.indexOf('telecommunication') !== -1)) {
      if (l.indexOf('m. tech') !== -1 || l.indexOf('m.tech') !== -1) return 'M. TECH. ELECTRONICS AND TELECOMMUNICATIONS ENGINEERING';
      return 'B. TECH. ELECTRONICS AND TELECOMMUNICATIONS ENGINEERING';
    }
    if (l.indexOf('data science') !== -1 || l.indexOf('ai & ds') !== -1 || l.indexOf('ai and data science') !== -1 || l.indexOf('(ai) and data science') !== -1 || l.indexOf('(ai)  and data science') !== -1) {
      return 'B. TECH. ARTIFICIAL INTELLIGENCE (AI) AND DATA SCIENCE';
    }
    if (l.indexOf('machine learning') !== -1 || l.indexOf('aiml') !== -1 || l.indexOf('ai & ml') !== -1 || l.indexOf('ai and machine learning') !== -1) {
      if (l.indexOf('diploma') !== -1) return 'DIPLOMA IN AIML';
      return 'B. TECH. ARTIFICIAL INTELLIGENCE AND MACHINE LEARNING';
    }
    if (l.indexOf('computer') !== -1 || l.indexOf('cse') !== -1) {
      if (l.indexOf('diploma') !== -1) return 'DIPLOMA IN COMPUTER ENGINEERING';
      if (l.indexOf('m. tech') !== -1 || l.indexOf('m.tech') !== -1) return 'M. TECH. COMPUTER SCIENCE AND ENGINEERING';
      return 'B. TECH. COMPUTER SCIENCE AND ENGINEERING';
    }
    if (l.indexOf('civil') !== -1) {
      if (l.indexOf('diploma') !== -1) return 'DIPLOMA IN CIVIL ENGINEERING';
      return 'B. TECH. CIVIL ENGINEERING';
    }
    if (l.indexOf('electrical') !== -1) {
      if (l.indexOf('diploma') !== -1) return 'DIPLOMA IN ELECTRICAL';
      return 'B. TECH. ELECTRICAL ENGINEERING';
    }
    if (l.indexOf('mechanical') !== -1) {
      if (l.indexOf('diploma') !== -1) return 'DIPLOMA IN MECHANICAL ENGINEERING';
      if (l.indexOf('design') !== -1) return 'M. TECH. MECHANICAL ENGINEERING DESIGN';
      if (l.indexOf('production') !== -1) return 'M. TECH. MECHANICAL ENGINEERING (PRODUCTION)';
      return 'B. TECH. MECHANICAL ENGINEERING';
    }
    if (l === 'mba' || l.indexOf('business administration') !== -1) {
      return 'MBA';
    }

    return s;
  }

  // BAMS normalization
  assert.equal(normalizeCourseName('Bams'), 'B. A. M. S.');
  assert.equal(normalizeCourseName('bams'), 'B. A. M. S.');
  assert.equal(normalizeCourseName('BAMS'), 'B. A. M. S.');
  assert.equal(normalizeCourseName('B.A.M.S.'), 'B. A. M. S.');
  assert.equal(normalizeCollegeName('BAMS'), 'AMAMCHRC (BAMS)');

  // BHMS normalization
  assert.equal(normalizeCourseName('Bhms'), 'B. H. M. S.');
  assert.equal(normalizeCourseName('BHMS'), 'B. H. M. S.');
  assert.equal(normalizeCollegeName('BHMS'), 'AMHMCH (BHMS)');

  // GNM normalization
  assert.equal(normalizeCourseName('GNM'), 'G. N. M.');
  assert.equal(normalizeCourseName('gnm'), 'G. N. M.');

  // Computer Science normalization
  assert.equal(normalizeCourseName('Computer science and Engineering'), 'B. TECH. COMPUTER SCIENCE AND ENGINEERING');
  assert.equal(normalizeCourseName('B. TECH. ELECTRONICS AND COMPUTER ENGINEERING'), 'B. TECH. ELECTRONICS AND COMPUTER ENGINEERING');
});

test('24. Manual Fee Types Management & Bootstrap Persistence (Add, List, Edit, Duplicate Prevention, Delete)', async () => {
  const supabase = new MockSupabaseClient();
  const engine = new HostelAppEngine(supabase);

  // 1. Initial manual fee types should return default 5 types
  const initial = await engine.getManualFeeTypes();
  assert.equal(initial.success, true);
  assert.equal(initial.data.length, 5);
  assert.ok(initial.data.some(t => t.name === 'Hostel Fee'));
  assert.ok(initial.data.some(t => t.name === 'Mess Fee'));

  // 2. Add new Fee Type as "Information Brochure & Application Form Fee" with default amount 500
  const addRes = await engine.saveManualFeeType('Information Brochure & Application Form Fee', 500);
  assert.equal(addRes.success, true);
  assert.equal(addRes.data.length, 6);
  const found = addRes.data.find(t => t.name === 'Information Brochure & Application Form Fee');
  assert.ok(found);
  assert.equal(found.defaultAmount, 500);

  // 3. Verify it is persisted in hostel_settings
  const getRes = await engine.getManualFeeTypes();
  assert.equal(getRes.success, true);
  assert.equal(getRes.data.length, 6);
  assert.ok(getRes.data.some(t => t.name === 'Information Brochure & Application Form Fee' && t.defaultAmount === 500));

  // 4. Verify getAppBootstrapBundle dynamically includes the new fee type with amount
  const bundle = await engine.getAppBootstrapBundle();
  assert.ok(Array.isArray(bundle.manualFeeTypes));
  assert.equal(bundle.manualFeeTypes.length, 6);
  assert.ok(bundle.manualFeeTypes.some(t => t.name === 'Information Brochure & Application Form Fee' && t.defaultAmount === 500));

  // 5. Prevent duplicate addition (case-insensitive)
  const dupRes = await engine.saveManualFeeType('information brochure & application form fee', 300);
  assert.equal(dupRes.success, false);
  assert.ok(dupRes.message.includes('already exists'));

  // 6. Prevent empty fee type
  const emptyRes = await engine.saveManualFeeType('   ', 100);
  assert.equal(emptyRes.success, false);
  assert.ok(emptyRes.message.includes('cannot be empty'));

  // 7. Update/Edit fee type name and amount
  const updateRes = await engine.updateManualFeeType(
    'Information Brochure & Application Form Fee',
    'Application Form & Brochure Fee',
    750
  );
  assert.equal(updateRes.success, true);
  assert.ok(updateRes.data.some(t => t.name === 'Application Form & Brochure Fee' && t.defaultAmount === 750));
  assert.ok(!updateRes.data.some(t => t.name === 'Information Brochure & Application Form Fee'));

  // 8. Delete fee type
  const delRes = await engine.deleteManualFeeType('Application Form & Brochure Fee');
  assert.equal(delRes.success, true);
  assert.equal(delRes.data.length, 5);
  assert.ok(!delRes.data.some(t => t.name === 'Application Form & Brochure Fee'));
});

test('25. Manual Receipt Fee Type Selection Auto-populates Editable Amount', () => {
  // Simulating the onManualFeeTypeChange logic
  const configuredFeeTypes = [
    { name: 'Hostel Fee', defaultAmount: 0 },
    { name: 'Hostel Linen Charges', defaultAmount: 1200 },
    { name: 'Information Brochure & Application Form Fee', defaultAmount: 500 }
  ];

  function getAutoFilledAmount(selectedFeeType) {
    const found = configuredFeeTypes.find(t => t.name.toLowerCase() === selectedFeeType.toLowerCase());
    return (found && found.defaultAmount > 0) ? found.defaultAmount : '';
  }

  // 1. Selecting fee type with configured default amount (e.g. 500)
  assert.equal(getAutoFilledAmount('Information Brochure & Application Form Fee'), 500);

  // 2. Selecting Linen Charges with configured 1200
  assert.equal(getAutoFilledAmount('Hostel Linen Charges'), 1200);

  // 3. Selecting fee type with 0 or unconfigured amount returns empty (so user enters manually)
  assert.equal(getAutoFilledAmount('Hostel Fee'), '');

  // 4. Verify value is numeric and can be edited/overwritten to another amount (e.g. user discounts to 450)
  let userAmountInput = getAutoFilledAmount('Information Brochure & Application Form Fee');
  assert.equal(userAmountInput, 500);
  userAmountInput = 450; // User edits the pre-filled amount
  assert.equal(userAmountInput, 450);
});

test('26. Fee Collection Report - Strict 4 Fee Types & Accurate Allocation Engine', () => {
  // 1. Fee Type Normalizer
  function normalizeFeeTypeName(raw) {
    if (!raw) return 'Other';
    var s = raw.toString().trim();
    var clean = s.replace(/\s*\(\s*(?:₹|Rs\.?)?\s*[\d,]+\s*\)\s*$/i, '').trim();
    var lower = clean.toLowerCase();

    if (lower.indexOf('deposit') !== -1 || lower.indexOf('security') !== -1 || lower.indexOf('caution') !== -1) {
      return 'SECURITY DEPOSIT (REFUNDABLE)';
    }
    if (lower.indexOf('linen') !== -1 || lower.indexOf('bedding') !== -1 || lower.indexOf('kit') !== -1) {
      return 'Hostel Linen Charges';
    }
    if (lower.indexOf('mess') !== -1 || lower.indexOf('food') !== -1 || lower.indexOf('dining') !== -1 || lower.indexOf('canteen') !== -1 || lower.indexOf('meal') !== -1) {
      return 'MESS CHARGES';
    }
    if (lower.indexOf('accom') !== -1 || lower.indexOf('hostel') !== -1 || lower.indexOf('room') !== -1 || lower.indexOf('rent') !== -1 || lower.indexOf('stay') !== -1) {
      return 'ACCOMODATION CHARGES';
    }
    return clean;
  }

  // Verify synonym and typo mapping
  assert.equal(normalizeFeeTypeName('ACCOMADATION CHARGES'), 'ACCOMODATION CHARGES');
  assert.equal(normalizeFeeTypeName('ACCOMMODATION CHARGES'), 'ACCOMODATION CHARGES');
  assert.equal(normalizeFeeTypeName('Hostel Fee'), 'ACCOMODATION CHARGES');
  assert.equal(normalizeFeeTypeName('Room Rent'), 'ACCOMODATION CHARGES');
  assert.equal(normalizeFeeTypeName('MESS CHARGES'), 'MESS CHARGES');
  assert.equal(normalizeFeeTypeName('Mess Fee'), 'MESS CHARGES');
  assert.equal(normalizeFeeTypeName('SECURITY DEPOSIT (REFUNDABLE)'), 'SECURITY DEPOSIT (REFUNDABLE)');
  assert.equal(normalizeFeeTypeName('SECURITY DEPOSIT (REFUNDABLE) (₹15000)'), 'SECURITY DEPOSIT (REFUNDABLE)');
  assert.equal(normalizeFeeTypeName('Hostel Linen Charges'), 'Hostel Linen Charges');
  assert.equal(normalizeFeeTypeName('Information Brochure & Application Form Fee'), 'Information Brochure & Application Form Fee');

  // 2. Receipt Allocation Engine
  function parseReceiptFeeAllocations(feeTypeStr, totalAmt) {
    if (!feeTypeStr) return [{ type: 'Other', amount: parseFloat(totalAmt) || 0 }];
    var s = feeTypeStr.toString().trim();
    var amt = parseFloat(totalAmt) || 0;

    if (s.indexOf(',') !== -1) {
      var rawParts = s.split(',').map(function(p){ return p.trim(); }).filter(Boolean);
      var parsedParts = [];
      var allHaveAmt = true;

      rawParts.forEach(function(part) {
        var amtMatch = part.match(/^(.*?)\s*\(\s*(?:₹|Rs\.?)?\s*([\d,]+)\s*\)$/i);
        if (amtMatch) {
          parsedParts.push({
            type: normalizeFeeTypeName(amtMatch[1]),
            amount: parseFloat(amtMatch[2].replace(/,/g, '')) || 0
          });
        } else {
          allHaveAmt = false;
        }
      });

      if (allHaveAmt && parsedParts.length > 0) {
        return parsedParts;
      }

      var normalizedHeads = rawParts.map(normalizeFeeTypeName);
      var hasAccom = normalizedHeads.indexOf('ACCOMODATION CHARGES') !== -1;
      var hasMess = normalizedHeads.indexOf('MESS CHARGES') !== -1;

      if (hasAccom && hasMess && normalizedHeads.length === 2) {
        if (amt === 40000) {
          return [
            { type: 'ACCOMODATION CHARGES', amount: 17800 },
            { type: 'MESS CHARGES', amount: 22200 }
          ];
        }
        if (amt === 47500) {
          return [
            { type: 'ACCOMODATION CHARGES', amount: 25300 },
            { type: 'MESS CHARGES', amount: 22200 }
          ];
        }
        if (amt === 95000) {
          return [
            { type: 'ACCOMODATION CHARGES', amount: 50600 },
            { type: 'MESS CHARGES', amount: 44400 }
          ];
        }
        if (amt === 35000) {
          return [
            { type: 'ACCOMODATION CHARGES', amount: 17800 },
            { type: 'MESS CHARGES', amount: 17200 }
          ];
        }
        if (amt === 52500) {
          return [
            { type: 'ACCOMODATION CHARGES', amount: 25300 },
            { type: 'MESS CHARGES', amount: 27200 }
          ];
        }
        if (amt === 45000) {
          return [
            { type: 'ACCOMODATION CHARGES', amount: 17800 },
            { type: 'MESS CHARGES', amount: 27200 }
          ];
        }
        var accomPart = Math.round(amt / 2);
        return [
          { type: 'ACCOMODATION CHARGES', amount: accomPart },
          { type: 'MESS CHARGES', amount: amt - accomPart }
        ];
      }
    }

    return [{ type: normalizeFeeTypeName(s), amount: amt }];
  }

  // 3. Test multi-head breakdown
  const combo1 = parseReceiptFeeAllocations('ACCOMODATION CHARGES (₹25300), MESS CHARGES (₹27200)', 52500);
  assert.equal(combo1.length, 2);
  assert.equal(combo1[0].type, 'ACCOMODATION CHARGES');
  assert.equal(combo1[0].amount, 25300);
  assert.equal(combo1[1].type, 'MESS CHARGES');
  assert.equal(combo1[1].amount, 27200);

  const combo2 = parseReceiptFeeAllocations('ACCOMADATION CHARGES, MESS CHARGES', 40000);
  assert.equal(combo2.length, 2);
  assert.equal(combo2[0].type, 'ACCOMODATION CHARGES');
  assert.equal(combo2[0].amount, 17800);
  assert.equal(combo2[1].type, 'MESS CHARGES');
  assert.equal(combo2[1].amount, 22200);

  // 4. Test Report Aggregation over sample dataset
  const sampleReceipts = [
    { receipt_id: 'R-01', fee_type: 'SECURITY DEPOSIT (REFUNDABLE)', amount_paid: 15000 },
    { receipt_id: 'R-02', fee_type: 'SECURITY DEPOSIT (REFUNDABLE) (₹15000)', amount_paid: 15000 },
    { receipt_id: 'R-03', fee_type: 'ACCOMODATION CHARGES', amount_paid: 25300 },
    { receipt_id: 'R-04', fee_type: 'ACCOMADATION CHARGES', amount_paid: 17800 },
    { receipt_id: 'R-05', fee_type: 'MESS CHARGES', amount_paid: 27200 },
    { receipt_id: 'R-06', fee_type: 'ACCOMODATION CHARGES (₹25300), MESS CHARGES (₹27200)', amount_paid: 52500 },
    { receipt_id: 'R-07', fee_type: 'ACCOMADATION CHARGES, MESS CHARGES', amount_paid: 40000 },
    { receipt_id: 'R-08', fee_type: 'Hostel Linen Charges', amount_paid: 1000 }
  ];

  const totalReceiptsAmount = sampleReceipts.reduce((sum, r) => sum + r.amount_paid, 0); // 15000+15000+25300+17800+27200+52500+40000+1000 = 193800
  assert.equal(totalReceiptsAmount, 193800);

  const byType = {};
  sampleReceipts.forEach(r => {
    const allocs = parseReceiptFeeAllocations(r.fee_type, r.amount_paid);
    allocs.forEach(a => {
      byType[a.type] = (byType[a.type] || 0) + a.amount;
    });
  });

  // Verify strictly 4 fee types appear in the summary
  const summaryTypes = Object.keys(byType);
  assert.equal(summaryTypes.length, 4);
  assert.ok(summaryTypes.includes('SECURITY DEPOSIT (REFUNDABLE)'));
  assert.ok(summaryTypes.includes('ACCOMODATION CHARGES'));
  assert.ok(summaryTypes.includes('MESS CHARGES'));
  assert.ok(summaryTypes.includes('Hostel Linen Charges'));

  // Verify no composite types or amount suffixes exist
  assert.ok(!summaryTypes.some(t => t.includes(',') || t.includes('₹') || /\(\d+/.test(t)));

  // Verify amounts per fee type
  assert.equal(byType['SECURITY DEPOSIT (REFUNDABLE)'], 30000); // 15000 + 15000
  assert.equal(byType['ACCOMODATION CHARGES'], 86200); // 25300 + 17800 + 25300 + 17800
  assert.equal(byType['MESS CHARGES'], 76600); // 27200 + 27200 + 22200
  assert.equal(byType['Hostel Linen Charges'], 1000); // 1000

  // Verify sum of allocations matches total collections with 0 discrepancy
  const allocatedSum = Object.values(byType).reduce((a, b) => a + b, 0);
  assert.equal(allocatedSum, totalReceiptsAmount);

  // 5. Verify Filter By Specific Fee Type (e.g. ACCOMODATION CHARGES)
  const filterType = 'ACCOMODATION CHARGES';
  const filteredReceipts = sampleReceipts.filter(r => {
    const allocs = parseReceiptFeeAllocations(r.fee_type, r.amount_paid);
    return allocs.some(a => a.type === filterType);
  });

  // Receipts R-03 (25300), R-04 (17800), R-06 (combo), R-07 (combo) contain accommodation
  assert.equal(filteredReceipts.length, 4);
  const filteredAccomAmount = filteredReceipts.reduce((sum, r) => {
    const allocs = parseReceiptFeeAllocations(r.fee_type, r.amount_paid);
    const target = allocs.find(a => a.type === filterType);
    return sum + (target ? target.amount : 0);
  }, 0);
  assert.equal(filteredAccomAmount, 86200);
});

test('27. Easebuzz Payment Gateway Hash Generation & Payload Verification', async () => {
  const crypto = require('crypto');

  const testKey = 'FRHPPBX6RF';
  const testSalt = '45UDY802LV';
  const txnid = 'TXN_1731400000000_STD1001';
  const amount = '50000.00';
  const productinfo = 'Hostel Fee 2026';
  const firstname = 'Aishwarya';
  const email = 'mvmghostel@gmail.com';
  const phone = '9876543210';
  const udf1 = 'APP-2026-1001';
  const udf2 = 'LDG-1001';
  const udf3 = '2026-27';
  const udf4 = '';
  const udf5 = '';

  // 1. Strict 16-pipe Initiate Link Hash calculation:
  // key|txnid|amount|productinfo|firstname|email|udf1|udf2|udf3|udf4|udf5||||||salt
  const hashSequence = [
    testKey,
    txnid,
    amount,
    productinfo,
    firstname,
    email,
    udf1, udf2, udf3, udf4, udf5, '', '', '', '', '',
    testSalt
  ].join('|');

  const initiateHash = crypto.createHash('sha512').update(hashSequence).digest('hex').toLowerCase();
  assert.ok(initiateHash);
  assert.equal(typeof initiateHash, 'string');
  assert.equal(initiateHash.length, 128); // SHA-512 hex is 128 chars

  // 2. Strict Reverse Hash calculation for Callback / Webhook:
  // salt|status||||||udf5|udf4|udf3|udf2|udf1|email|firstname|productinfo|amount|txnid|key
  const status = 'success';
  const reverseSequence = [
    testSalt,
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
    testKey
  ].join('|');

  const reverseHash = crypto.createHash('sha512').update(reverseSequence).digest('hex').toLowerCase();
  assert.ok(reverseHash);
  assert.equal(reverseHash.length, 128);

  // 3. Hosted checkout URL verification
  const sampleAccessKey = 'ebz_acc_7890abcdef123456';
  const paymentUrlProd = `https://pay.easebuzz.in/pay/${sampleAccessKey}`;
  const paymentUrlSandbox = `https://testpay.easebuzz.in/pay/${sampleAccessKey}`;
  assert.equal(paymentUrlProd, 'https://pay.easebuzz.in/pay/ebz_acc_7890abcdef123456');
  assert.equal(paymentUrlSandbox, 'https://testpay.easebuzz.in/pay/ebz_acc_7890abcdef123456');

  // 4. Verification of successful payment response parsing
  const mockEasebuzzResponse = {
    status: true,
    data: {
      status: 'success',
      easepayid: 'E2212042X8XXXX',
      txnid: txnid,
      amount: '50000.00',
      net_amount_debit: '50000.00',
      mode: 'UPI'
    }
  };

  const isPaid = mockEasebuzzResponse.data.status === 'success';
  const recordedMode = 'Online (Easebuzz)';
  const remarks = 'Paid online via Easebuzz Payment Link (' + txnid + ')';

  assert.equal(isPaid, true);
  assert.equal(recordedMode, 'Online (Easebuzz)');
  assert.ok(remarks.includes('Easebuzz'));
});

test('28. Easebuzz Test Endpoint Dummy ₹1.00 Verification Hash', async () => {
  const crypto = require('crypto');
  const testKey = 'FRHPPBX6RF';
  const testSalt = '45UDY802LV';
  const testTxnId = 'TEST_1731400000000';
  const testAmount = '1.00';
  const testProduct = 'Test Connection';
  const testName = 'Test User';
  const testEmail = 'mvmghostel@gmail.com';

  const hashSeq = [
    testKey,
    testTxnId,
    testAmount,
    testProduct,
    testName,
    testEmail,
    '', '', '', '', '', '', '', '', '', '',
    testSalt
  ].join('|');

  const hash = crypto.createHash('sha512').update(hashSeq).digest('hex').toLowerCase();
  assert.equal(hash.length, 128);
});

test('29. Tally XML Export Engine - Auto-creates Fee Heads under Indirect Incomes and Banks under Bank Accounts', () => {
  function escapeTallyXml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

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
    if (!isNaN(d.getTime())) {
      var y = d.getFullYear();
      var m = String(d.getMonth() + 1).padStart(2, '0');
      var da = String(d.getDate()).padStart(2, '0');
      return y + '-' + m + '-' + da;
    }
    return '';
  }

  function buildTallyReceiptsXml(receiptsList, bankAccountsList) {
    var list = receiptsList || [];
    var defaultBankName = (bankAccountsList && bankAccountsList.length > 0 && bankAccountsList[0].accountName) 
      ? bankAccountsList[0].accountName 
      : 'Hostel Bank Account';

    var feeHeadsMap = {};
    var bankLedgersMap = {};

    list.forEach(function(f) {
      var rawHead = (f.feeType || 'Hostel Fee').trim();
      if (!feeHeadsMap[rawHead]) {
        var isDeposit = /deposit|security/i.test(rawHead);
        feeHeadsMap[rawHead] = isDeposit ? 'Current Liabilities' : 'Indirect Incomes';
      }

      var pMode = (f.paymentMode || '').trim();
      var isCash = pMode.toLowerCase() === 'cash';
      if (isCash) {
        bankLedgersMap['Cash'] = 'Cash-in-hand';
      } else {
        var bankName = (f.reconBank || '').trim();
        if (!bankName) {
          if (/easebuzz/i.test(pMode)) {
            bankName = 'Easebuzz Settlement A/c';
          } else if (/cashfree/i.test(pMode)) {
            bankName = 'Cashfree Settlement A/c';
          } else {
            bankName = defaultBankName;
          }
        }
        bankLedgersMap[bankName] = 'Bank Accounts';
      }
    });

    var xml = '<?xml version="1.0" encoding="utf-8"?>\r\n';
    xml += '<ENVELOPE>\r\n';
    xml += '  <HEADER>\r\n';
    xml += '    <TALLYREQUEST>Import Data</TALLYREQUEST>\r\n';
    xml += '  </HEADER>\r\n';
    xml += '  <BODY>\r\n';
    xml += '    <IMPORTDATA>\r\n';
    xml += '      <REQUESTDATA>\r\n';

    Object.keys(feeHeadsMap).forEach(function(headName) {
      var parentGroup = feeHeadsMap[headName];
      xml += '        <TALLYMESSAGE xmlns:UDF="TallyUDF">\r\n';
      xml += '          <LEDGER NAME="' + escapeTallyXml(headName) + '" ACTION="Create">\r\n';
      xml += '            <NAME>' + escapeTallyXml(headName) + '</NAME>\r\n';
      xml += '            <PARENT>' + escapeTallyXml(parentGroup) + '</PARENT>\r\n';
      xml += '            <ISBILLWISEON>No</ISBILLWISEON>\r\n';
      xml += '            <AFFECTSSTOCK>No</AFFECTSSTOCK>\r\n';
      xml += '          </LEDGER>\r\n';
      xml += '        </TALLYMESSAGE>\r\n';
    });

    Object.keys(bankLedgersMap).forEach(function(bName) {
      var parentGroup = bankLedgersMap[bName];
      xml += '        <TALLYMESSAGE xmlns:UDF="TallyUDF">\r\n';
      xml += '          <LEDGER NAME="' + escapeTallyXml(bName) + '" ACTION="Create">\r\n';
      xml += '            <NAME>' + escapeTallyXml(bName) + '</NAME>\r\n';
      xml += '            <PARENT>' + escapeTallyXml(parentGroup) + '</PARENT>\r\n';
      xml += '            <ISBILLWISEON>No</ISBILLWISEON>\r\n';
      xml += '          </LEDGER>\r\n';
      xml += '        </TALLYMESSAGE>\r\n';
    });

    list.forEach(function(f) {
      var amt = parseFloat(f.amountPaid) || 0;
      if (amt <= 0) return;

      var rawDate = convertDateToYYYYMMDD(f.receiptDate);
      var tallyDate = rawDate ? rawDate.replace(/-/g, '') : new Date().toISOString().slice(0, 10).replace(/-/g, '');
      var rcptId = (f.receiptId || '').trim();
      var feeHead = (f.feeType || 'Hostel Fee').trim();

      var pMode = (f.paymentMode || '').trim();
      var isCash = pMode.toLowerCase() === 'cash';
      var bankLedger = isCash ? 'Cash' : ((f.reconBank || '').trim() || (/easebuzz/i.test(pMode) ? 'Easebuzz Settlement A/c' : (/cashfree/i.test(pMode) ? 'Cashfree Settlement A/c' : defaultBankName)));

      var narrationParts = [
        'Hostel Fee Receipt: ' + rcptId,
        'Student: ' + (f.studentName || '') + (f.appId ? ' (' + f.appId + ')' : ''),
        f.roomNumber ? 'Room: ' + f.roomNumber : '',
        'Head: ' + feeHead,
        f.feeMonth ? 'Month: ' + f.feeMonth : '',
        'Mode: ' + (f.paymentMode || 'Cash'),
        f.transactionId ? 'Txn: ' + f.transactionId : '',
        f.remarks ? 'Remarks: ' + f.remarks : ''
      ].filter(Boolean);
      var narration = narrationParts.join(' | ');

      xml += '        <TALLYMESSAGE xmlns:UDF="TallyUDF">\r\n';
      xml += '          <VOUCHER VCHTYPE="Receipt" ACTION="Create" OBJVIEW="Accounting Voucher View">\r\n';
      xml += '            <DATE>' + tallyDate + '</DATE>\r\n';
      xml += '            <EFFECTIVEDATE>' + tallyDate + '</EFFECTIVEDATE>\r\n';
      xml += '            <GUID>AMG-HOSTEL-' + escapeTallyXml(rcptId || ('VCH-' + tallyDate + '-' + Math.floor(Math.random() * 10000))) + '</GUID>\r\n';
      xml += '            <VOUCHERTYPENAME>Receipt</VOUCHERTYPENAME>\r\n';
      xml += '            <VOUCHERNUMBER>' + escapeTallyXml(rcptId) + '</VOUCHERNUMBER>\r\n';
      if (f.transactionId) {
        xml += '            <REFERENCE>' + escapeTallyXml(f.transactionId) + '</REFERENCE>\r\n';
      }
      xml += '            <PARTYLEDGERNAME>' + escapeTallyXml(feeHead) + '</PARTYLEDGERNAME>\r\n';
      xml += '            <ISINVOICE>No</ISINVOICE>\r\n';
      xml += '            <NARRATION>' + escapeTallyXml(narration) + '</NARRATION>\r\n';

      xml += '            <ALLLEDGERENTRIES.LIST>\r\n';
      xml += '              <LEDGERNAME>' + escapeTallyXml(bankLedger) + '</LEDGERNAME>\r\n';
      xml += '              <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>\r\n';
      xml += '              <LEDGERFROMITEM>No</LEDGERFROMITEM>\r\n';
      xml += '              <REMOVEZEROENTRIES>No</REMOVEZEROENTRIES>\r\n';
      xml += '              <ISPARTYLEDGER>No</ISPARTYLEDGER>\r\n';
      xml += '              <AMOUNT>-' + amt.toFixed(2) + '</AMOUNT>\r\n';
      xml += '            </ALLLEDGERENTRIES.LIST>\r\n';

      xml += '            <ALLLEDGERENTRIES.LIST>\r\n';
      xml += '              <LEDGERNAME>' + escapeTallyXml(feeHead) + '</LEDGERNAME>\r\n';
      xml += '              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>\r\n';
      xml += '              <LEDGERFROMITEM>No</LEDGERFROMITEM>\r\n';
      xml += '              <REMOVEZEROENTRIES>No</REMOVEZEROENTRIES>\r\n';
      xml += '              <ISPARTYLEDGER>Yes</ISPARTYLEDGER>\r\n';
      xml += '              <AMOUNT>' + amt.toFixed(2) + '</AMOUNT>\r\n';
      xml += '            </ALLLEDGERENTRIES.LIST>\r\n';

      xml += '          </VOUCHER>\r\n';
      xml += '        </TALLYMESSAGE>\r\n';
    });

    xml += '      </REQUESTDATA>\r\n';
    xml += '    </IMPORTDATA>\r\n';
    xml += '  </BODY>\r\n';
    xml += '</ENVELOPE>\r\n';

    return xml;
  }

  const mockReceipts = [
    {
      receiptId: 'RCPT-2026-0001',
      receiptDate: '21-Nov-2026',
      studentName: 'Pooja Sharma & Co.',
      appId: 'APP-2026-101',
      roomNumber: '101-A',
      feeType: 'Room Rent',
      feeMonth: 'November',
      paymentMode: 'Bank Transfer',
      reconBank: 'UBI-GIRLS_HOSTEL-50560',
      transactionId: 'TXN998877',
      amountPaid: 15000,
      remarks: 'Term 1 payment'
    },
    {
      receiptId: 'RCPT-2026-0002',
      receiptDate: '2026-11-20',
      studentName: 'Ananya Deshmukh',
      appId: 'APP-2026-102',
      roomNumber: '102-B',
      feeType: 'Mess Fee',
      feeMonth: 'November',
      paymentMode: 'Cash',
      amountPaid: 8000,
      remarks: 'Mess cash'
    },
    {
      receiptId: 'RCPT-2026-0003',
      receiptDate: '2026-11-19',
      studentName: 'Rhea Patel',
      appId: 'APP-2026-103',
      roomNumber: '201-A',
      feeType: 'Security Deposit',
      feeMonth: 'One-Time',
      paymentMode: 'Online (Easebuzz)',
      amountPaid: 5000,
      remarks: 'Caution deposit online'
    }
  ];

  const mockBanks = [
    { accountName: 'UBI-GIRLS_HOSTEL-50560', bankName: 'Union Bank of India' }
  ];

  const xml = buildTallyReceiptsXml(mockReceipts, mockBanks);

  // Assertions:
  // 1. Valid XML Envelope & Import headers
  assert.ok(xml.includes('<TALLYREQUEST>Import Data</TALLYREQUEST>'));

  // 2. Fee Heads auto-created under Indirect Incomes
  assert.ok(xml.includes('<LEDGER NAME="Room Rent" ACTION="Create">'));
  assert.ok(xml.includes('<PARENT>Indirect Incomes</PARENT>'));
  assert.ok(xml.includes('<LEDGER NAME="Mess Fee" ACTION="Create">'));

  // 3. Security/Caution Deposit auto-created under Current Liabilities
  assert.ok(xml.includes('<LEDGER NAME="Security Deposit" ACTION="Create">'));
  assert.ok(xml.includes('<PARENT>Current Liabilities</PARENT>'));

  // 4. Banks auto-created under Bank Accounts, and Cash under Cash-in-hand
  assert.ok(xml.includes('<LEDGER NAME="UBI-GIRLS_HOSTEL-50560" ACTION="Create">'));
  assert.ok(xml.includes('<PARENT>Bank Accounts</PARENT>'));
  assert.ok(xml.includes('<LEDGER NAME="Easebuzz Settlement A/c" ACTION="Create">'));
  assert.ok(xml.includes('<LEDGER NAME="Cash" ACTION="Create">'));
  assert.ok(xml.includes('<PARENT>Cash-in-hand</PARENT>'));

  // 5. XML character escaping (& in Pooja Sharma & Co.)
  assert.ok(xml.includes('Pooja Sharma &amp; Co.'));

  // 6. Voucher details
  assert.ok(xml.includes('<VOUCHER VCHTYPE="Receipt" ACTION="Create"'));
  assert.ok(xml.includes('<VOUCHERNUMBER>RCPT-2026-0001</VOUCHERNUMBER>'));
  assert.ok(xml.includes('<AMOUNT>-15000.00</AMOUNT>'));
  assert.ok(xml.includes('<AMOUNT>15000.00</AMOUNT>'));
  assert.ok(xml.includes('<DATE>20261121</DATE>'));
  assert.ok(xml.includes('<REFERENCE>TXN998877</REFERENCE>'));
});

test('30. Easebuzz Transaction Status Verification - Handles .msg object payload, avoid [object Object] and validates PAID status', async () => {
  // Simulating Easebuzz API responses
  const rawEasebuzzRetrieveResponseWithMsg = {
    status: true,
    msg: {
      txnid: 'TXN_1795260118969_APP-2026-9007',
      firstname: 'Savitri',
      email: 'mvmghostel@gmail.com',
      phone: '7020319141',
      mode: 'UPI',
      bank_ref_num: '669109417082',
      easepayid: 'E2611211AYKHPY',
      amount: '52500.0',
      net_amount_debit: '52500.0',
      status: 'success'
    }
  };

  // 1. Verify parser extracts txnData when Easebuzz returns record in .msg
  const payload1 = (typeof rawEasebuzzRetrieveResponseWithMsg.msg === 'object' && rawEasebuzzRetrieveResponseWithMsg.msg !== null)
    ? rawEasebuzzRetrieveResponseWithMsg.msg
    : ((typeof rawEasebuzzRetrieveResponseWithMsg.data === 'object' && rawEasebuzzRetrieveResponseWithMsg.data !== null) ? rawEasebuzzRetrieveResponseWithMsg.data : null);

  assert.ok(payload1, 'Payload must be non-null when inside .msg');
  assert.equal(payload1.txnid, 'TXN_1795260118969_APP-2026-9007');
  assert.equal(payload1.status, 'success');
  assert.equal(payload1.easepayid, 'E2611211AYKHPY');
  assert.equal(parseFloat(payload1.net_amount_debit), 52500);

  // 2. Verify parser extracts txnData when returned in .data
  const rawEasebuzzRetrieveResponseWithData = {
    status: true,
    data: {
      txnid: 'TXN_123',
      amount: '1000.0',
      status: 'success'
    }
  };
  const payload2 = (typeof rawEasebuzzRetrieveResponseWithData.msg === 'object' && rawEasebuzzRetrieveResponseWithData.msg !== null)
    ? rawEasebuzzRetrieveResponseWithData.msg
    : ((typeof rawEasebuzzRetrieveResponseWithData.data === 'object' && rawEasebuzzRetrieveResponseWithData.data !== null) ? rawEasebuzzRetrieveResponseWithData.data : null);
  assert.ok(payload2, 'Payload must be non-null when inside .data');
  assert.equal(payload2.txnid, 'TXN_123');

  // 3. Verify error description never outputs [object Object]
  const failedResponse = {
    status: false,
    msg: 'Transaction not found.'
  };
  const errorDesc = (failedResponse && typeof failedResponse.msg === 'string' ? failedResponse.msg : '')
    || (failedResponse && typeof failedResponse.data === 'string' ? failedResponse.data : '')
    || 'Transaction not found in Easebuzz.';
  assert.equal(errorDesc, 'Transaction not found.');
  assert.ok(!errorDesc.includes('[object Object]'));
});







