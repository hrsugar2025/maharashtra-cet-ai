// ============================================================
// AMG GIRLS' HOSTEL MANAGEMENT SYSTEM
// Google Apps Script Backend (Code.gs)
// Sheet ID: 1L-k5OH4GKs0oKZcHj1aaXdcWibcOh337ryA8WTQ2UIc
// ============================================================

var SHEET_ID = "1L-k5OH4GKs0oKZcHj1aaXdcWibcOh337ryA8WTQ2UIc";

// ── Execution-Level Singletons & Cache ───────────────────────
var _cachedSs = null;
var _cachedSheets = {};

function getSpreadsheet() {
  if (!_cachedSs) {
    _cachedSs = SpreadsheetApp.openById(SHEET_ID);
  }
  return _cachedSs;
}

// Helper: CacheService wrappers for master data
function getCachedJson(key) {
  try {
    var cache = CacheService.getScriptCache();
    var val = cache.get(key);
    if (val) return JSON.parse(val);
  } catch (e) {
    Logger.log("getCachedJson error (" + key + "): " + e.message);
  }
  return null;
}

function setCachedJson(key, data, ttlSeconds) {
  try {
    var cache = CacheService.getScriptCache();
    var str = JSON.stringify(data);
    if (str.length < 95000) {
      cache.put(key, str, ttlSeconds || 900);
    }
  } catch (e) {
    Logger.log("setCachedJson error (" + key + "): " + e.message);
  }
}

function clearCacheKeys(keys) {
  try {
    var cache = CacheService.getScriptCache();
    cache.removeAll(keys);
  } catch (e) {
    Logger.log("clearCacheKeys error: " + e.message);
  }
}

// ── Entry Point (Ultra-Fast Gated Migrations) ────────────────
function doGet(e) {
  try {
    var props = PropertiesService.getScriptProperties();
    var migrationsDone = props.getProperty("MIGRATIONS_V2_APPLIED");
    if (!migrationsDone) {
      checkAndMigrateDates();
      ensureAcademicYearColumns();
      ensureUserStatusColumn();
      ensurePhysicalReportingColumns();
      fixExistingBiAnnuallyDates();
      fixSpecificReceiptData();
      cleanupDuplicateStudent_APP_2026_6272();
      cleanupDuplicateStudent_APP_2026_7625();
      reconcileAndAllotSakshiSunilKadam_GF20();
      reconcileActiveStudentsAndApplications();
      ensureFeePriorityHeader();
      findAndRemoveDuplicateLedgerRows();
      ensureServiceRequestsSheet();
      ensureRollbackAuditLogsSheet();
      props.setProperty("MIGRATIONS_V2_APPLIED", "true");
      Logger.log("One-time migrations executed and marked completed.");
    }
    var physMigrationDone = props.getProperty("MIGRATIONS_PHYS_REPORTING_V1");
    if (!physMigrationDone) {
      ensurePhysicalReportingColumns();
      props.setProperty("MIGRATIONS_PHYS_REPORTING_V1", "true");
      Logger.log("Physical reporting migration completed.");
    }
    var reconMigrationDone = props.getProperty("MIGRATIONS_BANK_RECON_V1");
    if (!reconMigrationDone) {
      ensureBankReconciliationColumns();
      props.setProperty("MIGRATIONS_BANK_RECON_V1", "true");
      Logger.log("Bank reconciliation columns verified.");
    }
    var bankAccountsMigrationDone = props.getProperty("MIGRATIONS_BANK_ACCOUNTS_V1");
    if (!bankAccountsMigrationDone) {
      ensureBankAccountsSheet();
      props.setProperty("MIGRATIONS_BANK_ACCOUNTS_V1", "true");
      Logger.log("Bank accounts sheet verified.");
    }
    var collegeCoursesMigrationDone = props.getProperty("MIGRATIONS_COLLEGE_COURSES_V1");
    if (!collegeCoursesMigrationDone) {
      ensureCollegeCoursesSheet();
      props.setProperty("MIGRATIONS_COLLEGE_COURSES_V1", "true");
      Logger.log("College courses sheet verified.");
    }
    var targetCancelDone = props.getProperty("MIGRATION_TARGET_CANCELLATIONS_DONE");
    if (!targetCancelDone) {
      cancelTargetStudentsAdmissions();
      props.setProperty("MIGRATION_TARGET_CANCELLATIONS_DONE", "true");
      Logger.log("Target student admission cancellations executed.");
    }
    var bamsBhmsMigrationDone = props.getProperty("MIGRATIONS_BAMS_BHMS_COLLEGE_V1");
    if (!bamsBhmsMigrationDone) {
      repairCollegeNamesBamsBhms();
      props.setProperty("MIGRATIONS_BAMS_BHMS_COLLEGE_V1", "true");
      Logger.log("BAMS / BHMS college names standardized.");
    }
    var specificStudentsDone = props.getProperty("MIGRATIONS_SPECIFIC_STUDENTS_V2");
    if (!specificStudentsDone) {
      updateSpecificStudentCollegesAndCourses();
      props.setProperty("MIGRATIONS_SPECIFIC_STUDENTS_V2", "true");
      Logger.log("Specific student college/course updates V2 executed.");
    }
  } catch (err) {
    Logger.log("Initialization error: " + err.message);
  }
  
  return HtmlService.createTemplateFromFile("Index")
    .evaluate()
    .setTitle("AMG Girls' Hostel Management System")
    .addMetaTag("viewport", "width=device-width, initial-scale=1")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// Helper: include HTML files
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// Helper: get spreadsheet sheet — uses memoized spreadsheet and per-execution sheet cache
function getSheet(sheetName) {
  if (_cachedSheets[sheetName]) {
    return _cachedSheets[sheetName];
  }
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    var allNames = ss.getSheets().map(function(s){ return s.getName(); }).join(", ");
    throw new Error(
      'Sheet "' + sheetName + '" not found. ' +
      'Your actual sheet tabs are: [' + allNames + ']. ' +
      'Please rename the tab to exactly "' + sheetName + '" and try again.'
    );
  }
  _cachedSheets[sheetName] = sheet;
  return sheet;
}

// Diagnostic: call this from Apps Script to see all your sheet tab names
function getSheetNames() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var names = ss.getSheets().map(function(s){ return s.getName(); });
  Logger.log('Sheet tabs found: ' + names.join(' | '));
  return { success: true, data: names };
}

// Helper: generate unique ID with prefix
function generateId(prefix) {
  var now = new Date();
  var year = now.getFullYear();
  var rand = Math.floor(1000 + Math.random() * 9000);
  return prefix + "-" + year + "-" + rand;
}

// Helper: format today's date as dd-MMM-yyyy
function todayFormatted() {
  var d = new Date();
  return Utilities.formatDate(d, Session.getScriptTimeZone(), "dd-MMM-yyyy");
}

// Helper: format cell value to dd-MMM-yyyy string format
function formatDateValue(val) {
  if (!val) return "";
  
  var d;
  if (val instanceof Date) {
    d = val;
  } else {
    var str = val.toString().trim();
    if (str === "") return "";
    
    // If it's already in the target dd-mmm-yyyy format, return it directly
    var matchTarget = str.match(/^(\d{2})-([A-Za-z]{3})-(\d{4})$/);
    if (matchTarget) {
      var monthStr = matchTarget[2].charAt(0).toUpperCase() + matchTarget[2].slice(1).toLowerCase();
      return matchTarget[1] + "-" + monthStr + "-" + matchTarget[3];
    }
    
    // Try to parse format DD/MM/YYYY or DD-MM-YYYY
    var matchDMY = str.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
    if (matchDMY) {
      var day = parseInt(matchDMY[1], 10);
      var month = parseInt(matchDMY[2], 10) - 1;
      var year = parseInt(matchDMY[3], 10);
      d = new Date(year, month, day);
    } else {
      // Try parsing with standard JS
      d = new Date(str);
    }
  }
  
  if (isNaN(d.getTime())) {
    return val.toString();
  }
  
  var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var day = d.getDate();
  var monthStr = months[d.getMonth()];
  var year = d.getFullYear();
  var dayStr = day < 10 ? "0" + day : day.toString();
  
  return dayStr + "-" + monthStr + "-" + year;
}

// Helper: normalize academic year string (e.g. "2026-2027" -> "2026-27")
function normalizeYearString(yr) {
  if (!yr) return "";
  var s = yr.toString().trim();
  var m = s.match(/^(\d{4})\s*[-–/]\s*(\d{2,4})$/);
  if (m) {
    var end = m[2].length === 4 ? m[2].slice(-2) : m[2];
    return m[1] + "-" + end;
  }
  return s;
}

// Helper: robustly check if two academic year strings refer to the same year
function isAcademicYearMatch(rowYear, targetYear) {
  if (!targetYear || targetYear === "All" || !rowYear) return true;
  var ry = rowYear.toString().trim();
  var ty = targetYear.toString().trim();
  if (!ry || !ty || ty.toLowerCase() === "all") return true;
  if (ry === ty) return true;

  var normR = normalizeYearString(ry);
  var normT = normalizeYearString(ty);
  if (normR === normT) return true;

  var matchR = normR.match(/\d{4}/);
  var matchT = normT.match(/\d{4}/);
  if (matchR && matchT && matchR[0] === matchT[0]) return true;

  return false;
}

// ── 1. LOGIN ─────────────────────────────────────────────────
function loginUser(email, password) {
  try {
    ensureUserStatusColumn();
    var cleanEmail = (email || "").toString().trim().toLowerCase();
    var cleanPass = (password || "").toString().trim();
    if (!cleanEmail || !cleanPass) {
      return { success: false, message: "Please enter both email and password." };
    }

    var sheet = getSheet("USERS");
    var data = sheet.getDataRange().getValues();
    for (var i = 0; i < data.length; i++) {
      var row = data[i];
      // Skip header row or empty rows
      if (!row[0] || row[0].toString().trim().toUpperCase() === "USER_ID") continue;
      // Columns: USER_ID(0), NAME(1), EMAIL(2), PASSWORD(3), ROLE(4), STATUS(5)
      if ((row[2] || "").toString().trim().toLowerCase() === cleanEmail &&
          (row[3] || "").toString().trim() === cleanPass) {
        
        var status = (row[5] || "Active").toString().trim();
        if (status !== "Active") {
          return { success: false, message: "Invalid credentials: This account has been disabled." };
        }
        
        var role = (row[4] || "Staff").toString().trim();
        var studentDetails = null;
        if (role.toLowerCase() === "student") {
          studentDetails = getStudentExtraInfoByEmail(cleanEmail);
          if (!studentDetails.appId || (studentDetails.status || "").toLowerCase() !== "approved") {
            return { success: false, message: "Login unavailable: Your admission application has not been approved yet." };
          }
          if (!studentDetails.roomNumber) {
            return { success: false, message: "Login unavailable: Room allotment is pending. Only students with an allotted room can log in." };
          }
        }
        
        return {
          success: true,
          userId: row[0].toString().trim(),
          name: (row[1] || "").toString().trim(),
          email: (row[2] || "").toString().trim(),
          role: role,
          studentDetails: studentDetails
        };
      }
    }

    // Fallback: Check if student exists in STUDENT_APPLICATIONS and password matches mobile number or student123
    var studentExtra = getStudentExtraInfoByEmail(cleanEmail);
    if (studentExtra && studentExtra.appId) {
      // STRICT CHECK: Only approved students with an active room allotment can access
      if ((studentExtra.status || "").toLowerCase() !== "approved") {
        return { success: false, message: "Login unavailable: Your admission application has not been approved yet." };
      }
      if (!studentExtra.roomNumber) {
        return { success: false, message: "Login unavailable: Room allotment is pending. Only students with an allotted room can log in." };
      }

      var contactNum = (studentExtra.contactNumber || "").replace(/\D/g, "");
      var parentContactNum = (studentExtra.parentContact || "").replace(/\D/g, "");
      var passNum = cleanPass.replace(/\D/g, "");
      
      var isMatch = false;
      if (cleanPass === studentExtra.contactNumber || (contactNum && passNum === contactNum)) {
        isMatch = true;
      } else if (cleanPass === studentExtra.parentContact || (parentContactNum && passNum === parentContactNum)) {
        isMatch = true;
      } else if (cleanPass === "student123" || cleanPass === "Student@123") {
        isMatch = true;
      }

      if (isMatch) {
        // Auto-seed into USERS table so future logins and edits are tracked
        var newUserId = generateId("USR");
        sheet.appendRow([
          newUserId,
          studentExtra.studentName || "Student",
          cleanEmail,
          cleanPass,
          "Student",
          "Active"
        ]);

        return {
          success: true,
          userId: newUserId,
          name: studentExtra.studentName,
          email: cleanEmail,
          role: "Student",
          studentDetails: studentExtra
        };
      }
    }

    return { success: false, message: "Invalid email or password." };
  } catch (err) {
    return { success: false, message: "Error: " + err.message };
  }
}

// ══════════════════════════════════════════════════════════════
// ── PERFORMANCE ACCELERATION: BUNDLED ASYNCHRONOUS ENDPOINTS ──
// ══════════════════════════════════════════════════════════════

function getAppBootstrapBundle(academicYear) {
  try {
    var activeYear = getActiveAcademicYear();
    var viewingYear = academicYear || activeYear;

    // 1. Settings (Cached)
    var settingsRes = getSettings();
    var settings = settingsRes.success ? settingsRes.data : {};

    // 2. Room Types & Fee Structures (Cached)
    var roomTypesRes = getRoomTypes(false);
    var feeStructuresRes = getFeeStructures();
    var manualTypesRes = getManualFeeTypes();

    // 3. Fast In-Memory Dashboard Calculation
    var appsRes = getStudentApplications("All", viewingYear);
    var apps = appsRes.success ? (appsRes.data || []) : [];
    var pendingCount = 0;
    var approvedCount = 0;
    for (var i = 0; i < apps.length; i++) {
      var st = (apps[i].status || "").toLowerCase();
      if (st === "pending") pendingCount++;
      if (st === "approved") approvedCount++;
    }
    var recentApps = apps.slice(-5).reverse();

    // Occupancy
    var occRes = getOccupancyReport(viewingYear);
    var occData = occRes.success ? occRes.data : { totalCapacity: 0, totalOccupied: 0, totalAvailable: 0 };

    // Month fee collection
    var now = new Date();
    var months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    var feeRes = getFeeCollectionReport(months[now.getMonth()], now.getFullYear(), viewingYear);
    var curMonthFee = feeRes.success ? (feeRes.data ? feeRes.data.totalAmount : 0) : 0;

    // Outstanding Dues
    var pendingRes = getAllPendingFees("Pending", viewingYear);
    var pendingList = pendingRes.success ? (pendingRes.data || []) : [];
    var totalOutstanding = 0;
    var byStudent = {};
    for (var p = 0; p < pendingList.length; p++) {
      var e = pendingList[p];
      totalOutstanding += (e.balance || 0);
      var sName = e.studentName || "Unknown";
      if (!byStudent[sName]) {
        byStudent[sName] = {
          name: sName,
          room: e.roomNumber || "-",
          balance: 0,
          count: 0,
          contactNumber: e.contactNumber || ""
        };
      }
      byStudent[sName].balance += (e.balance || 0);
      byStudent[sName].count++;
    }
    var studentKeys = Object.keys(byStudent).sort(function(a, b){
      return byStudent[b].balance - byStudent[a].balance;
    });
    var topPendingStudents = studentKeys.slice(0, 10).map(function(k){ return byStudent[k]; });

    // Physical Stay & Allotment Reporting stats
    var allotRes = getRoomAllotments(viewingYear);
    var allAllots = (allotRes && allotRes.success && allotRes.data) ? allotRes.data : [];
    var feeBalancesRes = getStudentFeeBalances(viewingYear);
    var feeBalances = (feeBalancesRes && feeBalancesRes.success && feeBalancesRes.data) ? feeBalancesRes.data : {};

    var physicallyStayingCount = 0;
    var allottedPaidNotReportedCount = 0;
    var allottedUnpaidNotReportedCount = 0;
    var activeAllotmentsCount = 0;

    for (var al = 0; al < allAllots.length; al++) {
      var allotItem = allAllots[al];
      if ((allotItem.status || "").toLowerCase() === "active") {
        activeAllotmentsCount++;
        var pStatus = (allotItem.physicalStatus || "").toLowerCase();
        var isReported = (pStatus === "reported" || pStatus === "physically staying");
        if (isReported) {
          physicallyStayingCount++;
        } else {
          var sAppId = allotItem.appId;
          var sBal = feeBalances[sAppId];
          var hasPaid = (sBal && (parseFloat(sBal.paid) || 0) > 0);
          if (hasPaid) {
            allottedPaidNotReportedCount++;
          } else {
            allottedUnpaidNotReportedCount++;
          }
        }
      }
    }

    var bundle = {
      settings: settings,
      activeAcademicYear: activeYear,
      viewingAcademicYear: viewingYear,
      roomTypes: roomTypesRes.data || [],
      feeStructures: feeStructuresRes.data || [],
      manualFeeTypes: manualTypesRes.data || [],
      dashboard: {
        totalStudents: approvedCount,
        pendingCount: pendingCount,
        totalAllotted: activeAllotmentsCount,
        physicallyStaying: physicallyStayingCount,
        allottedPaidNotReported: allottedPaidNotReportedCount,
        allottedUnpaidNotReported: allottedUnpaidNotReportedCount,
        recentApps: recentApps,
        occupancy: {
          totalCapacity: occData.totalCapacity || 0,
          totalOccupied: occData.totalOccupied || 0,
          totalAvailable: occData.totalAvailable || 0
        },
        currentMonthFee: curMonthFee,
        totalOutstanding: Math.round(totalOutstanding * 100) / 100,
        topPendingStudents: topPendingStudents
      }
    };

    return { success: true, data: bundle };
  } catch (err) {
    Logger.log("getAppBootstrapBundle error: " + err.message);
    return { success: false, message: err.message };
  }
}

function getAllotmentsBundle(academicYear) {
  try {
    var year = academicYear || getActiveAcademicYear();
    
    // 1. Fee Balances
    var feeBalancesRes = getStudentFeeBalances(year);
    var feeBalances = feeBalancesRes.success ? (feeBalancesRes.data || {}) : {};

    // 2. Room Allotments
    var allotmentsRes = getRoomAllotments(year);
    var allotments = allotmentsRes.success ? (allotmentsRes.data || []) : [];

    // 3. Room List
    var roomsRes = getRooms();
    var rooms = roomsRes.success ? (roomsRes.data || []) : [];

    // 4. Approved Unallotted Students for Dropdown
    var appSheet = getSheet("STUDENT_APPLICATIONS");
    var appData = appSheet.getDataRange().getValues();
    var approvedStudents = [];
    var allottedAppIds = {};
    for (var a = 0; a < allotments.length; a++) {
      var aSt = (allotments[a].status || "").toString().trim().toLowerCase();
      if (aSt === "active" && allotments[a].appId) {
        allottedAppIds[allotments[a].appId.toString().trim()] = true;
      }
    }
    for (var i = 1; i < appData.length; i++) {
      var row = appData[i];
      if (!row[0] || row[0].toString().trim().toUpperCase() === "APP_ID") continue;
      var curSt = (row[19] || "").toString().trim().toLowerCase();
      var appId = row[0].toString().trim();
      if (curSt === "approved" && !allottedAppIds[appId]) {
        approvedStudents.push({
          appId: appId,
          studentName: (row[2] || "").toString().trim(),
          roomTypePreference: (row[18] || "").toString().trim(),
          contactNumber: (row[6] || "").toString().trim()
        });
      }
    }

    return {
      success: true,
      data: {
        allotments: allotments,
        feeBalances: feeBalances,
        rooms: rooms,
        eligibleStudents: approvedStudents
      }
    };
  } catch (err) {
    Logger.log("getAllotmentsBundle error: " + err.message);
    return { success: false, message: err.message };
  }
}

function getFeesBundle(academicYear) {
  try {
    var year = academicYear || getActiveAcademicYear();
    var rcptsRes = getFeeReceipts(null, null);
    var pendingRes = getAllPendingFees("Pending", year);

    // Active allotted students for payment dropdown
    var allotSheet = getSheet("ROOM_ALLOTMENTS");
    var allotData = allotSheet.getDataRange().getValues();
    var studentsMap = {};
    for (var a = 1; a < allotData.length; a++) {
      var aRow = allotData[a];
      if (!aRow[0] || aRow[0].toString().trim().toUpperCase() === "ALLOTMENT_ID") continue;
      if ((aRow[9] || "").toString().trim().toLowerCase() === "active") {
        var aId = (aRow[1] || "").toString().trim();
        if (aId) {
          studentsMap[aId] = {
            appId: aId,
            studentName: (aRow[2] || "").toString().trim(),
            roomNumber: (aRow[4] || "").toString().trim(),
            roomType: (aRow[5] || "").toString().trim()
          };
        }
      }
    }

    return {
      success: true,
      data: {
        receipts: rcptsRes.success ? (rcptsRes.data || []) : [],
        pendingFees: pendingRes.success ? (pendingRes.data || []) : [],
        students: Object.keys(studentsMap).map(function(k){ return studentsMap[k]; })
      }
    };
  } catch (err) {
    Logger.log("getFeesBundle error: " + err.message);
    return { success: false, message: err.message };
  }
}

function forceRunAllSystemReconciliations() {
  try {
    checkAndMigrateDates();
    ensureAcademicYearColumns();
    ensureUserStatusColumn();
    ensurePhysicalReportingColumns();
    fixExistingBiAnnuallyDates();
    fixSpecificReceiptData();
    cleanupDuplicateStudent_APP_2026_6272();
    cleanupDuplicateStudent_APP_2026_7625();
    reconcileAndAllotSakshiSunilKadam_GF20();
    reconcileActiveStudentsAndApplications();
    ensureFeePriorityHeader();
    findAndRemoveDuplicateLedgerRows();
    ensureServiceRequestsSheet();
    ensureRollbackAuditLogsSheet();
    clearCacheKeys(["CACHE_ROOM_TYPES_ALL", "CACHE_FEE_STRUCTURES", "CACHE_SETTINGS", "CACHE_MANUAL_FEE_TYPES", "CACHE_BOOTSTRAP"]);
    PropertiesService.getScriptProperties().setProperty("MIGRATIONS_V2_APPLIED", "true");
    return { success: true, message: "All system reconciliations and maintenance checks executed successfully." };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ── 2. SETTINGS ──────────────────────────────────────────────
function getSettings() {
  try {
    var cached = getCachedJson("CACHE_SETTINGS");
    if (cached) return { success: true, data: cached, fromCache: true };
    var sheet = getSheet("SETTINGS");
    var data = sheet.getDataRange().getValues();
    var settings = {};
    for (var i = 0; i < data.length; i++) {
      if (!data[i][0] || data[i][0].toString().trim().toUpperCase() === "SETTING_KEY") continue;
      settings[data[i][0].toString().trim()] = data[i][1];
    }
    setCachedJson("CACHE_SETTINGS", settings, 1800);
    return { success: true, data: settings };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function normalizeCollegeName(col) {
  if (!col) return "";
  var s = col.toString().trim();
  var lower = s.toLowerCase();
  if (lower === "bams" || lower === "b.a.m.s." || lower === "bams college" || (lower.indexOf("bams") !== -1 && lower.indexOf("amamchrc") === -1)) {
    return "AMAMCHRC (BAMS)";
  }
  if (lower === "bhms" || lower === "b.h.m.s." || lower === "bhms college" || (lower.indexOf("bhms") !== -1 && lower.indexOf("amhmch") === -1)) {
    return "AMHMCH (BHMS)";
  }
  if (lower === "ampv" || lower === "a.m.p.v." || lower === "ampv diploma" || lower === "ampv polytechnic" || (lower.indexOf("ampv") !== -1 && lower.indexOf("diploma") === -1)) {
    return "AMPV (DIPLOMA)";
  }
  if (lower === "amson" || lower === "amson gnm" || lower === "amson nursing" || (lower.indexOf("amson") !== -1 && lower.indexOf("gnm") === -1)) {
    return "AMSON (GNM)";
  }
  return s;
}

function sendStudentToSupabase(studentObj) {
  try {
    var SUPABASE_URL = "https://bhfiyrorfxvabquxmeiv.supabase.co";
    var SUPABASE_KEY = "sb_publishable_woMsdVpSPa7mKfHOeGGK8Q_paTZlW3K";
    var headers = {
      "Content-Type": "application/json",
      "apikey": SUPABASE_KEY,
      "Authorization": "Bearer " + SUPABASE_KEY,
      "Prefer": "resolution=merge-duplicates"
    };

    var payload = [{
      app_id: studentObj.appId || studentObj.app_id || ("APP-" + new Date().getFullYear() + "-" + Math.floor(1000 + Math.random() * 9000)),
      full_name: studentObj.studentName || studentObj.full_name || "",
      father_name: studentObj.fatherName || studentObj.father_name || "",
      mother_name: studentObj.motherName || studentObj.mother_name || "",
      dob: studentObj.dateOfBirth || studentObj.dob || "",
      contact_number: studentObj.contactNumber || studentObj.contact_number || "",
      parent_contact: studentObj.parentContact || studentObj.parent_contact || "",
      email: studentObj.email || "",
      address: studentObj.address || "",
      city: studentObj.city || "",
      state: studentObj.state || "Maharashtra",
      course: studentObj.course || "",
      year_of_study: studentObj.yearOfStudy || studentObj.year_of_study || "",
      college_name: studentObj.collegeName || studentObj.college_name || "AMGOI",
      aadhar_number: studentObj.aadharNumber || studentObj.aadhar_number || "",
      emergency_contact_name: studentObj.emergencyContactName || studentObj.emergency_contact_name || "",
      emergency_contact_number: studentObj.emergencyContactNumber || studentObj.emergency_contact_number || "",
      room_type: studentObj.roomTypePreference || studentObj.room_type || "Classic Tripple",
      status: studentObj.status || "Pending",
      physical_status: studentObj.physicalStatus || studentObj.physical_status || "Not Reported",
      academic_year: studentObj.academicYear || studentObj.academic_year || getActiveAcademicYear()
    }];

    var urlTarget = SUPABASE_URL + "/rest/v1/students?on_conflict=app_id";
    var opts = {
      method: "post",
      headers: headers,
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    var res = UrlFetchApp.fetch(urlTarget, opts);
    Logger.log("Supabase direct sync response (" + res.getResponseCode() + "): " + res.getContentText());
  } catch (err) {
    Logger.log("Error sending student to Supabase: " + err.message);
  }
}

// ── 3. STUDENT APPLICATIONS ──────────────────────────────────
function submitStudentApplication(formData) {
  try {
    var sheet = getSheet("STUDENT_APPLICATIONS");
    var appId = formData.appId || generateId("APP");
    formData.appId = appId;
    var today = todayFormatted();

    sheet.appendRow([
      appId,                          // A: APP_ID
      today,                          // B: SUBMISSION_DATE
      formData.studentName,           // C: STUDENT_NAME
      formData.fatherName,            // D: FATHER_NAME
      formData.motherName,            // E: MOTHER_NAME
      formData.dateOfBirth,           // F: DATE_OF_BIRTH
      formData.contactNumber,         // G: CONTACT_NUMBER
      formData.parentContact,         // H: PARENT_CONTACT
      formData.email,                 // I: EMAIL
      formData.address,               // J: ADDRESS
      formData.city,                  // K: CITY
      formData.state,                 // L: STATE
      formData.course,                // M: COURSE
      formData.yearOfStudy,           // N: YEAR_OF_STUDY
      normalizeCollegeName(formData.collegeName), // O: COLLEGE_NAME
      formData.aadharNumber,          // P: AADHAR_NUMBER
      formData.emergencyContactName,  // Q: EMERGENCY_CONTACT_NAME
      formData.emergencyContactNumber,// R: EMERGENCY_CONTACT_NUMBER
      formData.roomTypePreference,    // S: ROOM_TYPE_PREFERENCE
      formData.status || "Pending",   // T: STATUS
      "",                             // U: REVIEWED_BY
      "",                             // V: REVIEW_DATE
      "",                             // W: REMARKS
      getActiveAcademicYear()         // X: ACADEMIC_YEAR
    ]);

    // Instantly sync to Supabase Cloud Database!
    sendStudentToSupabase(formData);

    return { success: true, appId: appId };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function getStudentApplications(statusFilter, academicYear) {
  try {
    try { syncFormResponsesToApplications(); } catch (se) { Logger.log("Auto-sync form responses: " + se.message); }
    var sheet = getSheet("STUDENT_APPLICATIONS");
    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return { success: true, data: [] };

    var headerRow = data[0] || [];
    var acadYearCol = -1;
    for (var c = 0; c < headerRow.length; c++) {
      var h = (headerRow[c] || "").toString().trim().toUpperCase().replace(/[\s_-]+/g, "_");
      if (h === "ACADEMIC_YEAR" || h === "ACAD_YEAR") {
        acadYearCol = c;
        break;
      }
    }
    if (acadYearCol === -1) acadYearCol = 23;
    var activeYear = getActiveAcademicYear();

    var results = [];
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      // Skip empty rows AND header row (APP_ID is the header text)
      if (!row[0]) continue;
      if (row[0].toString().trim().toUpperCase() === "APP_ID") continue;
      var status = (row[19] || "").toString().trim(); // Column T: STATUS
      var rowAcadYear = (acadYearCol < row.length && row[acadYearCol] !== undefined && row[acadYearCol] !== null) ? row[acadYearCol].toString().trim() : "";
      var matchAcadYear = !academicYear || academicYear === "All" || !rowAcadYear || rowAcadYear === academicYear || (normalizeYearString(rowAcadYear) === normalizeYearString(academicYear));
      if (matchAcadYear) {
        var matchStatus = !statusFilter || statusFilter === "All" || status.toLowerCase() === statusFilter.toString().trim().toLowerCase();
        if (matchStatus) {
          results.push({
            rowIndex: i + 1, // 1-indexed for sheet operations
            appId: row[0].toString().trim(),
            submissionDate: formatDateValue(row[1]),
            studentName: (row[2] || "").toString().trim(),
            fatherName: (row[3] || "").toString().trim(),
            motherName: (row[4] || "").toString().trim(),
            dateOfBirth: formatDateValue(row[5]),
            contactNumber: (row[6] || "").toString().trim(),
            parentContact: (row[7] || "").toString().trim(),
            email: (row[8] || "").toString().trim(),
            address: (row[9] || "").toString().trim(),
            city: (row[10] || "").toString().trim(),
            state: (row[11] || "").toString().trim(),
            course: (row[12] || "").toString().trim(),
            yearOfStudy: (row[13] || "").toString().trim(),
            collegeName: (row[14] || "").toString().trim(),
            aadharNumber: (row[15] || "").toString().trim(),
            emergencyContactName: (row[16] || "").toString().trim(),
            emergencyContactNumber: (row[17] || "").toString().trim(),
            roomTypePreference: (row[18] || "").toString().trim(),
            status: status,
            reviewedBy: (row[20] || "").toString().trim(),
            reviewDate: formatDateValue(row[21]),
            remarks: (row[22] || "").toString().trim(),
            academicYear: rowAcadYear
          });
        }
      }
    }
    return { success: true, data: results };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function updateApplicationStatus(appId, newStatus, reviewedBy, remarks, updatedRoomPreference) {
  try {
    var sheet = getSheet("STUDENT_APPLICATIONS");
    var data = sheet.getDataRange().getValues();
    for (var i = 0; i < data.length; i++) {
      if (!data[i][0] || data[i][0].toString().trim().toUpperCase() === "APP_ID") continue;
      if (data[i][0].toString().trim() === appId.toString().trim()) {
        var rowNum = i + 1; // 1-indexed sheet row
        sheet.getRange(rowNum, 20).setValue(newStatus);       // Column T: STATUS
        sheet.getRange(rowNum, 21).setValue(reviewedBy);      // Column U: REVIEWED_BY
        sheet.getRange(rowNum, 22).setValue(todayFormatted());// Column V: REVIEW_DATE
        sheet.getRange(rowNum, 23).setValue(remarks || "");   // Column W: REMARKS
        
        if (updatedRoomPreference !== undefined && updatedRoomPreference !== null && updatedRoomPreference !== "") {
          sheet.getRange(rowNum, 19).setValue(updatedRoomPreference); // Column S: ROOM_TYPE_PREFERENCE
        }
        return { success: true };
      }
    }
    return { success: false, message: "Application ID not found: " + appId };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function updateApplicationDetailsAndStatus(appId, studentData, newStatus, reviewedBy, remarks) {
  try {
    var sheet = getSheet("STUDENT_APPLICATIONS");
    var data = sheet.getDataRange().getValues();
    for (var i = 0; i < data.length; i++) {
      if (!data[i][0] || data[i][0].toString().trim().toUpperCase() === "APP_ID") continue;
      if (data[i][0].toString().trim() === appId.toString().trim()) {
        var rowNum = i + 1; // 1-indexed sheet row
        
        // Update student info fields if provided
        if (studentData) {
          if (studentData.studentName !== undefined) sheet.getRange(rowNum, 3).setValue(studentData.studentName); // Column C
          if (studentData.fatherName !== undefined) sheet.getRange(rowNum, 4).setValue(studentData.fatherName);   // Column D
          if (studentData.motherName !== undefined) sheet.getRange(rowNum, 5).setValue(studentData.motherName);   // Column E
          if (studentData.dateOfBirth !== undefined) sheet.getRange(rowNum, 6).setValue(studentData.dateOfBirth); // Column F
          if (studentData.contactNumber !== undefined) sheet.getRange(rowNum, 7).setValue(studentData.contactNumber); // Column G
          if (studentData.parentContact !== undefined) sheet.getRange(rowNum, 8).setValue(studentData.parentContact); // Column H
          if (studentData.email !== undefined) sheet.getRange(rowNum, 9).setValue(studentData.email);             // Column I
          if (studentData.address !== undefined) sheet.getRange(rowNum, 10).setValue(studentData.address);        // Column J
          if (studentData.city !== undefined) sheet.getRange(rowNum, 11).setValue(studentData.city);              // Column K
          if (studentData.state !== undefined) sheet.getRange(rowNum, 12).setValue(studentData.state);           // Column L
          if (studentData.course !== undefined) sheet.getRange(rowNum, 13).setValue(studentData.course);           // Column M
          if (studentData.yearOfStudy !== undefined) sheet.getRange(rowNum, 14).setValue(studentData.yearOfStudy); // Column N
          if (studentData.collegeName !== undefined) sheet.getRange(rowNum, 15).setValue(normalizeCollegeName(studentData.collegeName)); // Column O
          if (studentData.aadharNumber !== undefined) sheet.getRange(rowNum, 16).setValue(studentData.aadharNumber); // Column P
          if (studentData.emergencyContactName !== undefined) sheet.getRange(rowNum, 17).setValue(studentData.emergencyContactName); // Column Q
          if (studentData.emergencyContactNumber !== undefined) sheet.getRange(rowNum, 18).setValue(studentData.emergencyContactNumber); // Column R
          if (studentData.roomTypePreference !== undefined) sheet.getRange(rowNum, 19).setValue(studentData.roomTypePreference); // Column S
        }
        
        // Update status fields if provided
        if (newStatus) {
          sheet.getRange(rowNum, 20).setValue(newStatus);       // Column T: STATUS
          sheet.getRange(rowNum, 21).setValue(reviewedBy || ""); // Column U: REVIEWED_BY
          sheet.getRange(rowNum, 22).setValue(todayFormatted()); // Column V: REVIEW_DATE
          sheet.getRange(rowNum, 23).setValue(remarks || "");   // Column W: REMARKS
        }
        
        return { success: true };
      }
    }
    return { success: false, message: "Application ID not found: " + appId };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ── 4. ROOMS ─────────────────────────────────────────────────
function getRooms(availableOnly) {
  try {
    var sheet = getSheet("ROOMS");
    var data = sheet.getDataRange().getValues();
    var results = [];
    for (var i = 0; i < data.length; i++) {
      var row = data[i];
      if (!row[0]) continue;
      if (row[0].toString().trim().toUpperCase() === "ROOM_ID") continue; // skip header
      var capacity = parseInt(row[4]) || 0;
      var occupied = parseInt(row[5]) || 0;
      var available = capacity - occupied;
      if (availableOnly && available <= 0) continue;
      results.push({
        rowIndex: i + 1,
        roomId: row[0].toString().trim(),
        roomNumber: (row[1] || "").toString().trim(),
        floor: (row[2] || "").toString().trim(),
        roomType: (row[3] || "").toString().trim(),
        capacity: capacity,
        occupied: occupied,
        available: available
      });
    }
    return { success: true, data: results };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ── 5. ROOM ALLOTMENT ─────────────────────────────────────────
function allotRoom(appId, studentName, roomId, roomNumber, roomType, allottedBy, expectedVacatingDate) {
  try {
    // Check if student already has an active allotment
    var allotSheet = getSheet("ROOM_ALLOTMENTS");
    var allotData = allotSheet.getDataRange().getValues();
    for (var i = 0; i < allotData.length; i++) {
      if (!allotData[i][0] || allotData[i][0].toString().trim().toUpperCase() === "ALLOTMENT_ID") continue;
      if (allotData[i][1].toString().trim() === appId.toString().trim() &&
          allotData[i][9].toString().trim() === "Active") {
        return { success: false, message: "Student already has an active room allotment." };
      }
    }

    // Add allotment record
    var allotId = generateId("ALLOT");
    allotSheet.appendRow([
      allotId,              // A: ALLOTMENT_ID
      appId,                // B: APP_ID
      studentName,          // C: STUDENT_NAME
      roomId,               // D: ROOM_ID
      roomNumber,           // E: ROOM_NUMBER
      roomType,             // F: ROOM_TYPE
      todayFormatted(),     // G: ALLOTMENT_DATE
      expectedVacatingDate, // H: EXPECTED_VACATING_DATE
      "",                   // I: ACTUAL_VACATING_DATE
      "Active",             // J: STATUS
      allottedBy,           // K: ALLOTTED_BY
      getActiveAcademicYear(), // L: ACADEMIC_YEAR
      "Not Reported",       // M: PHYSICAL_STATUS
      "",                   // N: REPORTING_DATE
      "",                   // O: REPORTED_VERIFIED_BY
      ""                    // P: REPORTING_REMARKS
    ]);

    // Update ROOMS sheet occupied count
    var roomsSheet = getSheet("ROOMS");
    var roomsData = roomsSheet.getDataRange().getValues();
    for (var j = 0; j < roomsData.length; j++) {
      if (!roomsData[j][0] || roomsData[j][0].toString().trim().toUpperCase() === "ROOM_ID") continue;
      if (roomsData[j][0].toString().trim() === roomId.toString().trim()) {
        var currentOccupied = parseInt(roomsData[j][5]) || 0;
        roomsSheet.getRange(j + 1, 6).setValue(currentOccupied + 1); // Column F: OCCUPIED
        break;
      }
    }

    try {
      var appSheet = getSheet("STUDENT_APPLICATIONS");
      var appData = appSheet.getDataRange().getValues();
      for (var k = 1; k < appData.length; k++) {
        if (appData[k][0] && appData[k][0].toString().trim() === appId.toString().trim()) {
          var sEmail = (appData[k][8] || "").toString().trim();
          var sContact = (appData[k][6] || "").toString().trim();
          if (sEmail) {
            ensureStudentUserAccount(appId, studentName, sEmail, sContact);
          }
          // Ensure application status is set to Approved upon room allotment
          if ((appData[k][19] || "").toString().trim().toLowerCase() !== "approved") {
            appSheet.getRange(k + 1, 20).setValue("Approved");
            if (!appData[k][20]) appSheet.getRange(k + 1, 21).setValue(allottedBy || "Admin");
            if (!appData[k][21]) appSheet.getRange(k + 1, 22).setValue(todayFormatted());
          }
          break;
        }
      }
    } catch (e) {
      Logger.log("Error auto-seeding student account on allotment: " + e.message);
    }

    return { success: true, allotId: allotId };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function getRoomAllotments(academicYear) {
  try {
    try {
      ensurePhysicalReportingColumns();
    } catch (colErr) {
      Logger.log("getRoomAllotments ensurePhysicalReportingColumns error: " + colErr.message);
    }
    try {
      reconcileAndAllotSakshiSunilKadam_GF20();
    } catch (sakErr) {
      Logger.log("getRoomAllotments Sakshi GF20 reconcile error: " + sakErr.message);
    }
    var sheet = getSheet("ROOM_ALLOTMENTS");
    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return { success: true, data: [] };

    var headerRow = data[0] || [];
    var acadYearCol = -1, physCol = -1, repDateCol = -1, verByCol = -1, remCol = -1;
    for (var c = 0; c < headerRow.length; c++) {
      var h = (headerRow[c] || "").toString().trim().toUpperCase().replace(/[\s_-]+/g, "_");
      if (h === "ACADEMIC_YEAR" || h === "ACAD_YEAR") {
        acadYearCol = c;
      } else if (h === "PHYSICAL_STATUS" || h === "REPORTING_STATUS") {
        physCol = c;
      } else if (h === "REPORTING_DATE") {
        repDateCol = c;
      } else if (h === "REPORTED_VERIFIED_BY" || h === "VERIFIED_BY") {
        verByCol = c;
      } else if (h === "REPORTING_REMARKS") {
        remCol = c;
      }
    }
    if (acadYearCol === -1) acadYearCol = 11;
    if (physCol === -1) physCol = 12;
    if (repDateCol === -1) repDateCol = 13;
    if (verByCol === -1) verByCol = 14;
    if (remCol === -1) remCol = 15;
    var activeYear = getActiveAcademicYear();

    var appSheet = getSheet("STUDENT_APPLICATIONS");
    var appData = appSheet.getDataRange().getValues();
    var contactMap = {};
    for (var j = 0; j < appData.length; j++) {
      var appRow = appData[j];
      if (appRow[0]) {
        contactMap[appRow[0].toString().trim()] = {
          contactNumber: (appRow[6] || "").toString().trim(),
          parentContact: (appRow[7] || "").toString().trim()
        };
      }
    }

    var results = [];
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (!row[0]) continue;
      if (row[0].toString().trim().toUpperCase() === "ALLOTMENT_ID") continue; // skip header
      var rowAcadYear = (acadYearCol < row.length && row[acadYearCol] !== undefined && row[acadYearCol] !== null) ? row[acadYearCol].toString().trim() : "";
      var matchAcadYear = !academicYear || academicYear === "All" || !rowAcadYear || rowAcadYear === academicYear || (normalizeYearString(rowAcadYear) === normalizeYearString(academicYear));
      if (matchAcadYear) {
        var rowAppId = (row[1] || "").toString().trim();
        var contacts = contactMap[rowAppId] || { contactNumber: "", parentContact: "" };
        var pStatus = (physCol < row.length && row[physCol] !== undefined && row[physCol] !== null) ? row[physCol].toString().trim() : "";
        if (!pStatus) pStatus = "Not Reported";
        var rDate = (repDateCol < row.length && row[repDateCol] !== undefined && row[repDateCol] !== null) ? formatDateValue(row[repDateCol]) : "";
        var vBy = (verByCol < row.length && row[verByCol] !== undefined && row[verByCol] !== null) ? row[verByCol].toString().trim() : "";
        var rRemarks = (remCol < row.length && row[remCol] !== undefined && row[remCol] !== null) ? row[remCol].toString().trim() : "";

        results.push({
          allotmentId: row[0].toString().trim(),
          appId: rowAppId,
          studentName: (row[2] || "").toString().trim(),
          roomId: (row[3] || "").toString().trim(),
          roomNumber: (row[4] || "").toString().trim(),
          roomType: (row[5] || "").toString().trim(),
          allotmentDate: formatDateValue(row[6]),
          expectedVacatingDate: formatDateValue(row[7]),
          actualVacatingDate: formatDateValue(row[8]),
          status: (row[9] || "").toString().trim(),
          allottedBy: (row[10] || "").toString().trim(),
          academicYear: rowAcadYear,
          contactNumber: contacts.contactNumber,
          parentContact: contacts.parentContact,
          physicalStatus: pStatus,
          reportingDate: rDate,
          reportedVerifiedBy: vBy,
          reportingRemarks: rRemarks
        });
      }
    }
    return { success: true, data: results };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function vacateRoom(allotmentId, allottedBy) {
  try {
    var allotSheet = getSheet("ROOM_ALLOTMENTS");
    var allotData = allotSheet.getDataRange().getValues();
    for (var i = 0; i < allotData.length; i++) {
      if (!allotData[i][0] || allotData[i][0].toString().trim().toUpperCase() === "ALLOTMENT_ID") continue;
      if (allotData[i][0].toString().trim() === allotmentId.toString().trim()) {
        var roomId = allotData[i][3].toString().trim();
        allotSheet.getRange(i + 1, 9).setValue(todayFormatted()); // I: ACTUAL_VACATING_DATE
        allotSheet.getRange(i + 1, 10).setValue("Vacated");       // J: STATUS

        // Decrease occupied count in ROOMS sheet
        var roomsSheet = getSheet("ROOMS");
        var roomsData = roomsSheet.getDataRange().getValues();
        for (var j = 0; j < roomsData.length; j++) {
          if (!roomsData[j][0] || roomsData[j][0].toString().trim().toUpperCase() === "ROOM_ID") continue;
          if (roomsData[j][0].toString().trim() === roomId) {
            var currentOccupied = parseInt(roomsData[j][5]) || 0;
            roomsSheet.getRange(j + 1, 6).setValue(Math.max(0, currentOccupied - 1));
            break;
          }
        }
        return { success: true };
      }
    }
    return { success: false, message: "Allotment record not found." };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ── 6. FEE RECEIPTS & RECONCILIATION ─────────────────────────

function normalizeFeeHeadName(name) {
  if (!name) return "";
  return name.toString()
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, " ")
    .replace(/\b(charges|fee|fees|rent|amount)\b/g, "")
    .trim();
}

function isFeeHeadMatch(feeTypeA, feeTypeB) {
  if (!feeTypeA || !feeTypeB) return false;
  var a = feeTypeA.toString().trim().toLowerCase();
  var b = feeTypeB.toString().trim().toLowerCase();
  if (a === b) return true;

  var na = normalizeFeeHeadName(a);
  var nb = normalizeFeeHeadName(b);
  if (na && nb && na === nb) return true;
  if (na && nb && (na.indexOf(nb) !== -1 || nb.indexOf(na) !== -1)) return true;

  var synonyms = [
    ["hostel", "room", "accommodation", "rent", "stay", "monthly hostel"],
    ["mess", "food", "dining", "canteen", "meal"],
    ["deposit", "security", "caution"],
    ["admission", "registration", "joining", "enrollment"],
    ["linen", "bedding", "kit"]
  ];

  for (var i = 0; i < synonyms.length; i++) {
    var group = synonyms[i];
    var aIn = false, bIn = false;
    for (var j = 0; j < group.length; j++) {
      if (a.indexOf(group[j]) !== -1) aIn = true;
      if (b.indexOf(group[j]) !== -1) bIn = true;
    }
    if (aIn && bIn) return true;
  }

  return false;
}

// ── CANONICAL FEE TYPE NORMALIZATION & ALLOCATION ENGINE ───────
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

function formatReceiptDisplayFeeType(rawFt, totalAmt) {
  if (!rawFt) return '';
  var allocations = parseReceiptFeeAllocations(rawFt, totalAmt);
  if (allocations.length > 1) {
    return allocations.map(function(a) {
      return a.type + ' (₹' + a.amount.toLocaleString('en-IN') + ')';
    }).join(', ');
  }
  return normalizeFeeTypeName(rawFt);
}

// Add fee receipt and automatically settle against student dues
function addFeeReceipt(feeData) {
  try {
    var sheet = getSheet("FEE_RECEIPTS");
    var receiptId = generateId("RCPT");
    var date = todayFormatted();
    var year = feeData.feeYear || new Date().getFullYear();
    var amountPaid = parseFloat(feeData.amountPaid) || 0;
    var appId = (feeData.appId || "").toString().trim();
    var feeType = (feeData.feeType || "").toString().trim();

    var allocatedLedgerIds = {};
    var ldgSheet = getSheet("STUDENT_FEE_LEDGER");
    var ldgData = ldgSheet.getDataRange().getValues();

    // Ensure student fee ledger exists
    var studentHasLedger = false;
    for (var i = 1; i < ldgData.length; i++) {
      if (ldgData[i][1] && ldgData[i][1].toString().trim() === appId) {
        studentHasLedger = true;
        break;
      }
    }

    if (!studentHasLedger && appId) {
      var allotSheet = getSheet("ROOM_ALLOTMENTS");
      var allotData = allotSheet.getDataRange().getValues();
      for (var a = 1; a < allotData.length; a++) {
        if (allotData[a][1] && allotData[a][1].toString().trim() === appId && (allotData[a][9] || "").toString().trim() === "Active") {
          applyFeeStructureOnAllotment(appId, allotData[a][2], allotData[a][4], allotData[a][5], allotData[a][6], true);
          break;
        }
      }
      ldgData = ldgSheet.getDataRange().getValues();
    }

    // Match and settle against dues in STUDENT_FEE_LEDGER
    var remaining = amountPaid;
    var matchingIndices = [];
    for (var j = 1; j < ldgData.length; j++) {
      if (!ldgData[j][0] || ldgData[j][0].toString().trim().toUpperCase() === "LEDGER_ID") continue;
      if ((ldgData[j][1] || "").toString().trim() !== appId) continue;
      if ((ldgData[j][12] || "").toString().trim().toLowerCase() === "cancelled") continue;

      var hName = (ldgData[j][6] || "").toString().trim();
      if (isFeeHeadMatch(hName, feeType)) {
        matchingIndices.push(j);
      }
    }

    // Prioritize month if provided
    if (feeData.feeMonth && feeData.feeMonth !== "N/A" && feeData.feeMonth !== "") {
      var targetM = feeData.feeMonth.toString().trim().toLowerCase();
      matchingIndices.sort(function(a, b) {
        var aM = (ldgData[a][7] || "").toString().toLowerCase().indexOf(targetM) !== -1 ? 1 : 0;
        var bM = (ldgData[b][7] || "").toString().toLowerCase().indexOf(targetM) !== -1 ? 1 : 0;
        if (aM !== bM) return bM - aM;
        var dueA = parseDueDayToTimestamp(ldgData[a][11]);
        var dueB = parseDueDayToTimestamp(ldgData[b][11]);
        return dueA - dueB;
      });
    }

    for (var k = 0; k < matchingIndices.length && remaining > 0; k++) {
      var idx = matchingIndices[k];
      var bal = parseFloat(ldgData[idx][10]) || 0;
      if (bal <= 0) continue;

      var alloc = Math.min(bal, remaining);
      var curPaid = parseFloat(ldgData[idx][9]) || 0;
      var appAmt = parseFloat(ldgData[idx][8]) || 0;
      var newPaid = curPaid + alloc;
      var newBal = Math.max(0, appAmt - newPaid);
      var newStatus = newBal <= 0 ? "Paid" : "Partial";

      ldgData[idx][9] = newPaid;
      ldgData[idx][10] = newBal;
      ldgData[idx][12] = newStatus;

      allocatedLedgerIds[ldgData[idx][0].toString().trim()] = alloc;
      remaining -= alloc;
    }

    // If no matching head existed or remaining > 0 for custom fee type, create custom ledger row
    if (matchingIndices.length === 0 && remaining > 0) {
      var newLdgId = generateId("LDG");
      var customRow = [
        newLdgId,
        appId,
        feeData.studentName,
        feeData.roomNumber,
        "CUSTOM",
        "CUSTOM",
        feeType,
        feeData.feeMonth || "On Payment",
        remaining,
        remaining,
        0,
        todayFormatted(),
        "Paid",
        todayFormatted(),
        getActiveAcademicYear()
      ];
      if (ldgSheet.getMaxColumns() < 15) {
        ldgSheet.insertColumnsAfter(ldgSheet.getMaxColumns(), 15 - ldgSheet.getMaxColumns());
      }
      var sRow = ldgSheet.getLastRow() + 1;
      ldgSheet.getRange(sRow, 1, 1, 15).setValues([customRow]);
      allocatedLedgerIds[newLdgId] = remaining;
      remaining = 0;
    } else if (matchingIndices.length > 0) {
      ldgSheet.getRange(1, 1, ldgData.length, ldgData[0].length).setValues(ldgData);
    }

    var ldgIdStr = "";
    var aKeys = Object.keys(allocatedLedgerIds);
    if (aKeys.length === 1) {
      ldgIdStr = aKeys[0];
    } else if (aKeys.length > 1) {
      ldgIdStr = JSON.stringify(allocatedLedgerIds);
    }

    sheet.appendRow([
      receiptId,                      // A: RECEIPT_ID
      date,                           // B: RECEIPT_DATE
      appId,                          // C: APP_ID
      feeData.studentName,            // D: STUDENT_NAME
      feeData.roomNumber,             // E: ROOM_NUMBER
      feeType,                        // F: FEE_TYPE
      amountPaid,                     // G: AMOUNT_PAID
      feeData.paymentMode,            // H: PAYMENT_MODE
      feeData.transactionId || "",    // I: TRANSACTION_ID
      feeData.feeMonth || "",         // J: FEE_MONTH
      year,                           // K: FEE_YEAR
      feeData.collectedBy,            // L: COLLECTED_BY
      feeData.remarks || "",          // M: REMARKS
      "Active",                       // N: STATUS
      ldgIdStr || feeData.ledgerId || "", // O: LEDGER_ID
      getActiveAcademicYear()         // P: ACADEMIC_YEAR
    ]);

    SpreadsheetApp.flush();

    var receiptObj = {
      receiptId: receiptId,
      receiptDate: date,
      appId: appId,
      studentName: feeData.studentName,
      roomNumber: feeData.roomNumber,
      feeType: feeType,
      amountPaid: amountPaid,
      paymentMode: feeData.paymentMode,
      transactionId: feeData.transactionId || "",
      feeMonth: feeData.feeMonth || "",
      feeYear: year,
      collectedBy: feeData.collectedBy,
      remarks: feeData.remarks || "",
      status: "Active",
      ledgerId: ldgIdStr || feeData.ledgerId || "",
      academicYear: getActiveAcademicYear()
    };

    return { success: true, receiptId: receiptId, receipt: receiptObj, settled: true, allocated: allocatedLedgerIds };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// Reconcile and settle all active receipts against student dues
function reconcileAllFeeReceipts(targetAppId) {
  try {
    var receiptSheet = getSheet("FEE_RECEIPTS");
    var receiptData = receiptSheet.getDataRange().getValues();
    if (receiptData.length <= 1) {
      return { success: true, receiptsUpdated: 0, studentsUpdated: 0, message: "No receipts found to reconcile." };
    }

    var ledgerSheet = getSheet("STUDENT_FEE_LEDGER");
    var ledgerData = ledgerSheet.getDataRange().getValues();

    // Map student name to App ID from active room allotments
    var allotSheet = getSheet("ROOM_ALLOTMENTS");
    var allotData = allotSheet.getDataRange().getValues();
    var allotMap = {};
    var nameToAppId = {};

    for (var a = 1; a < allotData.length; a++) {
      var aRow = allotData[a];
      if (!aRow[0] || aRow[0].toString().trim().toUpperCase() === "ALLOTMENT_ID") continue;
      var aid = (aRow[1] || "").toString().trim();
      var sName = (aRow[2] || "").toString().trim();
      if (aid) {
        if (sName) nameToAppId[sName.toLowerCase()] = aid;
        if ((aRow[9] || "").toString().trim() === "Active") {
          allotMap[aid] = {
            studentName: sName,
            roomNumber: (aRow[4] || "").toString().trim(),
            roomType: (aRow[5] || "").toString().trim(),
            allotmentDate: aRow[6] ? aRow[6].toString().trim() : ""
          };
        }
      }
    }

    // 1. Group active receipts by appId
    var receiptsByStudent = {};
    for (var r = 1; r < receiptData.length; r++) {
      var row = receiptData[r];
      if (!row || !row[0] || row[0].toString().trim().toUpperCase() === "RECEIPT_ID") continue;
      var rStatus = (row[13] || "Active").toString().trim().toLowerCase();
      if (rStatus === "cancelled") continue; // skip cancelled receipts

      var rAppId = (row[2] || "").toString().trim();
      var rStudentName = (row[3] || "").toString().trim();

      // Resolve appId from student name if missing
      if (!rAppId && rStudentName && nameToAppId[rStudentName.toLowerCase()]) {
        rAppId = nameToAppId[rStudentName.toLowerCase()];
        receiptSheet.getRange(r + 1, 3).setValue(rAppId);
        row[2] = rAppId;
      }

      if (!rAppId) continue;
      if (targetAppId && rAppId.toLowerCase() !== targetAppId.toString().trim().toLowerCase()) continue;

      if (!receiptsByStudent[rAppId]) receiptsByStudent[rAppId] = [];
      receiptsByStudent[rAppId].push({
        rowIndex: r + 1,
        receiptId: row[0].toString().trim(),
        date: row[1],
        appId: rAppId,
        studentName: rStudentName,
        roomNumber: (row[4] || "").toString().trim(),
        feeType: (row[5] || "").toString().trim(),
        amountPaid: parseFloat(row[6]) || 0,
        feeMonth: (row[9] || "").toString().trim(),
        feeYear: (row[10] || "").toString().trim(),
        academicYear: (row[15] || "").toString().trim(),
        currentLedgerId: (row[14] || "").toString().trim()
      });
    }

    // Ensure fee ledger entries exist for all students being reconciled
    for (var sAppId in receiptsByStudent) {
      var hasLedger = false;
      for (var l = 1; l < ledgerData.length; l++) {
        if (ledgerData[l][1] && ledgerData[l][1].toString().trim() === sAppId) {
          hasLedger = true;
          break;
        }
      }
      if (!hasLedger && allotMap[sAppId]) {
        var aInfo = allotMap[sAppId];
        applyFeeStructureOnAllotment(sAppId, aInfo.studentName, aInfo.roomNumber, aInfo.roomType, aInfo.allotmentDate, true);
      }
    }

    // Refresh ledger data
    ledgerData = ledgerSheet.getDataRange().getValues();

    // 2. Reset standard ledger entries to original applicable amounts for reconciled students
    var ledgerRowsByStudent = {};
    for (var l = 1; l < ledgerData.length; l++) {
      var lRow = ledgerData[l];
      if (!lRow[0] || lRow[0].toString().trim().toUpperCase() === "LEDGER_ID") continue;
      var lStatus = (lRow[12] || "").toString().trim().toLowerCase();
      if (lStatus === "cancelled") continue;

      var lAppId = (lRow[1] || "").toString().trim();
      if (!lAppId) continue;
      if (targetAppId && lAppId.toLowerCase() !== targetAppId.toString().trim().toLowerCase()) continue;

      if (receiptsByStudent[lAppId]) {
        var appAmt = parseFloat(lRow[8]) || 0;
        lRow[9] = 0;           // PAID_AMOUNT
        lRow[10] = appAmt;     // BALANCE
        lRow[12] = "Pending";  // STATUS
      }

      if (!ledgerRowsByStudent[lAppId]) ledgerRowsByStudent[lAppId] = [];
      ledgerRowsByStudent[lAppId].push({
        rowIndex: l + 1,
        ledgerId: lRow[0].toString().trim(),
        headId: (lRow[5] || "").toString().trim(),
        headName: (lRow[6] || "").toString().trim(),
        applicableMonth: (lRow[7] || "").toString().trim(),
        applicableAmount: parseFloat(lRow[8]) || 0,
        paidAmount: 0,
        balance: parseFloat(lRow[8]) || 0,
        dueDate: lRow[11],
        dueDateTimestamp: parseDueDayToTimestamp(lRow[11]),
        status: "Pending",
        dataRowIndex: l,
        academicYear: (lRow[14] || "").toString().trim()
      });
    }

    var receiptsUpdated = 0;
    var studentsUpdated = 0;
    var newCustomLedgerRows = [];

    // 3. Settle receipts student by student
    for (var sAppId in receiptsByStudent) {
      var studentReceipts = receiptsByStudent[sAppId];
      var studentLedger = ledgerRowsByStudent[sAppId] || [];

      // Sort student ledger chronologically
      studentLedger.sort(function(a, b) {
        return a.dueDateTimestamp - b.dueDateTimestamp;
      });

      for (var r = 0; r < studentReceipts.length; r++) {
        var rcpt = studentReceipts[r];
        var remainingAmount = rcpt.amountPaid;
        if (remainingAmount <= 0) continue;

        var allocatedLedgerIds = {};

        // Find candidate ledger rows matching this fee type
        var matchingEntries = studentLedger.filter(function(entry) {
          var headMatch = isFeeHeadMatch(entry.headName, rcpt.feeType);
          var yrMatch = !rcpt.academicYear || !entry.academicYear || (normalizeYearString(rcpt.academicYear) === normalizeYearString(entry.academicYear));
          return headMatch && yrMatch;
        });

        if (matchingEntries.length === 0) {
          matchingEntries = studentLedger.filter(function(entry) {
            return isFeeHeadMatch(entry.headName, rcpt.feeType);
          });
        }

        // If rcpt has a specific feeMonth, sort matching entries to prioritize that month
        if (rcpt.feeMonth && rcpt.feeMonth !== "N/A" && rcpt.feeMonth !== "") {
          var targetMonth = rcpt.feeMonth.toString().trim().toLowerCase();
          matchingEntries.sort(function(a, b) {
            var aMatch = a.applicableMonth.toLowerCase().indexOf(targetMonth) !== -1 ? 1 : 0;
            var bMatch = b.applicableMonth.toLowerCase().indexOf(targetMonth) !== -1 ? 1 : 0;
            if (aMatch !== bMatch) return bMatch - aMatch;
            return a.dueDateTimestamp - b.dueDateTimestamp;
          });
        }

        // Allocate across matching entries with balance > 0
        for (var m = 0; m < matchingEntries.length && remainingAmount > 0; m++) {
          var entry = matchingEntries[m];
          if (entry.balance <= 0) continue;

          var allocAmt = Math.min(entry.balance, remainingAmount);
          entry.paidAmount += allocAmt;
          entry.balance -= allocAmt;
          entry.status = entry.balance <= 0 ? "Paid" : "Partial";
          remainingAmount -= allocAmt;

          allocatedLedgerIds[entry.ledgerId] = allocAmt;

          var dIdx = entry.dataRowIndex;
          ledgerData[dIdx][9] = entry.paidAmount;
          ledgerData[dIdx][10] = entry.balance;
          ledgerData[dIdx][12] = entry.status;
        }

        // If no matching fee head existed in the ledger, create a settled custom ledger entry
        if (matchingEntries.length === 0 && remainingAmount > 0) {
          var newLdgId = generateId("LDG");
          var customRow = [
            newLdgId,
            rcpt.appId,
            rcpt.studentName,
            rcpt.roomNumber,
            "CUSTOM",
            "CUSTOM",
            rcpt.feeType,
            rcpt.feeMonth || "On Payment",
            remainingAmount,
            remainingAmount,
            0,
            formatDateValue(rcpt.date) || todayFormatted(),
            "Paid",
            todayFormatted(),
            rcpt.academicYear || getActiveAcademicYear()
          ];
          newCustomLedgerRows.push(customRow);
          allocatedLedgerIds[newLdgId] = remainingAmount;
          remainingAmount = 0;
        }

        var ldgIdStr = "";
        var allocKeys = Object.keys(allocatedLedgerIds);
        if (allocKeys.length === 1) {
          ldgIdStr = allocKeys[0];
        } else if (allocKeys.length > 1) {
          ldgIdStr = JSON.stringify(allocatedLedgerIds);
        }

        if (ldgIdStr && ldgIdStr !== rcpt.currentLedgerId) {
          receiptSheet.getRange(rcpt.rowIndex, 15).setValue(ldgIdStr); // O: LEDGER_ID
        }
        receiptsUpdated++;
      }
      studentsUpdated++;
    }

    // Write updated ledgerData back to STUDENT_FEE_LEDGER
    if (ledgerData.length > 1) {
      ledgerSheet.getRange(1, 1, ledgerData.length, ledgerData[0].length).setValues(ledgerData);
    }

    // Append any new custom ledger rows
    if (newCustomLedgerRows.length > 0) {
      if (ledgerSheet.getMaxColumns() < 15) {
        ledgerSheet.insertColumnsAfter(ledgerSheet.getMaxColumns(), 15 - ledgerSheet.getMaxColumns());
      }
      var startRow = ledgerSheet.getLastRow() + 1;
      ledgerSheet.getRange(startRow, 1, newCustomLedgerRows.length, 15).setValues(newCustomLedgerRows);
    }

    SpreadsheetApp.flush();

    return {
      success: true,
      receiptsUpdated: receiptsUpdated,
      studentsUpdated: studentsUpdated,
      message: "Successfully reconciled and settled " + receiptsUpdated + " fee receipts across " + studentsUpdated + " student(s)."
    };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function getFeeReceipts(appId, academicYear) {
  try {
    var sheet = getSheet("FEE_RECEIPTS");
    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return { success: true, data: [] };

    var headerRow = data[0] || [];
    var acadYearCol = -1;
    for (var c = 0; c < headerRow.length; c++) {
      var h = (headerRow[c] || "").toString().trim().toUpperCase().replace(/[\s_-]+/g, "_");
      if (h === "ACADEMIC_YEAR" || h === "ACAD_YEAR") {
        acadYearCol = c;
        break;
      }
    }
    if (acadYearCol === -1) acadYearCol = 15;
    var activeYear = getActiveAcademicYear();

    var results = [];
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (!row || !row[0]) continue;
      var receiptId = row[0].toString().trim();
      if (receiptId.toUpperCase() === "RECEIPT_ID") continue;

      var rowAcadYear = (acadYearCol < row.length && row[acadYearCol] !== undefined && row[acadYearCol] !== null) 
        ? row[acadYearCol].toString().trim() 
        : "";

      var matchAcadYear = isAcademicYearMatch(rowAcadYear, academicYear);
      if (!matchAcadYear && academicYear && academicYear !== "All") {
        var dateStr = formatDateValue(row[1]);
        var dateYear = (dateStr.match(/\d{4}/) || [])[0];
        var feeYearVal = (row[10] || "").toString().trim();
        if (isAcademicYearMatch(dateYear, academicYear) || isAcademicYearMatch(feeYearVal, academicYear)) {
          matchAcadYear = true;
        }
      }
      if (matchAcadYear) {
        var rowAppId = (row[2] || "").toString().trim();
        if (!appId || rowAppId === appId.toString().trim()) {
          var pMode = (row[7] || "").toString().trim();
          var isCash = pMode.toLowerCase() === "cash";
          var rawReconStatus = (row[16] || "").toString().trim();
          var reconStatus = rawReconStatus ? rawReconStatus : (isCash ? "N/A (Cash)" : "Unreconciled");

          results.push({
            receiptId:       receiptId,
            receiptDate:     formatDateValue(row[1]),
            appId:           rowAppId,
            studentName:     (row[3]  || "").toString().trim(),
            roomNumber:      (row[4]  || "").toString().trim(),
            feeType:         (row[5]  || "").toString().trim(),
            amountPaid:      parseFloat(row[6]) || 0,
            paymentMode:     pMode,
            transactionId:   (row[8]  || "").toString().trim(),
            feeMonth:        (row[9]  || "").toString().trim(),
            feeYear:         (row[10] || "").toString().trim(),
            collectedBy:     (row[11] || "").toString().trim(),
            remarks:         (row[12] || "").toString().trim(),
            status:          (row[13] || "Active").toString().trim(),
            ledgerId:        (row[14] || "").toString().trim(),
            academicYear:    rowAcadYear || activeYear,
            reconStatus:     reconStatus,
            reconBank:       (row[17] || "").toString().trim(),
            reconCreditDate: formatDateValue(row[18]),
            reconRefNo:      (row[19] || "").toString().trim(),
            reconRemarks:    (row[20] || "").toString().trim(),
            reconciledBy:    (row[21] || "").toString().trim(),
            reconciledAt:    formatDateValue(row[22])
          });
        }
      }
    }
    return { success: true, data: results };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ── 7. REPORTS ───────────────────────────────────────────────
// Report 1: Occupancy Report
function getOccupancyReport(academicYear) {
  try {
    if (!academicYear || academicYear === "All") {
      academicYear = getActiveAcademicYear();
    }
    
    var roomsResult = getRooms(false);
    if (!roomsResult.success) return roomsResult;
    var rooms = roomsResult.data || [];
    
    var allotResult = getRoomAllotments(academicYear);
    var allotments = (allotResult && allotResult.success && allotResult.data) ? allotResult.data : [];
    
    var occupancies = {};
    allotments.forEach(function(a) {
      if ((a.status || "").toString().trim().toLowerCase() === "active") {
        var rId = (a.roomId || "").toString().trim();
        if (rId) {
          occupancies[rId] = (occupancies[rId] || 0) + 1;
        }
      }
    });
    
    var totalCapacity = 0, totalOccupied = 0, totalAvailable = 0;
    var byType = {};
    var byFloor = {};

    var updatedRooms = rooms.map(function(r) {
      var rId = (r.roomId || "").toString().trim();
      var occ = occupancies[rId] || 0;
      var cap = parseInt(r.capacity) || 0;
      var avail = Math.max(0, cap - occ);
      
      totalCapacity += cap;
      totalOccupied += occ;
      totalAvailable += avail;

      var rType = r.roomType || "Standard";
      var rFloor = r.floor || "1";

      if (!byType[rType]) byType[rType] = { capacity: 0, occupied: 0, available: 0 };
      byType[rType].capacity += cap;
      byType[rType].occupied += occ;
      byType[rType].available += avail;

      if (!byFloor[rFloor]) byFloor[rFloor] = { capacity: 0, occupied: 0, available: 0 };
      byFloor[rFloor].capacity += cap;
      byFloor[rFloor].occupied += occ;
      byFloor[rFloor].available += avail;
      
      return {
        roomId: rId,
        roomNumber: r.roomNumber,
        floor: rFloor,
        roomType: rType,
        capacity: cap,
        occupied: occ,
        available: avail
      };
    });

    return {
      success: true,
      data: {
        totalCapacity: totalCapacity,
        totalOccupied: totalOccupied,
        totalAvailable: totalAvailable,
        occupancyPercent: totalCapacity > 0 ? Math.round((totalOccupied / totalCapacity) * 100) : 0,
        byType: byType,
        byFloor: byFloor,
        rooms: updatedRooms
      }
    };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// Report 2: Fee Collection Report
function getFeeCollectionReport(month, year, academicYear, fromDate, toDate, feeType) {
  try {
    var feesResult = getFeeReceipts(null, academicYear);
    if (!feesResult.success) return feesResult;
    var fees = feesResult.data || [];

    // Collect all available fee types from the receipts before filtering
    var feeTypesSet = {
      "ACCOMODATION CHARGES": true,
      "MESS CHARGES": true,
      "SECURITY DEPOSIT (REFUNDABLE)": true,
      "Hostel Linen Charges": true
    };
    fees.forEach(function(f) {
      var amtPaid = parseFloat(f.amountPaid) || 0;
      var allocations = parseReceiptFeeAllocations(f.feeType, amtPaid);
      allocations.forEach(function(a) {
        if (a.type && a.type !== "Other") feeTypesSet[a.type] = true;
      });
    });
    var availableFeeTypes = Object.keys(feeTypesSet).sort();

    var monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    var monthAbbr = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

    // Date parsing helper
    function parseDateToTime(str) {
      if (!str) return null;
      if (str instanceof Date) return isNaN(str.getTime()) ? null : str.getTime();
      var s = str.toString().trim();
      if (!s) return null;
      
      var mYmd = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
      if (mYmd) {
        return new Date(parseInt(mYmd[1], 10), parseInt(mYmd[2], 10) - 1, parseInt(mYmd[3], 10)).getTime();
      }
      
      var monthMap = {jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};
      var mDmyNamed = s.match(/^(\d{1,2})[-/ ]([A-Za-z]{3,9})[-/ ](\d{4})/);
      if (mDmyNamed) {
        var day = parseInt(mDmyNamed[1], 10);
        var mKey = mDmyNamed[2].toLowerCase().substring(0, 3);
        var yr = parseInt(mDmyNamed[3], 10);
        if (monthMap[mKey] !== undefined) {
          return new Date(yr, monthMap[mKey], day).getTime();
        }
      }
      
      var mDmy = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
      if (mDmy) {
        return new Date(parseInt(mDmy[3], 10), parseInt(mDmy[2], 10) - 1, parseInt(mDmy[1], 10)).getTime();
      }
      
      var d = new Date(s);
      return isNaN(d.getTime()) ? null : d.getTime();
    }

    var fromTime = parseDateToTime(fromDate);
    var toTime = parseDateToTime(toDate);
    var hasDateRange = (fromTime !== null || toTime !== null);

    var targetFeeType = (feeType && feeType.toString().trim() !== "" && feeType.toString().toLowerCase() !== "all")
      ? normalizeFeeTypeName(feeType)
      : "";

    var targetMonthIdx = -1;
    if (month && month.toString().trim() !== "" && month.toString().toLowerCase() !== "all" && month.toString().toLowerCase() !== "all months") {
      var mClean = month.toString().trim().toLowerCase();
      for (var mi = 0; mi < 12; mi++) {
        if (monthNames[mi].toLowerCase() === mClean || monthAbbr[mi].toLowerCase() === mClean) {
          targetMonthIdx = mi;
          break;
        }
      }
    }

    var targetYearStr = (year && year.toString().trim() !== "" && year.toString().toLowerCase() !== "all" && year.toString().toLowerCase() !== "all years")
      ? year.toString().trim()
      : "";

    var filtered = fees.filter(function(f) {
      if (f.status && f.status.toString().trim().toLowerCase() === "cancelled") {
        return false;
      }

      var rDateStr = (f.receiptDate || "").toString().trim();
      var rTime = parseDateToTime(rDateStr);

      // 1. Filter by Date Range (From & To)
      if (hasDateRange) {
        if (fromTime !== null && rTime !== null && rTime < fromTime) {
          return false;
        }
        if (toTime !== null && rTime !== null && rTime > (toTime + 86399999)) {
          return false;
        }
      }

      // 2. Filter by Fee Type
      if (targetFeeType !== "") {
        var rAmt = parseFloat(f.amountPaid) || 0;
        var allocs = parseReceiptFeeAllocations(f.rawFeeType || f.feeType, rAmt);
        var match = allocs.some(function(a) { return a.type === targetFeeType; });
        if (!match) return false;
      }

      // 3. Month & Year filter (if date range is not specified)
      if (!hasDateRange) {
        var rYear = "";
        var rMonthIdx = -1;

        var matchDmy = rDateStr.match(/^(\d{1,2})[-/ ]([A-Za-z]+)[-/ ](\d{4})$/);
        if (matchDmy) {
          rYear = matchDmy[3];
          var mStr = matchDmy[2].toLowerCase();
          for (var i = 0; i < 12; i++) {
            if (monthAbbr[i].toLowerCase() === mStr || monthNames[i].toLowerCase() === mStr) {
              rMonthIdx = i;
              break;
            }
          }
        } else if (rTime !== null) {
          var dObj = new Date(rTime);
          rYear = dObj.getFullYear().toString();
          rMonthIdx = dObj.getMonth();
        }

        if (!rYear && f.feeYear) {
          rYear = f.feeYear.toString().trim();
        }

        var fMonthStr = (f.feeMonth || "").toString().toLowerCase();
        var feeMonthIdx = -1;
        for (var j = 0; j < 12; j++) {
          if (fMonthStr.indexOf(monthNames[j].toLowerCase()) !== -1 || fMonthStr.indexOf(monthAbbr[j].toLowerCase()) !== -1) {
            feeMonthIdx = j;
            break;
          }
        }

        // Year filter
        if (targetYearStr !== "") {
          var yearMatches = (rYear === targetYearStr)
            || (f.feeYear && f.feeYear.toString().trim() === targetYearStr)
            || isAcademicYearMatch(targetYearStr, f.academicYear);
          if (!yearMatches) return false;
        }

        // Month filter
        if (targetMonthIdx !== -1) {
          var monthMatches = (rMonthIdx === targetMonthIdx) || (feeMonthIdx === targetMonthIdx);
          if (!monthMatches) return false;
        }
      } else {
        if (targetYearStr !== "") {
          var rYear2 = "";
          if (rTime !== null) rYear2 = new Date(rTime).getFullYear().toString();
          var yMatch = (rYear2 === targetYearStr) || (f.feeYear && f.feeYear.toString().trim() === targetYearStr);
          if (!yMatch) return false;
        }
      }

      return true;
    });

    var totalAmount = 0;
    var byType = {};
    var byMode = {};

    if (!targetFeeType) {
      availableFeeTypes.forEach(function(t) { byType[t] = 0; });
    } else {
      byType[targetFeeType] = 0;
    }

    filtered.forEach(function(f) {
      var amt = parseFloat(f.amountPaid) || 0;
      var allocs = parseReceiptFeeAllocations(f.rawFeeType || f.feeType, amt);

      if (targetFeeType) {
        var targetAlloc = allocs.find(function(a) { return a.type === targetFeeType; });
        var headAmt = targetAlloc ? targetAlloc.amount : amt;
        totalAmount += headAmt;
        byType[targetFeeType] = (byType[targetFeeType] || 0) + headAmt;
        var modeKey = (f.paymentMode || "Cash").trim();
        byMode[modeKey] = (byMode[modeKey] || 0) + headAmt;
      } else {
        totalAmount += amt;
        allocs.forEach(function(a) {
          byType[a.type] = (byType[a.type] || 0) + a.amount;
        });
        var modeKey = (f.paymentMode || "Cash").trim();
        byMode[modeKey] = (byMode[modeKey] || 0) + amt;
      }
    });

    // Clean zero-value non-core types & sort by collection descending
    var sortedByType = {};
    var coreOrder = ['ACCOMODATION CHARGES','MESS CHARGES','SECURITY DEPOSIT (REFUNDABLE)','Hostel Linen Charges'];
    Object.keys(byType).sort(function(a, b) {
      return (byType[b] || 0) - (byType[a] || 0);
    }).forEach(function(k) {
      if (byType[k] > 0 || coreOrder.indexOf(k) !== -1) {
        sortedByType[k] = byType[k];
      }
    });

    var sortedByMode = {};
    Object.keys(byMode).sort(function(a, b) {
      return (byMode[b] || 0) - (byMode[a] || 0);
    }).forEach(function(k) {
      sortedByMode[k] = byMode[k];
    });

    return {
      success: true,
      data: {
        totalAmount: totalAmount,
        totalReceipts: filtered.length,
        byType: sortedByType,
        byMode: sortedByMode,
        receipts: filtered,
        availableFeeTypes: availableFeeTypes
      }
    };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// Report 3: Student Register
function getStudentRegister(academicYear) {
  try {
    try {
      reconcileAndAllotSakshiSunilKadam_GF20();
    } catch (sakErr) {
      Logger.log("getStudentRegister Sakshi GF20 reconcile error: " + sakErr.message);
    }
    try {
      reconcileActiveStudentsAndApplications();
    } catch (recErr) {
      Logger.log("getStudentRegister reconcile error: " + recErr.message);
    }
    var appsResult = getStudentApplications("Approved", academicYear);
    if (!appsResult.success) return appsResult;
    var apps = appsResult.data || [];

    var allotResult = getRoomAllotments(academicYear);
    if (!allotResult.success) return allotResult;
    var allotments = allotResult.data || [];

    // Filter active allotments for this academic year (case-insensitive)
    var activeAllotments = allotments.filter(function(a) {
      return (a.status || "").toString().trim().toLowerCase() === "active";
    });

    // Create maps of active allotments by appId AND by studentName
    var allotMapByAppId = {};
    var allotMapByName = {};
    activeAllotments.forEach(function(a) {
      var aAid = (a.appId || "").toString().trim();
      var aName = (a.studentName || "").toString().trim().toLowerCase();
      if (aAid) allotMapByAppId[aAid] = a;
      if (aName) allotMapByName[aName] = a;
    });

    var matchedAllotmentIds = {};

    var register = apps.map(function(app) {
      var cleanAppId = (app.appId || "").toString().trim();
      var cleanAppName = (app.studentName || "").toString().trim().toLowerCase();
      
      // Match active allotment by appId OR by student name
      var allot = allotMapByAppId[cleanAppId] || allotMapByName[cleanAppName] || null;
      if (allot) {
        if (allot.allotmentId) matchedAllotmentIds[allot.allotmentId] = true;
      }

      return {
        appId: app.appId,
        submissionDate: app.submissionDate,
        studentName: app.studentName,
        fatherName: app.fatherName,
        motherName: app.motherName,
        dateOfBirth: app.dateOfBirth,
        contactNumber: (allot && allot.contactNumber) ? allot.contactNumber : app.contactNumber,
        parentContact: (allot && allot.parentContact) ? allot.parentContact : app.parentContact,
        email: app.email,
        address: app.address,
        city: app.city,
        state: app.state,
        course: app.course,
        yearOfStudy: app.yearOfStudy,
        collegeName: app.collegeName,
        aadharNumber: app.aadharNumber,
        emergencyContactName: app.emergencyContactName,
        emergencyContactNumber: app.emergencyContactNumber,
        roomTypePreference: app.roomTypePreference,
        status: app.status,
        remarks: app.remarks,
        roomNumber: (allot && allot.roomNumber) ? allot.roomNumber : "Not Allotted",
        roomType: (allot && allot.roomType) ? allot.roomType : "-",
        allotmentDate: (allot && allot.allotmentDate) ? allot.allotmentDate : "-",
        physicalStatus: (allot && allot.physicalStatus) ? allot.physicalStatus : "Not Reported",
        reportingDate: (allot && allot.reportingDate) ? allot.reportingDate : "-",
        reportedVerifiedBy: (allot && allot.reportedVerifiedBy) ? allot.reportedVerifiedBy : "-"
      };
    });

    // Ensure EVERY active room allotment is represented with a roomNumber in the register!
    activeAllotments.forEach(function(allot) {
      var aAllotId = allot.allotmentId;
      var cleanAid = (allot.appId || "").toString().trim();
      var cleanName = (allot.studentName || "").toString().trim().toLowerCase();

      // Check if this allotment was already matched to a student in register
      if (!matchedAllotmentIds[aAllotId]) {
        // Look for student in register by ID or Name
        var existingReg = null;
        for (var r = 0; r < register.length; r++) {
          var reg = register[r];
          var regAid = (reg.appId || "").toString().trim();
          var regName = (reg.studentName || "").toString().trim().toLowerCase();
          if ((cleanAid && regAid === cleanAid) || (cleanName && regName === cleanName)) {
            existingReg = reg;
            break;
          }
        }

        if (existingReg) {
          // If student was in register with "Not Allotted", update room details to this active allotment!
          if (!existingReg.roomNumber || existingReg.roomNumber === "Not Allotted" || existingReg.roomNumber === "-") {
            existingReg.roomNumber = allot.roomNumber || "Allotted";
            existingReg.roomType = allot.roomType || "-";
            existingReg.allotmentDate = allot.allotmentDate || "-";
            if (!existingReg.contactNumber || existingReg.contactNumber === "-") existingReg.contactNumber = allot.contactNumber || "-";
            if (!existingReg.parentContact || existingReg.parentContact === "-") existingReg.parentContact = allot.parentContact || "-";
            existingReg.physicalStatus = allot.physicalStatus || "Not Reported";
            existingReg.reportingDate = allot.reportingDate || "-";
            existingReg.reportedVerifiedBy = allot.reportedVerifiedBy || "-";
          }
          matchedAllotmentIds[aAllotId] = true;
        } else {
          // Student is in active allotments but not in register: add them!
          matchedAllotmentIds[aAllotId] = true;
          var fullApp = findApplicationByIdOrName(cleanAid, allot.studentName);
          register.push({
            appId: cleanAid || (fullApp ? fullApp.appId : ("ALLOT-" + (allot.allotmentId || "ACT"))),
            submissionDate: (fullApp && fullApp.submissionDate) ? fullApp.submissionDate : (allot.allotmentDate || "-"),
            studentName: allot.studentName || (fullApp ? fullApp.studentName : "-"),
            fatherName: (fullApp && fullApp.fatherName) ? fullApp.fatherName : "-",
            motherName: (fullApp && fullApp.motherName) ? fullApp.motherName : "-",
            dateOfBirth: (fullApp && fullApp.dateOfBirth) ? fullApp.dateOfBirth : "-",
            contactNumber: allot.contactNumber || (fullApp ? fullApp.contactNumber : "-"),
            parentContact: allot.parentContact || (fullApp ? fullApp.parentContact : "-"),
            email: (fullApp && fullApp.email) ? fullApp.email : "-",
            address: (fullApp && fullApp.address) ? fullApp.address : "-",
            city: (fullApp && fullApp.city) ? fullApp.city : "-",
            state: (fullApp && fullApp.state) ? fullApp.state : "-",
            course: (fullApp && fullApp.course) ? fullApp.course : "-",
            yearOfStudy: (fullApp && fullApp.yearOfStudy) ? fullApp.yearOfStudy : "-",
            collegeName: (fullApp && fullApp.collegeName) ? fullApp.collegeName : "-",
            aadharNumber: (fullApp && fullApp.aadharNumber) ? fullApp.aadharNumber : "-",
            emergencyContactName: (fullApp && fullApp.emergencyContactName) ? fullApp.emergencyContactName : "-",
            emergencyContactNumber: (fullApp && fullApp.emergencyContactNumber) ? fullApp.emergencyContactNumber : "-",
            roomTypePreference: allot.roomType || (fullApp ? fullApp.roomTypePreference : "-"),
            status: "Approved",
            remarks: (fullApp && fullApp.remarks) ? fullApp.remarks : "Active Allotment",
            roomNumber: allot.roomNumber || "Allotted",
            roomType: allot.roomType || "-",
            allotmentDate: allot.allotmentDate || "-",
            physicalStatus: allot.physicalStatus || "Not Reported",
            reportingDate: allot.reportingDate || "-",
            reportedVerifiedBy: allot.reportedVerifiedBy || "-"
          });
        }
      }
    });

    return { success: true, data: register };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// Helper: Find student application details by App ID or Name across all records
function findApplicationByIdOrName(appId, studentName) {
  try {
    var sheet = getSheet("STUDENT_APPLICATIONS");
    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return null;

    var cleanAid = (appId || "").toString().trim().toLowerCase();
    var cleanName = (studentName || "").toString().trim().toLowerCase();

    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (!row[0] || row[0].toString().trim().toUpperCase() === "APP_ID") continue;
      var rowAid = (row[0] || "").toString().trim().toLowerCase();
      var rowName = (row[2] || "").toString().trim().toLowerCase();

      var match = false;
      if (cleanAid && rowAid === cleanAid) {
        match = true;
      } else if (cleanName && (rowName === cleanName || (cleanName.length > 5 && (rowName.indexOf(cleanName) !== -1 || cleanName.indexOf(rowName) !== -1)))) {
        match = true;
      }

      if (match) {
        return {
          appId: row[0].toString().trim(),
          submissionDate: formatDateValue(row[1]),
          studentName: (row[2] || "").toString().trim(),
          fatherName: (row[3] || "").toString().trim(),
          motherName: (row[4] || "").toString().trim(),
          dateOfBirth: formatDateValue(row[5]),
          contactNumber: (row[6] || "").toString().trim(),
          parentContact: (row[7] || "").toString().trim(),
          email: (row[8] || "").toString().trim(),
          address: (row[9] || "").toString().trim(),
          city: (row[10] || "").toString().trim(),
          state: (row[11] || "").toString().trim(),
          course: (row[12] || "").toString().trim(),
          yearOfStudy: (row[13] || "").toString().trim(),
          collegeName: (row[14] || "").toString().trim(),
          aadharNumber: (row[15] || "").toString().trim(),
          emergencyContactName: (row[16] || "").toString().trim(),
          emergencyContactNumber: (row[17] || "").toString().trim(),
          roomTypePreference: (row[18] || "").toString().trim(),
          status: (row[19] || "").toString().trim(),
          remarks: (row[22] || "").toString().trim()
        };
      }
    }
    return null;
  } catch (e) {
    Logger.log("Error in findApplicationByIdOrName: " + e.message);
    return null;
  }
}

// ── 20C. RECONCILE ACTIVE STUDENTS & SPECIFICALLY ANKITA TUKARAM KALANGE ──
function reconcileActiveStudentsAndApplications() {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var allotSheet = ss.getSheetByName("ROOM_ALLOTMENTS");
    var appSheet = ss.getSheetByName("STUDENT_APPLICATIONS");
    var rcptSheet = ss.getSheetByName("FEE_RECEIPTS");
    var ldgSheet = ss.getSheetByName("STUDENT_FEE_LEDGER");

    if (!allotSheet || !appSheet) return;

    var allotData = allotSheet.getDataRange().getValues();
    var appData = appSheet.getDataRange().getValues();
    var activeYear = getActiveAcademicYear();

    // 0. Clean up any duplicate active allotments in ROOM_ALLOTMENTS (same student active more than once)
    var seenActiveStudentNames = {};
    for (var d = allotData.length - 1; d >= 1; d--) {
      var dRow = allotData[d];
      if (!dRow || !dRow[0] || dRow[0].toString().trim().toUpperCase() === "ALLOTMENT_ID") continue;
      var dStatus = (dRow[9] || "").toString().trim().toLowerCase();
      var dName = (dRow[2] || "").toString().trim().toLowerCase();
      var dRoomId = (dRow[3] || "").toString().trim();

      if (dStatus === "active" && dName) {
        if (seenActiveStudentNames[dName]) {
          allotSheet.getRange(d + 1, 9).setValue(todayFormatted());
          allotSheet.getRange(d + 1, 10).setValue("Vacated");
          if (dRoomId) {
            var rmsSheet = ss.getSheetByName("ROOMS");
            if (rmsSheet) {
              var rmsData = rmsSheet.getDataRange().getValues();
              for (var rm = 1; rm < rmsData.length; rm++) {
                if (rmsData[rm][0] && rmsData[rm][0].toString().trim() === dRoomId) {
                  var curOcc = parseInt(rmsData[rm][5]) || 0;
                  rmsSheet.getRange(rm + 1, 6).setValue(Math.max(0, curOcc - 1));
                  break;
                }
              }
            }
          }
          Logger.log("reconcileActiveStudents: Vacated older duplicate active allotment row " + (d + 1) + " for " + dRow[2]);
        } else {
          seenActiveStudentNames[dName] = true;
        }
      }
    }
    allotData = allotSheet.getDataRange().getValues();

    // Map existing applications by App ID and by Name
    var appMapById = {};
    var appMapByName = {};
    var headerRow = appData[0] || [];
    var acadYearCol = -1;
    for (var c = 0; c < headerRow.length; c++) {
      var h = (headerRow[c] || "").toString().trim().toUpperCase().replace(/[\s_-]+/g, "_");
      if (h === "ACADEMIC_YEAR" || h === "ACAD_YEAR") {
        acadYearCol = c;
        break;
      }
    }
    if (acadYearCol === -1) acadYearCol = 23;

    for (var i = 1; i < appData.length; i++) {
      var aRow = appData[i];
      if (!aRow[0] || aRow[0].toString().trim().toUpperCase() === "APP_ID") continue;
      var aid = aRow[0].toString().trim();
      var sName = (aRow[2] || "").toString().trim().toLowerCase();
      var sStatus = (aRow[19] || "").toString().trim().toLowerCase();
      // Skip disabled, cancelled, or duplicate applications (especially APP-2026-7625)
      if (sStatus.indexOf("disabled") !== -1 || sStatus.indexOf("duplicate") !== -1 || sStatus.indexOf("cancelled") !== -1 || aid === "APP-2026-7625") continue;
      appMapById[aid] = { rowIdx: i + 1, row: aRow };
      if (sName) {
        appMapByName[sName] = { rowIdx: i + 1, row: aRow };
      }
    }

    // 1. Scan ROOM_ALLOTMENTS for all Active allotments (especially Ankita Tukaram Kalange)
    for (var j = 1; j < allotData.length; j++) {
      var allotRow = allotData[j];
      if (!allotRow[0] || allotRow[0].toString().trim().toUpperCase() === "ALLOTMENT_ID") continue;
      var aStatus = (allotRow[9] || "").toString().trim().toLowerCase();
      var allotAppId = (allotRow[1] || "").toString().trim();
      var allotName = (allotRow[2] || "").toString().trim();
      var allotYear = (allotRow[11] || activeYear).toString().trim();

      if (aStatus === "active") {
        if (allotAppId === "APP-2026-7625") continue; // Frozen duplicate
        var cleanAllotName = allotName.toLowerCase();
        var existingApp = appMapById[allotAppId] || appMapByName[cleanAllotName];

        // Also check partial match (e.g. "ankita" and "kalange")
        if (!existingApp && cleanAllotName.indexOf("ankita") !== -1 && cleanAllotName.indexOf("kalange") !== -1) {
          for (var kName in appMapByName) {
            if (kName.indexOf("ankita") !== -1 && kName.indexOf("kalange") !== -1) {
              existingApp = appMapByName[kName];
              break;
            }
          }
        }

        if (existingApp) {
          var appRowIdx = existingApp.rowIdx;
          var curStatus = (existingApp.row[19] || "").toString().trim();
          var curYear = (acadYearCol < existingApp.row.length && existingApp.row[acadYearCol] !== undefined) ? existingApp.row[acadYearCol].toString().trim() : "";
          var curAppId = (existingApp.row[0] || "").toString().trim();

          // Ensure STATUS is "Approved" (never overwrite disabled/cancelled/duplicate rows)
          if (curStatus.toLowerCase().indexOf("disabled") === -1 && curStatus.toLowerCase().indexOf("duplicate") === -1 && curStatus.toLowerCase().indexOf("cancelled") === -1 && curAppId !== "APP-2026-7625") {
            if (curStatus.toLowerCase() !== "approved") {
              appSheet.getRange(appRowIdx, 20).setValue("Approved"); // Col T
              if (!existingApp.row[20]) appSheet.getRange(appRowIdx, 21).setValue("Admin"); // Col U
              if (!existingApp.row[21]) appSheet.getRange(appRowIdx, 22).setValue(todayFormatted()); // Col V
              Logger.log("reconcileActiveStudents: Updated application status to Approved for " + allotName + " (Row " + appRowIdx + ")");
            }
          }

          // Ensure ACADEMIC_YEAR matches active allotment year so register and reports find them
          if (allotYear && (!curYear || curYear !== allotYear)) {
            appSheet.getRange(appRowIdx, acadYearCol + 1).setValue(allotYear);
            Logger.log("reconcileActiveStudents: Updated application academic year to " + allotYear + " for " + allotName);
          }

          // If App ID in allotment differed from application, sync them
          if (curAppId && allotAppId && curAppId !== allotAppId) {
            allotSheet.getRange(j + 1, 2).setValue(curAppId);
            Logger.log("reconcileActiveStudents: Synced allotment App ID to " + curAppId + " for " + allotName);
          }
        } else {
          // Application row does NOT exist in STUDENT_APPLICATIONS: Create it!
          var newAppId = allotAppId || generateId("APP");
          var contactInfo = "";
          var parentContact = "";

          // Check fee receipts or ledger for extra info
          if (rcptSheet) {
            var rcptData = rcptSheet.getDataRange().getValues();
            for (var r = 1; r < rcptData.length; r++) {
              var rName = (rcptData[r][3] || "").toString().trim().toLowerCase();
              var rAppId = (rcptData[r][2] || "").toString().trim();
              if (rAppId === allotAppId || (rName && rName.indexOf("ankita") !== -1 && rName.indexOf("kalange") !== -1)) {
                contactInfo = (rcptData[r][6] || "").toString().trim();
                break;
              }
            }
          }

          var newAppRow = [
            newAppId,                        // A: APP_ID
            formatDateValue(allotRow[6]) || todayFormatted(), // B: SUBMISSION_DATE
            allotName,                       // C: STUDENT_NAME
            "",                              // D: FATHER_NAME
            "",                              // E: MOTHER_NAME
            "",                              // F: DATE_OF_BIRTH
            contactInfo,                     // G: CONTACT_NUMBER
            parentContact,                   // H: PARENT_CONTACT
            "",                              // I: EMAIL
            "",                              // J: ADDRESS
            "",                              // K: CITY
            "Maharashtra",                   // L: STATE
            "",                              // M: COURSE
            "",                              // N: YEAR_OF_STUDY
            "AMGOI",                         // O: COLLEGE_NAME
            "",                              // P: AADHAR_NUMBER
            "",                              // Q: EMERGENCY_CONTACT_NAME
            "",                              // R: EMERGENCY_CONTACT_NUMBER
            (allotRow[5] || "").toString().trim(), // S: ROOM_TYPE_PREFERENCE
            "Approved",                      // T: STATUS
            "System Auto-Sync",              // U: REVIEWED_BY
            todayFormatted(),                // V: REVIEW_DATE
            "Auto-synced from active room allotment & fee records" // W: REMARKS
          ];

          while (newAppRow.length < acadYearCol) {
            newAppRow.push("");
          }
          newAppRow[acadYearCol] = allotYear;

          appSheet.appendRow(newAppRow);
          var lastR = appSheet.getLastRow();
          appMapById[newAppId] = { rowIdx: lastR, row: newAppRow };
          appMapByName[cleanAllotName] = { rowIdx: lastR, row: newAppRow };
          Logger.log("reconcileActiveStudents: Created missing STUDENT_APPLICATIONS record for " + allotName + " (" + newAppId + ")");
        }
      }
    }

    // 2. Also check FEE_RECEIPTS specifically for Ankita Tukaram Kalange in case allotment App ID differs
    if (rcptSheet) {
      var rcptData2 = rcptSheet.getDataRange().getValues();
      for (var f = 1; f < rcptData2.length; f++) {
        var fRow = rcptData2[f];
        if (!fRow || !fRow[0]) continue;
        var fName = (fRow[3] || "").toString().trim().toLowerCase();
        var fAppId = (fRow[2] || "").toString().trim();
        if (fName.indexOf("ankita") !== -1 && fName.indexOf("kalange") !== -1) {
          var appByName = appMapByName[fName];
          if (!appByName) {
            for (var kName2 in appMapByName) {
              if (kName2.indexOf("ankita") !== -1 && kName2.indexOf("kalange") !== -1) {
                appByName = appMapByName[kName2];
                break;
              }
            }
          }
          if (appByName) {
            var actualAppId = (appByName.row[0] || "").toString().trim();
            if (actualAppId && fAppId && fAppId !== actualAppId) {
              rcptSheet.getRange(f + 1, 3).setValue(actualAppId);
              Logger.log("reconcileActiveStudents: Updated fee receipt App ID to " + actualAppId + " for Ankita Tukaram Kalange");
            }
          }
        }
      }
    }

    // 3. Also check STUDENT_FEE_LEDGER specifically for Ankita Tukaram Kalange
    if (ldgSheet) {
      var ldgData2 = ldgSheet.getDataRange().getValues();
      for (var l = 1; l < ldgData2.length; l++) {
        var lRow = ldgData2[l];
        if (!lRow || !lRow[0]) continue;
        var lName = (lRow[2] || "").toString().trim().toLowerCase();
        var lAppId = (lRow[1] || "").toString().trim();
        if (lName.indexOf("ankita") !== -1 && lName.indexOf("kalange") !== -1) {
          var appByNameL = appMapByName[lName];
          if (!appByNameL) {
            for (var kName3 in appMapByName) {
              if (kName3.indexOf("ankita") !== -1 && kName3.indexOf("kalange") !== -1) {
                appByNameL = appMapByName[kName3];
                break;
              }
            }
          }
          if (appByNameL) {
            var actualAppIdL = (appByNameL.row[0] || "").toString().trim();
            if (actualAppIdL && lAppId && lAppId !== actualAppIdL) {
              ldgSheet.getRange(l + 1, 2).setValue(actualAppIdL);
              Logger.log("reconcileActiveStudents: Updated ledger App ID to " + actualAppIdL + " for Ankita Tukaram Kalange");
            }
          }
        }
      }
    }
  } catch (err) {
    Logger.log("Error in reconcileActiveStudentsAndApplications: " + err.message);
  }
}

// ══════════════════════════════════════════════════════════════
// ── 8. FEE STRUCTURES ────────────────────────────────────────
// ══════════════════════════════════════════════════════════════

function getFeeStructures() {
  try {
    var cached = getCachedJson("CACHE_FEE_STRUCTURES");
    if (cached) return { success: true, data: cached, fromCache: true };
    var sheet = getSheet("FEE_STRUCTURES");
    var data = sheet.getDataRange().getValues();
    var results = [];
    for (var i = 0; i < data.length; i++) {
      var row = data[i];
      if (!row[0]) continue;
      if (row[0].toString().trim().toUpperCase() === "STRUCTURE_ID") continue;
      results.push({
        structureId:    row[0].toString().trim(),
        structureName:  (row[1] || "").toString().trim(),
        roomType:       (row[2] || "").toString().trim(),
        status:         (row[3] || "").toString().trim(),
        createdBy:      (row[4] || "").toString().trim(),
        createdDate:    row[5] ? row[5].toString() : ""
      });
    }
    setCachedJson("CACHE_FEE_STRUCTURES", results, 1800);
    return { success: true, data: results };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function saveFeeStructure(data) {
  try {
    var sheet = getSheet("FEE_STRUCTURES");
    // Check for existing active structure for same room type
    var existing = getFeeStructures();
    if (existing.success) {
      var clash = existing.data.filter(function(s) {
        return s.roomType === data.roomType && s.status === "Active";
      });
      if (clash.length > 0) {
        return { success: false, message: "An active fee structure already exists for \"" + data.roomType + "\". Please deactivate it first." };
      }
    }
    var id = generateId("FS");
    sheet.appendRow([
      id,
      data.structureName,
      data.roomType,
      "Active",
      data.createdBy,
      todayFormatted()
    ]);
    clearCacheKeys(["CACHE_FEE_STRUCTURES", "CACHE_BOOTSTRAP"]);
    return { success: true, structureId: id };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function updateFeeStructureStatus(structureId, newStatus) {
  try {
    var sheet = getSheet("FEE_STRUCTURES");
    var data = sheet.getDataRange().getValues();
    for (var i = 0; i < data.length; i++) {
      if (!data[i][0] || data[i][0].toString().trim().toUpperCase() === "STRUCTURE_ID") continue;
      if (data[i][0].toString().trim() === structureId.toString().trim()) {
        sheet.getRange(i + 1, 4).setValue(newStatus); // Column D: STATUS
        clearCacheKeys(["CACHE_FEE_STRUCTURES", "CACHE_BOOTSTRAP"]);
        return { success: true };
      }
    }
    return { success: false, message: "Fee structure not found." };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ── 9. FEE STRUCTURE HEADS ────────────────────────────────────

function getFeeHeads(structureId) {
  try {
    var sheet = getSheet("FEE_STRUCTURE_HEADS");
    var data = sheet.getDataRange().getValues();
    
    // Check which heads are allocated in STUDENT_FEE_LEDGER
    var ledgerSheet = getSheet("STUDENT_FEE_LEDGER");
    var ledgerData = ledgerSheet.getDataRange().getValues();
    var allocatedHeads = {};
    for (var j = 0; j < ledgerData.length; j++) {
      var row = ledgerData[j];
      if (!row[0] || row[0].toString().trim().toUpperCase() === "LEDGER_ID") continue;
      var headIdVal = (row[5] || "").toString().trim();
      if (headIdVal) {
        allocatedHeads[headIdVal] = true;
      }
    }

    var results = [];
    for (var i = 0; i < data.length; i++) {
      var row = data[i];
      if (!row[0]) continue;
      if (row[0].toString().trim().toUpperCase() === "HEAD_ID") continue;
      var rowStructId = (row[1] || "").toString().trim();
      if (structureId && rowStructId !== structureId.toString().trim()) continue;
      var hId = row[0].toString().trim();
      results.push({
        headId:      hId,
        structureId: rowStructId,
        headName:    (row[2] || "").toString().trim(),
        amount:      parseFloat(row[3]) || 0,
        frequency:   (row[4] || "").toString().trim(),
        dueDay:      parseInt(row[5]) || 1,
        priority:    parseInt(row[6]) || 99,
        isAllocated: !!allocatedHeads[hId]
      });
    }
    return { success: true, data: results };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function addFeeHead(headData) {
  try {
    var sheet = getSheet("FEE_STRUCTURE_HEADS");
    var id = generateId("FH");
    sheet.appendRow([
      id,
      headData.structureId,
      headData.headName,
      parseFloat(headData.amount) || 0,
      headData.frequency,
      parseInt(headData.dueDay) || 1,
      parseInt(headData.priority) || 99
    ]);
    return { success: true, headId: id };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function deleteFeeHead(headId) {
  try {
    // Prevent delete if allocated to students
    var ledgerSheet = getSheet("STUDENT_FEE_LEDGER");
    var ledgerData = ledgerSheet.getDataRange().getValues();
    for (var j = 0; j < ledgerData.length; j++) {
      var row = ledgerData[j];
      if (!row[0] || row[0].toString().trim().toUpperCase() === "LEDGER_ID") continue;
      var headIdVal = (row[5] || "").toString().trim();
      if (headIdVal === headId.toString().trim()) {
        return { success: false, message: "Cannot delete fee head: It is allocated to students. Use Convert instead." };
      }
    }

    var sheet = getSheet("FEE_STRUCTURE_HEADS");
    var data = sheet.getDataRange().getValues();
    for (var i = 0; i < data.length; i++) {
      if (!data[i][0] || data[i][0].toString().trim().toUpperCase() === "HEAD_ID") continue;
      if (data[i][0].toString().trim() === headId.toString().trim()) {
        sheet.deleteRow(i + 1);
        return { success: true };
      }
    }
    return { success: false, message: "Fee head not found." };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function editFeeHead(headData) {
  try {
    var headId = headData.headId;
    
    // Prevent edit if allocated to students
    var ledgerSheet = getSheet("STUDENT_FEE_LEDGER");
    var ledgerData = ledgerSheet.getDataRange().getValues();
    for (var j = 0; j < ledgerData.length; j++) {
      var row = ledgerData[j];
      if (!row[0] || row[0].toString().trim().toUpperCase() === "LEDGER_ID") continue;
      var headIdVal = (row[5] || "").toString().trim();
      if (headIdVal === headId.toString().trim()) {
        return { success: false, message: "Cannot edit fee head: It is allocated to students. Use Convert instead." };
      }
    }

    var sheet = getSheet("FEE_STRUCTURE_HEADS");
    var data = sheet.getDataRange().getValues();
    for (var i = 0; i < data.length; i++) {
      if (!data[i][0] || data[i][0].toString().trim().toUpperCase() === "HEAD_ID") continue;
      if (data[i][0].toString().trim() === headId.toString().trim()) {
        var rowNum = i + 1;
        sheet.getRange(rowNum, 3).setValue(headData.headName);
        sheet.getRange(rowNum, 4).setValue(parseFloat(headData.amount) || 0);
        sheet.getRange(rowNum, 5).setValue(headData.frequency);
        sheet.getRange(rowNum, 6).setValue(parseInt(headData.dueDay) || 1);
        sheet.getRange(rowNum, 7).setValue(parseInt(headData.priority) || 99);
        return { success: true };
      }
    }
    return { success: false, message: "Fee head not found." };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function convertFeeHead(headData) {
  try {
    var headId = headData.headId;
    var newName = headData.headName.trim();
    var newAmount = parseFloat(headData.amount) || 0;
    var newDueDay = parseInt(headData.dueDay) || 5;

    // 1. Fetch original fee head details
    var headSheet = getSheet("FEE_STRUCTURE_HEADS");
    var headDataRows = headSheet.getDataRange().getValues();
    var headRowIndex = -1;
    var frequency = "";
    
    for (var i = 0; i < headDataRows.length; i++) {
      if (headDataRows[i][0] && headDataRows[i][0].toString().trim() === headId.toString().trim()) {
        headRowIndex = i + 1;
        frequency = headDataRows[i][4].toString().trim();
        break;
      }
    }

    if (headRowIndex === -1) {
      return { success: false, message: "Fee head not found in configuration." };
    }

    // 2. Update FEE_STRUCTURE_HEADS configuration
    headSheet.getRange(headRowIndex, 3).setValue(newName);
    headSheet.getRange(headRowIndex, 4).setValue(newAmount);
    headSheet.getRange(headRowIndex, 6).setValue(newDueDay);
    headSheet.getRange(headRowIndex, 7).setValue(parseInt(headData.priority) || 99);

    // 3. Update STUDENT_FEE_LEDGER
    var ledgerSheet = getSheet("STUDENT_FEE_LEDGER");
    var ledgerData = ledgerSheet.getDataRange().getValues();
    var updatedLedgerIds = [];

    var monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];

    for (var j = 0; j < ledgerData.length; j++) {
      var row = ledgerData[j];
      if (!row[0] || row[0].toString().trim().toUpperCase() === "LEDGER_ID") continue;
      
      var rowHeadId = (row[5] || "").toString().trim();
      if (rowHeadId === headId.toString().trim()) {
        var ledgerId = row[0].toString().trim();
        updatedLedgerIds.push(ledgerId);

        // Update name in memory
        ledgerData[j][6] = newName; // G: HEAD_NAME
        
        // Update amount, balance, status in memory
        var paidAmount = parseFloat(row[9]) || 0;
        var newBalance = newAmount - paidAmount;
        var newStatus = newBalance <= 0 ? "Paid" : (paidAmount > 0 ? "Partial" : "Pending");

        ledgerData[j][8] = newAmount;   // I: APPLICABLE_AMOUNT
        ledgerData[j][10] = newBalance; // K: BALANCE
        ledgerData[j][12] = newStatus;  // M: STATUS

        // Update due date if monthly
        if (frequency === "Monthly") {
          var applicableMonthStr = (row[7] || "").toString().trim(); // H: APPLICABLE_MONTH
          var parts = applicableMonthStr.split(" ");
          if (parts.length === 2) {
            var mName = parts[0];
            var year = parseInt(parts[1]);
            var mIdx = monthNames.indexOf(mName);
            if (mIdx !== -1 && !isNaN(year)) {
              var cappedDay = Math.min(newDueDay, 28);
              var newDueDateObj = new Date(year, mIdx, cappedDay);
              var newDueDateStr = Utilities.formatDate(newDueDateObj, Session.getScriptTimeZone(), "dd-MMM-yyyy");
              ledgerData[j][11] = newDueDateStr; // L: DUE_DATE
            }
          }
        }
      }
    }

    // Write all ledger updates at once
    ledgerSheet.getRange(1, 1, ledgerData.length, ledgerData[0].length).setValues(ledgerData);

    // 4. Update FEE_RECEIPTS
    if (updatedLedgerIds.length > 0) {
      var receiptSheet = getSheet("FEE_RECEIPTS");
      var receiptData = receiptSheet.getDataRange().getValues();
      for (var k = 0; k < receiptData.length; k++) {
        var rRow = receiptData[k];
        if (!rRow[0] || rRow[0].toString().trim().toUpperCase() === "RECEIPT_ID") continue;
        
        var rLedgerId = (rRow[14] || "").toString().trim(); // O: LEDGER_ID
        if (rLedgerId && updatedLedgerIds.indexOf(rLedgerId) !== -1) {
          receiptSheet.getRange(k + 1, 6).setValue(newName); // F: HEAD_NAME (feeType)
        }
      }
    }

    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ── 10. STUDENT FEE LEDGER ────────────────────────────────────

// Room type normalization helper
function normalizeRoomType(rt) {
  if (!rt) return "";
  return rt.toString()
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, " ")
    .replace(/tripple/g, "triple")
    .replace(/doubble/g, "double");
}

function isRoomTypeMatch(structRoomType, targetRoomType) {
  if (!structRoomType || !targetRoomType) return false;
  var s1 = normalizeRoomType(structRoomType);
  var s2 = normalizeRoomType(targetRoomType);
  if (s1 === s2) return true;
  if (s1.indexOf(s2) !== -1 || s2.indexOf(s1) !== -1) return true;
  var words1 = s1.split(" ").filter(function(w){ return w.length > 2; });
  var words2 = s2.split(" ").filter(function(w){ return w.length > 2; });
  var matchCount = 0;
  for (var i = 0; i < words1.length; i++) {
    if (words2.indexOf(words1[i]) !== -1) matchCount++;
  }
  return matchCount >= Math.min(words1.length, words2.length) && matchCount > 0;
}

function normalizeCollegeNameGas(col) {
  if (!col) return "";
  var s = col.toString().trim().toUpperCase();
  if (s.indexOf("BAMS") !== -1 || s.indexOf("AMAMCHRC") !== -1) return "AMAMCHRC (BAMS)";
  if (s.indexOf("BHMS") !== -1 || s.indexOf("AMHMCH") !== -1) return "AMHMCH (BHMS)";
  if (s.indexOf("GNM") !== -1 || s.indexOf("AMSON") !== -1) return "AMSON (GNM)";
  if (s.indexOf("DIPLOMA") !== -1 || s.indexOf("AMPV") !== -1) return "AMPV (DIPLOMA)";
  if (s.indexOf("AMCP") !== -1) return "AMCP";
  if (s.indexOf("AMGOI") !== -1) return "AMGOI";
  return s;
}

function findMatchingFeeStructure(roomType, studentCollege, activeStructures) {
  if (!activeStructures || !activeStructures.length) return null;
  var target = normalizeRoomType(roomType);
  var normCol = normalizeCollegeNameGas(studentCollege);

  // Pass 1: exact room type + college match
  if (normCol) {
    for (var i = 0; i < activeStructures.length; i++) {
      var s = activeStructures[i];
      if ((normalizeRoomType(s.roomType) === target || isRoomTypeMatch(s.roomType, roomType)) && normalizeCollegeNameGas(s.collegeName) === normCol) {
        return s;
      }
    }
  }

  // Pass 2: default "All Colleges" structure for this room type
  for (var i = 0; i < activeStructures.length; i++) {
    var s = activeStructures[i];
    var sCol = (s.collegeName || "All Colleges").toString().trim().toLowerCase();
    if ((normalizeRoomType(s.roomType) === target || isRoomTypeMatch(s.roomType, roomType)) && (!sCol || sCol === "all colleges" || sCol === "all")) {
      return s;
    }
  }

  // Pass 3: fallback to any active room type match
  for (var i = 0; i < activeStructures.length; i++) {
    var s = activeStructures[i];
    if (normalizeRoomType(s.roomType) === target || isRoomTypeMatch(s.roomType, roomType)) return s;
  }

  if (activeStructures.length === 1) return activeStructures[0];
  return null;
}

// Auto-called when a room is allotted or backfilled
function applyFeeStructureOnAllotment(appId, studentName, roomNumber, roomType, allotmentDate, force) {
  try {
    var ledgerSheet = getSheet("STUDENT_FEE_LEDGER");
    var existingData = ledgerSheet.getDataRange().getValues();

    // Prevent duplicate entries unless force is true
    if (!force) {
      for (var e = 1; e < existingData.length; e++) {
        if (!existingData[e][0] || existingData[e][0].toString().trim().toUpperCase() === "LEDGER_ID") continue;
        if (existingData[e][1] && existingData[e][1].toString().trim() === appId.toString().trim()) {
          var st = (existingData[e][12] || "").toString().trim().toLowerCase();
          if (st !== "cancelled") {
            return {
              success: true,
              entriesCreated: 0,
              alreadyExists: true,
              message: "Fee ledger already exists for student " + appId + "."
            };
          }
        }
      }
    }

    // Find active fee structure for this room type
    var structResult = getFeeStructures();
    if (!structResult.success) return { success: false, message: "Could not load fee structures: " + structResult.message };
    var activeStructures = (structResult.data || []).filter(function(s) { return s.status === "Active"; });
    if (!activeStructures.length) {
      return { success: false, entriesCreated: 0, message: "No active fee structures found in Fee Setup." };
    }

    var activeStruct = findMatchingFeeStructure(roomType, activeStructures);
    if (!activeStruct) {
      var availableTypes = activeStructures.map(function(s){ return s.roomType; }).join(", ");
      return {
        success: false,
        entriesCreated: 0,
        message: "No active fee structure found for room type \"" + roomType + "\". Available active structures: [" + (availableTypes || "None") + "]. Please configure in Fee Setup."
      };
    }

    // Get fee heads for this structure
    var headsResult = getFeeHeads(activeStruct.structureId);
    if (!headsResult.success || !headsResult.data || headsResult.data.length === 0) {
      return {
        success: false,
        entriesCreated: 0,
        message: "Fee structure \"" + activeStruct.structureName + "\" has no fee heads configured. Please add fee heads in Fee Setup."
      };
    }

    var rows = [];

    // Calculate start month from allotment date
    var startDate = (allotmentDate instanceof Date) ? allotmentDate : (allotmentDate ? new Date(allotmentDate) : new Date());
    if (isNaN(startDate.getTime())) startDate = new Date();
    var startMonth = startDate.getMonth(); // 0-indexed
    var startYear = startDate.getFullYear();
    var acadYear = getActiveAcademicYear();

    var monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];

    headsResult.data.forEach(function(head) {
      if (head.frequency === "One-time") {
        var dueDate = Utilities.formatDate(startDate, Session.getScriptTimeZone(), "dd-MMM-yyyy");
        rows.push([
          generateId("LDG"),   // A: LEDGER_ID
          appId,               // B: APP_ID
          studentName,         // C: STUDENT_NAME
          roomNumber,          // D: ROOM_NUMBER
          activeStruct.structureId, // E: STRUCTURE_ID
          head.headId,         // F: HEAD_ID
          head.headName,       // G: HEAD_NAME
          "On Joining",        // H: APPLICABLE_MONTH
          head.amount,         // I: APPLICABLE_AMOUNT
          0,                   // J: PAID_AMOUNT
          head.amount,         // K: BALANCE
          dueDate,             // L: DUE_DATE
          "Pending",           // M: STATUS
          todayFormatted(),    // N: CREATED_DATE
          acadYear             // O: ACADEMIC_YEAR
        ]);
      } else if (head.frequency === "Monthly") {
        for (var m = 0; m < 12; m++) {
          var monthIdx = (startMonth + m) % 12;
          var year = startYear + Math.floor((startMonth + m) / 12);
          var monthLabel = monthNames[monthIdx] + " " + year;
          var dueDay = Math.min(head.dueDay || 5, 28);
          var dueDateObj = new Date(year, monthIdx, dueDay);
          var dueDateStr = Utilities.formatDate(dueDateObj, Session.getScriptTimeZone(), "dd-MMM-yyyy");
          rows.push([
            generateId("LDG"),
            appId,
            studentName,
            roomNumber,
            activeStruct.structureId,
            head.headId,
            head.headName,
            monthLabel,
            head.amount,
            0,
            head.amount,
            dueDateStr,
            "Pending",
            todayFormatted(),
            acadYear
          ]);
        }
      } else if (head.frequency === "Bi-annually") {
        var dueDate1 = Utilities.formatDate(startDate, Session.getScriptTimeZone(), "dd-MMM-yyyy");
        rows.push([
          generateId("LDG"),
          appId,
          studentName,
          roomNumber,
          activeStruct.structureId,
          head.headId,
          head.headName,
          "Semester 1",
          head.amount,
          0,
          head.amount,
          dueDate1,
          "Pending",
          todayFormatted(),
          acadYear
        ]);
        
        var sem2Month = (startMonth + 5) % 12;
        var sem2Year = startYear + Math.floor((startMonth + 5) / 12);
        var sem2MonthLabel = "Semester 2 (" + monthNames[sem2Month] + " " + sem2Year + ")";
        var dueDay2 = Math.min(head.dueDay || 5, 28);
        var dueDate2Obj = new Date(sem2Year, sem2Month, dueDay2);
        var dueDate2Str = Utilities.formatDate(dueDate2Obj, Session.getScriptTimeZone(), "dd-MMM-yyyy");
        rows.push([
          generateId("LDG"),
          appId,
          studentName,
          roomNumber,
          activeStruct.structureId,
          head.headId,
          head.headName,
          sem2MonthLabel,
          head.amount,
          0,
          head.amount,
          dueDate2Str,
          "Pending",
          todayFormatted(),
          acadYear
        ]);
      }
    });

    // Ensure 15 columns in sheet
    if (rows.length > 0) {
      if (ledgerSheet.getMaxColumns() < 15) {
        ledgerSheet.insertColumnsAfter(ledgerSheet.getMaxColumns(), 15 - ledgerSheet.getMaxColumns());
      }
      var startRow = ledgerSheet.getLastRow() + 1;
      ledgerSheet.getRange(startRow, 1, rows.length, 15).setValues(rows);
    }

    return { success: true, entriesCreated: rows.length, structureName: activeStruct.structureName, structureId: activeStruct.structureId };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// Generate missing fee demands for all active allotted students
function generateMissingAllotmentFees() {
  try {
    var allotSheet = getSheet("ROOM_ALLOTMENTS");
    var allotData = allotSheet.getDataRange().getValues();
    if (allotData.length <= 1) return { success: true, processedCount: 0, message: "No room allotments found." };

    var ledgerSheet = getSheet("STUDENT_FEE_LEDGER");
    var ledgerData = ledgerSheet.getDataRange().getValues();
    var existingAppIds = {};
    for (var l = 1; l < ledgerData.length; l++) {
      if (!ledgerData[l][0] || ledgerData[l][0].toString().trim().toUpperCase() === "LEDGER_ID") continue;
      var aid = (ledgerData[l][1] || "").toString().trim();
      var st = (ledgerData[l][12] || "").toString().trim().toLowerCase();
      if (aid && st !== "cancelled") existingAppIds[aid] = true;
    }

    var processed = 0;
    var failed = [];
    for (var i = 1; i < allotData.length; i++) {
      var row = allotData[i];
      if (!row[0] || row[0].toString().trim().toUpperCase() === "ALLOTMENT_ID") continue;
      var status = (row[9] || "").toString().trim();
      if (status !== "Active") continue;

      var appId = (row[1] || "").toString().trim();
      var studentName = (row[2] || "").toString().trim();
      var roomNumber = (row[4] || "").toString().trim();
      var roomType = (row[5] || "").toString().trim();
      var allotDate = row[6] ? row[6].toString().trim() : "";

      if (!existingAppIds[appId]) {
        var res = applyFeeStructureOnAllotment(appId, studentName, roomNumber, roomType, allotDate, false);
        if (res.success && res.entriesCreated > 0) {
          processed++;
          existingAppIds[appId] = true;
        } else if (!res.success) {
          failed.push(studentName + " (" + roomType + "): " + res.message);
        }
      }
    }

    // Automatically reconcile all active receipts so newly generated fee demands are instantly settled!
    try {
      reconcileAllFeeReceipts();
    } catch (eRec) {
      Logger.log("Auto-reconcile receipts error: " + eRec.message);
    }

    var msg = "Generated fee demands for " + processed + " student(s) and reconciled active fee receipts.";
    if (failed.length > 0) {
      msg += " Note: " + failed.join("; ");
    }
    return { success: true, processedCount: processed, failed: failed, message: msg };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// Single student fee demand generation (e.g. from modal or table)
function generateStudentFeeDemand(appId, studentName, roomNumber, roomType, allotDate) {
  var res = applyFeeStructureOnAllotment(appId, studentName, roomNumber, roomType, allotDate, true);
  if (res.success) {
    try {
      reconcileAllFeeReceipts(appId);
    } catch (e) {
      Logger.log("Error reconciling student receipts: " + e.message);
    }
  }
  return res;
}

function getStudentFeeLedger(appId, academicYear) {
  try {
    var sheet = getSheet("STUDENT_FEE_LEDGER");
    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return { success: true, data: [] };

    var headerRow = data[0] || [];
    var acadYearCol = -1;
    for (var c = 0; c < headerRow.length; c++) {
      var h = (headerRow[c] || "").toString().trim().toUpperCase().replace(/[\s_-]+/g, "_");
      if (h === "ACADEMIC_YEAR" || h === "ACAD_YEAR") {
        acadYearCol = c;
        break;
      }
    }
    if (acadYearCol === -1) acadYearCol = 14;
    var activeYear = getActiveAcademicYear();
    
    var appSheet = getSheet("STUDENT_APPLICATIONS");
    var appData = appSheet.getDataRange().getValues();
    var studentInfoMap = {};
    for (var j = 0; j < appData.length; j++) {
      var appRow = appData[j];
      if (appRow[0] && appRow[0].toString().trim().toUpperCase() !== "APP_ID") {
        var sAppId = appRow[0].toString().trim();
        var sName = (appRow[2] || "").toString().trim().toLowerCase();
        var sInfo = {
          contactNumber: (appRow[6] || "").toString().trim(),
          parentContact: (appRow[7] || "").toString().trim(),
          course:        (appRow[12] || "").toString().trim(),
          yearOfStudy:   (appRow[13] || "").toString().trim(),
          collegeName:   (appRow[14] || "").toString().trim(),
          prn:           sAppId
        };
        studentInfoMap[sAppId] = sInfo;
        studentInfoMap[sAppId.toLowerCase()] = sInfo;
        if (sName) studentInfoMap[sName] = sInfo;
      }
    }

    var results = [];
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (!row[0]) continue;
      if (row[0].toString().trim().toUpperCase() === "LEDGER_ID") continue;
      
      var rowAcadYear = (acadYearCol < row.length && row[acadYearCol] !== undefined && row[acadYearCol] !== null) ? row[acadYearCol].toString().trim() : "";
      var matchAcadYear = !academicYear || academicYear === "All" || !rowAcadYear || rowAcadYear === academicYear || (normalizeYearString(rowAcadYear) === normalizeYearString(academicYear));
      if (matchAcadYear) {
        var rowAppId = (row[1] || "").toString().trim();
        var rowStudentName = (row[2] || "").toString().trim().toLowerCase();
        if (appId && rowAppId !== appId.toString().trim() && rowAppId.toLowerCase() !== appId.toString().trim().toLowerCase()) continue;
        var sInfo = studentInfoMap[rowAppId] || studentInfoMap[rowAppId.toLowerCase()] || studentInfoMap[rowStudentName] || { contactNumber: "", parentContact: "", collegeName: "", course: "", yearOfStudy: "", prn: rowAppId };
        results.push({
          rowIndex:          i + 1,
          ledgerId:          row[0].toString().trim(),
          appId:             rowAppId,
          prn:               sInfo.prn || rowAppId,
          studentName:       (row[2] || "").toString().trim(),
          collegeName:       sInfo.collegeName || "",
          course:            sInfo.course || "",
          yearOfStudy:       sInfo.yearOfStudy || "",
          roomNumber:        (row[3] || "").toString().trim(),
          structureId:       (row[4] || "").toString().trim(),
          headId:            (row[5] || "").toString().trim(),
          headName:          (row[6] || "").toString().trim(),
          applicableMonth:   (row[7] || "").toString().trim(),
          applicableAmount:  parseFloat(row[8]) || 0,
          paidAmount:        parseFloat(row[9]) || 0,
          balance:           parseFloat(row[10]) || 0,
          dueDate:           formatDateValue(row[11]),
          status:            (row[12] || "Pending").toString().trim(),
          createdDate:       formatDateValue(row[13]),
          academicYear:      rowAcadYear || activeYear,
          contactNumber:     sInfo.contactNumber,
          parentContact:     sInfo.parentContact
        });
      }
    }
    return { success: true, data: results };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function getAllPendingFees(statusFilter, academicYear) {
  try {
    var all = getStudentFeeLedger(null, academicYear);
    if (!all.success) return all;
    var filtered = all.data.filter(function(e) {
      var st = (e.status || "").toString().trim().toLowerCase();
      if (statusFilter === "All") return true;
      if (!statusFilter || statusFilter.toLowerCase() === "pending") return st === "pending" || st === "partial";
      return st === statusFilter.toLowerCase();
    });
    return { success: true, data: filtered };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function recordFeePayment(ledgerId, amountPaid, paymentMode, transactionId, collectedBy, remarks) {
  try {
    var sheet = getSheet("STUDENT_FEE_LEDGER");
    var data = sheet.getDataRange().getValues();
    amountPaid = parseFloat(amountPaid) || 0;
    if (amountPaid <= 0) return { success: false, message: "Payment amount must be greater than zero." };

    var appId = "";
    for (var i = 0; i < data.length; i++) {
      if (!data[i][0] || data[i][0].toString().trim().toUpperCase() === "LEDGER_ID") continue;
      if (data[i][0].toString().trim() === ledgerId.toString().trim()) {
        appId = data[i][1].toString().trim();
        break;
      }
    }
    
    if (!appId) return { success: false, message: "Ledger entry not found." };
    
    var payingMap = {};
    payingMap[ledgerId] = amountPaid;
    var seqVal = validatePaymentSequence(appId, payingMap);
    if (!seqVal.success) return seqVal;

    for (var i = 0; i < data.length; i++) {
      if (!data[i][0] || data[i][0].toString().trim().toUpperCase() === "LEDGER_ID") continue;
      if (data[i][0].toString().trim() !== ledgerId.toString().trim()) continue;

      var currentPaid  = parseFloat(data[i][9]) || 0;
      var currentBal   = parseFloat(data[i][10]) || 0;
      var applicableAmt = parseFloat(data[i][8]) || 0;

      if (amountPaid > currentBal) {
        return { success: false, message: "Payment (\u20B9" + amountPaid + ") cannot exceed balance (\u20B9" + currentBal + ")." };
      }

      var newPaid    = currentPaid + amountPaid;
      var newBalance = applicableAmt - newPaid;
      var newStatus  = newBalance <= 0 ? "Paid" : "Partial";

      data[i][9] = newPaid;        // J: PAID_AMOUNT
      data[i][10] = newBalance;     // K: BALANCE
      data[i][12] = newStatus;      // M: STATUS
      sheet.getRange(1, 1, data.length, data[0].length).setValues(data);

      // Also record in FEE_RECEIPTS for receipt printing
      var receiptSheet = getSheet("FEE_RECEIPTS");
      var receiptId = generateId("RCPT");
      var date = todayFormatted();
      var year = new Date().getFullYear();
      receiptSheet.appendRow([
        receiptId,
        date,
        data[i][1],           // APP_ID
        data[i][2],           // STUDENT_NAME
        data[i][3],           // ROOM_NUMBER
        data[i][6],           // HEAD_NAME as fee type
        amountPaid,
        paymentMode,
        transactionId || "",
        data[i][7],           // APPLICABLE_MONTH as fee month
        year,
        collectedBy,
        remarks || "",
        "Active",             // N: STATUS
        ledgerId,             // O: LEDGER_ID (links back to ledger for edit/cancel)
        data[i][14] || getActiveAcademicYear() // P: ACADEMIC_YEAR
      ]);

      var receiptObj = {
        receiptId: receiptId,
        receiptDate: date,
        appId: data[i][1],
        studentName: data[i][2],
        roomNumber: data[i][3],
        feeType: data[i][6],
        amountPaid: amountPaid,
        paymentMode: paymentMode,
        transactionId: transactionId || "",
        feeMonth: data[i][7],
        feeYear: year,
        collectedBy: collectedBy,
        remarks: remarks || "",
        status: "Active",
        ledgerId: ledgerId,
        academicYear: data[i][14] || getActiveAcademicYear()
      };

      return {
        success: true,
        newPaid: newPaid,
        newBalance: newBalance,
        newStatus: newStatus,
        receiptId: receiptId,
        receipt: receiptObj
      };
    }
    return { success: false, message: "Ledger entry not found." };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function recordMultipleFeePayments(payments, paymentMode, transactionId, collectedBy, remarks) {
  try {
    if (!payments || payments.length === 0) {
      return { success: false, message: "No payments provided." };
    }
    
    var ldgSheet = getSheet("STUDENT_FEE_LEDGER");
    var ldgData = ldgSheet.getDataRange().getValues();
    
    // Find student appId and build paying map
    var appId = "";
    var payingMap = {};
    for (var p = 0; p < payments.length; p++) {
      var pay = payments[p];
      var amt = parseFloat(pay.amountPaid) || 0;
      payingMap[pay.ledgerId] = amt;
      
      if (!appId) {
        for (var i = 0; i < ldgData.length; i++) {
          if (!ldgData[i][0] || ldgData[i][0].toString().trim().toUpperCase() === "LEDGER_ID") continue;
          if (ldgData[i][0].toString().trim() === pay.ledgerId.toString().trim()) {
            appId = ldgData[i][1].toString().trim();
            break;
          }
        }
      }
    }
    
    if (!appId) return { success: false, message: "Student reference not found." };
    
    // Validate sequence
    var seqVal = validatePaymentSequence(appId, payingMap);
    if (!seqVal.success) return seqVal;
    
    var totalAmountPaid = 0;
    var feeTypes = [];
    var feeMonths = [];
    var studentName = "";
    var roomNumber = "";
    var academicYear = "";
    var ledgerDetails = {};
    
    // First, validate all payments
    for (var p = 0; p < payments.length; p++) {
      var pay = payments[p];
      var amt = parseFloat(pay.amountPaid) || 0;
      if (amt <= 0) {
        return { success: false, message: "Payment amount must be greater than zero." };
      }
      
      var found = false;
      for (var i = 0; i < ldgData.length; i++) {
        if (!ldgData[i][0] || ldgData[i][0].toString().trim().toUpperCase() === "LEDGER_ID") continue;
        if (ldgData[i][0].toString().trim() === pay.ledgerId.toString().trim()) {
          found = true;
          var currentBal = parseFloat(ldgData[i][10]) || 0;
          if (amt > currentBal) {
            return { success: false, message: "Payment amount (₹" + amt + ") for " + ldgData[i][6] + " (" + ldgData[i][7] + ") exceeds balance (₹" + currentBal + ")." };
          }
          break;
        }
      }
      if (!found) {
        return { success: false, message: "Ledger entry " + pay.ledgerId + " not found." };
      }
    }
    
    // Process all payments and collect details
    for (var p = 0; p < payments.length; p++) {
      var pay = payments[p];
      var amt = parseFloat(pay.amountPaid) || 0;
      ledgerDetails[pay.ledgerId] = amt;
      totalAmountPaid += amt;
      
      for (var i = 0; i < ldgData.length; i++) {
        if (!ldgData[i][0] || ldgData[i][0].toString().trim().toUpperCase() === "LEDGER_ID") continue;
        if (ldgData[i][0].toString().trim() === pay.ledgerId.toString().trim()) {
          var currentPaid = parseFloat(ldgData[i][9]) || 0;
          var applicableAmt = parseFloat(ldgData[i][8]) || 0;
          var newPaid = currentPaid + amt;
          var newBalance = applicableAmt - newPaid;
          var newStatus = newBalance <= 0 ? "Paid" : "Partial";
          
          ldgData[i][9] = newPaid;
          ldgData[i][10] = newBalance;
          ldgData[i][12] = newStatus;
          
          appId = ldgData[i][1].toString().trim();
          studentName = ldgData[i][2].toString().trim();
          roomNumber = ldgData[i][3].toString().trim();
          academicYear = ldgData[i][14] || getActiveAcademicYear();
          
          var headName = ldgData[i][6].toString().trim();
          if (feeTypes.indexOf(headName) === -1) {
            feeTypes.push(headName);
          }
          
          var appMonth = ldgData[i][7].toString().trim();
          if (feeMonths.indexOf(appMonth) === -1) {
            feeMonths.push(appMonth);
          }
          break;
        }
      }
    }
    
    // Write all ledger updates at once
    ldgSheet.getRange(1, 1, ldgData.length, ldgData[0].length).setValues(ldgData);
    
    SpreadsheetApp.flush();
    
    // Create a consolidated fee receipt
    var receiptSheet = getSheet("FEE_RECEIPTS");
    var receiptId = generateId("RCPT");
    var date = todayFormatted();
    var year = new Date().getFullYear();
    
    var feeTypeStr = feeTypes.join(", ");
    var feeMonthStr = feeMonths.join(", ");
    
    receiptSheet.appendRow([
      receiptId,
      date,
      appId,
      studentName,
      roomNumber,
      feeTypeStr,            // FEE_TYPE
      totalAmountPaid,        // AMOUNT_PAID
      paymentMode,
      transactionId || "",
      feeMonthStr,           // FEE_MONTH
      year,
      collectedBy,
      remarks || "",
      "Active",              // STATUS
      JSON.stringify(ledgerDetails), // LEDGER_ID breakdown
      academicYear
    ]);
    
    SpreadsheetApp.flush();
    
    var receiptObj = {
      receiptId: receiptId,
      receiptDate: date,
      appId: appId,
      studentName: studentName,
      roomNumber: roomNumber,
      feeType: feeTypeStr,
      amountPaid: totalAmountPaid,
      paymentMode: paymentMode,
      transactionId: transactionId || "",
      feeMonth: feeMonthStr,
      feeYear: year,
      collectedBy: collectedBy,
      remarks: remarks || "",
      status: "Active",
      ledgerId: JSON.stringify(ledgerDetails),
      academicYear: academicYear
    };
    
    return {
      success: true,
      receiptId: receiptId,
      totalPaid: totalAmountPaid,
      receipt: receiptObj
    };
  } catch (err) {
    return { success: false, message: err.message };
  }
}


// ── Modify allotRoom to auto-apply fee structure ───────────────
// NOTE: The main allotRoom function now calls applyFeeStructureOnAllotment
// at the end. The frontend gets back the fee application result too.
function allotRoomWithFee(appId, studentName, roomId, roomNumber, roomType, allottedBy, expectedVacatingDate) {
  try {
    // Reuse existing allotRoom logic
    var allotResult = allotRoom(appId, studentName, roomId, roomNumber, roomType, allottedBy, expectedVacatingDate);
    if (!allotResult.success) return allotResult;

    // Auto-apply fee structure
    var feeResult = applyFeeStructureOnAllotment(appId, studentName, roomNumber, roomType, new Date().toISOString());

    return {
      success: true,
      allotId: allotResult.allotId,
      feeApplied: feeResult.success && (feeResult.entriesCreated || 0) > 0,
      feeMessage: feeResult.message || "",
      entriesCreated: feeResult.entriesCreated || 0,
      structureName: feeResult.structureName || ""
    };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ══════════════════════════════════════════════════════════════
// ── 11. ROOM TYPES (Custom / Dynamic) ────────────────────────
// ══════════════════════════════════════════════════════════════

function getRoomTypes(activeOnly) {
  try {
    var cached = getCachedJson("CACHE_ROOM_TYPES_ALL");
    var allTypes = cached;
    if (!allTypes) {
      var sheet = getSheet("ROOM_TYPES");
      var data = sheet.getDataRange().getValues();
      allTypes = [];
      for (var i = 0; i < data.length; i++) {
        var row = data[i];
        if (!row[0]) continue;
        if (row[0].toString().trim().toUpperCase() === "ROOM_TYPE_ID") continue;
        allTypes.push({
          roomTypeId:   row[0].toString().trim(),
          roomTypeName: (row[1] || "").toString().trim(),
          description:  (row[2] || "").toString().trim(),
          status:       (row[3] || "Active").toString().trim()
        });
      }
      setCachedJson("CACHE_ROOM_TYPES_ALL", allTypes, 1800);
    }
    var results = activeOnly
      ? allTypes.filter(function(rt){ return rt.status === "Active"; })
      : allTypes;
    return { success: true, data: results };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function saveRoomType(data) {
  try {
    var existing = getRoomTypes(false);
    if (existing.success) {
      var clash = existing.data.filter(function(rt) {
        return rt.roomTypeName.toLowerCase() === (data.roomTypeName || "").toLowerCase();
      });
      if (clash.length > 0) {
        return { success: false, message: 'A room type named "' + data.roomTypeName + '" already exists.' };
      }
    }
    var sheet = getSheet("ROOM_TYPES");
    var lastRow = sheet.getLastRow();
    var id = "RT-" + (lastRow < 10 ? "00" + lastRow : lastRow < 100 ? "0" + lastRow : lastRow);
    sheet.appendRow([ id, data.roomTypeName, data.description || "", "Active" ]);
    clearCacheKeys(["CACHE_ROOM_TYPES_ALL", "CACHE_BOOTSTRAP"]);
    return { success: true, roomTypeId: id };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function updateRoomTypeStatus(roomTypeId, newStatus) {
  try {
    var sheet = getSheet("ROOM_TYPES");
    var data = sheet.getDataRange().getValues();
    for (var i = 0; i < data.length; i++) {
      if (!data[i][0] || data[i][0].toString().trim().toUpperCase() === "ROOM_TYPE_ID") continue;
      if (data[i][0].toString().trim() === roomTypeId.toString().trim()) {
        sheet.getRange(i + 1, 4).setValue(newStatus);
        clearCacheKeys(["CACHE_ROOM_TYPES_ALL", "CACHE_BOOTSTRAP"]);
        return { success: true };
      }
    }
    return { success: false, message: "Room type not found." };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function deleteRoomType(roomTypeId) {
  try {
    var sheet = getSheet("ROOM_TYPES");
    var data = sheet.getDataRange().getValues();
    for (var i = 0; i < data.length; i++) {
      if (!data[i][0] || data[i][0].toString().trim().toUpperCase() === "ROOM_TYPE_ID") continue;
      if (data[i][0].toString().trim() === roomTypeId.toString().trim()) {
        sheet.deleteRow(i + 1);
        clearCacheKeys(["CACHE_ROOM_TYPES_ALL", "CACHE_BOOTSTRAP"]);
        return { success: true };
      }
    }
    return { success: false, message: "Room type not found." };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ══════════════════════════════════════════════════════════════
// ── 12. STUDENT FEE BALANCE (per-student totals) ─────────────
// ══════════════════════════════════════════════════════════════

function getStudentFeeBalances(academicYear) {
  try {
    var sheet = getSheet("STUDENT_FEE_LEDGER");
    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return { success: true, data: {} };

    var headerRow = data[0] || [];
    var acadYearCol = -1;
    for (var c = 0; c < headerRow.length; c++) {
      var h = (headerRow[c] || "").toString().trim().toUpperCase().replace(/[\s_-]+/g, "_");
      if (h === "ACADEMIC_YEAR" || h === "ACAD_YEAR") {
        acadYearCol = c;
        break;
      }
    }
    if (acadYearCol === -1) acadYearCol = 14;
    var activeYear = getActiveAcademicYear();

    var balances = {}; // { appId: { total: 0, paid: 0, balance: 0 } }
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (!row[0]) continue;
      if (row[0].toString().trim().toUpperCase() === "LEDGER_ID") continue;
      var rowAcadYear = (acadYearCol < row.length && row[acadYearCol] !== undefined && row[acadYearCol] !== null) ? row[acadYearCol].toString().trim() : "";
      var matchAcadYear = !academicYear || academicYear === "All" || !rowAcadYear || rowAcadYear === academicYear || (normalizeYearString(rowAcadYear) === normalizeYearString(academicYear));
      if (!matchAcadYear) continue;
      var appId   = (row[1] || "").toString().trim();
      var status  = (row[12] || "").toString().trim();
      if (!appId || status.toLowerCase() === "cancelled") continue;
      var applicable = parseFloat(row[8]) || 0;
      var paid       = parseFloat(row[9]) || 0;
      var balance    = parseFloat(row[10]) || 0;
      if (!balances[appId]) balances[appId] = { total: 0, paid: 0, balance: 0 };
      balances[appId].total   += applicable;
      balances[appId].paid    += paid;
      balances[appId].balance += balance;
    }
    return { success: true, data: balances };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ── 13. EDIT & CANCEL FEE RECEIPT ────────────────────────────

function updateFeeReceipt(receiptId, updatedData) {
  try {
    var sheet = getSheet("FEE_RECEIPTS");
    var data  = sheet.getDataRange().getValues();
    for (var i = 0; i < data.length; i++) {
      if (!data[i][0] || data[i][0].toString().trim().toUpperCase() === "RECEIPT_ID") continue;
      if (data[i][0].toString().trim() === receiptId.toString().trim()) {
        var rowNum = i + 1;
        var oldAmount = parseFloat(data[i][6]) || 0;
        var newAmount = parseFloat(updatedData.amountPaid) || 0;
        var ledgerId = (data[i][14] || "").toString().trim();
        var isConsolidated = ledgerId.indexOf("{") === 0 || ledgerId.indexOf("[") === 0;

        if (isConsolidated && updatedData.amountPaid !== undefined && newAmount !== oldAmount) {
          return { success: false, message: "Consolidated receipts cannot be edited. Please cancel and re-record the transaction." };
        }

        var oldHead = (data[i][5] || "").toString().trim();
        var newHead = (updatedData.feeType || updatedData.headName || "").toString().trim();
        var studentAppId = (data[i][2] || "").toString().trim();
        var headChanged = newHead && newHead !== oldHead;

        // Update receipt row
        if (headChanged) sheet.getRange(rowNum, 6).setValue(newHead);
        if (updatedData.amountPaid  !== undefined) sheet.getRange(rowNum, 7).setValue(newAmount);
        if (updatedData.paymentMode !== undefined) sheet.getRange(rowNum, 8).setValue(updatedData.paymentMode);
        if (updatedData.transactionId !== undefined) sheet.getRange(rowNum, 9).setValue(updatedData.transactionId || "");
        if (updatedData.feeMonth    !== undefined) sheet.getRange(rowNum, 10).setValue(updatedData.feeMonth || "");
        if (updatedData.feeYear     !== undefined) sheet.getRange(rowNum, 11).setValue(updatedData.feeYear || "");
        if (updatedData.remarks     !== undefined) sheet.getRange(rowNum, 13).setValue(updatedData.remarks || "");

        // Recalculate ledger balance if amount changed or head changed (only for single receipts)
        if (ledgerId && !isConsolidated) {
          var ldgSheet = getSheet("STUDENT_FEE_LEDGER");
          var ldgData  = ldgSheet.getDataRange().getValues();

          if (headChanged) {
            // 1. Reverse payment from old ledger row
            for (var j = 0; j < ldgData.length; j++) {
              if (!ldgData[j][0] || ldgData[j][0].toString().trim().toUpperCase() === "LEDGER_ID") continue;
              if (ldgData[j][0].toString().trim() === ledgerId) {
                var oldApp = parseFloat(ldgData[j][8]) || 0;
                var oldPaid = parseFloat(ldgData[j][9]) || 0;
                var revPaid = Math.max(0, oldPaid - oldAmount);
                var revBal = Math.max(0, oldApp - revPaid);
                ldgSheet.getRange(j + 1, 10).setValue(revPaid);
                ldgSheet.getRange(j + 1, 11).setValue(revBal);
                ldgSheet.getRange(j + 1, 13).setValue(revBal <= 0 ? "Paid" : (revPaid > 0 ? "Partial" : "Pending"));
                break;
              }
            }

            // 2. Find matching ledger row for student with newHead
            var targetFound = false;
            for (var k = 0; k < ldgData.length; k++) {
              if (!ldgData[k][0] || ldgData[k][0].toString().trim().toUpperCase() === "LEDGER_ID") continue;
              var rowApp = (ldgData[k][1] || "").toString().trim();
              var rowHead = (ldgData[k][6] || "").toString().trim();
              var rowSt = (ldgData[k][12] || "").toString().trim().toLowerCase();
              if (rowApp === studentAppId && rowHead === newHead && rowSt !== "cancelled") {
                var tgtApp = parseFloat(ldgData[k][8]) || 0;
                var tgtPaid = parseFloat(ldgData[k][9]) || 0;
                var newTgtPaid = tgtPaid + newAmount;
                var newTgtBal = Math.max(0, tgtApp - newTgtPaid);
                ldgSheet.getRange(k + 1, 10).setValue(newTgtPaid);
                ldgSheet.getRange(k + 1, 11).setValue(newTgtBal);
                ldgSheet.getRange(k + 1, 13).setValue(newTgtBal <= 0 ? "Paid" : (newTgtPaid > 0 ? "Partial" : "Pending"));
                sheet.getRange(rowNum, 15).setValue(ldgData[k][0].toString().trim());
                targetFound = true;
                break;
              }
            }
            // If no separate row found, also update the head name on the old ledger entry
            if (!targetFound) {
              for (var m = 0; m < ldgData.length; m++) {
                if (ldgData[m][0] && ldgData[m][0].toString().trim() === ledgerId) {
                  ldgSheet.getRange(m + 1, 7).setValue(newHead); // Col G: HEAD_NAME
                  var curApp = parseFloat(ldgData[m][8]) || 0;
                  var curPaid = newAmount;
                  var curBal = Math.max(0, curApp - curPaid);
                  ldgSheet.getRange(m + 1, 10).setValue(curPaid);
                  ldgSheet.getRange(m + 1, 11).setValue(curBal);
                  ldgSheet.getRange(m + 1, 13).setValue(curBal <= 0 ? "Paid" : (curPaid > 0 ? "Partial" : "Pending"));
                  break;
                }
              }
            }
          } else if (newAmount !== oldAmount) {
            for (var j = 0; j < ldgData.length; j++) {
              if (!ldgData[j][0] || ldgData[j][0].toString().trim().toUpperCase() === "LEDGER_ID") continue;
              if (ldgData[j][0].toString().trim() === ledgerId) {
                var applicable = parseFloat(ldgData[j][8]) || 0;
                var currentPaid = parseFloat(ldgData[j][9]) || 0;
                var newPaid = currentPaid - oldAmount + newAmount;
                var newBalance = Math.max(0, applicable - newPaid);
                ldgSheet.getRange(j + 1, 10).setValue(newPaid);
                ldgSheet.getRange(j + 1, 11).setValue(newBalance);
                ldgSheet.getRange(j + 1, 13).setValue(newBalance <= 0 ? "Paid" : (newPaid > 0 ? "Partial" : "Pending"));
                break;
              }
            }
          }
        }
        return { success: true };
      }
    }
    return { success: false, message: "Receipt not found." };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function cancelFeeReceipt(receiptId, reason) {
  try {
    var sheet = getSheet("FEE_RECEIPTS");
    var data  = sheet.getDataRange().getValues();
    for (var i = 0; i < data.length; i++) {
      if (!data[i][0] || data[i][0].toString().trim().toUpperCase() === "RECEIPT_ID") continue;
      if (data[i][0].toString().trim() === receiptId.toString().trim()) {
        var rowNum    = i + 1;
        var oldAmount = parseFloat(data[i][6]) || 0;
        var ledgerId  = (data[i][14] || "").toString().trim();
        // Mark cancelled
        sheet.getRange(rowNum, 14).setValue("Cancelled");
        sheet.getRange(rowNum, 13).setValue("CANCELLED: " + (reason || "No reason given"));
        // Reverse ledger entry
        if (ledgerId) {
          var paymentsToReverse = [];
          if (ledgerId.indexOf("{") === 0 || ledgerId.indexOf("[") === 0) {
            try {
              var parsed = JSON.parse(ledgerId);
              if (Array.isArray(parsed)) {
                paymentsToReverse = parsed;
              } else {
                for (var key in parsed) {
                  paymentsToReverse.push({ id: key, amt: parseFloat(parsed[key]) || 0 });
                }
              }
            } catch (e) {
              // Fallback
            }
          }
          if (paymentsToReverse.length === 0) {
            paymentsToReverse.push({ id: ledgerId, amt: oldAmount });
          }

          var ldgSheet = getSheet("STUDENT_FEE_LEDGER");
          var ldgData  = ldgSheet.getDataRange().getValues();
          paymentsToReverse.forEach(function(item) {
            for (var j = 0; j < ldgData.length; j++) {
              if (!ldgData[j][0] || ldgData[j][0].toString().trim().toUpperCase() === "LEDGER_ID") continue;
              if (ldgData[j][0].toString().trim() === item.id.toString().trim()) {
                var applicable  = parseFloat(ldgData[j][8]) || 0;
                var currentPaid = parseFloat(ldgData[j][9]) || 0;
                var newPaid     = Math.max(0, currentPaid - item.amt);
                var newBalance  = applicable - newPaid;
                ldgSheet.getRange(j + 1, 10).setValue(newPaid);
                ldgSheet.getRange(j + 1, 11).setValue(newBalance);
                ldgSheet.getRange(j + 1, 13).setValue(newPaid > 0 ? "Partial" : "Pending");
                break;
              }
            }
          });
        }
        return { success: true };
      }
    }
    return { success: false, message: "Receipt not found." };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ── 14. CHANGE ROOM ALLOTMENT ─────────────────────────────────

function changeRoomAllotment(oldAllotmentId, newRoomId, newRoomNumber, newRoomType, changedBy, applyNewFees) {
  var safeString = function(val) {
    return val === null || val === undefined ? "" : val.toString().trim();
  };
  try {
    var rawId = safeString(oldAllotmentId);
    var rawNoPrefix = rawId.replace(/^ALLOT-/, "").replace(/^ALT-/, "").replace(/^APP-/, "");
    var targetAppId = rawId.indexOf("APP-") === 0 ? rawId : ("APP-" + rawNoPrefix);
    var targetAllotId = rawId.indexOf("ALLOT-") === 0 ? rawId : ("ALLOT-" + rawNoPrefix);

    var allotSheet = getSheet("ROOM_ALLOTMENTS");
    var allotData  = allotSheet.getDataRange().getValues();
    var oldRow = -1, oldAppId = "", oldStudentName = "", oldRoomId = "", oldRoomNumber = "", oldExpectedDate = "", oldAcadYear = "";
    var oldPhysicalStatus = "Not Reported", oldReportingDate = "", oldReportedBy = "", oldReportingRemarks = "";

    for (var i = 0; i < allotData.length; i++) {
      if (!allotData[i][0] || safeString(allotData[i][0]).toUpperCase() === "ALLOTMENT_ID") continue;
      var curId = safeString(allotData[i][0]);
      var curAppId = safeString(allotData[i][1]);
      var curNoPrefix = curId.replace(/^ALLOT-/, "").replace(/^ALT-/, "").replace(/^APP-/, "");
      var curAppNoPrefix = curAppId.replace(/^ALLOT-/, "").replace(/^ALT-/, "").replace(/^APP-/, "");

      if (curId === rawId || curAppId === rawId || curAppId === targetAppId || curId === targetAllotId || curNoPrefix === rawNoPrefix || curAppNoPrefix === rawNoPrefix) {
        if (safeString(allotData[i][9]) === "Active" || oldRow < 0) {
          oldRow = i + 1;
          oldAppId        = curAppId || targetAppId;
          oldStudentName  = safeString(allotData[i][2]);
          oldRoomId       = safeString(allotData[i][3]);
          oldRoomNumber   = safeString(allotData[i][4]);
          oldExpectedDate = safeString(allotData[i][7]);
          oldAcadYear     = safeString(allotData[i][11]);
          oldPhysicalStatus = safeString(allotData[i][12]) || "Not Reported";
          oldReportingDate = safeString(allotData[i][13]);
          oldReportedBy   = safeString(allotData[i][14]);
          oldReportingRemarks = safeString(allotData[i][15]);
          if (safeString(allotData[i][9]) === "Active") break;
        }
      }
    }
    if (oldRow < 0) return { success: false, message: "Allotment record not found for ID: " + oldAllotmentId };

    var currentAcadYear = oldAcadYear || getActiveAcademicYear();

    // Mark old allotment as Transferred
    allotSheet.getRange(oldRow, 9).setValue(todayFormatted()); // ACTUAL_VACATING_DATE
    allotSheet.getRange(oldRow, 10).setValue("Transferred");   // STATUS

    // Reduce old room occupied count
    var roomsSheet = getSheet("ROOMS");
    var roomsData  = roomsSheet.getDataRange().getValues();
    for (var j = 0; j < roomsData.length; j++) {
      if (!roomsData[j][0] || safeString(roomsData[j][0]).toUpperCase() === "ROOM_ID") continue;
      if (safeString(roomsData[j][0]) === oldRoomId || safeString(roomsData[j][1]) === oldRoomNumber) {
        var occ = parseInt(roomsData[j][5]) || 0;
        roomsSheet.getRange(j + 1, 6).setValue(Math.max(0, occ - 1));
        break;
      }
    }

    // Create new allotment with academic year and preserved physical reporting status
    var newAllotId = generateId("ALLOT");
    allotSheet.appendRow([
      newAllotId,
      oldAppId,
      oldStudentName,
      newRoomId || newRoomNumber,
      newRoomNumber,
      newRoomType,
      todayFormatted(),
      oldExpectedDate || "31-May-2027",
      "",
      "Active",
      changedBy || "Admin",
      currentAcadYear,
      oldPhysicalStatus,
      oldReportingDate,
      oldReportedBy,
      oldReportingRemarks
    ]);

    // Increase new room occupied count
    for (var k = 0; k < roomsData.length; k++) {
      if (!roomsData[k][0] || safeString(roomsData[k][0]).toUpperCase() === "ROOM_ID") continue;
      if (safeString(roomsData[k][0]) === safeString(newRoomId) || safeString(roomsData[k][1]) === safeString(newRoomNumber)) {
        var occ2 = parseInt(roomsData[k][5]) || 0;
        roomsSheet.getRange(k + 1, 6).setValue(occ2 + 1);
        break;
      }
    }

    // Update room info in STUDENT_APPLICATIONS sheet if present
    try {
      var appSheet = getSheet("STUDENT_APPLICATIONS");
      if (appSheet) {
        var appData = appSheet.getDataRange().getValues();
        for (var m = 0; m < appData.length; m++) {
          if (!appData[m][0] || safeString(appData[m][0]).toUpperCase() === "APP_ID") continue;
          var curAId = safeString(appData[m][0]);
          if (curAId === oldAppId || curAId === targetAppId || curAId.replace(/^APP-/,"") === rawNoPrefix) {
            appSheet.getRange(m + 1, 7).setValue(newRoomNumber);
            if (appData[m].length >= 8) appSheet.getRange(m + 1, 8).setValue(newRoomType);
            break;
          }
        }
      }
    } catch (e) {
      console.warn("Notice updating STUDENT_APPLICATIONS:", e);
    }

    SpreadsheetApp.flush();

    // --- Transfer fee logic ---
    var ledgerSheet = getSheet("STUDENT_FEE_LEDGER");
    if (ledgerSheet) {
      var ledgerRange = ledgerSheet.getDataRange();
      var ledgerData  = ledgerRange.getValues();
      for (var l = 0; l < ledgerData.length; l++) {
        var row = ledgerData[l];
        if (!row[0] || safeString(row[0]).toUpperCase() === "LEDGER_ID") continue;
        if (safeString(row[1]) === oldAppId && 
            safeString(row[3]) !== newRoomNumber && 
            safeString(row[12]) !== "Cancelled") {
          var rowNum = l + 1;
          ledgerSheet.getRange(rowNum, 9).setValue(0);
          ledgerSheet.getRange(rowNum, 10).setValue(0);
          ledgerSheet.getRange(rowNum, 11).setValue(0);
          ledgerSheet.getRange(rowNum, 13).setValue("Cancelled");
        }
      }
      SpreadsheetApp.flush();
    }

    // Optionally apply new fee structure
    var feeResult = { success: true, entriesCreated: 0 };
    if (applyNewFees) {
      feeResult = applyFeeStructureOnAllotment(oldAppId, oldStudentName, newRoomNumber, newRoomType, new Date().toISOString());
      
      if (feeResult.success && feeResult.entriesCreated > 0) {
        SpreadsheetApp.flush();
        reallocateStudentPayments(oldAppId, newRoomNumber);
      }
    }

    return {
      success: true,
      newAllotId: newAllotId,
      feeApplied: applyNewFees && feeResult.entriesCreated > 0,
      entriesCreated: feeResult.entriesCreated || 0,
      feeMessage: feeResult.message || ""
    };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function reallocateStudentPayments(appId, currentRoomNumber) {
  try {
    return reconcileAllFeeReceipts(appId);
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function fixStudentDoubleFees(appId) {
  var safeString = function(val) {
    return val === null || val === undefined ? "" : val.toString().trim();
  };
  try {
    // 1. Get allotments and clean up duplicate active allotments
    var allotSheet = getSheet("ROOM_ALLOTMENTS");
    var allotData = allotSheet.getDataRange().getValues();
    var activeAllotments = [];
    for (var i = 0; i < allotData.length; i++) {
      if (!allotData[i][0] || safeString(allotData[i][0]).toUpperCase() === "ALLOTMENT_ID") continue;
      if (safeString(allotData[i][1]) === safeString(appId) && safeString(allotData[i][9]) === "Active") {
        activeAllotments.push({
          allotId: safeString(allotData[i][0]),
          rowIndex: i + 1,
          studentName: safeString(allotData[i][2]),
          roomNumber: safeString(allotData[i][4]),
          roomType: safeString(allotData[i][5]),
          date: safeString(allotData[i][6])
        });
      }
    }
    
    if (activeAllotments.length === 0) {
      return { success: false, message: "No active room allotment found for student." };
    }

    // Keep the latest active allotment (the last one in the sheet)
    var latestAllot = activeAllotments[activeAllotments.length - 1];
    var currentRoomNumber = latestAllot.roomNumber;
    var roomType = latestAllot.roomType;
    var studentName = latestAllot.studentName;

    // Mark previous active allotments as Transferred to clean up duplicates
    for (var a = 0; a < activeAllotments.length - 1; a++) {
      var rowNum = activeAllotments[a].rowIndex;
      allotSheet.getRange(rowNum, 9).setValue(todayFormatted()); // ACTUAL_VACATING_DATE
      allotSheet.getRange(rowNum, 10).setValue("Transferred");   // STATUS
    }
    SpreadsheetApp.flush();

    // 2. Cancel all old ledger entries (where room number !== currentRoomNumber)
    var ledgerSheet = getSheet("STUDENT_FEE_LEDGER");
    var ledgerData = ledgerSheet.getDataRange().getValues();
    for (var l = 0; l < ledgerData.length; l++) {
      var row = ledgerData[l];
      if (!row[0] || safeString(row[0]).toUpperCase() === "LEDGER_ID") continue;
      if (safeString(row[1]) === safeString(appId) && 
          safeString(row[3]) !== currentRoomNumber && 
          safeString(row[12]) !== "Cancelled") {
        
        var rowNum = l + 1;
        ledgerSheet.getRange(rowNum, 9).setValue(0);
        ledgerSheet.getRange(rowNum, 10).setValue(0);
        ledgerSheet.getRange(rowNum, 11).setValue(0);
        ledgerSheet.getRange(rowNum, 13).setValue("Cancelled");
      }
    }
    SpreadsheetApp.flush();
    
    // Reload ledger data
    ledgerData = ledgerSheet.getDataRange().getValues();

    // Check if there are active ledger entries for the current room
    var hasCurrentLedger = false;
    for (var l = 0; l < ledgerData.length; l++) {
      var row = ledgerData[l];
      if (!row[0] || safeString(row[0]).toUpperCase() === "LEDGER_ID") continue;
      if (safeString(row[1]) === safeString(appId) && 
          safeString(row[3]) === currentRoomNumber && 
          safeString(row[12]) !== "Cancelled") {
        hasCurrentLedger = true;
        break;
      }
    }

    // If no active ledger entries exist for the current room, generate them!
    if (!hasCurrentLedger) {
      Logger.log("Generating fee structure for current room " + currentRoomNumber);
      var feeResult = applyFeeStructureOnAllotment(appId, studentName, currentRoomNumber, roomType, new Date().toISOString());
      if (!feeResult.success) {
        return { success: false, message: "Failed to generate fee structure: " + feeResult.message };
      }
      SpreadsheetApp.flush();
    }

    // 3. Reallocate all payments to the current room ledger
    reallocateStudentPayments(appId, currentRoomNumber);

    return { success: true, message: "Student fee data successfully cleaned up and merged!" };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function runCleanupForStudent() {
  var studentName = "TEST STUDENT SECOND"; // You can change this to any student name (e.g. "Aisha Khan") to clean up their ledger
  var sheet = getSheet("STUDENT_APPLICATIONS");
  var data = sheet.getDataRange().getValues();
  var appId = "";
  for (var i = 0; i < data.length; i++) {
    if (data[i][2] && data[i][2].toString().trim().toLowerCase() === studentName.toLowerCase().trim()) {
      appId = data[i][0].toString().trim();
      break;
    }
  }
  if (!appId) {
    Logger.log(studentName + " not found in STUDENT_APPLICATIONS.");
    return;
  }
  var res = fixStudentDoubleFees(appId);
  Logger.log("Result: " + res.message);
}

function diagnoseStudentFees() {
  var studentName = "TEST STUDENT SECOND";
  var safeString = function(val) {
    return val === null || val === undefined ? "" : val.toString().trim();
  };
  
  Logger.log("=== DIAGNOSING student: " + studentName + " ===");
  
  var appSheet = getSheet("STUDENT_APPLICATIONS");
  var appData = appSheet.getDataRange().getValues();
  var appId = "";
  for (var i = 0; i < appData.length; i++) {
    if (appData[i][2] && safeString(appData[i][2]).toLowerCase() === studentName.toLowerCase().trim()) {
      appId = safeString(appData[i][0]);
      Logger.log("Found App ID: " + appId);
      break;
    }
  }
  if (!appId) {
    Logger.log("Student not found in STUDENT_APPLICATIONS.");
    return;
  }
  
  var allotSheet = getSheet("ROOM_ALLOTMENTS");
  var allotData = allotSheet.getDataRange().getValues();
  Logger.log("--- Allotments ---");
  for (var i = 0; i < allotData.length; i++) {
    if (safeString(allotData[i][1]) === appId) {
      Logger.log("Allotment ID: " + allotData[i][0] + " | Room: " + allotData[i][4] + " | Status: " + allotData[i][9]);
    }
  }
  
  var ledgerSheet = getSheet("STUDENT_FEE_LEDGER");
  var ledgerData = ledgerSheet.getDataRange().getValues();
  Logger.log("--- Ledger Entries ---");
  for (var l = 0; l < ledgerData.length; l++) {
    var row = ledgerData[l];
    if (safeString(row[1]) === appId) {
      Logger.log("Ledger ID: " + row[0] + " | Room: " + row[3] + " | Head: " + row[6] + " | Month: " + row[7] + " | Applicable: " + row[8] + " | Paid: " + row[9] + " | Balance: " + row[10] + " | Status: " + row[12]);
    }
  }
  
  var receiptSheet = getSheet("FEE_RECEIPTS");
  var receiptData = receiptSheet.getDataRange().getValues();
  Logger.log("--- Receipts ---");
  for (var r = 0; r < receiptData.length; r++) {
    var row = receiptData[r];
    if (safeString(row[2]) === appId) {
      Logger.log("Receipt ID: " + row[0] + " | Room: " + row[4] + " | Type: " + row[5] + " | Amount: " + row[6] + " | Status: " + row[13] + " | Ledger ID: " + row[14]);
    }
  }
}

function onFormSubmitTrigger(e) {
  try {
    var answers = {};
    
    // Log the entire event to help diagnose any issues
    Logger.log("Event keys: " + (e ? Object.keys(e).join(", ") : "null"));
    
    if (e && e.namedValues) {
      // Best method for Spreadsheet-bound trigger: e.namedValues maps question titles directly
      for (var key in e.namedValues) {
        // e.namedValues contains arrays of answers, take the first element
        answers[key] = e.namedValues[key][0];
      }
      Logger.log("Mapped from e.namedValues: " + JSON.stringify(answers));
    } else if (e && e.values) {
      // Fallback: read columns dynamically using headers
      var sheet = e.range.getSheet();
      var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      for (var col = 0; col < headers.length; col++) {
        var header = headers[col].toString().trim();
        var val = e.values[col];
        answers[header] = val;
      }
      Logger.log("Mapped from e.values: " + JSON.stringify(answers));
    } else if (e && e.response) {
      // Form-bound trigger
      var itemResponses = e.response.getItemResponses();
      for (var i = 0; i < itemResponses.length; i++) {
        var itemResponse = itemResponses[i];
        var question = itemResponse.getItem().getTitle().toString().trim();
        var answer = itemResponse.getResponse();
        answers[question] = answer;
      }
      Logger.log("Mapped from e.response: " + JSON.stringify(answers));
    } else {
      Logger.log("Trigger fired, but no event data found.");
      return;
    }
    
    // Helper function to search keys case-insensitively, space-insensitively, and punctuation-insensitively
    var findVal = function(possibleKeys) {
      var clean = function(str) {
        return str.toString().toLowerCase().replace(/[^a-z0-9]/g, "");
      };
      var cleanedPossibles = possibleKeys.map(clean);
      for (var k in answers) {
        if (cleanedPossibles.indexOf(clean(k)) !== -1) {
          return answers[k].toString().trim();
        }
      }
      return "";
    };
    
    // Map the questions to our formData keys using robust matching
    var formData = {
      studentName:            findVal(["studentname", "nameofstudent", "name", "fullname", "nameofstaff", "studentfullname"]),
      fatherName:             findVal(["fathername", "fathersname", "father", "fathernameofstudent", "fatherfullname"]),
      motherName:             findVal(["mothername", "mothersname", "mother", "motherfullname"]),
      dateOfBirth:            findVal(["dateofbirth", "dob", "birthdate", "dateofbirthdob"]),
      contactNumber:          findVal(["contactnumber", "studentcontactnumber", "mobile", "mobileno", "phone", "studentmobile", "studentcontact", "studentphonenumber", "mobilephone"]),
      parentContact:          findVal(["parentcontact", "parentcontactnumber", "parentmobile", "fathercontact", "guardiancontact", "parentphone", "mothercontact", "parentmobileno"]),
      email:                  findVal(["email", "emailaddress", "emailid", "studentemail"]),
      address:                findVal(["address", "permanentaddress", "residenceaddress", "fulladdress"]),
      city:                   findVal(["city", "town", "district"]),
      state:                  findVal(["state", "region"]),
      course:                 findVal(["course", "branch", "stream", "department", "dept", "coursebranch"]),
      yearOfStudy:            findVal(["yearofstudy", "year", "currentyear", "yearofcourse", "class"]),
      collegeName:            normalizeCollegeName(findVal(["collegename", "college", "institutename", "institute", "nameofcollege"])),
      aadharNumber:           findVal(["aadharnumber", "aadharcardno", "aadhar", "aadharcard", "aadharno", "uid"]),
      emergencyContactName:   findVal(["emergencycontactname", "emergencyname", "contactperson", "emergencycontactperson"]),
      emergencyContactNumber: findVal(["emergencycontactnumber", "emergencycontact", "emergencyphone", "emergencycontactno", "emergencycontactmobile"]),
      roomTypePreference:     findVal(["roomtypepreference", "roompreference", "preferenceofroom", "roomtype", "roomtypepreferred"])
    };
    
    Logger.log("Final mapped formData: " + JSON.stringify(formData));
    
    // Call submitStudentApplication to insert it into STUDENT_APPLICATIONS sheet
    var result = submitStudentApplication(formData);
    
    if (result.success) {
      Logger.log("Successfully created application " + result.appId + " from Google Form submission.");
    } else {
      Logger.log("Failed to process Google Form submission: " + result.message);
    }
  } catch (err) {
    Logger.log("Error in onFormSubmitTrigger: " + err.message);
  }
}

function logFormHeaders() {
  var ss = getSpreadsheet();
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var name = sheets[i].getName();
    if (name.indexOf("Responses") !== -1 || name.indexOf("Form") !== -1) {
      Logger.log("Found Form Responses Sheet: " + name);
      var headers = sheets[i].getRange(1, 1, 1, sheets[i].getLastColumn()).getValues()[0];
      Logger.log("Headers for " + name + ": " + JSON.stringify(headers));
    }
  }
}

function syncFormResponsesToApplications() {
  try {
    var ss = getSpreadsheet();
    var sheets = ss.getSheets();
    var formSheet = null;
    
    // Find the sheet storing Google Form responses
    for (var s = 0; s < sheets.length; s++) {
      var sName = sheets[s].getName();
      if (sName.indexOf("Form Responses") !== -1 || sName.indexOf("Responses") !== -1 || sName.indexOf("Form") !== -1) {
        formSheet = sheets[s];
        break;
      }
    }
    
    if (!formSheet) return { success: false, message: "Form Responses sheet not found" };
    
    var data = formSheet.getDataRange().getValues();
    if (data.length <= 1) return { success: true, count: 0 };
    
    var headers = data[0] || [];
    var appSheet = getSheet("STUDENT_APPLICATIONS");
    var existingApps = appSheet.getDataRange().getValues();
    
    // Build set of existing Mobile Numbers, Aadhar, or Student Name + Mobile combination
    var existingKeys = {};
    for (var e = 1; e < existingApps.length; e++) {
      var mob = (existingApps[e][6] || "").toString().trim(); // Column G: CONTACT_NUMBER
      var aadh = (existingApps[e][15] || "").toString().trim(); // Column P: AADHAR_NUMBER
      var nameVal = (existingApps[e][2] || "").toString().trim().toLowerCase(); // Column C: STUDENT_NAME
      var fatherVal = (existingApps[e][3] || "").toString().trim().toLowerCase(); // Column D: FATHER_NAME
      
      if (aadh && aadh !== "0" && aadh !== "999999999999" && aadh.length >= 8) existingKeys["aadh:" + aadh] = true;
      if (nameVal && mob) existingKeys["namemob:" + nameVal + "_" + mob] = true;
      if (nameVal && fatherVal) existingKeys["namefather:" + nameVal + "_" + fatherVal] = true;
    }
    
    // Find column indices for questions from form headers
    var findColIndex = function(possibleKeys) {
      var clean = function(str) { return str.toString().toLowerCase().replace(/[^a-z0-9]/g, ""); };
      var cleanedPossibles = possibleKeys.map(clean);
      for (var c = 0; c < headers.length; c++) {
        if (cleanedPossibles.indexOf(clean(headers[c])) !== -1) return c;
      }
      return -1;
    };

    var colStudentName   = findColIndex(["studentname", "nameofstudent", "name", "fullname", "nameofstaff", "studentfullname", "applicantname", "nameofapplicant", "candidatename"]);
    var colFatherName    = findColIndex(["fathername", "fathersname", "father", "fathernameofstudent", "fatherfullname", "guardiansname", "guardianname"]);
    var colMotherName    = findColIndex(["mothername", "mothersname", "mother", "motherfullname"]);
    var colDOB           = findColIndex(["dateofbirth", "dob", "birthdate", "dateofbirthdob", "birth"]);
    var colContact       = findColIndex(["contactnumber", "studentcontactnumber", "mobile", "mobileno", "mobilenumber", "phone", "studentmobile", "studentcontact", "studentphonenumber", "mobilephone", "whatsappnumber", "contactno", "phoneno", "cellphone"]);
    var colParentContact = findColIndex(["parentcontact", "parentcontactnumber", "parentmobile", "fathercontact", "guardiancontact", "parentphone", "mothercontact", "parentmobileno", "parentsmobilenumber", "fathersmobile"]);
    var colEmail         = findColIndex(["email", "emailaddress", "emailid", "studentemail", "mailid"]);
    var colAddress       = findColIndex(["address", "permanentaddress", "residenceaddress", "fulladdress", "residentialaddress", "homeaddress"]);
    var colCity          = findColIndex(["city", "town", "district", "citytown", "nativecity"]);
    var colState         = findColIndex(["state", "region", "nativestate"]);
    var colCourse        = findColIndex(["course", "branch", "stream", "department", "dept", "coursebranch", "selectcourse", "courseenrolled", "courseappliedfor", "degreecourse", "education"]);
    var colYearOfStudy   = findColIndex(["yearofstudy", "year", "currentyear", "yearofcourse", "class", "academicyear", "yearofadmission", "studyingyear"]);
    var colCollegeName   = findColIndex(["collegename", "college", "institutename", "institute", "nameofcollege", "selectcollege", "schoolcollegename", "nameofcollegeinstitute"]);
    var colAadhar        = findColIndex(["aadharnumber", "aadharcardno", "aadhar", "aadharcard", "aadharno", "uid", "aadhaarnumber", "aadhaarcardnumber", "aadhaarcardno", "aadhaarno", "aadhaar"]);
    var colEmergName     = findColIndex(["emergencycontactname", "emergencyname", "contactperson", "emergencycontactperson"]);
    var colEmergNo       = findColIndex(["emergencycontactnumber", "emergencycontact", "emergencyphone", "emergencycontactno", "emergencycontactmobile", "emergencymobile"]);
    var colRoomPref      = findColIndex(["roomtypepreference", "roompreference", "preferenceofroom", "roomtype", "roomtypepreferred", "selectroomtype", "roomtypechoice"]);

    var importedCount = 0;
    
    for (var r = 1; r < data.length; r++) {
      var row = data[r];
      var sName = (colStudentName !== -1 && row[colStudentName]) ? row[colStudentName].toString().trim() : "";
      var mob = (colContact !== -1 && row[colContact]) ? row[colContact].toString().trim() : "";
      var aadh = (colAadhar !== -1 && row[colAadhar]) ? row[colAadhar].toString().trim() : "";
      var fName = (colFatherName !== -1 && row[colFatherName]) ? row[colFatherName].toString().trim() : "";
      
      if (!sName) continue;
      
      // Check if already imported using composite keys
      var nameKey = sName.toLowerCase();
      var fatherKey = fName.toLowerCase();
      var isDuplicate = false;

      if (aadh && aadh !== "0" && aadh !== "999999999999" && aadh.length >= 8 && existingKeys["aadh:" + aadh]) isDuplicate = true;
      if (nameKey && mob && existingKeys["namemob:" + nameKey + "_" + mob]) isDuplicate = true;
      if (nameKey && fatherKey && existingKeys["namefather:" + nameKey + "_" + fatherKey]) isDuplicate = true;

      if (isDuplicate) {
        continue; // Skip duplicate
      }
      
      var formData = {
        studentName:            sName,
        fatherName:             fName,
        motherName:             (colMotherName !== -1 && row[colMotherName]) ? row[colMotherName].toString().trim() : "",
        dateOfBirth:            (colDOB !== -1 && row[colDOB]) ? formatDateValue(row[colDOB]) : "",
        contactNumber:          mob,
        parentContact:          (colParentContact !== -1 && row[colParentContact]) ? row[colParentContact].toString().trim() : "",
        email:                  (colEmail !== -1 && row[colEmail]) ? row[colEmail].toString().trim() : "",
        address:                (colAddress !== -1 && row[colAddress]) ? row[colAddress].toString().trim() : "",
        city:                   (colCity !== -1 && row[colCity]) ? row[colCity].toString().trim() : "",
        state:                  (colState !== -1 && row[colState]) ? row[colState].toString().trim() : "Maharashtra",
        course:                 (colCourse !== -1 && row[colCourse]) ? row[colCourse].toString().trim() : "",
        yearOfStudy:            (colYearOfStudy !== -1 && row[colYearOfStudy]) ? row[colYearOfStudy].toString().trim() : "",
        collegeName:            normalizeCollegeName((colCollegeName !== -1 && row[colCollegeName]) ? row[colCollegeName].toString().trim() : ""),
        aadharNumber:           aadh,
        emergencyContactName:   (colEmergName !== -1 && row[colEmergName]) ? row[colEmergName].toString().trim() : "",
        emergencyContactNumber: (colEmergNo !== -1 && row[colEmergNo]) ? row[colEmergNo].toString().trim() : "",
        roomTypePreference:     (colRoomPref !== -1 && row[colRoomPref]) ? row[colRoomPref].toString().trim() : ""
      };
      
      var res = submitStudentApplication(formData);
      if (res.success) {
        if (mob) existingKeys["mob:" + mob] = true;
        if (aadh) existingKeys["aadh:" + aadh] = true;
        if (nameKey && mob) existingKeys["namemob:" + nameKey + "_" + mob] = true;
        if (nameKey && fatherKey) existingKeys["namefather:" + nameKey + "_" + fatherKey] = true;
        existingKeys["nameonly:" + nameKey] = true;
        importedCount++;
      }
    }
    
    return { success: true, importedCount: importedCount };
  } catch (err) {
    Logger.log("syncFormResponsesToApplications error: " + err.message);
    return { success: false, message: err.message };
  }
}

function setupFormSubmitTrigger() {
  try {
    var ss = getSpreadsheet();
    var triggers = ScriptApp.getProjectTriggers();
    for (var i = 0; i < triggers.length; i++) {
      if (triggers[i].getHandlerFunction() === "onFormSubmitTrigger") {
        return { success: true, message: "Trigger already active." };
      }
    }
    ScriptApp.newTrigger("onFormSubmitTrigger")
      .forSpreadsheet(ss)
      .onFormSubmit()
      .create();
    return { success: true, message: "On form submit trigger installed successfully." };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ── 15. SAVE SETTINGS ─────────────────────────────────────────
function saveSettings(settingsObj) {
  try {
    var sheet = getSheet("SETTINGS");
    var range = sheet.getDataRange();
    var data = range.getValues();
    
    for (var key in settingsObj) {
      var val = settingsObj[key].toString().trim();
      var found = false;
      for (var i = 0; i < data.length; i++) {
        if (data[i][0] && data[i][0].toString().trim() === key) {
          sheet.getRange(i + 1, 2).setValue(val);
          found = true;
          break;
        }
      }
      if (!found) {
        sheet.appendRow([key, val]);
      }
    }
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ── 16. ADD & DELETE ROOM ────────────────────────────────────
function addRoom(roomData) {
  try {
    var sheet = getSheet("ROOMS");
    var data = sheet.getDataRange().getValues();
    var roomNumLower = roomData.roomNumber.toString().trim().toLowerCase();
    for (var i = 0; i < data.length; i++) {
      if (data[i][1] && data[i][1].toString().trim().toLowerCase() === roomNumLower) {
        return { success: false, message: 'Room number "' + roomData.roomNumber + '" already exists.' };
      }
    }
    var roomId = generateId("RM");
    sheet.appendRow([
      roomId,
      roomData.roomNumber.toString().trim(),
      roomData.floor.toString().trim(),
      roomData.roomType.toString().trim(),
      parseInt(roomData.capacity) || 0,
      0 // OCCUPIED starts at 0
    ]);
    return { success: true, roomId: roomId };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function deleteRoom(roomId) {
  try {
    var sheet = getSheet("ROOMS");
    var data = sheet.getDataRange().getValues();
    for (var i = 0; i < data.length; i++) {
      if (!data[i][0] || data[i][0].toString().trim().toUpperCase() === "ROOM_ID") continue;
      if (data[i][0].toString().trim() === roomId.toString().trim()) {
        var occupiedCount = parseInt(data[i][5]) || 0;
        if (occupiedCount > 0) {
          return { success: false, message: "Cannot delete a room that is currently occupied (" + occupiedCount + " student(s) alloted)." };
        }
        sheet.deleteRow(i + 1);
        return { success: true };
      }
    }
    return { success: false, message: "Room not found." };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ── 17. GET STUDENT DETAILS FOR RECEIPT ──────────────────────────
function getStudentDetails(appId) {
  try {
    var appSheet = getSheet("STUDENT_APPLICATIONS");
    var appData = appSheet.getDataRange().getValues();
    var studentInfo = {
      contactNumber: "",
      course: "",
      yearOfStudy: "",
      collegeName: "",
      roomType: ""
    };
    
    var appRow = null;
    for (var i = 0; i < appData.length; i++) {
      if (appData[i][0] && appData[i][0].toString().trim() === appId.toString().trim()) {
        appRow = appData[i];
        break;
      }
    }
    
    if (appRow) {
      studentInfo.contactNumber = (appRow[6] || "").toString().trim();
      studentInfo.course = (appRow[12] || "").toString().trim();
      studentInfo.yearOfStudy = (appRow[13] || "").toString().trim();
      studentInfo.collegeName = (appRow[14] || "").toString().trim();
      
      var allotSheet = getSheet("ROOM_ALLOTMENTS");
      var allotData = allotSheet.getDataRange().getValues();
      for (var j = 0; j < allotData.length; j++) {
        if (allotData[j][1] && allotData[j][1].toString().trim() === appId.toString().trim() && 
            allotData[j][9] && allotData[j][9].toString().trim() === "Active") {
          studentInfo.roomType = (allotData[j][5] || "").toString().trim();
          break;
        }
      }
      
      if (!studentInfo.roomType) {
        studentInfo.roomType = (appRow[18] || "").toString().trim();
      }
    }
    
    return { success: true, data: studentInfo };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ── 18. DATE MIGRATION HELPER ────────────────────────────────────
function checkAndMigrateDates() {
  var settingsSheet;
  try {
    settingsSheet = getSheet("SETTINGS");
  } catch (e) {
    return; // settings sheet not found
  }
  
  var settingsData = settingsSheet.getDataRange().getValues();
  var isMigrated = false;
  for (var i = 0; i < settingsData.length; i++) {
    if (settingsData[i][0] && settingsData[i][0].toString().trim() === "DATES_MIGRATED") {
      if (settingsData[i][1] && settingsData[i][1].toString().trim().toUpperCase() === "TRUE") {
        isMigrated = true;
      }
      break;
    }
  }
  
  if (isMigrated) return;
  
  migrateAllDatesInSheets();
  
  // Save migrated flag
  var keyFound = false;
  for (var i = 0; i < settingsData.length; i++) {
    if (settingsData[i][0] && settingsData[i][0].toString().trim() === "DATES_MIGRATED") {
      settingsSheet.getRange(i + 1, 2).setValue("TRUE");
      keyFound = true;
      break;
    }
  }
  if (!keyFound) {
    settingsSheet.appendRow(["DATES_MIGRATED", "TRUE", "Tracks if date format migration has run"]);
  }
}

function migrateAllDatesInSheets() {
  migrateSheetDates("STUDENT_APPLICATIONS", [1, 5, 21]);
  migrateSheetDates("ROOM_ALLOTMENTS", [6, 7, 8]);
  migrateSheetDates("FEE_RECEIPTS", [1]);
  migrateSheetDates("STUDENT_FEE_LEDGER", [11, 13]);
}

function migrateSheetDates(sheetName, colIndices) {
  var sheet;
  try {
    sheet = getSheet(sheetName);
  } catch (e) {
    return;
  }
  
  var range = sheet.getDataRange();
  var values = range.getValues();
  if (values.length <= 1) return;
  
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    colIndices.forEach(function(colIdx) {
      var val = row[colIdx];
      if (!val) return;
      
      var correctedDateStr = "";
      if (val instanceof Date) {
        // Swap month/day back (written as dd/MM but interpreted as MM/dd)
        var day = val.getMonth() + 1;
        var month = val.getDate();
        var year = val.getFullYear();
        
        var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        var mmm = months[month - 1] || "Jan";
        var dd = day < 10 ? "0" + day : day.toString();
        correctedDateStr = dd + "-" + mmm + "-" + year;
      } else {
        var str = val.toString().trim();
        if (str === "") return;
        
        // Already in target format
        var matchTarget = str.match(/^\d{2}-[A-Za-z]{3}-\d{4}$/);
        if (matchTarget) return;
        
        // Parse DD/MM/YYYY or DD-MM-YYYY
        var matchDMY = str.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
        if (matchDMY) {
          var day = parseInt(matchDMY[1], 10);
          var month = parseInt(matchDMY[2], 10);
          var year = parseInt(matchDMY[3], 10);
          
          var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
          var mmm = months[month - 1] || "Jan";
          var dd = day < 10 ? "0" + day : day.toString();
          correctedDateStr = dd + "-" + mmm + "-" + year;
        }
      }
      
      if (correctedDateStr !== "") {
        sheet.getRange(i + 1, colIdx + 1).setValue(correctedDateStr);
      }
    });
  }
}

// ── 19. ACADEMIC YEAR MANAGEMENT ─────────────────────────────────
function getActiveAcademicYear() {
  try {
    var settingsSheet = getSheet("SETTINGS");
    var data = settingsSheet.getDataRange().getValues();
    for (var i = 0; i < data.length; i++) {
      if (data[i][0] && data[i][0].toString().trim() === "CURRENT_ACADEMIC_YEAR") {
        var val = data[i][1] ? data[i][1].toString().trim() : "";
        if (val !== "") return val;
      }
    }
  } catch (e) {}
  return "2026-27"; // default starting year
}

function ensureAcademicYearColumns() {
  var activeYear = getActiveAcademicYear();
  try { ensureSheetAcademicYearColumn("STUDENT_APPLICATIONS", 24, activeYear); } catch (e) { Logger.log("STUDENT_APPLICATIONS acad year: " + e.message); }
  try { ensureSheetAcademicYearColumn("ROOM_ALLOTMENTS", 12, activeYear); } catch (e) { Logger.log("ROOM_ALLOTMENTS acad year: " + e.message); }
  try { ensureSheetAcademicYearColumn("FEE_RECEIPTS", 16, activeYear); } catch (e) { Logger.log("FEE_RECEIPTS acad year: " + e.message); }
  try { ensureSheetAcademicYearColumn("STUDENT_FEE_LEDGER", 15, activeYear); } catch (e) { Logger.log("STUDENT_FEE_LEDGER acad year: " + e.message); }
}

function ensureSheetAcademicYearColumn(sheetName, totalColsNeeded, activeYear) {
  var sheet;
  try {
    sheet = getSheet(sheetName);
  } catch (e) {
    return;
  }
  
  var maxCols = sheet.getMaxColumns();
  var range = sheet.getDataRange();
  var values = range.getValues();
  if (values.length <= 1) return;
  var headerRow = values[0] || [];
  
  var headerColIndex = -1;
  for (var c = 0; c < headerRow.length; c++) {
    var h = (headerRow[c] || "").toString().trim().toUpperCase().replace(/[\s_-]+/g, "_");
    if (h === "ACADEMIC_YEAR" || h === "ACAD_YEAR") {
      headerColIndex = c;
      break;
    }
  }
  
  if (headerColIndex === -1) {
    var colToInsert = Math.max(headerRow.length + 1, totalColsNeeded || 0);
    if (colToInsert > maxCols) {
      sheet.insertColumnsAfter(maxCols, colToInsert - maxCols);
      maxCols = sheet.getMaxColumns();
    }
    sheet.getRange(1, colToInsert).setValue("ACADEMIC_YEAR");
    headerColIndex = colToInsert - 1;
  }
  
  // Fast batch update: prepare all row values and write in single setValues call
  var colUpdates = [];
  var hasEmpty = false;
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var cellVal = (headerColIndex < row.length && row[headerColIndex] !== undefined && row[headerColIndex] !== null) ? row[headerColIndex].toString().trim() : "";
    if (row[0] && cellVal === "") {
      colUpdates.push([activeYear]);
      hasEmpty = true;
    } else {
      colUpdates.push([cellVal]);
    }
  }
  
  if (hasEmpty && colUpdates.length > 0) {
    sheet.getRange(2, headerColIndex + 1, colUpdates.length, 1).setValues(colUpdates);
  }
}

function rolloverAcademicYear(newYearName, runBy) {
  try {
    if (!newYearName) {
      return { success: false, message: "Please specify the new Academic Year name." };
    }
    newYearName = newYearName.toString().trim();
    var match = newYearName.match(/^(\d{4})-(\d{2})$/);
    if (!match) {
      return { success: false, message: "Invalid format. Academic Year must be in YYYY-YY format, e.g. 2027-28." };
    }
    
    var currentYear = getActiveAcademicYear();
    if (currentYear === newYearName) {
      return { success: false, message: "The specified academic year is already the active academic year." };
    }
    
    var settingsSheet = getSheet("SETTINGS");
    var settingsData = settingsSheet.getDataRange().getValues();
    var keyFound = false;
    for (var i = 0; i < settingsData.length; i++) {
      if (settingsData[i][0] && settingsData[i][0].toString().trim() === "CURRENT_ACADEMIC_YEAR") {
        settingsSheet.getRange(i + 1, 2).setValue(newYearName);
        keyFound = true;
        break;
      }
    }
    if (!keyFound) {
      settingsSheet.appendRow(["CURRENT_ACADEMIC_YEAR", newYearName, "Current active academic year"]);
    }
    
    var allotSheet = getSheet("ROOM_ALLOTMENTS");
    var allotRange = allotSheet.getDataRange();
    var allotData = allotRange.getValues();
    var activeAllotments = [];
    
    for (var i = 1; i < allotData.length; i++) {
      var row = allotData[i];
      if (!row[0]) continue;
      
      var status = (row[9] || "").toString().trim();
      var yearVal = (row[11] || "").toString().trim();
      
      if (status === "Active" && yearVal === currentYear) {
        activeAllotments.push({
          rowIndex: i + 1,
          allotmentId: row[0].toString().trim(),
          appId: row[1].toString().trim(),
          studentName: row[2].toString().trim(),
          roomId: row[3].toString().trim(),
          roomNumber: row[4].toString().trim(),
          roomType: row[5].toString().trim(),
          expectedVacatingDate: row[7] ? row[7].toString() : "",
          allottedBy: row[10].toString().trim()
        });
      }
    }
    
    var migratedCount = 0;
    var prevDuesCount = 0;
    var ledgerSheet = getSheet("STUDENT_FEE_LEDGER");
    
    activeAllotments.forEach(function(allot) {
      allotSheet.getRange(allot.rowIndex, 10).setValue("Completed");
      allotSheet.getRange(allot.rowIndex, 9).setValue(todayFormatted());
      
      var newAllotId = generateId("ALLOT");
      allotSheet.appendRow([
        newAllotId,
        allot.appId,
        allot.studentName,
        allot.roomId,
        allot.roomNumber,
        allot.roomType,
        todayFormatted(),
        allot.expectedVacatingDate,
        "",
        "Active",
        runBy,
        newYearName
      ]);
      migratedCount++;
      
      var ledgerData = ledgerSheet.getDataRange().getValues();
      var outstandingDues = 0;
      
      for (var l = 1; l < ledgerData.length; l++) {
        var lRow = ledgerData[l];
        if (!lRow[0]) continue;
        
        var lAppId = (lRow[1] || "").toString().trim();
        var lYear = (lRow[14] || "").toString().trim();
        var lBal = parseFloat(lRow[10]) || 0;
        
        if (lAppId === allot.appId && lYear === currentYear) {
          outstandingDues += lBal;
        }
      }
      
      if (outstandingDues > 0) {
        var newLedgerId = generateId("LDG");
        ledgerSheet.appendRow([
          newLedgerId,
          allot.appId,
          allot.studentName,
          allot.roomNumber,
          "CARRIED_FORWARD",
          "PREV_DUES",
          "Outstanding Dues (Carried Forward from " + currentYear + ")",
          "Opening Balance",
          outstandingDues,
          0,
          outstandingDues,
          todayFormatted(),
          "Pending",
          todayFormatted(),
          newYearName
        ]);
        prevDuesCount++;
      }
    });
    
    return {
      success: true,
      message: "Academic Year successfully rolled over to " + newYearName + "!",
      currentYear: newYearName,
      migratedCount: migratedCount,
      prevDuesCount: prevDuesCount
    };
  } catch (err) {
    return { success: false, message: "Rollover error: " + err.message };
  }
}

// ── 20. USER MANAGEMENT APIs ─────────────────────────────────────
function ensureUserStatusColumn() {
  try {
    var sheet = getSheet("USERS");
    var maxCols = sheet.getMaxColumns();
    var range = sheet.getDataRange();
    var values = range.getValues();
    var headerRow = values[0] || [];
    
    var headerColIndex = -1;
    for (var c = 0; c < headerRow.length; c++) {
      if (headerRow[c] && headerRow[c].toString().trim().toUpperCase() === "STATUS") {
        headerColIndex = c;
        break;
      }
    }
    
    if (headerColIndex === -1) {
      sheet.getRange(1, 6).setValue("STATUS");
      headerColIndex = 5;
    }
    
    for (var r = 1; r < values.length; r++) {
      var row = values[r];
      if (!row[0]) continue;
      var cellVal = row[headerColIndex] ? row[headerColIndex].toString().trim() : "";
      if (cellVal === "") {
        sheet.getRange(r + 1, headerColIndex + 1).setValue("Active");
      }
    }
  } catch (e) {
    Logger.log("ensureUserStatusColumn error: " + e.message);
  }
}

// ── 20B. PHYSICAL REPORTING & STAY VERIFICATION APIs ─────────────
function ensurePhysicalReportingColumns() {
  try {
    var sheet = getSheet("ROOM_ALLOTMENTS");
    var maxCols = sheet.getMaxColumns();
    var range = sheet.getDataRange();
    var values = range.getValues();
    if (values.length < 1) return;
    var headerRow = values[0] || [];

    var colsToEnsure = [
      { name: "PHYSICAL_STATUS", defaultVal: "Not Reported" },
      { name: "REPORTING_DATE", defaultVal: "" },
      { name: "REPORTED_VERIFIED_BY", defaultVal: "" },
      { name: "REPORTING_REMARKS", defaultVal: "" }
    ];

    var headerIndices = {};
    for (var c = 0; c < headerRow.length; c++) {
      var h = (headerRow[c] || "").toString().trim().toUpperCase().replace(/[\s_-]+/g, "_");
      headerIndices[h] = c;
    }

    var neededCols = [];
    colsToEnsure.forEach(function(item) {
      if (headerIndices[item.name] === undefined) {
        neededCols.push(item);
      }
    });

    if (neededCols.length > 0) {
      var currentHeaderLen = headerRow.length;
      var totalNeeded = currentHeaderLen + neededCols.length;
      if (totalNeeded > maxCols) {
        sheet.insertColumnsAfter(maxCols, totalNeeded - maxCols);
        maxCols = sheet.getMaxColumns();
      }
      for (var n = 0; n < neededCols.length; n++) {
        var newColIdx = currentHeaderLen + n + 1; // 1-based
        sheet.getRange(1, newColIdx).setValue(neededCols[n].name);
        headerIndices[neededCols[n].name] = newColIdx - 1;
      }
      SpreadsheetApp.flush();
    }

    // Check if PHYSICAL_STATUS column has empty values in existing rows and backfill "Not Reported"
    var physIdx = headerIndices["PHYSICAL_STATUS"];
    if (physIdx !== undefined && values.length > 1) {
      var backfillNeeded = false;
      var updates = [];
      for (var r = 1; r < values.length; r++) {
        var rVal = (physIdx < values[r].length && values[r][physIdx] !== undefined && values[r][physIdx] !== null)
          ? values[r][physIdx].toString().trim()
          : "";
        if (values[r][0] && rVal === "") {
          updates.push(["Not Reported"]);
          backfillNeeded = true;
        } else {
          updates.push([rVal]);
        }
      }
      if (backfillNeeded && updates.length > 0) {
        sheet.getRange(2, physIdx + 1, updates.length, 1).setValues(updates);
      }
    }
  } catch (err) {
    Logger.log("ensurePhysicalReportingColumns error: " + err.message);
  }
}

function updatePhysicalReporting(allotmentId, physicalStatus, reportingDate, verifiedBy, remarks) {
  try {
    ensurePhysicalReportingColumns();
    var sheet = getSheet("ROOM_ALLOTMENTS");
    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return { success: false, message: "No allotment records found." };

    var headerRow = data[0] || [];
    var physCol = -1, repDateCol = -1, verByCol = -1, remCol = -1;
    for (var c = 0; c < headerRow.length; c++) {
      var h = (headerRow[c] || "").toString().trim().toUpperCase().replace(/[\s_-]+/g, "_");
      if (h === "PHYSICAL_STATUS" || h === "REPORTING_STATUS") physCol = c;
      else if (h === "REPORTING_DATE") repDateCol = c;
      else if (h === "REPORTED_VERIFIED_BY" || h === "VERIFIED_BY") verByCol = c;
      else if (h === "REPORTING_REMARKS") remCol = c;
    }

    if (physCol === -1) physCol = 12;
    if (repDateCol === -1) repDateCol = 13;
    if (verByCol === -1) verByCol = 14;
    if (remCol === -1) remCol = 15;

    var cleanAllotId = (allotmentId || "").toString().trim();
    var foundRow = -1;
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] && data[i][0].toString().trim() === cleanAllotId) {
        foundRow = i + 1;
        break;
      }
    }

    if (foundRow === -1) {
      return { success: false, message: "Allotment record not found with ID: " + allotmentId };
    }

    var cleanStatus = (physicalStatus === "Reported" || physicalStatus === "Physically Staying") ? "Reported" : "Not Reported";
    var cleanDate = cleanStatus === "Reported" ? (reportingDate || todayFormatted()) : "";
    var cleanVerBy = cleanStatus === "Reported" ? (verifiedBy || "Warden") : "";
    var cleanRem = (remarks || "").toString().trim();

    sheet.getRange(foundRow, physCol + 1).setValue(cleanStatus);
    sheet.getRange(foundRow, repDateCol + 1).setValue(cleanDate);
    sheet.getRange(foundRow, verByCol + 1).setValue(cleanVerBy);
    sheet.getRange(foundRow, remCol + 1).setValue(cleanRem);

    SpreadsheetApp.flush();
    clearCacheKeys(["CACHE_BOOTSTRAP"]);

    return {
      success: true,
      message: cleanStatus === "Reported" 
        ? "Physical reporting and hostel stay attendance verified successfully."
        : "Physical reporting status reverted to Not Reported."
    };
  } catch (err) {
    Logger.log("updatePhysicalReporting error: " + err.message);
    return { success: false, message: err.message };
  }
}

function getUsers() {
  try {
    ensureUserStatusColumn();
    var sheet = getSheet("USERS");
    var data = sheet.getDataRange().getValues();
    var results = [];
    for (var i = 0; i < data.length; i++) {
      var row = data[i];
      if (!row[0]) continue;
      if (row[0].toString().trim().toUpperCase() === "USER_ID") continue;
      results.push({
        userId:   row[0].toString().trim(),
        name:     (row[1] || "").toString().trim(),
        email:    (row[2] || "").toString().trim(),
        password: (row[3] || "").toString().trim(),
        role:     (row[4] || "").toString().trim(),
        status:   (row[5] || "Active").toString().trim()
      });
    }
    return { success: true, data: results };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function saveUser(userData) {
  try {
    ensureUserStatusColumn();
    var sheet = getSheet("USERS");
    var data = sheet.getDataRange().getValues();
    var userId = (userData.userId || "").toString().trim();
    var email = (userData.email || "").toString().trim().toLowerCase();
    
    if (userId) {
      // Edit mode
      for (var i = 0; i < data.length; i++) {
        if (!data[i][0] || data[i][0].toString().trim().toUpperCase() === "USER_ID") continue;
        if (data[i][0].toString().trim() === userId) {
          var rowNum = i + 1;
          sheet.getRange(rowNum, 2).setValue(userData.name);
          sheet.getRange(rowNum, 3).setValue(userData.email);
          sheet.getRange(rowNum, 4).setValue(userData.password);
          sheet.getRange(rowNum, 5).setValue(userData.role);
          sheet.getRange(rowNum, 6).setValue(userData.status || "Active");
          return { success: true, message: "User updated successfully." };
        }
      }
      return { success: false, message: "User ID not found." };
    } else {
      // Create mode
      // Check if email already exists
      for (var i = 0; i < data.length; i++) {
        if (!data[i][0] || data[i][0].toString().trim().toUpperCase() === "USER_ID") continue;
        if (data[i][2].toString().trim().toLowerCase() === email) {
          return { success: false, message: "A user with this email address already exists." };
        }
      }
      var newUserId = generateId("USR");
      sheet.appendRow([
        newUserId,
        userData.name,
        userData.email,
        userData.password,
        userData.role,
        userData.status || "Active"
      ]);
      return { success: true, message: "User created successfully.", userId: newUserId };
    }
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function deleteUser(userId) {
  try {
    ensureUserStatusColumn();
    var cleanId = (userId || "").toString().trim().toLowerCase();
    if (cleanId === "admin" || cleanId === "admin@amghostel.com") {
      return { success: false, message: "Cannot delete default system administrator account." };
    }
    var sheet = getSheet("USERS");
    var data = sheet.getDataRange().getValues();
    for (var i = 0; i < data.length; i++) {
      if (!data[i][0] || data[i][0].toString().trim().toUpperCase() === "USER_ID") continue;
      var rowUserId = data[i][0].toString().trim().toLowerCase();
      var rowEmail = (data[i][2] || "").toString().trim().toLowerCase();
      if (rowUserId === cleanId || rowEmail === cleanId) {
        sheet.deleteRow(i + 1);
        return { success: true, message: "User account deleted successfully." };
      }
    }
    return { success: false, message: "User account not found." };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function updateUserStatus(userId, status) {
  try {
    ensureUserStatusColumn();
    var sheet = getSheet("USERS");
    var data = sheet.getDataRange().getValues();
    for (var i = 0; i < data.length; i++) {
      if (!data[i][0] || data[i][0].toString().trim().toUpperCase() === "USER_ID") continue;
      if (data[i][0].toString().trim() === userId.toString().trim()) {
        sheet.getRange(i + 1, 6).setValue(status);
        return { success: true, message: "User status updated to " + status + "." };
      }
    }
    return { success: false, message: "User not found." };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function fixExistingBiAnnuallyDates() {
  try {
    var sheet = getSheet("STUDENT_FEE_LEDGER");
    var data = sheet.getDataRange().getValues();
    var count = 0;
    for (var i = 0; i < data.length; i++) {
      if (!data[i][0] || data[i][0].toString().trim().toUpperCase() === "LEDGER_ID") continue;
      
      var applicableMonth = (data[i][7] || "").toString().trim();
      var dueDate = (data[i][11] || "").toString().trim();
      var rowNum = i + 1;
      var updated = false;
      
      if (applicableMonth === "Semester 2 (February 2027)") {
        sheet.getRange(rowNum, 8).setValue("Semester 2 (January 2027)");
        updated = true;
      }
      
      var isFeb5 = false;
      if (dueDate === "05-Feb-2027" || dueDate === "5-Feb-2027") {
        isFeb5 = true;
      } else {
        var dVal = data[i][11];
        if (dVal instanceof Date) {
          if (dVal.getMonth() === 1 && dVal.getDate() === 5 && dVal.getFullYear() === 2027) {
            isFeb5 = true;
          }
        }
      }
      
      if (isFeb5) {
        sheet.getRange(rowNum, 12).setValue("05-Jan-2027");
        updated = true;
      }
      
      if (updated) {
        count++;
      }
    }
    
    var rcptSheet = getSheet("FEE_RECEIPTS");
    var rcptData = rcptSheet.getDataRange().getValues();
    for (var i = 0; i < rcptData.length; i++) {
      if (!rcptData[i][0] || rcptData[i][0].toString().trim().toUpperCase() === "RECEIPT_ID") continue;
      var rcptMonth = (rcptData[i][9] || "").toString().trim();
      if (rcptMonth === "Semester 2 (February 2027)") {
        rcptSheet.getRange(i + 1, 10).setValue("Semester 2 (January 2027)");
      }
    }
    
    if (count > 0) {
      Logger.log("fixExistingBiAnnuallyDates: Updated " + count + " ledger rows.");
    }
  } catch (err) {
    Logger.log("Error in fixExistingBiAnnuallyDates: " + err.message);
  }
}

function fixSpecificReceiptData() {
  try {
    var rcptSheet = getSheet("FEE_RECEIPTS");
    var rcptData = rcptSheet.getDataRange().getValues();
    var rcptRowIdx = -1;
    for (var i = 0; i < rcptData.length; i++) {
      if (rcptData[i][0] && rcptData[i][0].toString().trim() === "RCPT-2026-3068") {
        rcptRowIdx = i;
        break;
      }
    }
    
    if (rcptRowIdx === -1) return; // Receipt not found or not created yet
    
    var currentMonth = (rcptData[rcptRowIdx][9] || "").toString().trim();
    if (currentMonth === "Semester 1") {
      // Already corrected!
      return;
    }
    
    var receiptAmount = parseFloat(rcptData[rcptRowIdx][6]) || 0;
    var wrongLedgerId = (rcptData[rcptRowIdx][14] || "").toString().trim();
    var appId = (rcptData[rcptRowIdx][2] || "").toString().trim();
    
    var ldgSheet = getSheet("STUDENT_FEE_LEDGER");
    var ldgData = ldgSheet.getDataRange().getValues();
    
    var correctLedgerRowIdx = -1;
    var wrongLedgerRowIdx = -1;
    
    for (var j = 0; j < ldgData.length; j++) {
      if (!ldgData[j][0] || ldgData[j][0].toString().trim().toUpperCase() === "LEDGER_ID") continue;
      
      var ldgId = ldgData[j][0].toString().trim();
      var studentAppId = ldgData[j][1].toString().trim();
      var headName = ldgData[j][6].toString().trim();
      var month = ldgData[j][7].toString().trim();
      
      if (ldgId === wrongLedgerId) {
        wrongLedgerRowIdx = j;
      }
      
      if (studentAppId === appId && headName === "MESS CHARGES" && month === "Semester 1") {
        correctLedgerRowIdx = j;
      }
    }
    
    if (correctLedgerRowIdx !== -1) {
      var correctLedgerId = ldgData[correctLedgerRowIdx][0].toString().trim();
      
      // 1. Revert wrong ledger row (Semester 2)
      if (wrongLedgerRowIdx !== -1) {
        var applicable = parseFloat(ldgData[wrongLedgerRowIdx][8]) || 0;
        var currentPaid = parseFloat(ldgData[wrongLedgerRowIdx][9]) || 0;
        var newPaid = Math.max(0, currentPaid - receiptAmount);
        var newBalance = Math.max(0, applicable - newPaid);
        ldgSheet.getRange(wrongLedgerRowIdx + 1, 10).setValue(newPaid);
        ldgSheet.getRange(wrongLedgerRowIdx + 1, 11).setValue(newBalance);
        ldgSheet.getRange(wrongLedgerRowIdx + 1, 13).setValue(newBalance <= 0 ? "Paid" : (newPaid > 0 ? "Partial" : "Pending"));
      }
      
      // 2. Apply payment to correct ledger row (Semester 1)
      var applicableCorrect = parseFloat(ldgData[correctLedgerRowIdx][8]) || 0;
      var currentPaidCorrect = parseFloat(ldgData[correctLedgerRowIdx][9]) || 0;
      var newPaidCorrect = currentPaidCorrect + receiptAmount;
      var newBalanceCorrect = Math.max(0, applicableCorrect - newPaidCorrect);
      ldgSheet.getRange(correctLedgerRowIdx + 1, 10).setValue(newPaidCorrect);
      ldgSheet.getRange(correctLedgerRowIdx + 1, 11).setValue(newBalanceCorrect);
      ldgSheet.getRange(correctLedgerRowIdx + 1, 13).setValue(newBalanceCorrect <= 0 ? "Paid" : (newPaidCorrect > 0 ? "Partial" : "Pending"));
      
      // 3. Update receipt
      rcptSheet.getRange(rcptRowIdx + 1, 10).setValue("Semester 1");
      rcptSheet.getRange(rcptRowIdx + 1, 15).setValue(correctLedgerId);
      
      Logger.log("fixSpecificReceiptData: Corrected receipt RCPT-2026-3068 and ledger rows.");
    }
  } catch (err) {
    Logger.log("Error in fixSpecificReceiptData: " + err.message);
  }
}

// ── 20B. CLEANUP OLD DUPLICATE STUDENT (APP-2026-6272) ────────────
function cleanupDuplicateStudent_APP_2026_6272() {
  try {
    var targetAppId = "APP-2026-6272";
    var targetNameKeyword = "Shreya Prakash Mankekar";
    var keepAppId = "APP-2026-6263";
    var ss = SpreadsheetApp.openById(SHEET_ID);
    
    // 1. ROOM_ALLOTMENTS: check and release bed if allotted
    var allotSheet = ss.getSheetByName("ROOM_ALLOTMENTS");
    if (allotSheet) {
      var allotData = allotSheet.getDataRange().getValues();
      var allotRowsToDelete = [];
      for (var a = allotData.length - 1; a >= 1; a--) {
        var aRow = allotData[a];
        if (!aRow || !aRow[0]) continue;
        var aAppId = (aRow[1] || "").toString().trim();
        var aName = (aRow[2] || "").toString().trim();
        if ((aAppId === targetAppId || aName.toLowerCase() === targetNameKeyword.toLowerCase()) && aAppId !== keepAppId) {
          var roomId = (aRow[3] || "").toString().trim();
          var allotStatus = (aRow[9] || "").toString().trim().toLowerCase();
          
          if (allotStatus === "active" && roomId) {
            var roomsSheet = ss.getSheetByName("ROOMS");
            if (roomsSheet) {
              var roomsData = roomsSheet.getDataRange().getValues();
              for (var rm = 1; rm < roomsData.length; rm++) {
                if (roomsData[rm][0] && roomsData[rm][0].toString().trim() === roomId) {
                  var currentOcc = parseInt(roomsData[rm][5]) || 0;
                  roomsSheet.getRange(rm + 1, 6).setValue(Math.max(0, currentOcc - 1));
                  Logger.log("cleanupDuplicateStudent: Decremented occupied count for Room " + roomId);
                  break;
                }
              }
            }
          }
          allotRowsToDelete.push(a + 1);
        }
      }
      for (var d1 = 0; d1 < allotRowsToDelete.length; d1++) {
        allotSheet.deleteRow(allotRowsToDelete[d1]);
        Logger.log("cleanupDuplicateStudent: Deleted ROOM_ALLOTMENTS row " + allotRowsToDelete[d1]);
      }
    }

    // 2. STUDENT_FEE_LEDGER
    var ldgSheet = ss.getSheetByName("STUDENT_FEE_LEDGER");
    if (ldgSheet) {
      var ldgData = ldgSheet.getDataRange().getValues();
      var ldgRowsToDelete = [];
      for (var l = ldgData.length - 1; l >= 1; l--) {
        var lRow = ldgData[l];
        if (!lRow || !lRow[0]) continue;
        var lAppId = (lRow[1] || "").toString().trim();
        var lName = (lRow[2] || "").toString().trim();
        if ((lAppId === targetAppId || lName.toLowerCase() === targetNameKeyword.toLowerCase()) && lAppId !== keepAppId) {
          ldgRowsToDelete.push(l + 1);
        }
      }
      for (var d2 = 0; d2 < ldgRowsToDelete.length; d2++) {
        ldgSheet.deleteRow(ldgRowsToDelete[d2]);
        Logger.log("cleanupDuplicateStudent: Deleted STUDENT_FEE_LEDGER row " + ldgRowsToDelete[d2]);
      }
    }

    // 3. FEE_RECEIPTS
    var rcptSheet = ss.getSheetByName("FEE_RECEIPTS");
    if (rcptSheet) {
      var rcptData = rcptSheet.getDataRange().getValues();
      var rcptRowsToDelete = [];
      for (var rc = rcptData.length - 1; rc >= 1; rc--) {
        var rcRow = rcptData[rc];
        if (!rcRow || !rcRow[0]) continue;
        var rcAppId = (rcRow[2] || "").toString().trim();
        var rcName = (rcRow[3] || "").toString().trim();
        if ((rcAppId === targetAppId || rcName.toLowerCase() === targetNameKeyword.toLowerCase()) && rcAppId !== keepAppId) {
          rcptRowsToDelete.push(rc + 1);
        }
      }
      for (var d3 = 0; d3 < rcptRowsToDelete.length; d3++) {
        rcptSheet.deleteRow(rcptRowsToDelete[d3]);
        Logger.log("cleanupDuplicateStudent: Deleted FEE_RECEIPTS row " + rcptRowsToDelete[d3]);
      }
    }

    // 4. SERVICE_REQUESTS
    var srSheet = ss.getSheetByName("SERVICE_REQUESTS");
    if (srSheet) {
      var srData = srSheet.getDataRange().getValues();
      var srRowsToDelete = [];
      for (var s = srData.length - 1; s >= 1; s--) {
        var sRow = srData[s];
        if (!sRow || !sRow[0]) continue;
        var sAppId = (sRow[1] || "").toString().trim();
        if (sAppId === targetAppId) {
          srRowsToDelete.push(s + 1);
        }
      }
      for (var d4 = 0; d4 < srRowsToDelete.length; d4++) {
        srSheet.deleteRow(srRowsToDelete[d4]);
        Logger.log("cleanupDuplicateStudent: Deleted SERVICE_REQUESTS row " + srRowsToDelete[d4]);
      }
    }

    // 5. USERS sheet
    var userSheet = ss.getSheetByName("USERS");
    if (userSheet) {
      var uData = userSheet.getDataRange().getValues();
      var uRowsToDelete = [];
      for (var u = uData.length - 1; u >= 1; u--) {
        var uRow = uData[u];
        if (!uRow || !uRow[0]) continue;
        var uName = (uRow[1] || "").toString().trim();
        if (uName.toLowerCase() === targetNameKeyword.toLowerCase() && uName.toLowerCase() !== "shreya p mankekar") {
          uRowsToDelete.push(u + 1);
        }
      }
      for (var d5 = 0; d5 < uRowsToDelete.length; d5++) {
        userSheet.deleteRow(uRowsToDelete[d5]);
        Logger.log("cleanupDuplicateStudent: Deleted USERS row " + uRowsToDelete[d5]);
      }
    }

    // 6. STUDENT_APPLICATIONS
    var appSheet = ss.getSheetByName("STUDENT_APPLICATIONS");
    if (appSheet) {
      var appData = appSheet.getDataRange().getValues();
      var appRowsToDelete = [];
      for (var ap = appData.length - 1; ap >= 1; ap--) {
        var apRow = appData[ap];
        if (!apRow || !apRow[0]) continue;
        var apAppId = (apRow[0] || "").toString().trim();
        var apName = (apRow[2] || "").toString().trim();
        if ((apAppId === targetAppId || apName.toLowerCase() === targetNameKeyword.toLowerCase()) && apAppId !== keepAppId) {
          appRowsToDelete.push(ap + 1);
        }
      }
      for (var d6 = 0; d6 < appRowsToDelete.length; d6++) {
        appSheet.deleteRow(appRowsToDelete[d6]);
        Logger.log("cleanupDuplicateStudent: Deleted STUDENT_APPLICATIONS row " + appRowsToDelete[d6] + " for " + targetAppId);
      }
    }

    return { success: true, message: "Cleaned up old duplicate student entry " + targetAppId };
  } catch (err) {
    Logger.log("Error in cleanupDuplicateStudent_APP_2026_6272: " + err.message);
    return { success: false, message: err.message };
  }
}

// ── 20D. CLEANUP & FREEZE DUPLICATE STUDENT (APP-2026-7625 -> APP-2026-8181) ──
function cleanupDuplicateStudent_APP_2026_7625() {
  try {
    var targetAppId = "APP-2026-7625"; // Duplicate to freeze & disable
    var keepAppId = "APP-2026-8181";   // Regular ID to keep
    var targetNameKeyword = "Neha Pradeep Desai";
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var activeYear = getActiveAcademicYear();

    // 1. STUDENT_APPLICATIONS: Ensure keepAppId exists and is Approved; freeze targetAppId
    var appSheet = ss.getSheetByName("STUDENT_APPLICATIONS");
    var targetAppRow = null;
    var keepAppRow = null;
    var targetAppRowIdx = -1;
    var keepAppRowIdx = -1;

    if (appSheet) {
      var appData = appSheet.getDataRange().getValues();
      for (var ap = 1; ap < appData.length; ap++) {
        var row = appData[ap];
        if (!row || !row[0] || row[0].toString().trim().toUpperCase() === "APP_ID") continue;
        var rAppId = row[0].toString().trim();
        if (rAppId === targetAppId) {
          targetAppRow = row;
          targetAppRowIdx = ap + 1;
        } else if (rAppId === keepAppId) {
          keepAppRow = row;
          keepAppRowIdx = ap + 1;
        }
      }

      // If keepAppId does not exist, create it from targetAppRow
      if (!keepAppRow && targetAppRow) {
        var clonedRow = targetAppRow.slice();
        clonedRow[0] = keepAppId; // APP_ID
        clonedRow[19] = "Approved"; // STATUS
        clonedRow[20] = "System Auto-Reconcile"; // REVIEWED_BY
        clonedRow[21] = todayFormatted(); // REVIEW_DATE
        clonedRow[22] = "Regular account (reconciled from " + targetAppId + ")"; // REMARKS
        appSheet.appendRow(clonedRow);
        keepAppRowIdx = appSheet.getLastRow();
        keepAppRow = clonedRow;
        Logger.log("cleanupDuplicateStudent_APP_2026_7625: Created regular application row " + keepAppId);
      } else if (keepAppRow) {
        // Ensure keepAppId is Approved
        if ((keepAppRow[19] || "").toString().trim().toLowerCase() !== "approved") {
          appSheet.getRange(keepAppRowIdx, 20).setValue("Approved");
          appSheet.getRange(keepAppRowIdx, 21).setValue("Admin");
          appSheet.getRange(keepAppRowIdx, 22).setValue(todayFormatted());
        }
        // Fill any missing fields from targetAppRow into keepAppRow
        if (targetAppRow) {
          for (var col = 2; col < 19; col++) {
            var keepVal = (keepAppRow[col] || "").toString().trim();
            var targetVal = (targetAppRow[col] || "").toString().trim();
            if (!keepVal && targetVal) {
              appSheet.getRange(keepAppRowIdx, col + 1).setValue(targetVal);
            }
          }
        }
      }

      // Freeze and disable targetAppId in STUDENT_APPLICATIONS
      if (targetAppRowIdx > 0) {
        appSheet.getRange(targetAppRowIdx, 20).setValue("Disabled (Duplicate)"); // STATUS: Column T
        appSheet.getRange(targetAppRowIdx, 21).setValue("System Admin");         // REVIEWED_BY: Column U
        appSheet.getRange(targetAppRowIdx, 22).setValue(todayFormatted());        // REVIEW_DATE: Column V
        appSheet.getRange(targetAppRowIdx, 23).setValue("DUPLICATE of " + keepAppId + " - FROZEN & DISABLED from all records."); // REMARKS: Column W
        Logger.log("cleanupDuplicateStudent_APP_2026_7625: Disabled and frozen " + targetAppId + " in STUDENT_APPLICATIONS");
      }
    }

    // 2. ROOM_ALLOTMENTS: Migrate or release allotments
    var allotSheet = ss.getSheetByName("ROOM_ALLOTMENTS");
    if (allotSheet) {
      var allotData = allotSheet.getDataRange().getValues();
      var keepHasActiveAllotment = false;
      var targetAllotRowIdx = -1;
      var targetAllotRoomId = "";
      var targetAllotStatus = "";

      for (var a = 1; a < allotData.length; a++) {
        var aRow = allotData[a];
        if (!aRow || !aRow[0] || aRow[0].toString().trim().toUpperCase() === "ALLOTMENT_ID") continue;
        var aAppId = (aRow[1] || "").toString().trim();
        var aSt = (aRow[9] || "").toString().trim().toLowerCase();
        if (aAppId === keepAppId && aSt === "active") {
          keepHasActiveAllotment = true;
        }
        if (aAppId === targetAppId) {
          targetAllotRowIdx = a + 1;
          targetAllotRoomId = (aRow[3] || "").toString().trim();
          targetAllotStatus = aSt;
        }
      }

      if (targetAllotRowIdx > 0) {
        if (!keepHasActiveAllotment && targetAllotStatus === "active") {
          // Reassign the active allotment to keepAppId so Neha keeps her room!
          allotSheet.getRange(targetAllotRowIdx, 2).setValue(keepAppId);
          allotSheet.getRange(targetAllotRowIdx, 3).setValue(targetNameKeyword);
          Logger.log("cleanupDuplicateStudent_APP_2026_7625: Reassigned active allotment to " + keepAppId);
        } else {
          // keepAppId already has an allotment or target allotment is redundant: release bed and delete
          if (targetAllotStatus === "active" && targetAllotRoomId) {
            var roomsSheet = ss.getSheetByName("ROOMS");
            if (roomsSheet) {
              var roomsData = roomsSheet.getDataRange().getValues();
              for (var rm = 1; rm < roomsData.length; rm++) {
                if (roomsData[rm][0] && roomsData[rm][0].toString().trim() === targetAllotRoomId) {
                  var curOcc = parseInt(roomsData[rm][5]) || 0;
                  roomsSheet.getRange(rm + 1, 6).setValue(Math.max(0, curOcc - 1));
                  Logger.log("cleanupDuplicateStudent_APP_2026_7625: Decremented room " + targetAllotRoomId + " occupied count");
                  break;
                }
              }
            }
          }
          allotSheet.deleteRow(targetAllotRowIdx);
          Logger.log("cleanupDuplicateStudent_APP_2026_7625: Deleted duplicate allotment row for " + targetAppId);
        }
      }
    }

    // 3. FEE_RECEIPTS: Reassign any receipts for targetAppId to keepAppId
    var rcptSheet = ss.getSheetByName("FEE_RECEIPTS");
    if (rcptSheet) {
      var rcptData = rcptSheet.getDataRange().getValues();
      for (var rc = 1; rc < rcptData.length; rc++) {
        var rcRow = rcptData[rc];
        if (!rcRow || !rcRow[0] || rcRow[0].toString().trim().toUpperCase() === "RECEIPT_NUMBER") continue;
        var rcAppId = (rcRow[2] || "").toString().trim();
        if (rcAppId === targetAppId) {
          rcptSheet.getRange(rc + 1, 3).setValue(keepAppId);
          rcptSheet.getRange(rc + 1, 4).setValue(targetNameKeyword);
          Logger.log("cleanupDuplicateStudent_APP_2026_7625: Reassigned receipt " + rcRow[0] + " to " + keepAppId);
        }
      }
    }

    // 4. STUDENT_FEE_LEDGER: Reassign paid rows to keepAppId and delete unpaid duplicate dues
    var ldgSheet = ss.getSheetByName("STUDENT_FEE_LEDGER");
    if (ldgSheet) {
      var ldgData = ldgSheet.getDataRange().getValues();
      var keepLedgerHeads = {};
      for (var k = 1; k < ldgData.length; k++) {
        var kRow = ldgData[k];
        if (!kRow || !kRow[0] || kRow[0].toString().trim().toUpperCase() === "LEDGER_ID") continue;
        if ((kRow[1] || "").toString().trim() === keepAppId) {
          var kHead = (kRow[5] || "").toString().trim().toLowerCase() + "_" + (kRow[8] || "").toString().trim().toLowerCase();
          keepLedgerHeads[kHead] = true;
        }
      }

      var ldgRowsToDelete = [];
      for (var l = ldgData.length - 1; l >= 1; l--) {
        var lRow = ldgData[l];
        if (!lRow || !lRow[0] || lRow[0].toString().trim().toUpperCase() === "LEDGER_ID") continue;
        var lAppId = (lRow[1] || "").toString().trim();
        if (lAppId === targetAppId) {
          var lPaid = parseFloat(lRow[10]) || 0;
          var lHead = (lRow[5] || "").toString().trim().toLowerCase() + "_" + (lRow[8] || "").toString().trim().toLowerCase();
          if (lPaid > 0 && !keepLedgerHeads[lHead]) {
            // Has paid amount that keepAppId doesn't have: reassign to keepAppId
            ldgSheet.getRange(l + 1, 2).setValue(keepAppId);
            ldgSheet.getRange(l + 1, 3).setValue(targetNameKeyword);
            Logger.log("cleanupDuplicateStudent_APP_2026_7625: Reassigned ledger entry " + lRow[0] + " to " + keepAppId);
          } else {
            // Duplicate due row or already accounted for: delete
            ldgRowsToDelete.push(l + 1);
          }
        }
      }
      for (var d2 = 0; d2 < ldgRowsToDelete.length; d2++) {
        ldgSheet.deleteRow(ldgRowsToDelete[d2]);
        Logger.log("cleanupDuplicateStudent_APP_2026_7625: Deleted duplicate ledger row " + ldgRowsToDelete[d2]);
      }
    }

    // 5. SERVICE_REQUESTS: Reassign any service requests to keepAppId
    var srSheet = ss.getSheetByName("SERVICE_REQUESTS");
    if (srSheet) {
      var srData = srSheet.getDataRange().getValues();
      for (var s = 1; s < srData.length; s++) {
        var sRow = srData[s];
        if (!sRow || !sRow[0] || sRow[0].toString().trim().toUpperCase() === "REQUEST_ID") continue;
        if ((sRow[1] || "").toString().trim() === targetAppId) {
          srSheet.getRange(s + 1, 2).setValue(keepAppId);
          srSheet.getRange(s + 1, 3).setValue(targetNameKeyword);
          Logger.log("cleanupDuplicateStudent_APP_2026_7625: Reassigned service request to " + keepAppId);
        }
      }
    }

    // 6. USERS: Remove login account for targetAppId, ensure login exists for keepAppId
    var userSheet = ss.getSheetByName("USERS");
    if (userSheet) {
      var uData = userSheet.getDataRange().getValues();
      var uRowsToDelete = [];
      for (var u = uData.length - 1; u >= 1; u--) {
        var uRow = uData[u];
        if (!uRow || !uRow[0] || uRow[0].toString().trim().toUpperCase() === "USER_ID") continue;
        var uName = (uRow[1] || "").toString().trim();
        var uEmail = (uRow[2] || "").toString().trim();
        var uRole = (uRow[4] || "").toString().trim().toLowerCase();
        if (uRole === "student" && (uName === targetAppId || uEmail.indexOf(targetAppId.toLowerCase()) !== -1)) {
          uRowsToDelete.push(u + 1);
        }
      }
      for (var d5 = 0; d5 < uRowsToDelete.length; d5++) {
        userSheet.deleteRow(uRowsToDelete[d5]);
        Logger.log("cleanupDuplicateStudent_APP_2026_7625: Deleted USERS row " + uRowsToDelete[d5]);
      }
    }

    return { success: true, message: "Cleaned up and disabled duplicate student entry " + targetAppId + " (Regular: " + keepAppId + ")" };
  } catch (err) {
    Logger.log("Error in cleanupDuplicateStudent_APP_2026_7625: " + err.message);
    return { success: false, message: err.message };
  }
}

// ── 20E. RECONCILE & ALLOT SAKSHI SUNIL KADAM TO GF-20 ────────────
function reconcileAndAllotSakshiSunilKadam_GF20() {
  try {
    var studentNameKeyword = "Sakshi Sunil Kadam";
    var targetRoomNumber = "GF-20";
    var ss = SpreadsheetApp.openById(SHEET_ID);
    if (!ss) return { success: false, message: "Spreadsheet not found." };

    var appSheet = ss.getSheetByName("STUDENT_APPLICATIONS");
    var allotSheet = ss.getSheetByName("ROOM_ALLOTMENTS");
    var roomsSheet = ss.getSheetByName("ROOMS");
    var ldgSheet = ss.getSheetByName("STUDENT_FEE_LEDGER");
    var rcptSheet = ss.getSheetByName("FEE_RECEIPTS");
    var activeYear = getActiveAcademicYear();

    var sakshiAppId = "";
    var sakshiAppRowIdx = -1;
    var sakshiContact = "8149653775";
    var sakshiRoomType = "Classic Tripple";

    // 1. Find or verify Sakshi Sunil Kadam in STUDENT_APPLICATIONS
    if (appSheet) {
      var appData = appSheet.getDataRange().getValues();
      var activeAppRow = null;
      var duplicateAppRowIdxs = [];

      for (var i = 1; i < appData.length; i++) {
        var row = appData[i];
        if (!row || !row[0] || row[0].toString().trim().toUpperCase() === "APP_ID") continue;
        var rAid = row[0].toString().trim();
        var rName = (row[2] || "").toString().trim().toLowerCase();

        if (rName === studentNameKeyword.toLowerCase() || (rName.indexOf("sakshi") !== -1 && rName.indexOf("kadam") !== -1)) {
          var rContact = (row[6] || "").toString().trim();
          var rCourse = (row[12] || "").toString().trim();
          var rStatus = (row[19] || "").toString().trim();

          // If this is the BAMS 1st Year 8149653775 application or the primary one
          if (!activeAppRow || rContact.indexOf("8149653775") !== -1 || rCourse.toUpperCase().indexOf("BAMS") !== -1) {
            if (activeAppRow) {
              duplicateAppRowIdxs.push(sakshiAppRowIdx);
            }
            activeAppRow = row;
            sakshiAppId = rAid;
            sakshiAppRowIdx = i + 1;
            if (rContact) sakshiContact = rContact;
            if (row[18]) sakshiRoomType = row[18].toString().trim();
          } else {
            duplicateAppRowIdxs.push(i + 1);
          }
        }
      }

      // If Sakshi exists, ensure she is Approved and active
      if (sakshiAppRowIdx > 0) {
        appSheet.getRange(sakshiAppRowIdx, 20).setValue("Approved"); // Col T: STATUS
        appSheet.getRange(sakshiAppRowIdx, 21).setValue("Admin");    // Col U: REVIEWED_BY
        appSheet.getRange(sakshiAppRowIdx, 22).setValue(todayFormatted()); // Col V: REVIEW_DATE
        appSheet.getRange(sakshiAppRowIdx, 23).setValue("Approved - Allotted to Room GF-20"); // Col W: REMARKS
        
        // Ensure academic year column is set to active year
        var headerRow = appData[0] || [];
        var acadYearCol = -1;
        for (var c = 0; c < headerRow.length; c++) {
          var h = (headerRow[c] || "").toString().trim().toUpperCase().replace(/[\s_-]+/g, "_");
          if (h === "ACADEMIC_YEAR" || h === "ACAD_YEAR") {
            acadYearCol = c;
            break;
          }
        }
        if (acadYearCol === -1) acadYearCol = 23;
        if (acadYearCol < activeAppRow.length) {
          appSheet.getRange(sakshiAppRowIdx, acadYearCol + 1).setValue(activeYear);
        }
        Logger.log("reconcileAndAllotSakshiSunilKadam_GF20: Confirmed application row " + sakshiAppRowIdx + " (" + sakshiAppId + ") as Approved");
      } else {
        // Create application row if none found
        sakshiAppId = generateId("APP");
        var newAppRow = [
          sakshiAppId,
          todayFormatted(),
          "Sakshi Sunil Kadam",
          "",
          "",
          "",
          sakshiContact,
          "",
          "",
          "",
          "Sangli",
          "Maharashtra",
          "BAMS",
          "1st Year",
          "AMGOI",
          "",
          "",
          "",
          "Classic Tripple",
          "Approved",
          "System Admin",
          todayFormatted(),
          "Approved - Allotted to Room GF-20"
        ];
        appSheet.appendRow(newAppRow);
        sakshiAppRowIdx = appSheet.getLastRow();
        Logger.log("reconcileAndAllotSakshiSunilKadam_GF20: Created application row for Sakshi Sunil Kadam (" + sakshiAppId + ")");
      }

      // Mark any other duplicate application rows as Cancelled
      for (var d = 0; d < duplicateAppRowIdxs.length; d++) {
        var dupIdx = duplicateAppRowIdxs[d];
        appSheet.getRange(dupIdx, 20).setValue("Cancelled (Duplicate)");
        appSheet.getRange(dupIdx, 23).setValue("Duplicate of " + sakshiAppId + " - merged to Room GF-20");
      }
    }

    // 2. Find Room GF-20 in ROOMS sheet
    var gf20RoomId = "";
    var gf20RoomType = sakshiRoomType || "Classic Tripple";
    var gf20RowIdx = -1;
    var gf20CurOcc = 0;

    if (roomsSheet) {
      var roomsData = roomsSheet.getDataRange().getValues();
      for (var r = 1; r < roomsData.length; r++) {
        var rRow = roomsData[r];
        if (!rRow || !rRow[0]) continue;
        var rNum = (rRow[1] || "").toString().trim().toUpperCase();
        if (rNum === targetRoomNumber || rNum === "GF20" || rNum === "20" || rNum.indexOf("GF-20") !== -1) {
          gf20RoomId = rRow[0].toString().trim();
          if (rRow[3]) gf20RoomType = rRow[3].toString().trim();
          gf20CurOcc = parseInt(rRow[5]) || 0;
          gf20RowIdx = r + 1;
          break;
        }
      }
      // If Room GF-20 not in sheet, create it or use standard ID
      if (!gf20RoomId) {
        gf20RoomId = "RM-GF-20";
        gf20RoomType = "Classic Tripple";
      }
    } else {
      gf20RoomId = "RM-GF-20";
    }

    // 3. Reconcile or Allot in ROOM_ALLOTMENTS
    if (allotSheet) {
      var allotData = allotSheet.getDataRange().getValues();
      var foundActiveAllotment = false;
      var sakshiAllotRows = [];

      for (var a = 1; a < allotData.length; a++) {
        var aRow = allotData[a];
        if (!aRow || !aRow[0] || aRow[0].toString().trim().toUpperCase() === "ALLOTMENT_ID") continue;
        var aAid = (aRow[1] || "").toString().trim();
        var aName = (aRow[2] || "").toString().trim().toLowerCase();

        if (aAid === sakshiAppId || aName === studentNameKeyword.toLowerCase() || (aName.indexOf("sakshi") !== -1 && aName.indexOf("kadam") !== -1)) {
          sakshiAllotRows.push({
            rowIdx: a + 1,
            allotId: aRow[0].toString().trim(),
            roomNum: (aRow[4] || "").toString().trim(),
            status: (aRow[9] || "").toString().trim()
          });
        }
      }

      if (sakshiAllotRows.length > 0) {
        // Use the first row as the active GF-20 allotment
        var primaryAllotIdx = sakshiAllotRows[0].rowIdx;
        allotSheet.getRange(primaryAllotIdx, 2).setValue(sakshiAppId);       // APP_ID
        allotSheet.getRange(primaryAllotIdx, 3).setValue("Sakshi Sunil Kadam"); // STUDENT_NAME
        allotSheet.getRange(primaryAllotIdx, 4).setValue(gf20RoomId);         // ROOM_ID
        allotSheet.getRange(primaryAllotIdx, 5).setValue(targetRoomNumber);   // ROOM_NUMBER: GF-20
        allotSheet.getRange(primaryAllotIdx, 6).setValue(gf20RoomType);       // ROOM_TYPE
        allotSheet.getRange(primaryAllotIdx, 9).setValue("");                 // ACTUAL_VACATING_DATE (clear)
        allotSheet.getRange(primaryAllotIdx, 10).setValue("Active");          // STATUS: Active
        allotSheet.getRange(primaryAllotIdx, 11).setValue("Admin");           // ALLOTTED_BY
        allotSheet.getRange(primaryAllotIdx, 12).setValue(activeYear);        // ACADEMIC_YEAR
        foundActiveAllotment = true;
        Logger.log("reconcileAndAllotSakshiSunilKadam_GF20: Updated allotment row " + primaryAllotIdx + " to Room GF-20 (Active)");

        // Mark any extra duplicate allotment rows as Cancelled
        for (var ex = 1; ex < sakshiAllotRows.length; ex++) {
          allotSheet.getRange(sakshiAllotRows[ex].rowIdx, 9).setValue(todayFormatted());
          allotSheet.getRange(sakshiAllotRows[ex].rowIdx, 10).setValue("Cancelled (Duplicate)");
        }
      } else {
        // Create new active allotment row for GF-20
        var newAllotId = generateId("ALLOT");
        allotSheet.appendRow([
          newAllotId,
          sakshiAppId,
          "Sakshi Sunil Kadam",
          gf20RoomId,
          targetRoomNumber,
          gf20RoomType,
          todayFormatted(),
          "",
          "",
          "Active",
          "Admin",
          activeYear
        ]);
        foundActiveAllotment = true;
        Logger.log("reconcileAndAllotSakshiSunilKadam_GF20: Created new active allotment for Sakshi in GF-20 (" + newAllotId + ")");
      }

      // Update room bed occupancy in ROOMS
      if (roomsSheet) {
        // Re-read allotData to count active occupants in GF-20 and GF-13 accurately
        var updatedAllotData = allotSheet.getDataRange().getValues();
        var gf20ActiveCount = 0;
        var gf13ActiveCount = 0;
        for (var k = 1; k < updatedAllotData.length; k++) {
          var kRow = updatedAllotData[k];
          if (!kRow || !kRow[0]) continue;
          var kStatus = (kRow[9] || "").toString().trim().toLowerCase();
          var kRoom = (kRow[4] || "").toString().trim().toUpperCase();
          if (kStatus === "active") {
            if (kRoom === "GF-20" || kRoom === "GF20" || kRoom === "20") gf20ActiveCount++;
            if (kRoom === "GF-13" || kRoom === "GF13" || kRoom === "13") gf13ActiveCount++;
          }
        }

        var rData2 = roomsSheet.getDataRange().getValues();
        for (var rm = 1; rm < rData2.length; rm++) {
          var rmNum2 = (rData2[rm][1] || "").toString().trim().toUpperCase();
          if (rmNum2 === "GF-20" || rmNum2 === "GF20" || rmNum2 === "20") {
            roomsSheet.getRange(rm + 1, 6).setValue(gf20ActiveCount);
          }
          if (rmNum2 === "GF-13" || rmNum2 === "GF13" || rmNum2 === "13") {
            roomsSheet.getRange(rm + 1, 6).setValue(gf13ActiveCount);
          }
        }
      }
    }

    // 4. Link FEE_RECEIPTS for Sakshi Sunil Kadam to sakshiAppId
    if (rcptSheet) {
      var rcptData = rcptSheet.getDataRange().getValues();
      for (var rc = 1; rc < rcptData.length; rc++) {
        var rcRow = rcptData[rc];
        if (!rcRow || !rcRow[0]) continue;
        var rcName = (rcRow[3] || "").toString().trim().toLowerCase();
        var rcAid = (rcRow[2] || "").toString().trim();
        if (rcName.indexOf("sakshi") !== -1 && rcName.indexOf("kadam") !== -1) {
          if (rcAid !== sakshiAppId) {
            rcptSheet.getRange(rc + 1, 3).setValue(sakshiAppId);
            Logger.log("reconcileAndAllotSakshiSunilKadam_GF20: Synced receipt " + rcRow[0] + " App ID to " + sakshiAppId);
          }
        }
      }
    }

    // 5. STUDENT_FEE_LEDGER: Update Room Number to GF-20 and ensure appId is synced
    if (ldgSheet) {
      var ldgData = ldgSheet.getDataRange().getValues();
      var hasLedger = false;
      for (var l = 1; l < ldgData.length; l++) {
        var lRow = ldgData[l];
        if (!lRow || !lRow[0]) continue;
        var lName = (lRow[2] || "").toString().trim().toLowerCase();
        var lAid = (lRow[1] || "").toString().trim();
        if (lAid === sakshiAppId || (lName.indexOf("sakshi") !== -1 && lName.indexOf("kadam") !== -1)) {
          hasLedger = true;
          if (lAid !== sakshiAppId) ldgSheet.getRange(l + 1, 2).setValue(sakshiAppId);
          // Update room number to GF-20
          var curLdgRoom = (lRow[4] || "").toString().trim().toUpperCase();
          if (curLdgRoom !== targetRoomNumber) {
            ldgSheet.getRange(l + 1, 5).setValue(targetRoomNumber);
          }
        }
      }

      // If no ledger rows exist for Sakshi, apply fee structure for GF-20
      if (!hasLedger && sakshiAppId) {
        try {
          applyFeeStructureOnAllotment(sakshiAppId, "Sakshi Sunil Kadam", targetRoomNumber, gf20RoomType, todayFormatted(), true);
          Logger.log("reconcileAndAllotSakshiSunilKadam_GF20: Applied fee structure for Sakshi in GF-20");
        } catch (fErr) {
          Logger.log("reconcileAndAllotSakshiSunilKadam_GF20 fee structure error: " + fErr.message);
        }
      }
    }

    return {
      success: true,
      message: "Successfully reconciled Sakshi Sunil Kadam and allotted to Room GF-20",
      appId: sakshiAppId,
      roomNumber: targetRoomNumber
    };
  } catch (err) {
    Logger.log("Error in reconcileAndAllotSakshiSunilKadam_GF20: " + err.message);
    return { success: false, message: err.message };
  }
}

// ══════════════════════════════════════════════════════════════
// ── STUDENT ENTRY ROLLBACK & DATA CLEANUP ENGINE ──────────────
// ══════════════════════════════════════════════════════════════

function ensureRollbackAuditLogsSheet() {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName("ROLLBACK_AUDIT_LOGS");
    if (!sheet) {
      sheet = ss.insertSheet("ROLLBACK_AUDIT_LOGS");
      var headers = [
        "LOG_ID",            // 0
        "TIMESTAMP",         // 1
        "ROLLED_BACK_BY",    // 2
        "REASON",            // 3
        "APP_ID",            // 4
        "STUDENT_NAME",      // 5
        "ROOM_RELEASED",     // 6
        "RECEIPTS_HANDLED",  // 7
        "LEDGER_PURGED",     // 8
        "SNAPSHOT_JSON"      // 9
      ];
      sheet.appendRow(headers);
      var headerRange = sheet.getRange(1, 1, 1, headers.length);
      headerRange.setFontWeight("bold");
      headerRange.setBackground("#1E293B");
      headerRange.setFontColor("#FFFFFF");
      sheet.setFrozenRows(1);
    }
  } catch (err) {
    Logger.log("Error in ensureRollbackAuditLogsSheet: " + err.message);
  }
}

function searchStudentForRollback(query) {
  try {
    if (!query) return { success: true, data: [] };
    query = query.toString().trim().toLowerCase();
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var results = [];
    var seenAppIds = {};

    // 1. Search STUDENT_APPLICATIONS
    var appSheet = ss.getSheetByName("STUDENT_APPLICATIONS");
    if (appSheet) {
      var appData = appSheet.getDataRange().getValues();
      for (var i = 1; i < appData.length; i++) {
        var row = appData[i];
        if (!row[0] || row[0].toString().trim().toUpperCase() === "APP_ID") continue;
        var aId = (row[0] || "").toString().trim();
        var sName = (row[2] || "").toString().trim();
        var sPhone = (row[6] || "").toString().trim();
        var sEmail = (row[8] || "").toString().trim();
        var sCourse = (row[12] || "").toString().trim();
        var sYear = (row[13] || "").toString().trim();
        var sStatus = (row[19] || "Pending").toString().trim();

        if (
          aId.toLowerCase().indexOf(query) !== -1 ||
          sName.toLowerCase().indexOf(query) !== -1 ||
          sPhone.indexOf(query) !== -1 ||
          sEmail.toLowerCase().indexOf(query) !== -1
        ) {
          seenAppIds[aId] = true;
          results.push({
            appId: aId,
            studentName: sName,
            phone: sPhone,
            email: sEmail,
            course: sCourse + (sYear ? " (" + sYear + ")" : ""),
            status: sStatus,
            source: "Application"
          });
        }
      }
    }

    // 2. Search FEE_RECEIPTS for matching receipt ID or student
    var rcptSheet = ss.getSheetByName("FEE_RECEIPTS");
    if (rcptSheet) {
      var rcptData = rcptSheet.getDataRange().getValues();
      for (var r = 1; r < rcptData.length; r++) {
        var rRow = rcptData[r];
        if (!rRow[0] || rRow[0].toString().trim().toUpperCase() === "RECEIPT_ID") continue;
        var rNo = (rRow[0] || "").toString().trim();
        var rAppId = (rRow[2] || "").toString().trim();
        var rName = (rRow[3] || "").toString().trim();
        if (rAppId && !seenAppIds[rAppId]) {
          if (
            rNo.toLowerCase().indexOf(query) !== -1 ||
            rName.toLowerCase().indexOf(query) !== -1 ||
            rAppId.toLowerCase().indexOf(query) !== -1
          ) {
            seenAppIds[rAppId] = true;
            results.push({
              appId: rAppId,
              studentName: rName,
              phone: "",
              email: "",
              course: "Found in Fee Receipt " + rNo,
              status: "Receipt Record",
              source: "Receipt"
            });
          }
        }
      }
    }

    // 3. Search ROOM_ALLOTMENTS for matching student
    var allotSheet = ss.getSheetByName("ROOM_ALLOTMENTS");
    if (allotSheet) {
      var allotData = allotSheet.getDataRange().getValues();
      for (var a = 1; a < allotData.length; a++) {
        var aRow = allotData[a];
        if (!aRow[0] || aRow[0].toString().trim().toUpperCase() === "ALLOTMENT_ID") continue;
        var alAppId = (aRow[1] || "").toString().trim();
        var alName = (aRow[2] || "").toString().trim();
        var alRoom = (aRow[4] || "").toString().trim();
        if (alAppId && !seenAppIds[alAppId]) {
          if (
            alName.toLowerCase().indexOf(query) !== -1 ||
            alAppId.toLowerCase().indexOf(query) !== -1 ||
            alRoom.toLowerCase().indexOf(query) !== -1
          ) {
            seenAppIds[alAppId] = true;
            results.push({
              appId: alAppId,
              studentName: alName,
              phone: "",
              email: "",
              course: "Room " + alRoom,
              status: "Allotment Record",
              source: "Allotment"
            });
          }
        }
      }
    }

    return { success: true, data: results.slice(0, 15) };
  } catch (err) {
    return { success: false, message: "Search error: " + err.message };
  }
}

function previewStudentRollback(appId) {
  try {
    if (!appId) return { success: false, message: "Application ID is required." };
    appId = appId.toString().trim();
    var ss = SpreadsheetApp.openById(SHEET_ID);

    // 1. Check Application
    var appSheet = ss.getSheetByName("STUDENT_APPLICATIONS");
    var student = null;
    var allOtherStudents = [];
    if (appSheet) {
      var appData = appSheet.getDataRange().getValues();
      for (var i = 1; i < appData.length; i++) {
        var row = appData[i];
        if (!row[0] || row[0].toString().trim().toUpperCase() === "APP_ID") continue;
        var curId = row[0].toString().trim();
        var curName = (row[2] || "").toString().trim();
        var curPhone = (row[6] || "").toString().trim();
        var curEmail = (row[8] || "").toString().trim();
        var curCourse = (row[12] || "").toString().trim();
        var curYear = (row[13] || "").toString().trim();
        var curStatus = (row[19] || "Pending").toString().trim();

        if (curId === appId) {
          student = {
            appId: curId,
            studentName: curName,
            fatherName: (row[3] || "").toString().trim(),
            dateOfBirth: formatDateValue(row[5]),
            phone: curPhone,
            parentContact: (row[7] || "").toString().trim(),
            email: curEmail,
            course: curCourse,
            yearOfStudy: curYear,
            collegeName: (row[14] || "").toString().trim(),
            roomTypePref: (row[18] || "").toString().trim(),
            status: curStatus,
            submissionDate: formatDateValue(row[1])
          };
        } else {
          allOtherStudents.push({
            appId: curId,
            studentName: curName,
            phone: curPhone,
            course: curCourse + (curYear ? " (" + curYear + ")" : ""),
            status: curStatus
          });
        }
      }
    }

    // If not found in applications, build fallback profile from other records
    if (!student) {
      student = {
        appId: appId,
        studentName: "Unregistered / Corrupted Record (" + appId + ")",
        phone: "",
        email: "",
        course: "Unknown",
        status: "Orphaned"
      };
    }

    // 2. Room Allotments & Room details
    var allotSheet = ss.getSheetByName("ROOM_ALLOTMENTS");
    var roomsSheet = ss.getSheetByName("ROOMS");
    var roomsMap = {};
    if (roomsSheet) {
      var rData = roomsSheet.getDataRange().getValues();
      for (var r = 1; r < rData.length; r++) {
        if (!rData[r][0]) continue;
        var rId = rData[r][0].toString().trim();
        var rNum = (rData[r][1] || "").toString().trim();
        var rFloor = (rData[r][2] || "").toString().trim();
        var rType = (rData[r][3] || "").toString().trim();
        var rCap = parseInt(rData[r][4]) || 0;
        var rOcc = parseInt(rData[r][5]) || 0;
        roomsMap[rId] = { roomId: rId, roomNumber: rNum, floor: rFloor, roomType: rType, capacity: rCap, occupied: rOcc };
        if (rNum) roomsMap[rNum] = roomsMap[rId];
      }
    }

    var allotments = [];
    var roomsToRelease = [];
    if (allotSheet) {
      var allotData = allotSheet.getDataRange().getValues();
      for (var a = 1; a < allotData.length; a++) {
        var aRow = allotData[a];
        if (!aRow[0] || aRow[0].toString().trim().toUpperCase() === "ALLOTMENT_ID") continue;
        if (aRow[1] && aRow[1].toString().trim() === appId) {
          var aStatus = (aRow[9] || "Active").toString().trim();
          var aRoomId = (aRow[3] || "").toString().trim();
          var aRoomNum = (aRow[4] || "").toString().trim();
          var roomMeta = roomsMap[aRoomId] || roomsMap[aRoomNum] || null;

          var allotItem = {
            allotmentId: aRow[0].toString().trim(),
            appId: appId,
            studentName: (aRow[2] || "").toString().trim(),
            roomId: aRoomId,
            roomNumber: aRoomNum,
            roomType: (aRow[5] || "").toString().trim(),
            allotmentDate: formatDateValue(aRow[6]),
            status: aStatus,
            academicYear: (aRow[11] || "").toString().trim(),
            roomMeta: roomMeta
          };
          allotments.push(allotItem);

          if (aStatus.toLowerCase() === "active") {
            roomsToRelease.push({
              roomNumber: aRoomNum,
              roomId: aRoomId,
              currentOccupied: roomMeta ? roomMeta.occupied : 1,
              newOccupied: roomMeta ? Math.max(0, roomMeta.occupied - 1) : 0,
              capacity: roomMeta ? roomMeta.capacity : 0
            });
          }
        }
      }
    }

    // 3. Fee Ledger
    var ldgSheet = ss.getSheetByName("STUDENT_FEE_LEDGER");
    var ledgerItems = [];
    var totalDemanded = 0;
    var totalPaid = 0;
    var totalBalance = 0;
    if (ldgSheet) {
      var ldgData = ldgSheet.getDataRange().getValues();
      for (var l = 1; l < ldgData.length; l++) {
        var lRow = ldgData[l];
        if (!lRow[0] || lRow[0].toString().trim().toUpperCase() === "LEDGER_ID") continue;
        if (lRow[1] && lRow[1].toString().trim() === appId) {
          var appAmt = parseFloat(lRow[8]) || 0;
          var pAmt = parseFloat(lRow[9]) || 0;
          var balAmt = parseFloat(lRow[10]) || 0;
          totalDemanded += appAmt;
          totalPaid += pAmt;
          totalBalance += balAmt;
          ledgerItems.push({
            ledgerId: lRow[0].toString().trim(),
            headName: (lRow[6] || "").toString().trim(),
            period: (lRow[7] || "").toString().trim(),
            applicable: appAmt,
            paid: pAmt,
            balance: balAmt,
            status: (lRow[12] || "Pending").toString().trim()
          });
        }
      }
    }

    // 4. Fee Receipts
    var rcptSheet = ss.getSheetByName("FEE_RECEIPTS");
    var receipts = [];
    var totalReceiptsAmount = 0;
    if (rcptSheet) {
      var rcptData = rcptSheet.getDataRange().getValues();
      for (var r = 1; r < rcptData.length; r++) {
        var rRow = rcptData[r];
        if (!rRow[0] || rRow[0].toString().trim().toUpperCase() === "RECEIPT_ID") continue;
        if (rRow[2] && rRow[2].toString().trim() === appId) {
          var amt = parseFloat(rRow[6]) || 0;
          var rStatus = (rRow[13] || "Active").toString().trim();
          if (rStatus.toLowerCase() !== "cancelled") {
            totalReceiptsAmount += amt;
          }
          receipts.push({
            receiptId: rRow[0].toString().trim(),
            date: formatDateValue(rRow[1]),
            studentName: (rRow[3] || "").toString().trim(),
            roomNumber: (rRow[4] || "").toString().trim(),
            feeType: (rRow[5] || "").toString().trim(),
            amountPaid: amt,
            paymentMode: (rRow[7] || "").toString().trim(),
            transactionId: (rRow[8] || "").toString().trim(),
            status: rStatus,
            remarks: (rRow[12] || "").toString().trim()
          });
        }
      }
    }

    // 5. User Accounts
    var userSheet = ss.getSheetByName("USERS");
    var userAccountsCount = 0;
    if (userSheet) {
      var uData = userSheet.getDataRange().getValues();
      var cleanEmail = (student.email || "").toString().trim().toLowerCase();
      for (var u = 1; u < uData.length; u++) {
        var uRow = uData[u];
        if (!uRow[0] || uRow[0].toString().trim().toUpperCase() === "USER_ID") continue;
        var uEmail = (uRow[2] || "").toString().trim().toLowerCase();
        if ((cleanEmail && uEmail === cleanEmail) || (uRow[0] && uRow[0].toString().trim() === appId)) {
          userAccountsCount++;
        }
      }
    }

    // 6. Service Requests
    var srSheet = ss.getSheetByName("SERVICE_REQUESTS");
    var serviceRequestsCount = 0;
    if (srSheet) {
      var srData = srSheet.getDataRange().getValues();
      for (var s = 1; s < srData.length; s++) {
        var sRow = srData[s];
        if (!sRow[0] || sRow[0].toString().trim().toUpperCase() === "REQUEST_ID") continue;
        if (sRow[1] && sRow[1].toString().trim() === appId) {
          serviceRequestsCount++;
        }
      }
    }

    // 7. Find candidate target students for receipt transfer
    var candidateTargets = [];
    var normName = (student.studentName || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    var normPhone = (student.phone || "").replace(/[^0-9]/g, "");

    for (var c = 0; c < allOtherStudents.length; c++) {
      var cand = allOtherStudents[c];
      var cNormName = cand.studentName.toLowerCase().replace(/[^a-z0-9]/g, "");
      var cNormPhone = (cand.phone || "").replace(/[^0-9]/g, "");
      var isSuggested = false;

      if (normName.length >= 3 && cNormName.length >= 3) {
        if (normName === cNormName || normName.indexOf(cNormName) !== -1 || cNormName.indexOf(normName) !== -1) {
          isSuggested = true;
        }
      }
      if (normPhone && cNormPhone && normPhone.length >= 8 && normPhone === cNormPhone) {
        isSuggested = true;
      }

      if (isSuggested) {
        candidateTargets.unshift(cand); // prioritized at top
      } else if (candidateTargets.length < 25) {
        candidateTargets.push(cand);
      }
    }

    return {
      success: true,
      student: student,
      allotments: allotments,
      roomsToRelease: roomsToRelease,
      ledgerSummary: {
        count: ledgerItems.length,
        totalDemanded: Math.round(totalDemanded * 100) / 100,
        totalPaid: Math.round(totalPaid * 100) / 100,
        totalBalance: Math.round(totalBalance * 100) / 100,
        items: ledgerItems
      },
      receiptsSummary: {
        count: receipts.length,
        totalAmount: Math.round(totalReceiptsAmount * 100) / 100,
        items: receipts
      },
      userAccountsCount: userAccountsCount,
      serviceRequestsCount: serviceRequestsCount,
      candidateTargets: candidateTargets
    };
  } catch (err) {
    return { success: false, message: "Error generating rollback preview: " + err.message };
  }
}

function executeStudentRollback(payload) {
  if (!payload || !payload.appId) {
    return { success: false, message: "Application ID is required for rollback." };
  }
  var appId = payload.appId.toString().trim();
  var reason = (payload.reason || "").toString().trim();
  if (reason.length < 3) {
    return { success: false, message: "A valid rollback reason is required (at least 3 characters)." };
  }

  var transferReceipts = !!payload.transferReceipts;
  var targetAppId = (payload.targetAppId || "").toString().trim();
  if (transferReceipts) {
    if (!targetAppId || targetAppId === appId) {
      return { success: false, message: "Valid surviving target Application ID is required for receipt transfer." };
    }
  }

  var lock = LockService.getScriptLock();
  var lockAcquired = false;
  try {
    lockAcquired = lock.tryLock(30000);
  } catch (lErr) {
    Logger.log("Lock acquisition warning: " + lErr.message);
  }

  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    ensureRollbackAuditLogsSheet();

    // 1. Load preview data for snapshot & validation
    var preview = previewStudentRollback(appId);
    if (!preview.success) {
      return { success: false, message: preview.message };
    }

    var studentName = preview.student ? preview.student.studentName : appId;
    var adminUser = payload.adminUser || (Session.getActiveUser() ? Session.getActiveUser().getEmail() : "") || "Administrator";

    // Verify target student exists if transferring
    var targetStudentName = "";
    if (transferReceipts) {
      var appSheet = ss.getSheetByName("STUDENT_APPLICATIONS");
      if (appSheet) {
        var appData = appSheet.getDataRange().getValues();
        for (var t = 1; t < appData.length; t++) {
          if (appData[t][0] && appData[t][0].toString().trim() === targetAppId) {
            targetStudentName = (appData[t][2] || "").toString().trim();
            break;
          }
        }
      }
      if (!targetStudentName) {
        return { success: false, message: "Target Application ID (" + targetAppId + ") was not found in the system." };
      }
    }

    // 2. Release Room Inventory (OCCUPIED count in ROOMS)
    var roomsReleasedList = [];
    var roomsSheet = ss.getSheetByName("ROOMS");
    var allotSheet = ss.getSheetByName("ROOM_ALLOTMENTS");
    if (allotSheet && roomsSheet) {
      var allotData = allotSheet.getDataRange().getValues();
      var roomsData = roomsSheet.getDataRange().getValues();

      for (var a = 1; a < allotData.length; a++) {
        if (allotData[a][1] && allotData[a][1].toString().trim() === appId) {
          var aStatus = (allotData[a][9] || "").toString().trim().toLowerCase();
          var aRoomId = (allotData[a][3] || "").toString().trim();
          var aRoomNum = (allotData[a][4] || "").toString().trim();

          if (aStatus === "active") {
            for (var rm = 1; rm < roomsData.length; rm++) {
              var curRmId = (roomsData[rm][0] || "").toString().trim();
              var curRmNum = (roomsData[rm][1] || "").toString().trim();
              if ((aRoomId && curRmId === aRoomId) || (aRoomNum && curRmNum === aRoomNum)) {
                var curOcc = parseInt(roomsData[rm][5]) || 0;
                var newOcc = Math.max(0, curOcc - 1);
                roomsSheet.getRange(rm + 1, 6).setValue(newOcc);
                roomsData[rm][5] = newOcc; // keep local cache updated
                roomsReleasedList.push(curRmNum || curRmId);
                break;
              }
            }
          }
        }
      }

      // Delete allotment rows for this appId
      for (var da = allotData.length - 1; da >= 1; da--) {
        if (allotData[da][1] && allotData[da][1].toString().trim() === appId) {
          allotSheet.deleteRow(da + 1);
        }
      }
    }

    // 3. Fee Receipts Handling: Transfer or Purge
    var rcptSheet = ss.getSheetByName("FEE_RECEIPTS");
    var receiptsHandledSummary = "None";
    var receiptsCount = 0;
    if (rcptSheet) {
      var rcptData = rcptSheet.getDataRange().getValues();
      if (transferReceipts) {
        for (var r = 1; r < rcptData.length; r++) {
          if (rcptData[r][2] && rcptData[r][2].toString().trim() === appId) {
            receiptsCount++;
            var curRemarks = (rcptData[r][12] || "").toString().trim();
            var newRemarks = (curRemarks ? curRemarks + " | " : "") +
              "Transferred from " + appId + " (" + studentName + ") on " + todayFormatted() + " - Reason: " + reason;
            rcptSheet.getRange(r + 1, 3).setValue(targetAppId);
            if (targetStudentName) rcptSheet.getRange(r + 1, 4).setValue(targetStudentName);
            rcptSheet.getRange(r + 1, 13).setValue(newRemarks);
          }
        }
        receiptsHandledSummary = receiptsCount + " receipt(s) transferred to " + targetAppId + " (" + targetStudentName + ")";
      } else {
        // Purge receipts
        for (var dr = rcptData.length - 1; dr >= 1; dr--) {
          if (rcptData[dr][2] && rcptData[dr][2].toString().trim() === appId) {
            receiptsCount++;
            rcptSheet.deleteRow(dr + 1);
          }
        }
        receiptsHandledSummary = receiptsCount + " receipt(s) permanently purged";
      }
    }

    // 4. Delete STUDENT_FEE_LEDGER rows
    var ldgSheet = ss.getSheetByName("STUDENT_FEE_LEDGER");
    var ledgerPurgedCount = 0;
    if (ldgSheet) {
      var ldgData = ldgSheet.getDataRange().getValues();
      for (var dl = ldgData.length - 1; dl >= 1; dl--) {
        if (ldgData[dl][1] && ldgData[dl][1].toString().trim() === appId) {
          ledgerPurgedCount++;
          ldgSheet.deleteRow(dl + 1);
        }
      }
    }

    // 5. Delete USERS accounts matching appId or student email
    var userSheet = ss.getSheetByName("USERS");
    var usersPurgedCount = 0;
    if (userSheet) {
      var uData = userSheet.getDataRange().getValues();
      var cleanEmail = (preview.student && preview.student.email) ? preview.student.email.toString().trim().toLowerCase() : "";
      for (var du = uData.length - 1; du >= 1; du--) {
        var uRow = uData[du];
        var uEmail = (uRow[2] || "").toString().trim().toLowerCase();
        var uId = (uRow[0] || "").toString().trim();
        if ((cleanEmail && uEmail === cleanEmail) || uId === appId) {
          usersPurgedCount++;
          userSheet.deleteRow(du + 1);
        }
      }
    }

    // 6. Delete SERVICE_REQUESTS
    var srSheet = ss.getSheetByName("SERVICE_REQUESTS");
    var srPurgedCount = 0;
    if (srSheet) {
      var srData = srSheet.getDataRange().getValues();
      for (var ds = srData.length - 1; ds >= 1; ds--) {
        if (srData[ds][1] && srData[ds][1].toString().trim() === appId) {
          srPurgedCount++;
          srSheet.deleteRow(ds + 1);
        }
      }
    }

    // 7. Delete STUDENT_APPLICATIONS row
    var appSheetDel = ss.getSheetByName("STUDENT_APPLICATIONS");
    var appDeleted = false;
    if (appSheetDel) {
      var aData = appSheetDel.getDataRange().getValues();
      for (var dap = aData.length - 1; dap >= 1; dap--) {
        if (aData[dap][0] && aData[dap][0].toString().trim() === appId) {
          appSheetDel.deleteRow(dap + 1);
          appDeleted = true;
          break;
        }
      }
    }

    // 8. Log into ROLLBACK_AUDIT_LOGS
    var auditSheet = ss.getSheetByName("ROLLBACK_AUDIT_LOGS");
    var logId = "RBL-" + Utilities.formatDate(new Date(), Session.getScriptTimeZone() || "GMT+5:30", "yyyyMMdd-HHmmss");
    var roomReleasedStr = roomsReleasedList.length > 0
      ? roomsReleasedList.join(", ") + " (bed occupancy decremented)"
      : "None";
    var ledgerPurgedStr = ledgerPurgedCount + " demand row(s) purged";

    if (auditSheet) {
      auditSheet.appendRow([
        logId,
        Utilities.formatDate(new Date(), Session.getScriptTimeZone() || "GMT+5:30", "yyyy-MM-dd HH:mm:ss"),
        adminUser,
        reason,
        appId,
        studentName,
        roomReleasedStr,
        receiptsHandledSummary,
        ledgerPurgedStr,
        JSON.stringify(preview)
      ]);
    }

    SpreadsheetApp.flush();

    return {
      success: true,
      message: "Student record " + appId + " (" + studentName + ") successfully rolled back and purged.",
      auditId: logId,
      details: {
        appId: appId,
        studentName: studentName,
        roomsReleased: roomReleasedStr,
        receiptsSummary: receiptsHandledSummary,
        ledgerPurged: ledgerPurgedStr,
        usersPurged: usersPurgedCount,
        serviceRequestsPurged: srPurgedCount
      }
    };
  } catch (err) {
    Logger.log("Error in executeStudentRollback: " + err.message);
    return { success: false, message: "Rollback execution failed: " + err.message };
  } finally {
    if (lockAcquired) {
      try { lock.releaseLock(); } catch (e) {}
    }
  }
}

function getRollbackAuditLogs(limit) {
  try {
    ensureRollbackAuditLogsSheet();
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName("ROLLBACK_AUDIT_LOGS");
    if (!sheet) return { success: true, data: [] };
    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return { success: true, data: [] };

    var results = [];
    var maxLogs = limit || 20;
    for (var i = data.length - 1; i >= 1 && results.length < maxLogs; i--) {
      var row = data[i];
      if (!row[0]) continue;
      results.push({
        logId: (row[0] || "").toString().trim(),
        timestamp: formatDateValue(row[1]),
        adminUser: (row[2] || "").toString().trim(),
        reason: (row[3] || "").toString().trim(),
        appId: (row[4] || "").toString().trim(),
        studentName: (row[5] || "").toString().trim(),
        roomReleased: (row[6] || "").toString().trim(),
        receiptsHandled: (row[7] || "").toString().trim(),
        ledgerPurged: (row[8] || "").toString().trim()
      });
    }
    return { success: true, data: results };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function deleteStudentApplication(appId) {
  return executeStudentRollback({
    appId: appId,
    reason: "Direct admin deletion request",
    transferReceipts: false
  });
}

function validatePaymentSequence(appId, payingMap) {
  try {
    var ldgSheet = getSheet("STUDENT_FEE_LEDGER");
    var ldgData = ldgSheet.getDataRange().getValues();
    
    // Load head priorities
    var headsSheet = getSheet("FEE_STRUCTURE_HEADS");
    var headsData = headsSheet.getDataRange().getValues();
    var headPriorities = {};
    for (var i = 0; i < headsData.length; i++) {
      if (!headsData[i][0] || headsData[i][0].toString().trim().toUpperCase() === "HEAD_ID") continue;
      var hId = headsData[i][0].toString().trim();
      var priority = parseInt(headsData[i][6]) || 99;
      headPriorities[hId] = priority;
    }
    
    // Find all ledger entries for this student with balance > 0 OR being paid in this transaction
    var studentEntries = [];
    for (var j = 0; j < ldgData.length; j++) {
      if (!ldgData[j][0] || ldgData[j][0].toString().trim().toUpperCase() === "LEDGER_ID") continue;
      var studentAppId = ldgData[j][1].toString().trim();
      if (studentAppId !== appId.toString().trim()) continue;
      
      var balance = parseFloat(ldgData[j][10]) || 0;
      var ledgerId = ldgData[j][0].toString().trim();
      var payingAmt = parseFloat(payingMap[ledgerId]) || 0;
      
      if (balance > 0 || payingAmt > 0) {
        var headId = ldgData[j][5].toString().trim();
        var priority = headPriorities[headId] || 99;
        var rawDueDate = ldgData[j][11];
        
        studentEntries.push({
          ledgerId: ledgerId,
          headName: ldgData[j][6].toString().trim(),
          applicableMonth: ldgData[j][7].toString().trim(),
          balance: balance,
          dueDateStr: formatDateValue(rawDueDate),
          timestamp: parseDueDayToTimestamp(rawDueDate),
          priority: priority,
          payingAmt: payingAmt
        });
      }
    }
    
    // Sort studentEntries in strict chronological + priority order
    studentEntries.sort(function(a, b) {
      if (a.timestamp !== b.timestamp) {
        return a.timestamp - b.timestamp;
      }
      return a.priority - b.priority;
    });
    
    // Validate: for each item being paid, all items before it must be fully paid after this transaction
    for (var k = 0; k < studentEntries.length; k++) {
      var item = studentEntries[k];
      if (item.payingAmt > 0) {
        // Look at all items before item in the sorted sequence
        for (var prevIdx = 0; prevIdx < k; prevIdx++) {
          var prevItem = studentEntries[prevIdx];
          var finalBalance = prevItem.balance - prevItem.payingAmt;
          if (finalBalance > 0) {
            return {
              success: false,
              message: "Payment sequence violation: You must fully pay '" 
                + prevItem.headName + " (" + prevItem.applicableMonth + ")' before paying '" 
                + item.headName + " (" + item.applicableMonth + ")'."
            };
          }
        }
      }
    }
    
    return { success: true };
  } catch (err) {
    return { success: false, message: "Error validating payment sequence: " + err.message };
  }
}

function parseDueDayToTimestamp(val) {
  if (!val) return 0;
  if (val instanceof Date) {
    return val.getTime();
  }
  var dateStr = val.toString().trim();
  if (!dateStr) return 0;
  var parts = dateStr.split('-');
  if (parts.length === 3) {
    var day = parseInt(parts[0], 10);
    var monthStr = parts[1].toLowerCase();
    var year = parseInt(parts[2], 10);
    var months = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
    var monthIdx = months.indexOf(monthStr);
    if (monthIdx !== -1) {
      return new Date(year, monthIdx, day).getTime();
    }
  }
  var d = new Date(dateStr);
  if (!isNaN(d.getTime())) {
    return d.getTime();
  }
  return 0;
}

function ensureFeePriorityHeader() {
  try {
    var sheet = getSheet("FEE_STRUCTURE_HEADS");
    var lastCol = sheet.getLastColumn();
    if (lastCol < 7) {
      sheet.getRange(1, 7).setValue("PRIORITY");
    } else {
      var headerVal = sheet.getRange(1, 7).getValue().toString().trim();
      if (!headerVal) sheet.getRange(1, 7).setValue("PRIORITY");
    }
  } catch (err) {
    Logger.log("Error in ensureFeePriorityHeader: " + err.message);
  }
}

function findAndRemoveDuplicateLedgerRows() {
  try {
    var sheet = getSheet("STUDENT_FEE_LEDGER");
    var data = sheet.getDataRange().getValues();
    var uniqueKeys = {};
    var rowsToDelete = [];
    
    for (var i = data.length - 1; i >= 0; i--) {
      if (!data[i][0] || data[i][0].toString().trim().toUpperCase() === "LEDGER_ID") continue;
      
      var ledgerId = data[i][0].toString().trim();
      var appId = data[i][1].toString().trim();
      var studentName = data[i][2].toString().trim();
      var headId = data[i][5].toString().trim();
      var headName = data[i][6].toString().trim();
      var month = data[i][7].toString().trim();
      var balance = parseFloat(data[i][10]) || 0;
      var paid = parseFloat(data[i][9]) || 0;
      var acadYear = (data[i][14] || "").toString().trim();
      
      var key = appId + "_" + headId + "_" + month + "_" + acadYear;
      
      if (uniqueKeys[key]) {
        if (paid === 0) {
          rowsToDelete.push(i + 1);
          Logger.log("Duplicate found: Row " + (i + 1) + " | Student: " + studentName + " | Head: " + headName + " | Month: " + month + " (to be deleted)");
        } else {
          Logger.log("Duplicate found but has payment: Row " + (i + 1) + " | Student: " + studentName + " | Head: " + headName + " | Month: " + month + " (skipping delete)");
        }
      } else {
        uniqueKeys[key] = i + 1;
      }
    }
    
    for (var d = 0; d < rowsToDelete.length; d++) {
      sheet.deleteRow(rowsToDelete[d]);
    }
    
    if (rowsToDelete.length > 0) {
      Logger.log("findAndRemoveDuplicateLedgerRows: Deleted " + rowsToDelete.length + " duplicate rows.");
    }
  } catch (err) {
    Logger.log("Error in findAndRemoveDuplicateLedgerRows: " + err.message);
  }
}

// ── 21. SERVICE REQUESTS & COMPLIANCE SYSTEM ─────────────────────
function ensureServiceRequestsSheet() {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName("SERVICE_REQUESTS");
    if (!sheet) {
      sheet = ss.insertSheet("SERVICE_REQUESTS");
      var headers = [
        "REQUEST_ID",       // 0
        "APPLICATION_ID",   // 1
        "STUDENT_NAME",     // 2
        "ROOM_NUMBER",      // 3
        "CATEGORY",         // 4
        "PRIORITY",         // 5
        "DESCRIPTION",      // 6
        "SUBMISSION_DATE",  // 7
        "SUBMISSION_TIME",  // 8
        "STATUS",           // 9
        "RECTOR_REMARKS",   // 10
        "RESOLVED_BY",      // 11
        "RESOLVED_DATE",    // 12
        "ACADEMIC_YEAR"     // 13
      ];
      sheet.appendRow(headers);
      var headerRange = sheet.getRange(1, 1, 1, headers.length);
      headerRange.setFontWeight("bold");
      headerRange.setBackground("#4F46E5");
      headerRange.setFontColor("#FFFFFF");
      sheet.setFrozenRows(1);
    }
  } catch (err) {
    Logger.log("Error in ensureServiceRequestsSheet: " + err.message);
  }
}

function getStudentExtraInfoByEmail(email) {
  var result = {
    appId: "",
    studentName: "",
    course: "",
    yearOfStudy: "",
    collegeName: "",
    roomNumber: "",
    roomType: "",
    contactNumber: "",
    parentContact: "",
    status: "",
    allotmentDate: "",
    physicalStatus: "Not Reported",
    reportingDate: ""
  };
  if (!email) return result;
  
  try {
    var appSheet = getSheet("STUDENT_APPLICATIONS");
    var appData = appSheet.getDataRange().getValues();
    var emailClean = email.toString().trim().toLowerCase();
    
    for (var i = 1; i < appData.length; i++) {
      var row = appData[i];
      if (!row[0] || row[0].toString().trim().toUpperCase() === "APP_ID") continue;
      var rowEmail = (row[8] || "").toString().trim().toLowerCase(); // Col I: EMAIL
      if (rowEmail === emailClean) {
        result.appId = (row[0] || "").toString().trim();
        result.studentName = (row[2] || "").toString().trim();
        result.contactNumber = (row[6] || "").toString().trim();
        result.parentContact = (row[7] || "").toString().trim();
        result.course = (row[12] || "").toString().trim();
        result.yearOfStudy = (row[13] || "").toString().trim();
        result.collegeName = (row[14] || "").toString().trim();
        result.status = (row[19] || "").toString().trim();
        break;
      }
    }
    
    // Find active allotment for room number
    if (result.appId) {
      var allotSheet = getSheet("ROOM_ALLOTMENTS");
      var allotData = allotSheet.getDataRange().getValues();
      for (var j = 1; j < allotData.length; j++) {
        var aRow = allotData[j];
        if (!aRow[0] || aRow[0].toString().trim().toUpperCase() === "ALLOT_ID" || aRow[0].toString().trim().toUpperCase() === "ALLOTMENT_ID") continue;
        var aAppId = (aRow[1] || "").toString().trim();
        var aStatus = (aRow[9] || "Active").toString().trim();
        if (aAppId === result.appId && aStatus.toLowerCase() === "active") {
          result.roomNumber = (aRow[4] || "").toString().trim();
          result.roomType = (aRow[5] || "").toString().trim();
          result.allotmentDate = formatDateValue(aRow[6]);
          result.physicalStatus = (aRow[12] || "Not Reported").toString().trim();
          result.reportingDate = (aRow[13] ? formatDateValue(aRow[13]) : "");
          break;
        }
      }
    }
  } catch (err) {
    Logger.log("Error in getStudentExtraInfoByEmail: " + err.message);
  }
  return result;
}

function getStudentDashboardData(email, academicYear) {
  try {
    var studentInfo = getStudentExtraInfoByEmail(email);
    if (!studentInfo.appId) {
      return { success: false, message: "No registered student profile found for email: " + email };
    }
    
    var year = academicYear || getActiveAcademicYear();
    
    // 1. Fee ledger
    var ledgerRes = getStudentFeeLedger(studentInfo.appId, year);
    var ledgerItems = (ledgerRes && ledgerRes.success && ledgerRes.data) ? ledgerRes.data : [];
    
    var totalDemanded = 0;
    var totalPaid = 0;
    var totalBalance = 0;
    for (var l = 0; l < ledgerItems.length; l++) {
      totalDemanded += parseFloat(ledgerItems[l].amountDemanded) || 0;
      totalPaid += parseFloat(ledgerItems[l].amountPaid) || 0;
      totalBalance += parseFloat(ledgerItems[l].balanceDue) || 0;
    }
    
    // 2. Receipts
    var receiptsRes = getFeeReceipts(studentInfo.appId, year);
    var receipts = (receiptsRes && receiptsRes.success && receiptsRes.data) ? receiptsRes.data : [];
    
    // 3. Service requests
    var requests = [];
    ensureServiceRequestsSheet();
    var reqSheet = getSheet("SERVICE_REQUESTS");
    var reqData = reqSheet.getDataRange().getValues();
    for (var r = 1; r < reqData.length; r++) {
      var row = reqData[r];
      if (!row[0] || row[0].toString().trim().toUpperCase() === "REQUEST_ID") continue;
      var rowAppId = (row[1] || "").toString().trim();
      if (rowAppId === studentInfo.appId) {
        requests.push({
          requestId: row[0].toString().trim(),
          appId: row[1].toString().trim(),
          studentName: (row[2] || "").toString().trim(),
          roomNumber: (row[3] || "").toString().trim(),
          category: (row[4] || "").toString().trim(),
          priority: (row[5] || "Normal").toString().trim(),
          description: (row[6] || "").toString().trim(),
          submissionDate: formatDateValue(row[7]),
          submissionTime: (row[8] || "").toString().trim(),
          status: (row[9] || "Submitted").toString().trim(),
          rectorRemarks: (row[10] || "").toString().trim(),
          resolvedBy: (row[11] || "").toString().trim(),
          resolvedDate: formatDateValue(row[12]),
          academicYear: (row[13] || "").toString().trim()
        });
      }
    }
    requests.reverse();
    
    return {
      success: true,
      student: studentInfo,
      academicYear: year,
      feeSummary: {
        totalDemanded: Math.round(totalDemanded * 100) / 100,
        totalPaid: Math.round(totalPaid * 100) / 100,
        balanceDue: Math.round(totalBalance * 100) / 100
      },
      ledger: ledgerItems,
      receipts: receipts,
      requests: requests
    };
  } catch (err) {
    return { success: false, message: "Error loading student dashboard: " + err.message };
  }
}

function submitStudentServiceRequest(requestData) {
  try {
    ensureServiceRequestsSheet();
    var sheet = getSheet("SERVICE_REQUESTS");
    var reqId = generateId("REQ");
    var today = todayFormatted();
    var now = new Date();
    var timeStr = Utilities.formatDate(now, Session.getScriptTimeZone(), "hh:mm a");
    var acadYear = requestData.academicYear || getActiveAcademicYear();
    
    sheet.appendRow([
      reqId,
      requestData.appId || "",
      requestData.studentName || "",
      requestData.roomNumber || "",
      requestData.category || "Maintenance",
      requestData.priority || "Normal",
      requestData.description || "",
      today,
      timeStr,
      "Submitted",
      "",
      "",
      "",
      acadYear
    ]);
    
    return { success: true, requestId: reqId, message: "Service request submitted successfully (ID: " + reqId + ")." };
  } catch (err) {
    return { success: false, message: "Error submitting request: " + err.message };
  }
}

function getRectorServiceRequests(statusFilter, academicYear, categoryFilter) {
  try {
    ensureServiceRequestsSheet();
    var sheet = getSheet("SERVICE_REQUESTS");
    var data = sheet.getDataRange().getValues();
    var results = [];
    
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (!row[0] || row[0].toString().trim().toUpperCase() === "REQUEST_ID") continue;
      
      var rowStatus = (row[9] || "Submitted").toString().trim();
      var rowYear = (row[13] || "").toString().trim();
      var rowCat = (row[4] || "").toString().trim();
      
      if (academicYear && academicYear !== "All" && rowYear && rowYear !== academicYear) {
        continue;
      }
      if (statusFilter && statusFilter !== "All" && rowStatus.toLowerCase() !== statusFilter.toLowerCase()) {
        continue;
      }
      if (categoryFilter && categoryFilter !== "All" && rowCat.toLowerCase() !== categoryFilter.toLowerCase()) {
        continue;
      }
      
      results.push({
        requestId: row[0].toString().trim(),
        appId: (row[1] || "").toString().trim(),
        studentName: (row[2] || "").toString().trim(),
        roomNumber: (row[3] || "").toString().trim(),
        category: rowCat,
        priority: (row[5] || "Normal").toString().trim(),
        description: (row[6] || "").toString().trim(),
        submissionDate: formatDateValue(row[7]),
        submissionTime: (row[8] || "").toString().trim(),
        status: rowStatus,
        rectorRemarks: (row[10] || "").toString().trim(),
        resolvedBy: (row[11] || "").toString().trim(),
        resolvedDate: formatDateValue(row[12]),
        academicYear: rowYear
      });
    }
    
    results.reverse();
    return { success: true, data: results };
  } catch (err) {
    return { success: false, message: "Error fetching service requests: " + err.message };
  }
}

function updateRequestCompliance(requestId, newStatus, complianceRemarks, rectorName) {
  try {
    ensureServiceRequestsSheet();
    var sheet = getSheet("SERVICE_REQUESTS");
    var data = sheet.getDataRange().getValues();
    var cleanId = (requestId || "").toString().trim();
    
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (row[0] && row[0].toString().trim() === cleanId) {
        var rowNum = i + 1;
        var today = todayFormatted();
        
        sheet.getRange(rowNum, 10).setValue(newStatus); // Col J: STATUS
        sheet.getRange(rowNum, 11).setValue(complianceRemarks || ""); // Col K: RECTOR_REMARKS
        sheet.getRange(rowNum, 12).setValue(rectorName || "Rector"); // Col L: RESOLVED_BY
        
        if (newStatus === "Resolved" || newStatus === "Rejected") {
          sheet.getRange(rowNum, 13).setValue(today); // Col M: RESOLVED_DATE
        } else {
          sheet.getRange(rowNum, 13).setValue(""); // Clear if reopened
        }
        
        return { success: true, message: "Request " + cleanId + " updated to '" + newStatus + "'." };
      }
    }
    return { success: false, message: "Request ID not found: " + cleanId };
  } catch (err) {
    return { success: false, message: "Error updating request: " + err.message };
  }
}

function changeStudentPassword(email, currentPassword, newPassword) {
  try {
    if (!email || !currentPassword || !newPassword) {
      return { success: false, message: "All password fields are required." };
    }
    if (newPassword.toString().trim().length < 4) {
      return { success: false, message: "New password must be at least 4 characters long." };
    }
    
    var sheet = getSheet("USERS");
    var data = sheet.getDataRange().getValues();
    var cleanEmail = email.toString().trim().toLowerCase();
    
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (!row[0] || row[0].toString().trim().toUpperCase() === "USER_ID") continue;
      var rowEmail = (row[2] || "").toString().trim().toLowerCase();
      var rowPass = (row[3] || "").toString().trim();
      
      if (rowEmail === cleanEmail) {
        if (rowPass !== currentPassword.toString().trim()) {
          return { success: false, message: "Current password does not match our records." };
        }
        sheet.getRange(i + 1, 4).setValue(newPassword.toString().trim());
        return { success: true, message: "Password updated successfully!" };
      }
    }
    return { success: false, message: "User account not found." };
  } catch (err) {
    return { success: false, message: "Error changing password: " + err.message };
  }
}

function ensureStudentUserAccount(appId, studentName, email, contactNumber) {
  try {
    if (!email) return { success: false, message: "No email provided." };

    // Verify student is actually approved and has active room allotment before creating
    var studentInfo = getStudentExtraInfoByEmail(email);
    if ((studentInfo.status || "").toLowerCase() !== "approved" || !studentInfo.roomNumber) {
      return { success: false, message: "Student is not approved or has no active room allotment." };
    }

    ensureUserStatusColumn();
    var sheet = getSheet("USERS");
    var data = sheet.getDataRange().getValues();
    var emailClean = email.toString().trim().toLowerCase();
    
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (row[2] && row[2].toString().trim().toLowerCase() === emailClean) {
        return { success: true, message: "User already exists." };
      }
    }
    
    var defaultPass = (contactNumber && contactNumber.toString().trim().length >= 6)
      ? contactNumber.toString().trim()
      : "Student@123";
      
    var newUserId = generateId("USR");
    sheet.appendRow([
      newUserId,
      studentName || "Student",
      emailClean,
      defaultPass,
      "Student",
      "Active"
    ]);
    return { success: true, message: "Created student login.", defaultPassword: defaultPass };
  } catch (err) {
    Logger.log("Error in ensureStudentUserAccount: " + err.message);
    return { success: false, message: err.message };
  }
}

function syncAllStudentAccounts() {
  try {
    ensureUserStatusColumn();
    var userSheet = getSheet("USERS");
    var userData = userSheet.getDataRange().getValues();

    // 1. Get all active room allotments (STATUS !== 'Vacated')
    var allotSheet = getSheet("ROOM_ALLOTMENTS");
    var allotData = allotSheet.getDataRange().getValues();
    var activeAllotmentMap = {}; // appId -> true
    for (var j = 1; j < allotData.length; j++) {
      var aRow = allotData[j];
      if (!aRow[0] || aRow[0].toString().trim().toUpperCase() === "ALLOTMENT_ID") continue;
      var aAppId = (aRow[1] || "").toString().trim();
      var aStatus = (aRow[9] || "Active").toString().trim();
      if (aAppId && aStatus.toLowerCase() !== "vacated") {
        activeAllotmentMap[aAppId] = true;
      }
    }

    // 2. Get all approved students who have an active room allotment
    var appSheet = getSheet("STUDENT_APPLICATIONS");
    var appData = appSheet.getDataRange().getValues();
    var eligibleStudents = {}; // cleanEmail -> { appId, studentName, email, contactNumber }

    for (var a = 1; a < appData.length; a++) {
      var aRow = appData[a];
      if (!aRow[0] || aRow[0].toString().trim().toUpperCase() === "APP_ID") continue;
      var appId = aRow[0].toString().trim();
      var sName = (aRow[2] || "Student").toString().trim();
      var sContact = (aRow[6] || "").toString().trim();
      var sEmail = (aRow[8] || "").toString().trim().toLowerCase();
      var sStatus = (aRow[19] || "").toString().trim();

      // STRICT CRITERIA: Application must be 'Approved' AND student must have an active room allotment
      if (sEmail && sStatus.toLowerCase() === "approved" && activeAllotmentMap[appId]) {
        eligibleStudents[sEmail] = {
          appId: appId,
          studentName: sName,
          contactNumber: sContact,
          email: sEmail
        };
      }
    }

    // 3. Clean up USERS sheet: remove any Student accounts that are NOT eligible (unapproved / non-allotted)
    var rowsToDelete = [];
    var existingEligibleEmails = {};

    for (var u = userData.length - 1; u >= 1; u--) {
      var uRow = userData[u];
      if (!uRow[0] || uRow[0].toString().trim().toUpperCase() === "USER_ID") continue;
      var uEmail = (uRow[2] || "").toString().trim().toLowerCase();
      var uRole = (uRow[4] || "").toString().trim().toLowerCase();

      if (uRole === "student") {
        if (!eligibleStudents[uEmail]) {
          // Unapproved or non-allotted student: remove from user logins
          rowsToDelete.push(u + 1);
        } else {
          existingEligibleEmails[uEmail] = true;
        }
      }
    }

    for (var d = 0; d < rowsToDelete.length; d++) {
      userSheet.deleteRow(rowsToDelete[d]);
    }

    // 4. Create logins for eligible approved & room-allotted students who don't have an account yet
    var createdCount = 0;
    for (var emailKey in eligibleStudents) {
      if (!existingEligibleEmails[emailKey]) {
        var student = eligibleStudents[emailKey];
        var newUserId = generateId("USR");
        var pass = (student.contactNumber && student.contactNumber.length >= 6)
          ? student.contactNumber
          : "Student@123";

        userSheet.appendRow([
          newUserId,
          student.studentName,
          student.email,
          pass,
          "Student",
          "Active"
        ]);
        createdCount++;
      }
    }

    var totalEligible = Object.keys(eligibleStudents).length;
    var msg = "Sync complete: " + totalEligible + " approved & room-allotted student(s) active.";
    if (createdCount > 0) msg += " (" + createdCount + " new accounts created)";
    if (rowsToDelete.length > 0) msg += " (" + rowsToDelete.length + " unapproved/non-allotted accounts cleaned up)";

    return { success: true, message: msg };
  } catch (err) {
    return { success: false, message: "Error synchronizing student accounts: " + err.message };
  }
}

// ══════════════════════════════════════════════════════════════
// ── 30. MANUAL RECEIPT FEE TYPES (Configurable by Admin) ─────
// ══════════════════════════════════════════════════════════════

var DEFAULT_MANUAL_FEE_TYPES = [
  "Admission Fee",
  "Monthly Hostel Fee",
  "Security Deposit",
  "Hostel Linen Charges",
  "Fine",
  "Miscellaneous"
];

function getManualFeeTypes() {
  try {
    var sheet = getSheet("SETTINGS");
    var data = sheet.getDataRange().getValues();
    var rawVal = "";
    for (var i = 0; i < data.length; i++) {
      if (data[i][0] && data[i][0].toString().trim() === "MANUAL_FEE_TYPES") {
        rawVal = data[i][1];
        break;
      }
    }

    var types = [];
    if (rawVal) {
      try {
        types = JSON.parse(rawVal);
      } catch (e) {
        types = rawVal.toString().split(",").map(function(s) { return s.trim(); }).filter(Boolean);
      }
    }

    if (!types || !Array.isArray(types) || types.length === 0) {
      types = DEFAULT_MANUAL_FEE_TYPES.slice();
      saveSettings({ MANUAL_FEE_TYPES: JSON.stringify(types) });
    } else {
      // Ensure "Hostel Linen Charges" exists
      var hasLinen = types.some(function(t) { return t.toLowerCase() === "hostel linen charges"; });
      if (!hasLinen) {
        types.push("Hostel Linen Charges");
        saveSettings({ MANUAL_FEE_TYPES: JSON.stringify(types) });
      }
    }

    return { success: true, data: types };
  } catch (err) {
    return { success: true, data: DEFAULT_MANUAL_FEE_TYPES.slice() };
  }
}

function saveManualFeeType(newType) {
  try {
    var cleanType = (newType || "").toString().trim();
    if (!cleanType) return { success: false, message: "Fee type name cannot be empty." };

    var currentRes = getManualFeeTypes();
    var list = currentRes.data || [];

    var exists = list.some(function(t) { return t.toLowerCase() === cleanType.toLowerCase(); });
    if (exists) {
      return { success: false, message: 'Fee type "' + cleanType + '" already exists.' };
    }

    list.push(cleanType);
    saveSettings({ MANUAL_FEE_TYPES: JSON.stringify(list) });
    return { success: true, data: list };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function updateManualFeeType(oldType, newType) {
  try {
    var cleanOld = (oldType || "").toString().trim();
    var cleanNew = (newType || "").toString().trim();
    if (!cleanOld || !cleanNew) return { success: false, message: "Both old and new fee type names are required." };
    if (cleanOld.toLowerCase() === cleanNew.toLowerCase()) return { success: true, data: getManualFeeTypes().data };

    var currentRes = getManualFeeTypes();
    var list = currentRes.data || [];

    var clash = list.some(function(t) {
      return t.toLowerCase() === cleanNew.toLowerCase() && t.toLowerCase() !== cleanOld.toLowerCase();
    });
    if (clash) {
      return { success: false, message: 'Fee type "' + cleanNew + '" already exists.' };
    }

    var index = -1;
    for (var i = 0; i < list.length; i++) {
      if (list[i].toLowerCase() === cleanOld.toLowerCase()) {
        index = i;
        break;
      }
    }
    if (index === -1) {
      return { success: false, message: 'Fee type "' + cleanOld + '" not found.' };
    }

    list[index] = cleanNew;
    saveSettings({ MANUAL_FEE_TYPES: JSON.stringify(list) });
    return { success: true, data: list };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function deleteManualFeeType(typeName) {
  try {
    var cleanType = (typeName || "").toString().trim();
    if (!cleanType) return { success: false, message: "Fee type name cannot be empty." };

    var currentRes = getManualFeeTypes();
    var list = currentRes.data || [];

    var filtered = list.filter(function(t) { return t.toLowerCase() !== cleanType.toLowerCase(); });
    if (filtered.length === list.length) {
      return { success: false, message: 'Fee type "' + cleanType + '" not found.' };
    }
    if (filtered.length === 0) {
      return { success: false, message: "Cannot delete the only remaining fee type." };
    }

    saveSettings({ MANUAL_FEE_TYPES: JSON.stringify(filtered) });
    return { success: true, data: filtered };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ══════════════════════════════════════════════════════════════════
// ── 25B. BANK COLLECTION ACCOUNTS MANAGEMENT (BANK_ACCOUNTS) ─────
// ══════════════════════════════════════════════════════════════════

function ensureBankAccountsSheet() {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName("BANK_ACCOUNTS");
    if (!sheet) {
      sheet = ss.insertSheet("BANK_ACCOUNTS");
      sheet.appendRow([
        "ACCOUNT_ID",
        "ACCOUNT_NAME",
        "BANK_NAME",
        "ACCOUNT_NO",
        "IFSC_BRANCH",
        "ACCOUNT_TYPE",
        "STATUS",
        "CREATED_DATE"
      ]);
      sheet.getRange(1, 1, 1, 8).setFontWeight("bold").setBackground("#EEF2FF");

      // Seed initial standard accounts (preserves historical reconciliation options)
      var nowStr = todayFormatted();
      var initial = [
        ["BA-1001", "State Bank of India (Main A/C)", "State Bank of India", "", "", "Current", "Active", nowStr],
        ["BA-1002", "Bank of Maharashtra (Hostel A/C)", "Bank of Maharashtra", "", "", "Current", "Active", nowStr],
        ["BA-1003", "HDFC Bank (Fee Collection A/C)", "HDFC Bank", "", "", "Current", "Active", nowStr],
        ["BA-1004", "ICICI Bank", "ICICI Bank", "", "", "Current", "Active", nowStr]
      ];
      for (var i = 0; i < initial.length; i++) {
        sheet.appendRow(initial[i]);
      }
      Logger.log("Created and seeded BANK_ACCOUNTS sheet.");
    }
    return sheet;
  } catch (e) {
    Logger.log("ensureBankAccountsSheet error: " + e.message);
    return null;
  }
}

function getBankAccounts() {
  try {
    ensureBankAccountsSheet();
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName("BANK_ACCOUNTS");
    if (!sheet) return { success: true, data: [] };

    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return { success: true, data: [] };

    var accounts = [];
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (!row[0] || row[0].toString().trim().toUpperCase() === "ACCOUNT_ID") continue;

      accounts.push({
        accountId:   row[0].toString().trim(),
        accountName: (row[1] || "").toString().trim(),
        bankName:    (row[2] || "").toString().trim(),
        accountNo:   (row[3] || "").toString().trim(),
        ifscBranch:  (row[4] || "").toString().trim(),
        accountType: (row[5] || "Current").toString().trim(),
        status:      (row[6] || "Active").toString().trim(),
        createdDate: formatDateValue(row[7])
      });
    }

    return { success: true, data: accounts };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function saveBankAccount(payload) {
  try {
    ensureBankAccountsSheet();
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName("BANK_ACCOUNTS");
    if (!sheet) return { success: false, message: "BANK_ACCOUNTS sheet not found." };

    if (!payload || !payload.accountName || !payload.accountName.toString().trim()) {
      return { success: false, message: "Bank Account Name is required." };
    }

    var accountName = payload.accountName.toString().trim();
    var bankName = (payload.bankName || accountName).toString().trim();
    var accountNo = (payload.accountNo || "").toString().trim();
    var ifscBranch = (payload.ifscBranch || "").toString().trim();
    var accountType = (payload.accountType || "Current").toString().trim();
    var status = (payload.status || "Active").toString().trim();
    var accountId = (payload.accountId || "").toString().trim();

    var data = sheet.getDataRange().getValues();

    // Check duplicate account name (excluding current account on edit)
    for (var i = 1; i < data.length; i++) {
      var rId = (data[i][0] || "").toString().trim();
      var rName = (data[i][1] || "").toString().trim();
      if (rName.toLowerCase() === accountName.toLowerCase() && rId !== accountId) {
        return { success: false, message: 'A bank account with name "' + accountName + '" already exists.' };
      }
    }

    if (accountId) {
      // Edit existing account
      for (var i = 1; i < data.length; i++) {
        if (data[i][0] && data[i][0].toString().trim() === accountId) {
          var rowNum = i + 1;
          var oldAccountName = (data[i][1] || "").toString().trim();

          sheet.getRange(rowNum, 2).setValue(accountName);
          sheet.getRange(rowNum, 3).setValue(bankName);
          sheet.getRange(rowNum, 4).setValue(accountNo);
          sheet.getRange(rowNum, 5).setValue(ifscBranch);
          sheet.getRange(rowNum, 6).setValue(accountType);
          sheet.getRange(rowNum, 7).setValue(status);

          // If accountName changed, update existing reconciled receipts to preserve linkage without duplicates
          if (oldAccountName && oldAccountName !== accountName) {
            var rcptSheet = ss.getSheetByName("FEE_RECEIPTS");
            if (rcptSheet) {
              var rcptData = rcptSheet.getDataRange().getValues();
              for (var r = 1; r < rcptData.length; r++) {
                var rBank = (rcptData[r][17] || "").toString().trim();
                if (rBank.toLowerCase() === oldAccountName.toLowerCase()) {
                  rcptSheet.getRange(r + 1, 18).setValue(accountName);
                }
              }
            }
          }

          return { success: true, message: "Bank account updated successfully." };
        }
      }
      return { success: false, message: "Account ID " + accountId + " not found." };
    } else {
      // Create new account
      var newId = generateId("BA");
      var nowStr = todayFormatted();
      sheet.appendRow([
        newId,
        accountName,
        bankName,
        accountNo,
        ifscBranch,
        accountType,
        status,
        nowStr
      ]);
      return { success: true, message: "Bank account created successfully.", accountId: newId };
    }
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function deleteBankAccount(accountId) {
  try {
    if (!accountId) return { success: false, message: "Account ID is required." };

    ensureBankAccountsSheet();
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName("BANK_ACCOUNTS");
    if (!sheet) return { success: false, message: "BANK_ACCOUNTS sheet not found." };

    var data = sheet.getDataRange().getValues();
    var targetRow = -1;
    var targetAccountName = "";

    for (var i = 1; i < data.length; i++) {
      if (data[i][0] && data[i][0].toString().trim() === accountId.toString().trim()) {
        targetRow = i + 1;
        targetAccountName = (data[i][1] || "").toString().trim();
        break;
      }
    }

    if (targetRow === -1) {
      return { success: false, message: "Bank account not found." };
    }

    // CHECK IF ANY TRANSACTIONS / ENTRIES ARE ASSOCIATED WITH THIS BANK ACCOUNT
    // Check in FEE_RECEIPTS sheet (Column 18 is RECON_BANK, 0-indexed 17)
    var rcptSheet = ss.getSheetByName("FEE_RECEIPTS");
    if (rcptSheet) {
      var rcptData = rcptSheet.getDataRange().getValues();
      for (var r = 1; r < rcptData.length; r++) {
        var rBank = (rcptData[r][17] || "").toString().trim();
        if (targetAccountName && rBank && rBank.toLowerCase() === targetAccountName.toLowerCase()) {
          return {
            success: false,
            message: "This bank account cannot be deleted because transactions/entries are already associated with this account."
          };
        }
      }
    }

    // No transactions/entries found -> Safe to delete
    sheet.deleteRow(targetRow);
    return { success: true, message: "Bank account deleted successfully." };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ── 26. BANK RECONCILIATION FOR NON-CASH RECEIPTS ─────────────

function ensureBankReconciliationColumns() {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName("FEE_RECEIPTS");
    if (!sheet) return;
    var lastCol = Math.max(sheet.getLastColumn(), 23);
    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var needed = [
      { col: 17, name: "RECON_STATUS" },
      { col: 18, name: "RECON_BANK" },
      { col: 19, name: "RECON_CREDIT_DATE" },
      { col: 20, name: "RECON_REF_NO" },
      { col: 21, name: "RECON_REMARKS" },
      { col: 22, name: "RECONCILED_BY" },
      { col: 23, name: "RECONCILED_AT" }
    ];
    for (var i = 0; i < needed.length; i++) {
      var idx = needed[i].col - 1;
      var cur = (headers[idx] || "").toString().trim();
      if (!cur) {
        sheet.getRange(1, needed[i].col).setValue(needed[i].name);
      }
    }
  } catch (e) {
    Logger.log("ensureBankReconciliationColumns error: " + e.message);
  }
}

function reconcileFeeReceipt(payload) {
  try {
    if (!payload || !payload.receiptId) {
      return { success: false, message: "Receipt ID is required." };
    }
    ensureBankReconciliationColumns();
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName("FEE_RECEIPTS");
    if (!sheet) return { success: false, message: "FEE_RECEIPTS sheet not found." };

    var data = sheet.getDataRange().getValues();
    var receiptId = payload.receiptId.toString().trim();
    var status = payload.status || "Reconciled";
    var bankName = (payload.bankName || "").toString().trim();
    var creditDate = payload.creditDate ? formatDateValue(payload.creditDate) : todayFormatted();
    var refNo = (payload.refNo || "").toString().trim();
    var remarks = (payload.remarks || "").toString().trim();
    var user = payload.reconciledBy || (Session.getActiveUser() ? Session.getActiveUser().getEmail() : "") || "Administrator";
    var nowStr = todayFormatted();

    for (var i = 1; i < data.length; i++) {
      if (data[i][0] && data[i][0].toString().trim() === receiptId) {
        var rowNum = i + 1;
        var pMode = (data[i][7] || "").toString().trim().toLowerCase();
        if (pMode === "cash" && status === "Reconciled") {
          return { success: false, message: "Cash receipts do not require bank reconciliation." };
        }

        sheet.getRange(rowNum, 17).setValue(status);
        sheet.getRange(rowNum, 18).setValue(bankName);
        sheet.getRange(rowNum, 19).setValue(creditDate);
        sheet.getRange(rowNum, 20).setValue(refNo);
        sheet.getRange(rowNum, 21).setValue(remarks);
        sheet.getRange(rowNum, 22).setValue(user);
        sheet.getRange(rowNum, 23).setValue(nowStr);

        return {
          success: true,
          message: "Receipt " + receiptId + " marked as " + status + "."
        };
      }
    }
    return { success: false, message: "Receipt ID " + receiptId + " not found." };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function unreconcileFeeReceipt(receiptId) {
  try {
    if (!receiptId) return { success: false, message: "Receipt ID required." };
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName("FEE_RECEIPTS");
    if (!sheet) return { success: false, message: "FEE_RECEIPTS sheet not found." };
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] && data[i][0].toString().trim() === receiptId.toString().trim()) {
        var rowNum = i + 1;
        sheet.getRange(rowNum, 17).setValue("Unreconciled");
        sheet.getRange(rowNum, 18).setValue("");
        sheet.getRange(rowNum, 19).setValue("");
        sheet.getRange(rowNum, 20).setValue("");
        sheet.getRange(rowNum, 21).setValue("");
        sheet.getRange(rowNum, 22).setValue("");
        sheet.getRange(rowNum, 23).setValue("");
        return { success: true, message: "Receipt " + receiptId + " reset to Unreconciled." };
      }
    }
    return { success: false, message: "Receipt not found." };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

function getBankReconciliationReport(academicYear) {
  try {
    ensureBankReconciliationColumns();
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName("FEE_RECEIPTS");
    if (!sheet) return { success: true, data: { items: [], summary: {} } };

    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return { success: true, data: { items: [], summary: {} } };

    var totalNonCashAmount = 0;
    var totalNonCashCount = 0;
    var totalReconciledAmount = 0;
    var totalReconciledCount = 0;
    var totalUnreconciledAmount = 0;
    var totalUnreconciledCount = 0;
    var bankMap = {};

    // Seed bankMap with Admin-configured bank accounts from BANK_ACCOUNTS master
    var bankAccountsRes = getBankAccounts();
    var bankAccounts = (bankAccountsRes && bankAccountsRes.success && bankAccountsRes.data) ? bankAccountsRes.data : [];
    bankAccounts.forEach(function(ba) {
      if ((ba.status || "Active").toLowerCase() === "active") {
        bankMap[ba.accountName] = {
          bankName: ba.accountName,
          actualBank: ba.bankName,
          accountNo: ba.accountNo,
          count: 0,
          amount: 0
        };
      }
    });

    var items = [];
    var acadYearCol = 15; // Col P: ACADEMIC_YEAR (0-indexed 15)

    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (!row[0] || row[0].toString().trim().toUpperCase() === "RECEIPT_ID") continue;

      var rStatus = (row[13] || "Active").toString().trim();
      if (rStatus.toLowerCase() === "cancelled") continue;

      var pMode = (row[7] || "").toString().trim();
      if (pMode.toLowerCase() === "cash") continue; // only non-cash

      var rowAcadYear = (acadYearCol < row.length && row[acadYearCol]) ? row[acadYearCol].toString().trim() : "";
      if (academicYear && academicYear !== "All" && !isAcademicYearMatch(rowAcadYear, academicYear)) {
        continue;
      }

      var amount = parseFloat(row[6]) || 0;
      var reconStatus = (row[16] || "").toString().trim() || "Unreconciled";
      var reconBank = (row[17] || "").toString().trim();
      var reconCreditDate = formatDateValue(row[18]);
      var reconRefNo = (row[19] || "").toString().trim();
      var reconRemarks = (row[20] || "").toString().trim();
      var reconciledBy = (row[21] || "").toString().trim();
      var reconciledAt = formatDateValue(row[22]);

      totalNonCashAmount += amount;
      totalNonCashCount++;

      var isReconciled = reconStatus.toLowerCase() === "reconciled";
      if (isReconciled) {
        totalReconciledAmount += amount;
        totalReconciledCount++;
        var bKey = reconBank || "Other / Unspecified Bank";
        if (!bankMap[bKey]) bankMap[bKey] = { bankName: bKey, count: 0, amount: 0 };
        bankMap[bKey].count++;
        bankMap[bKey].amount += amount;
      } else {
        totalUnreconciledAmount += amount;
        totalUnreconciledCount++;
      }

      items.push({
        receiptId:       row[0].toString().trim(),
        receiptDate:     formatDateValue(row[1]),
        appId:           (row[2] || "").toString().trim(),
        studentName:     (row[3] || "").toString().trim(),
        roomNumber:      (row[4] || "").toString().trim(),
        feeType:         (row[5] || "").toString().trim(),
        amountPaid:      amount,
        paymentMode:     pMode,
        transactionId:   (row[8] || "").toString().trim(),
        feeMonth:        (row[9] || "").toString().trim(),
        feeYear:         (row[10] || "").toString().trim(),
        collectedBy:     (row[11] || "").toString().trim(),
        remarks:         (row[12] || "").toString().trim(),
        academicYear:    rowAcadYear,
        reconStatus:     reconStatus,
        reconBank:       reconBank,
        reconCreditDate: reconCreditDate,
        reconRefNo:      reconRefNo,
        reconRemarks:    reconRemarks,
        reconciledBy:    reconciledBy,
        reconciledAt:    reconciledAt
      });
    }

    var bankList = [];
    for (var k in bankMap) {
      bankList.push(bankMap[k]);
    }

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
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ── 27. COLLEGE & COURSE MASTER CONFIGURATION & SYNC ──────────

function ensureCollegeCoursesSheet() {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName("COLLEGE_COURSES");
    if (!sheet) {
      sheet = ss.insertSheet("COLLEGE_COURSES");
      sheet.appendRow(["COLLEGE_NAME", "COURSE_NAME", "DURATION_YEARS", "STATUS", "CREATED_DATE"]);
      sheet.getRange(1, 1, 1, 5).setFontWeight("bold").setBackground("#EEF2FF");

      // Seed initial standard colleges and courses
      var initial = [
        ["AMGOI", "B.Tech Computer Science & Engineering", "4 Years", "Active", todayFormatted()],
        ["AMGOI", "B.Tech Mechanical Engineering", "4 Years", "Active", todayFormatted()],
        ["AMGOI", "B.Tech Civil Engineering", "4 Years", "Active", todayFormatted()],
        ["AMGOI", "B.Tech Electrical Engineering", "4 Years", "Active", todayFormatted()],
        ["AMGOI", "B.Tech Artificial Intelligence & Data Science", "4 Years", "Active", todayFormatted()],
        ["AMGOI", "Master of Business Administration (MBA)", "2 Years", "Active", todayFormatted()],
        ["AMGOI", "M.Tech Engineering", "2 Years", "Active", todayFormatted()],
        ["AMGOI", "Diploma in Engineering", "3 Years", "Active", todayFormatted()],
        ["AMAMCHRC (BAMS)", "B. A. M. S.", "5.5 Years", "Active", todayFormatted()],
        ["AMAMCHRC (BAMS)", "BAMS", "5.5 Years", "Active", todayFormatted()],
        ["AMAMCHRC (BAMS)", "Bachelor of Ayurvedic Medicine and Surgery (BAMS)", "5.5 Years", "Active", todayFormatted()],
        ["AMHMCH (BHMS)", "BHMS", "5.5 Years", "Active", todayFormatted()],
        ["AMHMCH (BHMS)", "Bachelor of Homeopathic Medicine and Surgery (BHMS)", "5.5 Years", "Active", todayFormatted()],
        ["AMSON (GNM)", "G. N. M.", "3 Years", "Active", todayFormatted()],
        ["AMSON (GNM)", "General Nursing and Midwifery (GNM)", "3 Years", "Active", todayFormatted()],
        ["AMPV (DIPLOMA)", "DIPLOMA IN AIML", "3 Years", "Active", todayFormatted()],
        ["AMPV (DIPLOMA)", "Diploma in Engineering", "3 Years", "Active", todayFormatted()],
        ["Other College", "B.Sc Degree", "3 Years", "Active", todayFormatted()],
        ["Other College", "B.Pharmacy", "4 Years", "Active", todayFormatted()],
        ["Other College", "General Degree", "3 Years", "Active", todayFormatted()]
      ];
      for (var i = 0; i < initial.length; i++) {
        sheet.appendRow(initial[i]);
      }
      Logger.log("Created and seeded COLLEGE_COURSES sheet.");
    } else {
      // Sheet exists: ensure standard courses exist & normalize existing rows
      var data = sheet.getDataRange().getValues();
      var hasAmamchrc = false;
      var hasAmhmch = false;
      var hasAmson = false;
      var hasAmpv = false;
      var hasAmgoiBtechCse = false;

      for (var r = 1; r < data.length; r++) {
        var cName = (data[r][0] || "").toString().trim();
        var crsName = (data[r][1] || "").toString().trim();
        var norm = normalizeCollegeName(cName);
        if (norm !== cName) {
          sheet.getRange(r + 1, 1).setValue(norm);
        }
        // Fix typo: DILOMA -> DIPLOMA
        if (crsName.indexOf("DILOMA") !== -1 || crsName.indexOf("diloma") !== -1) {
          var fixedCrs = crsName.replace(/DILOMA/ig, "DIPLOMA");
          sheet.getRange(r + 1, 2).setValue(fixedCrs);
          crsName = fixedCrs;
        }
        if (norm === "AMAMCHRC (BAMS)") hasAmamchrc = true;
        if (norm === "AMHMCH (BHMS)") hasAmhmch = true;
        if (norm === "AMSON (GNM)") hasAmson = true;
        if (norm === "AMPV (DIPLOMA)") hasAmpv = true;
        if (norm === "AMGOI" && (crsName === "B. TECH. COMPUTER SCIENCE AND ENGINEERING" || crsName === "B.Tech Computer Science & Engineering")) {
          hasAmgoiBtechCse = true;
        }
      }
      var tDate = todayFormatted();
      if (!hasAmamchrc) {
        sheet.appendRow(["AMAMCHRC (BAMS)", "B. A. M. S.", "5.5 Years", "Active", tDate]);
        sheet.appendRow(["AMAMCHRC (BAMS)", "BAMS", "5.5 Years", "Active", tDate]);
        sheet.appendRow(["AMAMCHRC (BAMS)", "Bachelor of Ayurvedic Medicine and Surgery (BAMS)", "5.5 Years", "Active", tDate]);
      }
      if (!hasAmhmch) {
        sheet.appendRow(["AMHMCH (BHMS)", "BHMS", "5.5 Years", "Active", tDate]);
        sheet.appendRow(["AMHMCH (BHMS)", "Bachelor of Homeopathic Medicine and Surgery (BHMS)", "5.5 Years", "Active", tDate]);
      }
      if (!hasAmson) {
        sheet.appendRow(["AMSON (GNM)", "G. N. M.", "3 Years", "Active", tDate]);
        sheet.appendRow(["AMSON (GNM)", "General Nursing and Midwifery (GNM)", "3 Years", "Active", tDate]);
      }
      if (!hasAmpv) {
        sheet.appendRow(["AMPV (DIPLOMA)", "DIPLOMA IN AIML", "3 Years", "Active", tDate]);
        sheet.appendRow(["AMPV (DIPLOMA)", "Diploma in Engineering", "3 Years", "Active", tDate]);
      }
      if (!hasAmgoiBtechCse) {
        sheet.appendRow(["AMGOI", "B. TECH. COMPUTER SCIENCE AND ENGINEERING", "4 Years", "Active", tDate]);
      }
    }
  } catch (e) {
    Logger.log("ensureCollegeCoursesSheet error: " + e.message);
  }
}

function repairCollegeNamesBamsBhms() {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var updatedApps = 0;
    var appDetails = [];

    // 1. Scan and update STUDENT_APPLICATIONS
    var appSheet = ss.getSheetByName("STUDENT_APPLICATIONS");
    if (appSheet) {
      var appData = appSheet.getDataRange().getValues();
      for (var i = 1; i < appData.length; i++) {
        var row = appData[i];
        if (!row[0] || row[0].toString().trim().toUpperCase() === "APP_ID") continue;
        var appId = row[0].toString().trim();
        var studentName = (row[2] || "").toString().trim();
        var currentCollege = (row[14] || "").toString().trim(); // Col O: index 14
        var normalized = normalizeCollegeName(currentCollege);

        if (normalized && normalized !== currentCollege) {
          appSheet.getRange(i + 1, 15).setValue(normalized);
          updatedApps++;
          appDetails.push({
            appId: appId,
            studentName: studentName,
            oldCollege: currentCollege,
            newCollege: normalized
          });
        }
      }
    }

    // 2. Scan and update COLLEGE_COURSES sheet
    ensureCollegeCoursesSheet();

    // 3. Also execute specific student updates
    var specRes = updateSpecificStudentCollegesAndCourses();

    // Clear stats cache
    clearCacheKeys(["dashStats_ALL", "dashStats_Active"]);

    Logger.log("repairCollegeNamesBamsBhms: updated " + updatedApps + " applications.");
    return {
      success: true,
      updatedCount: updatedApps,
      details: appDetails,
      specificUpdates: specRes ? specRes.details : [],
      message: "Successfully standardized college names (" + updatedApps + " updated) and updated target student records."
    };
  } catch (err) {
    Logger.log("repairCollegeNamesBamsBhms error: " + err.message);
    return { success: false, message: err.message };
  }
}

function updateSpecificStudentCollegesAndCourses() {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var appSheet = ss.getSheetByName("STUDENT_APPLICATIONS");
    var allotSheet = ss.getSheetByName("ROOM_ALLOTMENTS");
    if (!appSheet) return { success: false, message: "STUDENT_APPLICATIONS sheet not found." };

    var allotData = allotSheet ? allotSheet.getDataRange().getValues() : [];
    var appData = appSheet.getDataRange().getValues();

    // Map allotment ID -> App ID
    var allotToAppMap = {};
    for (var a = 1; a < allotData.length; a++) {
      var aId = (allotData[a][0] || "").toString().trim();
      var apId = (allotData[a][1] || "").toString().trim();
      if (aId && apId) {
        allotToAppMap[aId] = apId;
      }
    }

    var targets = [
      {
        namePattern: "janhavi",
        namePattern2: "jagtap",
        allotmentId: "ALLOT-2026-4067",
        newCollege: "AMAMCHRC (BAMS)",
        newCourse: "B. A. M. S."
      },
      {
        namePattern: "ashwini",
        namePattern2: "kamble",
        allotmentId: "ALLOT-2026-1528",
        newCollege: "AMSON (GNM)",
        newCourse: "G. N. M."
      },
      {
        namePattern: "sakshi",
        namePattern2: "bharmal",
        allotmentId: "",
        newCollege: "AMPV (DIPLOMA)",
        newCourse: "DIPLOMA IN AIML"
      },
      {
        namePattern: "swaranjali",
        namePattern2: "walake",
        allotmentId: "",
        newCollege: "AMPV (DIPLOMA)",
        newCourse: ""
      },
      {
        namePattern: "swaranjali",
        namePattern2: "chougale",
        allotmentId: "",
        newCollege: "AMGOI",
        newCourse: "B. TECH. COMPUTER SCIENCE AND ENGINEERING"
      }
    ];

    var results = [];

    targets.forEach(function(target) {
      var targetAppId = target.allotmentId ? allotToAppMap[target.allotmentId] : null;
      var updated = false;

      for (var i = 1; i < appData.length; i++) {
        var row = appData[i];
        if (!row[0] || row[0].toString().trim().toUpperCase() === "APP_ID") continue;

        var curAppId = row[0].toString().trim();
        var curName = (row[2] || "").toString().trim().toLowerCase();

        var isMatch = false;
        if (targetAppId && curAppId === targetAppId) {
          isMatch = true;
        } else if (curName.indexOf(target.namePattern) !== -1 && curName.indexOf(target.namePattern2) !== -1) {
          isMatch = true;
        }

        if (isMatch) {
          var rowNum = i + 1;
          if (target.newCourse) {
            appSheet.getRange(rowNum, 13).setValue(target.newCourse);  // Col M (13): COURSE
          }
          if (target.newCollege) {
            appSheet.getRange(rowNum, 15).setValue(target.newCollege); // Col O (15): COLLEGE_NAME
          }
          
          results.push({
            studentName: row[2],
            appId: curAppId,
            allotmentId: target.allotmentId || "-",
            newCollege: target.newCollege || (row[14] || ""),
            newCourse: target.newCourse || (row[12] || ""),
            status: "Updated"
          });
          updated = true;
        }
      }

      if (!updated) {
        results.push({
          target: target.namePattern + " " + target.namePattern2,
          allotmentId: target.allotmentId || "-",
          status: "Not found in applications"
        });
      }
    });

    // Scan all applications for "DILOMA" typo and raw "AMPV"
    for (var s = 1; s < appData.length; s++) {
      var sRow = appData[s];
      if (!sRow[0] || sRow[0].toString().trim().toUpperCase() === "APP_ID") continue;

      var sCol = (sRow[14] || "").toString().trim();
      var sCrs = (sRow[12] || "").toString().trim();
      var sRowNum = s + 1;

      // Fix raw AMPV -> AMPV (DIPLOMA)
      if (sCol.toLowerCase() === "ampv" || (sCol.toLowerCase().indexOf("ampv") !== -1 && sCol.toLowerCase().indexOf("diploma") === -1)) {
        appSheet.getRange(sRowNum, 15).setValue("AMPV (DIPLOMA)");
      }

      // Fix DILOMA typo in courses
      if (sCrs.indexOf("DILOMA") !== -1 || sCrs.indexOf("diloma") !== -1) {
        var correctedCrs = sCrs.replace(/DILOMA/ig, "DIPLOMA");
        appSheet.getRange(sRowNum, 13).setValue(correctedCrs);
      }
    }

    // Fix DILOMA typo and raw AMPV in COLLEGE_COURSES sheet
    var ccSheet = ss.getSheetByName("COLLEGE_COURSES");
    if (ccSheet) {
      var ccData = ccSheet.getDataRange().getValues();
      for (var c = 1; c < ccData.length; c++) {
        var crsVal = (ccData[c][1] || "").toString().trim();
        var colVal = (ccData[c][0] || "").toString().trim();
        if (crsVal.indexOf("DILOMA") !== -1 || crsVal.indexOf("diloma") !== -1) {
          ccSheet.getRange(c + 1, 2).setValue(crsVal.replace(/DILOMA/ig, "DIPLOMA"));
        }
        if (colVal.toLowerCase() === "ampv") {
          ccSheet.getRange(c + 1, 1).setValue("AMPV (DIPLOMA)");
        }
      }
    }

    ensureCollegeCoursesSheet();
    clearCacheKeys(["dashStats_ALL", "dashStats_Active"]);

    return {
      success: true,
      message: "Successfully updated student details and corrected course/college records.",
      details: results
    };
  } catch (err) {
    Logger.log("updateSpecificStudentCollegesAndCourses error: " + err.message);
    return { success: false, message: err.message };
  }
}

function getCollegeCourses() {
  try {
    ensureCollegeCoursesSheet();
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName("COLLEGE_COURSES");
    if (!sheet) return { success: true, data: { list: [], grouped: {} } };

    var data = sheet.getDataRange().getValues();
    var list = [];
    var grouped = {};

    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (!row[0] && !row[1]) continue;
      var college = (row[0] || "").toString().trim();
      var course = (row[1] || "").toString().trim();
      var duration = (row[2] || "").toString().trim();
      var status = (row[3] || "Active").toString().trim();
      if (!course) continue;

      var item = {
        rowIndex: i + 1,
        collegeName: college,
        courseName: course,
        duration: duration,
        status: status
      };
      list.push(item);

      if (!grouped[college]) grouped[college] = [];
      if (grouped[college].indexOf(course) === -1) {
        grouped[college].push(course);
      }
    }

    return { success: true, data: { list: list, grouped: grouped } };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function addCollegeCourse(payload) {
  try {
    if (!payload || !payload.collegeName || !payload.courseName) {
      return { success: false, message: "College name and Course name are required." };
    }
    ensureCollegeCoursesSheet();
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName("COLLEGE_COURSES");
    var college = payload.collegeName.toString().trim();
    var course = payload.courseName.toString().trim();
    var duration = (payload.duration || "4 Years").toString().trim();

    // Check duplicate
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if ((data[i][0] || "").toString().trim().toLowerCase() === college.toLowerCase() &&
          (data[i][1] || "").toString().trim().toLowerCase() === course.toLowerCase()) {
        return { success: false, message: 'Course "' + course + '" already exists for "' + college + '".' };
      }
    }

    sheet.appendRow([college, course, duration, "Active", todayFormatted()]);
    return { success: true, message: "Course added successfully." };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function deleteCollegeCourse(payload) {
  try {
    if (!payload || !payload.collegeName || !payload.courseName) {
      return { success: false, message: "College name and Course name are required." };
    }
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName("COLLEGE_COURSES");
    if (!sheet) return { success: false, message: "COLLEGE_COURSES sheet not found." };

    var college = payload.collegeName.toString().trim();
    var course = payload.courseName.toString().trim();
    var data = sheet.getDataRange().getValues();

    for (var i = data.length - 1; i >= 1; i--) {
      if ((data[i][0] || "").toString().trim().toLowerCase() === college.toLowerCase() &&
          (data[i][1] || "").toString().trim().toLowerCase() === course.toLowerCase()) {
        sheet.deleteRow(i + 1);
        return { success: true, message: "Course deleted successfully." };
      }
    }
    return { success: false, message: "Course not found." };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function getExistingStudentCoursesSummary() {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName("STUDENT_APPLICATIONS");
    if (!sheet) return { success: true, data: [] };

    var data = sheet.getDataRange().getValues();
    var courseCounts = {};

    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (!row[0] || row[0].toString().trim().toUpperCase() === "APP_ID") continue;
      var status = (row[19] || "").toString().trim();
      if (status.toLowerCase().indexOf("cancelled") !== -1 || status.toLowerCase().indexOf("disabled") !== -1) continue;

      var college = (row[14] || "").toString().trim() || "Unspecified College";
      var course = (row[12] || "").toString().trim() || "Unspecified Course";
      var key = college + "|||" + course;

      if (!courseCounts[key]) {
        courseCounts[key] = {
          collegeName: college,
          courseName: course,
          count: 0,
          sampleAppIds: []
        };
      }
      courseCounts[key].count++;
      if (courseCounts[key].sampleAppIds.length < 3) {
        courseCounts[key].sampleAppIds.push(row[0].toString().trim());
      }
    }

    var results = [];
    for (var k in courseCounts) {
      results.push(courseCounts[k]);
    }
    results.sort(function(a, b) {
      if (a.collegeName !== b.collegeName) return a.collegeName.localeCompare(b.collegeName);
      return b.count - a.count;
    });

    return { success: true, data: results };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function repairStudentCourses(mappings) {
  try {
    if (!mappings || !Array.isArray(mappings) || mappings.length === 0) {
      return { success: false, message: "No course repair mappings provided." };
    }
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var appSheet = ss.getSheetByName("STUDENT_APPLICATIONS");
    if (!appSheet) return { success: false, message: "STUDENT_APPLICATIONS sheet not found." };

    var data = appSheet.getDataRange().getValues();
    var updatedCount = 0;

    // Create lookup map: key = (college || "") + ":::" + oldCourse.toLowerCase()
    var map = {};
    for (var m = 0; m < mappings.length; m++) {
      var it = mappings[m];
      var oldC = (it.oldCourse || "").toString().trim().toLowerCase();
      var newC = (it.newCourse || "").toString().trim();
      var col = (it.collegeName || "").toString().trim().toLowerCase();
      if (oldC && newC) {
        if (col) {
          map[col + ":::" + oldC] = newC;
        }
        // General fallback
        map["*:::" + oldC] = newC;
      }
    }

    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (!row[0] || row[0].toString().trim().toUpperCase() === "APP_ID") continue;

      var curCollege = (row[14] || "").toString().trim().toLowerCase();
      var curCourse = (row[12] || "").toString().trim();
      var curCourseLower = curCourse.toLowerCase();

      var replacement = map[curCollege + ":::" + curCourseLower] || map["*:::" + curCourseLower];
      if (replacement && replacement !== curCourse) {
        appSheet.getRange(i + 1, 13).setValue(replacement); // Col M: COURSE (col 13)
        updatedCount++;
      }
    }

    clearCacheKeys(["dashStats_ALL", "dashStats_Active"]);
    return {
      success: true,
      message: "Successfully repaired " + updatedCount + " student course record(s)."
    };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function syncCoursesToGoogleForm() {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var coursesRes = getCollegeCourses();
    var grouped = (coursesRes.data && coursesRes.data.grouped) ? coursesRes.data.grouped : {};
    var colleges = Object.keys(grouped);

    var formUrl = "";
    try {
      formUrl = ss.getFormUrl();
    } catch (e) {
      Logger.log("getFormUrl error: " + e.message);
    }

    if (!formUrl) {
      // Return formatted instructions with copyable course lists
      return {
        success: true,
        isDirectSync: false,
        message: "No Google Form is directly linked to this Google Sheet via FormApp. However, the unique standardized College and Course structure has been generated below for configuring the form.",
        colleges: colleges,
        coursesGrouped: grouped
      };
    }

    // Direct sync if form is linked
    var form = FormApp.openByUrl(formUrl);
    var items = form.getItems();
    var collegeItemUpdated = false;
    var courseItemUpdated = false;

    for (var i = 0; i < items.length; i++) {
      var title = items[i].getTitle().toLowerCase();
      if (title.indexOf("college") !== -1 && (items[i].getType() === FormApp.ItemType.LIST || items[i].getType() === FormApp.ItemType.MULTIPLE_CHOICE)) {
        var dropCol = items[i].asListItem();
        var cChoices = colleges.map(function(c) { return dropCol.createChoice(c); });
        dropCol.setChoices(cChoices);
        collegeItemUpdated = true;
      }
      if ((title.indexOf("course") !== -1 || title.indexOf("branch") !== -1) && (items[i].getType() === FormApp.ItemType.LIST || items[i].getType() === FormApp.ItemType.MULTIPLE_CHOICE)) {
        var dropCourse = items[i].asListItem();
        // Flatten unique courses
        var allUniqueCourses = [];
        for (var cName in grouped) {
          for (var u = 0; u < grouped[cName].length; u++) {
            if (allUniqueCourses.indexOf(grouped[cName][u]) === -1) {
              allUniqueCourses.push(grouped[cName][u]);
            }
          }
        }
        allUniqueCourses.sort();
        var courseChoices = allUniqueCourses.map(function(cr) { return dropCourse.createChoice(cr); });
        dropCourse.setChoices(courseChoices);
        courseItemUpdated = true;
      }
    }

    return {
      success: true,
      isDirectSync: true,
      message: "Successfully synchronized unique options to Google Form! Updated: " +
        (collegeItemUpdated ? "College dropdown " : "") +
        (courseItemUpdated ? "Course dropdown " : ""),
      colleges: colleges,
      coursesGrouped: grouped
    };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ── 28. ADMISSION CANCELLATION PROCEDURE ───────────────────────

function previewStudentAdmissionCancellation(appId) {
  try {
    if (!appId) return { success: false, message: "Application ID is required." };
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var cleanAppId = appId.toString().trim();

    // 1. Student details from STUDENT_APPLICATIONS
    var appSheet = ss.getSheetByName("STUDENT_APPLICATIONS");
    var student = null;
    if (appSheet) {
      var appData = appSheet.getDataRange().getValues();
      for (var i = 1; i < appData.length; i++) {
        if (appData[i][0] && appData[i][0].toString().trim() === cleanAppId) {
          student = {
            appId: cleanAppId,
            studentName: (appData[i][2] || "").toString().trim(),
            contactNumber: (appData[i][6] || "").toString().trim(),
            collegeName: (appData[i][14] || "").toString().trim(),
            course: (appData[i][12] || "").toString().trim(),
            status: (appData[i][19] || "").toString().trim(),
            roomType: (appData[i][18] || "").toString().trim()
          };
          break;
        }
      }
    }
    if (!student) return { success: false, message: "Student application ID not found: " + cleanAppId };

    // 2. Allotment info
    var allotSheet = ss.getSheetByName("ROOM_ALLOTMENTS");
    var activeAllotment = null;
    if (allotSheet) {
      var allotData = allotSheet.getDataRange().getValues();
      for (var a = 1; a < allotData.length; a++) {
        if (allotData[a][1] && allotData[a][1].toString().trim() === cleanAppId) {
          var aSt = (allotData[a][9] || "").toString().trim().toLowerCase();
          if (aSt === "active") {
            activeAllotment = {
              allotmentId: (allotData[a][0] || "").toString().trim(),
              roomId: (allotData[a][3] || "").toString().trim(),
              roomNumber: (allotData[a][4] || "").toString().trim(),
              roomType: (allotData[a][5] || "").toString().trim(),
              allotmentDate: formatDateValue(allotData[a][6])
            };
            break;
          }
        }
      }
    }

    // 3. Ledger summary
    var ldgSheet = ss.getSheetByName("STUDENT_FEE_LEDGER");
    var totalDemanded = 0;
    var totalPaid = 0;
    var totalBalance = 0;
    var unpaidDuesCount = 0;
    if (ldgSheet) {
      var ldgData = ldgSheet.getDataRange().getValues();
      for (var l = 1; l < ldgData.length; l++) {
        if (ldgData[l][1] && ldgData[l][1].toString().trim() === cleanAppId) {
          var lSt = (ldgData[l][12] || "").toString().trim().toLowerCase();
          if (lSt !== "cancelled") {
            var appAmt = parseFloat(ldgData[l][8]) || 0;
            var paidAmt = parseFloat(ldgData[l][9]) || 0;
            var balAmt = parseFloat(ldgData[l][10]) || 0;
            totalDemanded += appAmt;
            totalPaid += paidAmt;
            totalBalance += balAmt;
            if (balAmt > 0) unpaidDuesCount++;
          }
        }
      }
    }

    // 4. Receipts summary
    var rcptSheet = ss.getSheetByName("FEE_RECEIPTS");
    var receiptsCount = 0;
    var totalReceiptsAmount = 0;
    if (rcptSheet) {
      var rcptData = rcptSheet.getDataRange().getValues();
      for (var r = 1; r < rcptData.length; r++) {
        if (rcptData[r][2] && rcptData[r][2].toString().trim() === cleanAppId) {
          var rSt = (rcptData[r][13] || "Active").toString().trim().toLowerCase();
          if (rSt !== "cancelled") {
            receiptsCount++;
            totalReceiptsAmount += (parseFloat(rcptData[r][6]) || 0);
          }
        }
      }
    }

    return {
      success: true,
      data: {
        student: student,
        allotment: activeAllotment,
        ledger: {
          totalDemanded: Math.round(totalDemanded * 100) / 100,
          totalPaid: Math.round(totalPaid * 100) / 100,
          totalBalance: Math.round(totalBalance * 100) / 100,
          unpaidCount: unpaidDuesCount
        },
        receipts: {
          count: receiptsCount,
          totalAmount: Math.round(totalReceiptsAmount * 100) / 100
        }
      }
    };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function cancelStudentAdmission(payload) {
  if (!payload || !payload.appId) {
    return { success: false, message: "Application ID is required." };
  }
  var appId = payload.appId.toString().trim();
  var reason = (payload.reason || "Student cancelled admission / dropped out").toString().trim();
  var cancelDate = payload.cancellationDate || todayFormatted();
  var refundAmount = parseFloat(payload.refundAmount) || 0;
  var refundMode = payload.refundMode || "";
  var refundRemarks = payload.refundRemarks || "";
  var releaseRoom = payload.releaseRoom !== undefined ? !!payload.releaseRoom : true;
  var cancelDues = payload.cancelDues !== undefined ? !!payload.cancelDues : true;
  var disableLogin = payload.disableLogin !== undefined ? !!payload.disableLogin : true;
  var adminUser = payload.adminUser || (Session.getActiveUser() ? Session.getActiveUser().getEmail() : "") || "Administrator";

  var lock = LockService.getScriptLock();
  var lockAcquired = false;
  try {
    lockAcquired = lock.tryLock(30000);
  } catch (lErr) {
    Logger.log("Lock acquisition warning: " + lErr.message);
  }

  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var roomsReleasedList = [];

    // 1. Release Room Inventory & update ROOM_ALLOTMENTS
    var allotSheet = ss.getSheetByName("ROOM_ALLOTMENTS");
    var roomsSheet = ss.getSheetByName("ROOMS");
    if (allotSheet && releaseRoom) {
      var allotData = allotSheet.getDataRange().getValues();
      for (var a = 1; a < allotData.length; a++) {
        var aRow = allotData[a];
        if (!aRow || !aRow[0] || aRow[0].toString().trim().toUpperCase() === "ALLOTMENT_ID") continue;
        var aAppId = (aRow[1] || "").toString().trim();
        if (aAppId === appId) {
          var aStatus = (aRow[9] || "").toString().trim().toLowerCase();
          var aRoomId = (aRow[3] || "").toString().trim();
          var aRoomNum = (aRow[4] || "").toString().trim();

          if (aStatus === "active") {
            if (roomsSheet) {
              var roomsData = roomsSheet.getDataRange().getValues();
              for (var rm = 1; rm < roomsData.length; rm++) {
                var curRmId = (roomsData[rm][0] || "").toString().trim();
                var curRmNum = (roomsData[rm][1] || "").toString().trim();
                if ((aRoomId && curRmId === aRoomId) || (aRoomNum && curRmNum === aRoomNum)) {
                  var curOcc = parseInt(roomsData[rm][5]) || 0;
                  var newOcc = Math.max(0, curOcc - 1);
                  roomsSheet.getRange(rm + 1, 6).setValue(newOcc);
                  roomsData[rm][5] = newOcc;
                  roomsReleasedList.push(curRmNum || curRmId);
                  break;
                }
              }
            }
          }
          allotSheet.getRange(a + 1, 10).setValue("Admission Cancelled"); // Col J: STATUS
          allotSheet.getRange(a + 1, 8).setValue(cancelDate); // Col H: VACATING_DATE
        }
      }
    }

    // 2. Cancel Outstanding Ledger Dues
    var duesCancelledCount = 0;
    var ldgSheet = ss.getSheetByName("STUDENT_FEE_LEDGER");
    if (ldgSheet && cancelDues) {
      var ldgData = ldgSheet.getDataRange().getValues();
      for (var l = 1; l < ldgData.length; l++) {
        var lRow = ldgData[l];
        if (!lRow || !lRow[0] || lRow[0].toString().trim().toUpperCase() === "LEDGER_ID") continue;
        var lAppId = (lRow[1] || "").toString().trim();
        if (lAppId === appId) {
          var lStatus = (lRow[12] || "").toString().trim().toLowerCase();
          if (lStatus !== "paid" && lStatus !== "cancelled") {
            duesCancelledCount++;
            ldgSheet.getRange(l + 1, 11).setValue(0); // Col K: BALANCE to 0
            ldgSheet.getRange(l + 1, 13).setValue("Cancelled"); // Col M: STATUS
          }
        }
      }
    }

    // 3. Update STUDENT_APPLICATIONS row
    var appSheet = ss.getSheetByName("STUDENT_APPLICATIONS");
    var studentFoundName = "";
    if (appSheet) {
      var appData = appSheet.getDataRange().getValues();
      for (var p = 1; p < appData.length; p++) {
        var pRow = appData[p];
        if (!pRow || !pRow[0] || pRow[0].toString().trim().toUpperCase() === "APP_ID") continue;
        if (pRow[0].toString().trim() === appId) {
          studentFoundName = (pRow[2] || "").toString().trim();
          appSheet.getRange(p + 1, 20).setValue("Admission Cancelled"); // Col T: STATUS
          var curRem = (pRow[22] || "").toString().trim();
          var cancelNote = "Admission Cancelled on " + cancelDate + " (" + reason + ")";
          if (refundAmount > 0) {
            cancelNote += " [Refund: Rs." + refundAmount + " via " + refundMode + (refundRemarks ? " - " + refundRemarks : "") + "]";
          }
          appSheet.getRange(p + 1, 23).setValue((curRem ? curRem + " | " : "") + cancelNote); // Col W: REMARKS
          break;
        }
      }
    }

    // 4. Disable USERS account
    if (disableLogin) {
      var userSheet = ss.getSheetByName("USERS");
      if (userSheet) {
        var uData = userSheet.getDataRange().getValues();
        for (var u = 1; u < uData.length; u++) {
          if (uData[u][0] && uData[u][0].toString().trim() === appId) {
            userSheet.getRange(u + 1, 6).setValue("Disabled"); // Col F: STATUS
          }
        }
      }
    }

    // 5. Audit Log
    ensureRollbackAuditLogsSheet();
    var auditSheet = ss.getSheetByName("ROLLBACK_AUDIT_LOGS");
    if (auditSheet) {
      var logId = "ADM-CNC-" + Utilities.formatDate(new Date(), Session.getScriptTimeZone() || "GMT+5:30", "yyyyMMdd-HHmmss");
      auditSheet.appendRow([
        logId,
        Utilities.formatDate(new Date(), Session.getScriptTimeZone() || "GMT+5:30", "yyyy-MM-dd HH:mm:ss"),
        adminUser,
        "Admission Cancelled: " + reason + (refundAmount > 0 ? " | Refund: Rs." + refundAmount : ""),
        appId,
        studentFoundName || appId,
        roomsReleasedList.length > 0 ? roomsReleasedList.join(", ") + " released" : "No room occupied",
        refundAmount > 0 ? "Refunded Rs." + refundAmount : "No refund",
        duesCancelledCount + " due(s) cancelled"
      ]);
    }

    clearCacheKeys(["dashStats_ALL", "dashStats_Active"]);

    return {
      success: true,
      message: "Admission cancelled successfully for " + (studentFoundName || appId) + ". " +
               (roomsReleasedList.length > 0 ? "Room " + roomsReleasedList.join(", ") + " bed released. " : "") +
               (duesCancelledCount > 0 ? duesCancelledCount + " unpaid ledger dues cancelled." : "")
    };
  } catch (err) {
    return { success: false, message: "Error cancelling admission: " + err.message };
  } finally {
    if (lockAcquired) {
      try { lock.releaseLock(); } catch (e) {}
    }
  }
}

function cancelTargetStudentsAdmissions() {
  var targetStudents = [
    { appId: "APP-2026-7068", name: "SHINDE DHANSHREE SHIVAJI" },
    { appId: "APP-2026-1287", name: "Sneha Hariba Kadam" },
    { appId: "APP-2026-2318", name: "Patil Yugandhara Indrajeet" }
  ];

  var results = [];
  for (var i = 0; i < targetStudents.length; i++) {
    var item = targetStudents[i];
    var res = cancelStudentAdmission({
      appId: item.appId,
      reason: "Admission cancelled as requested by student (" + item.name + ")",
      cancellationDate: todayFormatted(),
      refundAmount: 0,
      releaseRoom: true,
      cancelDues: true,
      disableLogin: true,
      adminUser: "System Migration"
    });
    results.push({ appId: item.appId, name: item.name, result: res });
  }
  return { success: true, details: results };
}

// ═══════════════════════════════════════════════════════════════
// ── SUPABASE CLOUD DATA MIGRATION ENGINE ───────────────────────
// ═══════════════════════════════════════════════════════════════

function syncAllDataToSupabase() {
  var SUPABASE_URL = "https://bhfiyrorfxvabquxmeiv.supabase.co";
  var SUPABASE_KEY = "sb_publishable_woMsdVpSPa7mKfHOeGGK8Q_paTZlW3K";
  var headers = {
    "Content-Type": "application/json",
    "apikey": SUPABASE_KEY,
    "Authorization": "Bearer " + SUPABASE_KEY,
    "Prefer": "resolution=merge-duplicates"
  };

  function deduplicateByField(rows, keyField) {
    var map = {};
    var result = [];
    (rows || []).forEach(function(r) {
      var val = (r[keyField] || "").toString().trim();
      if (val && !map[val]) {
        map[val] = true;
        result.push(r);
      }
    });
    return result;
  }

  function sendBatch(endpoint, rows, conflictCol) {
    if (!rows || rows.length === 0) return 0;
    
    // Deduplicate array by conflict column
    if (conflictCol) {
      rows = deduplicateByField(rows, conflictCol);
    }

    var batchSize = 50;
    var count = 0;
    var urlTarget = SUPABASE_URL + "/rest/v1/" + endpoint + (conflictCol ? "?on_conflict=" + conflictCol : "");

    for (var i = 0; i < rows.length; i += batchSize) {
      var chunk = rows.slice(i, i + batchSize);
      var opts = {
        method: "post",
        headers: headers,
        payload: JSON.stringify(chunk),
        muteHttpExceptions: true
      };
      var res = UrlFetchApp.fetch(urlTarget, opts);
      var code = res.getResponseCode();

      if (code >= 200 && code < 300) {
        count += chunk.length;
      } else {
        Logger.log("Batch error on " + endpoint + " (" + code + "): " + res.getContentText() + ". Retrying rows individually...");
        // Fallback: send row by row individually so valid rows succeed
        for (var j = 0; j < chunk.length; j++) {
          var singleRow = [chunk[j]];
          var singleOpts = {
            method: "post",
            headers: headers,
            payload: JSON.stringify(singleRow),
            muteHttpExceptions: true
          };
          var singleRes = UrlFetchApp.fetch(urlTarget, singleOpts);
          if (singleRes.getResponseCode() >= 200 && singleRes.getResponseCode() < 300) {
            count++;
          } else {
            Logger.log("Single row sync error on " + endpoint + ": " + singleRes.getContentText());
          }
        }
      }
    }
    return count;
  }

  var stats = {};

  try {
    // 1. Sync Rooms
    var rSheet = getSheet("ROOMS");
    if (rSheet) {
      var rData = rSheet.getDataRange().getValues();
      var roomRows = [];
      for (var i = 1; i < rData.length; i++) {
        var r = rData[i];
        if (!r[0] || r[0].toString().trim().toUpperCase() === "ROOM_ID") continue;
        var rNum = (r[1] || "").toString().trim();
        if (!rNum) continue;
        roomRows.push({
          room_number: rNum,
          floor: (r[2] || "").toString().trim() || "Ground Floor",
          room_type: (r[3] || "").toString().trim() || "3-Bed Attached Bath",
          capacity: parseInt(r[4]) || 3,
          status: (r[6] || "Active").toString().trim()
        });
      }
      stats.rooms = sendBatch("rooms", roomRows, "room_number");
    }

    // 2. Sync Room Types
    var rtSheet = getSheet("ROOM_TYPES");
    if (rtSheet) {
      var rtData = rtSheet.getDataRange().getValues();
      var rtRows = [];
      for (var i = 1; i < rtData.length; i++) {
        var rt = rtData[i];
        if (!rt[0]) continue;
        var tName = (rt[1] || "").toString().trim();
        if (!tName) continue;
        rtRows.push({
          type_name: tName,
          base_fee: parseFloat(rt[2]) || 0,
          description: (rt[3] || "").toString().trim(),
          status: (rt[4] || "Active").toString().trim()
        });
      }
      stats.roomTypes = sendBatch("room_types", rtRows, "type_name");
    }

    // 3. Sync College Courses
    var ccSheet = getSheet("COLLEGE_COURSES");
    if (ccSheet) {
      var ccData = ccSheet.getDataRange().getValues();
      var ccRows = [];
      for (var i = 1; i < ccData.length; i++) {
        var cc = ccData[i];
        if (!cc[0] && !cc[1]) continue;
        var col = (cc[0] || "").toString().trim();
        var crs = (cc[1] || "").toString().trim();
        if (!col || !crs) continue;
        ccRows.push({
          college_name: col,
          course_name: crs,
          duration: (cc[2] || "4 Years").toString().trim(),
          status: (cc[3] || "Active").toString().trim()
        });
      }
      stats.collegeCourses = sendBatch("college_courses", ccRows, null);
    }

    // 4. Sync Bank Accounts
    var baSheet = getSheet("BANK_ACCOUNTS");
    if (baSheet) {
      var baData = baSheet.getDataRange().getValues();
      var baRows = [];
      for (var i = 1; i < baData.length; i++) {
        var ba = baData[i];
        if (!ba[0]) continue;
        var accName = (ba[1] || "").toString().trim();
        if (!accName) continue;
        baRows.push({
          account_name: accName,
          bank_name: (ba[2] || "").toString().trim(),
          account_number: (ba[3] || "").toString().trim(),
          ifsc_branch: (ba[4] || "").toString().trim(),
          account_type: (ba[5] || "Current Account").toString().trim(),
          status: (ba[6] || "Active").toString().trim()
        });
      }
      stats.bankAccounts = sendBatch("bank_accounts", baRows, null);
    }

    // 5. Sync Students (STUDENT_APPLICATIONS & Form Responses)
    var ss = getSpreadsheet();
    var allSheets = ss.getSheets();
    var sRows = [];

    allSheets.forEach(function(sheet) {
      var sheetName = sheet.getName();
      var isAppSheet = (sheetName === "STUDENT_APPLICATIONS");
      var isFormSheet = (sheetName.indexOf("Form") !== -1 || sheetName.indexOf("Responses") !== -1);

      if (!isAppSheet && !isFormSheet) return;

      var sData = sheet.getDataRange().getValues();
      if (sData.length <= 1) return;

      if (isAppSheet) {
        for (var i = 1; i < sData.length; i++) {
          var s = sData[i];
          if (!s[0] || s[0].toString().trim().toUpperCase() === "APP_ID") continue;
          var appId = s[0].toString().trim();
          sRows.push({
            app_id: appId,
            full_name: (s[2] || "").toString().trim(),
            father_name: (s[3] || "").toString().trim(),
            mother_name: (s[4] || "").toString().trim(),
            dob: (s[5] || "").toString().trim(),
            contact_number: (s[6] || "").toString().trim(),
            parent_contact: (s[7] || "").toString().trim(),
            email: (s[8] || "").toString().trim(),
            address: (s[9] || "").toString().trim(),
            city: (s[10] || "").toString().trim(),
            state: (s[11] || "").toString().trim(),
            course: (s[12] || "").toString().trim(),
            year_of_study: (s[13] || "").toString().trim(),
            college_name: (s[14] || "").toString().trim(),
            aadhar_number: (s[15] || "").toString().trim(),
            emergency_contact_name: (s[16] || "").toString().trim(),
            emergency_contact_number: (s[17] || "").toString().trim(),
            room_type: (s[18] || "").toString().trim(),
            status: (s[19] || "Pending").toString().trim(),
            reviewed_by: (s[20] || "").toString().trim(),
            review_date: (s[21] || "").toString().trim(),
            remarks: (s[22] || "").toString().trim(),
            academic_year: (s[23] || "2026-27").toString().trim()
          });
        }
      } else if (isFormSheet) {
        var headers = sData[0].map(function(h){ return (h || "").toString().trim(); });
        var cleanHeader = function(str) { return str.toLowerCase().replace(/[^a-z0-9]/g, ""); };
        var getColVal = function(row, keys) {
          var cleanedKeys = keys.map(cleanHeader);
          for (var c = 0; c < headers.length; c++) {
            if (cleanedKeys.indexOf(cleanHeader(headers[c])) !== -1) {
              return (row[c] || "").toString().trim();
            }
          }
          return "";
        };

        for (var i = 1; i < sData.length; i++) {
          var row = sData[i];
          if (!row || row.length === 0) continue;
          var sName = getColVal(row, ["studentname", "nameofstudent", "name", "fullname", "student"]);
          if (!sName) continue;

          var contact = getColVal(row, ["contactnumber", "studentcontactnumber", "mobile", "mobileno", "phone"]);
          var generatedAppId = "APP-2026-" + Math.floor(1000 + Math.random() * 9000);

          var exists = sRows.some(function(existing) {
            return existing.full_name.toLowerCase() === sName.toLowerCase() || (contact && existing.contact_number === contact);
          });
          if (exists) continue;

          sRows.push({
            app_id: generatedAppId,
            full_name: sName,
            father_name: getColVal(row, ["fathername", "fathersname", "father"]),
            mother_name: getColVal(row, ["mothername", "mothersname", "mother"]),
            dob: getColVal(row, ["dateofbirth", "dob", "birthdate"]),
            contact_number: contact,
            parent_contact: getColVal(row, ["parentcontact", "parentcontactnumber", "parentmobile", "fathercontact"]),
            email: getColVal(row, ["email", "emailaddress", "emailid"]),
            address: getColVal(row, ["address", "permanentaddress", "residenceaddress"]),
            city: getColVal(row, ["city", "town"]),
            state: getColVal(row, ["state", "region"]) || "Maharashtra",
            course: getColVal(row, ["course", "branch", "stream", "department"]),
            year_of_study: getColVal(row, ["yearofstudy", "year", "currentyear"]),
            college_name: normalizeCollegeName(getColVal(row, ["collegename", "college", "institutename"])),
            aadhar_number: getColVal(row, ["aadharnumber", "aadharcardno", "aadhar"]),
            emergency_contact_name: getColVal(row, ["emergencycontactname", "emergencyname"]),
            emergency_contact_number: getColVal(row, ["emergencycontactnumber", "emergencycontact"]),
            room_type: getColVal(row, ["roomtypepreference", "roompreference", "roomtype"]) || "Classic Tripple",
            status: "Pending",
            reviewed_by: "",
            review_date: "",
            remarks: "Imported from Google Form Response",
            academic_year: "2026-27"
          });
        }
      }
    });

    if (sRows.length > 0) {
      stats.students = sendBatch("students", sRows, "app_id");
    }

    // 6. Sync Fee Receipts
    var frSheet = getSheet("FEE_RECEIPTS");
    if (frSheet) {
      var frData = frSheet.getDataRange().getValues();
      var frRows = [];
      for (var i = 1; i < frData.length; i++) {
        var fr = frData[i];
        if (!fr[0] || fr[0].toString().trim().toUpperCase() === "RECEIPT_ID") continue;
        var rcptId = fr[0].toString().trim();
        frRows.push({
          receipt_id: rcptId,
          app_id: (fr[2] || "").toString().trim() || null,
          student_name: (fr[3] || "").toString().trim(),
          room_number: (fr[4] || "").toString().trim(),
          fee_type: (fr[5] || "").toString().trim(),
          fee_month: (fr[6] || "").toString().trim(),
          amount_paid: parseFloat(fr[7]) || 0,
          payment_mode: (fr[8] || "Cash").toString().trim(),
          transaction_id: (fr[9] || "").toString().trim(),
          remarks: (fr[10] || "").toString().trim(),
          collected_by: (fr[11] || "Admin").toString().trim(),
          status: (fr[12] || "Active").toString().trim(),
          recon_status: ((fr[8] || "").toString().trim().toLowerCase() === "cash" ? "Cash" : "Unreconciled"),
          recon_bank: null,
          recon_ref_no: null,
          academic_year: (fr[17] || "2026-27").toString().trim()
        });
      }
      stats.feeReceipts = sendBatch("fee_receipts", frRows, "receipt_id");
    }

    // 7. Sync Student Fee Ledger
    var flSheet = getSheet("STUDENT_FEES_LEDGER");
    if (flSheet) {
      var flData = flSheet.getDataRange().getValues();
      var flRows = [];
      for (var i = 1; i < flData.length; i++) {
        var fl = flData[i];
        if (!fl[0] || fl[0].toString().trim().toUpperCase() === "LEDGER_ID") continue;
        var ledId = fl[0].toString().trim();
        flRows.push({
          ledger_id: ledId,
          app_id: (fl[1] || "").toString().trim() || null,
          student_name: (fl[2] || "").toString().trim(),
          head_name: (fl[3] || "").toString().trim(),
          applicable_month: (fl[4] || "").toString().trim(),
          academic_year: (fl[5] || "2026-27").toString().trim(),
          applicable_amount: parseFloat(fl[7]) || 0,
          paid_amount: parseFloat(fl[8]) || 0,
          balance: parseFloat(fl[9]) || 0,
          status: (fl[10] || "Pending").toString().trim()
        });
      }
      stats.ledger = sendBatch("student_fee_ledger", flRows, "ledger_id");
    }

    return {
      success: true,
      message: "Data successfully synchronized to Supabase Cloud!",
      stats: stats
    };
  } catch (err) {
    return { success: false, message: "Sync error: " + err.message };
  }
}

