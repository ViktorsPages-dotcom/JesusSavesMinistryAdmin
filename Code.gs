// ============================================================
// Jesus Saves Ministry — Google Apps Script Backend (FIXED)
// ============================================================
// COMMON REASONS DATA DOESN'T ARRIVE:
//
//  ❌ BUG 1: Old deployment still active — every code change needs
//            a NEW deployment (not editing the existing one).
//  ❌ BUG 2: "Execute as: Me" not selected during deployment.
//  ❌ BUG 3: "Who has access: Anyone" not selected.
//  ❌ BUG 4: SHEET_ID is wrong or still the placeholder text.
//  ❌ BUG 5: You copied the /dev URL instead of the /exec URL.
//
// HOW TO DEPLOY CORRECTLY — read every step:
//  1. Open https://script.google.com
//  2. Paste this ENTIRE file (replace everything in the editor)
//  3. Change SHEET_ID below to your real Google Sheet ID
//     (the long string in the Sheet URL:
//      docs.google.com/spreadsheets/d/ >>>THIS PART<<< /edit)
//  4. Save (Ctrl+S or floppy disk icon)
//  5. Click Deploy → New Deployment   ← ALWAYS "New", never "Manage existing"
//  6. Click the gear icon ⚙ → select Web app
//  7. Fill in:
//       Description     → anything e.g. "v2"
//       Execute as      → Me  (your Google account)
//       Who has access  → Anyone
//  8. Click Deploy → Authorize → Allow all permissions
//  9. COPY the Web app URL  (ends in /exec, NOT /dev)
// 10. Paste that URL in BOTH index.html and admin.html:
//       const scriptURL = "PASTE_HERE";
// 11. TEST: open the /exec URL in your browser — you should see:
//       {"status":"ok","message":"Jesus Saves Ministry API is running."}
//     If you see an error page → permissions are wrong, redo step 7-8.
//
// QUICK DIAGNOSTIC: run testSheetAccess() inside the editor to
// confirm your Sheet ID is correct before deploying.
// ============================================================

const SHEET_ID     = 'YOUR_GOOGLE_SHEET_ID_HERE'; // ← REPLACE THIS
const DRIVE_FOLDER = 'JSM Payment Proofs';

// ── doPost: receives all POST requests from the website ──────
function doPost(e) {
  try {
    const raw  = e.postData ? e.postData.contents : '{}';
    const data = JSON.parse(raw);
    const action = data.action || 'register';

    let result;
    switch (action) {
      case 'register':        result = handleRegistration(data); break;
      case 'saveAttendance':  result = handleAttendance(data);   break;
      case 'addVisitor':      result = handleVisitor(data);      break;
      default:                result = { success: false, message: 'Unknown action: ' + action };
    }

    // View these logs inside Apps Script: View → Logs (or Ctrl+Enter)
    console.log('doPost action:', action, '| result:', JSON.stringify(result));

    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    console.error('doPost error:', err.toString());
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ── doGet: browser test + fetch members ──────────────────────
function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) ? e.parameter.action : '';

  if (action === 'members') {
    return ContentService
      .createTextOutput(JSON.stringify(getMembers()))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // Default: simple OK response — paste URL in browser to test
  return ContentService
    .createTextOutput(JSON.stringify({
      status: 'ok',
      message: 'Jesus Saves Ministry API is running.'
    }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
//  REGISTRATION  —  called from index.html
// ============================================================
function handleRegistration(data) {
  const ss = SpreadsheetApp.openById(SHEET_ID);

  let sheet = ss.getSheetByName('Members');
  if (!sheet) {
    sheet = ss.insertSheet('Members');
    const header = ['ID','Timestamp','Surname','First Name','Middle Name',
                    'Email','Contact','Member Type','Payment Proof URL','Status'];
    sheet.appendRow(header);
    sheet.getRange(1, 1, 1, header.length)
      .setFontWeight('bold')
      .setBackground('#1e3a5f')
      .setFontColor('#ffffff');
    sheet.setFrozenRows(1);
  }

  // Upload payment proof screenshot to Google Drive
  let fileUrl = '(no file uploaded)';
  if (data.fileData && data.fileData.length > 0) {
    try {
      const folder = getOrCreateFolder(DRIVE_FOLDER);
      const bytes  = Utilities.base64Decode(data.fileData);
      const blob   = Utilities.newBlob(
        bytes,
        data.fileType || 'image/jpeg',
        data.fileName || 'proof.jpg'
      );
      const file = folder.createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      fileUrl = file.getUrl();
    } catch (err) {
      fileUrl = 'Upload error: ' + err.toString();
      console.error('Drive upload error:', err.toString());
    }
  }

  const id = 'M' + new Date().getTime();
  sheet.appendRow([
    id,
    new Date().toLocaleString('en-PH'),
    data.surname    || '',
    data.firstname  || '',
    data.middlename || '',
    data.email      || '',
    data.contact    || '',
    data.memberType || 'Church Member',
    fileUrl,
    'Pending Verification'
  ]);

  try { sheet.autoResizeColumns(1, 10); } catch(e) {}

  return { success: true, message: 'Registration saved.', id: id };
}

// ============================================================
//  ATTENDANCE  —  called from admin.html "Save to Google Sheet"
// ============================================================
function handleAttendance(data) {
  const ss = SpreadsheetApp.openById(SHEET_ID);

  // Summary row
  let sheet = ss.getSheetByName('Attendance');
  if (!sheet) {
    sheet = ss.insertSheet('Attendance');
    const header = ['Date','Members Present','Visitors','Total','Rate (%)','Saved At'];
    sheet.appendRow(header);
    sheet.getRange(1,1,1,header.length)
      .setFontWeight('bold')
      .setBackground('#1e3a5f')
      .setFontColor('#ffffff');
    sheet.setFrozenRows(1);
  }

  sheet.appendRow([
    data.date           || new Date().toLocaleDateString('en-PH'),
    data.membersPresent || 0,
    data.visitors       || 0,
    data.total          || 0,
    (data.rate || 0) + '%',
    new Date().toLocaleString('en-PH')
  ]);

  // Per-person detail rows
  if (Array.isArray(data.details) && data.details.length > 0) {
    let detailSheet = ss.getSheetByName('Attendance Details');
    if (!detailSheet) {
      detailSheet = ss.insertSheet('Attendance Details');
      const dHeader = ['Date','Name','Member Type','Status'];
      detailSheet.appendRow(dHeader);
      detailSheet.getRange(1,1,1,dHeader.length)
        .setFontWeight('bold')
        .setBackground('#1e3a5f')
        .setFontColor('#ffffff');
      detailSheet.setFrozenRows(1);
    }

    const date = data.date || new Date().toLocaleDateString('en-PH');
    const rows = data.details.map(d => [
      date,
      d.name   || '',
      d.type   || '',
      d.status || ''
    ]);
    detailSheet.getRange(
      detailSheet.getLastRow() + 1, 1, rows.length, 4
    ).setValues(rows);
  }

  try { sheet.autoResizeColumns(1, 6); } catch(e) {}
  return { success: true, message: 'Attendance saved.' };
}

// ============================================================
//  VISITOR  —  called from admin.html "Add Visitor"
// ============================================================
function handleVisitor(data) {
  const ss = SpreadsheetApp.openById(SHEET_ID);

  let sheet = ss.getSheetByName('Visitors');
  if (!sheet) {
    sheet = ss.insertSheet('Visitors');
    const header = ['Date','Visitor Name','Contact','Added At'];
    sheet.appendRow(header);
    sheet.getRange(1,1,1,header.length)
      .setFontWeight('bold')
      .setBackground('#7b3fa0')
      .setFontColor('#ffffff');
    sheet.setFrozenRows(1);
  }

  sheet.appendRow([
    data.date    || new Date().toLocaleDateString('en-PH'),
    data.name    || '',
    data.contact || '',
    new Date().toLocaleString('en-PH')
  ]);

  return { success: true, message: 'Visitor saved.' };
}

// ============================================================
//  GET MEMBERS  —  GET ?action=members
// ============================================================
function getMembers() {
  try {
    const ss    = SpreadsheetApp.openById(SHEET_ID);
    const sheet = ss.getSheetByName('Members');
    if (!sheet) return { success: true, members: [] };

    const rows = sheet.getDataRange().getValues();
    if (rows.length <= 1) return { success: true, members: [] };

    const [, ...dataRows] = rows;
    const members = dataRows.map(row => ({
      id:         String(row[0] || ''),
      surname:    String(row[2] || ''),
      firstname:  String(row[3] || ''),
      middlename: String(row[4] || ''),
      fullname:   [row[3], row[4], row[2]].filter(Boolean).join(' '),
      email:      String(row[5] || ''),
      contact:    String(row[6] || ''),
      type:       String(row[7] || 'Church Member'),
      status:     String(row[9] || '')
    }));

    return { success: true, members: members };
  } catch (err) {
    console.error('getMembers error:', err.toString());
    return { success: false, message: err.toString(), members: [] };
  }
}

// ============================================================
//  HELPERS
// ============================================================
function getOrCreateFolder(name) {
  const folders = DriveApp.getFoldersByName(name);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(name);
}

// ── Run this manually inside the editor to verify Sheet ID ──
function testSheetAccess() {
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    Logger.log('✅ Sheet found: ' + ss.getName());
    Logger.log('Tabs: ' + ss.getSheets().map(s => s.getName()).join(', '));
  } catch (err) {
    Logger.log('❌ Error: ' + err.toString());
    Logger.log('Fix: Make sure SHEET_ID is the correct value from your Sheet URL.');
  }
}

// ── Run this to manually simulate a registration (for testing) ──
function testRegistration() {
  const fakeData = {
    action:     'register',
    surname:    'TestSurname',
    firstname:  'TestFirst',
    middlename: '',
    email:      'test@example.com',
    contact:    '09171234567',
    memberType: 'Church Member',
    fileData:   '',
    fileName:   '',
    fileType:   ''
  };
  const result = handleRegistration(fakeData);
  Logger.log('Test result: ' + JSON.stringify(result));
}
