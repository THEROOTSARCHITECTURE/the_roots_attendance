// The Roots Attendance — Google Apps Script backend
// Paste into Extensions → Apps Script of the HR sheet, run setup() once, then Deploy → Web app.

// ===================== CONFIG =====================
const SHEET_ID      = '1B33m16hD0E7toH6GoNcNWGuQhyfb1ds03IVaLpo-bV0';
const SHARED_SECRET = 'roots2026secret';          // same value as VITE_SHARED_SECRET in the React .env
const TRACKER       = 'Attendance Tracker'; // tab the app writes to ('Test' for trials)
const MASTER        = 'Employee Master';
const ACCESS        = 'App Access';
const LOG           = 'App Log';
const HEADER_ROW    = 1;                    // tracker header row
const TIMEZONE      = 'Asia/Kolkata';       // punch times are always India time, whatever the sheet's locale

// Punches are only accepted within RADIUS_M metres of one of these places.
// Get coordinates: Google Maps → right-click the office → click the numbers at the top to copy.
// A place left at 0, 0 is ignored; if no place is filled in, the geofence is off.
const GEOFENCE = {
  RADIUS_M: 200,
  MAX_ACCURACY_M: 300,                      // reject fixes vaguer than this (weak GPS)
  PLACES: [
    { name: 'Office', lat: 12.926667, lng: 77.474111 },   // 12°55'36.0"N 77°28'26.8"E, Bengaluru
  ],
};

// Tracker columns (1-based), matching the Attendance Tracker layout
const COL = { DATE: 1, ID: 2, NAME: 3, DESIG: 4, IN: 5, OUT: 6, HOURS: 7, STATUS: 8, LATE: 9, REMARKS: 10 };
const NCOLS = 10;
const LOG_HEADERS = ['ServerTime', 'EmployeeID', 'Type', 'ClientTime', 'Latitude', 'Longitude',
                     'Accuracy (m)', 'Map', 'Device', 'ClientID', 'Result'];
const LOG_CLIENTID_COL = 10;
const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST',
                'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];

// ===================== ENTRY =====================
function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);                      // one write at a time -> no clobbered rows
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.secret !== SHARED_SECRET) return json({ ok: false, error: 'unauthorized' });
    switch (body.action) {
      case 'login': return json(login(body));
      case 'punch': return json(punch(body));
      case 'today': return json(today(body));
      default:      return json({ ok: false, error: 'unknown action' });
    }
  } catch (err) {
    return json({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// Lets you open the /exec URL in a browser to confirm the deployment is live
function doGet() {
  return json({ ok: true, service: 'roots-attendance', tracker: TRACKER });
}

// ===================== ACTIONS =====================
function login({ employeeId, pin }) {
  const emp = authenticate(employeeId, pin);
  return emp ? { ok: true, employee: emp } : { ok: false, error: 'Invalid Employee ID or PIN' };
}

function today({ employeeId, pin }) {
  const emp = authenticate(employeeId, pin);
  if (!emp) return { ok: false, error: 'Invalid Employee ID or PIN' };
  const ss = SpreadsheetApp.openById(SHEET_ID), sheetTz = ss.getSpreadsheetTimeZone();
  const sh = trackerSheet(ss);
  const row = findRow(sh, Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd'), emp.id, sheetTz);
  if (!row) return { ok: true, employee: emp, checkIn: '', checkOut: '', hours: '', status: '' };
  const r = sh.getRange(row, 1, 1, NCOLS).getDisplayValues()[0];
  return { ok: true, employee: emp, checkIn: r[COL.IN - 1], checkOut: r[COL.OUT - 1],
           hours: r[COL.HOURS - 1], status: r[COL.STATUS - 1] };
}

function punch(body) {
  const emp = authenticate(body.employeeId, body.pin);
  if (!emp) return { ok: false, error: 'Invalid Employee ID or PIN' };
  if (!['CHECK_IN', 'CHECK_OUT'].includes(body.type)) return { ok: false, error: 'Bad punch type' };
  if (alreadyLogged(body.clientId)) return { ok: true, duplicate: true };

  const ss = SpreadsheetApp.openById(SHEET_ID), tz = TIMEZONE;
  const sheetTz = ss.getSpreadsheetTimeZone();              // only for reading date cells already in the sheet
  const sh = trackerSheet(ss);
  const when = punchTime(body);
  const dayKey = Utilities.formatDate(when, tz, 'yyyy-MM-dd');
  const hhmm = Utilities.formatDate(when, tz, 'HH:mm');
  const pretty = Utilities.formatDate(when, tz, 'h:mm a').toLowerCase();
  let row = findRow(sh, dayKey, emp.id, sheetTz);
  let result;
  const fence = checkGeofence(body);

  if (!fence.ok) {
    result = fence;
  } else if (body.type === 'CHECK_IN') {
    if (row && sh.getRange(row, COL.IN).getDisplayValue()) {
      result = { ok: false, error: 'Already checked in at ' + sh.getRange(row, COL.IN).getDisplayValue() };
    } else {
      if (!row) row = createRow(sh, dayKey, emp, sheetTz);
      sh.getRange(row, COL.IN).setValue(hhmm);          // Sheets parses "HH:mm" as a time value
      sh.getRange(row, COL.STATUS).setValue('Present');
      result = { ok: true, type: 'CHECK_IN', time: pretty };
    }
  } else {
    if (!row || !sh.getRange(row, COL.IN).getDisplayValue()) {
      result = { ok: false, error: "You haven't checked in today" };
    } else {
      sh.getRange(row, COL.OUT).setValue(hhmm);          // a later check-out overwrites an earlier one
      const status = sh.getRange(row, COL.STATUS);
      if (!status.getDisplayValue().trim()) status.setValue('Present');
      result = { ok: true, type: 'CHECK_OUT', time: pretty };
    }
  }

  const hasLoc = body.lat != null && body.lng != null;
  ss.getSheetByName(LOG).appendRow([
    Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm:ss'), emp.id, body.type,
    body.clientTime || '',
    hasLoc ? body.lat : '', hasLoc ? body.lng : '',
    body.accuracy != null ? Math.round(body.accuracy) : '',
    hasLoc ? `https://maps.google.com/?q=${body.lat},${body.lng}` : (body.locationError || 'no location'),
    body.device || '', body.clientId || '',
    (result.ok ? 'OK' : result.error) + (fence.note ? ` (${fence.note})` : '')
  ]);
  return result;
}

// ===================== GEOFENCE =====================
function checkGeofence({ lat, lng, accuracy, locationError }) {
  const places = GEOFENCE.PLACES.filter(p => p.lat || p.lng);
  if (!places.length) return { ok: true };                    // not configured yet
  if (lat == null || lng == null) {
    return { ok: false, error: `Location is required to punch (${locationError || 'not available'}). Turn on location and allow it for this app.` };
  }
  if (accuracy != null && accuracy > GEOFENCE.MAX_ACCURACY_M) {
    return { ok: false, error: `Location is not precise enough (±${Math.round(accuracy)} m). Wait a few seconds or step near a window and try again.` };
  }
  const nearest = places
    .map(p => ({ name: p.name, d: distanceM(lat, lng, p.lat, p.lng) }))
    .sort((a, b) => a.d - b.d)[0];
  const note = `${Math.round(nearest.d)} m from ${nearest.name}`;
  if (nearest.d > GEOFENCE.RADIUS_M) {
    return { ok: false, error: `You are ${formatDistance(nearest.d)} away from ${nearest.name}. You can only punch at the office.`, note };
  }
  return { ok: true, note };
}

function distanceM(lat1, lng1, lat2, lng2) {                  // haversine
  const R = 6371000, rad = x => x * Math.PI / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 +
            Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function formatDistance(m) {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

// ===================== TRACKER HELPERS =====================
function trackerSheet(ss) {
  const sh = ss.getSheetByName(TRACKER);
  if (!sh) throw new Error(`Tab "${TRACKER}" not found`);
  return sh;
}

function findRow(sh, dayKey, id, tz) {
  const last = sh.getLastRow();
  if (last <= HEADER_ROW) return 0;
  const vals = sh.getRange(1, 1, last, 2).getValues();
  for (let i = vals.length - 1; i >= HEADER_ROW; i--) {   // today's rows are near the bottom
    if (dateKey(vals[i][0], tz) === dayKey && idKey(vals[i][1]) === idKey(id)) return i + 1;
  }
  return 0;
}

function createRow(sh, dayKey, emp, tz) {
  const vals = sh.getDataRange().getValues();
  const month = dayKey.slice(0, 7);

  // 1. Insertion point: after the last row dated today or earlier
  let after = HEADER_ROW, lastMonth = null;
  for (let i = HEADER_ROW; i < vals.length; i++) {
    const k = dateKey(vals[i][0], tz);
    if (k && k <= dayKey) { after = i + 1; lastMonth = k.slice(0, 7); }
  }

  // 2. Template = most recent normal employee row above the insertion point
  let tpl = 0;
  for (let i = after - 1; i >= HEADER_ROW; i--) {
    const id = String(vals[i][COL.ID - 1]).trim();
    if (id && id !== '-' && String(vals[i][COL.STATUS - 1]).trim() !== 'Holiday') { tpl = i + 1; break; }
  }

  // 3. Month header if this is the first entry of a new month
  if (lastMonth !== month) {
    const monthName = MONTHS[Number(month.slice(5, 7)) - 1];
    const next = vals[after];                               // row just below the insertion point
    if (next && String(next[0]).trim().toUpperCase() === monthName) after += 1;  // HR already added it
    else after = insertMonthHeader(sh, after, monthName, vals);
  }

  // 4. Insert the row; copy formatting, dropdowns and formulas from the template
  sh.insertRowAfter(after);
  const row = after + 1;
  const dst = sh.getRange(row, 1, 1, NCOLS);
  let tplFormulas = new Array(NCOLS).fill('');
  if (tpl) {
    const src = sh.getRange(tpl, 1, 1, NCOLS);
    src.copyTo(dst, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    src.copyTo(dst, SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false);
    tplFormulas = src.getFormulasR1C1()[0];
    tplFormulas.forEach((f, c) => { if (f) sh.getRange(row, c + 1).setFormulaR1C1(f); });
  } else {
    dst.setBackground(null).setFontWeight('normal');        // don't inherit a header/holiday look
    sh.getRange(row, COL.DATE).setNumberFormat('dd-mm-yyyy');
    sh.getRange(row, COL.IN, 1, 2).setNumberFormat('h:mm am/pm');
    sh.getRange(row, COL.HOURS).setNumberFormat('[h]:mm');
  }
  const put = (col, v) => { if (!tplFormulas[col - 1]) sh.getRange(row, col).setValue(v); };

  put(COL.DATE, dayKey);                                    // ISO string -> date value; template format applies
  put(COL.ID, emp.id);
  put(COL.NAME, emp.name);
  put(COL.DESIG, emp.designation);
  if (!tplFormulas[COL.HOURS - 1]) {
    sh.getRange(row, COL.HOURS)
      .setFormulaR1C1('=IF(AND(ISNUMBER(RC[-2]),ISNUMBER(RC[-1])),RC[-1]-RC[-2],"")');
  }
  const holidayToday = vals.some(v =>
    dateKey(v[0], tz) === dayKey && String(v[COL.STATUS - 1]).trim() === 'Holiday');
  if (holidayToday) put(COL.REMARKS, 'Worked on holiday');
  return row;
}

function insertMonthHeader(sh, after, monthName, vals) {
  sh.insertRowAfter(after);
  const r = after + 1;
  const srcIdx = vals.findIndex(v => MONTHS.includes(String(v[0]).trim().toUpperCase()));
  if (srcIdx >= 0) {
    let srcRow = srcIdx + 1;
    if (srcRow > after) srcRow++;                           // shifted down by the insert
    sh.getRange(srcRow, 1, 1, NCOLS).copyTo(sh.getRange(r, 1, 1, NCOLS));  // format + merge
  } else {
    sh.getRange(r, 1, 1, NCOLS).merge().setBackground('#cccccc')
      .setFontWeight('bold').setHorizontalAlignment('center');
  }
  sh.getRange(r, 1).setValue(monthName);
  return r;
}

// ===================== AUTH / LOOKUP =====================
function authenticate(employeeId, pin) {
  const id = idKey(employeeId);
  if (!id || !pin) return null;
  const rows = SpreadsheetApp.openById(SHEET_ID).getSheetByName(ACCESS)
    .getDataRange().getDisplayValues().slice(1);
  const ok = rows.some(r => idKey(r[0]) === id && r[1].trim() === String(pin).trim()
                         && r[2].trim().toUpperCase() === 'TRUE');
  return ok ? masterLookup(id) : null;
}

function masterLookup(key) {
  const { rows, h, iId } = masterTable();
  const hdr = rows[h].map(headerKey);
  const iName = hdr.findIndex(c => c === 'employeename' || c === 'name');
  const iDes = hdr.indexOf('designation');
  const r = rows.slice(h + 1).find(r => idKey(r[iId]) === key);
  if (!r) return null;
  return { id: norm(r[iId]), name: iName >= 0 ? r[iName] : '', designation: iDes >= 0 ? r[iDes] : '' };
}

function masterTable() {
  const rows = SpreadsheetApp.openById(SHEET_ID).getSheetByName(MASTER).getDataRange().getDisplayValues();
  const h = rows.findIndex(r => r.some(c => headerKey(c) === 'employeeid'));
  if (h < 0) throw new Error(`"Employee ID" header not found in ${MASTER}`);
  return { rows, h, iId: rows[h].map(headerKey).indexOf('employeeid') };
}

// ===================== MISC =====================
// Device time is trusted only for punches queued offline (max 12h old); otherwise server time
function punchTime(body) {
  const now = new Date();
  if (!body.queued || !body.clientTime) return now;
  const c = new Date(body.clientTime);
  return !isNaN(c) && c <= now && now - c < 12 * 3600 * 1000 ? c : now;
}

function alreadyLogged(clientId) {
  if (!clientId) return false;
  const sh = SpreadsheetApp.openById(SHEET_ID).getSheetByName(LOG);
  if (sh.getLastRow() < 2) return false;
  return sh.getRange(2, LOG_CLIENTID_COL, sh.getLastRow() - 1).getValues().some(r => r[0] === clientId);
}

function dateKey(v, tz) {
  if (v instanceof Date) return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  const m = String(v).trim().match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/);   // dd-mm-yyyy text
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : '';
}

function norm(s) { return String(s == null ? '' : s).trim().toUpperCase(); }
// Compare IDs ignoring case and punctuation, so TR_EM0001, tr-em0001 and "TR EM0001" all match
function idKey(s) { return norm(s).replace(/[^A-Z0-9]/g, ''); }
function headerKey(s) { return String(s).toLowerCase().replace(/[^a-z]/g, ''); }
function json(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

// ===================== ONE-TIME SETUP (run from the editor) =====================
function setup() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  ensureHiddenTab(ss, ACCESS, ['EmployeeID', 'PIN', 'Active']).getRange('A:B').setNumberFormat('@');
  ensureHiddenTab(ss, LOG, LOG_HEADERS);
  trackerSheet(ss);                                          // fail early if the tracker tab is missing
}

function ensureHiddenTab(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (sh) return sh;
  sh = ss.insertSheet(name);
  sh.appendRow(headers);
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  const p = sh.protect().setDescription(`${name} (app only)`);
  p.removeEditors(p.getEditors());
  sh.hideSheet();
  return sh;
}

// Adds every Employee ID from Employee Master that is missing in App Access, with a random 4-digit PIN
function syncAccessFromMaster() {
  const { rows, h, iId } = masterTable();
  Logger.log(`Employee Master: "Employee ID" header found in row ${h + 1}, column ${iId + 1}`);
  const access = SpreadsheetApp.openById(SHEET_ID).getSheetByName(ACCESS);
  const have = new Set(access.getDataRange().getDisplayValues().slice(1).map(r => idKey(r[0])));
  const added = rows.slice(h + 1).map(r => norm(r[iId]))
    .filter(id => idKey(id) && !have.has(idKey(id)));
  added.forEach(id => { access.appendRow([id, String(Math.floor(1000 + Math.random() * 9000)), 'TRUE']); have.add(idKey(id)); });
  Logger.log(added.length ? `Added ${added.length} employee(s): ${added.join(', ')}`
                          : 'No new Employee IDs found below the header row');
}
