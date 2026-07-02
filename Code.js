// ============================================================
// Chorale Attendance System — Google Apps Script
// Full: Record, View, Edit, Probation, Export, Scoreboard
// ============================================================

const SPREADSHEET_ID   = "1BvksnvpxrtwV60DnB8xaRETokP5r9zcKqP4VdXk8Pxk";
var BIRTHDAY_POSTER_TEMPLATE_ID = "1xPVqGnjLE0sFYMaAMPVnnh49GZJlQPZv1efxon8XW-A";
var MEMBERS_SHEET    = "Members";
var ATTENDANCE_SHEET = "Attendance";
var OFFENSES_SHEET   = "Offenses";
var ADMINS_SHEET     = "Admins";
var SCHEDULE_SHEET   = "Schedule";
var MEETINGS_SHEET   = "Meetings";
var APOLOGIES_SHEET  = "Apologies";
var REQUEST_TYPES = ["Name Change", "Section Transfer", "Course Details", "Restart Probation"];
function isRequestType_(type) {
  return REQUEST_TYPES.indexOf(String(type || "").trim()) !== -1;
}
var MEMBER_DETAILS_SHEET = "Member Details";
var CONFIG_SHEET     = "Config";
var SIGNATURES_SHEET = "Signatures";
var PHOTO_FOLDER_ID  = "1-HhDK1DNADta_zoqSlkcRJLZqXOl4WNlixQinheteKcc0Sf-whvREBR81ABgAIuzgHHAvBgk";
var PROFILE_PHOTO_FOLDER_ID = "1QyfgOnHAA71NX1WJCpTbXonJJDJVzU5O";
var GROUPS           = ["Choir", "Band", "Orchestra"];
var ROLE_COLUMNS     = { "Choir": "choir part", "Band": "band role", "Orchestra": "orchestra role" };
var PROBATION_THRESHOLD = 0.8;
var PROBATION_CONDITIONAL = 0.5; // 50% — below this = failed
var PROBATION_PENALTY_MULTIPLIER = 2; // penalty per missed session
var APP_URL = "https://script.google.com/a/macros/strathmore.edu/s/AKfycbw0_PlBuONvu9P2utJFwtAUJg6JCdwnHevBbBI6SOxO4M-C9bsQUkL_ncBjoTc9BXR75Q/exec";
 
// Email config
var EMAIL_CC = "aapela@strathmore.edu";
var EMAIL_FROM_NAME = "Strathmore Chorale";
// Contact email shown to unknown users on the access-denied screen
var ADMIN_CONTACT_EMAIL = "aapela@strathmore.edu.edu";
 
// Status → Points mapping
var POINTS_MAP = {
  "Present": 2,
  "Late Excused": 1,
  "Late Unexcused": 0,
  "Absent Excused": 0,
  "Absent Unexcused": -1
};
 
// All valid statuses
var ALL_STATUSES = ["Present", "Late Excused", "Late Unexcused", "Absent Excused", "Absent Unexcused"];
 
// Consecutive absence penalty
var CONSECUTIVE_ABSENCE_COUNT = 3;
var CONSECUTIVE_ABSENCE_PENALTY = -2;
 
// Offense penalty per offense
var OFFENSE_PENALTY = -3;

function getSpreadsheet_() { return SpreadsheetApp.openById(SPREADSHEET_ID); }
 
function doGet() {
  return HtmlService.createTemplateFromFile("Page").evaluate()
    .setTitle("Chorale Attendance")
    .addMetaTag("viewport", "width=device-width, initial-scale=1, maximum-scale=1")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
 
/** Includes an HTML file inside another (used for Scripts.html). */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}


// -------------------------------------------------------
//  AUTH: User Role Detection
// -------------------------------------------------------
 
/**
 * Determines the logged-in user's role.
 * Checks Admins sheet first, then Members sheet.
 * Returns: { role: "admin"|"member"|"unknown", email, name, groups }
 */
function getUserRole() {
  var ss = getSpreadsheet_();
  var email = Session.getActiveUser().getEmail();
  if (!email) return { role: "unknown", email: "", name: "", groups: [] };
 
  var emailLower = email.toLowerCase();
 
  // Check Admins sheet
  var adminSheet = ss.getSheetByName(ADMINS_SHEET);
  if (adminSheet) {
    var adminData = adminSheet.getDataRange().getValues();
    for (var i = 1; i < adminData.length; i++) {
      var adminEmail = adminData[i][0].toString().trim().toLowerCase();
      if (adminEmail === emailLower) {
        // Admin — also check if they're in Members for name
        var memberInfo = findMemberByEmail_(ss, emailLower);
        return { role: "admin", email: email, name: memberInfo ? memberInfo.name : email, groups: memberInfo ? memberInfo.groups : [] };
      }
    }
  }
 
  // Check Members sheet
  var memberInfo = findMemberByEmail_(ss, emailLower);
  if (memberInfo && memberInfo.active) {
    return { role: "member", email: email, name: memberInfo.name, groups: memberInfo.groups };
  }
 
  return { role: "unknown", email: email, name: "", groups: [], adminContact: ADMIN_CONTACT_EMAIL };
}
 
/**
 * Finds a member by email in the Members sheet.
 */
function findMemberByEmail_(ss, emailLower) {
  var allMembers = readAllMembers_(ss);
  for (var i = 0; i < allMembers.length; i++) {
    if (allMembers[i].email.toLowerCase() === emailLower) {
      return allMembers[i];
    }
  }
  return null;
}
 
/**
 * Returns personal attendance data for the logged-in user.
 * Used by the "My Attendance" tab for members.
 */
function getMyAttendance() {
  var ss = getSpreadsheet_();
  var email = Session.getActiveUser().getEmail();
  if (!email) throw new Error("Could not detect your email.");
 
  var member = findMemberByEmail_(ss, email.toLowerCase());
  if (!member) throw new Error("No member found for " + email);
 
  var attData = readAllAttendance_(ss);
  var history = getMemberHistory(member.name);
  var scoreboard = getScoreboard("All");
 
  // Find this member's scoreboard position
  var myScore = null;
  var myRank = 0;
  for (var i = 0; i < scoreboard.length; i++) {
    if (scoreboard[i].name === member.name) {
      myScore = scoreboard[i];
      myRank = i + 1;
      break;
    }
  }
 
  // Probation status
  var probation = null;
  if (member.probation) {
    probation = calculateProbationStats_(member, attData);
    probation.groups = member.groups.filter(function(g) { return GROUPS.indexOf(g) !== -1; });
  }
 
  // Check onboarding status
  var onboardingDone = true;
  var detailSheet = ss.getSheetByName(MEMBER_DETAILS_SHEET);
  if (detailSheet) {
    var dd = detailSheet.getDataRange().getValues();
    var found = false;
    for (var di = 1; di < dd.length; di++) {
      var rEmail = dd[di][1].toString().trim().toLowerCase();
      var rName = dd[di][0].toString().trim().toLowerCase();
      var emailMatch = rEmail && rEmail === email.toLowerCase();
      var nameMatch = rName && rName === member.name.toLowerCase();
      if (emailMatch || nameMatch) {
        found = true;
        onboardingDone = dd[di][18] && dd[di][18].toString().trim().toLowerCase() === "yes";
        break;
      }
    }
    if (!found) onboardingDone = false;
  } else {
    onboardingDone = false;
  }
 
  return {
    name: member.name,
    email: member.email,
    groups: member.groups,
    roles: member.roles,
    probation: member.probation,
    probationPassed: member.probationPassed,
    probationFailed: member.probationFailed,
    probationPenalty: member.probationPenalty,
    probationAcknowledged: member.probationAcknowledged,
    probationInfo: probation,
    onboardingCompleted: onboardingDone,
    history: history,
    score: myScore,
    rank: myRank,
    totalMembers: scoreboard.length
  };
}
 
// -------------------------------------------------------
//  SHARED: Read Members
// -------------------------------------------------------
function readAllMembers_(ss) {
  var sheet = ss.getSheetByName(MEMBERS_SHEET);
  if (!sheet) throw new Error("Sheet '" + MEMBERS_SHEET + "' not found.");
  var data = sheet.getDataRange().getValues();
  var h = data[0].map(function(x) { return x.toString().trim().toLowerCase(); });
  var ni = h.indexOf("name"), gi = h.indexOf("groups"), ei = h.indexOf("email"),
      pi = h.indexOf("phone"), ai = h.indexOf("adm. no."), si = h.indexOf("status"),
      pri = h.indexOf("probation"), psi = h.indexOf("probation start"), pei = h.indexOf("probation end"),
      ppi = h.indexOf("probation penalty"), pai = h.indexOf("probation acknowledged"),
      pphi = h.indexOf("profile photo");
  if (ni === -1) throw new Error("'Name' column not found.");
  if (gi === -1) throw new Error("'Groups' column not found.");
  var rim = {};
  for (var g in ROLE_COLUMNS) { var idx = h.indexOf(ROLE_COLUMNS[g]); if (idx !== -1) rim[g] = idx; }
  var members = [];
  for (var i = 1; i < data.length; i++) {
    var name = data[i][ni].toString().trim();
    if (!name) continue;
    var mgs = data[i][gi].toString().split(",").map(function(s){return s.trim();}).filter(Boolean);
    var roles = {};
    for (var r = 0; r < mgs.length; r++) { roles[mgs[r]] = rim[mgs[r]] !== undefined ? (data[i][rim[mgs[r]]].toString().trim() || "Other") : "Other"; }
    var st = si !== -1 ? data[i][si].toString().trim() : "";
    // Probation: "Yes" = active, "Passed" = completed, "Failed" = failed, blank = never
    var probVal = pri !== -1 ? data[i][pri].toString().trim() : "";
    var probLower = probVal.toLowerCase();
    var probActive = (probLower === "yes" || probLower === "true");
    var probPassed = probLower === "passed";
    var probFailed = probLower === "failed";
    var probStart = "", probEnd = "";
    if (psi !== -1 && (probActive || probPassed || probFailed)) {
      var ps = data[i][psi]; probStart = ps instanceof Date ? Utilities.formatDate(ps, Session.getScriptTimeZone(), "yyyy-MM-dd") : parseFlexDate_(ps.toString().trim());
    }
    if (pei !== -1 && (probPassed || probFailed)) {
      var pe = data[i][pei]; probEnd = pe instanceof Date ? Utilities.formatDate(pe, Session.getScriptTimeZone(), "yyyy-MM-dd") : parseFlexDate_(pe.toString().trim());
    }
    var probPenalty = ppi !== -1 ? (parseFloat(data[i][ppi]) || 0) : 0;
    var probAcked = pai !== -1 ? data[i][pai].toString().trim().toLowerCase() === "yes" : false;
    var profPhotoRaw = pphi !== -1 ? data[i][pphi].toString().trim() : "";
    members.push({ name: name, email: ei!==-1?data[i][ei].toString().trim():"", phone: pi!==-1?data[i][pi].toString().trim():"",
      admNo: ai!==-1?data[i][ai].toString().trim():"", groups: mgs, roles: roles, active: st.toLowerCase() !== "inactive",
      probation: probActive, probationPassed: probPassed, probationFailed: probFailed,
      probationStart: probStart, probationEnd: probEnd, probationPenalty: probPenalty, probationAcknowledged: probAcked,
      profilePhotoRaw: profPhotoRaw, rowIndex: i + 1 });
  }
  return members;
}
 
// -------------------------------------------------------
//  READ MEMBERS (for form)
// -------------------------------------------------------
/**
 * Returns active members for the selected groups.
 * @param {Array} selectedGroups — e.g. ["Choir","Band"] or ["Choir"]
 */
function getMembers(selectedGroups) {
  var ss = getSpreadsheet_(); var all = readAllMembers_(ss); var result = [];
  for (var i = 0; i < all.length; i++) {
    var m = all[i]; if (!m.active) continue;
    // Member's groups that overlap with the selection
    var rg = m.groups.filter(function(g) { return selectedGroups.indexOf(g) !== -1; });
    if (rg.length === 0) continue;
    var roles = {}; for (var r = 0; r < rg.length; r++) roles[rg[r]] = m.roles[rg[r]] || "Other";
    result.push({ name: m.name, groups: rg, roles: roles, probation: m.probation, probationStart: m.probationStart });
  }
  return result;
}
 
/**
 * Builds the session string from selected groups (sorted, comma-joined).
 */
function buildSessionKey_(selectedGroups) {
  return selectedGroups.slice().sort().join(",");
}
 
// -------------------------------------------------------
//  ATTENDANCE CRUD
// -------------------------------------------------------
 
/**
 * Checks if attendance already exists for a date + session combination.
 * @param {string} dateStr
 * @param {Array} selectedGroups
 */
function checkExistingAttendance(dateStr, selectedGroups) {
  var ss = getSpreadsheet_(); var sheet = ss.getSheetByName(ATTENDANCE_SHEET);
  if (!sheet) return { exists: false, groups: [] };
  var sessionKey = buildSessionKey_(selectedGroups);
  var data = sheet.getDataRange().getValues();
  var foundGroups = {};
  for (var i = 1; i < data.length; i++) {
    if (formatSheetDate_(data[i][0]) !== dateStr) continue;
    var grp = data[i][2].toString();
    // Check if this record's session matches OR if the group is in our selection
    var recSession = (data[i][7] && data[i][7].toString().trim()) ? data[i][7].toString().trim() : grp;
    if (recSession === sessionKey || selectedGroups.indexOf(grp) !== -1) {
      foundGroups[grp] = true;
    }
  }
  var fl = Object.keys(foundGroups);
  return { exists: fl.length > 0, groups: fl };
}
 
/**
 * Saves attendance. Session value is built from selectedGroups.
 * @param {string} dateStr
 * @param {Array} selectedGroups
 * @param {Array} records
 * @param {boolean} overwrite
 */
function saveAttendance(dateStr, selectedGroups, records, overwrite) {
  var ss = getSpreadsheet_(); var sheet = ss.getSheetByName(ATTENDANCE_SHEET);
  if (!sheet) { sheet = ss.insertSheet(ATTENDANCE_SHEET); sheet.appendRow(["Date","Name","Group","Role","Status","Recorded By","Timestamp","Session"]); sheet.getRange(1,1,1,8).setFontWeight("bold"); sheet.setFrozenRows(1); }
  var lastCol = sheet.getLastColumn();
  if (lastCol < 8) { sheet.getRange(1, 8).setValue("Session").setFontWeight("bold"); }
 
  var sessionKey = buildSessionKey_(selectedGroups);
 
  if (overwrite) {
    var data = sheet.getDataRange().getValues();
    for (var i = data.length-1; i >= 1; i--) {
      if (formatSheetDate_(data[i][0]) !== dateStr) continue;
      var grp = data[i][2].toString();
      var recSession = (data[i][7] && data[i][7].toString().trim()) ? data[i][7].toString().trim() : grp;
      // Delete if same session key OR if the group is in our selection
      if (recSession === sessionKey || selectedGroups.indexOf(grp) !== -1) {
        sheet.deleteRow(i + 1);
      }
    }
  }
 
  var user = Session.getActiveUser().getEmail()||"Unknown", now = new Date(), rows = [], sm = {};
  for (var j = 0; j < records.length; j++) {
    var rec = records[j];
    for (var k = 0; k < rec.groups.length; k++) {
      var mg = rec.groups[k], role = (rec.roles&&rec.roles[mg])?rec.roles[mg]:"Other";
      rows.push([dateStr, rec.name, mg, role, rec.status, user, now, sessionKey]);
      if (!sm[mg]) sm[mg] = {}; sm[mg][rec.status] = (sm[mg][rec.status]||0) + 1;
    }
  }
  if (rows.length > 0) sheet.getRange(sheet.getLastRow()+1, 1, rows.length, 8).setValues(rows);
  refreshAllRegisters_(ss);
  // Mark matching apologies as Applied
  markApologiesApplied_(ss, dateStr, records);
  var probEvals = evaluateProbation_(ss);
  try { syncConsecutiveAuOffenses_(ss); } catch(e) {}
  return { success: true, summary: sm, date: dateStr, selectedGroups: selectedGroups, totalRows: rows.length, probationEvals: probEvals };
}
 
// -------------------------------------------------------
//  VIEW / EDIT ATTENDANCE
// -------------------------------------------------------
function getAttendanceDates(group) {
  var ss = getSpreadsheet_(); var sheet = ss.getSheetByName(ATTENDANCE_SHEET); if (!sheet) return [];
  var data = sheet.getDataRange().getValues(); var dgm = {};
  for (var i = 1; i < data.length; i++) { var ds = formatSheetDate_(data[i][0]), g = data[i][2].toString(); if (group!=="All"&&g!==group) continue; if(!dgm[ds])dgm[ds]={}; dgm[ds][g]=true; }
  var r = []; for (var d in dgm) r.push({date:d,groups:Object.keys(dgm[d])}); r.sort(function(a,b){return b.date.localeCompare(a.date);}); return r;
}
 
function getAttendanceForDate(dateStr, group) {
  var ss = getSpreadsheet_(); var sheet = ss.getSheetByName(ATTENDANCE_SHEET); if (!sheet) return {records:[],summary:{}};
  var data = sheet.getDataRange().getValues(); var records = [], summary = {};
  for (var i = 1; i < data.length; i++) {
    if (formatSheetDate_(data[i][0]) !== dateStr) continue;
    var n=data[i][1].toString(), g=data[i][2].toString(), rl=data[i][3].toString(), st=data[i][4].toString(), rb=data[i][5].toString();
    var sess=(data[i][7]&&data[i][7].toString().trim())?data[i][7].toString().trim():g;
    if (group!=="All"&&g!==group) continue;
    records.push({name:n,group:g,role:rl,status:st,recordedBy:rb,rowIndex:i+1,session:sess});
    if(!summary[g])summary[g]={}; summary[g][st]=(summary[g][st]||0)+1;
  }
  return {records:records,summary:summary};
}
 
function getAllMemberNames() {
  var ss=getSpreadsheet_(),all=readAllMembers_(ss),names=[];
  for(var i=0;i<all.length;i++) names.push(all[i].name); names.sort(); return names;
}
 
function getMemberHistory(memberName) {
  var ss=getSpreadsheet_(),sheet=ss.getSheetByName(ATTENDANCE_SHEET);
  // Look up the member's profile photo and basic info
  var allMembers=readAllMembers_(ss),memberInfo=null;
  for(var mi=0;mi<allMembers.length;mi++){if(allMembers[mi].name===memberName){memberInfo=allMembers[mi];break;}}
  var profilePhoto=memberInfo?driveAvatarDataUri_(memberInfo.profilePhotoRaw):"";
  var memberGroups=memberInfo?memberInfo.groups:[];
  if(!sheet)return{records:[],stats:{},profilePhoto:profilePhoto,groups:memberGroups,name:memberName};
  var data=sheet.getDataRange().getValues(),records=[],stats={};
  for(var i=1;i<data.length;i++){
    if(data[i][1].toString()!==memberName)continue;
    var ds=formatSheetDate_(data[i][0]),g=data[i][2].toString(),rl=data[i][3].toString(),st=data[i][4].toString();
    records.push({date:ds,group:g,role:rl,status:st,rowIndex:i+1});
    if(!stats[g])stats[g]={total:0}; stats[g][st]=(stats[g][st]||0)+1; stats[g].total++;
  }
  records.sort(function(a,b){return b.date.localeCompare(a.date);});
  for(var g in stats){ var s=stats[g]; var att=(s["Present"]||0)+(s["Late Excused"]||0)+(s["Late Unexcused"]||0); s.attendanceRate=s.total>0?Math.round((att/s.total)*100):0; }
  return {records:records,stats:stats,profilePhoto:profilePhoto,groups:memberGroups,name:memberName};
}
 
function batchUpdateAttendance(updates) {
  var ss=getSpreadsheet_(),sheet=ss.getSheetByName(ATTENDANCE_SHEET); if(!sheet)throw new Error("Attendance sheet not found.");
  var user=Session.getActiveUser().getEmail()||"Unknown",now=new Date(),changed=0;
  for(var i=0;i<updates.length;i++){var row=updates[i].rowIndex;if(row<2||row>sheet.getLastRow())continue;sheet.getRange(row,5).setValue(updates[i].newStatus);sheet.getRange(row,6).setValue(user);sheet.getRange(row,7).setValue(now);changed++;}
  if(changed>0)refreshAllRegisters_(ss);
  try { syncConsecutiveAuOffenses_(ss); } catch(e) {}
  return{success:true,changed:changed};
}
 
// -------------------------------------------------------
//  PROBATION
// -------------------------------------------------------
var PROBATION_SESSIONS = 10; // Number of sessions for probation evaluation
 
function getProbationReport(group) {
  var ss=getSpreadsheet_(),all=readAllMembers_(ss),prob=[];
  for(var i=0;i<all.length;i++){var m=all[i];if(!m.probation||!m.active||!m.probationStart)continue;
    var ig=group==="All"?m.groups.some(function(g){return GROUPS.indexOf(g)!==-1;}):m.groups.indexOf(group)!==-1;
    if(ig)prob.push(m);}
  if(prob.length===0)return[];var att=readAllAttendance_(ss);
  return prob.map(function(m){return calculateProbationStats_(m,att);});
}
 
function getProbationDashboard() {
  var ss=getSpreadsheet_(),all=readAllMembers_(ss),prob=all.filter(function(m){return m.probation&&m.active&&m.probationStart;});
  if(prob.length===0)return[];var att=readAllAttendance_(ss);
  return prob.map(function(m){var s=calculateProbationStats_(m,att);s.groups=m.groups.filter(function(g){return GROUPS.indexOf(g)!==-1;});s.profilePhoto=driveAvatarDataUri_(m.profilePhotoRaw);return s;});
}
 
/**
 * Calculates probation stats for a member.
 * Counts sessions where the member was personally recorded (per-group-per-day).
 * "Attended" = Present, Late Excused, or Late Unexcused (they showed up).
 * Tracks progress toward PROBATION_SESSIONS (10).
 */
function calculateProbationStats_(member, attData) {
  var start = member.probationStart;
  var mgs = member.groups.filter(function(g) { return GROUPS.indexOf(g) !== -1; });
  var ATTENDED_STATUSES = ["Present", "Late Excused", "Late Unexcused"];
 
  // Get this member's records since probation start
  var memberRecs = [];
  for (var i = 0; i < attData.length; i++) {
    var r = attData[i];
    if (r.name !== member.name || r.date < start || mgs.indexOf(r.group) === -1) continue;
    memberRecs.push(r);
  }
 
  // Group by (date + session) → each unique pair is one session
  // For joint ("All") sessions, multiple group records collapse into one session
  // For separate sessions, each group is its own session
  var sessionMap = {}; // "date|session" -> best status
  for (var j = 0; j < memberRecs.length; j++) {
    var rec = memberRecs[j];
    var key = rec.date + "|" + rec.session;
    var existing = sessionMap[key];
    if (!existing) {
      sessionMap[key] = { date: rec.date, status: rec.status };
    } else {
      // Keep the better status (attended > not attended)
      var existAttended = ATTENDED_STATUSES.indexOf(existing.status) !== -1;
      var newAttended = ATTENDED_STATUSES.indexOf(rec.status) !== -1;
      if (newAttended && !existAttended) sessionMap[key].status = rec.status;
    }
  }
 
  // Sort sessions by date
  var sessionKeys = Object.keys(sessionMap).sort(function(a, b) {
    return sessionMap[a].date.localeCompare(sessionMap[b].date);
  });
 
  var totalSessions = sessionKeys.length;
  var sessionsToCount = Math.min(totalSessions, PROBATION_SESSIONS);
 
  // Count attended in the first PROBATION_SESSIONS sessions
  var attended = 0;
  var lastSessionDate = "";
  for (var k = 0; k < sessionsToCount; k++) {
    var sess = sessionMap[sessionKeys[k]];
    if (ATTENDED_STATUSES.indexOf(sess.status) !== -1) attended++;
    lastSessionDate = sess.date;
  }
 
  var rate = sessionsToCount > 0 ? Math.round((attended / sessionsToCount) * 100) : 0;
  var required = Math.ceil(PROBATION_SESSIONS * PROBATION_THRESHOLD);
 
  // Per-session status sequence (for the segmented probation bar). One entry per
  // counted session in chronological order, plus empty slots up to PROBATION_SESSIONS
  // so the bar shows the full probation period filling up.
  var sessionSequence = [];
  for (var q = 0; q < sessionsToCount; q++) {
    var sq = sessionMap[sessionKeys[q]];
    sessionSequence.push({ date: sq.date, status: sq.status });
  }
  var pendingSlots = Math.max(0, PROBATION_SESSIONS - sessionSequence.length);
 
  return {
    name: member.name,
    probationStart: start,
    attended: attended,
    totalSessions: sessionsToCount,
    maxSessions: PROBATION_SESSIONS,
    remaining: Math.max(0, PROBATION_SESSIONS - totalSessions),
    rate: rate,
    onTrack: attended >= Math.ceil(sessionsToCount * PROBATION_THRESHOLD),
    threshold: PROBATION_THRESHOLD * 100,
    required: required,
    complete: totalSessions >= PROBATION_SESSIONS,
    passed: totalSessions >= PROBATION_SESSIONS && attended >= required,
    lastSessionDate: lastSessionDate,
    sessionSequence: sessionSequence,
    pendingSlots: pendingSlots
  };
}
 
/**
 * Auto-evaluates probation members after attendance is saved.
 * If a member has reached PROBATION_SESSIONS, sets Passed/Failed and updates sheet.
 * Returns array of evaluation results for the UI.
 */
function evaluateProbation_(ss) {
  var allMembers = readAllMembers_(ss);
  var attData = readAllAttendance_(ss);
  var sheet = ss.getSheetByName(MEMBERS_SHEET);
  if (!sheet) return [];
 
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(function(x) { return x.toString().trim().toLowerCase(); });
  var probIdx = headers.indexOf("probation");
  var probEndIdx = headers.indexOf("probation end");
  var statusIdx = headers.indexOf("status");
  var penaltyIdx = headers.indexOf("probation penalty");
  var ackedIdx = headers.indexOf("probation acknowledged");
 
  if (probIdx === -1) return [];
 
  // Auto-add missing columns
  var lastCol = sheet.getLastColumn();
  if (probEndIdx === -1) { lastCol++; sheet.getRange(1, lastCol).setValue("Probation End").setFontWeight("bold"); probEndIdx = lastCol - 1; }
  if (penaltyIdx === -1) { lastCol++; sheet.getRange(1, lastCol).setValue("Probation Penalty").setFontWeight("bold"); penaltyIdx = lastCol - 1; }
  if (ackedIdx === -1) { lastCol++; sheet.getRange(1, lastCol).setValue("Probation Acknowledged").setFontWeight("bold"); ackedIdx = lastCol - 1; }
 
  var required = Math.ceil(PROBATION_SESSIONS * PROBATION_THRESHOLD);
  var minRequired = Math.ceil(PROBATION_SESSIONS * PROBATION_CONDITIONAL);
  var results = [];
 
  for (var i = 0; i < allMembers.length; i++) {
    var m = allMembers[i];
    if (!m.probation || !m.active || !m.probationStart) continue;
 
    var stats = calculateProbationStats_(m, attData);
    if (!stats.complete) continue;
 
    var row = m.rowIndex;
    var outcome, penalty = 0;
 
    if (stats.attended >= required) {
      // Clean pass: ≥80%
      outcome = "passed_clean";
      sheet.getRange(row, probIdx + 1).setValue("Passed");
      sheet.getRange(row, probEndIdx + 1).setValue(stats.lastSessionDate);
      sheet.getRange(row, penaltyIdx + 1).setValue(0);
    } else if (stats.attended >= minRequired) {
      // Conditional pass: 50-79% — passed but with penalty
      outcome = "passed_conditional";
      penalty = (required - stats.attended) * PROBATION_PENALTY_MULTIPLIER;
      sheet.getRange(row, probIdx + 1).setValue("Passed");
      sheet.getRange(row, probEndIdx + 1).setValue(stats.lastSessionDate);
      sheet.getRange(row, penaltyIdx + 1).setValue(-penalty);
    } else {
      // Failed: <50%
      outcome = "failed";
      sheet.getRange(row, probIdx + 1).setValue("Failed");
      sheet.getRange(row, probEndIdx + 1).setValue(stats.lastSessionDate);
      sheet.getRange(row, penaltyIdx + 1).setValue(0);
      if (statusIdx !== -1) sheet.getRange(row, statusIdx + 1).setValue("Inactive");
    }
 
    // Reset acknowledged flag for new outcome
    sheet.getRange(row, ackedIdx + 1).setValue("");
 
    // Send email notification
    try {
      sendProbationEmail_(m, stats, outcome, penalty);
    } catch(e) {
      // Don't fail the whole evaluation if email fails
    }
 
    results.push({
      name: m.name,
      email: m.email,
      result: outcome === "failed" ? "Failed" : "Passed",
      outcome: outcome,
      rate: stats.rate,
      attended: stats.attended,
      required: required,
      penalty: penalty
    });
  }
 
  return results;
}
 
/**
 * Sends probation outcome email.
 */
function sendProbationEmail_(member, stats, outcome, penalty) {
  if (!member.email) return;
 
  var subject;
  var required = Math.ceil(PROBATION_SESSIONS * PROBATION_THRESHOLD);
  var webAppUrl = APP_URL || ScriptApp.getService().getUrl();
  var firstName = member.name.split(/\s+/)[0] || member.name;
 
  var templateName, tokens = {
    firstName: firstName,
    attendanceRate: stats.rate,
    attended: stats.attended,
    totalSessions: stats.maxSessions,
    appUrl: webAppUrl
  };
 
  if (outcome === "passed_clean") {
    subject = "Congratulations — You've Passed Probation!";
    templateName = "probation-pass";
  } else if (outcome === "passed_conditional") {
    subject = "Probation Complete — Welcome to the Chorale";
    templateName = "probation-conditional";
    tokens.penalty = Math.abs(penalty);
  } else {
    subject = "Probation Outcome — Strathmore Chorale";
    templateName = "probation-failed";
  }
 
  var bodyHtml;
  try {
    bodyHtml = renderEmailTemplate_(templateName, tokens);
  } catch(e) {
    bodyHtml = "<p>Your probation has been evaluated. Please check the Chorale attendance system for details.</p>";
  }
 
  MailApp.sendEmail({
    to: member.email,
    cc: EMAIL_CC,
    subject: subject,
    htmlBody: bodyHtml,
    name: EMAIL_FROM_NAME
  });
}
 
/**
 * Manual probation evaluation — callable from the UI.
 */
function evaluateProbationManual() {
  var ss = getSpreadsheet_();
  var results = evaluateProbation_(ss);
  if (results.length === 0) return { evaluated: 0, results: [], message: "No probation members have reached " + PROBATION_SESSIONS + " sessions yet." };
  return { evaluated: results.length, results: results, message: results.length + " member(s) evaluated." };
}
 
function readAllAttendance_(ss) {
  var sheet=ss.getSheetByName(ATTENDANCE_SHEET);if(!sheet)return[];var data=sheet.getDataRange().getValues(),records=[];
  for(var i=1;i<data.length;i++){
    var grp=data[i][2].toString(), sess=(data[i][7]&&data[i][7].toString().trim())?data[i][7].toString().trim():grp;
    records.push({date:formatSheetDate_(data[i][0]),name:data[i][1].toString(),group:grp,role:data[i][3].toString(),status:data[i][4].toString(),session:sess});
  }
  return records;
}
 
// -------------------------------------------------------
//  SCOREBOARD
// -------------------------------------------------------
 
/**
 * Calculates scoreboard for all active members.
 * Points: attendance points + consecutive absence penalties + offense penalties.
 * @param {string} group — "All" or specific group
 */
function getScoreboard(group) {
  var ss = getSpreadsheet_();
  var allMembers = readAllMembers_(ss);
  var attData = readAllAttendance_(ss);
  var offenses = readOffenses_(ss);
 
  var STATUS_PRIORITY = ["Present", "Late Excused", "Late Unexcused", "Absent Excused", "Absent Unexcused"];
 
  var results = [];
 
  for (var i = 0; i < allMembers.length; i++) {
    var m = allMembers[i];
    if (!m.active) continue;
    // Exclude active probation members
    if (m.probation) continue;
 
    var mgs = group === "All" ? m.groups.filter(function(g){return GROUPS.indexOf(g)!==-1;}) : m.groups.indexOf(group)!==-1 ? [group] : [];
    if (mgs.length === 0) continue;
 
    // Determine scoring start date
    // For passed probation members, only count from probation end date
    var scoreStartDate = "";
    if (m.probationPassed && m.probationEnd) {
      scoreStartDate = m.probationEnd;
    }
 
    // Get this member's attendance records for relevant groups
    var memberAtt = [];
    for (var j = 0; j < attData.length; j++) {
      var r = attData[j];
      if (r.name !== m.name || mgs.indexOf(r.group) === -1) continue;
      if (scoreStartDate && r.date < scoreStartDate) continue;
      memberAtt.push(r);
    }
 
    // Group by (date + session), pick BEST status per session
    // Joint ("All"): multiple group records per session → best status wins, scored once
    // Separate: each group is its own session → scored independently
    var sessionMap = {}; // "date|session" -> best status
    for (var k = 0; k < memberAtt.length; k++) {
      var rec = memberAtt[k];
      var sessKey = rec.date + "|" + rec.session;
      var existing = sessionMap[sessKey];
      if (!existing) {
        sessionMap[sessKey] = rec.status;
      } else {
        var existIdx = STATUS_PRIORITY.indexOf(existing);
        var newIdx = STATUS_PRIORITY.indexOf(rec.status);
        if (existIdx === -1) existIdx = 99;
        if (newIdx === -1) newIdx = 99;
        if (newIdx < existIdx) sessionMap[sessKey] = rec.status;
      }
    }
 
    var sessKeys = Object.keys(sessionMap).sort();
    var dayStatuses = sessKeys.map(function(k) { return { key: k, status: sessionMap[k] }; });
 
    // Calculate attendance points
    var attPoints = 0;
    var statusCounts = {};
    for (var d = 0; d < dayStatuses.length; d++) {
      var st = dayStatuses[d].status;
      var pts = POINTS_MAP[st];
      if (pts !== undefined) attPoints += pts;
      statusCounts[st] = (statusCounts[st] || 0) + 1;
    }
 
    // Consecutive-AU penalty is no longer deducted inline here — it is now recorded
    // as an OFFENSE (see syncConsecutiveAuOffenses_) and flows in via offensePts below.
    // Kept as 0 for backward compatibility with export/display columns.
    var consecPenalty = 0;
 
    // Offense penalty — each offense carries its own points (consecutive-AU offenses
    // score at CONSECUTIVE_ABSENCE_PENALTY; manual offenses at OFFENSE_PENALTY).
    var memberOffenses = offenses.filter(function(o) { return o.name === m.name; });
    var offensePts = 0;
    for (var oi = 0; oi < memberOffenses.length; oi++) {
      offensePts += (memberOffenses[oi].points !== undefined ? memberOffenses[oi].points : OFFENSE_PENALTY);
    }
 
    // Probation penalty (for conditional pass members)
    var probPenalty = m.probationPenalty || 0;
 
    var totalPoints = attPoints + consecPenalty + offensePts + probPenalty;
 
    results.push({
      name: m.name,
      groups: mgs,
      totalPoints: totalPoints,
      attPoints: attPoints,
      consecPenalty: consecPenalty,
      offenseCount: memberOffenses.length,
      offensePts: offensePts,
      probPenalty: probPenalty,
      statusCounts: statusCounts,
      totalDays: dayStatuses.length,
      profilePhoto: driveAvatarDataUri_(m.profilePhotoRaw)
    });
  }
 
  results.sort(function(a, b) {
    if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
    return a.name.localeCompare(b.name);
  });
 
  // Add both ranking modes
  for (var ri = 0; ri < results.length; ri++) {
    // Dense: 1,2,2,3 (no gaps, next distinct score gets next number)
    if (ri === 0) {
      results[ri].denseRank = 1;
    } else if (results[ri].totalPoints === results[ri - 1].totalPoints) {
      results[ri].denseRank = results[ri - 1].denseRank;
    } else {
      results[ri].denseRank = results[ri - 1].denseRank + 1;
    }
    // Standard competition: 1,2,2,4 (rank = count of people above + 1)
    if (ri === 0) {
      results[ri].compRank = 1;
    } else if (results[ri].totalPoints === results[ri - 1].totalPoints) {
      results[ri].compRank = results[ri - 1].compRank;
    } else {
      results[ri].compRank = ri + 1;
    }
  }
 
  return results;
}
 
// -------------------------------------------------------
//  OFFENSES
// -------------------------------------------------------
 
function readOffenses_(ss) {
  var sheet = ss.getSheetByName(OFFENSES_SHEET);
  if (!sheet) return [];
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  // Points column is optional (index 5). If absent/blank, fall back to OFFENSE_PENALTY.
  var headers = data[0].map(function(x){ return x.toString().trim().toLowerCase(); });
  var ptsIdx = headers.indexOf("points");
  var offenses = [];
  for (var i = 1; i < data.length; i++) {
    var pts = OFFENSE_PENALTY;
    if (ptsIdx !== -1 && data[i][ptsIdx] !== "" && data[i][ptsIdx] != null) {
      var p = Number(data[i][ptsIdx]);
      if (!isNaN(p)) pts = p;
    }
    offenses.push({
      date: formatSheetDate_(data[i][0]),
      name: data[i][1].toString(),
      description: data[i][2].toString(),
      recordedBy: data[i][3] ? data[i][3].toString() : "",
      points: pts
    });
  }
  return offenses;
}
 
/** Ensures the Offenses sheet exists and has a Points column; returns the sheet. */
function ensureOffensesSheet_(ss) {
  var sheet = ss.getSheetByName(OFFENSES_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(OFFENSES_SHEET);
    sheet.appendRow(["Date", "Name", "Description", "Recorded By", "Timestamp", "Points"]);
    sheet.getRange(1, 1, 1, 6).setFontWeight("bold");
    sheet.setFrozenRows(1);
    return sheet;
  }
  // Sheet exists but may be empty (no header row) — getLastColumn() would be 0.
  if (sheet.getLastColumn() === 0 || sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, 6).setValues([["Date", "Name", "Description", "Recorded By", "Timestamp", "Points"]]);
    sheet.getRange(1, 1, 1, 6).setFontWeight("bold");
    sheet.setFrozenRows(1);
    return sheet;
  }
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(function(x){ return x.toString().trim().toLowerCase(); });
  if (headers.indexOf("points") === -1) {
    var col = sheet.getLastColumn() + 1;
    sheet.getRange(1, col).setValue("Points").setFontWeight("bold");
  }
  return sheet;
}
 
/**
 * Adds an offense to the Offenses sheet. Optional points override (defaults to flat penalty).
 */
function addOffense(dateStr, memberName, description, points) {
  var ss = getSpreadsheet_();
  var sheet = ensureOffensesSheet_(ss);
  var user = Session.getActiveUser().getEmail() || "Unknown";
  var pts = (points === undefined || points === null || points === "") ? OFFENSE_PENALTY : points;
  var dmap = headerIndexMap_(sheet);
  // Build the row positionally for the first 5, then set Points by header
  var row = [dateStr, memberName, description, user, new Date()];
  sheet.appendRow(row);
  var newRow = sheet.getLastRow();
  if (dmap["points"] != null) sheet.getRange(newRow, dmap["points"] + 1).setValue(pts);
  return { success: true };
}
 
/**
 * Returns offenses for display.
 */
function getOffenseList() {
  var ss = getSpreadsheet_();
  return readOffenses_(ss);
}
 
// -------------------------------------------------------
//  CONSECUTIVE-AU → OFFENSE (Part C.1)
// -------------------------------------------------------
var CONSEC_AU_OFFENSE_TAG = "[auto:3AU]"; // marker in the description for idempotency
 
/**
 * Detects completed, non-overlapping sets of 3 consecutive Absent-Unexcused sessions
 * per member and records each as an OFFENSE (points = CONSECUTIVE_ABSENCE_PENALTY).
 * Idempotent: each set is keyed by the date of its 3rd AU; if an auto-offense with
 * that key already exists for the member, it is not written again. Does NOT toggle
 * anyone inactive. Runs at record/edit time and via the daily sweep.
 *
 * Rule: count AU in runs; every time the run reaches 3, log one offense and reset the
 * counter to 0 (so 6 straight AU = 2 offenses; a non-AU also resets).
 */
function syncConsecutiveAuOffenses_(ss) {
  ss = ss || getSpreadsheet_();
  var attSheet = ss.getSheetByName(ATTENDANCE_SHEET);
  if (!attSheet) return { added: 0 };
  var data = attSheet.getDataRange().getValues();
 
  // Build per-member chronological best-status-per-date (across all their groups)
  var byMember = {};
  for (var i = 1; i < data.length; i++) {
    var ds = formatSheetDate_(data[i][0]);
    var n = data[i][1].toString();
    var st = data[i][4].toString();
    if (!byMember[n]) byMember[n] = {};
    byMember[n][ds] = bestStatus_(byMember[n][ds], st);
  }
 
  // Existing auto-offense keys per member (to avoid double-logging)
  var existing = readOffenses_(ss);
  var existingKeys = {}; // name -> { "date": true }
  existing.forEach(function(o) {
    if (o.description && o.description.indexOf(CONSEC_AU_OFFENSE_TAG) !== -1) {
      if (!existingKeys[o.name]) existingKeys[o.name] = {};
      existingKeys[o.name][o.date] = true; // set-key (3rd-AU date) stored as offense date
    }
  });
 
  var added = 0;
  for (var name in byMember) {
    var dates = Object.keys(byMember[name]).sort(); // chronological
    var run = 0;
    for (var d = 0; d < dates.length; d++) {
      if (byMember[name][dates[d]] === "Absent Unexcused") {
        run++;
        if (run >= CONSECUTIVE_ABSENCE_COUNT) {
          var setKey = dates[d]; // date of the 3rd AU = this set's key
          var already = existingKeys[name] && existingKeys[name][setKey];
          if (!already) {
            addOffense(setKey, name, "3 consecutive unexcused absences " + CONSEC_AU_OFFENSE_TAG, CONSECUTIVE_ABSENCE_PENALTY);
            if (!existingKeys[name]) existingKeys[name] = {};
            existingKeys[name][setKey] = true;
            added++;
          }
          run = 0; // reset — non-overlapping sets of three
        }
      } else {
        run = 0;
      }
    }
  }
  return { added: added };
}
 
/** Public wrapper — admins can run a manual sweep; also called by the daily trigger. */
function runConsecutiveAuSweep() {
  var r = syncConsecutiveAuOffenses_(getSpreadsheet_());
  return { success: true, added: r.added };
}
 
 
// =======================================================
//  PHASE 4 — SESSIONS TAB + GROUP DASHBOARD (admin-level)
// =======================================================
 
/**
 * Resolves a date-range filter keyword or custom range into {start, end} (yyyy-MM-dd).
 * mode: "week" | "month" | "all" | "custom". For custom, pass customStart/customEnd.
 */
function resolveDateRange_(mode, customStart, customEnd) {
  var tz = Session.getScriptTimeZone();
  var now = new Date();
  var todayS = Utilities.formatDate(now, tz, "yyyy-MM-dd");
  if (mode === "custom" && customStart && customEnd) {
    return { start: customStart, end: customEnd };
  }
  if (mode === "week") {
    var d = new Date(now.getTime() - 7 * 86400000);
    return { start: Utilities.formatDate(d, tz, "yyyy-MM-dd"), end: todayS };
  }
  if (mode === "month") {
    var m = new Date(now.getTime() - 31 * 86400000);
    return { start: Utilities.formatDate(m, tz, "yyyy-MM-dd"), end: todayS };
  }
  return { start: "0000-01-01", end: "9999-12-31" }; // all
}
 
/**
 * Returns a list of recorded SESSIONS in a date range, each with summary stats.
 * A session is a (date + sessionKey) pair — sessionKey is the sorted group list
 * recorded together. Each entry carries attendance counts and an apology count.
 *
 * @param {Object} filters — { range:"week"|"month"|"all"|"custom", start, end,
 *                             section:"All"|group, type:"all"|"practice"|"meeting" }
 */
function getSessionsList(filters) {
  filters = filters || {};
  var ss = getSpreadsheet_();
  var range = resolveDateRange_(filters.range, filters.start, filters.end);
  var section = filters.section || "All";
  var typeFilter = filters.type || "all";
 
  var attSheet = ss.getSheetByName(ATTENDANCE_SHEET);
  if (!attSheet) return [];
  var data = attSheet.getDataRange().getValues();
 
  // Group rows by (date + session)
  var sessions = {}; // key -> { date, sessionKey, groups{}, counts{}, recorders{} }
  for (var i = 1; i < data.length; i++) {
    var ds = formatSheetDate_(data[i][0]);
    if (ds < range.start || ds > range.end) continue;
    var g = data[i][2].toString();
    var st = data[i][4].toString();
    var rb = data[i][5].toString();
    var sess = (data[i][7] && data[i][7].toString().trim()) ? data[i][7].toString().trim() : g;
    if (section !== "All") {
      // session must include the chosen section
      if (sess.split(",").map(function(x){return x.trim();}).indexOf(section) === -1) continue;
    }
    var key = ds + "||" + sess;
    if (!sessions[key]) sessions[key] = { date: ds, sessionKey: sess, groups: {}, counts: {}, recorders: {}, total: 0 };
    sessions[key].groups[g] = true;
    sessions[key].counts[st] = (sessions[key].counts[st] || 0) + 1;
    sessions[key].total++;
    if (rb) sessions[key].recorders[rb] = true;
  }
 
  // Determine which sessions were meetings (match against the Meetings sheet)
  var meetingDates = {}; // "date||groupsSorted" -> title
  var mSheet = ss.getSheetByName(MEETINGS_SHEET);
  if (mSheet) {
    var md = mSheet.getDataRange().getValues();
    for (var m = 1; m < md.length; m++) {
      var mdate = formatSheetDate_(md[m][0]);
      var mgroups = md[m][2].toString().split(",").map(function(x){return x.trim();}).filter(Boolean).sort().join(",");
      meetingDates[mdate + "||" + mgroups] = md[m][3].toString();
    }
  }
 
  var out = [];
  for (var k in sessions) {
    var s = sessions[k];
    var groupsArr = Object.keys(s.groups);
    var sortedKey = s.sessionKey.split(",").map(function(x){return x.trim();}).filter(Boolean).sort().join(",");
    var meetingTitle = meetingDates[s.date + "||" + sortedKey];
    var isMeeting = !!meetingTitle;
    if (typeFilter === "practice" && isMeeting) continue;
    if (typeFilter === "meeting" && !isMeeting) continue;
 
    var attended = (s.counts["Present"]||0) + (s.counts["Late Excused"]||0) + (s.counts["Late Unexcused"]||0);
    out.push({
      date: s.date,
      sessionKey: s.sessionKey,
      groups: groupsArr,
      type: isMeeting ? "Meeting" : "Practice",
      title: isMeeting ? meetingTitle : "Practice",
      total: s.total,
      attended: attended,
      attendanceRate: s.total > 0 ? Math.round((attended / s.total) * 100) : 0,
      counts: s.counts,
      recordedBy: Object.keys(s.recorders),
      apologyCount: countApologiesForSession_(ss, s.date, groupsArr)
    });
  }
  out.sort(function(a, b) { return (b.date + b.sessionKey).localeCompare(a.date + a.sessionKey); });
  return out;
}
 
/** Counts apologies submitted for a given date whose groups overlap the session. */
function countApologiesForSession_(ss, dateStr, groups) {
  var sheet = ss.getSheetByName(APOLOGIES_SHEET);
  if (!sheet) return 0;
  var data = sheet.getDataRange().getValues();
  var count = 0;
  for (var i = 1; i < data.length; i++) {
    if (isRequestType_(data[i][3])) continue; // requests aren't apologies
    var rowDate = formatSheetDate_(data[i][0]);
    if (rowDate !== dateStr) continue;
    var status = data[i][8] ? data[i][8].toString() : "";
    if (status === "Rejected" || status === "Revoked") continue;
    var ag = data[i][11] ? data[i][11].toString().split(",").map(function(x){return x.trim();}).filter(Boolean) : [];
    if (ag.length === 0) { count++; continue; } // legacy / general apology
    if (ag.some(function(g){ return groups.indexOf(g) !== -1; })) count++;
  }
  return count;
}
 
/**
 * GROUP DASHBOARD — aggregate stats for a section (or all) over a date range.
 * Returns attendance rate + trend, near-3-AU early warnings, probation summary,
 * and offense stats. Admin-level (section picker handled client-side for now).
 *
 * @param {Object} opts — { section:"All"|group, range:"week"|"month"|"all"|"custom", start, end }
 */
function getGroupDashboard(opts) {
  opts = opts || {};
  var ss = getSpreadsheet_();
  var section = opts.section || "All";
  var range = resolveDateRange_(opts.range, opts.start, opts.end);
 
  var attSheet = ss.getSheetByName(ATTENDANCE_SHEET);
 
  // --- Attendance aggregate + per-date trend ---
  var statusCounts = {}, trend = {}, totalRecords = 0;
  if (attSheet) {
    var data = attSheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      var ds = formatSheetDate_(data[i][0]);
      if (ds < range.start || ds > range.end) continue;
      var g = data[i][2].toString();
      if (section !== "All" && g !== section) continue;
      var st = data[i][4].toString();
      statusCounts[st] = (statusCounts[st] || 0) + 1;
      totalRecords++;
      if (!trend[ds]) trend[ds] = { attended: 0, total: 0, present: 0, late: 0, ae: 0, au: 0 };
      trend[ds].total++;
      if (st === "Present" || st === "Late Excused" || st === "Late Unexcused") trend[ds].attended++;
      if (st === "Present") trend[ds].present++;
      else if (st === "Late Excused" || st === "Late Unexcused") trend[ds].late++;
      else if (st === "Absent Excused") trend[ds].ae++;
      else if (st === "Absent Unexcused") trend[ds].au++;
    }
  }
  var attendedTotal = (statusCounts["Present"]||0) + (statusCounts["Late Excused"]||0) + (statusCounts["Late Unexcused"]||0);
  var absentTotal = (statusCounts["Absent Excused"]||0) + (statusCounts["Absent Unexcused"]||0);
  var overallRate = totalRecords > 0 ? Math.round((attendedTotal / totalRecords) * 100) : 0;
  var absenteeismRate = totalRecords > 0 ? Math.round((absentTotal / totalRecords) * 100) : 0;
  var auRate = totalRecords > 0 ? Math.round(((statusCounts["Absent Unexcused"]||0) / totalRecords) * 100) : 0;
 
  // Trend points enriched for hover tooltips: rate + headcounts per session date
  var trendArr = Object.keys(trend).sort().map(function(d) {
    var t = trend[d];
    return { date: d, rate: t.total > 0 ? Math.round((t.attended / t.total) * 100) : 0,
             attended: t.attended, total: t.total,
             present: t.present, late: t.late, ae: t.ae, au: t.au };
  });
 
  // --- Per-session AVERAGES (headcounts) — "on an average session, N attended" ---
  var sessionsCount = trendArr.length; // one entry per recorded session date
  function avg(x) { return sessionsCount > 0 ? Math.round((x / sessionsCount) * 10) / 10 : 0; }
  var avgPerSession = {
    total: avg(totalRecords),
    attended: avg(attendedTotal),
    present: avg(statusCounts["Present"]||0),
    late: avg((statusCounts["Late Excused"]||0) + (statusCounts["Late Unexcused"]||0)),
    absentExcused: avg(statusCounts["Absent Excused"]||0),
    absentUnexcused: avg(statusCounts["Absent Unexcused"]||0)
  };
 
  // --- Momentum: is attendance improving or declining across the range? ---
  // Compare avg rate of the first half of sessions vs the second half.
  var momentum = { firstHalfRate: 0, secondHalfRate: 0, delta: 0, direction: "flat" };
  if (trendArr.length >= 2) {
    var mid = Math.floor(trendArr.length / 2);
    var fh = trendArr.slice(0, mid), sh = trendArr.slice(mid);
    var fAvg = Math.round(fh.reduce(function(s,t){return s+t.rate;},0) / fh.length);
    var sAvg = Math.round(sh.reduce(function(s,t){return s+t.rate;},0) / sh.length);
    momentum.firstHalfRate = fAvg;
    momentum.secondHalfRate = sAvg;
    momentum.delta = sAvg - fAvg;
    momentum.direction = momentum.delta > 2 ? "improving" : (momentum.delta < -2 ? "declining" : "flat");
  }
 
  // --- Apology analytics for the range (real apologies only, never requests) ---
  var apologyStats = { total: 0, absentType: 0, lateType: 0, onTime: 0, lateSubmission: 0,
                       approved: 0, pending: 0, rejected: 0 };
  var apSheet = ss.getSheetByName(APOLOGIES_SHEET);
  if (apSheet) {
    var ad = apSheet.getDataRange().getValues();
    for (var a = 1; a < ad.length; a++) {
      var aType = ad[a][3].toString();
      if (isRequestType_(aType)) continue;
      var aDate = formatSheetDate_(ad[a][0]);
      if (aDate < range.start || aDate > range.end) continue;
      // Section filter via Session Groups (col 12); empty groups = counts for any section
      if (section !== "All") {
        var ag = ad[a][11] ? ad[a][11].toString().split(",").map(function(x){return x.trim();}).filter(Boolean) : [];
        if (ag.length > 0 && ag.indexOf(section) === -1) continue;
      }
      apologyStats.total++;
      if (/late/i.test(aType)) apologyStats.lateType++; else apologyStats.absentType++;
      if (ad[a][7].toString() === "Yes") apologyStats.onTime++; else apologyStats.lateSubmission++;
      var aStatus = ad[a][8].toString();
      if (aStatus === "Approved" || aStatus === "Applied") apologyStats.approved++;
      else if (aStatus === "Pending") apologyStats.pending++;
      else if (aStatus === "Rejected" || aStatus === "Revoked") apologyStats.rejected++;
    }
  }
 
  // --- Near 3-consecutive-AU early warning (ACTIVE members only) ---
  var nearAU = getConsecutiveAuWarnings_(ss, section, 2);
 
  // --- Probation summary: CURRENT probation members in this section.
  //     (Probation state history isn't stored, so this is as-of-now, not range-based.)
  var probAll = getProbationDashboard();
  var probInSection = probAll.filter(function(p) {
    return section === "All" || (p.groups || []).indexOf(section) !== -1;
  });
  var probFallingBehind = probInSection.filter(function(p) { return !p.onTrack; });
 
  return {
    section: section,
    range: range,
    sessionsCount: sessionsCount,
    overallRate: overallRate,
    absenteeismRate: absenteeismRate,
    auRate: auRate,
    statusCounts: statusCounts,
    totalRecords: totalRecords,
    avgPerSession: avgPerSession,
    momentum: momentum,
    apologyStats: apologyStats,
    trend: trendArr,
    nearAU: nearAU,
    probationCount: probInSection.length,
    probationFallingBehind: probFallingBehind,
    probationOnTrack: probInSection.length - probFallingBehind.length
  };
}
 
/**
 * Finds members with N+ consecutive Absent-Unexcused in their most recent sessions
 * (within the chosen section). Early warning before the 3-AU offense fires.
 * Returns [{ name, groups, consecutiveAU, lastSessions:[statuses] }]
 */
function getConsecutiveAuWarnings_(ss, section, threshold) {
  threshold = threshold || 2;
  var attSheet = ss.getSheetByName(ATTENDANCE_SHEET);
  if (!attSheet) return [];
  var data = attSheet.getDataRange().getValues();
 
  // Build per-member ordered status history (best-status-wins per date for the section)
  var byMember = {}; // name -> { date -> status }
  for (var i = 1; i < data.length; i++) {
    var ds = formatSheetDate_(data[i][0]);
    var n = data[i][1].toString();
    var g = data[i][2].toString();
    if (section !== "All" && g !== section) continue;
    var st = data[i][4].toString();
    if (!byMember[n]) byMember[n] = {};
    // best status wins if recorded in multiple groups same date
    var prev = byMember[n][ds];
    byMember[n][ds] = bestStatus_(prev, st);
  }
 
  var out = [];
  for (var name in byMember) {
    var dates = Object.keys(byMember[name]).sort(); // chronological
    // capture the last up-to-5 sessions for the segmented display
    var lastStatuses = [];
    for (var d = dates.length - 1; d >= 0 && lastStatuses.length < 5; d--) {
      lastStatuses.unshift({ date: dates[d], status: byMember[name][dates[d]] });
    }
    // count consecutive AU at the END (most recent run)
    var run = 0;
    for (var r = dates.length - 1; r >= 0; r--) {
      if (byMember[name][dates[r]] === "Absent Unexcused") run++;
      else break;
    }
    if (run >= threshold) {
      out.push({ name: name, consecutiveAU: run, lastSessions: lastStatuses });
    }
  }
  // attach groups; keep ACTIVE members only (inactive members aren't "at risk" —
  // they're already out, and they were bloating the panel)
  var members = readAllMembers_(ss), mmap = {}, activeMap = {};
  members.forEach(function(m){ mmap[m.name] = m.groups; activeMap[m.name] = !!m.active; });
  out = out.filter(function(o){ return activeMap[o.name]; });
  out.forEach(function(o){ o.groups = mmap[o.name] || []; });
  out.sort(function(a,b){ return b.consecutiveAU - a.consecutiveAU; });
  return out;
}
 
/** Returns the "better" of two attendance statuses (P > LE > LU > AE > AU). */
function bestStatus_(a, b) {
  var rank = { "Present":5, "Late Excused":4, "Late Unexcused":3, "Absent Excused":2, "Absent Unexcused":1 };
  if (!a) return b;
  if (!b) return a;
  return (rank[a] || 0) >= (rank[b] || 0) ? a : b;
}
 
/**
 * Full detail of one session (date + sessionKey) for the Sessions-tab detail/edit view.
 * Returns the member records (editable, with rowIndex), counts, apologies, and meta.
 */
function getSessionDetail(dateStr, sessionKey) {
  var ss = getSpreadsheet_();
  var attSheet = ss.getSheetByName(ATTENDANCE_SHEET);
  if (!attSheet) return { records: [], counts: {} };
  var data = attSheet.getDataRange().getValues();
  var records = [], counts = {}, recorders = {};
  var keyGroups = sessionKey.split(",").map(function(x){return x.trim();}).filter(Boolean);
 
  for (var i = 1; i < data.length; i++) {
    var ds = formatSheetDate_(data[i][0]);
    if (ds !== dateStr) continue;
    var g = data[i][2].toString();
    var sess = (data[i][7] && data[i][7].toString().trim()) ? data[i][7].toString().trim() : g;
    if (sess !== sessionKey) continue;
    var st = data[i][4].toString();
    records.push({
      name: data[i][1].toString(), group: g, role: data[i][3].toString(),
      status: st, recordedBy: data[i][5].toString(), rowIndex: i + 1
    });
    counts[st] = (counts[st] || 0) + 1;
    if (data[i][5]) recorders[data[i][5].toString()] = true;
  }
  records.sort(function(a,b){ return a.name.localeCompare(b.name); });
 
  // Determine whether this session is a Meeting (match the Meetings sheet), so the
  // detail header can show a title + type badge instead of just the date.
  var isMeeting = false, title = "Practice";
  var mSheet = ss.getSheetByName(MEETINGS_SHEET);
  if (mSheet) {
    var sortedKey = keyGroups.slice().sort().join(",");
    var md = mSheet.getDataRange().getValues();
    for (var m = 1; m < md.length; m++) {
      var mdate = formatSheetDate_(md[m][0]);
      var mgroups = md[m][2].toString().split(",").map(function(x){return x.trim();}).filter(Boolean).sort().join(",");
      if (mdate === dateStr && mgroups === sortedKey) {
        isMeeting = true; title = md[m][3].toString() || "Meeting"; break;
      }
    }
  }
 
  var attended = (counts["Present"]||0)+(counts["Late Excused"]||0)+(counts["Late Unexcused"]||0);
  return {
    date: dateStr, sessionKey: sessionKey, groups: keyGroups,
    type: isMeeting ? "Meeting" : "Practice", title: title,
    records: records, counts: counts, total: records.length,
    attended: attended,
    attendanceRate: records.length > 0 ? Math.round((attended/records.length)*100) : 0,
    recordedBy: Object.keys(recorders),
    apologyCount: countApologiesForSession_(ss, dateStr, keyGroups)
  };
}
 
/** Export one session as CSV. */
function exportSessionCSV(dateStr, sessionKey) {
  var detail = getSessionDetail(dateStr, sessionKey);
  var ss = getSpreadsheet_(), all = readAllMembers_(ss), mm = {};
  all.forEach(function(m){ mm[m.name] = m; });
  var rows = [["Date","Name","Adm. No.","Group","Role","Status","Points"]];
  detail.records.forEach(function(r){
    var m = mm[r.name] || {};
    rows.push([dateStr, r.name, m.admNo||"", r.group, r.role, r.status,
               POINTS_MAP[r.status]!==undefined?POINTS_MAP[r.status]:0]);
  });
  return arrayToCSV_(rows);
}
 
/** Export the sessions list (summary rows) as CSV for a filter range. */
function exportSessionsListCSV(filters) {
  var list = getSessionsList(filters);
  var rows = [["Date","Type","Title","Groups","Total","Attended","Rate","Apologies","Recorded By"]];
  list.forEach(function(s){
    rows.push([s.date, s.type, s.title, s.groups.join(" / "), s.total, s.attended,
               s.attendanceRate + "%", s.apologyCount, s.recordedBy.join(", ")]);
  });
  return arrayToCSV_(rows);
}
 
// -------------------------------------------------------
//  EXPORT
// -------------------------------------------------------
function exportDateCSV(dateStr, group) { return arrayToCSV_(buildExportRows_(dateStr, dateStr, group)); }
function exportDatePDF(dateStr, group) { return buildPrintHTML_("Attendance Report — " + dateStr, buildExportRows_(dateStr, dateStr, group), group); }
function exportDateRangeCSV(s, e, group) { return arrayToCSV_(buildExportRows_(s, e, group)); }
function exportDateRangePDF(s, e, group) { return buildPrintHTML_("Attendance Report — " + s + " to " + e, buildExportRows_(s, e, group), group); }
 
function buildExportRows_(startDate, endDate, group) {
  var ss=getSpreadsheet_(),all=readAllMembers_(ss),mm={};
  for(var i=0;i<all.length;i++) mm[all[i].name]=all[i];
  var sheet=ss.getSheetByName(ATTENDANCE_SHEET);
  if(!sheet) return [["Date","Name","Adm. No.","Email","Group","Role","Status","Points"]];
  var data=sheet.getDataRange().getValues(),rows=[["Date","Name","Adm. No.","Email","Group","Role","Status","Points"]];
  for(var i=1;i<data.length;i++){
    var ds=formatSheetDate_(data[i][0]);if(ds<startDate||ds>endDate)continue;
    var g=data[i][2].toString();if(group!=="All"&&g!==group)continue;
    var n=data[i][1].toString(),m=mm[n]||{},st=data[i][4].toString();
    rows.push([ds,n,m.admNo||"",m.email||"",g,data[i][3].toString(),st,POINTS_MAP[st]!==undefined?POINTS_MAP[st]:0]);
  }
  return rows;
}
 
function exportProbationCSV() {
  var d=getProbationDashboard(),rows=[["Name","Groups","Probation Start","Attended","Total","Rate","On Track"]];
  for(var i=0;i<d.length;i++) rows.push([d[i].name,(d[i].groups||[]).join(", "),d[i].probationStart,d[i].attended,d[i].totalSessions,d[i].rate+"%",d[i].onTrack?"Yes":"No"]);
  return arrayToCSV_(rows);
}
function exportProbationPDF() {
  var d=getProbationDashboard(),rows=[["Name","Groups","Probation Start","Attended","Total","Rate","On Track"]];
  for(var i=0;i<d.length;i++) rows.push([d[i].name,(d[i].groups||[]).join(", "),d[i].probationStart,d[i].attended,d[i].totalSessions,d[i].rate+"%",d[i].onTrack?"Yes":"No"]);
  return buildPrintHTML_("Probation Report",rows,"All");
}
 
function exportScoreboardCSV(group) {
  var sb=getScoreboard(group),rows=[["Rank","Name","Groups","Total Points","Attendance Pts","Consec. Penalty","Offenses","Offense Pts","Days"]];
  for(var i=0;i<sb.length;i++){var s=sb[i];rows.push([i+1,s.name,s.groups.join(", "),s.totalPoints,s.attPoints,s.consecPenalty,s.offenseCount,s.offensePts,s.totalDays]);}
  return arrayToCSV_(rows);
}
function exportScoreboardPDF(group) {
  var sb=getScoreboard(group),rows=[["Rank","Name","Groups","Total Points","Attendance Pts","Consec. Penalty","Offenses","Offense Pts","Days"]];
  for(var i=0;i<sb.length;i++){var s=sb[i];rows.push([i+1,s.name,s.groups.join(", "),s.totalPoints,s.attPoints,s.consecPenalty,s.offenseCount,s.offensePts,s.totalDays]);}
  return buildPrintHTML_("Scoreboard" + (group!=="All"?" — "+group:""),rows,group);
}
 
function buildPrintHTML_(title, rows, group) {
  var html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>'+title+'</title>';
  html += '<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding:24px;color:#1e293b}';
  html += 'h1{font-size:1.3rem;margin-bottom:4px}.meta{color:#64748b;font-size:0.85rem;margin-bottom:16px}';
  html += 'table{width:100%;border-collapse:collapse;font-size:0.85rem}th{background:#f1f5f9;text-align:left;padding:8px 10px;border:1px solid #e2e8f0;font-weight:600}';
  html += 'td{padding:6px 10px;border:1px solid #e2e8f0}tr:nth-child(even){background:#f8fafc}';
  html += '.pos{color:#16a34a;font-weight:600}.neg{color:#dc2626;font-weight:600}.zero{color:#d97706;font-weight:600}';
  html += '@media print{body{padding:0}}</style></head><body>';
  html += '<h1>'+title+'</h1><div class="meta">Group: '+group+' &bull; Generated: '+new Date().toLocaleString()+'</div>';
  if(rows.length>1){
    html+='<table><thead><tr>';for(var c=0;c<rows[0].length;c++)html+='<th>'+rows[0][c]+'</th>';html+='</tr></thead><tbody>';
    for(var r=1;r<rows.length;r++){html+='<tr>';for(var c2=0;c2<rows[r].length;c2++){var v=rows[r][c2].toString(),cls="";
      if(v==="Present"||v==="Yes")cls=' class="pos"';else if(v.indexOf("Absent")!==-1||v==="No")cls=' class="neg"';
      else if(v==="Late Excused"||v==="Late Unexcused"||v==="Excused")cls=' class="zero"';
      var num=parseFloat(v);if(!isNaN(num)&&v===num.toString()){if(num>0)cls=' class="pos"';else if(num<0)cls=' class="neg"';}
      html+='<td'+cls+'>'+v+'</td>';}html+='</tr>';}
    html+='</tbody></table>';
  }else html+='<p>No records found.</p>';
  html+='</body></html>';return html;
}
 
function arrayToCSV_(rows) {
  return rows.map(function(row){return row.map(function(cell){var s=cell.toString();return(s.indexOf(",")!==-1||s.indexOf('"')!==-1||s.indexOf("\n")!==-1)?'"'+s.replace(/"/g,'""')+'"':s;}).join(",");}).join("\n");
}
 
// -------------------------------------------------------
//  MEMBER MANAGEMENT
// -------------------------------------------------------
/**
 * Member acknowledges their probation outcome banner.
 */
function acknowledgeProbation() {
  var ss = getSpreadsheet_();
  var email = Session.getActiveUser().getEmail();
  if (!email) throw new Error("Could not detect your email.");
  var member = findMemberByEmail_(ss, email.toLowerCase());
  if (!member) throw new Error("No member found.");
 
  var sheet = ss.getSheetByName(MEMBERS_SHEET);
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(function(x) { return x.toString().trim().toLowerCase(); });
  var ackedIdx = headers.indexOf("probation acknowledged");
  if (ackedIdx === -1) return { success: false };
 
  sheet.getRange(member.rowIndex, ackedIdx + 1).setValue("Yes");
  return { success: true };
}
 
/**
 * Failed member requests to restart probation.
 */
function requestProbationRestart(reason) {
  var ss = getSpreadsheet_();
  var email = Session.getActiveUser().getEmail();
  if (!email) throw new Error("Could not detect your email.");
  var member = findMemberByEmail_(ss, email.toLowerCase());
  if (!member) throw new Error("No member found.");
  if (!member.probationFailed) throw new Error("You are not in a failed probation state.");
 
  // Store restart request in Apologies sheet as a special type
  var sheet = ensureApologiesSheet_(ss);
  var now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
  sheet.appendRow([todayStr_(), member.name, email, "Restart Probation", reason, now, "", "N/A", "Pending", "", ""]);
  return { success: true };
}
 
/**
 * Admin approves a probation restart request.
 * Resets the member's probation to active with today as start date.
 */
function approveProbationRestart(memberName) {
  var ss = getSpreadsheet_();
  var allMembers = readAllMembers_(ss);
  var member = null;
  for (var i = 0; i < allMembers.length; i++) {
    if (allMembers[i].name === memberName) { member = allMembers[i]; break; }
  }
  if (!member) throw new Error("Member not found.");
 
  var sheet = ss.getSheetByName(MEMBERS_SHEET);
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(function(x) { return x.toString().trim().toLowerCase(); });
 
  var probIdx = headers.indexOf("probation");
  var probStartIdx = headers.indexOf("probation start");
  var probEndIdx = headers.indexOf("probation end");
  var penaltyIdx = headers.indexOf("probation penalty");
  var ackedIdx = headers.indexOf("probation acknowledged");
  var statusIdx = headers.indexOf("status");
 
  var row = member.rowIndex;
  if (probIdx !== -1) sheet.getRange(row, probIdx + 1).setValue("Yes");
  if (probStartIdx !== -1) sheet.getRange(row, probStartIdx + 1).setValue(todayStr_());
  if (probEndIdx !== -1) sheet.getRange(row, probEndIdx + 1).setValue("");
  if (penaltyIdx !== -1) sheet.getRange(row, penaltyIdx + 1).setValue("");
  if (ackedIdx !== -1) sheet.getRange(row, ackedIdx + 1).setValue("");
  if (statusIdx !== -1) sheet.getRange(row, statusIdx + 1).setValue("Active");
 
  return { success: true, name: memberName };
}
 
// -------------------------------------------------------
//  MEMBER MANAGEMENT
// -------------------------------------------------------
function getMemberList() {
  var ss=getSpreadsheet_(),all=readAllMembers_(ss);
  all.sort(function(a,b){return a.name.localeCompare(b.name);});
  return all.map(function(m){return{name:m.name,email:m.email,phone:m.phone,admNo:m.admNo,groups:m.groups,roles:m.roles,active:m.active,
    probation:m.probation,probationPassed:m.probationPassed,probationFailed:m.probationFailed,probationStart:m.probationStart,probationEnd:m.probationEnd,
    profilePhoto:driveAvatarDataUri_(m.profilePhotoRaw)};});
}
 
/**
 * ADMIN — fetch a member's full editable data (Members + Member Details) for the
 * admin Edit Profile form. Keyed by current name. Returns operational fields plus
 * a `details` object with the extended Member Details fields.
 */
function getMemberForEdit(memberName) {
  var ss = getSpreadsheet_();
  var all = readAllMembers_(ss);
  var member = null;
  for (var i = 0; i < all.length; i++) {
    if (all[i].name === memberName) { member = all[i]; break; }
  }
  if (!member) throw new Error("Member not found: " + memberName);
 
  // Extended details from Member Details sheet
  var details = {};
  var detailSheet = ss.getSheetByName(MEMBER_DETAILS_SHEET);
  if (detailSheet) {
    var dmap = headerIndexMap_(detailSheet);
    var dd = detailSheet.getDataRange().getValues();
    for (var r = 1; r < dd.length; r++) {
      var rEmail = dd[r][1].toString().trim().toLowerCase();
      var rName = dd[r][0].toString().trim();
      if ((rEmail && member.email && rEmail === member.email.toLowerCase()) || rName === memberName) {
        var g = dmap["gender"], y = dmap["year of study"];
        details = {
          admissionNumber: dd[r][2].toString(),
          courseFaculty: dd[r][3].toString(),
          courseName: dd[r][4].toString(),
          nationality: dd[r][5].toString(),
          choirPart: dd[r][6].toString(),
          instruments: dd[r][7].toString(),
          nokName: dd[r][8].toString(),
          nokPhone: dd[r][9].toString(),
          nokRelationship: dd[r][10].toString(),
          nokResidence: dd[r][11].toString(),
          residence: dd[r][12].toString(),
          dateOfBirth: formatDobForInput_(dd[r][13]),
          phoneNumber: dd[r][14].toString(),
          passportNumber: dd[r][15].toString(),
          nationalIdNumber: dd[r][16].toString(),
          gender: g != null ? dd[r][g].toString() : "",
          yearOfStudy: y != null ? dd[r][y].toString() : "",
          memberStatus: dmap["member status"] != null ? dd[r][dmap["member status"]].toString() : ""
        };
        break;
      }
    }
  }
 
  return {
    name: member.name, email: member.email, phone: member.phone,
    admNo: member.admNo, groups: member.groups, roles: member.roles,
    choirPart: (member.roles && member.roles["Choir"]) || "",
    bandRole: (member.roles && member.roles["Band"]) || "",
    orchestraRole: (member.roles && member.roles["Orchestra"]) || "",
    active: member.active,
    profilePhoto: driveAvatarDataUri_(member.profilePhotoRaw),
    details: details
  };
}
 
/**
 * ADMIN — save edits to a member's profile. Handles BOTH the Members sheet
 * (operational) and the Member Details sheet (extended, behind the toggle).
 * If the name changes, cascades the rename across all sheets (identity key).
 *
 * @param {Object} p — {
 *   originalName (required — the row to edit),
 *   name, email, phone, admNo, groups[], choirPart, bandRole, orchestraRole,  // operational
 *   details: { courseFaculty, courseName, nationality, residence, dateOfBirth,
 *              passportNumber, nationalIdNumber, nokName, nokPhone, nokRelationship,
 *              nokResidence, gender, yearOfStudy }  // extended (optional block)
 * }
 */
function adminUpdateMember(p) {
  if (!p || !p.originalName) throw new Error("Missing member reference.");
  var ss = getSpreadsheet_();
  var membersSheet = ss.getSheetByName(MEMBERS_SHEET);
  if (!membersSheet) throw new Error("Members sheet not found.");
 
  var mData = membersSheet.getDataRange().getValues();
  var h = mData[0].map(function(x){ return x.toString().trim().toLowerCase(); });
  var col = function(name){ return h.indexOf(name); };
  var nameIdx = col("name");
 
  // Locate the member row by original name
  var rowIdx = -1;
  for (var i = 1; i < mData.length; i++) {
    if (mData[i][nameIdx].toString().trim() === p.originalName.trim()) { rowIdx = i; break; }
  }
  if (rowIdx === -1) throw new Error("Member not found: " + p.originalName);
  var sheetRow = rowIdx + 1;
 
  // Helper: set a Members cell by header if the column exists and value provided
  function setM(headerName, value) {
    var c = col(headerName);
    if (c !== -1 && value !== undefined && value !== null) {
      membersSheet.getRange(sheetRow, c + 1).setValue(value);
    }
  }
 
  // Operational fields (name handled separately via cascade)
  if (p.email !== undefined)  setM("email", p.email);
  if (p.phone !== undefined)  setM("phone", p.phone);
  if (p.admNo !== undefined)  setM("adm. no.", p.admNo);
  if (p.groups !== undefined) setM("groups", (p.groups || []).join(", "));
  if (p.choirPart !== undefined)      setM("choir part", p.choirPart);
  if (p.bandRole !== undefined)       setM("band role", p.bandRole);
  if (p.orchestraRole !== undefined)  setM("orchestra role", p.orchestraRole);
 
  // Extended details (Member Details sheet) — only if a details block was sent
  if (p.details) {
    var d = p.details;
    var detailSheet = ensureMemberDetailsSheet_(ss);
    var dmap = headerIndexMap_(detailSheet);
    var dd = detailSheet.getDataRange().getValues();
    var dRow = -1;
    for (var r = 1; r < dd.length; r++) {
      var rEmail = dd[r][1].toString().trim().toLowerCase();
      var rName = dd[r][0].toString().trim();
      if ((rEmail && p.email && rEmail === p.email.toLowerCase()) || rName === p.originalName.trim()) { dRow = r + 1; break; }
    }
    if (dRow === -1) {
      // No details row yet — create a minimal one
      detailSheet.appendRow([p.originalName, p.email || "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""]);
      dRow = detailSheet.getLastRow();
      dmap = headerIndexMap_(detailSheet);
    }
    function setD(headerName, value) {
      var c = dmap[headerName.toLowerCase()];
      if (c != null && value !== undefined && value !== null) {
        detailSheet.getRange(dRow, c + 1).setValue(value);
      }
    }
    setD("Course Faculty", d.courseFaculty);
    setD("Course Name", d.courseName);
    setD("Nationality", d.nationality);
    setD("Residence", d.residence);
    setD("Date of Birth", d.dateOfBirth);
    setD("Phone Number", d.phoneNumber !== undefined ? d.phoneNumber : p.phone);
    setD("Passport Number", d.passportNumber);
    setD("National ID Number", d.nationalIdNumber);
    setD("Next of Kin Name", d.nokName);
    setD("Next of Kin Phone", d.nokPhone);
    setD("Next of Kin Relationship", d.nokRelationship);
    setD("Next of Kin Residence", d.nokResidence);
    setD("Gender", d.gender);
    setD("Year of Study", d.yearOfStudy);
    if (d.memberStatus !== undefined) setD("Member Status", d.memberStatus);
  }
 
  // Name change LAST — cascade across all sheets (identity key). Do this after the
  // detail edits so the detail-row lookup above still matched the old name.
  var renamed = null;
  if (p.name !== undefined && p.name.trim() && p.name.trim() !== p.originalName.trim()) {
    renamed = cascadeMemberRename_(ss, p.originalName.trim(), p.name.trim());
  }
 
  refreshAllRegisters_(ss);
  return { success: true, name: (p.name || p.originalName).trim(), renamed: renamed };
}
 
function addMember(member) {
  var ss=getSpreadsheet_(),sheet=ss.getSheetByName(MEMBERS_SHEET);if(!sheet)throw new Error("Sheet '"+MEMBERS_SHEET+"' not found.");
  var data=sheet.getDataRange().getValues(),h=data[0].map(function(x){return x.toString().trim().toLowerCase();});
  var ni=h.indexOf("name");
  for(var i=1;i<data.length;i++){if(data[i][ni].toString().trim().toLowerCase()===member.name.trim().toLowerCase())throw new Error("'"+member.name.trim()+"' already exists.");}
  var row=[];
  for(var c=0;c<h.length;c++){
    var col=h[c];
    if(col==="name")row.push(member.name.trim());
    else if(col==="email")row.push(member.email||"");
    else if(col==="phone")row.push(member.phone||"");
    else if(col==="groups")row.push((member.groups||[]).join(", "));
    else if(col==="choir part")row.push(member.choirPart||"");
    else if(col==="band role")row.push(member.bandRole||"");
    else if(col==="orchestra role")row.push(member.orchestraRole||"");
    else if(col==="adm. no.")row.push(member.admNo||"");
    else if(col==="status")row.push("Active");
    else if(col==="probation")row.push(member.probation?"Yes":"");
    else if(col==="probation start")row.push(member.probation?(member.probationStart||todayStr_()):"");
    else if(col==="probation end")row.push("");
    else row.push("");
  }
  sheet.appendRow(row);
  return{success:true,name:member.name.trim()};
}
 
function todayStr_(){return Utilities.formatDate(new Date(),Session.getScriptTimeZone(),"yyyy-MM-dd");}
 
// -------------------------------------------------------
//  ONBOARDING (Phase 1 - New Member Pipeline)
// -------------------------------------------------------
 
var COURSE_FACULTIES = ["SCES", "SIMS", "SBS", "SHSS", "SLS", "STH", "SI", "Other"];
 
/**
 * Ensures the Member Details sheet exists with proper headers.
 */
function ensureMemberDetailsSheet_(ss) {
  var sheet = ss.getSheetByName(MEMBER_DETAILS_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(MEMBER_DETAILS_SHEET);
    sheet.appendRow([
      "Name", "Email", "Admission Number", "Course Faculty", "Course Name",
      "Nationality", "Choir Part", "Band/Orchestra Instruments",
      "Next of Kin Name", "Next of Kin Phone", "Next of Kin Relationship", "Next of Kin Residence",
      "Residence", "Date of Birth", "Phone Number", "Passport Number", "National ID Number",
      "Passport Photo URL", "Onboarding Completed", "Completed At", "Member Status",
      "Gender", "Year of Study"
    ]);
    sheet.getRange(1, 1, 1, 23).setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  // Migrate: add any missing columns at the end (keeps existing indices stable)
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(function(x){ return x.toString().trim().toLowerCase(); });
  function ensureCol(name) {
    if (headers.indexOf(name.toLowerCase()) === -1) {
      var col = sheet.getLastColumn() + 1;
      sheet.getRange(1, col).setValue(name).setFontWeight("bold");
      headers.push(name.toLowerCase());
    }
  }
  ensureCol("Member Status");
  ensureCol("Gender");
  ensureCol("Year of Study");
  return sheet;
}
 
/**
 * Returns a map of header-name (lowercase) -> column index (0-based) for a sheet.
 * Lets us read/write by column name instead of fragile numeric positions.
 */
function headerIndexMap_(sheet) {
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var map = {};
  for (var i = 0; i < headers.length; i++) {
    map[headers[i].toString().trim().toLowerCase()] = i;
  }
  return map;
}
 
/**
 * Sends a welcome email to a new member with onboarding instructions.
 * Called after addMember when the invite checkbox is checked.
 * @param {string} name
 * @param {string} email
 * @param {Array} groups
 */
function sendWelcomeEmail(name, email, groups) {
  if (!email) throw new Error("No email provided for " + name);
 
  var webAppUrl = APP_URL || ScriptApp.getService().getUrl();
 
  try {
    var htmlBody = renderEmailTemplate_("welcome-invite", {
      memberName: name,
      groups: groups.join(", "),
      appUrl: webAppUrl,
      probationSessions: PROBATION_SESSIONS,
      threshold: Math.round(PROBATION_THRESHOLD * 100)
    });
 
    MailApp.sendEmail({
      to: email,
      cc: EMAIL_CC,
      subject: "Welcome to Strathmore Chorale!",
      htmlBody: htmlBody,
      name: EMAIL_FROM_NAME
    });
 
    return { success: true };
  } catch(e) {
    throw new Error("Failed to send welcome email: " + e.message);
  }
}
 
/**
 * Returns the onboarding status for the logged-in member.
 */
function getOnboardingStatus() {
  var ss = getSpreadsheet_();
  var email = Session.getActiveUser().getEmail();
  if (!email) return { completed: true }; // Fail safe
 
  var member = findMemberByEmail_(ss, email.toLowerCase());
  if (!member) return { completed: true };
 
  // Check if onboarding exists in Member Details
  var sheet = ss.getSheetByName(MEMBER_DETAILS_SHEET);
  if (!sheet) return { completed: false, name: member.name, email: member.email, groups: member.groups };
 
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    var rEmail = data[i][1].toString().trim().toLowerCase();
    var rName = data[i][0].toString().trim().toLowerCase();
    var emailMatch = rEmail && rEmail === email.toLowerCase();
    var nameMatch = rName && rName === member.name.toLowerCase();
    if (emailMatch || nameMatch) {
      var completed = data[i][18] && data[i][18].toString().trim().toLowerCase() === "yes";
      return { completed: completed, name: member.name, email: member.email, groups: member.groups };
    }
  }
 
  return { completed: false, name: member.name, email: member.email, groups: member.groups };
}
 
/**
 * Returns previously-saved onboarding data for the logged-in member, for pre-filling
 * a resumed onboarding form. Empty fields come back as "" so the UI can flag them.
 * The passport photo is returned both as the stored URL and a displayable data URI.
 */
function getOnboardingData() {
  var ss = getSpreadsheet_();
  var email = Session.getActiveUser().getEmail();
  if (!email) throw new Error("Could not detect your email.");
  var member = findMemberByEmail_(ss, email.toLowerCase());
  if (!member) throw new Error("No member found.");
 
  var empty = {
    name: member.name, email: member.email, groups: member.groups,
    admissionNumber: member.admNo || "", courseFaculty: "", courseName: "",
    nationality: "", choirPart: (member.roles && member.roles["Choir"]) || "",
    bandRole: (member.roles && member.roles["Band"]) || "",
    orchestraRole: (member.roles && member.roles["Orchestra"]) || "",
    residence: "", dateOfBirth: "", phoneNumber: member.phone || "",
    passportNumber: "", nationalIdNumber: "",
    nokName: "", nokPhone: "", nokRelationship: "", nokResidence: "",
    gender: "", yearOfStudy: "",
    photoUrl: "", photoDataUri: "", hasExistingRow: false
  };
 
  var sheet = ss.getSheetByName(MEMBER_DETAILS_SHEET);
  if (!sheet) return empty;
  var dmap = headerIndexMap_(sheet);
 
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    var rowEmail = data[i][1].toString().trim().toLowerCase();
    var rowName = data[i][0].toString().trim().toLowerCase();
    // Match by email if present, else fall back to name (handles manually-added rows
    // that have a name but blank/mismatched email)
    var emailMatch = rowEmail && rowEmail === email.toLowerCase();
    var nameMatch = rowName && rowName === member.name.toLowerCase();
    if (emailMatch || nameMatch) {
      var r = data[i];
      // Member Details columns:
      // 0 Name 1 Email 2 AdmNo 3 Faculty 4 Course 5 Nationality 6 ChoirPart 7 Instruments
      // 8 NokName 9 NokPhone 10 NokRel 11 NokRes 12 Residence 13 DOB 14 Phone
      // 15 Passport 16 NatID 17 PhotoUrl 18 Completed 19 CompletedAt
      // (Gender / Year of Study read by header — appended columns)
      var instruments = r[7].toString();
      // Instruments stored as "Band / Orchestra" — split back out
      var bandRole = "", orchRole = "";
      if (instruments.indexOf(" / ") !== -1) {
        var parts = instruments.split(" / ");
        bandRole = parts[0] || ""; orchRole = parts[1] || "";
      } else if (instruments) {
        // Single value — assign to whichever group the member is in
        if (member.groups.indexOf("Band") !== -1) bandRole = instruments;
        else if (member.groups.indexOf("Orchestra") !== -1) orchRole = instruments;
      }
 
      var genderIdx = dmap["gender"];
      var yearIdx = dmap["year of study"];
      var photoUrl = r[17].toString();
      return {
        name: member.name, email: member.email, groups: member.groups,
        admissionNumber: r[2].toString() || (member.admNo || ""),
        courseFaculty: r[3].toString(),
        courseName: r[4].toString(), nationality: r[5].toString(),
        choirPart: r[6].toString() || (member.roles && member.roles["Choir"]) || "",
        bandRole: bandRole || (member.roles && member.roles["Band"]) || "",
        orchestraRole: orchRole || (member.roles && member.roles["Orchestra"]) || "",
        residence: r[12].toString(),
        dateOfBirth: formatDobForInput_(r[13]),
        phoneNumber: r[14].toString() || (member.phone || ""),
        passportNumber: r[15].toString(),
        nationalIdNumber: r[16].toString(),
        nokName: r[8].toString(), nokPhone: r[9].toString(),
        nokRelationship: r[10].toString(), nokResidence: r[11].toString(),
        gender: genderIdx != null ? r[genderIdx].toString() : "",
        yearOfStudy: yearIdx != null ? r[yearIdx].toString() : "",
        photoUrl: photoUrl,
        photoDataUri: photoUrl ? driveImageToDataUri_(photoUrl) : "",
        hasExistingRow: true
      };
    }
  }
 
  return empty;
}
 
/**
 * Formats a DOB cell value (Date object or string) into YYYY-MM-DD
 * so an <input type="date"> can pre-fill it.
 */
function formatDobForInput_(v) {
  if (v === "" || v == null) return "";
  if (Object.prototype.toString.call(v) === "[object Date]" && !isNaN(v)) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), "yyyy-MM-dd");
  }
  var s = v.toString().trim();
  // Already ISO?
  var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    return m[1] + "-" + ("0"+m[2]).slice(-2) + "-" + ("0"+m[3]).slice(-2);
  }
  // d/m/y or d.m.y
  m = s.match(/^(\d{1,2})[\/.](\d{1,2})[\/.](\d{2,4})/);
  if (m) {
    var yr = m[3].length === 2 ? "19"+m[3] : m[3];
    return yr + "-" + ("0"+m[2]).slice(-2) + "-" + ("0"+m[1]).slice(-2);
  }
  // Try native parse
  var p = new Date(s);
  if (!isNaN(p)) return Utilities.formatDate(p, Session.getScriptTimeZone(), "yyyy-MM-dd");
  return "";
}
 
/**
 * Reads dropdown lists from the Config sheet — the single source of truth.
 * Config sheet layout (column per list, header in row 1):
 *   Choir Parts | Band Roles | Orchestra Roles | Faculties
 *   Soprano     | Vocalist   | Violin          | SCES
 *   Alto        | Guitar     | Viola           | SIMS
 *   ...
 * Falls back to built-in defaults if the sheet or a column is missing.
 */
function getConfigLists() {
  var ss = getSpreadsheet_();
  var defaults = {
    choirParts: ["Soprano", "Alto", "Tenor", "Bass"],
    bandRoles: ["Vocalist", "Guitar", "Bass Guitar", "Keyboard", "Drums"],
    orchestraRoles: ["Violin", "Viola", "Cello", "Double Bass", "Flute"],
    faculties: ["SCES", "SIMS", "SBS", "SHSS", "SLS", "STH", "SI", "Other"]
  };
 
  var sheet = ss.getSheetByName(CONFIG_SHEET);
  if (!sheet) return defaults;
 
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return defaults;
 
  var headers = data[0].map(function(x) { return x.toString().trim().toLowerCase(); });
  var ci = headers.indexOf("choir parts");
  var bi = headers.indexOf("band roles");
  var oi = headers.indexOf("orchestra roles");
  var fi = headers.indexOf("faculties");
 
  function colValues(idx) {
    if (idx === -1) return null;
    var vals = [];
    for (var r = 1; r < data.length; r++) {
      var v = data[r][idx].toString().trim();
      if (v) vals.push(v);
    }
    return vals.length > 0 ? vals : null;
  }
 
  return {
    choirParts: colValues(ci) || defaults.choirParts,
    bandRoles: colValues(bi) || defaults.bandRoles,
    orchestraRoles: colValues(oi) || defaults.orchestraRoles,
    faculties: colValues(fi) || defaults.faculties
  };
}
 
/**
 * Returns course faculties list (kept for backwards compatibility).
 */
function getCourseFaculties() {
  return getConfigLists().faculties;
}
 
/**
 * Member submits their onboarding details.
 * Saves to Member Details sheet and updates relevant fields in Members sheet.
 */
function submitOnboarding(data) {
  var ss = getSpreadsheet_();
  var email = Session.getActiveUser().getEmail();
  if (!email) throw new Error("Could not detect your email.");
  var member = findMemberByEmail_(ss, email.toLowerCase());
  if (!member) throw new Error("No member found for " + email);
 
  var d = {
    nationality: data.nationality || "",
    residence: data.residence || "",
    dateOfBirth: data.dateOfBirth || "",
    phoneNumber: data.phoneNumber || "",
    passportNumber: data.passportNumber || "",
    nationalIdNumber: data.nationalIdNumber || "",
    nokName: data.nokName || "",
    nokPhone: data.nokPhone || "",
    nokRelationship: data.nokRelationship || "",
    nokResidence: data.nokResidence || "",
    photoUrl: data.photoUrl || "",
    gender: data.gender || "",
    yearOfStudy: data.yearOfStudy || "",
    // Optional confirm fields — member may fill if admin left blank
    admissionNumber: data.admissionNumber || "",
    choirPart: data.choirPart || "",
    bandRole: data.bandRole || "",
    orchestraRole: data.orchestraRole || ""
  };
 
  var detailSheet = ensureMemberDetailsSheet_(ss);
  var now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
 
  // Pull existing values from Members sheet (admin-entered) to store in details
  var membersSheet = ss.getSheetByName(MEMBERS_SHEET);
  var mHeaders = membersSheet.getRange(1, 1, 1, membersSheet.getLastColumn()).getValues()[0]
    .map(function(x) { return x.toString().trim().toLowerCase(); });
  var existingAdm = member.admNo || "";
  var existingChoir = member.roles && member.roles["Choir"] ? member.roles["Choir"] : "";
  var existingBand = member.roles && member.roles["Band"] ? member.roles["Band"] : "";
  var existingOrch = member.roles && member.roles["Orchestra"] ? member.roles["Orchestra"] : "";
 
  // Use member-provided value if given, else fall back to admin-entered
  var finalAdm = d.admissionNumber || existingAdm;
  var finalChoir = d.choirPart || existingChoir;
  var finalBand = d.bandRole || existingBand;
  var finalOrch = d.orchestraRole || existingOrch;
  var instrumentsCombined = [finalBand, finalOrch].filter(Boolean).join(" / ");
 
  // Check if row already exists for this member
  var detailData = detailSheet.getDataRange().getValues();
  var existingRow = -1;
  var existingPhotoUrl = "";
  for (var i = 1; i < detailData.length; i++) {
    var rEmail = detailData[i][1].toString().trim().toLowerCase();
    var rName = detailData[i][0].toString().trim().toLowerCase();
    var emailMatch = rEmail && rEmail === email.toLowerCase();
    var nameMatch = rName && rName === member.name.toLowerCase();
    if (emailMatch || nameMatch) {
      existingRow = i + 1;
      existingPhotoUrl = detailData[i][17].toString();
      break;
    }
  }
 
  // Preserve existing photo if no new one was uploaded
  var finalPhotoUrl = d.photoUrl || existingPhotoUrl;
 
  // If updating an existing row, preserve any previously-saved value when the
  // incoming field is blank (so a partial re-submit doesn't wipe saved data).
  var prev = existingRow > 0 ? detailData[existingRow - 1] : null;
  function keep(incoming, prevIdx) {
    if (incoming !== "" && incoming != null) return incoming;
    return prev ? prev[prevIdx].toString() : "";
  }
 
  // Preserve any existing Member Status value (don't blank it on re-submit)
  var existingStatus = "Active";
  if (existingRow > 0) {
    var statusHeaders = detailSheet.getRange(1, 1, 1, detailSheet.getLastColumn()).getValues()[0]
      .map(function(x){ return x.toString().trim().toLowerCase(); });
    var statusIdx = statusHeaders.indexOf("member status");
    if (statusIdx !== -1) {
      var sv = detailSheet.getRange(existingRow, statusIdx + 1).getValue().toString().trim();
      if (sv) existingStatus = sv;
    }
  }
 
  var row = [
    member.name, email,
    keep(finalAdm, 2), keep(data.courseFaculty || "", 3), keep(data.courseName || "", 4),
    keep(d.nationality, 5), keep(finalChoir, 6), keep(instrumentsCombined, 7),
    keep(d.nokName, 8), keep(d.nokPhone, 9), keep(d.nokRelationship, 10), keep(d.nokResidence, 11),
    keep(d.residence, 12), keep(d.dateOfBirth, 13), keep(d.phoneNumber, 14),
    keep(d.passportNumber, 15), keep(d.nationalIdNumber, 16),
    finalPhotoUrl, "Yes", now
  ];
 
  if (existingRow > 0) {
    // Update only the first 20 columns (preserve Member Status / Gender / Year by header below)
    detailSheet.getRange(existingRow, 1, 1, 20).setValues([row]);
  } else {
    detailSheet.appendRow(row);
    existingRow = detailSheet.getLastRow();
  }
 
  // Write Gender and Year of Study by header name (position-independent).
  // Preserve existing value when the incoming field is blank.
  var dmap = headerIndexMap_(detailSheet);
  function writeByHeader(headerName, val, prevRowVals) {
    var idx = dmap[headerName.toLowerCase()];
    if (idx == null) return;
    var finalVal = (val !== "" && val != null) ? val
      : (prevRowVals && prevRowVals[idx] != null ? prevRowVals[idx].toString() : "");
    if (finalVal !== "") detailSheet.getRange(existingRow, idx + 1).setValue(finalVal);
  }
  writeByHeader("Gender", d.gender, prev);
  writeByHeader("Year of Study", d.yearOfStudy, prev);
 
  // Update Members sheet operational fields
  if (membersSheet) {
    var mRow = member.rowIndex;
    var phoneIdx = mHeaders.indexOf("phone");
    var admIdx = mHeaders.indexOf("adm. no.");
    var cpIdx = mHeaders.indexOf("choir part");
    var brIdx = mHeaders.indexOf("band role");
    var orIdx = mHeaders.indexOf("orchestra role");
 
    if (phoneIdx !== -1 && d.phoneNumber) membersSheet.getRange(mRow, phoneIdx + 1).setValue(d.phoneNumber);
    if (admIdx !== -1 && finalAdm) membersSheet.getRange(mRow, admIdx + 1).setValue(finalAdm);
    if (cpIdx !== -1 && finalChoir) membersSheet.getRange(mRow, cpIdx + 1).setValue(finalChoir);
    if (brIdx !== -1 && finalBand) membersSheet.getRange(mRow, brIdx + 1).setValue(finalBand);
    if (orIdx !== -1 && finalOrch) membersSheet.getRange(mRow, orIdx + 1).setValue(finalOrch);
  }
 
  // Send notification to admin
  try {
    d.groups = member.groups.join(", ");
    d.instruments = instrumentsCombined;
    d.choirPart = finalChoir;
    d.courseFaculty = data.courseFaculty || "";
    d.courseName = data.courseName || "";
    sendOnboardingNotification_(member.name, email, d);
  } catch(e) {}
 
  return { success: true, name: member.name };
}
 
/**
 * Uploads a passport photo to Google Drive.
 * @param {string} base64Data — base64-encoded file content
 * @param {string} fileName — original filename
 * @param {string} mimeType — e.g. "image/jpeg"
 * @returns {Object} { success, url }
 */
function uploadPassportPhoto(base64Data, fileName, mimeType) {
  var ss = getSpreadsheet_();
  var email = Session.getActiveUser().getEmail();
  if (!email) throw new Error("Could not detect your email.");
  var member = findMemberByEmail_(ss, email.toLowerCase());
  if (!member) throw new Error("No member found.");
 
  var folder;
  try {
    folder = DriveApp.getFolderById(PHOTO_FOLDER_ID);
  } catch(e) {
    throw new Error("Photo folder not found. Contact admin to set up the PHOTO_FOLDER_ID.");
  }
 
  // Decode base64
  var decoded = Utilities.base64Decode(base64Data);
  var ext = (fileName && fileName.indexOf(".") !== -1) ? fileName.split(".").pop() : "jpg";
  var blob = Utilities.newBlob(decoded, mimeType || "image/jpeg", "Passport_" + member.name.replace(/[^a-zA-Z0-9]/g, "_") + "." + ext);
 
  // Check for existing file and remove
  var existing = folder.getFilesByName(blob.getName());
  while (existing.hasNext()) { existing.next().setTrashed(true); }
 
  // Save new file
  var file = folder.createFile(blob);
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch(e) {
    // Org may restrict link sharing — file is still saved, continue
  }
  var fileId = file.getId();
  // Use direct-content URL so the image renders in <img> tags
  var url = "https://drive.google.com/thumbnail?id=" + fileId + "&sz=w400";
 
  return { success: true, url: url };
}
 
/**
 * Sends admin notification that a member completed onboarding.
 */
function sendOnboardingNotification_(name, email, data) {
  var subject = "Onboarding Complete — " + name;
  var sectionRole = [data.choirPart, data.instruments].filter(Boolean).join(" · ");
  var webAppUrl = APP_URL || ScriptApp.getService().getUrl();
 
  var html = renderEmailTemplate_("onboarding-complete", {
    memberName: name,
    groups: (data.groups || ""),
    sectionRole: sectionRole || "—",
    gender: data.gender || "—",
    email: email,
    phone: data.phoneNumber || "—",
    admNo: data.admissionNumber || "—",
    faculty: data.courseFaculty || "—",
    course: data.courseName || "—",
    yearOfStudy: data.yearOfStudy || "—",
    nationality: data.nationality || "—",
    dateOfBirth: data.dateOfBirth || "—",
    residence: data.residence || "—",
    passportNumber: data.passportNumber || "—",
    nationalIdNumber: data.nationalIdNumber || "—",
    nokName: data.nokName || "—",
    nokRelationship: data.nokRelationship || "—",
    nokPhone: data.nokPhone || "—",
    nokResidence: data.nokResidence || "—",
    photoUrl: data.photoUrl || "",
    appUrl: webAppUrl
  }, { signatureKey: null });
 
  MailApp.sendEmail({
    to: EMAIL_CC,
    subject: subject,
    htmlBody: html,
    name: EMAIL_FROM_NAME
  });
}
 
// -------------------------------------------------------
//  COMMUNICATION (Phase 3)
// -------------------------------------------------------
 
/**
 * Returns admin emails from the Admins sheet.
 */
// -------------------------------------------------------
//  EMAIL LAYOUT & SIGNATURES
// -------------------------------------------------------
 
/**
 * Wraps email body content in the shared letterhead layout and appends a signature.
 * Every outgoing email should pass through this for a consistent look.
 *
 * @param {string} bodyHtml — the inner content (already HTML)
 * @param {Object} opts — { headerTitle, headerSubtitle, signatureKey, accentColor }
 * @returns {string} full HTML email
 */
/**
 * Loads an email template file, fills {{tokens}}, and renders it through EmailLayout.
 * Templates use <!--META title/subtitle-->, <!--BODY-->...<!--/BODY-->, <!--SIG-->...<!--/SIG-->.
 *
 * @param {string} templateName — Apps Script HTML file name (without .html)
 * @param {Object} tokens — { tokenName: value } pairs to substitute for {{tokenName}}
 * @param {Object} opts — optional overrides:
 *        { signatureKey } — use a sheet signature instead of the template's own SIG block
 *        { title, subtitle } — override the META values
 *        { standalone } — if true, return the filled BODY directly (no EmailLayout wrap)
 * @returns {string} full email HTML
 */
function renderEmailTemplate_(templateName, tokens, opts) {
  opts = opts || {};
  var raw;
  try {
    raw = HtmlService.createHtmlOutputFromFile(templateName).getContent();
  } catch(e) {
    throw new Error("Email template not found: " + templateName);
  }
 
  // Extract META (title / subtitle)
  var metaTitle = "", metaSubtitle = "";
  var metaMatch = raw.match(/<!--META([\s\S]*?)-->/);
  if (metaMatch) {
    var tm = metaMatch[1].match(/title:\s*(.*)/);
    var sm = metaMatch[1].match(/subtitle:\s*(.*)/);
    if (tm) metaTitle = tm[1].trim();
    if (sm) metaSubtitle = sm[1].trim();
  }
 
  // Extract BODY block
  var bodyMatch = raw.match(/<!--BODY-->([\s\S]*?)<!--\/BODY-->/);
  var body = bodyMatch ? bodyMatch[1] : raw;
 
  // Extract SIG block (optional — template may define its own)
  var sigMatch = raw.match(/<!--SIG-->([\s\S]*?)<!--\/SIG-->/);
  var templateSig = sigMatch ? sigMatch[1] : "";
 
  // Fill tokens in body, sig, and meta strings
  function fill(str) {
    if (!str) return str;
    for (var k in tokens) {
      var val = tokens[k] == null ? "" : String(tokens[k]);
      str = str.split("{{" + k + "}}").join(val);
    }
    return str;
  }
  body = fill(body);
  templateSig = fill(templateSig);
  metaTitle = fill(opts.title || metaTitle);
  metaSubtitle = fill(opts.subtitle || metaSubtitle);
 
  // Standalone templates (e.g. birthday card) render the body as-is, no letterhead
  if (opts.standalone) return body;
 
  // Signature: a sheet signature key overrides the template's own SIG block
  var sigHtml = opts.signatureKey ? getSignatureHtml_(opts.signatureKey) : templateSig;
 
  // Render through EmailLayout
  try {
    var layout = HtmlService.createTemplateFromFile("EmailLayout");
    layout.headerTitle = metaTitle || "Strathmore Chorale";
    layout.headerSubtitle = metaSubtitle || "";
    layout.bodyContent = body;
    layout.signatureHtml = sigHtml;
    return layout.evaluate().getContent();
  } catch(e) {
    return body + sigHtml;
  }
}
 
function buildEmail_(bodyHtml, opts) {
  opts = opts || {};
  var headerTitle = opts.headerTitle || "Strathmore Chorale";
  var headerSubtitle = opts.headerSubtitle || "";
  var signatureKey = opts.signatureKey || "general";
 
  var sigHtml = getSignatureHtml_(signatureKey);
 
  try {
    var template = HtmlService.createTemplateFromFile("EmailLayout");
    template.headerTitle = headerTitle;
    template.headerSubtitle = headerSubtitle;
    template.bodyContent = bodyHtml;
    template.signatureHtml = sigHtml;
    return template.evaluate().getContent();
  } catch(e) {
    // Fallback if layout file missing — body + signature only
    return bodyHtml + sigHtml;
  }
}
 
/**
 * Returns the HTML signature for a given key from the Signatures sheet.
 * Falls back to the Gmail signature file (EmailSignature.html) for "general",
 * or a minimal text signature if nothing is found.
 *
 * Signatures sheet layout:
 *   Key | Name | Title | Email | Phone
 *   general | Strathmore Chorale | Attendance System | chorale@... |
 *   chairperson | Raphael K. | Chairperson | raphael@... | +254...
 */
function getSignatureHtml_(key) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(SIGNATURES_SHEET);
 
  if (sheet) {
    var data = sheet.getDataRange().getValues();
    var headers = data[0].map(function(x){ return x.toString().trim().toLowerCase(); });
    var ki = headers.indexOf("key"), ni = headers.indexOf("name"),
        ti = headers.indexOf("title"), ei = headers.indexOf("email"), pi = headers.indexOf("phone");
    for (var i = 1; i < data.length; i++) {
      if (data[i][ki].toString().trim().toLowerCase() === key.toLowerCase()) {
        var name = ni!==-1 ? data[i][ni].toString() : "";
        var title = ti!==-1 ? data[i][ti].toString() : "";
        var sigEmail = ei!==-1 ? data[i][ei].toString() : "";
        var phone = pi!==-1 ? data[i][pi].toString() : "";
        return buildTextSignature_(name, title, sigEmail, phone);
      }
    }
  }
 
  // Fallback for "general" — use the full Gmail signature file if present
  if (key === "general") {
    try {
      return HtmlService.createHtmlOutputFromFile("EmailSignature").getContent();
    } catch(e) {}
  }
 
  return buildTextSignature_("Strathmore Chorale", "", "", "");
}
 
/** Builds a simple HTML signature block from fields. */
function buildTextSignature_(name, title, email, phone) {
  var h = '<div style="margin-top:8px;font-family:-apple-system,sans-serif;font-size:0.85rem;color:#64748b;line-height:1.5;">';
  if (name) h += '<p style="margin:0;font-weight:600;color:#1e293b;">' + name + '</p>';
  if (title) h += '<p style="margin:2px 0;">' + title + '</p>';
  if (email) h += '<p style="margin:2px 0;"><a href="mailto:' + email + '" style="color:#2563eb;text-decoration:none;">' + email + '</a></p>';
  if (phone) h += '<p style="margin:2px 0;">' + phone + '</p>';
  h += '</div>';
  return h;
}
 
/**
 * Returns the list of available signature keys (for the admin to choose from).
 */
function getSignatureOptions() {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(SIGNATURES_SHEET);
  var options = [{ key: "general", label: "General (automated)" }];
  if (!sheet) return options;
  var data = sheet.getDataRange().getValues();
  var headers = data[0].map(function(x){ return x.toString().trim().toLowerCase(); });
  var ki = headers.indexOf("key"), ni = headers.indexOf("name"), ti = headers.indexOf("title");
  for (var i = 1; i < data.length; i++) {
    var key = data[i][ki].toString().trim();
    if (!key || key.toLowerCase() === "general") continue;
    var name = ni!==-1 ? data[i][ni].toString() : key;
    var title = ti!==-1 ? data[i][ti].toString() : "";
    options.push({ key: key, label: name + (title ? " — " + title : "") });
  }
  return options;
}
 
// -------------------------------------------------------
//  COMMUNIQUÉ (admin message sender)
// -------------------------------------------------------
 
/**
 * Returns recipient options for the communiqué composer:
 * groups available, plus the full member roster for individual selection.
 */
function getCommuniqueRecipientOptions() {
  var ss = getSpreadsheet_();
  var all = readAllMembers_(ss);
  var members = [];
  for (var i = 0; i < all.length; i++) {
    if (!all[i].active || !all[i].email) continue;
    members.push({ name: all[i].name, email: all[i].email, groups: all[i].groups });
  }
  members.sort(function(a, b) { return a.name.localeCompare(b.name); });
  return {
    groups: GROUPS,
    members: members,
    signatures: getSignatureOptions()
  };
}
 
/**
 * Sends a communiqué to selected recipients using the letterhead layout.
 * @param {Object} payload — {
 *   subject, body, signatureKey,
 *   recipientType: "all" | "groups" | "individuals" | "admins",
 *   groups: [..], emails: [..],   // depending on recipientType
 *   ccAdmins: bool
 * }
 */
function sendCommunique(payload) {
  var ss = getSpreadsheet_();
  if (!payload.subject || !payload.subject.trim()) throw new Error("Subject is required.");
  if (!payload.body || !payload.body.trim()) throw new Error("Message body is required.");
 
  var recipients = [];
  var rtype = payload.recipientType || "all";
 
  if (rtype === "admins") {
    recipients = getAdminEmails_(ss);
  } else {
    var all = readAllMembers_(ss);
    for (var i = 0; i < all.length; i++) {
      var m = all[i];
      if (!m.active || !m.email) continue;
      if (m.probation && m.probationFailed) continue; // skip failed members
 
      if (rtype === "all") {
        recipients.push(m.email);
      } else if (rtype === "groups") {
        var inGroup = m.groups.some(function(g) { return (payload.groups || []).indexOf(g) !== -1; });
        if (inGroup) recipients.push(m.email);
      } else if (rtype === "individuals") {
        if ((payload.emails || []).indexOf(m.email) !== -1) recipients.push(m.email);
      }
    }
  }
 
  // Dedupe
  var seen = {}, unique = [];
  for (var r = 0; r < recipients.length; r++) {
    var e = recipients[r].toLowerCase();
    if (!seen[e]) { seen[e] = true; unique.push(recipients[r]); }
  }
  recipients = unique;
 
  if (recipients.length === 0) throw new Error("No recipients matched your selection.");
 
  // Convert the plain-text body into HTML paragraphs
  var bodyHtml = communiqueBodyToHtml_(payload.body);
 
  var html = buildEmail_(bodyHtml, {
    headerTitle: payload.subject,
    signatureKey: payload.signatureKey || "general"
  });
 
  var ccAdmins = "";
  if (payload.ccAdmins) {
    var admins = getAdminEmails_(ss);
    if (admins.length > 0) ccAdmins = admins.join(",");
  }
 
  return sendBulkBcc_(recipients, payload.subject, html, { cc: ccAdmins });
}
 
/**
 * Converts plain text (with line breaks) into safe HTML paragraphs.
 * Double newline = new paragraph; single newline = <br>.
 */
function communiqueBodyToHtml_(text) {
  var escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  var paragraphs = escaped.split(/\n\s*\n/);
  var html = "";
  for (var i = 0; i < paragraphs.length; i++) {
    var p = paragraphs[i].trim();
    if (!p) continue;
    p = p.replace(/\n/g, "<br>");
    html += '<p style="font-size:14px;line-height:1.65;margin:0 0 14px;color:#2A2522;">' + p + '</p>';
  }
  return html;
}
 
// -------------------------------------------------------
//  COMMUNICATION (Phase 3)
// -------------------------------------------------------
 
function getAdminEmails_(ss) {
  var sheet = ss.getSheetByName(ADMINS_SHEET);
  if (!sheet) return [];
  var data = sheet.getDataRange().getValues();
  var emails = [];
  for (var i = 1; i < data.length; i++) {
    var e = data[i][0].toString().trim();
    if (e) emails.push(e);
  }
  return emails;
}
 
/**
 * Sends one HTML email to many recipients via BCC, in batches to stay under the
 * per-message recipient cap, and checks the daily quota up front so we never
 * half-deliver. Each batch is one message; total recipients count toward the daily quota.
 *
 * @param {Array} recipients — email addresses (BCC'd)
 * @param {string} subject
 * @param {string} htmlBody
 * @param {Object} opts — { fromName, toHeader, cc, batchSize }
 * @returns {Object} { success, count, batches }
 */
function sendBulkBcc_(recipients, subject, htmlBody, opts) {
  opts = opts || {};
  var batchSize = opts.batchSize || 50;   // well under the per-message cap
  var fromName = opts.fromName || EMAIL_FROM_NAME;
  var toHeader = opts.toHeader || (EMAIL_FROM_NAME + " <" + (getAdminEmails_(getSpreadsheet_())[0] || EMAIL_CC) + ">");
 
  // Dedupe
  var seen = {}, unique = [];
  for (var r = 0; r < recipients.length; r++) {
    var e = (recipients[r] || "").toString().trim();
    if (e && !seen[e.toLowerCase()]) { seen[e.toLowerCase()] = true; unique.push(e); }
  }
  recipients = unique;
  if (recipients.length === 0) throw new Error("No recipients.");
 
  // Up-front quota check — refuse rather than half-send
  var remaining = MailApp.getRemainingDailyQuota();
  if (recipients.length > remaining) {
    throw new Error("Not enough email quota today: need " + recipients.length +
      ", but only " + remaining + " sends remain. Try again tomorrow or send to fewer people.");
  }
 
  // Send in batches
  var batches = 0;
  for (var i = 0; i < recipients.length; i += batchSize) {
    var slice = recipients.slice(i, i + batchSize);
    var mail = {
      to: toHeader,
      bcc: slice.join(","),
      subject: subject,
      htmlBody: htmlBody,
      name: fromName
    };
    if (opts.cc && batches === 0) mail.cc = opts.cc; // CC admins on first batch only
    MailApp.sendEmail(mail);
    batches++;
  }
 
  return { success: true, count: recipients.length, batches: batches };
}
 
/**
 * Sends a practice reminder to all active members in the given groups.
 * @param {string} dateStr — session date
 * @param {Array} groups — which groups to remind
 * @param {string} time — session time (optional, for the message)
 * @param {string} customNote — optional extra note from admin
 */
function sendPracticeReminder(dateStr, groups, time, customNote, signatureKey) {
  var ss = getSpreadsheet_();
  var allMembers = readAllMembers_(ss);
 
  // Collect recipients: active members in any of the target groups
  var recipients = [];
  for (var i = 0; i < allMembers.length; i++) {
    var m = allMembers[i];
    if (!m.active || !m.email) continue;
    if (m.probation && m.probationFailed) continue; // skip failed
    var inGroup = m.groups.some(function(g) { return groups.indexOf(g) !== -1; });
    if (inGroup) recipients.push(m.email);
  }
 
  if (recipients.length === 0) return { success: false, count: 0, message: "No recipients found." };
 
  // Format date nicely
  var dParts = dateStr.split("-");
  var dObj = new Date(parseInt(dParts[0]), parseInt(dParts[1]) - 1, parseInt(dParts[2]));
  var dayNames = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  var monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  var niceDate = dayNames[dObj.getDay()] + ", " + dObj.getDate() + " " + monthNames[dObj.getMonth()] + " " + dObj.getFullYear();
 
  var webAppUrl = APP_URL || ScriptApp.getService().getUrl();
 
  // Build the optional note block (full table) only when there's a note
  var noteBlock = "";
  if (customNote) {
    noteBlock = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F3E9CE;border:1px solid #C9A658;border-radius:12px;margin:0 0 18px;">' +
      '<tr><td style="padding:16px 22px;">' +
      '<p style="margin:0 0 6px;font-family:\'Courier New\',Courier,monospace;font-size:10px;letter-spacing:2px;color:#8E6A2A;text-transform:uppercase;font-weight:bold;">A note from the team</p>' +
      '<p style="margin:0;font-size:13px;line-height:1.6;color:#2A2522;">' + customNote + '</p>' +
      '</td></tr></table>';
  }
 
  // The reminder is a BCC blast, so greet generically rather than per-person.
  var html = renderEmailTemplate_("rehearsal-reminder", {
    firstName: "Chorister",
    sessionDate: niceDate,
    sessionTime: time ? formatTime12_(time) : "See schedule",
    sections: groups.join(", "),
    noteBlock: noteBlock,
    appUrl: webAppUrl
  }, { signatureKey: (signatureKey && signatureKey !== "general") ? signatureKey : null, subtitle: niceDate });
 
  return sendBulkBcc_(recipients, "Rehearsal Reminder — " + niceDate, html, {});
}
 
/**
 * Emails the attendance summary for a session to all admins.
 * @param {string} dateStr
 * @param {string} group — group filter or "All"
 */
function emailAttendanceSummary(dateStr, group) {
  var ss = getSpreadsheet_();
  var result = getAttendanceForDate(dateStr, group || "All");
  if (!result.records || result.records.length === 0) {
    return { success: false, message: "No attendance records for this date." };
  }
 
  var adminEmails = getAdminEmails_(ss);
  if (adminEmails.length === 0) return { success: false, message: "No admin emails found." };
 
  // Format date
  var dParts = dateStr.split("-");
  var dObj = new Date(parseInt(dParts[0]), parseInt(dParts[1]) - 1, parseInt(dParts[2]));
  var dayNames = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  var niceDate = dayNames[dObj.getDay()] + ", " + dateStr;
 
  var subject = "Attendance Summary — " + niceDate;
  var body = "";
 
  // Summary counts per group
  for (var g in result.summary) {
    body += '<h3 style="margin:16px 0 8px;font-size:15px;font-family:Georgia,serif;">' + g + '</h3>';
    body += '<table style="width:100%;font-size:13px;border-collapse:collapse;">';
    var counts = result.summary[g];
    var statusOrder = ["Present","Late Excused","Late Unexcused","Absent Excused","Absent Unexcused"];
    var total = 0;
    for (var si = 0; si < statusOrder.length; si++) {
      var st = statusOrder[si];
      if (counts[st]) {
        body += '<tr><td style="padding:3px 0;color:#6B6058;">' + st + '</td><td style="padding:3px 0;text-align:right;font-weight:600;">' + counts[st] + '</td></tr>';
        total += counts[st];
      }
    }
    body += '<tr style="border-top:1px solid #E8DEC6;"><td style="padding:6px 0;font-weight:600;">Total</td><td style="padding:6px 0;text-align:right;font-weight:700;">' + total + '</td></tr>';
    body += '</table>';
  }
 
  // Absent unexcused list (the actionable one)
  var absentUnexcused = result.records.filter(function(r) { return r.status === "Absent Unexcused"; });
  if (absentUnexcused.length > 0) {
    body += '<h3 style="margin:20px 0 8px;font-size:15px;color:#B6202A;font-family:Georgia,serif;">Absent (Unexcused)</h3>';
    body += '<ul style="font-size:13px;margin:0;padding-left:20px;">';
    var seen = {};
    for (var ai = 0; ai < absentUnexcused.length; ai++) {
      var nm = absentUnexcused[ai].name;
      if (seen[nm]) continue; seen[nm] = true;
      body += '<li>' + nm + ' (' + absentUnexcused[ai].group + ')</li>';
    }
    body += '</ul>';
  }
 
  var html = buildEmail_(body, {
    headerTitle: "Attendance Summary",
    headerSubtitle: niceDate,
    signatureKey: "general"
  });
 
  MailApp.sendEmail({
    to: adminEmails.join(","),
    subject: subject,
    htmlBody: html,
    name: EMAIL_FROM_NAME
  });
 
  return { success: true, count: adminEmails.length };
}
 
/** Formats "HH:mm" to 12-hour "h:mm AM/PM". */
function formatTime12_(t) {
  if (!t) return "";
  var parts = t.split(":");
  var h = parseInt(parts[0]), m = parts[1];
  var ampm = h >= 12 ? "PM" : "AM";
  h = h % 12; if (h === 0) h = 12;
  return h + ":" + m + " " + ampm;
}
 
// -------------------------------------------------------
//  BIRTHDAYS (Phase 3 — Celebrations)
// -------------------------------------------------------
//  Source of truth: the "Member Details" sheet (DOB from onboarding).
//  No second roster — reads live so it never goes stale.
//
//  ONE-TIME SETUP:
//   1. Add a "Member Status" column to Member Details.
//      Values: Active | Alumnus | Memorial
//      Only Active + Alumnus are celebrated. Memorial NEVER is.
//   2. Run createBirthdayTrigger_() once from the editor (daily 6 AM check).
//   3. (Poster, optional) create a Slides template, put its ID in BIRTHDAY_POSTER_TEMPLATE_ID.
 
var CELEBRATE_STATUSES = ["Active", "Alumnus"];   // never "Memorial"
var LEAP_DAY_OBSERVED  = "FEB28";                  // "FEB28" or "MAR01"
var AUTO_SEND_MEMBER_CARD_DEFAULT = true;          // default when no setting saved yet
 
/** Reads the auto-send setting (stored), falling back to the default. */
function getAutoSendBirthdayCard_() {
  try {
    var v = PropertiesService.getScriptProperties().getProperty("bd_auto_send");
    if (v === "true") return true;
    if (v === "false") return false;
  } catch(e) {}
  return AUTO_SEND_MEMBER_CARD_DEFAULT;
}
 
/** Toggles/sets the auto-send setting from the dashboard. */
function setAutoSendBirthdayCard(enabled) {
  try {
    PropertiesService.getScriptProperties().setProperty("bd_auto_send", enabled ? "true" : "false");
  } catch(e) { throw new Error("Could not save setting."); }
  return { success: true, autoSend: !!enabled };
}
 
// Who receives the daily birthday-coordinator digest.
//   "first"  — only the first admin in the Admins sheet (default; single owner)
//   "all"    — every admin in the Admins sheet
//   or provide explicit emails in BIRTHDAY_COORDINATOR_EMAILS below (takes priority)
var BIRTHDAY_COORDINATOR_MODE = "first";
var BIRTHDAY_COORDINATOR_EMAILS = [];              // e.g. ["events@chorale.edu"] — overrides mode if non-empty
 
/** Resolves the list of birthday-digest recipients per the config above. */
function getBirthdayCoordinators_() {
  if (BIRTHDAY_COORDINATOR_EMAILS && BIRTHDAY_COORDINATOR_EMAILS.length) {
    return BIRTHDAY_COORDINATOR_EMAILS.slice();
  }
  var admins = getAdminEmails_(getSpreadsheet_());
  if (!admins.length) return [EMAIL_CC];
  return BIRTHDAY_COORDINATOR_MODE === "all" ? admins : [admins[0]];
}
 
// Member Details column header names (match ensureMemberDetailsSheet_)
var MD_NAME_COL   = "Name";
var MD_EMAIL_COL  = "Email";
var MD_DOB_COL    = "Date of Birth";
var MD_PHOTO_COL  = "Passport Photo URL";
var MD_STATUS_COL = "Member Status";
 
// 7 templates — {first} {full} {age} substituted. accent passed to UI at runtime.
var BIRTHDAY_TEMPLATES = [
  { key:"classic", accent:"#185FA5",
    bannerOther:"\uD83C\uDF82 Today we celebrate {first}!",
    bannerSelf :"\uD83C\uDF82 Happy birthday, {first}! The whole Chorale is celebrating you today.",
    cardHeadline:"Happy Birthday, {first}!",
    cardBody:"The whole Strathmore Chorale family is celebrating you today. Thank you for the voice and spirit you bring to us \u2014 have a wonderful day.",
    group:"\uD83C\uDF82 Happy birthday, {full}! \uD83C\uDF89 The whole Chorale is celebrating you today \u2014 have a beautiful day." },
 
  { key:"harmony", accent:"#0F6E56",
    bannerOther:"\uD83C\uDFB6 A high note for {first} today \u2014 happy birthday!",
    bannerSelf :"\uD83C\uDFB6 Happy birthday, {first}! May your year be full of high notes.",
    cardHeadline:"A little harmony for you, {first}",
    cardBody:"Happy birthday! May your year be full of high notes and good company. Thank you for the voice you bring to us.",
    group:"\uD83C\uDFB6 Happy birthday, {full}! May your year be full of high notes and good company. \uD83C\uDF89" },
 
  { key:"heartfelt", accent:"#534AB7",
    bannerOther:"\uD83C\uDF88 Today is {first}\u2019s birthday!",
    bannerSelf :"\uD83C\uDF88 Happy birthday, {first}. We\u2019re grateful to share the music with you.",
    cardHeadline:"Happy Birthday, {first}",
    cardBody:"Grateful to share the music and the journey with you. Wishing you a day as warm as the community you\u2019re part of.",
    group:"\uD83C\uDF88 Happy birthday, {full}! Grateful to share the music and the journey with you. Have a beautiful day." },
 
  { key:"playful", accent:"#D85A30",
    bannerOther:"\uD83E\uDD73 It\u2019s {first}\u2019s birthday!",
    bannerSelf :"\uD83E\uDD73 Happy birthday, {first}! Cake first, scales later.",
    cardHeadline:"Happy Birthday, {first}!",
    cardBody:"Time to hit all the right notes today \u2014 cake first, scales later. The Chorale is cheering you on.",
    group:"\uD83E\uDD73 Happy birthday, {full}! Cake first, scales later. The whole Chorale is cheering you on! \uD83C\uDF89" },
 
  { key:"community", accent:"#993556",
    bannerOther:"\uD83C\uDF89 Today we celebrate {first}!",
    bannerSelf :"\uD83C\uDF89 Happy birthday, {first}! Thank you for the voice you bring to us.",
    cardHeadline:"Today we celebrate you, {first}!",
    cardBody:"Thank you for the voice and the energy you bring to the Chorale. Wishing you a wonderful birthday.",
    group:"\uD83C\uDF89 Today we celebrate {full}! Thank you for the voice you bring to the Chorale. Happy birthday!" },
 
  { key:"uplifting", accent:"#BA7517",
    bannerOther:"\u2728 Happy birthday to {first} today!",
    bannerSelf :"\u2728 Happy birthday, {first}! Here\u2019s to another year of music and growth.",
    cardHeadline:"Happy Birthday, {first}! \u2728",
    cardBody:"Here\u2019s to another year of music, growth, and good company. The Chorale is celebrating you today.",
    group:"\u2728 Happy birthday, {full}! Here\u2019s to another year of music, growth, and good company. \uD83C\uDF89" },
 
  { key:"simple", accent:"#1D9E75",
    bannerOther:"\uD83C\uDF82 Happy birthday, {first}!",
    bannerSelf :"\uD83C\uDF82 Happy birthday, {first}! Wishing you a wonderful day.",
    cardHeadline:"Happy Birthday, {first}!",
    cardBody:"Wishing you joy today and all year. The whole Chorale is thinking of you.",
    group:"\uD83C\uDF82 Happy birthday, {full}! Wishing you joy today and all year. \uD83C\uDF89" }
];
 
/** One-time: schedule the daily 6 AM tasks (AU sweep + birthday check). Run from the editor. */
function createBirthdayTrigger_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var h = t.getHandlerFunction();
    if (h === "dailyBirthdayReminder_" || h === "dailyTasks_") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("dailyTasks_").timeBased().everyDays(1).atHour(6).create();
}
 
/** PUBLIC wrapper — run THIS from the editor to set up the birthday trigger. */
function setupBirthdayTrigger() {
  createBirthdayTrigger_();
  return "Birthday trigger created — daily check at 6 AM.";
}
 
/** PUBLIC wrapper — run THIS from the editor to list members missing a DOB. */
function listMembersMissingDob() {
  var list = getMembersMissingDob_();
  if (!list.length) { Logger.log("All active members have a valid DOB."); return "All good."; }
  Logger.log("Members missing/invalid DOB (" + list.length + "):\n" + list.join("\n"));
  return list;
}
 
/** Reads Member Details into objects with status guard support. */
function bdReadMembers_() {
  var ss = getSpreadsheet_();
  var sh = ss.getSheetByName(MEMBER_DETAILS_SHEET);
  if (!sh) return [];
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  var head = values.shift();
  var idx = {};
  head.forEach(function (h, i) { idx[String(h).trim()] = i; });
  return values.map(function (r) {
    return {
      name:   String(r[idx[MD_NAME_COL]]  || "").trim(),
      email:  String(r[idx[MD_EMAIL_COL]] || "").trim(),
      dobRaw: idx[MD_DOB_COL] != null ? r[idx[MD_DOB_COL]] : "",
      photo:  idx[MD_PHOTO_COL] != null ? String(r[idx[MD_PHOTO_COL]] || "").trim() : "",
      status: idx[MD_STATUS_COL] != null ? String(r[idx[MD_STATUS_COL]] || "Active").trim() : "Active"
    };
  }).filter(function (m) { return m.name; });
}
 
/** DOB parsing — handles Date cells and common string formats. */
function bdParseDob_(v) {
  if (v === "" || v == null) return null;
  if (Object.prototype.toString.call(v) === "[object Date]" && !isNaN(v)) {
    return { m: v.getMonth() + 1, d: v.getDate(), y: v.getFullYear() };
  }
  var s = String(v).trim(), m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return { y:+m[1], m:+m[2], d:+m[3] };
  if ((m = s.match(/^(\d{1,2})[\/.](\d{1,2})[\/.](\d{2,4})/))) {
    var yr = m[3].length === 2 ? +("19" + m[3]) : +m[3];
    return { d:+m[1], m:+m[2], y:yr };
  }
  var p = new Date(s);
  if (!isNaN(p)) return { m: p.getMonth() + 1, d: p.getDate(), y: p.getFullYear() };
  return null;
}
function bdIsLeap_(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }
function bdMatches_(dob, ref) {
  if (!dob) return false;
  var rm = ref.getMonth() + 1, rd = ref.getDate();
  if (dob.m === 2 && dob.d === 29 && !bdIsLeap_(ref.getFullYear())) {
    return LEAP_DAY_OBSERVED === "MAR01" ? (rm === 3 && rd === 1) : (rm === 2 && rd === 28);
  }
  return dob.m === rm && dob.d === rd;
}
function bdFirst_(name) { return String(name).split(/\s+/)[0] || name; }
function bdAge_(dob, ref) { return dob.y ? (ref.getFullYear() - dob.y) : null; }
 
/** Core: who has a birthday in [today .. today+windowDays], with status guard. */
function getUpcomingBirthdays_(windowDays) {
  windowDays = windowDays == null ? 0 : windowDays;
  var members = bdReadMembers_();
  var base = new Date(); base.setHours(12, 0, 0, 0);
  var out = [];
  members.forEach(function (mem) {
    if (CELEBRATE_STATUSES.indexOf(mem.status) === -1) return;     // status guard
    var dob = bdParseDob_(mem.dobRaw);
    if (!dob) return;
    for (var off = 0; off <= windowDays; off++) {
      var ref = new Date(base.getTime() + off * 86400000);
      if (bdMatches_(dob, ref)) {
        out.push({ name: mem.name, first: bdFirst_(mem.name), email: mem.email,
                   photo: mem.photo, age: bdAge_(dob, ref), daysAway: off });
        break;
      }
    }
  });
  return out;
}
 
/** Lists active members with missing/unparseable DOB — run before go-live to chase gaps. */
function getMembersMissingDob_() {
  return bdReadMembers_().filter(function (m) {
    return CELEBRATE_STATUSES.indexOf(m.status) !== -1 && !bdParseDob_(m.dobRaw);
  }).map(function (m) { return m.name + (m.email ? " <" + m.email + ">" : ""); });
}
 
/** Deterministic per-person-per-year template pick. */
function bdHash_(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }
function bdPick_(mem) { return BIRTHDAY_TEMPLATES[ bdHash_((mem.email || mem.name) + new Date().getFullYear()) % BIRTHDAY_TEMPLATES.length ]; }
function bdFill_(str, mem) {
  return String(str).replace(/\{first\}/g, mem.first)
                    .replace(/\{full\}/g, mem.name)
                    .replace(/\{age\}/g, mem.age == null ? "" : mem.age);
}
 
/** Extracts a Drive file ID from a URL. */
function bdFileId_(url) { var m = String(url).match(/[-\w]{25,}/); return m ? m[0] : null; }
function bdPhotoBlob_(mem) {
  // Prefer the member's PROFILE photo (Members sheet); fall back to the passport
  // photo (Member Details, carried on mem.photo) when no profile photo is set.
  var candidates = [];
  try {
    if (mem.email) {
      var m = findMemberByEmail_(getSpreadsheet_(), mem.email.toLowerCase());
      if (m && m.profilePhotoRaw) candidates.push(m.profilePhotoRaw);
    }
  } catch(e) {}
  if (mem.photo) candidates.push(mem.photo);
 
  for (var i = 0; i < candidates.length; i++) {
    var id = bdFileId_(candidates[i]);
    if (!id) continue;
    try { return DriveApp.getFileById(id).getBlob(); } catch (e) {}
  }
  return null;
}
 
/** Builds the birthday email card (email-safe, inline CSS, cid photo). */
function buildBirthdayCardHtml_(mem, tpl, hasPhoto) {
  // Use the standalone festive template (not wrapped in EmailLayout).
  // {{accent}} drives the colourway; {{message}} is the per-template body copy.
  try {
    var html = renderEmailTemplate_("birthday-card", {
      accent: tpl.accent,
      name: mem.name,
      age: mem.age == null ? "" : mem.age,
      message: bdFill_(tpl.cardBody, mem)
    }, { standalone: true });
 
    // If the member has no photo, the cid image will be broken — swap to a graceful
    // accent-tinted initial circle instead of a missing-image icon.
    if (!hasPhoto) {
      html = html.replace(/<img src="cid:bdphoto"[^>]*>/,
        '<div style="display:inline-block;width:150px;height:150px;border-radius:999px;background:' + tpl.accent +
        ';color:#FFFDF8;font-family:Georgia,serif;font-size:60px;line-height:150px;text-align:center;">' +
        (mem.first ? mem.first.charAt(0) : "\uD83C\uDF82") + '</div>');
    }
 
    // Drop the age pill entirely when age is unknown
    if (mem.age == null) {
      html = html.replace(/<table[^>]*>\s*<tr>\s*<td[^>]*Turning[\s\S]*?<\/table>/, "");
    }
    return html;
  } catch(e) {
    // Fallback to a minimal inline card
    var photoRow = hasPhoto
      ? '<tr><td align="center" style="padding:30px 28px 6px;"><img src="cid:bdphoto" width="92" height="92" style="width:92px;height:92px;border-radius:50%;object-fit:cover;border:3px solid ' + tpl.accent + ';" alt=""></td></tr>'
      : '<tr><td style="padding:18px 0 0;"></td></tr>';
    return '<div style="padding:24px;background:#FBF7EE;font-family:Arial,sans-serif;">' +
      '<table width="100%" style="max-width:600px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;">' +
      '<tr><td style="height:8px;background:' + tpl.accent + ';font-size:0;">&nbsp;</td></tr>' + photoRow +
      '<tr><td align="center" style="padding:8px 28px 0;"><h1 style="font-size:23px;font-family:Georgia,serif;">' + bdFill_(tpl.cardHeadline, mem) + '</h1></td></tr>' +
      '<tr><td style="padding:14px 34px 8px;font-size:15px;text-align:center;">' + bdFill_(tpl.cardBody, mem) + '</td></tr>' +
      '<tr><td align="center" style="padding:6px 28px 30px;font-size:13px;color:#8a93a6;">\u2014 Strathmore Chorale</td></tr>' +
      '</table></div>';
  }
}
 
function sendBirthdayCard_(mem) {
  if (!mem.email) return false;
  if (bdWasCardSent_(mem.email, new Date().getFullYear())) return false; // already sent this year
  var tpl  = bdPick_(mem);
  var blob = bdPhotoBlob_(mem);
  var html = buildBirthdayCardHtml_(mem, tpl, !!blob);
  var opts = { htmlBody: html, name: EMAIL_FROM_NAME };
  if (blob) opts.inlineImages = { bdphoto: blob };
  MailApp.sendEmail(mem.email, "\uD83C\uDF82 " + bdFill_(tpl.cardHeadline, mem),
                    "Happy Birthday from Strathmore Chorale!", opts);
  bdMarkCardSent_(mem.email, new Date().getFullYear());
  return true;
}
 
/** Group-message draft (you paste this into WhatsApp; not auto-posted). */
function buildGroupMessage_(mem) { return bdFill_(bdPick_(mem).group, mem); }
 
/** Daily trigger: day-before prep nudge + day-of. Auto-sends member cards if enabled. */
/**
 * Daily scheduled entry point (6 AM). Runs the consecutive-AU offense sweep, then
 * the birthday reminders. Kept as one trigger so we don't add a second time-based job.
 */
function dailyTasks_() {
  try { syncConsecutiveAuOffenses_(getSpreadsheet_()); } catch (e) { Logger.log("AU sweep: " + e); }
  try { dailyBirthdayReminder_(); } catch (e) { Logger.log("Birthday: " + e); }
}
 
function dailyBirthdayReminder_() {
  var win      = getUpcomingBirthdays_(1);
  var today    = win.filter(function (m) { return m.daysAway === 0; });
  var tomorrow = win.filter(function (m) { return m.daysAway === 1; });
  if (!today.length && !tomorrow.length) return;
 
  if (getAutoSendBirthdayCard_()) today.forEach(function (m) { try { sendBirthdayCard_(m); } catch (e) { Logger.log(e); } });
 
  var subjBits = [];
  if (today.length)    subjBits.push(today.length + " today");
  if (tomorrow.length) subjBits.push(tomorrow.length + " tomorrow");
 
  var coordinators = getBirthdayCoordinators_();
  MailApp.sendEmail(coordinators.join(","),
    "\uD83C\uDF82 Chorale birthdays \u2014 " + subjBits.join(" / "),
    "Birthday reminders",
    { htmlBody: bdCoordinatorEmail_(today, tomorrow), name: EMAIL_FROM_NAME });
}
 
function bdCoordinatorEmail_(today, tomorrow) {
  function block(m, tag) {
    var status = (tag === "Today" && getAutoSendBirthdayCard_())
      ? '<div style="font-size:12px;color:#2f9e44;margin-top:2px;">\u2713 Email card sent \u00b7 in-app banner is live</div>'
      : '<div style="font-size:12px;color:#8a93a6;margin-top:2px;">Prep window \u2014 good time to make the poster.</div>';
    return '<div style="margin:0 0 14px;padding:14px 16px;background:#F3E9CE;border-radius:10px;">' +
             '<div style="font-weight:bold;color:#1c2333;">' + m.name + (m.age ? " \u2014 turns " + m.age : "") + '</div>' +
             status +
             '<div style="margin-top:8px;font-size:13px;color:#3a4256;"><b>Group draft (copy &amp; paste):</b><br>' + buildGroupMessage_(m) + '</div>' +
           '</div>';
  }
  var body = [];
  if (today.length)    { body.push('<h3 style="margin:0 0 10px;color:#1c2333;font-family:Georgia,serif;">Today</h3>');    today.forEach(function (m) { body.push(block(m, "Today")); }); }
  if (tomorrow.length) { body.push('<h3 style="margin:14px 0 10px;color:#1c2333;font-family:Georgia,serif;">Tomorrow</h3>'); tomorrow.forEach(function (m) { body.push(block(m, "Tomorrow")); }); }
  return buildEmail_(body.join(""), { headerTitle: "Birthday Reminders", signatureKey: "general" });
}
 
/** In-app banner endpoint — called by Scripts.html for ALL roles. */
function getTodaysBirthdaysForBanner() {
  var viewer = "";
  try { viewer = String(Session.getActiveUser().getEmail() || "").toLowerCase(); } catch(e) {}
  var ss = getSpreadsheet_();
  return getUpcomingBirthdays_(0).map(function (m) {
    var tpl    = bdPick_(m);
    var isSelf = m.email && m.email.toLowerCase() === viewer;
    // Prefer the profile photo (Members sheet) for consistency with avatars elsewhere;
    // fall back to the passport photo (Member Details) if no profile photo is set.
    var avatar = "";
    try {
      var mem = m.email ? findMemberByEmail_(ss, m.email.toLowerCase()) : null;
      var profileRaw = mem && mem.profilePhotoRaw ? mem.profilePhotoRaw : "";
      avatar = driveAvatarDataUri_(profileRaw || m.photo);
    } catch (e) {}
    return {
      name: m.name, first: m.first, isSelf: !!isSelf, accent: tpl.accent, avatar: avatar,
      message: bdFill_(isSelf ? tpl.bannerSelf : tpl.bannerOther, m)
    };
  });
}
 
/**
 * Records that a birthday card was sent to an email this year (dedupe + dashboard status).
 * Uses a lightweight property store keyed by email+year.
 */
function bdMarkCardSent_(email, year) {
  if (!email) return;
  try {
    PropertiesService.getScriptProperties().setProperty("bdsent_" + year + "_" + email.toLowerCase(), "1");
  } catch(e) {}
}
function bdWasCardSent_(email, year) {
  if (!email) return false;
  try {
    return PropertiesService.getScriptProperties().getProperty("bdsent_" + year + "_" + email.toLowerCase()) === "1";
  } catch(e) { return false; }
}
 
/**
 * Returns the default (editable) birthday message for a member — the card body copy
 * from their deterministically-chosen template, with tokens filled.
 */
function getBirthdayMessageDraft(email) {
  var ss = getSpreadsheet_();
  var members = bdReadMembers_();
  for (var i = 0; i < members.length; i++) {
    if (members[i].email && members[i].email.toLowerCase() === (email||"").toLowerCase()) {
      var dob = bdParseDob_(members[i].dobRaw);
      var mem = { name: members[i].name, first: bdFirst_(members[i].name),
                  email: members[i].email, photo: members[i].photo,
                  age: dob ? bdAge_(dob, new Date()) : null };
      var tpl = bdPick_(mem);
      return { headline: bdFill_(tpl.cardHeadline, mem), message: bdFill_(tpl.cardBody, mem),
               accent: tpl.accent, name: mem.name, age: mem.age };
    }
  }
  throw new Error("Member not found.");
}
 
/**
 * Sends the DEFAULT birthday card (unedited template) to one member on demand.
 * For the dashboard's "send now" button when auto-send is off.
 */
function sendBirthdayCardNow(email) {
  var members = bdReadMembers_();
  for (var i = 0; i < members.length; i++) {
    if (members[i].email && members[i].email.toLowerCase() === (email||"").toLowerCase()) {
      if (CELEBRATE_STATUSES.indexOf(members[i].status) === -1) {
        throw new Error("This member's status (" + members[i].status + ") is not celebrated.");
      }
      var dob = bdParseDob_(members[i].dobRaw);
      var mem = { name: members[i].name, first: bdFirst_(members[i].name),
                  email: members[i].email, photo: members[i].photo,
                  age: dob ? bdAge_(dob, new Date()) : null };
      var sent = sendBirthdayCard_(mem);
      return { success: sent, name: mem.name, alreadySent: !sent };
    }
  }
  throw new Error("Member not found.");
}
 
/**
 * Sends a birthday card with an admin-edited message (overrides the template body).
 * @param {string} email — recipient
 * @param {string} customMessage — the edited message body
 */
function sendCustomBirthdayCard(email, customMessage) {
  var members = bdReadMembers_();
  for (var i = 0; i < members.length; i++) {
    if (members[i].email && members[i].email.toLowerCase() === (email||"").toLowerCase()) {
      // status guard — never send to Memorial
      if (CELEBRATE_STATUSES.indexOf(members[i].status) === -1) {
        throw new Error("This member's status (" + members[i].status + ") is not celebrated.");
      }
      var dob = bdParseDob_(members[i].dobRaw);
      var mem = { name: members[i].name, first: bdFirst_(members[i].name),
                  email: members[i].email, photo: members[i].photo,
                  age: dob ? bdAge_(dob, new Date()) : null };
      var tpl = bdPick_(mem);
      // Override the card body with the custom message
      var customTpl = {}; for (var k in tpl) customTpl[k] = tpl[k];
      customTpl.cardBody = customMessage;
      var blob = bdPhotoBlob_(mem);
      var html = buildBirthdayCardHtml_(mem, customTpl, !!blob);
      var opts = { htmlBody: html, name: EMAIL_FROM_NAME };
      if (blob) opts.inlineImages = { bdphoto: blob };
      MailApp.sendEmail(mem.email, "\uD83C\uDF82 " + bdFill_(tpl.cardHeadline, mem),
                        "Happy Birthday from Strathmore Chorale!", opts);
      bdMarkCardSent_(mem.email, new Date().getFullYear());
      return { success: true, name: mem.name };
    }
  }
  throw new Error("Member not found.");
}
 
/**
 * Birthday dashboard data. rangeMode: "today" (today+tomorrow, default), "week", "month".
 * Returns groups of decorated birthdays with editable draft + sent status.
 */
function getBirthdayDashboard(rangeMode) {
  rangeMode = rangeMode || "today";
  var year = new Date().getFullYear();
  function decorate(m) {
    var tpl = bdPick_(m);
    var avatar = "";
    try { avatar = driveAvatarDataUri_(m.photo); } catch(e) {}
    return { name: m.name, first: m.first, age: m.age, email: m.email,
             avatar: avatar, accent: tpl.accent,
             groupDraft: bdFill_(tpl.group, m),
             messageDraft: bdFill_(tpl.cardBody, m),
             headline: bdFill_(tpl.cardHeadline, m),
             daysAway: m.daysAway,
             cardSent: bdWasCardSent_(m.email, year) };
  }
 
  if (rangeMode === "week" || rangeMode === "month") {
    var windowDays = rangeMode === "week" ? 7 : 31;
    var all = getUpcomingBirthdays_(windowDays).map(decorate);
    return { range: rangeMode, all: all, autoSend: getAutoSendBirthdayCard_(),
             today: all.filter(function(m){return m.daysAway===0;}),
             tomorrow: all.filter(function(m){return m.daysAway===1;}),
             upcoming: all.filter(function(m){return m.daysAway>1;}) };
  }
 
  // Default: today + tomorrow
  var today = getUpcomingBirthdays_(0).map(decorate);
  var tomorrow = getUpcomingBirthdays_(1).filter(function(m){ return m.daysAway === 1; }).map(decorate);
  return { range: "today", today: today, tomorrow: tomorrow, upcoming: [], autoSend: getAutoSendBirthdayCard_() };
}
 
/**
 * Generates a birthday poster PNG and saves it to Drive, returning a shareable link.
 * (Wrapper around generateBirthdayPoster_ so the dashboard can offer a poster button.)
 */
function makeBirthdayPoster(email) {
  if (!BIRTHDAY_POSTER_TEMPLATE_ID) throw new Error("No poster template configured yet.");
  var members = bdReadMembers_();
  for (var i = 0; i < members.length; i++) {
    if (members[i].email && members[i].email.toLowerCase() === (email||"").toLowerCase()) {
      var dob = bdParseDob_(members[i].dobRaw);
      var mem = { name: members[i].name, first: bdFirst_(members[i].name),
                  email: members[i].email, photo: members[i].photo,
                  age: dob ? bdAge_(dob, new Date()) : null };
      var png = generateBirthdayPoster_(mem);
      var file = DriveApp.createFile(png).setName("Birthday Poster - " + mem.name + ".png");
      try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch(e) {}
      return { success: true, url: file.getUrl(), name: mem.name };
    }
  }
  throw new Error("Member not found.");
}
 
/** Poster generation (optional) — needs a Slides template. Returns a PNG blob. */
/**
 * DIAGNOSTIC — run from the editor to inspect the poster template's slides.
 * Logs each slide's images and shapes with their alt-text, so you can confirm
 * the PHOTO placeholder exists and whether it's an image or a shape.
 */
function inspectPosterTemplate() {
  if (!BIRTHDAY_POSTER_TEMPLATE_ID) { Logger.log("Set BIRTHDAY_POSTER_TEMPLATE_ID first."); return; }
  var deck = SlidesApp.openById(BIRTHDAY_POSTER_TEMPLATE_ID);
  var slides = deck.getSlides();
  for (var i = 0; i < slides.length; i++) {
    Logger.log("── Slide " + i + " ──");
    var imgs = slides[i].getImages();
    Logger.log("  Images: " + imgs.length);
    for (var a = 0; a < imgs.length; a++) {
      Logger.log("    image[" + a + "] desc='" + (imgs[a].getDescription()||"") + "' title='" + (imgs[a].getTitle()||"") + "'");
    }
    var shapes = slides[i].getShapes();
    Logger.log("  Shapes: " + shapes.length);
    for (var b = 0; b < shapes.length; b++) {
      var d = ""; try { d = shapes[b].getDescription() || ""; } catch(e){}
      var t = ""; try { t = shapes[b].getTitle() || ""; } catch(e){}
      if (d || t) Logger.log("    shape[" + b + "] desc='" + d + "' title='" + t + "'");
    }
  }
}
 
/**
 * Attempts to give an inserted image a circular appearance via the advanced Slides API.
 * NOTE: the Slides API does not expose a true circular *crop*; the supported lever is
 * an elliptical OUTLINE on a square image, which reads as a circular frame. Returns
 * true if the call succeeded. Requires the Slides advanced service (already enabled).
 */
function cropImageToCircle_(presentationId, imageObjectId) {
  if (typeof Slides === "undefined" || !Slides.Presentations) return false;
  // Apply a thick outline; combined with the template's accent ring this frames the
  // square photo. (True pixel-circle masking isn't available through the API.)
  Slides.Presentations.batchUpdate({
    requests: [{
      updateImageProperties: {
        objectId: imageObjectId,
        imageProperties: {
          outline: {
            outlineFill: { solidFill: { color: { rgbColor: { red: 0.984, green: 0.969, blue: 0.929 } } } },
            weight: { magnitude: 6, unit: "PT" },
            dashStyle: "SOLID"
          }
        },
        fields: "outline"
      }
    }]
  }, presentationId);
  return true;
}
 
function generateBirthdayPoster_(mem) {
  if (!BIRTHDAY_POSTER_TEMPLATE_ID) throw new Error("Set BIRTHDAY_POSTER_TEMPLATE_ID first.");
  var tpl  = bdPick_(mem);
  // The slide order matches BIRTHDAY_TEMPLATES order (index N = colourway N),
  // so find the picked template's index and use that slide — keeps the poster's
  // colour identical to the banner and email card for this person.
  var index = 0;
  for (var t = 0; t < BIRTHDAY_TEMPLATES.length; t++) {
    if (BIRTHDAY_TEMPLATES[t].key === tpl.key) { index = t; break; }
  }
 
  var copy = DriveApp.getFileById(BIRTHDAY_POSTER_TEMPLATE_ID).makeCopy("Birthday - " + mem.name);
  var copyId = copy.getId();
  var png;
  try {
    var deck = SlidesApp.openById(copyId);
    var slides = deck.getSlides();
    var slide = slides[index] || slides[0];
 
    // Fill tokens on the chosen slide
    slide.replaceAllText("{{NAME}}", mem.first);
    slide.replaceAllText("{{AGE}}", mem.age == null ? "" : String(mem.age));
    slide.replaceAllText("{{MESSAGE}}", bdFill_(tpl.cardBody, mem));
 
    // Swap the photo. The placeholder may be an IMAGE or a SHAPE (depending on how
    // the template was built/converted), so search both. We match by alt-text
    // description == "PHOTO". When found, insert the member photo at that exact
    // position/size, then remove the placeholder.
    var blob = bdPhotoBlob_(mem);
    if (blob) {
      var placed = false;
 
      // (a) Try existing images first
      var imgs = slide.getImages();
      for (var ii = 0; ii < imgs.length; ii++) {
        if ((imgs[ii].getDescription() || "") === "PHOTO" ||
            (imgs[ii].getTitle() || "") === "PHOTO") {
          imgs[ii].replace(blob);
          placed = true;
          break;
        }
      }
 
      // (b) If not found as an image, look for a SHAPE placeholder by description/title,
      //     insert the photo at its bounds, then delete the placeholder shape.
      if (!placed) {
        var shapes = slide.getShapes();
        for (var si = 0; si < shapes.length; si++) {
          var desc = "";
          try { desc = shapes[si].getDescription() || ""; } catch(e) {}
          var title = "";
          try { title = shapes[si].getTitle() || ""; } catch(e) {}
          if (desc === "PHOTO" || title === "PHOTO") {
            var L = shapes[si].getLeft(), T = shapes[si].getTop(),
                Wd = shapes[si].getWidth(), Ht = shapes[si].getHeight();
            // Square the area (smaller dimension), centred, so the photo isn't stretched.
            var side = Math.min(Wd, Ht);
            var sqL = L + (Wd - side) / 2, sqT = T + (Ht - side) / 2;
            var newImg = slide.insertImage(blob, sqL, sqT, side, side);
            try { newImg.setDescription("PHOTO_PLACED"); } catch(e) {}
            // Apply a true circular crop via the advanced Slides API (CIRCLE mask).
            var cropped = false;
            try { cropped = cropImageToCircle_(deck.getId(), newImg.getObjectId()); } catch(e) {}
            shapes[si].remove();
            placed = true;
            break;
          }
        }
      }
      // If still not placed, the placeholder couldn't be found — poster generates
      // without the photo rather than failing.
    }
 
    // Remove the OTHER slides so the chosen one is the only page — makes the
    // thumbnail/export unambiguous and keeps the file clean.
    var keepId = slide.getObjectId();
    deck.getSlides().forEach(function (s) {
      if (s.getObjectId() !== keepId) s.remove();
    });
    deck.saveAndClose();
 
    // Export the (now single-slide) presentation as a PNG.
    // SlidesApp has no per-slide getAs(); use the Slides API thumbnail, which
    // returns a high-res PNG URL we then fetch as a blob.
    png = exportSlideAsPng_(copyId, keepId, mem.name);
  } finally {
    // Always clean up the temp copy
    try { DriveApp.getFileById(copyId).setTrashed(true); } catch(e) {}
  }
  return png;
}
 
/**
 * Exports a single slide as a PNG blob using the Slides advanced service thumbnail.
 * REQUIRES the "Slides API" advanced service enabled in the Apps Script project
 * (Services → add "Google Slides API"). Falls back to a Drive PDF export if not.
 */
function exportSlideAsPng_(presentationId, slideObjectId, name) {
  // Preferred: Slides advanced service thumbnail (LARGE size, PNG)
  try {
    if (typeof Slides !== "undefined" && Slides.Presentations && Slides.Presentations.Pages) {
      var thumb = Slides.Presentations.Pages.getThumbnail(presentationId, slideObjectId, {
        "thumbnailProperties.mimeType": "PNG",
        "thumbnailProperties.thumbnailSize": "LARGE"
      });
      if (thumb && thumb.contentUrl) {
        var resp = UrlFetchApp.fetch(thumb.contentUrl);
        return resp.getBlob().setName("Birthday Poster - " + name + ".png");
      }
    }
  } catch(e) {
    // fall through to PDF fallback
  }
 
  // Fallback: export the presentation as a PDF blob (single slide, so one page).
  // Not a PNG, but ensures the feature degrades rather than throwing.
  var url = "https://docs.google.com/presentation/d/" + presentationId + "/export/pdf";
  var token = ScriptApp.getOAuthToken();
  var pdf = UrlFetchApp.fetch(url, { headers: { Authorization: "Bearer " + token } });
  return pdf.getBlob().setName("Birthday Poster - " + name + ".pdf");
}
 
// -------------------------------------------------------
//  PROFILE MANAGEMENT (Phase 2)
// -------------------------------------------------------
 
/**
 * Returns a small (cacheable) data URI for list/avatar display.
 * Uses Drive's thumbnail rendering at a small size to stay under cache limits.
 */
function driveAvatarDataUri_(urlOrId) {
  if (!urlOrId) return "";
  try {
    var fileId = "";
    var s = urlOrId.toString();
    var m = s.match(/[?&]id=([a-zA-Z0-9_-]+)/) || s.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) || s.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (m) fileId = m[1];
    else if (/^[a-zA-Z0-9_-]+$/.test(s)) fileId = s;
    if (!fileId) return "";
 
    var cache = CacheService.getScriptCache();
    var cacheKey = "avatar_" + fileId;
    var cached = cache.get(cacheKey);
    if (cached) return cached;
 
    // Fetch a small thumbnail (128px) to keep it cacheable
    var file = DriveApp.getFileById(fileId);
    var thumb = file.getThumbnail ? file.getThumbnail() : null;
    var dataUri = "";
    if (thumb) {
      dataUri = "data:" + thumb.getContentType() + ";base64," + Utilities.base64Encode(thumb.getBytes());
    } else {
      var blob = file.getBlob();
      dataUri = "data:" + blob.getContentType() + ";base64," + Utilities.base64Encode(blob.getBytes());
    }
 
    if (dataUri.length < 100000) {
      try { cache.put(cacheKey, dataUri, 21600); } catch(e) {}
    }
    return dataUri;
  } catch(e) {
    return "";
  }
}
 
/**
 * Converts a Drive image URL/ID to a base64 data URI for iframe-safe display.
 * Apps Script's sandbox blocks hotlinked Drive images, so we serve the bytes inline.
 * Results are cached for 6 hours to keep list views fast.
 */
function driveImageToDataUri_(urlOrId) {
  if (!urlOrId) return "";
  try {
    var fileId = "";
    var s = urlOrId.toString();
    var m = s.match(/[?&]id=([a-zA-Z0-9_-]+)/) || s.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) || s.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (m) fileId = m[1];
    else if (/^[a-zA-Z0-9_-]+$/.test(s)) fileId = s;
    if (!fileId) return "";
 
    // Check cache first (data URIs can be large, so cache by file ID)
    var cache = CacheService.getScriptCache();
    var cacheKey = "img_" + fileId;
    var cached = cache.get(cacheKey);
    if (cached) return cached;
 
    var file = DriveApp.getFileById(fileId);
    var blob = file.getBlob();
    var dataUri = "data:" + blob.getContentType() + ";base64," + Utilities.base64Encode(blob.getBytes());
 
    // Cache only if under 100KB (CacheService limit per key)
    if (dataUri.length < 100000) {
      try { cache.put(cacheKey, dataUri, 21600); } catch(e) {}
    }
    return dataUri;
  } catch(e) {
    return "";
  }
}
 
/**
 * Returns the logged-in member's full profile (Members + Member Details).
 */
function getMyProfile() {
  var ss = getSpreadsheet_();
  var email = Session.getActiveUser().getEmail();
  if (!email) throw new Error("Could not detect your email.");
  var member = findMemberByEmail_(ss, email.toLowerCase());
  if (!member) throw new Error("No member found for " + email);
 
  // Get profile photo from Members sheet
  var membersSheet = ss.getSheetByName(MEMBERS_SHEET);
  var headers = membersSheet.getRange(1, 1, 1, membersSheet.getLastColumn()).getValues()[0]
    .map(function(x) { return x.toString().trim().toLowerCase(); });
  var ppIdx = headers.indexOf("profile photo");
  var profilePhoto = (ppIdx !== -1 && member.rowIndex) ? membersSheet.getRange(member.rowIndex, ppIdx + 1).getValue().toString() : "";
 
  // Get extended details from Member Details sheet
  var details = {};
  var detailSheet = ss.getSheetByName(MEMBER_DETAILS_SHEET);
  if (detailSheet) {
    var dmap = headerIndexMap_(detailSheet);
    var dd = detailSheet.getDataRange().getValues();
    for (var i = 1; i < dd.length; i++) {
      var rEmail = dd[i][1].toString().trim().toLowerCase();
      var rName = dd[i][0].toString().trim().toLowerCase();
      if ((rEmail && rEmail === email.toLowerCase()) || (rName && rName === member.name.toLowerCase())) {
        var genderIdx = dmap["gender"], yearIdx = dmap["year of study"];
        details = {
          admissionNumber: dd[i][2].toString(), courseFaculty: dd[i][3].toString(),
          courseName: dd[i][4].toString(), nationality: dd[i][5].toString(),
          choirPart: dd[i][6].toString(), instruments: dd[i][7].toString(),
          residence: dd[i][12].toString(), dateOfBirth: dd[i][13].toString(),
          passportPhotoUrl: dd[i][17].toString(),
          gender: genderIdx != null ? dd[i][genderIdx].toString() : "",
          yearOfStudy: yearIdx != null ? dd[i][yearIdx].toString() : ""
        };
        break;
      }
    }
  }
 
  return {
    name: member.name, email: member.email, phone: member.phone,
    admNo: member.admNo, groups: member.groups, roles: member.roles,
    profilePhoto: driveAvatarDataUri_(profilePhoto), details: details
  };
}
 
/**
 * Member updates their own phone number.
 */
function updateMyPhone(newPhone) {
  var ss = getSpreadsheet_();
  var email = Session.getActiveUser().getEmail();
  if (!email) throw new Error("Could not detect your email.");
  var member = findMemberByEmail_(ss, email.toLowerCase());
  if (!member) throw new Error("No member found.");
 
  var sheet = ss.getSheetByName(MEMBERS_SHEET);
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(function(x) { return x.toString().trim().toLowerCase(); });
  var phoneIdx = headers.indexOf("phone");
  if (phoneIdx === -1) throw new Error("Phone column not found.");
 
  sheet.getRange(member.rowIndex, phoneIdx + 1).setValue(newPhone);
 
  // Also update Member Details if exists
  var detailSheet = ss.getSheetByName(MEMBER_DETAILS_SHEET);
  if (detailSheet) {
    var dd = detailSheet.getDataRange().getValues();
    for (var i = 1; i < dd.length; i++) {
      if (dd[i][1].toString().trim().toLowerCase() === email.toLowerCase()) {
        detailSheet.getRange(i + 1, 15).setValue(newPhone); // Phone Number column
        break;
      }
    }
  }
 
  return { success: true };
}
 
/**
 * Member uploads a profile photo (separate from passport photo).
 * Stored in Members sheet "Profile Photo" column.
 */
function uploadProfilePhoto(base64Data, fileName, mimeType) {
  var ss = getSpreadsheet_();
  var email = Session.getActiveUser().getEmail();
  if (!email) throw new Error("Could not detect your email.");
  var member = findMemberByEmail_(ss, email.toLowerCase());
  if (!member) throw new Error("No member found.");
 
  var folder;
  var profileFolderId = (PROFILE_PHOTO_FOLDER_ID && PROFILE_PHOTO_FOLDER_ID !== "YOUR_PROFILE_FOLDER_ID_HERE") ? PROFILE_PHOTO_FOLDER_ID : PHOTO_FOLDER_ID;
  try { folder = DriveApp.getFolderById(profileFolderId); }
  catch(e) { throw new Error("Profile photo folder not configured."); }
 
  var decoded = Utilities.base64Decode(base64Data);
  var ext = (fileName && fileName.indexOf(".") !== -1) ? fileName.split(".").pop() : "jpg";
  var safeName = "Profile_" + member.name.replace(/[^a-zA-Z0-9]/g, "_") + "." + ext;
  var blob = Utilities.newBlob(decoded, mimeType || "image/jpeg", safeName);
 
  // Remove old profile photo
  var existing = folder.getFilesByName(safeName);
  while (existing.hasNext()) { existing.next().setTrashed(true); }
 
  var file = folder.createFile(blob);
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch(e) {
    // Org may restrict link sharing — file is still saved, continue
  }
  var fileId = file.getId();
  // Use direct-content URL so the image renders in <img> tags
  var url = "https://drive.google.com/thumbnail?id=" + fileId + "&sz=w400";
 
  // Save URL to Members sheet
  var sheet = ss.getSheetByName(MEMBERS_SHEET);
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(function(x) { return x.toString().trim().toLowerCase(); });
  var ppIdx = headers.indexOf("profile photo");
  if (ppIdx === -1) {
    var lastCol = sheet.getLastColumn() + 1;
    sheet.getRange(1, lastCol).setValue("Profile Photo").setFontWeight("bold");
    ppIdx = lastCol - 1;
  }
  sheet.getRange(member.rowIndex, ppIdx + 1).setValue(url);
 
  // Return data URI for immediate iframe-safe display
  var dataUri = "data:" + (mimeType || "image/jpeg") + ";base64," + base64Data;
  return { success: true, url: dataUri };
}
 
/**
 * Member requests a name change (requires admin approval).
 */
function requestNameChange(newName, reason) {
  var ss = getSpreadsheet_();
  var email = Session.getActiveUser().getEmail();
  if (!email) throw new Error("Could not detect your email.");
  var member = findMemberByEmail_(ss, email.toLowerCase());
  if (!member) throw new Error("No member found.");
 
  var sheet = ensureApologiesSheet_(ss);
  var now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
  sheet.appendRow([todayStr_(), member.name, email, "Name Change", reason + " | New name: " + newName, now, "", "N/A", "Pending", newName, ""]);
  return { success: true };
}
 
/**
 * Member requests a section transfer.
 */
function requestSectionTransfer(targetGroups, reason) {
  var ss = getSpreadsheet_();
  var email = Session.getActiveUser().getEmail();
  if (!email) throw new Error("Could not detect your email.");
  var member = findMemberByEmail_(ss, email.toLowerCase());
  if (!member) throw new Error("No member found.");
 
  var sheet = ensureApologiesSheet_(ss);
  var now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
  var currentGroups = member.groups.join(", ");
  var targetStr = targetGroups.join(", ");
  sheet.appendRow([todayStr_(), member.name, email, "Section Transfer", "From: " + currentGroups + " | To: " + targetStr + " | Reason: " + reason, now, "", "N/A", "Pending", targetStr, ""]);
  return { success: true };
}
 
/**
 * Admin approves a section transfer — updates member's Groups column.
 */
function approveSectionTransfer(rowIndex, memberName) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(APOLOGIES_SHEET);
  if (!sheet) throw new Error("Apologies sheet not found.");
 
  var data = sheet.getRange(rowIndex, 1, 1, 11).getValues()[0];
  var targetGroups = data[9].toString(); // End Date column stores target groups
 
  // Update Members sheet Groups column
  var membersSheet = ss.getSheetByName(MEMBERS_SHEET);
  var mData = membersSheet.getDataRange().getValues();
  var mHeaders = mData[0].map(function(x) { return x.toString().trim().toLowerCase(); });
  var nameIdx = mHeaders.indexOf("name");
  var groupsIdx = mHeaders.indexOf("groups");
 
  for (var i = 1; i < mData.length; i++) {
    if (mData[i][nameIdx].toString().trim() === memberName) {
      membersSheet.getRange(i + 1, groupsIdx + 1).setValue(targetGroups);
      break;
    }
  }
 
  // Mark apology as approved
  sheet.getRange(rowIndex, 9).setValue("Approved");
  sheet.getRange(rowIndex, 11).setValue("Transfer approved");
 
  return { success: true, name: memberName, newGroups: targetGroups };
}
 
/**
 * Admin approves a name change — updates member's name across sheets.
 */
/**
 * Renames a member across EVERY sheet that stores their name as identity.
 * Name is the identity key in Members, Member Details, Attendance, Offenses, and
 * Apologies/Requests — so a rename must cascade to all of them, or the member's
 * history (attendance, offenses, scoreboard points) gets orphaned under the old name.
 *
 * @param {Spreadsheet} ss
 * @param {string} oldName
 * @param {string} newName
 * @returns {Object} counts of rows updated per sheet
 */
function cascadeMemberRename_(ss, oldName, newName) {
  oldName = oldName.toString().trim();
  newName = newName.toString().trim();
  var result = {};
 
  // sheetName -> the 0-based column index where the name lives
  var nameColumns = [
    { sheet: MEMBERS_SHEET,        col: null },  // resolved by header below
    { sheet: MEMBER_DETAILS_SHEET, col: 0    },
    { sheet: ATTENDANCE_SHEET,     col: 1    },
    { sheet: OFFENSES_SHEET,       col: null },  // resolved by header
    { sheet: APOLOGIES_SHEET,      col: 1    }
  ];
 
  nameColumns.forEach(function(target) {
    var sheet = ss.getSheetByName(target.sheet);
    if (!sheet) return;
    var data = sheet.getDataRange().getValues();
    if (data.length < 2) return;
 
    // Resolve the name column by header if not fixed
    var col = target.col;
    if (col === null) {
      var headers = data[0].map(function(x){ return x.toString().trim().toLowerCase(); });
      col = headers.indexOf("name");
      if (col === -1) return;
    }
 
    var updated = 0;
    for (var i = 1; i < data.length; i++) {
      if (data[i][col] && data[i][col].toString().trim() === oldName) {
        sheet.getRange(i + 1, col + 1).setValue(newName);
        updated++;
      }
    }
    result[target.sheet] = updated;
  });
 
  // Rebuild the derived registers/scoreboard caches so the new name aggregates correctly
  try { refreshAllRegisters_(ss); } catch(e) {}
 
  return result;
}
 
function approveNameChange(rowIndex, memberName) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(APOLOGIES_SHEET);
  if (!sheet) throw new Error("Requests sheet not found.");
 
  var data = sheet.getRange(rowIndex, 1, 1, 11).getValues()[0];
  var newName = data[9].toString().trim(); // End Date column stores new name
  if (!newName) throw new Error("No new name found in the request.");
 
  // Cascade the rename across ALL sheets (this is the fix — was only doing 2 sheets)
  var counts = cascadeMemberRename_(ss, memberName, newName);
 
  // Mark the request approved (note: do this AFTER cascade, and the request row's own
  // Name cell was just renamed too, which is fine)
  sheet.getRange(rowIndex, 9).setValue("Approved");
  sheet.getRange(rowIndex, 11).setValue("Name changed to: " + newName);
 
  return { success: true, oldName: memberName, newName: newName, updated: counts };
}
 
/**
 * Member requests an edit to their course details (faculty / course / year).
 * Stored in the requests sheet with a structured payload, pending admin approval.
 * @param {Object} changes — { courseFaculty, courseName, yearOfStudy }
 * @param {string} reason
 */
function requestCourseDetailsChange(changes, reason) {
  var ss = getSpreadsheet_();
  var email = Session.getActiveUser().getEmail();
  if (!email) throw new Error("Could not detect your email.");
  var member = findMemberByEmail_(ss, email.toLowerCase());
  if (!member) throw new Error("No member found.");
 
  var sheet = ensureApologiesSheet_(ss);
  var now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
  changes = changes || {};
  // Encode the requested values as JSON in the End Date column (col 10), mirroring
  // how section-transfer/name-change stash their target in that column for approval.
  var payload = JSON.stringify({
    courseFaculty: changes.courseFaculty || "",
    courseName: changes.courseName || "",
    yearOfStudy: changes.yearOfStudy || ""
  });
  var human = "Faculty: " + (changes.courseFaculty || "—") +
              " | Course: " + (changes.courseName || "—") +
              " | Year: " + (changes.yearOfStudy || "—") +
              " | Reason: " + (reason || "");
  sheet.appendRow([todayStr_(), member.name, email, "Course Details", human, now, "", "N/A", "Pending", payload, ""]);
  return { success: true };
}
 
/**
 * Admin approves a course-details change — writes the new values to Member Details.
 */
function approveCourseDetailsChange(rowIndex, memberName) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(APOLOGIES_SHEET);
  if (!sheet) throw new Error("Requests sheet not found.");
 
  var data = sheet.getRange(rowIndex, 1, 1, 11).getValues()[0];
  var changes;
  try { changes = JSON.parse(data[9].toString()); }
  catch(e) { throw new Error("Could not read requested changes."); }
 
  var detailSheet = ensureMemberDetailsSheet_(ss);
  var dmap = headerIndexMap_(detailSheet);
  var dd = detailSheet.getDataRange().getValues();
  for (var i = 1; i < dd.length; i++) {
    if (dd[i][0].toString().trim() === memberName) {
      if (changes.courseFaculty) detailSheet.getRange(i + 1, 4).setValue(changes.courseFaculty);  // Course Faculty
      if (changes.courseName)    detailSheet.getRange(i + 1, 5).setValue(changes.courseName);     // Course Name
      if (changes.yearOfStudy && dmap["year of study"] != null) {
        detailSheet.getRange(i + 1, dmap["year of study"] + 1).setValue(changes.yearOfStudy);
      }
      break;
    }
  }
 
  sheet.getRange(rowIndex, 9).setValue("Approved");
  sheet.getRange(rowIndex, 11).setValue("Course details updated");
  return { success: true, name: memberName };
}
 
// -------------------------------------------------------
//  REGISTERS
// -------------------------------------------------------
function refreshAllRegisters_(ss) {
  var attSheet=ss.getSheetByName(ATTENDANCE_SHEET);if(!attSheet)return;
  var attData=attSheet.getDataRange().getValues();if(attData.length<2)return;
  var allRec=[],sessDates={};
  for(var i=1;i<attData.length;i++){var ds=formatSheetDate_(attData[i][0]),n=attData[i][1].toString(),g=attData[i][2].toString(),rl=attData[i][3].toString(),st=attData[i][4].toString();
    allRec.push({date:ds,name:n,group:g,role:rl,status:st});if(!sessDates[g])sessDates[g]={};sessDates[g][ds]=true;}
  var mr=readMemberRoles_(ss);
  for(var gi=0;gi<GROUPS.length;gi++)buildGroupRegister_(ss,GROUPS[gi],allRec,sessDates[GROUPS[gi]]||{},mr);
}
 
function readMemberRoles_(ss){var all=readAllMembers_(ss),r={};for(var i=0;i<all.length;i++)r[all[i].name]={groups:all[i].groups,roles:all[i].roles};return r;}
 
function buildGroupRegister_(ss, group, allRecords, groupSessionDates, memberRoles) {
  var tabName=group+" Register",regSheet=ss.getSheetByName(tabName);if(!regSheet)regSheet=ss.insertSheet(tabName);
  var gm=[];for(var name in memberRoles){if(memberRoles[name].groups.indexOf(group)!==-1)gm.push({name:name,role:(memberRoles[name].roles&&memberRoles[name].roles[group])||"Other"});}
  gm.sort(function(a,b){return a.role!==b.role?a.role.localeCompare(b.role):a.name.localeCompare(b.name);});
  var dates=Object.keys(groupSessionDates).sort();
  if(gm.length===0&&dates.length===0){regSheet.clear();regSheet.getRange(1,1).setValue("No data yet for "+group);return;}
  var lookup={};for(var i=0;i<allRecords.length;i++){if(allRecords[i].group===group){
    // Abbreviate: P, LE, LU, AE, AU
    var abbr=allRecords[i].status==="Present"?"P":allRecords[i].status==="Late Excused"?"LE":allRecords[i].status==="Late Unexcused"?"LU":allRecords[i].status==="Absent Excused"?"AE":allRecords[i].status==="Absent Unexcused"?"AU":allRecords[i].status.charAt(0);
    lookup[allRecords[i].name+"|"+allRecords[i].date]=abbr;}}
  var roleLabel=group==="Choir"?"Part":"Role",header=["Name",roleLabel].concat(dates),output=[header];
  for(var j=0;j<gm.length;j++){var row=[gm[j].name,gm[j].role];for(var d=0;d<dates.length;d++)row.push(lookup[gm[j].name+"|"+dates[d]]||"AU");output.push(row);}
  regSheet.clear();
  if(output.length>0&&output[0].length>0){regSheet.getRange(1,1,output.length,output[0].length).setValues(output);regSheet.getRange(1,1,1,output[0].length).setFontWeight("bold");regSheet.setFrozenRows(1);regSheet.setFrozenColumns(2);}
}
 
// -------------------------------------------------------
//  UTILITY
// -------------------------------------------------------
// -------------------------------------------------------
//  SCHEDULE
// -------------------------------------------------------
 
/**
 * Looks up session start time for a given date and groups.
 * Returns the earliest start time across selected groups.
 * @param {string} dateStr — "yyyy-MM-dd"
 * @param {Array} selectedGroups
 * @returns {Object} { found: boolean, time: "HH:mm", dayName: string }
 */
// -------------------------------------------------------
//  MEETINGS (one-off sessions)
// -------------------------------------------------------
 
/** Ensures the Meetings sheet exists. */
function ensureMeetingsSheet_(ss) {
  var sheet = ss.getSheetByName(MEETINGS_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(MEETINGS_SHEET);
    sheet.appendRow(["Date", "Time", "Groups", "Title", "Created By", "Timestamp"]);
    sheet.getRange(1, 1, 1, 6).setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  return sheet;
}
 
/**
 * Admin schedules a one-off meeting.
 * @param {string} dateStr — "yyyy-MM-dd"
 * @param {string} time — "HH:mm"
 * @param {Array} groups — which groups the meeting applies to
 * @param {string} title — meeting title/description
 */
function addMeeting(dateStr, time, groups, title) {
  var ss = getSpreadsheet_();
  if (!dateStr) throw new Error("Date is required.");
  if (!time) throw new Error("Time is required.");
  if (!groups || groups.length === 0) throw new Error("Select at least one group.");
 
  var sheet = ensureMeetingsSheet_(ss);
  var email = Session.getActiveUser().getEmail() || "";
  var now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
  // Normalize time to HH:mm
  var normTime = parseTimeStr_(time) || time;
  sheet.appendRow([dateStr, normTime, groups.join(", "), title || "Meeting", email, now]);
  return { success: true, date: dateStr, time: normTime };
}
 
/**
 * Object-argument alias for the client. Accepts { date, time, title, groups }.
 */
function scheduleMeeting(payload) {
  payload = payload || {};
  return addMeeting(payload.date, payload.time, payload.groups, payload.title);
}
 
/**
 * Returns upcoming meetings (today onward by default).
 * @param {string} fromDate — optional "yyyy-MM-dd"; defaults to today
 */
function getMeetings(fromDate) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(MEETINGS_SHEET);
  if (!sheet) return [];
  var data = sheet.getDataRange().getValues();
  var today = fromDate || todayStr_();
  var dayNames = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  var out = [];
  for (var i = 1; i < data.length; i++) {
    var dateStr = formatSheetDate_(data[i][0]);
    if (dateStr < today) continue; // past meetings skipped
    var timeStr = data[i][1] instanceof Date
      ? Utilities.formatDate(data[i][1], Session.getScriptTimeZone(), "HH:mm")
      : parseTimeStr_(data[i][1].toString().trim());
    var dp = dateStr.split("-");
    var dObj = new Date(parseInt(dp[0]), parseInt(dp[1])-1, parseInt(dp[2]));
    out.push({
      id: i + 1,            // client uses "id"
      rowIndex: i + 1,      // kept for backward compat
      date: dateStr,
      dayName: dayNames[dObj.getDay()],
      time: timeStr,
      groups: data[i][2].toString().split(",").map(function(g){ return g.trim(); }).filter(Boolean),
      title: data[i][3].toString(),
      createdBy: data[i][4].toString()
    });
  }
  out.sort(function(a, b) { return (a.date + a.time).localeCompare(b.date + b.time); });
  return out;
}
 
/** Deletes a meeting by row index. */
function deleteMeeting(rowIndex) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(MEETINGS_SHEET);
  if (!sheet) throw new Error("Meetings sheet not found.");
  sheet.deleteRow(rowIndex);
  return { success: true };
}
 
/**
 * Returns meeting info for a specific date + groups (for Record auto-fill).
 * Mirrors getSessionTime's shape so the Record tab can use either.
 */
function getMeetingForDate(dateStr, selectedGroups) {
  var meetings = getMeetings(dateStr);
  var earliest = null, latest = null, title = "", matchGroups = [];
  for (var i = 0; i < meetings.length; i++) {
    var mt = meetings[i];
    if (mt.date !== dateStr) continue;
    var applies = mt.groups.some(function(g) { return selectedGroups.indexOf(g) !== -1; });
    if (!applies) continue;
    if (!earliest || mt.time < earliest) earliest = mt.time;
    if (!latest || mt.time > latest) latest = mt.time;
    title = mt.title;
    mt.groups.forEach(function(g){ if (matchGroups.indexOf(g) === -1) matchGroups.push(g); });
  }
  return { found: earliest !== null, time: earliest || "", latest: latest || "", title: title, groups: matchGroups };
}
 
function getSessionTime(dateStr, selectedGroups) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(SCHEDULE_SHEET);
 
  var parts = dateStr.split("-");
  var d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
  var days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var dayName = days[d.getDay()];
 
  var earliest = null, latest = null;
 
  // Practices from Schedule
  if (sheet) {
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      var rowDay = data[i][0].toString().trim();
      var rowGroup = data[i][1].toString().trim();
      var rowTime = data[i][2];
 
      if (rowDay.toLowerCase() !== dayName.toLowerCase()) continue;
      if (selectedGroups.indexOf(rowGroup) === -1) continue;
 
      var timeStr = "";
      if (rowTime instanceof Date) {
        timeStr = Utilities.formatDate(rowTime, Session.getScriptTimeZone(), "HH:mm");
      } else {
        timeStr = parseTimeStr_(rowTime.toString().trim());
      }
 
      if (!earliest || timeStr < earliest) earliest = timeStr;
      if (!latest || timeStr > latest) latest = timeStr;
    }
  }
 
  // Meetings (one-off) for this exact date
  var mt = getMeetingForDate(dateStr, selectedGroups);
  if (mt.found) {
    if (!earliest || mt.time < earliest) earliest = mt.time;
    if (!latest || mt.latest > latest) latest = mt.latest;
  }
 
  return { found: earliest !== null, time: earliest || "", latest: latest || "", dayName: dayName };
}
 
/**
 * Parses various time formats to "HH:mm".
 * Handles: "5:30 PM", "17:30", "5:30pm", "11:00 AM"
 */
function parseTimeStr_(str) {
  if (!str) return "";
  // Already HH:mm
  if (/^\d{1,2}:\d{2}$/.test(str)) {
    var p = str.split(":");
    return String(parseInt(p[0])).padStart(2, "0") + ":" + p[1];
  }
  // 12-hour format
  var match = str.match(/^(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)$/i);
  if (match) {
    var h = parseInt(match[1]), m = match[2], ampm = match[3].toUpperCase();
    if (ampm === "PM" && h < 12) h += 12;
    if (ampm === "AM" && h === 12) h = 0;
    return String(h).padStart(2, "0") + ":" + m;
  }
  return str;
}
 
// -------------------------------------------------------
//  APOLOGIES
// -------------------------------------------------------
 
/**
 * Member submits an apology.
 * Auto-validates timing: submitted_at must be >= 1 hour before session start.
 * @param {string} dateStr — session date
 * @param {string} apologyType — "Late" or "Absent"
 * @param {string} reason
 * @param {string} sessionTime — "HH:mm" from the schedule/form
 */
// Apologies sheet columns:
// 0:Date 1:Name 2:Email 3:Type 4:Reason 5:SubmittedAt 6:SessionTime 7:OnTime 8:Status 9:EndDate 10:ReviewNote
 
function ensureApologiesSheet_(ss) {
  var sheet = ss.getSheetByName(APOLOGIES_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(APOLOGIES_SHEET);
    sheet.appendRow(["Date","Name","Email","Type","Reason","Submitted At","Session Time","On Time","Status","End Date","Review Note","Session Groups"]);
    sheet.getRange(1,1,1,12).setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  // Migrate: add End Date and Review Note columns if missing
  if (sheet.getLastColumn() < 11) {
    if (sheet.getLastColumn() < 10) sheet.getRange(1,10).setValue("End Date").setFontWeight("bold");
    if (sheet.getLastColumn() < 11) sheet.getRange(1,11).setValue("Review Note").setFontWeight("bold");
  }
  // Migrate: add Session Groups column (col 12) for per-session apology matching
  if (sheet.getLastColumn() < 12) {
    sheet.getRange(1,12).setValue("Session Groups").setFontWeight("bold");
  }
  return sheet;
}
 
/**
 * Member submits a single-day apology.
 */
function submitApology(dateStr, apologyType, reason, sessionTime, sessionLabel, sessionGroups) {
  var ss = getSpreadsheet_();
  var email = Session.getActiveUser().getEmail();
  if (!email) throw new Error("Could not detect your email.");
  var member = findMemberByEmail_(ss, email.toLowerCase());
  if (!member) throw new Error("No member found for " + email);
 
  var sheet = ensureApologiesSheet_(ss);
  var now = new Date();
  var submittedAt = Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
 
  var onTime = false;
  if (sessionTime) {
    var sp = sessionTime.split(":"), dp = dateStr.split("-");
    var sessionDT = new Date(parseInt(dp[0]), parseInt(dp[1])-1, parseInt(dp[2]), parseInt(sp[0]), parseInt(sp[1]));
    onTime = now <= new Date(sessionDT.getTime() - 3600000);
  }
 
  // Store session label (e.g. "Practice" or meeting title) in the reason prefix if provided,
  // so the admin queue and member list can tell which session an apology targets.
  var storedReason = sessionLabel ? ("[" + sessionLabel + " @ " + (sessionTime||"") + "] " + reason) : reason;
  // Session groups (sorted, comma-joined) for per-session matching against attendance
  var groupsStr = (sessionGroups && sessionGroups.length) ? sessionGroups.slice().sort().join(",") : "";
 
  sheet.appendRow([dateStr, member.name, email, apologyType, storedReason, submittedAt, sessionTime||"", onTime?"Yes":"No", "Pending", "", "", groupsStr]);
  return { success: true, name: member.name, onTime: onTime };
}
 
/**
 * Member submits a long-term apology (date range, max 3 months).
 */
function submitLongTermApology(startDate, endDate, reason) {
  var ss = getSpreadsheet_();
  var email = Session.getActiveUser().getEmail();
  if (!email) throw new Error("Could not detect your email.");
  var member = findMemberByEmail_(ss, email.toLowerCase());
  if (!member) throw new Error("No member found for " + email);
 
  // Validate range: max 3 months
  var sd = new Date(startDate), ed = new Date(endDate);
  if (ed < sd) throw new Error("End date must be after start date.");
  var maxEnd = new Date(sd); maxEnd.setMonth(maxEnd.getMonth() + 3);
  if (ed > maxEnd) throw new Error("Long-term apology cannot exceed 3 months.");
 
  var sheet = ensureApologiesSheet_(ss);
  var now = new Date();
  var submittedAt = Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
 
  sheet.appendRow([startDate, member.name, email, "Absent", reason, submittedAt, "", "N/A", "Pending", endDate, ""]);
 
  // Notify admins of the long-term apology
  try {
    sendLongTermApologyNotification_(member.name, email, startDate, endDate, reason);
  } catch(e) {}
 
  return { success: true, name: member.name, startDate: startDate, endDate: endDate };
}
 
/**
 * Emails admins when a long-term apology is submitted (needs their review).
 */
function sendLongTermApologyNotification_(name, email, startDate, endDate, reason) {
  var subject = "Long-Term Apology — " + name + " (needs review)";
  var webAppUrl = APP_URL || ScriptApp.getService().getUrl();
 
  // Look up member's groups for the template
  var groups = "";
  try {
    var mem = findMemberByEmail_(getSpreadsheet_(), email.toLowerCase());
    if (mem) groups = mem.groups.join(", ");
  } catch(e) {}
 
  var html = renderEmailTemplate_("longterm-apology", {
    memberName: name,
    groups: groups || "—",
    apologyStart: startDate,
    apologyEnd: endDate,
    apologyReason: reason,
    appUrl: webAppUrl
  }, { signatureKey: null });
 
  MailApp.sendEmail({
    to: EMAIL_CC,
    subject: subject,
    htmlBody: html,
    name: EMAIL_FROM_NAME
  });
}
 
/**
 * Returns the logged-in member's apologies.
 */
function getMyApologies() {
  var ss = getSpreadsheet_();
  var email = Session.getActiveUser().getEmail();
  if (!email) return [];
  var member = findMemberByEmail_(ss, email.toLowerCase());
  if (!member) return [];
  var sheet = ss.getSheetByName(APOLOGIES_SHEET);
  if (!sheet) return [];
  var data = sheet.getDataRange().getValues();
  var result = [];
  for (var i = 1; i < data.length; i++) {
    if (data[i][1].toString() !== member.name) continue;
    var rType = data[i][3].toString();
    var isReq = isRequestType_(rType);
    var col9 = data[i][9] ? data[i][9].toString() : "";
    result.push({
      date: formatSheetDate_(data[i][0]),
      type: rType,
      isRequest: isReq,
      reason: data[i][4].toString(),
      submittedAt: data[i][5].toString(),
      onTime: data[i][7].toString() === "Yes",
      status: data[i][8].toString(),
      endDate: (!isReq && col9) ? formatSheetDate_(data[i][9]) : "",
      rawEndDate: col9,
      reviewNote: data[i][10] ? data[i][10].toString() : ""
    });
  }
  result.sort(function(a, b) { return b.date.localeCompare(a.date); });
  return result;
}
 
/**
 * Returns apologies for a date — checks single-day and long-term approved ranges.
 * When selectedGroups is provided, only returns apologies whose session groups
 * overlap the session being recorded (per-session matching). An apology with no
 * stored session groups (legacy or general) matches any session that day.
 */
function getApologiesForDate(dateStr, selectedGroups) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(APOLOGIES_SHEET);
  if (!sheet) return {};
  var data = sheet.getDataRange().getValues();
  var result = {};
 
  for (var i = 1; i < data.length; i++) {
    var rowType = data[i][3].toString();
    // Skip administrative requests — they live in this sheet but are NOT apologies.
    if (isRequestType_(rowType)) continue;
 
    var rowDate = formatSheetDate_(data[i][0]);
    var status = data[i][8].toString();
    var endDate = data[i][9] ? formatSheetDate_(data[i][9]) : "";
    var name = data[i][1].toString();
    var apologyGroups = data[i][11] ? data[i][11].toString().split(",").map(function(g){return g.trim();}).filter(Boolean) : [];
 
    // Session-group filter: if the apology specifies groups AND we're recording specific
    // groups, only match when they overlap. Apologies with no groups match any session.
    var groupMatch = true;
    if (selectedGroups && selectedGroups.length && apologyGroups.length) {
      groupMatch = apologyGroups.some(function(g){ return selectedGroups.indexOf(g) !== -1; });
    }
 
    // Single-day: date matches, not rejected/revoked, group overlaps
    if (!endDate && rowDate === dateStr && groupMatch && status !== "Rejected" && status !== "Revoked" && status !== "Applied") {
      var onTime = data[i][7].toString() === "Yes";
      result[name] = { type: data[i][3].toString(), reason: data[i][4].toString(), onTime: onTime, status: status, rowIndex: i+1, longTerm: false };
    }
 
    // Long-term: date falls within approved range (applies to all sessions that day)
    if (endDate && status === "Approved" && dateStr >= rowDate && dateStr <= endDate) {
      result[name] = { type: "Absent", reason: data[i][4].toString(), onTime: true, status: "Approved", rowIndex: i+1, longTerm: true };
    }
  }
  return result;
}
 
/**
 * Returns all apologies for admin review queue.
 */
function getApologyQueue() {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(APOLOGIES_SHEET);
  if (!sheet) return [];
  var data = sheet.getDataRange().getValues();
  var result = [];
  for (var i = 1; i < data.length; i++) {
    var rType = data[i][3].toString();
    var isReq = isRequestType_(rType);
    var col9 = data[i][9] ? data[i][9].toString() : "";
    result.push({
      rowIndex: i + 1,
      date: formatSheetDate_(data[i][0]),
      name: data[i][1].toString(),
      email: data[i][2].toString(),
      type: rType,
      isRequest: isReq,
      reason: data[i][4].toString(),
      submittedAt: data[i][5].toString(),
      onTime: data[i][7].toString() === "Yes",
      status: data[i][8].toString(),
      // For requests, col 9 holds the payload (new name / target groups / JSON) — keep it raw.
      // For apologies, it's a genuine long-term end date — parse it.
      endDate: (!isReq && col9) ? formatSheetDate_(data[i][9]) : "",
      rawEndDate: col9,
      reviewNote: data[i][10] ? data[i][10].toString() : ""
    });
  }
  // Enrich Course Details rows with the requester's CURRENT academic details, so the
  // admin sees a before -> after preview parallel to Name Change (which uses the row's
  // own name as "before"). Read-side only; the request/approve contract is unchanged.
  var needsCourse = result.some(function (a) { return a.type === "Course Details"; });
  if (needsCourse) {
    var detailSheet = ss.getSheetByName(MEMBER_DETAILS_SHEET);
    if (detailSheet) {
      var dmap = headerIndexMap_(detailSheet);
      var fIdx = dmap["course faculty"], cIdx = dmap["course name"], yIdx = dmap["year of study"];
      var dd = detailSheet.getDataRange().getValues();
      var byEmail = {}, byName = {};
      for (var d = 1; d < dd.length; d++) {
        var cur = {
          courseFaculty: fIdx != null ? (dd[d][fIdx] || "").toString().trim() : "",
          courseName:    cIdx != null ? (dd[d][cIdx] || "").toString().trim() : "",
          yearOfStudy:   yIdx != null ? (dd[d][yIdx] || "").toString().trim() : ""
        };
        var em = (dd[d][1] || "").toString().trim().toLowerCase();
        var nm = (dd[d][0] || "").toString().trim();
        if (em) byEmail[em] = cur;
        if (nm) byName[nm] = cur;
      }
      result.forEach(function (a) {
        if (a.type !== "Course Details") return;
        var cur = byEmail[(a.email || "").toLowerCase()] || byName[a.name] || null;
        if (cur) {
          a.oldCourseFaculty = cur.courseFaculty;
          a.oldCourseName    = cur.courseName;
          a.oldYearOfStudy   = cur.yearOfStudy;
        }
      });
    }
  }
 
  // Sort: Pending first, then by date descending
  var statusOrder = { "Pending": 0, "Applied": 1, "Approved": 1, "Rejected": 2, "Revoked": 2 };
  result.sort(function(a, b) {
    var sa = statusOrder[a.status] !== undefined ? statusOrder[a.status] : 3;
    var sb = statusOrder[b.status] !== undefined ? statusOrder[b.status] : 3;
    if (sa !== sb) return sa - sb;
    return b.date.localeCompare(a.date);
  });
  return result;
}
 
/**
 * Admin approves an apology.
 */
function approveApology(rowIndex, note) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(APOLOGIES_SHEET);
  if (!sheet) throw new Error("Apologies sheet not found.");
  sheet.getRange(rowIndex, 9).setValue("Approved"); // Status
  if (note) sheet.getRange(rowIndex, 11).setValue(note);
  return { success: true };
}
 
/**
 * Admin rejects an apology. If it was already applied to attendance, cascades the change.
 */
function rejectApology(rowIndex, note) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(APOLOGIES_SHEET);
  if (!sheet) throw new Error("Apologies sheet not found.");
 
  var data = sheet.getRange(rowIndex, 1, 1, 11).getValues()[0];
  var currentStatus = data[8].toString();
  var memberName = data[1].toString();
  var dateStr = formatSheetDate_(data[0]);
  var apologyType = data[3].toString();
 
  // Set status to Rejected or Revoked
  var newStatus = (currentStatus === "Applied" || currentStatus === "Approved") ? "Revoked" : "Rejected";
  sheet.getRange(rowIndex, 9).setValue(newStatus);
  if (note) sheet.getRange(rowIndex, 11).setValue(note);
 
  // If was applied, cascade: change attendance LE→LU or AE→AU
  var cascaded = 0;
  if (currentStatus === "Applied") {
    var attSheet = ss.getSheetByName(ATTENDANCE_SHEET);
    if (attSheet) {
      var attData = attSheet.getDataRange().getValues();
      for (var i = 1; i < attData.length; i++) {
        if (attData[i][1].toString() !== memberName) continue;
        if (formatSheetDate_(attData[i][0]) !== dateStr) continue;
        var attStatus = attData[i][4].toString();
        var newAttStatus = "";
        if (apologyType === "Late" && attStatus === "Late Excused") newAttStatus = "Late Unexcused";
        else if (apologyType === "Absent" && attStatus === "Absent Excused") newAttStatus = "Absent Unexcused";
        if (newAttStatus) {
          attSheet.getRange(i + 1, 5).setValue(newAttStatus);
          cascaded++;
        }
      }
      if (cascaded > 0) refreshAllRegisters_(ss);
    }
  }
 
  // For approved long-term apologies being revoked, cascade all dates in range
  if (currentStatus === "Approved" && data[9]) {
    var endDate = formatSheetDate_(data[9]);
    var attSheet2 = ss.getSheetByName(ATTENDANCE_SHEET);
    if (attSheet2) {
      var attData2 = attSheet2.getDataRange().getValues();
      for (var j = 1; j < attData2.length; j++) {
        if (attData2[j][1].toString() !== memberName) continue;
        var recDate = formatSheetDate_(attData2[j][0]);
        if (recDate < dateStr || recDate > endDate) continue;
        if (attData2[j][4].toString() === "Absent Excused") {
          attSheet2.getRange(j + 1, 5).setValue("Absent Unexcused");
          cascaded++;
        }
      }
      if (cascaded > 0) refreshAllRegisters_(ss);
    }
  }
 
  return { success: true, newStatus: newStatus, cascaded: cascaded };
}
 
/**
 * Gets the upcoming session time for a member to know their apology deadline.
 * Used in My Attendance tab.
 */
/**
 * Marks matching apologies as "Applied" after attendance is saved.
 * Matches by date + name where the attendance status corresponds to the apology type.
 */
function markApologiesApplied_(ss, dateStr, records) {
  var sheet = ss.getSheetByName(APOLOGIES_SHEET);
  if (!sheet) return;
 
  var data = sheet.getDataRange().getValues();
 
  // Build a lookup of saved attendance: name -> status
  var attLookup = {};
  for (var r = 0; r < records.length; r++) {
    attLookup[records[r].name] = records[r].status;
  }
 
  for (var i = 1; i < data.length; i++) {
    var apologyType = data[i][3].toString();
    // Skip administrative requests — not apologies.
    if (isRequestType_(apologyType)) continue;
 
    var status = data[i][8].toString();
    if (status !== "Pending" && status !== "Approved") continue;
 
    var name = data[i][1].toString();
    var attStatus = attLookup[name];
    if (!attStatus) continue;
 
    var rowDate = formatSheetDate_(data[i][0]);
    var endDate = data[i][9] ? formatSheetDate_(data[i][9]) : "";
 
    // Check date match: single-day exact match, or long-term range
    var dateMatch = false;
    if (!endDate && rowDate === dateStr) dateMatch = true;
    if (endDate && dateStr >= rowDate && dateStr <= endDate) dateMatch = true;
    if (!dateMatch) continue;
 
    // Check if attendance status matches apology type
    var applied = false;
    if (apologyType === "Late" && attStatus === "Late Excused") applied = true;
    if (apologyType === "Absent" && attStatus === "Absent Excused") applied = true;
 
    if (applied && !endDate) {
      // Single-day: mark as Applied
      sheet.getRange(i + 1, 9).setValue("Applied");
    }
    // Long-term: keep as Approved (don't change to Applied since it covers multiple dates)
  }
}
 
function getNextSessionInfo() {
  var ss = getSpreadsheet_();
  var email = Session.getActiveUser().getEmail();
  if (!email) return null;
  var member = findMemberByEmail_(ss, email.toLowerCase());
  if (!member) return null;
 
  var memberGroups = member.groups.filter(function(g) { return GROUPS.indexOf(g) !== -1; });
  if (memberGroups.length === 0) return null;
 
  // Check today and next 7 days
  var now = new Date();
  for (var d = 0; d < 7; d++) {
    var checkDate = new Date(now.getTime() + d * 24 * 60 * 60 * 1000);
    var dateStr = Utilities.formatDate(checkDate, Session.getScriptTimeZone(), "yyyy-MM-dd");
    var info = getSessionTime(dateStr, memberGroups);
    if (info.found) {
      // Use latest session time for deadline (most generous)
      var latestTime = info.latest || info.time;
      var latestParts = latestTime.split(":");
      var latestDT = new Date(checkDate.getFullYear(), checkDate.getMonth(), checkDate.getDate(), parseInt(latestParts[0]), parseInt(latestParts[1]));
      // Use earliest time to check if any session is still upcoming
      var earliestParts = info.time.split(":");
      var earliestDT = new Date(checkDate.getFullYear(), checkDate.getMonth(), checkDate.getDate(), parseInt(earliestParts[0]), parseInt(earliestParts[1]));
      if (latestDT > now) {
        var deadlineDT = new Date(latestDT.getTime() - 60 * 60 * 1000);
        return {
          date: dateStr,
          dayName: info.dayName,
          time: info.time,
          groups: memberGroups,
          deadline: Utilities.formatDate(deadlineDT, Session.getScriptTimeZone(), "HH:mm"),
          deadlinePassed: now > deadlineDT
        };
      }
    }
  }
  return null;
}
 
/**
 * Returns ALL upcoming sessions (practices + meetings) for the member in the next 7 days,
 * each as a separate entry with its own deadline. This supports per-session apologies.
 * Each entry: { date, dayName, time, type:"Practice"|"Meeting", title, groups, deadline, deadlinePassed, sessionKey }
 */
function getUpcomingSessions() {
  var ss = getSpreadsheet_();
  var email = Session.getActiveUser().getEmail();
  if (!email) return [];
  var member = findMemberByEmail_(ss, email.toLowerCase());
  if (!member) return [];
 
  var memberGroups = member.groups.filter(function(g) { return GROUPS.indexOf(g) !== -1; });
  if (memberGroups.length === 0) return [];
 
  var now = new Date();
  var days = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  var sessions = [];
 
  for (var d = 0; d < 7; d++) {
    var checkDate = new Date(now.getTime() + d * 86400000);
    var dateStr = Utilities.formatDate(checkDate, Session.getScriptTimeZone(), "yyyy-MM-dd");
    var dayName = days[checkDate.getDay()];
 
    // --- Practices from Schedule (group the member belongs to) ---
    var schedSheet = ss.getSheetByName(SCHEDULE_SHEET);
    var practiceTimes = {}; // time -> groups[]
    if (schedSheet) {
      var sdata = schedSheet.getDataRange().getValues();
      for (var i = 1; i < sdata.length; i++) {
        var rowDay = sdata[i][0].toString().trim();
        var rowGroup = sdata[i][1].toString().trim();
        if (rowDay.toLowerCase() !== dayName.toLowerCase()) continue;
        if (memberGroups.indexOf(rowGroup) === -1) continue;
        var t = sdata[i][2] instanceof Date
          ? Utilities.formatDate(sdata[i][2], Session.getScriptTimeZone(), "HH:mm")
          : parseTimeStr_(sdata[i][2].toString().trim());
        if (!practiceTimes[t]) practiceTimes[t] = [];
        if (practiceTimes[t].indexOf(rowGroup) === -1) practiceTimes[t].push(rowGroup);
      }
    }
    for (var pt in practiceTimes) {
      sessions.push(buildSessionEntry_(dateStr, dayName, pt, "Practice", "Practice", practiceTimes[pt], checkDate, now));
    }
 
    // --- Meetings on this exact date that apply to the member ---
    var meetings = getMeetings(dateStr);
    for (var mi = 0; mi < meetings.length; mi++) {
      var mt = meetings[mi];
      if (mt.date !== dateStr) continue;
      var applies = mt.groups.some(function(g){ return memberGroups.indexOf(g) !== -1; });
      if (!applies) continue;
      sessions.push(buildSessionEntry_(dateStr, dayName, mt.time, "Meeting", mt.title, mt.groups, checkDate, now));
    }
  }
 
  // Only future sessions (deadline-relevant): keep those whose session time hasn't passed
  sessions = sessions.filter(function(s){ return !s.sessionPassed; });
  sessions.sort(function(a, b){ return (a.date + a.time).localeCompare(b.date + b.time); });
  return sessions;
}
 
/** Builds a single session entry with deadline logic. */
function buildSessionEntry_(dateStr, dayName, time, type, title, groups, checkDate, now) {
  var tp = time.split(":");
  var sessionDT = new Date(checkDate.getFullYear(), checkDate.getMonth(), checkDate.getDate(), parseInt(tp[0]), parseInt(tp[1]));
  var deadlineDT = new Date(sessionDT.getTime() - 60 * 60 * 1000);
  return {
    date: dateStr,
    dayName: dayName,
    time: time,
    type: type,
    kind: type,          // client uses "kind"
    title: title,
    groups: groups,
    deadline: Utilities.formatDate(deadlineDT, Session.getScriptTimeZone(), "HH:mm"),
    deadlinePassed: now > deadlineDT,
    sessionPassed: now > sessionDT,
    sessionKey: dateStr + "|" + time + "|" + groups.slice().sort().join(",")
  };
}
 
function formatSheetDate_(v){return v instanceof Date?Utilities.formatDate(v,Session.getScriptTimeZone(),"yyyy-MM-dd"):v.toString();}
 
function parseFlexDate_(str) {
  if(!str)return"";if(/^\d{4}-\d{1,2}-\d{1,2}$/.test(str))return str;
  var p=str.split(/[\/\-]/);if(p.length===3){var a=parseInt(p[0],10),b=parseInt(p[1],10),c=parseInt(p[2],10);
    if(p[0].length===4)return p[0]+"-"+String(b).padStart(2,"0")+"-"+String(c).padStart(2,"0");
    if(p[2].length===4){if(b>12)return String(c)+"-"+String(a).padStart(2,"0")+"-"+String(b).padStart(2,"0");return String(c)+"-"+String(b).padStart(2,"0")+"-"+String(a).padStart(2,"0");}}
  return str;
}
 
function rebuildRegisters(){refreshAllRegisters_(getSpreadsheet_());}
 
/**
 * Manually triggers probation evaluation. Callable from the UI.
 */
function onOpen(){SpreadsheetApp.getUi().createMenu("Attendance").addItem("Open Attendance Form","showSidebar").addItem("Rebuild Register Views","rebuildRegisters").addToUi();}
function showSidebar(){SpreadsheetApp.getUi().showSidebar(HtmlService.createTemplateFromFile("Page").evaluate().setTitle("Chorale Attendance").setWidth(420));}