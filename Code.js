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
var SCHEDULED_SHEET  = "Scheduled Emails";
var REQUEST_TYPES = ["Name Change", "Section Transfer", "Course Details", "Restart Probation", "Rejoin Request"];
function isRequestType_(type) {
  return REQUEST_TYPES.indexOf(String(type || "").trim()) !== -1;
}
var MEMBER_DETAILS_SHEET = "Member Details";
var PROBATION_HISTORY_SHEET = "Probation History";
var CONFIG_SHEET     = "Config";
var SIGNATURES_SHEET = "Signatures";
var PHOTO_FOLDER_ID  = "1-HhDK1DNADta_zoqSlkcRJLZqXOl4WNlixQinheteKcc0Sf-whvREBR81ABgAIuzgHHAvBgk";
var PROFILE_PHOTO_FOLDER_ID = "1QyfgOnHAA71NX1WJCpTbXonJJDJVzU5O";
var ATTACHMENT_FOLDER_ID = "1ruOobDLFVdJ4sq1n98wsWm-G1c5UKjuP";
var GROUPS           = ["Choir", "Band", "Orchestra"];
var ROLE_COLUMNS     = { "Choir": "choir part", "Band": "band role", "Orchestra": "orchestra role" };
var PROBATION_THRESHOLD = 0.8;
var PROBATION_CONDITIONAL = 0.5; // 50% — below this = failed
var PROBATION_PENALTY_MULTIPLIER = 2; // penalty per missed session
var WHATSAPP_COMMUNITY_LINK = "https://chat.whatsapp.com/IeDdUZmWIiM6UV8rOjmv2u?s=sw&p=a&ilr=4&amv=1"; // WhatsApp community invite link, shown ONLY in the welcome email
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
var AU_REMOVAL_ENABLED = false;

// Consecutive absence penalty
// Apologies must be submitted at least this many minutes before the session starts.
var APOLOGY_DEADLINE_MINUTES = 30;
var CONSECUTIVE_ABSENCE_COUNT = 3;
var CONSECUTIVE_ABSENCE_PENALTY = -2;


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
// -------------------------------------------------------
//  SCHEMA GUARD
//  Much of the code reads position-dependent columns (Apologies, Member Details,
//  Attendance, Offenses, Meetings). Reordering/inserting columns there breaks
//  things SILENTLY. This guard makes drift LOUD: validateSheetSchemas() compares
//  each sheet's actual headers to the expected order and reports mismatches.
//  Runs in the daily tasks with an email alert to admins on drift.
//  Convention going forward: NEW columns are appended at the END and read by
//  header (headerIndexMap_) — never inserted mid-sheet.
// -------------------------------------------------------
var SHEET_SCHEMAS = {
  // order === true → column ORDER is load-bearing (positional reads exist).
  // order === false → only PRESENCE matters (all reads are header-based).
  "Attendance": { order: true, headers: ["Date","Name","Group","Role","Status","Recorded By","Timestamp","Session"] },
  "Apologies": { order: true, headers: ["Date","Name","Email","Type","Reason","Submitted At","Session Time","On Time","Status","End Date","Review Note","Session Groups"] },
  "Member Details": { order: true, headers: ["Name","Email","Admission Number","Course Faculty","Course Name","Nationality","Choir Part","Band/Orchestra Instruments","Next of Kin Name","Next of Kin Phone","Next of Kin Relationship","Next of Kin Residence","Residence","Date of Birth","Phone Number","Passport Number","National ID Number","Passport Photo URL","Onboarding Completed","Completed At","Member Status"] },
  "Offenses": { order: true, headers: ["Date","Name","Description","Recorded By","Timestamp"] },
  "Meetings": { order: true, headers: ["Date","Time","Groups","Title","Created By","Timestamp"] },
  "Members": { order: false, headers: ["Name","Email","Phone","Groups","Choir Part","Band Role","Orchestra Role","Adm. No.","Status","Profile Photo"] },
  "Admins": { order: false, headers: ["Email","Role","Section","Rep Group"] },
  "Probation History": { order: false, headers: ["Name","Probation Start","Outcome","Attended","Required"] },
  "Rewards": { order: false, headers: ["Date","Name","Category","Description","Points","Recorded By"] } // Email may sit anywhere, but the header MUST exist
};

/**
 * Validates every schema-tracked sheet against SHEET_SCHEMAS.
 * Returns { ok: bool, problems: [ "sheet: message", ... ] }.
 * Run from the editor anytime; also runs daily with an admin email on drift.
 */
function validateSheetSchemas() {
  var ss = getSpreadsheet_();
  var problems = [];
  for (var sheetName in SHEET_SCHEMAS) {
    var spec = SHEET_SCHEMAS[sheetName];
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) continue; // auto-created sheets may not exist yet — not drift
    if (sheet.getLastRow() === 0 || sheet.getLastColumn() === 0) continue; // empty — initialized on first write
    var actual = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
      .map(function(x){ return x.toString().trim(); });
    var actualLower = actual.map(function(x){ return x.toLowerCase(); });

    if (spec.order) {
      // Every expected header must be at its exact position (extra appended columns are fine)
      for (var i = 0; i < spec.headers.length; i++) {
        var want = spec.headers[i];
        var got = actual[i] !== undefined ? actual[i] : "(missing)";
        if (got.toLowerCase() !== want.toLowerCase()) {
          problems.push(sheetName + ": column " + (i + 1) + " should be \"" + want + "\" but is \"" + got + "\" — positional reads will hit the wrong data.");
        }
      }
    } else {
      // Presence-only: each expected header must exist somewhere
      for (var j = 0; j < spec.headers.length; j++) {
        if (actualLower.indexOf(spec.headers[j].toLowerCase()) === -1) {
          problems.push(sheetName + ": missing column \"" + spec.headers[j] + "\".");
        }
      }
    }
  }
  var result = { ok: problems.length === 0, problems: problems };
  Logger.log(result.ok ? "All sheet schemas OK." : ("SCHEMA DRIFT:\n" + problems.join("\n")));
  return result;
}

/** Daily drift check — emails admins if a schema problem is detected. */
function dailySchemaCheck_() {
  var r = validateSheetSchemas();
  if (r.ok) return;
  try {
    var admins = getAdminEmails_(getSpreadsheet_());
    if (!admins.length) return;
    MailApp.sendEmail(admins.join(","),
      "\u26A0\uFE0F Chorale system \u2014 sheet column drift detected",
      "The attendance system detected column changes that can silently corrupt data:\n\n" +
      r.problems.join("\n") +
      "\n\nPlease restore the expected column order (or contact the system admin) before recording attendance or approving requests.",
      { name: EMAIL_FROM_NAME });
  } catch(e) { Logger.log("Schema alert failed: " + e); }
}

// -------------------------------------------------------
//  ROLES & ACCESS (Part D)
//  Tiers: admin (all sections, full) > sectionAdmin (one section, full within it)
//         > elevated (one rep-group within a section) > member (own data).
//  Storage: Admins sheet columns — Email | Role | Section | Rep Group.
//  A row with a blank Role = full "Admin" (backward compatible with the old
//  email-only sheet). Rep-groups: in Choir the rep-group IS the choir part
//  (Tenor rep ↔ Tenors); in Band/Orchestra it's an instrument FAMILY
//  (Strings rep ↔ Violin/Cello/Viola...), mapped in the Config sheet via the
//  "Instrument" and "Instrument Family" columns.
// -------------------------------------------------------
var ROLE_LEVELS = { admin: 3, sectionAdmin: 2, elevated: 1, member: 0, unknown: -1 };

/** Ensures the Admins sheet has the Role/Section/Rep Group columns (migration). */
function ensureAdminsSheetColumns_(ss) {
  var sheet = ss.getSheetByName(ADMINS_SHEET);
  if (!sheet) return null;
  if (sheet.getLastColumn() === 0 || sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, 4).setValues([["Email", "Role", "Section", "Rep Group"]]);
    sheet.getRange(1, 1, 1, 4).setFontWeight("bold");
    return sheet;
  }
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(function(x){ return x.toString().trim().toLowerCase(); });
  ["Role", "Section", "Rep Group"].forEach(function(h) {
    if (headers.indexOf(h.toLowerCase()) === -1) {
      var col = sheet.getLastColumn() + 1;
      sheet.getRange(1, col).setValue(h).setFontWeight("bold");
      headers.push(h.toLowerCase());
    }
  });
  return sheet;
}

/**
 * Reads the instrument → family mapping from the Config sheet ("Instrument" and
 * "Instrument Family" columns). Returns { instrumentLower: family }.
 * Families: Brass, Strings, Winds, Voice, Percussion, Woodwind (extensible).
 */
function getInstrumentFamilyMap_(ss) {
  var map = {};
  var sheet = ss.getSheetByName(CONFIG_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return map;
  var data = sheet.getDataRange().getValues();
  var headers = data[0].map(function(x){ return x.toString().trim().toLowerCase(); });
  var iIdx = headers.indexOf("instrument");
  var fIdx = headers.indexOf("instrument family");
  if (iIdx === -1 || fIdx === -1) return map;
  for (var r = 1; r < data.length; r++) {
    var inst = data[r][iIdx].toString().trim();
    var fam = data[r][fIdx].toString().trim();
    if (inst && fam) map[inst.toLowerCase()] = fam;
  }
  return map;
}

/**
 * Resolves the caller's access record once: role tier + scope.
 * Returns { role, level, email, name, groups, section, repGroup, allowedSections }.
 */
function getMemberDetailStatus_(ss, memberName) {
  ss = ss || getSpreadsheet_();
  var sheet = ss.getSheetByName(MEMBER_DETAILS_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return "";
  var dmap = headerIndexMap_(sheet);
  var msIdx = dmap["member status"];
  if (msIdx == null) return "";
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0].toString().trim() === memberName) return data[i][msIdx].toString().trim();
  }
  return "";
}

function getAccess_(ss, emailOverride) {
  ss = ss || getSpreadsheet_();
  // emailOverride lets non-interactive contexts (time-based triggers) resolve access
  // for a specific person. In a trigger there is NO active session, so
  // Session.getActiveUser().getEmail() returns "" — hence the fallbacks.
  var email = emailOverride || "";
  if (!email) { try { email = Session.getActiveUser().getEmail() || ""; } catch (e) {} }
  if (!email) { try { email = Session.getEffectiveUser().getEmail() || ""; } catch (e) {} }
  if (!email) return { role: "unknown", level: -1, email: "", name: "", groups: [], section: "", repGroup: "", allowedSections: [] };
  var emailLower = email.toLowerCase();
  var memberInfo = findMemberByEmail_(ss, emailLower);

  var adminSheet = ss.getSheetByName(ADMINS_SHEET);
  if (adminSheet && adminSheet.getLastRow() > 0 && adminSheet.getLastColumn() > 0) {
    var data = adminSheet.getDataRange().getValues();
    var headers = data[0].map(function(x){ return x.toString().trim().toLowerCase(); });
    var rIdx = headers.indexOf("role"), sIdx = headers.indexOf("section"), gIdx = headers.indexOf("rep group");
    // Email column by HEADER (fall back to column 1 for legacy sheets with no header)
    var eIdx = headers.indexOf("email");
    if (eIdx === -1) eIdx = 0;
    for (var i = 1; i < data.length; i++) {
      if (data[i][eIdx].toString().trim().toLowerCase() !== emailLower) continue;
      var roleRaw = (rIdx !== -1 ? data[i][rIdx].toString().trim() : "");
      var section = (sIdx !== -1 ? data[i][sIdx].toString().trim() : "");
      var repGroup = (gIdx !== -1 ? data[i][gIdx].toString().trim() : "");
      var role;
      var rl = roleRaw.toLowerCase().replace(/[^a-z]/g, "");
      if (rl === "" || rl === "admin") role = "admin";            // blank = full admin (legacy rows)
      else if (rl === "sectionadmin") role = "sectionAdmin";
      else if (rl === "elevated" || rl === "elevatedmember") role = "elevated";
      else role = "member";                                        // unrecognized → LOWEST tier, never admin
      // Scoped roles need their scope; without it they can't be safely applied
      if (role === "sectionAdmin" && !section) role = "member";
      if (role === "elevated" && (!section || !repGroup)) role = "member";

      // MEMBERSHIP STATUS vs ADMIN ROLE.
      // Full admins are system operators and SUPERSEDE their own membership state
      // (an emeritus/alumnus admin still administers, and it prevents lockout if an
      // admin is ever auto-removed). Section admins and elevated reps are MEMBER
      // roles with added responsibility, so their powers SUSPEND while their own
      // membership is inactive - they fall through to the member/removed branches
      // below and regain powers automatically on reactivation.
      var membershipInactive = !!(memberInfo && !memberInfo.active);
      if (membershipInactive && (role === "sectionAdmin" || role === "elevated")) break;

      return {
        role: role, level: ROLE_LEVELS[role],
        email: email, name: memberInfo ? memberInfo.name : email,
        groups: memberInfo ? memberInfo.groups : [],
        section: (role === "admin") ? "" : section,
        repGroup: (role === "elevated") ? repGroup : "",
        allowedSections: (role === "admin") ? GROUPS.slice() : [section],
        // Surfaced so the UI can show a banner when an admin is signed in while
        // their own membership is paused/inactive.
        membershipInactive: membershipInactive,
        detailStatus: membershipInactive ? getMemberDetailStatus_(ss, memberInfo.name) : ""
      };
    }
  }

  if (memberInfo && memberInfo.active) {
    return { role: "member", level: 0, email: email, name: memberInfo.name,
             groups: memberInfo.groups, section: "", repGroup: "", allowedSections: [] };
  }
  // Known member whose membership is inactive. WHY they're inactive decides which
  // screen they see and how they return:
  //   "removed"         — Left via 3-AU removal → rejoin (fresh probation)
  //   "failedProbation" — failed probation → its own screen, same rejoin path
  //   "hiatus"          — planned break (On Hiatus) → welcome-back reactivation, no probation
  if (memberInfo) {
    var detail = getMemberDetailStatus_(ss, memberInfo.name);
    var subrole = "removed";
    if (detail === "On Hiatus") subrole = "hiatus";
    else if (memberInfo.probationFailed) subrole = "failedProbation";
    return { role: "removed", subrole: subrole, detailStatus: detail, level: 0,
             email: email, name: memberInfo.name,
             groups: memberInfo.groups, section: "", repGroup: "", allowedSections: [] };
  }
  return { role: "unknown", level: -1, email: email, name: "", groups: [], section: "", repGroup: "", allowedSections: [] };
}

/** Throws unless the caller has at least section-scoped admin power over `section`. */
function requireSectionPower_(section) {
  var a = getAccess_();
  if (a.level >= ROLE_LEVELS.admin) return a;
  if (a.level >= ROLE_LEVELS.elevated && section && a.section === section) return a;
  if (a.level >= ROLE_LEVELS.elevated && !section) return a; // unscoped call by scoped role — caller must filter
  throw new Error("You don't have permission for this action" + (section ? " in " + section : "") + ".");
}

/** Throws unless the caller is a full admin. */
function requireFullAdmin_() {
  var a = getAccess_();
  if (a.level >= ROLE_LEVELS.admin) return a;
  throw new Error("This action requires full admin access.");
}

/** Throws unless caller is admin or sectionAdmin (of the given section if provided). */
function requireManagement_(section) {
  var a = getAccess_();
  if (a.level >= ROLE_LEVELS.admin) return a;
  if (a.role === "sectionAdmin" && (!section || a.section === section)) return a;
  throw new Error("This action requires admin or section-admin access.");
}

/**
 * Returns a member-filter predicate for the caller's scope.
 * admin → everyone; sectionAdmin → members of their section;
 * elevated → members of their section whose role falls in their rep-group
 * (Choir: choir part === repGroup; Band/Orchestra: instrument's family === repGroup).
 */
function scopeMemberPredicate_(access, ss) {
  if (access.level >= ROLE_LEVELS.admin) return function(){ return true; };
  var section = access.section;
  if (access.role === "sectionAdmin") {
    return function(m){ return (m.groups || []).indexOf(section) !== -1; };
  }
  if (access.role === "elevated") {
    var famMap = getInstrumentFamilyMap_(ss || getSpreadsheet_());
    var rep = access.repGroup;
    return function(m) {
      if ((m.groups || []).indexOf(section) === -1) return false;
      var role = (m.roles && m.roles[section]) ? m.roles[section].toString().trim() : "";
      if (!role) return false;
      if (section === "Choir") return role.toLowerCase() === rep.toLowerCase();
      // A member's Band/Orchestra role is normally ALREADY a family. The old
      // famMap-only lookup returned "" in that case, so a Strings rep matched
      // nobody. normalizeToFamily_ handles family, instrument and legacy values.
      var fam = normalizeToFamily_(role, famMap);
      return !!fam && fam.toLowerCase() === rep.toLowerCase();
    };
  }
  return function(){ return false; };
}

/** Diagnostic — lists Band/Orchestra instruments with no family mapping. Run in editor. */

/**
 * DIAGNOSTIC — lists this project's triggers so you can see exactly which
 * handler runs on a schedule. Time-based triggers run the latest SAVED code,
 * not a deployed version, so this is the real answer to "what will fire?".
 * Only "dailyTasks_" runs the consecutive-AU sweep; "dailyBirthdayReminder_"
 * does birthdays only.
 */
function listProjectTriggers() {
  var trigs = ScriptApp.getProjectTriggers();
  if (!trigs.length) { Logger.log("No triggers installed."); return []; }
  var out = trigs.map(function (t) {
    var info = { handler: t.getHandlerFunction(), source: t.getEventType().toString() };
    info.runsAuSweep = (info.handler === "dailyTasks_");
    return info;
  });
  Logger.log(JSON.stringify(out, null, 2));
  out.forEach(function (o) {
    Logger.log(o.handler + (o.runsAuSweep ? "  <-- RUNS THE AU SWEEP (removals possible)" : "  (no AU sweep)"));
  });
  return out;
}

/** Removes all scheduled triggers — use if you want to pause automation entirely. */
function deleteAllTriggers() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); n++; });
  Logger.log("Deleted " + n + " trigger(s).");
  return n;
}

/**
 * DIAGNOSTIC — run from the editor (or call from the client) to see exactly what
 * the backend resolves for the current user. Use this to tell apart a backend
 * role problem from a UI gating problem.
 */
function whoAmI() {
  var a = getAccess_(getSpreadsheet_());
  var out = {
    email: a.email, resolvedRole: a.role, level: a.level,
    section: a.section, repGroup: a.repGroup,
    allowedSections: a.allowedSections,
    isAdminLike: a.level >= ROLE_LEVELS.elevated,
    whatClientGets: getUserRole()
  };
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}

/** DIAGNOSTIC — dumps the Admins sheet as the backend parses it. */
function debugAdminsSheet() {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(ADMINS_SHEET);
  if (!sheet) { Logger.log("No Admins sheet."); return; }
  var data = sheet.getDataRange().getValues();
  var headers = data[0].map(function(x){ return x.toString().trim(); });
  Logger.log("Headers: " + JSON.stringify(headers));
  var h = headers.map(function(x){ return x.toLowerCase(); });
  Logger.log("Resolved column indexes -> email:" + h.indexOf("email") +
             " role:" + h.indexOf("role") + " section:" + h.indexOf("section") +
             " rep group:" + h.indexOf("rep group"));
  for (var i = 1; i < data.length; i++) Logger.log("Row " + (i+1) + ": " + JSON.stringify(data[i]));
  return { headers: headers, rows: data.length - 1 };
}

function getUserRole() {
  var ss = getSpreadsheet_();
  var a = getAccess_(ss);
  if (a.role === "unknown" && a.email) {
    return { role: "unknown", email: a.email, name: "", groups: [], adminContact: ADMIN_CONTACT_EMAIL };
  }
  // Backward compatible: role "admin" | "member" as before, PLUS the new tiers
  // "sectionAdmin" | "elevated" and scope fields the client can use to gate UI.
  var out = {
    role: a.role, email: a.email, name: a.name, groups: a.groups,
    section: a.section, repGroup: a.repGroup, allowedSections: a.allowedSections,
    isAdminLike: a.level >= ROLE_LEVELS.elevated
  };
  // Admin signed in while their OWN membership is inactive/on hiatus -> banner.
  if (a.membershipInactive) {
    out.membershipInactive = true;
    out.detailStatus = a.detailStatus || "";
  }
  // Removed members need to know whether a rejoin request is already pending,
  // so the UI can show "awaiting review" instead of the submit form.
  if (a.role === "removed") {
    out.subrole = a.subrole || "removed";      // "removed" | "failedProbation" | "hiatus"
    out.detailStatus = a.detailStatus || "";
    out.adminContact = ADMIN_CONTACT_EMAIL;    // hiatus screen shows this; used for the Gmail link
    out.rejoinPending = false;
    try {
      var sh = ss.getSheetByName(APOLOGIES_SHEET);
      if (sh && sh.getLastRow() > 1) {
        var rows = sh.getDataRange().getValues();
        for (var i = 1; i < rows.length; i++) {
          if (rows[i][1].toString().trim() === a.name &&
              rows[i][3].toString() === "Rejoin Request" &&
              rows[i][8].toString() === "Pending") { out.rejoinPending = true; break; }
        }
      }
    } catch(e) {}
  }
  return out;
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
    history: history
    // score / rank / totalMembers removed: members no longer see points or rankings.
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
  // Scope: sectionAdmin/elevated only see (and record) members within their scope
  var access = getAccess_(ss);
  if (access.level < ROLE_LEVELS.elevated) throw new Error("Admin access required.");
  var inScope = scopeMemberPredicate_(access, ss);
  if (access.level < ROLE_LEVELS.admin) {
    selectedGroups = selectedGroups.filter(function(g){ return access.allowedSections.indexOf(g) !== -1; });
  }
  for (var i = 0; i < all.length; i++) {
    var m = all[i]; if (!m.active) continue;
    if (!inScope(m)) continue;
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
  var ss = getSpreadsheet_();
  // Scope: recording requires elevated+; scoped roles may only record their sections
  var access = getAccess_(ss);
  if (access.level < ROLE_LEVELS.elevated) throw new Error("Admin access required.");
  if (access.level < ROLE_LEVELS.admin) {
    var badGroup = (selectedGroups || []).filter(function(g){ return access.allowedSections.indexOf(g) === -1; });
    if (badGroup.length) throw new Error("You can only record attendance for " + access.allowedSections.join(", ") + ".");
  }
  var sheet = ss.getSheetByName(ATTENDANCE_SHEET);
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
  // Scope: editing history requires admin or sectionAdmin; sectionAdmin only their section's rows
  var access = requireManagement_();
  var user=Session.getActiveUser().getEmail()||"Unknown",now=new Date(),changed=0;
  for(var i=0;i<updates.length;i++){var row=updates[i].rowIndex;if(row<2||row>sheet.getLastRow())continue;
    if(access.level < ROLE_LEVELS.admin){
      var rowGroup = sheet.getRange(row,3).getValue().toString();
      if(access.allowedSections.indexOf(rowGroup) === -1) continue; // silently skip out-of-scope rows
    }
    sheet.getRange(row,5).setValue(updates[i].newStatus);sheet.getRange(row,6).setValue(user);sheet.getRange(row,7).setValue(now);changed++;}
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
  var ss=getSpreadsheet_(),all=readAllMembers_(ss);
  var access = getAccess_(ss);
  if (access.level < ROLE_LEVELS.elevated) throw new Error("Admin access required.");
  var inScope = scopeMemberPredicate_(access, ss);
  var prob=all.filter(function(m){return m.probation&&m.active&&m.probationStart&&inScope(m);});
  if(prob.length===0)return[];var att=readAllAttendance_(ss);
  return prob.map(function(m){var s=calculateProbationStats_(m,att);s.groups=m.groups.filter(function(g){return GROUPS.indexOf(g)!==-1;}).sort(function(a,b){return GROUPS.indexOf(a)-GROUPS.indexOf(b);});s.profilePhoto=driveAvatarDataUri_(m.profilePhotoRaw);return s;});
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
      sessionMap[key] = { date: rec.date, status: rec.status,
                          sessionKey: rec.session, groups: [rec.group] };
    } else {
      if (existing.groups.indexOf(rec.group) === -1) existing.groups.push(rec.group);
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
    sessionSequence.push({ date: sq.date, status: sq.status,
                           sessionKey: sq.sessionKey,
                           groups: (sq.groups || []).slice().sort(function (a, b) {
                             return GROUPS.indexOf(a) - GROUPS.indexOf(b);
                           }) });
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
    pendingSlots: pendingSlots,
    // null = the figures span EVERY section the member belongs to. If probation is
    // ever scoped to one section this carries that section's name, while `groups`
    // still lists the member's full membership.
    scopedSection: null
  };
}

/**
 * Auto-evaluates probation members after attendance is saved.
 * If a member has reached PROBATION_SESSIONS, sets Passed/Failed and updates sheet.
 * Returns array of evaluation results for the UI.
 */
/**
 * Ensures the Probation History sheet exists. This is an EVENT LOG: one row per
 * completed probation outcome. The Members sheet only holds CURRENT probation
 * state (flags get overwritten when someone restarts probation or rejoins), so
 * without this log the pass/fail trend is not reconstructable.
 */
function ensureProbationHistorySheet_(ss) {
  var sheet = ss.getSheetByName(PROBATION_HISTORY_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(PROBATION_HISTORY_SHEET);
    sheet.appendRow(["Name","Groups","Probation Start","Probation End","Outcome",
                     "Attended","Required","Total Sessions","Rate","Penalty","Logged At"]);
    sheet.getRange(1, 1, 1, 11).setFontWeight("bold");
    sheet.setFrozenRows(1);
    return sheet;
  }
  if (sheet.getLastRow() === 0 || sheet.getLastColumn() === 0) {
    sheet.getRange(1, 1, 1, 11).setValues([["Name","Groups","Probation Start","Probation End","Outcome",
                     "Attended","Required","Total Sessions","Rate","Penalty","Logged At"]]);
    sheet.getRange(1, 1, 1, 11).setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/**
 * Logs one completed probation outcome. Idempotent per RUN: a member can serve
 * probation more than once (rejoin/restart), so runs are keyed by name +
 * probation start date rather than name alone.
 * outcome: "passed_clean" | "passed_conditional" | "failed"
 */
function logProbationOutcome_(ss, member, stats, outcome, penalty) {
  var sheet = ensureProbationHistorySheet_(ss);
  var startStr = String(member.probationStart || "");
  // Dedupe on (name + start) so a re-evaluation cannot double-log the same run.
  if (sheet.getLastRow() > 1) {
    var existing = sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues();
    for (var i = 0; i < existing.length; i++) {
      if (existing[i][0].toString().trim() === member.name &&
          formatSheetDate_(existing[i][2]) === formatSheetDate_(startStr)) return false;
    }
  }
  var label = outcome === "passed_clean" ? "Passed"
            : (outcome === "passed_conditional" ? "Conditional" : "Failed");
  sheet.appendRow([
    member.name,
    (member.groups || []).join(", "),
    startStr,
    stats.lastSessionDate || "",
    label,
    stats.attended,
    stats.required,
    stats.totalSessions,
    stats.rate,
    penalty ? -Math.abs(penalty) : 0,
    new Date()
  ]);
  return true;
}

/**
 * Returns the probation event log (newest first). Data source for the v3
 * probation-performance panel; also useful to verify logging is working.
 */
function getProbationHistory() {
  requireManagement_();
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(PROBATION_HISTORY_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return [];
  var data = sheet.getDataRange().getValues();
  var h = data[0].map(function (x) { return x.toString().trim().toLowerCase(); });
  function col(n) { return h.indexOf(n); }
  var out = [];
  for (var i = 1; i < data.length; i++) {
    out.push({
      name: data[i][col("name")] ? data[i][col("name")].toString() : "",
      groups: data[i][col("groups")] ? data[i][col("groups")].toString().split(",").map(function(x){return x.trim();}).filter(Boolean) : [],
      start: formatSheetDate_(data[i][col("probation start")]),
      end: formatSheetDate_(data[i][col("probation end")]),
      outcome: data[i][col("outcome")] ? data[i][col("outcome")].toString() : "",
      attended: Number(data[i][col("attended")]) || 0,
      required: Number(data[i][col("required")]) || 0,
      totalSessions: Number(data[i][col("total sessions")]) || 0,
      rate: Number(data[i][col("rate")]) || 0
    });
  }
  out.sort(function (a, b) { return (b.end || "").localeCompare(a.end || ""); });
  return out;
}

/**
 * ONE-TIME — backfills the history log from members whose probation has already
 * concluded, so the pass/fail trend does not start empty. Recomputes stats from
 * attendance. Safe to re-run: logProbationOutcome_ dedupes on name + start date.
 * Run from the editor.
 */
function backfillProbationHistory() {
  var ss = getSpreadsheet_();
  var members = readAllMembers_(ss);
  var attData = readAllAttendance_(ss);
  var added = 0, skipped = 0;
  members.forEach(function (m) {
    if (!m.probationStart) return;
    if (!m.probationPassed && !m.probationFailed) return;  // still in progress
    var stats;
    try { stats = calculateProbationStats_(m, attData); } catch (e) { return; }
    var required = Math.ceil(PROBATION_SESSIONS * PROBATION_THRESHOLD);
    var minRequired = Math.ceil(PROBATION_SESSIONS * PROBATION_CONDITIONAL);
    var outcome = m.probationFailed ? "failed"
                : (stats.attended >= required ? "passed_clean" : "passed_conditional");
    var penalty = (outcome === "passed_conditional") ? (required - stats.attended) * PROBATION_PENALTY_MULTIPLIER : 0;
    if (logProbationOutcome_(ss, m, stats, outcome, penalty)) added++; else skipped++;
  });
  Logger.log("Probation history backfill — added " + added + ", already logged " + skipped + ".");
  return { added: added, skipped: skipped };
}

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
      try { setMembershipState_(ss, m.name, "Active", "Active", ""); } catch(e) {}
      sheet.getRange(row, probIdx + 1).setValue("Passed");
      sheet.getRange(row, probEndIdx + 1).setValue(stats.lastSessionDate);
      sheet.getRange(row, penaltyIdx + 1).setValue(0);
    } else if (stats.attended >= minRequired) {
      // Conditional pass: 50-79% — passed but with penalty
      outcome = "passed_conditional";
      try { setMembershipState_(ss, m.name, "Active", "Active", ""); } catch(e) {}
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
      try { setMembershipState_(ss, m.name, null, "Left", todayStr_()); } catch(e) {}
    }

    // Log the outcome as a permanent event BEFORE the flags move on — the Members
    // sheet only keeps current state, so this log is the only record of the run.
    try { logProbationOutcome_(ss, m, stats, outcome, penalty); } catch (e) { Logger.log("probation log: " + e); }

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
  // Members may no longer see points, rankings or the scoreboard - this is now
  // restricted to full admins and section admins.
  requireManagement_();
  return computeScoreboard_(group);
}

/** Internal, UNGUARDED scoreboard computation. Never expose this to the client. */
function computeScoreboard_(group) {
  var ss = getSpreadsheet_();
  var allMembers = readAllMembers_(ss);
  var attData = readAllAttendance_(ss);
  var rewards = readRewards_(ss);
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

    // Reward points - shown as their own column and included in the total.
    var memberRewards = rewards.filter(function (r) { return r.name === m.name; });
    var rewardPts = 0;
    for (var ri = 0; ri < memberRewards.length; ri++) rewardPts += (memberRewards[ri].points || 0);

    // Probation penalty (for conditional pass members)
    var probPenalty = m.probationPenalty || 0;

    var totalPoints = attPoints + consecPenalty + offensePts + probPenalty + rewardPts;

    results.push({
      name: m.name,
      groups: mgs,
      totalPoints: totalPoints,
      attPoints: attPoints,
      consecPenalty: consecPenalty,
      offenseCount: memberOffenses.length,
      offensePts: offensePts,
      rewardCount: memberRewards.length,
      rewardPts: rewardPts,
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
function addOffense(dateStr, memberName, description, points, isAutomatic) {
  var ss = getSpreadsheet_();
  // MANUAL offenses are management-only. AUTOMATIC ones (the 3-AU sweep) must not
  // be guarded: they fire from triggers with no session, and from saveAttendance
  // run by elevated reps who are not management - guarding here would break
  // attendance recording for them.
  if (!isAutomatic) requireManagement_();
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
  // The disciplinary log is management-only, same as the scoreboard, and section
  // admins see only their own section's members.
  var ss = getSpreadsheet_();
  var access = requireManagement_();
  var offenses = readOffenses_(ss);
  if (access.level < ROLE_LEVELS.admin) {
    var inScope = scopeMemberPredicate_(access, ss);
    var byName = {};
    readAllMembers_(ss).forEach(function (m) { byName[m.name] = m; });
    offenses = offenses.filter(function (o) { return byName[o.name] && inScope(byName[o.name]); });
  }
  return offenses;
}

// =======================================================
//  REWARDS — the positive counterpart to Offenses.
//  Categories live in the Config sheet ("Reward Category" | "Reward Points"):
//  a number fixes that category's value; a blank means VARIABLE, so the admin
//  sets the points when awarding. Reward points are surfaced separately AND
//  included in the scoreboard total.
// =======================================================
var REWARDS_SHEET = "Rewards";
var REWARD_DEFAULT_POINTS = 1;
var AUTO_REWARD_TAG = "[auto:perfect]";
var REWARD_PERFECT_POINTS = 2;      // points for a perfect-attendance month
var REWARD_PERFECT_MIN_SESSIONS = 3; // a 1-session month should not earn it

/** Ensures the Rewards sheet exists with its header row. Header-based throughout. */
function ensureRewardsSheet_(ss) {
  var headers = ["Date", "Name", "Category", "Description", "Points", "Recorded By", "Timestamp"];
  var sheet = ss.getSheetByName(REWARDS_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(REWARDS_SHEET);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");
    sheet.setFrozenRows(1);
    return sheet;
  }
  if (sheet.getLastRow() === 0 || sheet.getLastColumn() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/** Reads all rewards. Points default to REWARD_DEFAULT_POINTS when blank. */
function readRewards_(ss) {
  var sheet = ss.getSheetByName(REWARDS_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return [];
  var data = sheet.getDataRange().getValues();
  var h = data[0].map(function (x) { return x.toString().trim().toLowerCase(); });
  function col(n) { return h.indexOf(n); }
  var out = [];
  for (var i = 1; i < data.length; i++) {
    var name = col("name") !== -1 ? data[i][col("name")].toString().trim() : "";
    if (!name) continue;
    var raw = col("points") !== -1 ? data[i][col("points")] : "";
    var pts = (raw === "" || raw === null || isNaN(Number(raw))) ? REWARD_DEFAULT_POINTS : Number(raw);
    out.push({
      rowIndex: i + 1,
      date: formatSheetDate_(data[i][col("date")]),
      name: name,
      category: col("category") !== -1 ? data[i][col("category")].toString() : "",
      description: col("description") !== -1 ? data[i][col("description")].toString() : "",
      points: pts,
      recordedBy: col("recorded by") !== -1 ? data[i][col("recorded by")].toString() : ""
    });
  }
  return out;
}

/**
 * Reward categories from the Config sheet.
 * "Reward Points" holds a number for a FIXED category, or is blank for a VARIABLE
 * one where the admin supplies the value at award time.
 * @returns {Array} [{ category, points, variable }]
 */
function getRewardCategories() {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(CONFIG_SHEET);
  var out = [];
  if (!sheet || sheet.getLastRow() < 2) return out;
  var data = sheet.getDataRange().getValues();
  var h = data[0].map(function (x) { return x.toString().trim().toLowerCase(); });
  var ci = h.indexOf("reward category"), pi = h.indexOf("reward points");
  if (ci === -1) return out;
  for (var i = 1; i < data.length; i++) {
    var cat = data[i][ci] ? data[i][ci].toString().trim() : "";
    if (!cat) continue;
    var raw = (pi !== -1 && data[i][pi] !== "" && data[i][pi] !== null) ? Number(data[i][pi]) : null;
    var variable = (raw === null || isNaN(raw));
    out.push({ category: cat, points: variable ? null : raw, variable: variable });
  }
  return out;
}

/**
 * Awards a reward. Points resolution order:
 *   1. a FIXED category's configured value always wins
 *   2. otherwise the value the admin supplied
 *   3. otherwise REWARD_DEFAULT_POINTS
 * Section admins may only award members within their own scope.
 */
function addReward(dateStr, memberName, category, description, points) {
  var ss = getSpreadsheet_();
  var access = requireManagement_();
  if (!memberName) throw new Error("A member is required.");

  if (access.level < ROLE_LEVELS.admin) {
    var inScope = scopeMemberPredicate_(access, ss);
    var target = null;
    readAllMembers_(ss).forEach(function (m) { if (m.name === memberName) target = m; });
    if (!target || !inScope(target)) throw new Error("You can only award members in your section.");
  }

  var resolved = (points === undefined || points === null || points === "" || isNaN(Number(points)))
    ? null : Number(points);
  getRewardCategories().forEach(function (c) {
    if (c.category.toLowerCase() === String(category || "").toLowerCase() && !c.variable) {
      resolved = c.points; // a fixed category is not overridable
    }
  });
  if (resolved === null) resolved = REWARD_DEFAULT_POINTS;

  var sheet = ensureRewardsSheet_(ss);
  var user = Session.getActiveUser().getEmail() || "Unknown";
  sheet.appendRow([dateStr || todayStr_(), memberName, category || "", description || "",
                   resolved, user, new Date()]);
  return { success: true, name: memberName, points: resolved };
}

/** Removes a reward by its sheet row (admins, or the section admin who owns the member). */
function deleteReward(rowIndex) {
  requireManagement_();
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(REWARDS_SHEET);
  if (!sheet) throw new Error("No rewards recorded.");
  if (rowIndex < 2 || rowIndex > sheet.getLastRow()) throw new Error("Reward not found.");
  sheet.deleteRow(rowIndex);
  return { success: true };
}

/** Rewards for display, newest first. Scoped for section admins and reps. */
function getRewardList() {
  var ss = getSpreadsheet_();
  var access = getAccess_(ss);
  if (access.level < ROLE_LEVELS.elevated) throw new Error("Admin access required.");
  var rewards = readRewards_(ss);
  if (access.level < ROLE_LEVELS.admin) {
    var inScope = scopeMemberPredicate_(access, ss);
    var byName = {};
    readAllMembers_(ss).forEach(function (m) { byName[m.name] = m; });
    rewards = rewards.filter(function (r) { return byName[r.name] && inScope(byName[r.name]); });
  }
  rewards.sort(function (a, b) { return (b.date || "").localeCompare(a.date || ""); });
  return rewards;
}

/**
 * AUTOMATIC — awards a perfect-attendance reward for any completed calendar month
 * in which every one of a member's records was "Present" (lateness disqualifies)
 * and they had at least REWARD_PERFECT_MIN_SESSIONS sessions.
 * Idempotent: keyed by member + month via the AUTO_REWARD_TAG, so re-running is safe.
 * The CURRENT month is skipped - it is not finished yet.
 */
function syncAutomaticRewards_(ss) {
  ss = ss || getSpreadsheet_();
  var attSheet = ss.getSheetByName(ATTENDANCE_SHEET);
  if (!attSheet || attSheet.getLastRow() < 2) return { added: 0 };

  var thisMonth = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM");
  var byMemberMonth = {};
  var data = attSheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    var ds = formatSheetDate_(data[i][0]);
    if (!ds) continue;
    var month = ds.substring(0, 7);
    if (month >= thisMonth) continue; // only completed months
    var name = data[i][1].toString().trim();
    var key = name + "|" + month;
    if (!byMemberMonth[key]) byMemberMonth[key] = { name: name, month: month, dates: {} };
    var slot = byMemberMonth[key].dates;
    slot[ds] = bestStatus_(slot[ds], data[i][4].toString());
  }

  // existing auto rewards, keyed by name + month
  var existing = {};
  readRewards_(ss).forEach(function (r) {
    if (r.description && r.description.indexOf(AUTO_REWARD_TAG) !== -1) {
      existing[r.name + "|" + (r.date || "").substring(0, 7)] = true;
    }
  });

  var added = 0;
  for (var k in byMemberMonth) {
    var rec = byMemberMonth[k];
    var dates = Object.keys(rec.dates).sort();
    if (dates.length < REWARD_PERFECT_MIN_SESSIONS) continue;
    var perfect = true;
    for (var d = 0; d < dates.length; d++) {
      if (rec.dates[dates[d]] !== "Present") { perfect = false; break; }
    }
    if (!perfect) continue;
    var awardDate = dates[dates.length - 1];
    if (existing[rec.name + "|" + rec.month]) continue;
    var sheet = ensureRewardsSheet_(ss);
    sheet.appendRow([awardDate, rec.name, "Perfect attendance",
                     "Present at all " + dates.length + " sessions in " + rec.month + " " + AUTO_REWARD_TAG,
                     REWARD_PERFECT_POINTS, "System", new Date()]);
    existing[rec.name + "|" + rec.month] = true;
    added++;
  }
  return { added: added };
}

/** PUBLIC — run the automatic reward sweep on demand. Also runs in dailyTasks_. */
function runRewardSweep() {
  var r = syncAutomaticRewards_(getSpreadsheet_());
  var msg = "Automatic rewards added: " + r.added;
  Logger.log(msg);
  return { success: true, added: r.added, message: msg };
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

  // Only ACTIVE members are eligible for removal; look up records once.
  var memberByName = {};
  readAllMembers_(ss).forEach(function(m){ memberByName[m.name] = m; });

  var added = 0, removed = 0;
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
            addOffense(setKey, name, "3 consecutive unexcused absences " + CONSEC_AU_OFFENSE_TAG,
                       CONSECUTIVE_ABSENCE_PENALTY, true /* automatic */);
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

    // (B) REMOVAL — based ONLY on the member's CURRENT standing: are their most
    // recent sessions an unbroken run of 3+ unexcused absences? A member who had
    // a 3-AU set months ago but has attended since is NOT removed (they already
    // recovered) — though the historical offense above still stands on their record.
    var trailing = 0;
    for (var t = dates.length - 1; t >= 0; t--) {
      if (byMember[name][dates[t]] === "Absent Unexcused") trailing++;
      else break;
    }
    if (AU_REMOVAL_ENABLED && trailing >= CONSECUTIVE_ABSENCE_COUNT) {
      var mem = memberByName[name];
      if (mem && mem.active) {
        try {
          setMembershipState_(ss, name, "Inactive", "Left", dates[dates.length - 1]);
          sendRemovalNotice_(ss, mem);
          removed++;
        } catch (e) { Logger.log("removal failed for " + name + ": " + e); }
      }
    }
  }
  return { added: added, removed: removed };
}

/** Public wrapper — admins can run a manual sweep; also called by the daily trigger. */

/**
 * DRY RUN — reports who WOULD be removed/offended by the 3-AU rule, without
 * writing anything. Run this from the editor BEFORE deploying the removal
 * behaviour so a retroactive sweep doesn't surprise you.
 */
function previewConsecutiveAuRemovals() {
  var ss = getSpreadsheet_();
  var attSheet = ss.getSheetByName(ATTENDANCE_SHEET);
  if (!attSheet) return { sets: [], wouldRemove: [] };
  var data = attSheet.getDataRange().getValues();

  var byMember = {};
  for (var i = 1; i < data.length; i++) {
    var ds = formatSheetDate_(data[i][0]);
    var n = data[i][1].toString();
    var st = data[i][4].toString();
    if (!byMember[n]) byMember[n] = {};
    byMember[n][ds] = bestStatus_(byMember[n][ds], st);
  }

  var existing = readOffenses_(ss), existingKeys = {};
  existing.forEach(function (o) {
    if (o.description && o.description.indexOf(CONSEC_AU_OFFENSE_TAG) !== -1) {
      if (!existingKeys[o.name]) existingKeys[o.name] = {};
      existingKeys[o.name][o.date] = true;
    }
  });

  var memberByName = {};
  readAllMembers_(ss).forEach(function (m) { memberByName[m.name] = m; });

  var sets = [], wouldRemove = [];
  for (var name in byMember) {
    var dates = Object.keys(byMember[name]).sort(), run = 0;
    // (A) historical sets -> offenses
    for (var d = 0; d < dates.length; d++) {
      if (byMember[name][dates[d]] === "Absent Unexcused") {
        run++;
        if (run >= CONSECUTIVE_ABSENCE_COUNT) {
          var key = dates[d];
          var already = existingKeys[name] && existingKeys[name][key];
          sets.push({ name: name, thirdAuDate: key, alreadyLogged: !!already });
          run = 0;
        }
      } else { run = 0; }
    }
    // (B) CURRENT trailing streak -> removal
    var trailing = 0;
    for (var t = dates.length - 1; t >= 0; t--) {
      if (byMember[name][dates[t]] === "Absent Unexcused") trailing++;
      else break;
    }
    var mem = memberByName[name];
    if (trailing >= CONSECUTIVE_ABSENCE_COUNT && mem && mem.active) {
      wouldRemove.push({ name: name, currentStreak: trailing, lastSession: dates[dates.length - 1] });
    }
  }
  var newSets = sets.filter(function (s) { return !s.alreadyLogged; }).length;
  Logger.log("Completed 3-AU sets in history: " + sets.length + " (" + newSets + " not yet logged as offenses)" +
             "\nWould REMOVE " + wouldRemove.length + " active member(s) currently sitting at 3+ AU:\n" +
             (wouldRemove.map(function (w) { return w.name + " (streak " + w.currentStreak + ", last " + w.lastSession + ")"; }).join("\n") || "(none)"));
  return { sets: sets, newOffenses: newSets, wouldRemove: wouldRemove };
}

function runConsecutiveAuSweep() {
  var r = syncConsecutiveAuOffenses_(getSpreadsheet_());
  return { success: true, added: r.added, removed: r.removed };
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
  var access = getAccess_(ss);
  if (access.level < ROLE_LEVELS.elevated) throw new Error("Admin access required.");
  if (access.level < ROLE_LEVELS.admin) filters.section = access.section; // forced scope
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
    var status = data[i][8] ? data[i][8].toString() : "";
    if (status === "Rejected" || status === "Revoked" || status === "Not needed") continue;
    // Single-day: exact date match. Long-term (approved, real end date): session
    // date falls inside the range.
    var endDate = data[i][9] ? formatSheetDate_(data[i][9]) : "";
    var dateMatch = (rowDate === dateStr) ||
                    (endDate && status === "Approved" && dateStr >= rowDate && dateStr <= endDate);
    if (!dateMatch) continue;
    var ag = data[i][11] ? data[i][11].toString().split(",").map(function(x){return x.trim();}).filter(Boolean) : [];
    if (ag.length === 0) { count++; continue; } // legacy / general / long-term apology
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
// -------------------------------------------------------
//  DASHBOARD AGGREGATION HELPERS (v3)
// -------------------------------------------------------
function dashBucket_() { return { present: 0, late: 0, ae: 0, au: 0, total: 0, attended: 0 }; }
function dashBump_(b, st) {
  b.total++;
  if (st === "Present") { b.present++; b.attended++; }
  else if (st === "Late Excused" || st === "Late Unexcused") { b.late++; b.attended++; }
  else if (st === "Absent Excused") b.ae++;
  else if (st === "Absent Unexcused") b.au++;
}
function dashRate_(b) { return (b && b.total > 0) ? Math.round((b.attended / b.total) * 100) : 0; }

/** Equal-length window immediately before `range` (for period-over-period). */
function previousPeriod_(range) {
  var s = new Date(range.start + "T00:00:00"), e = new Date(range.end + "T00:00:00");
  var days = Math.max(1, Math.round((e - s) / 86400000) + 1);
  var prevEnd = new Date(s.getTime() - 86400000);
  var prevStart = new Date(prevEnd.getTime() - (days - 1) * 86400000);
  var tz = Session.getScriptTimeZone();
  return { start: Utilities.formatDate(prevStart, tz, "yyyy-MM-dd"),
           end: Utilities.formatDate(prevEnd, tz, "yyyy-MM-dd") };
}

/** Choir -> choir part; Band/Orchestra -> instrument FAMILY (raw instrument if unmapped). */

/** The canonical instrument families. Band/Orchestra ROLES are families, not instruments. */
var INSTRUMENT_FAMILIES = ["Strings", "Brass", "Winds", "Woodwind", "Percussion", "Vocals", "Voice"];

/**
 * Resolves ANY Band/Orchestra role value to its instrument family.
 * Handles three cases, because historic data is not uniform:
 *   1. the value is already a family ("Strings")            -> returned as-is
 *   2. the value is a mapped instrument ("Electric Guitar") -> mapped via Config
 *   3. the value is a legacy spelling ("Guitarist_Electric") -> matched by tokens
 * Returns "" when nothing matches, so callers can decide how to label it.
 */
function normalizeToFamily_(role, famMap) {
  var r = String(role || "").trim();
  if (!r) return "";
  var lower = r.toLowerCase();

  // 1. already a family
  for (var f = 0; f < INSTRUMENT_FAMILIES.length; f++) {
    if (INSTRUMENT_FAMILIES[f].toLowerCase() === lower) return INSTRUMENT_FAMILIES[f];
  }
  // 2. direct Config mapping
  if (famMap[lower]) return famMap[lower];

  // 3. legacy spellings: split multi-value roles, strip separators and agent suffixes,
  //    then look for any known instrument inside the remaining token.
  var firstPart = r.split(",")[0].trim().toLowerCase();
  if (famMap[firstPart]) return famMap[firstPart];
  var token = firstPart.replace(/[_\-]+/g, " ").trim();
  if (famMap[token]) return famMap[token];

  // Word-level stems so agent nouns and word order stop mattering:
  //   "guitarist electric" -> [electric, guitar]  ==  "electric guitar"
  //   "drummer"            -> [drumm]             ~=  "drums" -> [drum]
  function stems(str) {
    return str.split(/\s+/).filter(Boolean).map(function (w) {
      return w.replace(/(ists|ist|ers|er|players|player|s)$/, "");
    }).filter(Boolean).sort();
  }
  function stemsMatch(a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) {
      var x = a[i], y = b[i];
      if (x === y) continue;
      var longer = x.length >= y.length ? x : y, shorter = x.length >= y.length ? y : x;
      if (shorter.length >= 4 && longer.indexOf(shorter) === 0) continue; // drumm / drum
      return false;
    }
    return true;
  }
  var tokenStems = stems(token);
  for (var inst in famMap) {
    var base = inst.replace(/[_\-]+/g, " ");
    if (token.indexOf(base) !== -1 || base.indexOf(token) !== -1) return famMap[inst];
    if (stemsMatch(tokenStems, stems(base))) return famMap[inst];
  }
  return "";
}

/**
 * Role options for a section. Choir -> choir parts. Band/Orchestra -> instrument
 * FAMILIES (the role a member holds), with the specific instrument captured
 * separately at onboarding.
 */

/**
 * Propagates a member's ROLE change into historic Attendance rows for that section.
 * Roles are denormalised into Attendance at record time, so without this a
 * correction (e.g. a probation member finally assigned a voice part) leaves every
 * past row showing the old value - which is why such members kept showing as "Other".
 * Scoped to one section so a Choir correction never touches Band rows.
 */
function cascadeMemberRoleChange_(ss, memberName, section, newRole) {
  var sheet = ss.getSheetByName(ATTENDANCE_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return 0;
  var data = sheet.getDataRange().getValues();
  var changed = 0, firstRow = -1, lastRow = -1;
  for (var i = 1; i < data.length; i++) {
    if (data[i][1].toString().trim() !== memberName) continue;
    if (data[i][2].toString().trim() !== section) continue;
    if (data[i][3].toString().trim() === newRole) continue;
    data[i][3] = newRole;
    changed++;
    if (firstRow === -1) firstRow = i;
    lastRow = i;
  }
  if (changed > 0) {
    // Write back just the Role column across the affected span
    var height = lastRow - firstRow + 1;
    var col = [];
    for (var r = firstRow; r <= lastRow; r++) col.push([data[r][3]]);
    sheet.getRange(firstRow + 1, 4, height, 1).setValues(col);
  }
  return changed;
}

/**
 * Sets or clears a column's data-validation dropdown.
 * A "Reject input" rule makes Apps Script setValue THROW, and because writes flush
 * lazily the failure can surface after a success message has already been logged.
 * Rules written here use setAllowInvalid(true) ("show a warning"), so script writes
 * can never be hard-blocked by validation again.
 */
function setColumnValidation_(sheet, col1Based, allowedValues) {
  if (!sheet || sheet.getLastRow() < 2) return;
  var range = sheet.getRange(2, col1Based, sheet.getLastRow() - 1, 1);
  range.clearDataValidations();
  if (allowedValues && allowedValues.length) {
    range.setDataValidation(
      SpreadsheetApp.newDataValidation()
        .requireValueInList(allowedValues, true)
        .setAllowInvalid(true)
        .build());
  }
}

/**
 * Enforces the storage invariant for section roles:
 *   Choir            -> the choir part, stored as given
 *   Band / Orchestra -> the instrument FAMILY, never the specific instrument
 * Accepts whatever a form sends (family, instrument or legacy spelling) so no UI
 * can reintroduce instrument-level roles. The specific instrument is returned
 * separately so callers can keep it in Member Details.
 * Unresolvable values are passed through unchanged rather than guessed.
 */
function resolveRoleForStorage_(section, value, famMap) {
  var v = String(value || "").trim();
  if (!v) return { role: "", instrument: "" };
  if (section === "Choir") return { role: v, instrument: "" };
  famMap = famMap || getInstrumentFamilyMap_(getSpreadsheet_());
  var fam = normalizeToFamily_(v, famMap);
  if (!fam) return { role: v, instrument: "" };           // unmapped - leave alone
  var wasFamily = (fam.toLowerCase() === v.toLowerCase());
  return { role: fam, instrument: wasFamily ? "" : v };
}

/**
 * Repoints the data-validation dropdowns on Members "Band Role"/"Orchestra Role"
 * at the instrument FAMILIES. Those columns previously listed instruments, so a
 * "Reject input" rule made the family migration fail with a validation error.
 * Run this BEFORE migrateMemberRolesToFamilies(false).
 */
function setRoleColumnValidation() {
  requireFullAdmin_();
  var ss = getSpreadsheet_();
  var famMap = getInstrumentFamilyMap_(ss);
  var famSet = {};
  for (var k in famMap) famSet[famMap[k]] = true;
  var families = Object.keys(famSet).sort();
  if (!families.length) throw new Error("No instrument families found in Config.");

  var sheet = ss.getSheetByName(MEMBERS_SHEET);
  var map = headerIndexMap_(sheet);
  var lastRow = Math.max(sheet.getLastRow(), 2);
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(families, true).setAllowInvalid(true).build();
  var applied = [];
  ["band role", "orchestra role"].forEach(function (h) {
    var c = map[h];
    if (c == null) return;
    sheet.getRange(2, c + 1, lastRow - 1, 1).setDataValidation(rule);
    applied.push(h);
  });
  var msg = "Set family dropdown on: " + applied.join(", ") +
            "\nFamilies: " + families.join(", ") +
            "\nallowInvalid=true, so legacy values already in cells are kept (flagged, not rejected).";
  Logger.log(msg);
  return msg;
}

/** Removes data validation from the two role columns entirely (the app writes them). */
function clearRoleColumnValidation() {
  requireFullAdmin_();
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(MEMBERS_SHEET);
  var map = headerIndexMap_(sheet);
  var lastRow = Math.max(sheet.getLastRow(), 2);
  var cleared = [];
  ["band role", "orchestra role"].forEach(function (h) {
    var c = map[h];
    if (c == null) return;
    sheet.getRange(2, c + 1, lastRow - 1, 1).clearDataValidations();
    cleared.push(h);
  });
  Logger.log("Cleared validation on: " + cleared.join(", "));
  return "Cleared validation on: " + cleared.join(", ");
}

/**
 * DIAGNOSTIC - checks the Config sheet's two instrument structures agree.
 * They serve DIFFERENT purposes and both are needed:
 *   "Band Roles" / "Orchestra Roles" = the PICKER lists (which instruments a member
 *      of that section may choose - Band has Drums, Orchestra has Violin, etc.)
 *   "Instrument" / "Instrument Family" = the MAPPING (what family each belongs to)
 * Every picker value must appear in the mapping, or that member's role will not
 * resolve to a family. Writes nothing.
 */
function validateInstrumentConfig() {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(CONFIG_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return "No Config sheet.";
  var data = sheet.getDataRange().getValues();
  var h = data[0].map(function (x) { return x.toString().trim().toLowerCase(); });
  var bi = h.indexOf("band roles"), oi = h.indexOf("orchestra roles");
  var famMap = getInstrumentFamilyMap_(ss);

  function colValues(idx) {
    var out = [];
    if (idx === -1) return out;
    for (var i = 1; i < data.length; i++) {
      var v = data[i][idx] ? data[i][idx].toString().trim() : "";
      if (v) out.push(v);
    }
    return out;
  }
  var problems = [], notes = [];
  [["Band Roles", bi], ["Orchestra Roles", oi]].forEach(function (p) {
    colValues(p[1]).forEach(function (v) {
      if (!normalizeToFamily_(v, famMap)) problems.push(p[0] + ' value "' + v + '" has no instrument family.');
    });
  });

  // duplicate instrument rows
  var seen = {}, dupes = [];
  var ii = h.indexOf("instrument");
  colValues(ii).forEach(function (v) {
    var k = v.toLowerCase();
    if (seen[k]) { if (dupes.indexOf(v) === -1) dupes.push(v); } else seen[k] = true;
  });
  if (dupes.length) notes.push("Duplicate rows in Instrument column: " + dupes.join(", ") + " (harmless, but tidy up).");

  var fams = {};
  for (var k in famMap) fams[famMap[k]] = (fams[famMap[k]] || 0) + 1;
  notes.push("Families in use: " + Object.keys(fams).sort().map(function (f) {
    return f + " (" + fams[f] + " instruments)";
  }).join(", "));

  var msg = "INSTRUMENT CONFIG CHECK\n\n" +
    (problems.length ? "PROBLEMS:\n  " + problems.join("\n  ") : "All picker values map to a family.") +
    "\n\n" + notes.join("\n");
  Logger.log(msg);
  return msg;
}

/**
 * DIAGNOSTIC - reports what is ACTUALLY stored in Members "Band Role"/"Orchestra Role"
 * right now: families, specific instruments, or legacy spellings. Writes nothing.
 * Run this before deciding on a migration.
 */
function auditMemberRoleValues() {
  var ss = getSpreadsheet_();
  var famMap = getInstrumentFamilyMap_(ss);
  var report = {};
  ["Band", "Orchestra"].forEach(function (sec) {
    report[sec] = { asFamily: 0, asInstrument: 0, unmapped: 0, values: {} };
  });
  readAllMembers_(ss).forEach(function (m) {
    ["Band", "Orchestra"].forEach(function (sec) {
      if ((m.groups || []).indexOf(sec) === -1) return;
      var role = (m.roles && m.roles[sec]) ? m.roles[sec].toString().trim() : "";
      if (!role) return;
      var r = report[sec];
      r.values[role] = (r.values[role] || 0) + 1;
      var isFamily = false;
      for (var f = 0; f < INSTRUMENT_FAMILIES.length; f++) {
        if (INSTRUMENT_FAMILIES[f].toLowerCase() === role.toLowerCase()) isFamily = true;
      }
      if (isFamily) r.asFamily++;
      else if (normalizeToFamily_(role, famMap)) r.asInstrument++;
      else r.unmapped++;
    });
  });
  var lines = ["WHAT THE MEMBERS SHEET ACTUALLY STORES FOR BAND/ORCHESTRA ROLE\n"];
  ["Band", "Orchestra"].forEach(function (sec) {
    var r = report[sec];
    lines.push(sec + ":  family=" + r.asFamily + "  instrument=" + r.asInstrument + "  unmapped=" + r.unmapped);
    Object.keys(r.values).sort().forEach(function (v) {
      var fam = normalizeToFamily_(v, famMap);
      lines.push("   " + v + " (" + r.values[v] + ")  ->  " + (fam || "UNMAPPED"));
    });
    lines.push("");
  });
  var msg = lines.join("\n");
  Logger.log(msg);
  return msg;
}

/**
 * Migrates Members "Band Role"/"Orchestra Role" to instrument FAMILIES, preserving
 * the specific instrument in Member Details first so nothing is lost.
 * Values that cannot be resolved to a family are LEFT ALONE.
 * @param {boolean} dryRun - true (default) reports only; pass false to write.
 */
function migrateMemberRolesToFamilies(dryRun) {
  requireFullAdmin_();
  if (dryRun !== false) dryRun = true;
  var ss = getSpreadsheet_();
  var famMap = getInstrumentFamilyMap_(ss);
  var mSheet = ss.getSheetByName(MEMBERS_SHEET);
  if (!mSheet || mSheet.getLastRow() < 2) return "No members.";
  var mmap = headerIndexMap_(mSheet);
  var data = mSheet.getDataRange().getValues();

  var dSheet = ss.getSheetByName(MEMBER_DETAILS_SHEET);
  var dmap = dSheet ? headerIndexMap_(dSheet) : null;
  var dData = dSheet ? dSheet.getDataRange().getValues() : null;
  var instCol = dmap ? dmap["band/orchestra instruments"] : null;

  var planned = [], skipped = [];
  [["Band", "band role"], ["Orchestra", "orchestra role"]].forEach(function (pair) {
    var sec = pair[0], header = pair[1];
    var c = mmap[header];
    if (c == null) return;
    for (var i = 1; i < data.length; i++) {
      var role = data[i][c] ? data[i][c].toString().trim() : "";
      if (!role) continue;
      var fam = normalizeToFamily_(role, famMap);
      if (!fam) { skipped.push(sec + ": " + role + " (no family)"); continue; }
      if (fam === role) continue;
      planned.push({ row: i + 1, col: c + 1, name: data[i][mmap["name"]].toString().trim(),
                     section: sec, from: role, to: fam });
    }
  });

  var failed = [];
  if (!dryRun) {
    // Drop the instrument dropdowns BEFORE writing - a reject-input rule would
    // otherwise throw on the first family value and abort the run.
    var famList = getRepGroupOptions("Band");
    ["band role", "orchestra role"].forEach(function (hdr) {
      if (mmap[hdr] != null) { try { setColumnValidation_(mSheet, mmap[hdr] + 1, null); } catch (e) {} }
    });
    SpreadsheetApp.flush();

    planned.forEach(function (p) {
      if (dSheet && instCol != null) {
        for (var r = 1; r < dData.length; r++) {
          if (dData[r][0].toString().trim() !== p.name) continue;
          var existing = dData[r][instCol] ? dData[r][instCol].toString().trim() : "";
          if (!existing) dSheet.getRange(r + 1, instCol + 1).setValue(p.from);
          else if (existing.toLowerCase().indexOf(p.from.toLowerCase()) === -1)
            dSheet.getRange(r + 1, instCol + 1).setValue(existing + ", " + p.from);
          break;
        }
      }
      // A "Reject input" data-validation rule on the role column makes setValue THROW.
      // Catch per row so one protected cell cannot abort the whole migration, and
      // flush immediately so the failure is attributed to the right row.
      try {
        mSheet.getRange(p.row, p.col).setValue(p.to);
        SpreadsheetApp.flush();
      } catch (e) {
        failed.push(p.name + " [" + p.section + "] row " + p.row + ": " + e.message);
      }
    });
    // Repoint the dropdowns at families (warn-only) now the values are in place.
    ["band role", "orchestra role"].forEach(function (hdr) {
      if (mmap[hdr] != null) { try { setColumnValidation_(mSheet, mmap[hdr] + 1, famList); } catch (e) {} }
    });
    SpreadsheetApp.flush();
  }

  var msg = (dryRun ? "DRY RUN - nothing written.\n\n" : "APPLIED.\n\n") +
    "Members role -> family (" + planned.length + "):\n" +
    (planned.length ? planned.map(function (p) {
      return "  " + p.name + " [" + p.section + "]  " + p.from + " -> " + p.to;
    }).join("\n") : "  (nothing to change)") +
    "\n\nLeft alone (" + skipped.length + "):\n" +
    (skipped.length ? "  " + skipped.join("\n  ") : "  (none)") +
    (!dryRun && failed.length
      ? "\n\nFAILED (" + failed.length + ") - almost always a data-validation rule on the\n" +
        "role column. Run setRoleColumnValidation() then re-run this migration:\n  " +
        failed.join("\n  ")
      : "") +
    (dryRun ? "\n\nRun applyMemberRoleMigration() to apply."
            : "\n\nRole dropdowns repointed to families (warn-only).");
  Logger.log(msg);
  return msg;
}

/** Editor wrapper - applies the member role migration (no args needed). */
function applyMemberRoleMigration() { return migrateMemberRolesToFamilies(false); }

/**
 * DRY RUN - reports how historic Attendance roles would be normalised to instrument
 * families for Band/Orchestra. Writes nothing. Run from the editor.
 */
function previewAttendanceRoleMigration() {
  var ss = getSpreadsheet_();
  var famMap = getInstrumentFamilyMap_(ss);
  var sheet = ss.getSheetByName(ATTENDANCE_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return "No attendance data.";
  var data = sheet.getDataRange().getValues();
  var wouldChange = {}, unmapped = {}, untouched = 0;
  for (var i = 1; i < data.length; i++) {
    var g = data[i][2].toString().trim();
    if (g !== "Band" && g !== "Orchestra") continue;
    var role = data[i][3].toString().trim();
    if (!role) continue;
    var fam = normalizeToFamily_(role, famMap);
    if (!fam) { unmapped[role] = (unmapped[role] || 0) + 1; continue; }
    if (fam === role) { untouched++; continue; }
    var k = role + "  ->  " + fam;
    wouldChange[k] = (wouldChange[k] || 0) + 1;
  }
  var msg = "ATTENDANCE ROLE MIGRATION - DRY RUN\n\nWould rewrite:\n" +
    (Object.keys(wouldChange).length
      ? Object.keys(wouldChange).sort().map(function (k) { return "  " + k + "   (" + wouldChange[k] + " rows)"; }).join("\n")
      : "  (nothing)") +
    "\n\nAlready a family: " + untouched + " rows" +
    "\n\nUNMAPPED - add these to the Config Instrument/Instrument Family columns first:\n" +
    (Object.keys(unmapped).length
      ? Object.keys(unmapped).sort().map(function (k) { return "  " + k + "   (" + unmapped[k] + " rows)"; }).join("\n")
      : "  (none)");
  Logger.log(msg);
  return msg;
}

/**
 * Rewrites historic Band/Orchestra Attendance roles to instrument families so old
 * records group with new ones. Values it cannot map are LEFT ALONE (never guessed).
 * Run previewAttendanceRoleMigration() first.
 */
function migrateAttendanceRolesToFamilies() {
  requireFullAdmin_();
  var ss = getSpreadsheet_();
  var famMap = getInstrumentFamilyMap_(ss);
  var sheet = ss.getSheetByName(ATTENDANCE_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return { changed: 0 };
  var data = sheet.getDataRange().getValues();
  var roleCol = [], changed = 0, skipped = 0;
  for (var i = 1; i < data.length; i++) {
    var g = data[i][2].toString().trim();
    var role = data[i][3].toString().trim();
    var out = role;
    if ((g === "Band" || g === "Orchestra") && role) {
      var fam = normalizeToFamily_(role, famMap);
      if (fam && fam !== role) { out = fam; changed++; }
      else if (!fam) skipped++;
    }
    roleCol.push([out]);
  }
  if (changed > 0) {
    // Same lesson as the members migration: a reject-input validation rule would
    // throw on this bulk write. Clear it first (Attendance roles are script-written,
    // so a dropdown there serves no purpose).
    try { setColumnValidation_(sheet, 4, null); SpreadsheetApp.flush(); } catch (e) {}
    sheet.getRange(2, 4, roleCol.length, 1).setValues(roleCol);
    SpreadsheetApp.flush();
  }
  var msg = "Migrated " + changed + " attendance role(s) to families. " +
            skipped + " left unmapped (add them to Config, then re-run).";
  Logger.log(msg);
  return { changed: changed, skipped: skipped, message: msg };
}

/** Lists every Band/Orchestra role value in use (members AND attendance) with no family. */
function listUnmappedInstruments() {
  var ss = getSpreadsheet_();
  var famMap = getInstrumentFamilyMap_(ss);
  var missing = {};
  readAllMembers_(ss).forEach(function (m) {
    ["Band", "Orchestra"].forEach(function (sec) {
      var role = (m.roles && m.roles[sec]) ? m.roles[sec].toString().trim() : "";
      if (role && !normalizeToFamily_(role, famMap)) missing[role] = "members sheet";
    });
  });
  var sheet = ss.getSheetByName(ATTENDANCE_SHEET);
  if (sheet && sheet.getLastRow() > 1) {
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      var g = data[i][2].toString().trim();
      if (g !== "Band" && g !== "Orchestra") continue;
      var r = data[i][3].toString().trim();
      if (r && !normalizeToFamily_(r, famMap)) missing[r] = missing[r] ? "both" : "attendance history";
    }
  }
  var list = Object.keys(missing).sort();
  Logger.log(list.length
    ? "Unmapped Band/Orchestra roles (add to Config Instrument/Instrument Family):\n" +
      list.map(function (k) { return "  " + k + "   [" + missing[k] + "]"; }).join("\n")
    : "All Band/Orchestra roles resolve to a family.");
  return list;
}

function getRepGroupOptions(section) {
  var ss = getSpreadsheet_();
  if (section === "Choir") {
    var opts = getConfigOptions();
    return (opts && opts.choirParts) ? opts.choirParts : [];
  }
  var famMap = getInstrumentFamilyMap_(ss);
  var fams = {};
  for (var k in famMap) fams[famMap[k]] = true;
  return Object.keys(fams).sort();
}

function partKeyFor_(section, role, famMap) {
  if (!role) return "Unassigned";
  if (section === "Choir") return role;
  // Band/Orchestra group by FAMILY. Legacy rows may hold an instrument or an old
  // spelling; normalise so a member does not appear as their own separate "part".
  return normalizeToFamily_(role, famMap) || role;
}

/**
 * GROUP DASHBOARD v3 — every panel derived from ONE pass over Attendance.
 * All v2 fields are preserved (additive change), so existing rendering keeps working.
 */

/**
 * DIAGNOSTIC — prints the SHAPE of the real dashboard payload (keys, types, array
 * lengths) with no values, so it can be shared with the design side to validate a
 * preview mock against the true contract. Values are deliberately omitted: the real
 * payload contains member names, and the shape is what a mock needs to match.
 * Run from the editor: dashboardContractReport("All", "month")
 */
function dashboardContractReport(section, rangeMode) {
  var d = getGroupDashboard({ section: section || "All", range: rangeMode || "month" });
  var out = "getGroupDashboard({section:\"" + (section || "All") + "\", range:\"" + (rangeMode || "month") + "\"}) =>\n" +
            describeShape_(d, 0);
  Logger.log(out);
  return out;
}

/** Recursively renders a value as a type map (no actual values). */
function describeShape_(val, indent) {
  var pad = new Array(indent + 1).join("  ");
  if (val === null || val === undefined) return String(val) + "   <-- absent/null";
  if (Object.prototype.toString.call(val) === "[object Array]") {
    if (!val.length) return "array (EMPTY - no data in this range)";
    var first = val[0];
    if (first && typeof first === "object") {
      return "array[" + val.length + "] of {\n" +
        Object.keys(first).map(function (k) {
          return pad + "    " + k + ": " + describeShape_(first[k], indent + 2);
        }).join("\n") + "\n" + pad + "  }";
    }
    return "array[" + val.length + "] of " + typeof first;
  }
  if (val instanceof Date) return "Date";
  if (typeof val === "object") {
    var keys = Object.keys(val);
    if (!keys.length) return "{} (empty object)";
    return "{\n" + keys.map(function (k) {
      return pad + "  " + k + ": " + describeShape_(val[k], indent + 1);
    }).join("\n") + "\n" + pad + "}";
  }
  return typeof val;
}

/**
 * DIAGNOSTIC — sanity-checks the v3 payload for the mistakes that actually bite:
 * missing keys, panels silently empty, and the null-vs-absent distinction.
 * Run from the editor after deploying a dashboard change.
 */
function validateDashboardPayload(section, rangeMode) {
  var d = getGroupDashboard({ section: section || "All", range: rangeMode || "month" });
  var required = ["section","range","sessionsCount","overallRate","absenteeismRate","auRate",
    "statusCounts","totalRecords","avgPerSession","momentum","apologyStats","trend","nearAU",
    "probationCount","probationFallingBehind","probationOnTrack",
    "partBreakdown","sectionComparison","distribution","weekdayStats","sessionTypeStats",
    "behaviour","topAttenders","minSessionsForTop","membershipHealth","probationPerformance"];
  var problems = [], empties = [];
  required.forEach(function (k) {
    if (!(k in d)) problems.push("MISSING key: " + k);
    else if (d[k] === null || d[k] === undefined) problems.push("NULL key: " + k);
  });
  if (!("comparison" in d)) problems.push("MISSING key: comparison (may be null, but must exist)");
  [["trend","no sessions in range"],["partBreakdown","no role data on attendance rows"],
   ["sectionComparison","no attendance at all"],["weekdayStats","no sessions"],
   ["topAttenders","nobody met the minimum-sessions floor"]].forEach(function (p) {
    var v = d[p[0]];
    if (v && v.length === 0) empties.push(p[0] + " is EMPTY - " + p[1]);
  });
  var msg = "Dashboard payload check (" + (section || "All") + " / " + (rangeMode || "month") + ")\n" +
    (problems.length ? "PROBLEMS:\n  " + problems.join("\n  ") : "All required keys present.") +
    (empties.length ? "\n\nEmpty panels (may be legitimate):\n  " + empties.join("\n  ") : "") +
    "\n\nQuick numbers: sessions=" + d.sessionsCount + " records=" + d.totalRecords +
    " rate=" + d.overallRate + "% parts=" + (d.partBreakdown || []).length +
    " comparison=" + (d.comparison ? "present" : "null (expected for custom/all ranges)");
  Logger.log(msg);
  return msg;
}

/**
 * DIAGNOSTIC — audits the dashboard NUMBERS for internal consistency.
 * Every panel is derived from the same records, so a set of arithmetic identities
 * must hold. If one fails, a panel is miscounting. Run from the editor:
 *   auditDashboardNumbers("All", "month")
 */

// =======================================================
//  EDITOR RUN WRAPPERS
//  The Apps Script editor's Run button calls the selected function with NO
//  arguments - there is no way to type parameters into the IDE. So every
//  diagnostic that takes arguments gets a zero-arg wrapper here. Pick one from
//  the dropdown and hit Run. (Functions ending in "_" are private and do not
//  appear in the dropdown at all, which is why these are all public.)
// =======================================================
function audit_All_Month()        { return auditDashboardNumbers("All", "month"); }
function audit_All_Week()         { return auditDashboardNumbers("All", "week"); }
function audit_Choir_Month()      { return auditDashboardNumbers("Choir", "month"); }
function audit_Choir_Week()       { return auditDashboardNumbers("Choir", "week"); }
function audit_Band_Month()       { return auditDashboardNumbers("Band", "month"); }
function audit_Orchestra_Month()  { return auditDashboardNumbers("Orchestra", "month"); }

function contract_All_Month()     { return dashboardContractReport("All", "month"); }
function contract_Choir_Month()   { return dashboardContractReport("Choir", "month"); }

function payload_All_Month()      { return validateDashboardPayload("All", "month"); }
function payload_Choir_Week()     { return validateDashboardPayload("Choir", "week"); }

/** Runs the whole audit sweep across sections and ranges in one go. */
function auditEverything() {
  var combos = [["All","month"],["All","week"],["Choir","month"],["Choir","week"],
                ["Band","month"],["Orchestra","month"]];
  var out = [];
  combos.forEach(function (c) {
    try { out.push(auditDashboardNumbers(c[0], c[1])); }
    catch (e) { out.push("ERROR " + c[0] + "/" + c[1] + ": " + e.message); }
  });
  var joined = out.join("\n\n" + new Array(70).join("=") + "\n\n");
  Logger.log(joined);
  return joined;
}

function auditDashboardNumbers(section, rangeMode) {
  section = section || "All"; rangeMode = rangeMode || "month";
  var d = getGroupDashboard({ section: section, range: rangeMode });
  var pass = [], fail = [], notes = [];
  function check(label, ok, detail) { (ok ? pass : fail).push(label + (detail ? "  [" + detail + "]" : "")); }
  function sum(arr, key) { return (arr || []).reduce(function (s, x) { return s + (x[key] || 0); }, 0); }

  var sc = d.statusCounts || {};
  var attended = (sc["Present"]||0) + (sc["Late Excused"]||0) + (sc["Late Unexcused"]||0);
  var absent = (sc["Absent Excused"]||0) + (sc["Absent Unexcused"]||0);

  // 1. Every record has exactly one status
  check("statusCounts sum = totalRecords", attended + absent === d.totalRecords,
        attended + absent + " vs " + d.totalRecords);

  // 2. Attended and absent partition all records, so the rates must complete each other
  check("overallRate + absenteeismRate = 100", Math.abs((d.overallRate + d.absenteeismRate) - 100) <= 1,
        d.overallRate + " + " + d.absenteeismRate);

  // 3. Unexcused absence is a subset of all absence
  check("auRate <= absenteeismRate", d.auRate <= d.absenteeismRate, d.auRate + " <= " + d.absenteeismRate);

  // 4. One trend point per session
  check("trend length = sessionsCount", (d.trend||[]).length === d.sessionsCount,
        (d.trend||[]).length + " vs " + d.sessionsCount);

  // 5. Each trend point internally balances, and they sum to the whole
  var badPoint = null;
  (d.trend||[]).forEach(function (t) {
    if (t.present + t.late + t.ae + t.au !== t.total) badPoint = badPoint || (t.date + " parts!=total");
    if (t.attended !== t.present + t.late) badPoint = badPoint || (t.date + " attended!=present+late");
  });
  check("every trend point balances", !badPoint, badPoint || "");
  check("sum(trend.total) = totalRecords", sum(d.trend, "total") === d.totalRecords,
        sum(d.trend, "total") + " vs " + d.totalRecords);

  // 6. Averages are consistent with the totals they came from
  var tol = Math.max(1, d.sessionsCount * 0.1);
  check("avgPerSession.attended x sessions = attended",
        Math.abs(((d.avgPerSession||{}).attended || 0) * d.sessionsCount - attended) <= tol,
        ((d.avgPerSession||{}).attended||0) + " x " + d.sessionsCount + " vs " + attended);

  // 7. Each record lands in exactly one part bucket
  check("sum(partBreakdown.total) = totalRecords", sum(d.partBreakdown, "total") === d.totalRecords,
        sum(d.partBreakdown, "total") + " vs " + d.totalRecords);

  // 8. Section comparison covers ALL sections, so it only ties out on the All view
  if (section === "All") {
    check("sum(sectionComparison.total) = totalRecords", sum(d.sectionComparison, "total") === d.totalRecords,
          sum(d.sectionComparison, "total") + " vs " + d.totalRecords);
  } else {
    notes.push("sectionComparison intentionally covers all sections, so it exceeds this section's totals.");
  }

  // 9. Weekday and session-type splits each re-partition the same records
  check("sum(weekdayStats.total) = totalRecords", sum(d.weekdayStats, "total") === d.totalRecords,
        sum(d.weekdayStats, "total") + " vs " + d.totalRecords);
  check("sum(sessionTypeStats.total) = totalRecords", sum(d.sessionTypeStats, "total") === d.totalRecords,
        sum(d.sessionTypeStats, "total") + " vs " + d.totalRecords);

  // 10. Distribution and behaviour both classify every distinct member exactly once
  var dist = d.distribution || { buckets: [] };
  var bucketSum = sum(dist.buckets, "count");
  check("distribution buckets = memberCount", bucketSum === dist.memberCount,
        bucketSum + " vs " + dist.memberCount);
  var b = d.behaviour || {};
  var behaviourSum = (b.chronicLateCount||0) + (b.chronicAbsentCount||0) + (b.mixed||0) + (b.occasional||0) + (b.spotless||0);
  check("behaviour categories = memberCount", behaviourSum === dist.memberCount,
        behaviourSum + " vs " + dist.memberCount);

  // 11. Top attenders respect the floor and are ordered
  var topOk = true, prev = 101;
  (d.topAttenders||[]).forEach(function (t) {
    if (t.total < d.minSessionsForTop) topOk = false;
    if (t.rate > prev) topOk = false;
    prev = t.rate;
  });
  check("topAttenders respect floor & ordering", topOk, "floor=" + d.minSessionsForTop);

  // 12. Apology compliance is the excused share of absences
  var expectedCompliance = absent > 0 ? Math.round(((sc["Absent Excused"]||0) / absent) * 100) : 0;
  check("apology complianceRate = AE/(AE+AU)", (d.apologyStats||{}).complianceRate === expectedCompliance,
        (d.apologyStats||{}).complianceRate + " vs " + expectedCompliance);

  // 13. Period-over-period delta matches its own inputs
  if (d.comparison) {
    check("comparison.rateDelta = overall - previous",
          d.comparison.rateDelta === d.overallRate - d.comparison.previousRate,
          d.comparison.rateDelta + " vs " + (d.overallRate - d.comparison.previousRate));
  } else {
    notes.push("comparison is null - expected only for 'custom' and 'all' ranges (this run: " + rangeMode + ").");
  }

  // 14. Probation outcomes partition
  var pp = (d.probationPerformance||{}).inRange || {};
  check("probation total = passed+conditional+failed",
        (pp.passed||0) + (pp.conditional||0) + (pp.failed||0) === (pp.total||0),
        (pp.passed||0) + "+" + (pp.conditional||0) + "+" + (pp.failed||0) + " vs " + (pp.total||0));

  // --- Red flags that are not arithmetic errors but usually mean bad input data ---
  var flags = [];
  var unassigned = (d.partBreakdown||[]).filter(function (p) { return p.part === "Unassigned"; });
  if (unassigned.length && sum(unassigned, "total") > d.totalRecords * 0.2)
    flags.push("Over 20% of records have no role -> the Role column on Attendance is often blank.");
  var rawInstruments = (d.partBreakdown||[]).filter(function (p) {
    return p.section !== "Choir" && ["Brass","Strings","Winds","Voice","Percussion","Woodwind"].indexOf(p.part) === -1 && p.part !== "Unassigned";
  });
  if (rawInstruments.length)
    flags.push("Unmapped instruments in partBreakdown (" + rawInstruments.map(function(p){return p.part;}).join(", ") +
               ") -> add them to Config Instrument/Instrument Family, then run listUnmappedInstruments().");
  if ((d.sessionTypeStats||[]).length === 1 && d.sessionTypeStats[0].type === "Practice")
    flags.push("No Meeting sessions detected - fine if none were held, otherwise the Meetings groups may not match the recorded session groups.");
  if (!(d.probationPerformance||{}).byMonth || !d.probationPerformance.byMonth.length)
    flags.push("Probation History is empty - run backfillProbationHistory() once.");
  if (dist.memberCount === 0) flags.push("No members with records in range - check the date filter.");

  var msg = "DASHBOARD NUMBER AUDIT  (" + section + " / " + rangeMode + ")\n" +
    "sessions=" + d.sessionsCount + "  records=" + d.totalRecords + "  rate=" + d.overallRate + "%  members=" + dist.memberCount + "\n\n" +
    "PASSED (" + pass.length + "):\n  " + pass.join("\n  ") + "\n\n" +
    (fail.length ? "FAILED (" + fail.length + "):\n  " + fail.join("\n  ") + "\n\n" : "FAILED: none\n\n") +
    (flags.length ? "DATA RED FLAGS:\n  " + flags.join("\n  ") + "\n\n" : "") +
    (notes.length ? "NOTES:\n  " + notes.join("\n  ") : "");
  Logger.log(msg);
  return msg;
}

function getGroupDashboard(opts) {
  opts = opts || {};
  var ss = getSpreadsheet_();
  var access = getAccess_(ss);
  if (access.level < ROLE_LEVELS.elevated) throw new Error("Admin access required.");
  var section = opts.section || "All";
  if (access.level < ROLE_LEVELS.admin) section = access.section; // forced scope
  var range = resolveDateRange_(opts.range, opts.start, opts.end);

  // Period-over-period only makes sense for a rolling window, not "all" or a custom span.
  var prevRange = (opts.range === "custom" || opts.range === "all") ? null : previousPeriod_(range);

  var famMap = getInstrumentFamilyMap_(ss);

  // Meeting lookup (date|sortedGroups) so sessions can be typed Practice vs Meeting.
  var meetingKeys = {};
  var mSheet = ss.getSheetByName(MEETINGS_SHEET);
  if (mSheet && mSheet.getLastRow() > 1) {
    var md = mSheet.getDataRange().getValues();
    for (var mi = 1; mi < md.length; mi++) {
      var mg = md[mi][2].toString().split(",").map(function (x) { return x.trim(); })
                 .filter(Boolean).sort().join(",");
      meetingKeys[formatSheetDate_(md[mi][0]) + "|" + mg] = true;
    }
  }

  // ---------- SINGLE PASS ----------
  var statusCounts = {}, totalRecords = 0;
  var byDate = {}, byDateKey = {}, byMember = {}, byPart = {}, bySection = {};
  var prevAgg = dashBucket_(), prevDates = {};
  var attSheet = ss.getSheetByName(ATTENDANCE_SHEET);
  if (attSheet && attSheet.getLastRow() > 1) {
    var data = attSheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      var ds = formatSheetDate_(data[i][0]);
      var inCur = (ds >= range.start && ds <= range.end);
      var inPrev = prevRange && ds >= prevRange.start && ds <= prevRange.end;
      if (!inCur && !inPrev) continue;

      var nm = data[i][1].toString();
      var g = data[i][2].toString();
      var role = data[i][3] ? data[i][3].toString().trim() : "";
      var st = data[i][4].toString();
      var sk = data[i][7] ? data[i][7].toString() : g;

      // Section comparison covers ALL sections regardless of the current filter.
      if (inCur) {
        if (!bySection[g]) bySection[g] = dashBucket_();
        dashBump_(bySection[g], st);
      }

      if (section !== "All" && g !== section) continue;

      if (inPrev) { dashBump_(prevAgg, st); prevDates[ds] = 1; }
      if (!inCur) continue;

      statusCounts[st] = (statusCounts[st] || 0) + 1;
      totalRecords++;

      if (!byDate[ds]) byDate[ds] = dashBucket_();
      dashBump_(byDate[ds], st);

      var dk = ds + "|" + sk.split(",").map(function (x) { return x.trim(); }).filter(Boolean).sort().join(",");
      if (!byDateKey[dk]) byDateKey[dk] = { date: ds, bucket: dashBucket_() };
      dashBump_(byDateKey[dk].bucket, st);

      if (!byMember[nm]) byMember[nm] = dashBucket_();
      dashBump_(byMember[nm], st);

      var pk = partKeyFor_(g, role, famMap);
      if (!byPart[g]) byPart[g] = {};
      if (!byPart[g][pk]) byPart[g][pk] = dashBucket_();
      dashBump_(byPart[g][pk], st);
    }
  }

  // ---------- v2 fields (unchanged contract) ----------
  var attendedTotal = (statusCounts["Present"] || 0) + (statusCounts["Late Excused"] || 0) + (statusCounts["Late Unexcused"] || 0);
  var absentTotal = (statusCounts["Absent Excused"] || 0) + (statusCounts["Absent Unexcused"] || 0);
  var overallRate = totalRecords > 0 ? Math.round((attendedTotal / totalRecords) * 100) : 0;
  var absenteeismRate = totalRecords > 0 ? Math.round((absentTotal / totalRecords) * 100) : 0;
  var auRate = totalRecords > 0 ? Math.round(((statusCounts["Absent Unexcused"] || 0) / totalRecords) * 100) : 0;

  var trendArr = Object.keys(byDate).sort().map(function (d) {
    var t = byDate[d];
    return { date: d, rate: dashRate_(t), attended: t.attended, total: t.total,
             present: t.present, late: t.late, ae: t.ae, au: t.au };
  });
  var sessionsCount = trendArr.length;
  function avg(x) { return sessionsCount > 0 ? Math.round((x / sessionsCount) * 10) / 10 : 0; }
  var avgPerSession = {
    total: avg(totalRecords), attended: avg(attendedTotal),
    present: avg(statusCounts["Present"] || 0),
    late: avg((statusCounts["Late Excused"] || 0) + (statusCounts["Late Unexcused"] || 0)),
    absentExcused: avg(statusCounts["Absent Excused"] || 0),
    absentUnexcused: avg(statusCounts["Absent Unexcused"] || 0)
  };
  var momentum = { firstHalfRate: 0, secondHalfRate: 0, delta: 0, direction: "flat" };
  if (trendArr.length >= 2) {
    var mid = Math.floor(trendArr.length / 2);
    var fh = trendArr.slice(0, mid), sh = trendArr.slice(mid);
    var fAvg = Math.round(fh.reduce(function (s, t) { return s + t.rate; }, 0) / fh.length);
    var sAvg = Math.round(sh.reduce(function (s, t) { return s + t.rate; }, 0) / sh.length);
    momentum = { firstHalfRate: fAvg, secondHalfRate: sAvg, delta: sAvg - fAvg,
                 direction: (sAvg - fAvg) > 2 ? "improving" : ((sAvg - fAvg) < -2 ? "declining" : "flat") };
  }

  // Apologies (one pass) + compliance
  var apologyStats = { total: 0, absentType: 0, lateType: 0, onTime: 0, lateSubmission: 0,
                       approved: 0, pending: 0, rejected: 0, notNeeded: 0, complianceRate: 0 };
  var apSheet = ss.getSheetByName(APOLOGIES_SHEET);
  if (apSheet && apSheet.getLastRow() > 1) {
    var ad = apSheet.getDataRange().getValues();
    for (var a = 1; a < ad.length; a++) {
      if (isRequestType_(ad[a][3])) continue;
      var aDate = formatSheetDate_(ad[a][0]);
      if (aDate < range.start || aDate > range.end) continue;
      if (section !== "All") {
        var ag = ad[a][11] ? ad[a][11].toString().split(",").map(function (x) { return x.trim(); }).filter(Boolean) : [];
        if (ag.length > 0 && ag.indexOf(section) === -1) continue;
      }
      apologyStats.total++;
      if (/late/i.test(ad[a][3].toString())) apologyStats.lateType++; else apologyStats.absentType++;
      if (ad[a][7].toString() === "Yes") apologyStats.onTime++; else apologyStats.lateSubmission++;
      var aStatus = ad[a][8].toString();
      if (aStatus === "Approved" || aStatus === "Applied") apologyStats.approved++;
      else if (aStatus === "Pending") apologyStats.pending++;
      else if (aStatus === "Rejected" || aStatus === "Revoked") apologyStats.rejected++;
      else if (aStatus === "Not needed") apologyStats.notNeeded++;
    }
  }
  // Compliance = share of absences that were EXCUSED (i.e. communicated in advance).
  apologyStats.complianceRate = absentTotal > 0
    ? Math.round(((statusCounts["Absent Excused"] || 0) / absentTotal) * 100) : 0;

  var nearAU = getConsecutiveAuWarnings_(ss, section, 2);
  var probAll = getProbationDashboard();
  var probInSection = probAll.filter(function (p) {
    return section === "All" || (p.groups || []).indexOf(section) !== -1;
  });
  var probFallingBehind = probInSection.filter(function (p) { return !p.onTrack; });

  // ---------- v3 PANELS ----------

  // 1. Per-part / instrument-family breakdown (+ late-vs-absent skew per part)
  var partBreakdown = [];
  Object.keys(byPart).forEach(function (g) {
    Object.keys(byPart[g]).forEach(function (pk) {
      var b = byPart[g][pk];
      var miss = b.late + b.ae + b.au;
      partBreakdown.push({
        section: g, part: pk, rate: dashRate_(b), total: b.total, attended: b.attended,
        present: b.present, late: b.late, ae: b.ae, au: b.au,
        lateShare: miss > 0 ? Math.round((b.late / miss) * 100) : 0,
        // Leaning requires a CLEAR skew (2x), not a bare majority: 8 late vs 10
        // absences is an even mix, not an absence problem.
        skew: miss === 0 ? "clean"
              : ((b.ae + b.au) >= 2 * b.late ? "absence-leaning"
                 : (b.late >= 2 * (b.ae + b.au) ? "late-leaning" : "even"))
      });
    });
  });
  partBreakdown.sort(function (x, y) { return x.rate - y.rate; }); // worst first — that's the actionable end

  // 2. Section comparison (always all three, for the "All" view)
  var sectionComparison = Object.keys(bySection).map(function (g) {
    var b = bySection[g];
    return { section: g, rate: dashRate_(b), total: b.total, attended: b.attended,
             present: b.present, late: b.late, ae: b.ae, au: b.au };
  }).sort(function (x, y) { return y.rate - x.rate; });

  // 3. Attendance distribution — the shape the average hides
  var buckets = [
    { label: "0-25%", min: 0, max: 25, count: 0 },
    { label: "26-50%", min: 26, max: 50, count: 0 },
    { label: "51-75%", min: 51, max: 75, count: 0 },
    { label: "76-100%", min: 76, max: 100, count: 0 }
  ];
  var memberRates = [];
  Object.keys(byMember).forEach(function (n) {
    var r = dashRate_(byMember[n]);
    memberRates.push({ name: n, rate: r, attended: byMember[n].attended, total: byMember[n].total });
    for (var bi = 0; bi < buckets.length; bi++) {
      if (r >= buckets[bi].min && r <= buckets[bi].max) { buckets[bi].count++; break; }
    }
  });
  var distribution = { buckets: buckets, memberCount: memberRates.length };

  // 4. Day-of-week + session type
  var DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var byWeekday = {}, byType = { Practice: dashBucket_(), Meeting: dashBucket_() };
  Object.keys(byDate).forEach(function (d) {
    var wd = DAY[new Date(d + "T00:00:00").getDay()];
    if (!byWeekday[wd]) byWeekday[wd] = dashBucket_();
    var b = byDate[d];
    ["present", "late", "ae", "au", "total", "attended"].forEach(function (k) { byWeekday[wd][k] += b[k]; });
  });
  Object.keys(byDateKey).forEach(function (dk) {
    var isMeeting = !!meetingKeys[dk];
    var target = isMeeting ? byType.Meeting : byType.Practice;
    var b = byDateKey[dk].bucket;
    ["present", "late", "ae", "au", "total", "attended"].forEach(function (k) { target[k] += b[k]; });
  });
  var weekdayStats = DAY.filter(function (d) { return byWeekday[d]; }).map(function (d) {
    return { day: d, rate: dashRate_(byWeekday[d]), total: byWeekday[d].total };
  });
  var sessionTypeStats = ["Practice", "Meeting"].filter(function (t) { return byType[t].total > 0; })
    .map(function (t) { return { type: t, rate: dashRate_(byType[t]), total: byType[t].total }; });

  // 5. Late-vs-absent behavioural split.
  // "Chronic" requires a real pattern: at least CHRONIC_MIN incidents of the
  // dominant kind. Without this floor a single lateness would label someone who
  // attended everything as chronically late, which the data does not support.
  // Floor scales with the range: judging "chronic" over a month should need more
  // incidents than over a week. 8 sessions -> 3, 4 sessions -> 2.
  var CHRONIC_MIN = Math.max(2, Math.ceil(sessionsCount / 3));
  var behaviour = { chronicLate: [], chronicAbsent: [], mixed: 0, spotless: 0, occasional: 0 };
  Object.keys(byMember).forEach(function (n) {
    var b = byMember[n];
    var absent = b.ae + b.au;
    if (b.late === 0 && absent === 0) { behaviour.spotless++; return; }
    var dominant = Math.max(b.late, absent);
    if (dominant < CHRONIC_MIN) { behaviour.occasional++; return; }
    if (b.late > absent) behaviour.chronicLate.push({ name: n, late: b.late, absent: absent, rate: dashRate_(b) });
    else if (absent > b.late) behaviour.chronicAbsent.push({ name: n, late: b.late, absent: absent, rate: dashRate_(b) });
    else behaviour.mixed++;
  });
  behaviour.chronicMin = CHRONIC_MIN;
  behaviour.chronicLate.sort(function (x, y) { return y.late - x.late; });
  behaviour.chronicAbsent.sort(function (x, y) { return y.absent - x.absent; });
  behaviour.chronicLateCount = behaviour.chronicLate.length;
  behaviour.chronicAbsentCount = behaviour.chronicAbsent.length;
  behaviour.chronicLate = behaviour.chronicLate.slice(0, 10);
  behaviour.chronicAbsent = behaviour.chronicAbsent.slice(0, 10);

  // 6. Top consistent attenders — floor prevents a 1-of-1 member topping the list
  var minSessions = Math.max(2, Math.ceil(sessionsCount / 2));
  var topAttenders = memberRates.filter(function (m) { return m.total >= minSessions; })
    .sort(function (x, y) { return (y.rate - x.rate) || (y.attended - x.attended) || x.name.localeCompare(y.name); })
    .slice(0, 5);

  // 7. Membership health
  var health = { active: 0, hiatus: 0, rejoining: 0, inactive: 0, alumnus: 0,
                 joinedInRange: 0, removedInRange: 0 };
  var detailMap = {};
  var mdSheet = ss.getSheetByName(MEMBER_DETAILS_SHEET);
  if (mdSheet && mdSheet.getLastRow() > 1) {
    var dmap = headerIndexMap_(mdSheet);
    var dd = mdSheet.getDataRange().getValues();
    for (var r2 = 1; r2 < dd.length; r2++) {
      detailMap[dd[r2][0].toString().trim()] = {
        status: dmap["member status"] != null ? dd[r2][dmap["member status"]].toString().trim() : "",
        completedAt: dmap["completed at"] != null ? formatSheetDate_(dd[r2][dmap["completed at"]]) : ""
      };
    }
  }
  var removedOnMap = {};
  var memSheet = ss.getSheetByName(MEMBERS_SHEET);
  if (memSheet && memSheet.getLastRow() > 1) {
    var mmap = headerIndexMap_(memSheet);
    if (mmap["removed on"] != null && mmap["name"] != null) {
      var mvals = memSheet.getDataRange().getValues();
      for (var r3 = 1; r3 < mvals.length; r3++) {
        var rv = mvals[r3][mmap["removed on"]];
        if (rv) removedOnMap[mvals[r3][mmap["name"]].toString().trim()] = formatSheetDate_(rv);
      }
    }
  }
  readAllMembers_(ss).forEach(function (m) {
    if (section !== "All" && (m.groups || []).indexOf(section) === -1) return;
    var d = detailMap[m.name] || {};
    if (m.active) {
      if (d.status === "Rejoining") health.rejoining++; else health.active++;
    } else if (d.status === "On Hiatus") health.hiatus++;
    else if (d.status === "Alumnus") health.alumnus++;
    else health.inactive++;
    if (d.completedAt && d.completedAt >= range.start && d.completedAt <= range.end) health.joinedInRange++;
    var ro = removedOnMap[m.name];
    if (ro && ro >= range.start && ro <= range.end) health.removedInRange++;
  });

  // 8. Probation performance (from the Probation History event log)
  var probPerf = { inRange: { passed: 0, conditional: 0, failed: 0, total: 0, passRate: 0 }, byMonth: [] };
  var phSheet = ss.getSheetByName(PROBATION_HISTORY_SHEET);
  if (phSheet && phSheet.getLastRow() > 1) {
    var ph = phSheet.getDataRange().getValues();
    var phh = ph[0].map(function (x) { return x.toString().trim().toLowerCase(); });
    var cName = phh.indexOf("name"), cGroups = phh.indexOf("groups"),
        cEnd = phh.indexOf("probation end"), cOut = phh.indexOf("outcome");
    var months = {};
    for (var p = 1; p < ph.length; p++) {
      var gstr = cGroups !== -1 ? ph[p][cGroups].toString() : "";
      if (section !== "All" && gstr.indexOf(section) === -1) continue;
      var endD = cEnd !== -1 ? formatSheetDate_(ph[p][cEnd]) : "";
      var out = cOut !== -1 ? ph[p][cOut].toString() : "";
      if (!out) continue;
      var mkey = endD ? endD.substring(0, 7) : "";
      if (mkey) {
        if (!months[mkey]) months[mkey] = { month: mkey, passed: 0, conditional: 0, failed: 0 };
        if (out === "Passed") months[mkey].passed++;
        else if (out === "Conditional") months[mkey].conditional++;
        else if (out === "Failed") months[mkey].failed++;
      }
      if (endD && endD >= range.start && endD <= range.end) {
        probPerf.inRange.total++;
        if (out === "Passed") probPerf.inRange.passed++;
        else if (out === "Conditional") probPerf.inRange.conditional++;
        else if (out === "Failed") probPerf.inRange.failed++;
      }
    }
    if (probPerf.inRange.total > 0) {
      probPerf.inRange.passRate = Math.round(((probPerf.inRange.passed + probPerf.inRange.conditional) / probPerf.inRange.total) * 100);
    }
    probPerf.byMonth = Object.keys(months).sort().map(function (k) {
      var m2 = months[k], tot = m2.passed + m2.conditional + m2.failed;
      m2.total = tot;
      m2.passRate = tot > 0 ? Math.round(((m2.passed + m2.conditional) / tot) * 100) : 0;
      return m2;
    });
  }

  // 9. Period-over-period
  var comparison = null;
  if (prevRange) {
    var prevSessions = Object.keys(prevDates).length;
    var prevRate = dashRate_(prevAgg);
    comparison = {
      previousRange: prevRange,
      previousRate: prevRate,
      rateDelta: overallRate - prevRate,
      previousSessions: prevSessions,
      sessionsDelta: sessionsCount - prevSessions,
      previousAvgAttended: prevSessions > 0 ? Math.round((prevAgg.attended / prevSessions) * 10) / 10 : 0,
      avgAttendedDelta: 0,
      previousAuRate: prevAgg.total > 0 ? Math.round((prevAgg.au / prevAgg.total) * 100) : 0,
      direction: (overallRate - prevRate) > 2 ? "improving" : ((overallRate - prevRate) < -2 ? "declining" : "flat")
    };
    comparison.avgAttendedDelta = Math.round((avgPerSession.attended - comparison.previousAvgAttended) * 10) / 10;
    comparison.auRateDelta = auRate - comparison.previousAuRate;
  }

  return {
    // --- v2 contract ---
    section: section, range: range, sessionsCount: sessionsCount,
    overallRate: overallRate, absenteeismRate: absenteeismRate, auRate: auRate,
    statusCounts: statusCounts, totalRecords: totalRecords,
    avgPerSession: avgPerSession, momentum: momentum, apologyStats: apologyStats,
    trend: trendArr, nearAU: nearAU,
    probationCount: probInSection.length,
    probationFallingBehind: probFallingBehind,
    probationOnTrack: probInSection.length - probFallingBehind.length,
    // --- v3 additions ---
    partBreakdown: partBreakdown,
    sectionComparison: sectionComparison,
    distribution: distribution,
    weekdayStats: weekdayStats,
    sessionTypeStats: sessionTypeStats,
    behaviour: behaviour,
    topAttenders: topAttenders,
    minSessionsForTop: minSessions,
    membershipHealth: health,
    probationPerformance: probPerf,
    comparison: comparison
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
// These dump org-wide attendance, so they need the same gate as the views they
// mirror. Scoped roles are limited to their own section.
function exportGuard_(group) {
  var a = getAccess_(getSpreadsheet_());
  if (a.level < ROLE_LEVELS.elevated) throw new Error("Admin access required.");
  if (a.level < ROLE_LEVELS.admin) {
    if (group === "All" || (a.allowedSections || []).indexOf(group) === -1) {
      throw new Error("You can only export " + (a.allowedSections || []).join(", ") + ".");
    }
  }
  return a;
}
function exportDateCSV(dateStr, group) { exportGuard_(group); return arrayToCSV_(buildExportRows_(dateStr, dateStr, group)); }
function exportDatePDF(dateStr, group) { exportGuard_(group); return buildPrintHTML_("Attendance Report — " + dateStr, buildExportRows_(dateStr, dateStr, group), group); }
function exportDateRangeCSV(s, e, group) { exportGuard_(group); return arrayToCSV_(buildExportRows_(s, e, group)); }
function exportDateRangePDF(s, e, group) { exportGuard_(group); return buildPrintHTML_("Attendance Report — " + s + " to " + e, buildExportRows_(s, e, group), group); }

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
  requireManagement_();
  // "Consec. Penalty" was removed: 3-AU penalties are recorded as offenses now, so
  // that column was always 0 and double-implied a deduction that lives in Offense Pts.
  var sb=getScoreboard(group),rows=[["Rank","Name","Groups","Total Points","Attendance Pts","Rewards","Reward Pts","Offenses","Offense Pts","Days"]];
  for(var i=0;i<sb.length;i++){var s=sb[i];rows.push([i+1,s.name,s.groups.join(", "),s.totalPoints,s.attPoints,s.rewardCount,s.rewardPts,s.offenseCount,s.offensePts,s.totalDays]);}
  return arrayToCSV_(rows);
}
function exportScoreboardPDF(group) {
  requireManagement_();
  var sb=getScoreboard(group),rows=[["Rank","Name","Groups","Total Points","Attendance Pts","Rewards","Reward Pts","Offenses","Offense Pts","Days"]];
  for(var i=0;i<sb.length;i++){var s=sb[i];rows.push([i+1,s.name,s.groups.join(", "),s.totalPoints,s.attPoints,s.rewardCount,s.rewardPts,s.offenseCount,s.offensePts,s.totalDays]);}
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
/**
 * FOLDED INTO THE REJOIN FLOW. A failed probation now sets the member inactive,
 * which is exactly the state the rejoin flow handles, so this is a thin alias kept
 * only so any UI still calling it keeps working. New code should call requestRejoin.
 */
// =======================================================
//  EMERGENCY APOLOGIES
//  Filed AFTER the deadline for a session that has already happened. They always
//  require explicit admin approval - nothing about them is automatic, and a
//  pending one never influences a register. Restricted to the member's single
//  most recent session, within a short window, and never long-term.
// =======================================================
var EMERGENCY_APOLOGY_TYPE = "Emergency";
// How long AFTER a session starts a member may still file an emergency apology.
// Measured from the session's START TIME, not from the end of the day.
var EMERGENCY_APOLOGY_WINDOW_HOURS = 24;
// How long a session stays on the member's card after it has started, so the card
// does not jump to the next session the instant the current one begins.
var SESSION_GRACE_MINUTES = 60;

/**
 * The session a member may currently file an emergency apology for.
 *
 * Eligibility is keyed to the SESSION (from the schedule), not to an attendance
 * row. The register is often marked hours after a session ends, and keying off it
 * meant the window opened late - or never, if the card had already rolled on.
 * Now the window opens the moment a session starts and runs for
 * EMERGENCY_APOLOGY_WINDOW_HOURS, whether or not anyone has marked the register.
 *
 * @returns {Object} { eligible, reason, date, time, groups, sessionKey,
 *                     opensAt, closesAt, status, windowHours }
 */
function getEmergencyApologyOption() {
  var ss = getSpreadsheet_();
  var email = Session.getActiveUser().getEmail();
  if (!email) throw new Error("Could not detect your email.");
  var member = findMemberByEmail_(ss, email.toLowerCase());
  if (!member) throw new Error("No member record found.");
  var memberGroups = member.groups.filter(function (g) { return GROUPS.indexOf(g) !== -1; });
  if (!memberGroups.length) return { eligible: false, reason: "You are not in any section." };

  var tz = Session.getScriptTimeZone();
  var now = new Date();
  var windowMs = EMERGENCY_APOLOGY_WINDOW_HOURS * 3600000;

  // Walk backwards day by day for the most recent STARTED session still in window.
  var days = Math.ceil(EMERGENCY_APOLOGY_WINDOW_HOURS / 24) + 1;
  var candidate = null;
  for (var d = 0; d <= days; d++) {
    var checkDate = new Date(now.getTime() - d * 86400000);
    var dateStr = Utilities.formatDate(checkDate, tz, "yyyy-MM-dd");
    var info = getSessionTime(dateStr, memberGroups);
    if (!info.found) continue;
    var timeStr = info.latest || info.time;
    var tp = timeStr.split(":");
    var sessionDT = new Date(checkDate.getFullYear(), checkDate.getMonth(), checkDate.getDate(),
                             parseInt(tp[0], 10), parseInt(tp[1], 10));
    if (sessionDT > now) continue;                       // not started yet
    if ((now - sessionDT) > windowMs) break;             // older than this is out of window
    candidate = { date: dateStr, time: timeStr, sessionDT: sessionDT, groups: memberGroups };
    break;                                               // most recent wins
  }

  if (!candidate) {
    return { eligible: false,
             reason: "There is no recent session to file an emergency apology for." };
  }

  var closesAt = new Date(candidate.sessionDT.getTime() + windowMs);
  var base = {
    date: candidate.date, time: candidate.time, groups: candidate.groups,
    sessionKey: candidate.groups.join(", "),
    opensAt: Utilities.formatDate(candidate.sessionDT, tz, "yyyy-MM-dd HH:mm"),
    closesAt: Utilities.formatDate(closesAt, tz, "yyyy-MM-dd HH:mm"),
    windowHours: EMERGENCY_APOLOGY_WINDOW_HOURS
  };

  // If the register IS marked and they turned up, there is nothing to excuse.
  var attSheet = ss.getSheetByName(ATTENDANCE_SHEET);
  var recorded = null;
  if (attSheet && attSheet.getLastRow() > 1) {
    var ad = attSheet.getDataRange().getValues();
    for (var i = 1; i < ad.length; i++) {
      if (ad[i][1].toString().trim() !== member.name) continue;
      if (formatSheetDate_(ad[i][0]) !== candidate.date) continue;
      recorded = bestStatus_(recorded, ad[i][4].toString());
    }
  }
  base.status = recorded || "Not yet recorded";
  if (recorded === "Present" || recorded === "Late Excused") {
    base.eligible = false;
    base.reason = "You were marked " + recorded + " for that session.";
    return base;
  }

  // Already has an apology on file for that date?
  var apSheet = ss.getSheetByName(APOLOGIES_SHEET);
  if (apSheet && apSheet.getLastRow() > 1) {
    var apd = apSheet.getDataRange().getValues();
    for (var a = 1; a < apd.length; a++) {
      if (apd[a][1].toString().trim() !== member.name) continue;
      if (formatSheetDate_(apd[a][0]) !== candidate.date) continue;
      if (isRequestType_(apd[a][3])) continue;
      var st = apd[a][8].toString();
      if (st === "Rejected" || st === "Revoked" || st === "Not needed") continue;
      base.eligible = false;
      base.reason = "You already have an apology on file for that session.";
      return base;
    }
  }

  base.eligible = true;
  return base;
}

/**
 * Files an emergency apology for the member's most recent session.
 * Always lands Pending: it is after the deadline by definition, so an admin must
 * decide. Approving it runs the normal backfill, which flips the recorded status.
 */
function submitEmergencyApology(reason) {
  if (!reason || !reason.toString().trim()) throw new Error("Please describe what happened.");
  var ss = getSpreadsheet_();
  var email = Session.getActiveUser().getEmail();
  var member = findMemberByEmail_(ss, email.toLowerCase());
  if (!member) throw new Error("No member record found.");

  var opt = getEmergencyApologyOption();
  if (!opt.eligible) throw new Error(opt.reason || "You cannot file an emergency apology right now.");

  var sheet = ensureApologiesSheet_(ss);
  var now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
  // onTime is "No" by definition; End Date stays blank so this can never be long-term.
  sheet.appendRow([opt.date, member.name, email, EMERGENCY_APOLOGY_TYPE, reason.toString().trim(),
                   now, opt.time || "", "No", "Pending", "", "", (opt.groups || []).join(", ")]);
  try {
    var admins = getAdminEmails_(ss);
    if (admins.length) {
      MailApp.sendEmail({
        to: admins.join(","),
        subject: "Emergency apology — " + member.name + " (" + opt.date + ")",
        htmlBody: buildEmail_(
          "<p><b>" + member.name + "</b> has filed an <b>emergency apology</b> for the session on " +
          opt.date + ", after the normal deadline.</p><p>Reason: " + reason + "</p>" +
          "<p>This needs your review - it will not be applied until approved.</p>",
          { headerTitle: "Emergency Apology", signatureKey: "general" }),
        name: EMAIL_FROM_NAME
      });
    }
  } catch (e) { Logger.log("emergency apology notify: " + e); }
  return { success: true, date: opt.date };
}

// =======================================================
//  MEMBER EXPORT WITH FILTERS
// =======================================================

/** Joins Members with Member Details once, for filtering and export. */
function readMembersWithDetails_(ss) {
  var members = readAllMembers_(ss);
  var detail = {};
  var sheet = ss.getSheetByName(MEMBER_DETAILS_SHEET);
  if (sheet && sheet.getLastRow() > 1) {
    var dmap = headerIndexMap_(sheet);
    var d = sheet.getDataRange().getValues();
    for (var i = 1; i < d.length; i++) {
      var nm = d[i][0].toString().trim();
      if (!nm) continue;
      function val(h) { return dmap[h] != null && d[i][dmap[h]] != null ? d[i][dmap[h]].toString().trim() : ""; }
      detail[nm] = {
        gender: val("gender"),
        yearOfStudy: val("year of study"),
        courseFaculty: val("course faculty"),
        courseName: val("course name"),
        admissionNumber: val("admission number"),
        nationality: val("nationality"),
        residence: val("residence"),
        phoneNumber: val("phone number"),
        memberStatus: val("member status")
      };
    }
  }
  return members.map(function (m) {
    var d = detail[m.name] || {};
    return {
      name: m.name, email: m.email, phone: m.phone || d.phoneNumber || "",
      admNo: m.admNo || d.admissionNumber || "",
      groups: m.groups, roles: m.roles, active: m.active,
      probation: m.probation, probationPassed: m.probationPassed, probationFailed: m.probationFailed,
      gender: d.gender || "", yearOfStudy: d.yearOfStudy || "",
      courseFaculty: d.courseFaculty || "", courseName: d.courseName || "",
      nationality: d.nationality || "", residence: d.residence || "",
      memberStatus: d.memberStatus || ""
    };
  });
}

/** Distinct values for each member filter, so the UI never hard-codes a list. */
function getMemberFilterOptions() {
  var ss = getSpreadsheet_();
  var access = getAccess_(ss);
  if (access.level < ROLE_LEVELS.elevated) throw new Error("Admin access required.");
  var inScope = scopeMemberPredicate_(access, ss);
  var all = readMembersWithDetails_(ss).filter(inScope);

  var roles = {}, genders = {}, faculties = {}, years = {};
  all.forEach(function (m) {
    GROUPS.forEach(function (g) {
      var r = m.roles && m.roles[g] ? m.roles[g].toString().trim() : "";
      if (r) { if (!roles[g]) roles[g] = {}; roles[g][r] = true; }
    });
    if (m.gender) genders[m.gender] = true;
    if (m.courseFaculty) faculties[m.courseFaculty] = true;
    if (m.yearOfStudy) years[m.yearOfStudy] = true;
  });
  var rolesOut = {};
  Object.keys(roles).forEach(function (g) { rolesOut[g] = Object.keys(roles[g]).sort(); });

  return {
    sections: (access.level >= ROLE_LEVELS.admin) ? GROUPS.slice() : (access.allowedSections || []).slice(),
    roles: rolesOut,
    genders: Object.keys(genders).sort(),
    faculties: Object.keys(faculties).sort(),
    yearsOfStudy: Object.keys(years).sort(),
    probationStatuses: ["On probation", "Passed", "Failed", "Not on probation"],
    memberStatuses: ["Active", "Rejoining", "On Hiatus", "Left", "Alumnus", "Memorial"]
  };
}

/** Applies the filter object to the joined member list. */
function filterMembers_(members, f) {
  f = f || {};
  function has(list) { return list && list.length; }
  return members.filter(function (m) {
    if (has(f.sections) && !m.groups.some(function (g) { return f.sections.indexOf(g) !== -1; })) return false;
    if (has(f.roles)) {
      var match = false;
      GROUPS.forEach(function (g) {
        var r = m.roles && m.roles[g] ? m.roles[g].toString().trim() : "";
        if (r && f.roles.indexOf(r) !== -1) match = true;
      });
      if (!match) return false;
    }
    if (has(f.genders) && f.genders.indexOf(m.gender) === -1) return false;
    if (has(f.faculties) && f.faculties.indexOf(m.courseFaculty) === -1) return false;
    if (has(f.yearsOfStudy) && f.yearsOfStudy.indexOf(m.yearOfStudy) === -1) return false;
    if (has(f.memberStatuses) && f.memberStatuses.indexOf(m.memberStatus) === -1) return false;
    if (has(f.probationStatuses)) {
      var state = m.probationFailed ? "Failed"
                : m.probationPassed ? "Passed"
                : m.probation ? "On probation" : "Not on probation";
      if (f.probationStatuses.indexOf(state) === -1) return false;
    }
    return true;
  });
}

/** Builds the export table (header row + data rows) for the filtered members. */
function buildMemberExportRows_(members) {
  var rows = [["Name", "Email", "Phone", "Adm. No.", "Sections", "Choir Part", "Band Role",
               "Orchestra Role", "Gender", "Year of Study", "Course Faculty", "Course",
               "Probation", "Member Status"]];
  members.forEach(function (m) {
    var probState = m.probationFailed ? "Failed"
                  : m.probationPassed ? "Passed"
                  : m.probation ? "On probation" : "—";
    rows.push([
      m.name, m.email, m.phone, m.admNo, m.groups.join(", "),
      (m.roles && m.roles["Choir"]) || "", (m.roles && m.roles["Band"]) || "",
      (m.roles && m.roles["Orchestra"]) || "",
      m.gender, m.yearOfStudy, m.courseFaculty, m.courseName,
      probState, m.memberStatus || (m.active ? "Active" : "Inactive")
    ]);
  });
  return rows;
}

/** Human-readable summary of which filters produced an export. */
function describeMemberFilters_(f) {
  f = f || {};
  var bits = [];
  function add(label, list) { if (list && list.length) bits.push(label + ": " + list.join(", ")); }
  add("Sections", f.sections); add("Roles", f.roles); add("Gender", f.genders);
  add("Faculty", f.faculties); add("Year", f.yearsOfStudy);
  add("Probation", f.probationStatuses); add("Status", f.memberStatuses);
  return bits.length ? bits.join("  ·  ") : "All members";
}

/** Filtered member export as CSV. */
function exportMembersCSV(filters) {
  var ss = getSpreadsheet_();
  var access = requireManagement_();
  var inScope = scopeMemberPredicate_(access, ss);
  var members = filterMembers_(readMembersWithDetails_(ss).filter(inScope), filters);
  return arrayToCSV_(buildMemberExportRows_(members));
}

/** Filtered member export as print-ready HTML (the browser prints it to PDF). */
function exportMembersPDF(filters) {
  var ss = getSpreadsheet_();
  var access = requireManagement_();
  var inScope = scopeMemberPredicate_(access, ss);
  var members = filterMembers_(readMembersWithDetails_(ss).filter(inScope), filters);
  var rows = buildMemberExportRows_(members);
  return buildPrintHTML_("Member Directory — " + members.length + " member(s)", rows,
                         describeMemberFilters_(filters));
}

/** Preview count, so the UI can show "42 members match" before exporting. */
function countFilteredMembers(filters) {
  var ss = getSpreadsheet_();
  var access = requireManagement_();
  var inScope = scopeMemberPredicate_(access, ss);
  return filterMembers_(readMembersWithDetails_(ss).filter(inScope), filters).length;
}

function requestProbationRestart(reason) {
  return requestRejoin(reason);
}

/**
 * Admin approves a probation restart request.
 * Resets the member's probation to active with today as start date.
 */
/**
 * FOLDED INTO approveRejoin. The old implementation diverged from the current
 * model: it set the member straight to "Active" instead of "Rejoining", never
 * updated Member Details, and left the request row open. It now locates the
 * member's pending request (either type) and approves it through the one path.
 */
function approveProbationRestart(memberName) {
  requireManagement_();
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(APOLOGIES_SHEET);
  var rowIndex = -1;
  if (sheet && sheet.getLastRow() > 1) {
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (data[i][1].toString().trim() !== memberName) continue;
      var t = data[i][3].toString();
      if (t !== "Restart Probation" && t !== "Rejoin Request") continue;
      if (data[i][8].toString() !== "Pending") continue;
      rowIndex = i + 1;
      break;
    }
  }
  if (rowIndex === -1) {
    // Admin-initiated restart with no request on file - reinstate directly.
    reinstateMemberToProbation_(ss, memberName);
    return { success: true, name: memberName, note: "No pending request found; reinstated directly." };
  }
  return approveRejoin(rowIndex, memberName);
}

// -------------------------------------------------------
//  MEMBER MANAGEMENT
// -------------------------------------------------------
function getMemberList() {
  var ss=getSpreadsheet_(),all=readAllMembers_(ss);
  // Scope: members tab shows only the caller's scope (section / rep-group)
  var access = getAccess_(ss);
  if (access.level < ROLE_LEVELS.elevated) throw new Error("Admin access required.");
  var inScope = scopeMemberPredicate_(access, ss);
  all = all.filter(inScope);
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
  requireFullAdmin_();
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

  // Membership state, promoted to TOP LEVEL. It previously only existed nested at
  // details.memberStatus (inside the collapsed detail tier), which made it easy for
  // the UI to miss and default everyone to the removal/probation flow. The backend
  // now states the state AND which actions are valid, so the UI never has to infer.
  var detailStatus = (details && details.memberStatus) ? details.memberStatus : "";
  var mState, actions;
  if (member.active) {
    mState = (detailStatus === "Rejoining") ? "rejoining" : "active";
    actions = ["setHiatus", "remove"];
  } else if (detailStatus === "On Hiatus") {
    mState = "hiatus";
    actions = ["reactivateFromHiatus"];          // NEVER probation — they only paused
  } else {
    mState = member.probationFailed ? "failedProbation" : "removed";
    actions = ["reinstateProbation", "reinstateActive"];
  }

  return {
    membership: { state: mState, detailStatus: detailStatus,
                  active: !!member.active, availableActions: actions },
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
  requireFullAdmin_();
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
  // Role changes must ALSO reach historic Attendance rows - the role is copied into
  // each row at record time, so editing only the Members sheet leaves the past wrong.
  var roleCascade = { Choir: 0, Band: 0, Orchestra: 0 };
  function setRole(headerName, section, value) {
    if (value === undefined) return;
    var c = col(headerName);
    var oldVal = (c !== -1) ? mData[rowIdx][c].toString().trim() : "";
    setM(headerName, value);
    if (String(value).trim() !== oldVal) {
      try { roleCascade[section] = cascadeMemberRoleChange_(ss, p.originalName.trim(), section, String(value).trim()); }
      catch (e) { Logger.log("role cascade (" + section + "): " + e); }
    }
  }
  var editFam = getInstrumentFamilyMap_(ss);
  var bandStore = resolveRoleForStorage_("Band", p.bandRole, editFam);
  var orchStore = resolveRoleForStorage_("Orchestra", p.orchestraRole, editFam);
  setRole("choir part", "Choir", p.choirPart);
  setRole("band role", "Band", p.bandRole === undefined ? undefined : bandStore.role);
  setRole("orchestra role", "Orchestra", p.orchestraRole === undefined ? undefined : orchStore.role);
  // If an instrument was picked, remember it in Member Details.
  var pickedInstruments = [bandStore.instrument, orchStore.instrument].filter(Boolean).join(" / ");
  if (pickedInstruments) {
    if (!p.details) p.details = {};
    if (!p.details.instruments) p.details.instruments = pickedInstruments;
  }

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
  return { success: true, name: (p.name || p.originalName).trim(), renamed: renamed, roleCascade: roleCascade };
}

function addMember(member) {
  var ss=getSpreadsheet_(),sheet=ss.getSheetByName(MEMBERS_SHEET);if(!sheet)throw new Error("Sheet '"+MEMBERS_SHEET+"' not found.");
  var data=sheet.getDataRange().getValues(),h=data[0].map(function(x){return x.toString().trim().toLowerCase();});
  var ni=h.indexOf("name");
  for(var i=1;i<data.length;i++){if(data[i][ni].toString().trim().toLowerCase()===member.name.trim().toLowerCase())throw new Error("'"+member.name.trim()+"' already exists.");}
  // Band/Orchestra roles are stored as FAMILIES regardless of what the form sent.
  var _famMap = getInstrumentFamilyMap_(ss);
  var _bandStore = resolveRoleForStorage_("Band", member.bandRole, _famMap);
  var _orchStore = resolveRoleForStorage_("Orchestra", member.orchestraRole, _famMap);
  var row=[];
  for(var c=0;c<h.length;c++){
    var col=h[c];
    if(col==="name")row.push(member.name.trim());
    else if(col==="email")row.push(member.email||"");
    else if(col==="phone")row.push(member.phone||"");
    else if(col==="groups")row.push((member.groups||[]).join(", "));
    else if(col==="choir part")row.push(member.choirPart||"");
    else if(col==="band role")row.push(_bandStore.role);
    else if(col==="orchestra role")row.push(_orchStore.role);
    else if(col==="adm. no.")row.push(member.admNo||"");
    else if(col==="status")row.push("Active");
    else if(col==="probation")row.push(member.probation?"Yes":"");
    else if(col==="probation start")row.push(member.probation?(member.probationStart||todayStr_()):"");
    else if(col==="probation end")row.push("");
    else row.push("");
  }
  sheet.appendRow(row);
  // Keep the specific instrument(s) in Member Details so nothing is lost.
  var _insts = [_bandStore.instrument, _orchStore.instrument].filter(Boolean).join(" / ");
  if (_insts) {
    try {
      var _ds = ensureMemberDetailsSheet_(ss);
      var _dm = headerIndexMap_(_ds);
      var _ic = _dm["band/orchestra instruments"];
      if (_ic != null) {
        var _dd = _ds.getDataRange().getValues(); var _found = false;
        for (var _r = 1; _r < _dd.length; _r++) {
          if (_dd[_r][0].toString().trim() === member.name.trim()) {
            _ds.getRange(_r + 1, _ic + 1).setValue(_insts); _found = true; break;
          }
        }
        if (!_found) {
          _ds.appendRow([member.name.trim(), member.email || ""]);
          _ds.getRange(_ds.getLastRow(), _ic + 1).setValue(_insts);
        }
      }
    } catch (e) { Logger.log("instrument capture: " + e); }
  }
  return{success:true,name:member.name.trim(),
         bandRole:_bandStore.role,orchestraRole:_orchStore.role,instruments:_insts};
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

/** WhatsApp community link — Config sheet key "whatsappCommunityLink" overrides the constant. */
function getWhatsappLink_() {
  try {
    var ss = getSpreadsheet_(), sheet = ss.getSheetByName(CONFIG_SHEET);
    if (sheet && sheet.getLastRow() > 1) {
      var data = sheet.getDataRange().getValues();
      for (var i = 1; i < data.length; i++) {
        for (var c = 0; c < data[i].length - 1; c++) {
          if (data[i][c].toString().trim() === "whatsappCommunityLink") {
            var v = data[i][c + 1].toString().trim();
            if (v) return v;
          }
        }
      }
    }
  } catch (e) {}
  return WHATSAPP_COMMUNITY_LINK || "";
}

function sendWelcomeEmail(name, email, groups) {
  if (!email) throw new Error("No email provided for " + name);

  var webAppUrl = APP_URL || ScriptApp.getService().getUrl();

  try {
    var htmlBody = renderEmailTemplate_("welcome-invite", {
      memberName: name,
      groups: groups.join(", "),
      appUrl: webAppUrl,
      probationSessions: PROBATION_SESSIONS,
      threshold: Math.round(PROBATION_THRESHOLD * 100),
      whatsappLink: getWhatsappLink_()
    });
    if (!getWhatsappLink_()) {
      htmlBody = htmlBody.replace(/<!--WHATSAPP-->[\s\S]*?<!--\/WHATSAPP-->/i, "");
    }

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
    // Members stores the FAMILY; the specific instrument stays in Member Details
    // (instrumentsCombined, written above).
    var obFam = getInstrumentFamilyMap_(ss);
    if (brIdx !== -1 && finalBand)
      membersSheet.getRange(mRow, brIdx + 1).setValue(resolveRoleForStorage_("Band", finalBand, obFam).role);
    if (orIdx !== -1 && finalOrch)
      membersSheet.getRange(mRow, orIdx + 1).setValue(resolveRoleForStorage_("Orchestra", finalOrch, obFam).role);
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
 * Assembles: intro quote + person block + plug-and-play brand footer.
 * or a minimal text signature if nothing is found.
 *
 * Signatures sheet layout:
 *   Key | Name | Title | Email | Phone
 *   general | Strathmore Chorale | Attendance System | chorale@... |
 *   chairperson | Raphael K. | Chairperson | raphael@... | +254...
 */

// -------------------------------------------------------
//  SIGNATURE SYSTEM (§3) — three layers:
//    1. Intro quote      — fixed, same for everyone (constant below)
//    2. Person block     — per "Sign as" pick, from the Signatures sheet
//    3. Brand/year footer— logo, address, socials, Theme-of-the-Year banner.
//       PLUG-AND-PLAY: paste next year's approved footer into the Apps Script
//       HTML file "SignatureFooter" (or set Config cell key signatureFooterHtml)
//       and every signature updates. Nothing else changes.
// -------------------------------------------------------
var SIGNATURE_INTRO_HTML =
  '<p style="margin:14px 0 12px;font-family:Georgia,\'Times New Roman\',serif;font-style:italic;' +
  'font-size:13px;line-height:1.6;color:#6B6058;">' +
  '\u201CStrathmore Chorale is a choral and instrumental group that offers a platform for ' +
  'performance, using music as the main medium, within Strathmore University and the adjacent ' +
  'community at large. We are a mixed choir which gives different singing and playing ' +
  'opportunities to those with an interest in Music and performing arts.\u201D</p>';

/** Reads one person's signature fields from the Signatures sheet. */
function getSignaturePerson_(key) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(SIGNATURES_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return null;
  var data = sheet.getDataRange().getValues();
  var h = data[0].map(function (x) { return x.toString().trim().toLowerCase(); });
  var ki = h.indexOf("key"), ni = h.indexOf("name"), ti = h.indexOf("title"),
      ei = h.indexOf("email"), pi = h.indexOf("phone");
  if (ki === -1) return null;
  for (var i = 1; i < data.length; i++) {
    if (data[i][ki].toString().trim().toLowerCase() === String(key || "").toLowerCase()) {
      return {
        key: data[i][ki].toString().trim(),
        name:  ni !== -1 ? data[i][ni].toString() : "",
        title: ti !== -1 ? data[i][ti].toString() : "",
        email: ei !== -1 ? data[i][ei].toString() : "",
        phone: pi !== -1 ? data[i][pi].toString() : ""
      };
    }
  }
  return null;
}

/** Renders the per-person block — Name + Title only. Contact lives in the footer. */
function renderPersonBlock_(p) {
  if (!p) return "";
  var BLUE = "#0b5394", BLUE2 = "#385CAD";
  var h = '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 12px;">' +
          '<tr><td style="font-family:Arial,Helvetica,sans-serif;">';
  if (p.name)  h += '<div style="font-size:15px;font-weight:bold;color:' + BLUE + ';">' + p.name + '</div>';
  if (p.title) h += '<div style="font-size:12px;font-weight:bold;color:#2A2522;margin-top:2px;">' +
                    p.title + ' | <a style="color:' + BLUE2 + ';text-decoration:none;">Strathmore Chorale</a></div>';
  h += '</td></tr></table>';
  return h;
}

/**
 * Plug-and-play brand/year footer. Swap once a year (SignatureFooter HTML file,
 * or Config cell key "signatureFooterHtml"). Fills the per-person contact tokens
 * {{mobile}} / {{email}} from the same person record used by the person block.
 */
function getSignatureFooterHtml_(person) {
  var raw = "";
  try { raw = HtmlService.createHtmlOutputFromFile("SignatureFooter").getContent(); } catch (e) {}
  if (!raw) {
    try {
      var ss = getSpreadsheet_(), sheet = ss.getSheetByName(CONFIG_SHEET);
      if (sheet && sheet.getLastRow() > 1) {
        var data = sheet.getDataRange().getValues();
        for (var i = 1; i < data.length && !raw; i++) {
          for (var c = 0; c < data[i].length - 1; c++) {
            if (data[i][c].toString().trim() === "signatureFooterHtml") { raw = data[i][c + 1].toString(); break; }
          }
        }
      }
    } catch (e2) {}
  }
  if (!raw) return "";

  // Use only the content between the <!--FOOTER--> markers when present.
  var m = raw.match(/<!--FOOTER-->([\s\S]*?)<!--\/FOOTER-->/i);
  var footer = m ? m[1] : raw;

  var phone = person && person.phone ? person.phone : "";
  var email = person && person.email ? person.email : "";
  footer = footer.replace(/\{\{\s*mobile\s*\}\}/g, phone)
                 .replace(/\{\{\s*email\s*\}\}/g, email);
  // No phone → drop the whole "Mobile:" line (tag may carry attributes)
  if (!phone) footer = footer.replace(/<strong[^>]*>Mobile:<\/strong>[\s\S]*?<br[^>]*>/i, "");
  return footer;
}

function getSignatureHtml_(key) {
  key = key || "general";
  var person = getSignaturePerson_(key);
  var intro  = SIGNATURE_INTRO_HTML;
  // ONE signature system for everyone (including "general"):
  // intro + person block (name/title) + plug-and-play footer (contact + brand).
  return intro + renderPersonBlock_(person) + getSignatureFooterHtml_(person);
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
  var options = [{ key: "general", label: "General (automated)", name: "", title: "", email: "", phone: "" }];
  if (!sheet || sheet.getLastRow() < 2) return options;
  var data = sheet.getDataRange().getValues();
  var h = data[0].map(function (x) { return x.toString().trim().toLowerCase(); });
  var ki = h.indexOf("key"), ni = h.indexOf("name"), ti = h.indexOf("title"),
      ei = h.indexOf("email"), pi = h.indexOf("phone");
  if (ki === -1) return options;
  for (var i = 1; i < data.length; i++) {
    var key = data[i][ki].toString().trim();
    if (!key || key.toLowerCase() === "general") continue;
    var name  = ni !== -1 ? data[i][ni].toString() : key;
    var title = ti !== -1 ? data[i][ti].toString() : "";
    options.push({
      key: key,
      label: name + (title ? " — " + title : ""),
      name: name, title: title,
      email: ei !== -1 ? data[i][ei].toString() : "",
      phone: pi !== -1 ? data[i][pi].toString() : ""
    });
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
  var access = getAccess_(ss);
  if (access.level < ROLE_LEVELS.elevated) throw new Error("Admin access required.");
  var inScope = scopeMemberPredicate_(access, ss);

  var groups = (access.level >= ROLE_LEVELS.admin) ? GROUPS.slice() : (access.allowedSections || []).slice();
  var members = readAllMembers_(ss)
    .filter(function (m) { return m.active && m.email && inScope(m); })
    .map(function (m) { return { name: m.name, email: m.email, groups: m.groups }; })
    .sort(function (a, b) { return a.name.localeCompare(b.name); });

  return {
    groups: groups,
    members: members,
    signatures: getSignatureOptions(),
    canSendAll: access.level >= ROLE_LEVELS.admin
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

// =======================================================
//  COMMUNIQUÉ ATTACHMENTS
//  Files live in Drive; the payload carries file IDs (so scheduled sends still
//  work — a blob can't be stored in a sheet). Two delivery modes:
//    "attach" — real email attachment (small files, Gmail caps at 25MB/message)
//    "link"   — a styled link block appended to the body (no size ceiling)
//  Mode is auto-picked by size, and FORCED to "link" when a personalised send
//  (name tokens => one email per recipient) would blow the 6-minute execution
//  budget. getCommuniquePlan() lets the UI disclose this before sending.
// =======================================================
var ATTACH_MAX_TOTAL_MB      = 20;   // hard cap for real attachments (Gmail ~25MB)
var ATTACH_PERSONALISED_BUDGET = 150; // recipients × MB — beyond this, force link mode

function getAttachmentFolder_() {
  var id = (ATTACHMENT_FOLDER_ID && ATTACHMENT_FOLDER_ID !== "YOUR_ATTACHMENT_FOLDER_ID_HERE")
             ? ATTACHMENT_FOLDER_ID : PHOTO_FOLDER_ID;
  if (!id || id === "YOUR_FOLDER_ID_HERE") throw new Error("No Drive folder configured for attachments.");
  return DriveApp.getFolderById(id);
}

/**
 * Uploads one attachment from the composer. Client sends base64 (which inflates
 * ~33%), so keep individual files modest — larger files still work in link mode.
 * @returns {Object} { id, name, mimeType, sizeBytes, sizeMB, url }
 */
function uploadCommuniqueAttachment(fileName, mimeType, base64Data) {
  var access = getAccess_(getSpreadsheet_());
  if (access.level < ROLE_LEVELS.elevated) throw new Error("Admin access required.");
  if (!fileName || !base64Data) throw new Error("Missing file data.");
  var bytes = Utilities.base64Decode(base64Data);
  var blob = Utilities.newBlob(bytes, mimeType || "application/octet-stream", fileName);
  var file = getAttachmentFolder_().createFile(blob);
  // Public link access, per policy — link mode must be openable by any recipient.
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}
  var size = file.getSize();
  return {
    id: file.getId(), name: file.getName(), mimeType: file.getMimeType(),
    sizeBytes: size, sizeMB: Math.round((size / 1048576) * 100) / 100,
    url: file.getUrl()
  };
}

/** Removes an uploaded attachment (before send, or on cancel). */
function deleteCommuniqueAttachment(fileId) {
  var access = getAccess_(getSpreadsheet_());
  if (access.level < ROLE_LEVELS.elevated) throw new Error("Admin access required.");
  try { DriveApp.getFileById(fileId).setTrashed(true); } catch (e) {}
  return { success: true };
}

/** Reads stored attachment file IDs into metadata (skips anything deleted). */
function readAttachmentMeta_(attachments) {
  var out = [];
  (attachments || []).forEach(function (a) {
    var id = (typeof a === "string") ? a : a.id;
    if (!id) return;
    try {
      var f = DriveApp.getFileById(id);
      var size = f.getSize();
      out.push({ id: id, name: f.getName(), url: f.getUrl(),
                 sizeBytes: size, sizeMB: size / 1048576, file: f });
    } catch (e) { /* deleted — silently skip */ }
  });
  return out;
}

/**
 * Decides how attachments will be delivered.
 * @returns {Object} { mode, totalMB, files:[{name,url,sizeMB}], reason, forced }
 */
function planAttachments_(metas, recipientCount, personalised) {
  var totalMB = 0;
  metas.forEach(function (m) { totalMB += m.sizeMB; });
  totalMB = Math.round(totalMB * 100) / 100;
  var plan = { mode: "attach", totalMB: totalMB, forced: false, reason: "",
               files: metas.map(function (m) { return { name: m.name, url: m.url, sizeMB: Math.round(m.sizeMB*100)/100 }; }) };
  if (!metas.length) { plan.mode = "none"; return plan; }

  if (totalMB > ATTACH_MAX_TOTAL_MB) {
    plan.mode = "link"; plan.forced = true;
    plan.reason = "Total size " + totalMB + "MB exceeds the " + ATTACH_MAX_TOTAL_MB + "MB attachment limit — sending as a Drive link.";
    return plan;
  }
  if (personalised && (recipientCount * totalMB) > ATTACH_PERSONALISED_BUDGET) {
    plan.mode = "link"; plan.forced = true;
    plan.reason = "Personalised messages send one email per recipient. " + recipientCount +
                  " recipients × " + totalMB + "MB would exceed the execution limit — sending as a Drive link instead.";
    return plan;
  }
  return plan;
}

/** Appends a styled "Attachments" block with Drive links to the email body. */
function attachmentLinkBlockHtml_(files) {
  if (!files || !files.length) return "";
  var rows = files.map(function (f) {
    return '<tr><td style="padding:6px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;">' +
           '<a href="' + f.url + '" style="color:#0b5394;text-decoration:none;font-weight:bold;">' + f.name + '</a>' +
           '<span style="color:#8C8478;"> &nbsp;·&nbsp; ' + f.sizeMB + ' MB</span></td></tr>';
  }).join("");
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 4px;">' +
         '<tr><td style="border-top:1px solid #E8DEC6;padding-top:14px;">' +
         '<p style="margin:0 0 6px;font-family:\'Courier New\',Courier,monospace;font-size:11px;letter-spacing:2px;' +
         'text-transform:uppercase;color:#B08538;">Attachments</p>' +
         '<table role="presentation" cellpadding="0" cellspacing="0" border="0">' + rows + '</table>' +
         '</td></tr></table>';
}

/**
 * PREVIEW — tells the composer what will happen before sending, so the UI can
 * disclose a forced link-mode switch rather than silently swapping.
 * @returns { recipientCount, personalised, attachmentMode, totalMB, forced, reason, files }
 */
function getCommuniquePlan(payload) {
  var ss = getSpreadsheet_();
  var access = getAccess_(ss);
  if (access.level < ROLE_LEVELS.elevated) throw new Error("Admin access required.");
  payload = payload || {};
  var recipients = [];
  try { recipients = resolveCommuniqueRecipients_(ss, payload, access); } catch (e) {}
  var personalised = hasNameTokens_(payload.body || "");
  var metas = readAttachmentMeta_(payload.attachments);
  var plan = planAttachments_(metas, recipients.length, personalised);
  return {
    recipientCount: recipients.length,
    personalised: personalised,
    attachmentMode: plan.mode,
    totalMB: plan.totalMB,
    forced: plan.forced,
    reason: plan.reason,
    files: plan.files
  };
}

// =======================================================
//  SCHEDULED COMMUNIQUÉS (hybrid: durable queue + one-time triggers)
//  A row in "Scheduled Emails" is the source of truth. A 5-min checker sends
//  anything due (the resilient net). Sends within the next horizon ALSO get a
//  one-time trigger for near-exact (~±1min) timing. Fires as the scheduler,
//  from their quota, on the day — same access checks as an immediate send.
// =======================================================
var SCHEDULE_PRECISION_HORIZON_MIN = 60;  // within this window, add a precise one-time trigger
var SCHEDULE_MAX_ONETIME_TRIGGERS  = 15;  // stay well under the 20-trigger project cap

function ensureScheduledSheet_(ss) {
  var sheet = ss.getSheetByName(SCHEDULED_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(SCHEDULED_SHEET);
    sheet.appendRow(["ID","Send At","Status","Scheduled By","Scheduled By Email","Subject","Created At","Sent At","Result","Payload JSON"]);
    sheet.getRange(1,1,1,10).setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  return sheet;
}
function scheduledColMap_(sheet) {
  var h = sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0].map(function(x){return x.toString().trim().toLowerCase();});
  return { id:h.indexOf("id"), sendAt:h.indexOf("send at"), status:h.indexOf("status"),
           by:h.indexOf("scheduled by"), byEmail:h.indexOf("scheduled by email"),
           subject:h.indexOf("subject"), created:h.indexOf("created at"),
           sentAt:h.indexOf("sent at"), result:h.indexOf("result"), payload:h.indexOf("payload json") };
}

/**
 * Schedule a communiqué. Validates recipients/scope NOW (so bad sends fail fast),
 * stores the payload, and — if the send is soon — drops a precise one-time trigger.
 * @param {Object} payload — same shape as sendCommunique's, PLUS sendAt (ISO string or ms).
 */
function scheduleCommunique(payload) {
  var ss = getSpreadsheet_();
  var access = getAccess_(ss);
  if (access.level < ROLE_LEVELS.elevated) throw new Error("Admin access required.");
  if (!payload || !payload.sendAt) throw new Error("A send time is required.");
  if (!payload.subject || !payload.subject.trim()) throw new Error("Subject is required.");
  if (!payload.body || !String(payload.body).replace(/<[^>]*>/g,"").trim())
    throw new Error("Message body is required.");
  if (payload.recipientType === "all" && access.level < ROLE_LEVELS.admin)
    throw new Error("Only full admins can send to all members.");

  var when = new Date(payload.sendAt);
  if (isNaN(when.getTime())) throw new Error("Invalid send time.");
  if (when.getTime() < Date.now() + 60 * 1000) throw new Error("Please schedule at least a minute in the future.");

  // Validate scope/recipients up front — fail now, not silently at fire time.
  var recips = resolveCommuniqueRecipients_(ss, payload, access);
  if (!recips.length) throw new Error("No recipients matched your selection.");

  var sheet = ensureScheduledSheet_(ss);
  var id = "sch_" + Date.now() + "_" + Math.floor(Math.random() * 1e4);
  var email = access.email;
  // Store payload WITHOUT sendAt duplication noise but keep everything needed to send.
  var stored = {
    subject: payload.subject, body: payload.body, format: payload.format || "html",
    signatureKey: payload.signatureKey || "general", recipientType: payload.recipientType || "all",
    groups: payload.groups || [], emails: payload.emails || [], ccAdmins: !!payload.ccAdmins,
    // Store file IDs only — blobs are fetched from Drive at fire time.
    attachments: (payload.attachments || []).map(function (a) {
      return { id: (typeof a === "string") ? a : a.id, name: a.name || "" };
    })
  };
  sheet.appendRow([id, when, "Scheduled", access.name || email, email, payload.subject,
                   new Date(), "", "", JSON.stringify(stored)]);

  // Near-exact: if it's within the horizon, add a one-time trigger now.
  maybeAddPreciseTrigger_(id, when);
  return { success: true, id: id, sendAt: when.toISOString(), recipientCount: recips.length };
}

/** Adds a one-time trigger for a specific scheduled item if it's within the horizon and under the cap. */
function maybeAddPreciseTrigger_(id, when) {
  var mins = (when.getTime() - Date.now()) / 60000;
  if (mins > SCHEDULE_PRECISION_HORIZON_MIN) return false; // the 5-min checker will pick it up later
  var oneTimeCount = ScriptApp.getProjectTriggers().filter(function(t){
    return t.getHandlerFunction() === "fireScheduledEmails_";
  }).length;
  if (oneTimeCount >= SCHEDULE_MAX_ONETIME_TRIGGERS) return false; // net still catches it
  try { ScriptApp.newTrigger("fireScheduledEmails_").timeBased().at(when).create(); return true; }
  catch (e) { Logger.log("precise trigger failed: " + e); return false; }
}

/**
 * Fires due scheduled emails. Called by BOTH the 5-min checker and one-time triggers.
 * Sends anything with status "Scheduled" whose Send At <= now. Idempotent via status flip.
 */
function fireScheduledEmails_() {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(SCHEDULED_SHEET);
  if (!sheet || sheet.getLastRow() < 2) { cleanupOneTimeTriggers_(); return; }
  var c = scheduledColMap_(sheet);
  var data = sheet.getDataRange().getValues();
  var now = Date.now();

  for (var i = 1; i < data.length; i++) {
    if (data[i][c.status].toString() !== "Scheduled") continue;
    var when = new Date(data[i][c.sendAt]);
    if (isNaN(when.getTime()) || when.getTime() > now) continue;

    // Claim the row first (idempotency — two triggers can't double-send)
    sheet.getRange(i + 1, c.status + 1).setValue("Sending");
    SpreadsheetApp.flush();

    var payload, result = "", ok = false;
    try { payload = JSON.parse(data[i][c.payload].toString()); }
    catch (e) { sheet.getRange(i + 1, c.status + 1).setValue("Failed");
                sheet.getRange(i + 1, c.result + 1).setValue("Corrupt payload"); continue; }

    try {
      // Triggers have no active session — resolve access for the ORIGINAL scheduler
      // so their role/scope is what governs the send.
      var schedulerEmail = data[i][c.byEmail].toString();
      var schedulerAccess = getAccess_(ss, schedulerEmail);
      if (schedulerAccess.level < ROLE_LEVELS.elevated) {
        throw new Error("The scheduler (" + schedulerEmail + ") no longer has permission to send this.");
      }
      var r = sendCommuniqueAs_(ss, payload, schedulerAccess); // same scope/quota/personalisation logic
      ok = true;
      result = r.personalized ? ("Sent to " + r.count + " (personalised)") : ("Sent (BCC blast)");
    } catch (e2) {
      result = "Failed: " + e2.message;
      // Notify the scheduler so a quota/scope failure isn't silent
      try {
        MailApp.sendEmail({ to: data[i][c.byEmail].toString(),
          subject: "Scheduled email did not send — " + data[i][c.subject],
          htmlBody: buildEmail_("<p>Your scheduled message <b>" + data[i][c.subject] +
            "</b> could not be sent:</p><p>" + e2.message + "</p><p>You can reschedule it from the app.</p>",
            { headerTitle: "Scheduled Send Failed", signatureKey: "general" }), name: EMAIL_FROM_NAME });
      } catch (e3) {}
    }
    sheet.getRange(i + 1, c.status + 1).setValue(ok ? "Sent" : "Failed");
    sheet.getRange(i + 1, c.sentAt + 1).setValue(new Date());
    sheet.getRange(i + 1, c.result + 1).setValue(result);
  }
  cleanupOneTimeTriggers_();
}

/** Deletes spent one-time fire triggers (keeps the project well under the 20 cap). */
function cleanupOneTimeTriggers_() {
  // A one-time trigger only ever fires once; after firing it's dead weight. We can't
  // tell "already fired" directly, so we prune when nothing is imminently due.
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(SCHEDULED_SHEET);
  var imminent = false;
  if (sheet && sheet.getLastRow() > 1) {
    var c = scheduledColMap_(sheet), data = sheet.getDataRange().getValues(), horizon = Date.now() + SCHEDULE_PRECISION_HORIZON_MIN*60000;
    for (var i = 1; i < data.length; i++) {
      if (data[i][c.status].toString() === "Scheduled") {
        var w = new Date(data[i][c.sendAt]).getTime();
        if (w <= horizon) { imminent = true; break; }
      }
    }
  }
  if (imminent) return; // keep triggers; something's about to fire
  // Only prune one-time FIRE triggers (handler fireScheduledEmails_). The recurring
  // 5-minute net uses a DIFFERENT handler (scheduledEmailCheck_) and is never touched.
  ScriptApp.getProjectTriggers().forEach(function(t){
    if (t.getHandlerFunction() === "fireScheduledEmails_") {
      try { ScriptApp.deleteTrigger(t); } catch(e){}
    }
  });
}

/** ADMIN/rep — list scheduled emails. Admins see all; reps/section admins see their own. */
function getScheduledEmails() {
  var ss = getSpreadsheet_();
  var access = getAccess_(ss);
  if (access.level < ROLE_LEVELS.elevated) throw new Error("Admin access required.");
  var sheet = ss.getSheetByName(SCHEDULED_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return [];
  var c = scheduledColMap_(sheet), data = sheet.getDataRange().getValues(), out = [];
  for (var i = 1; i < data.length; i++) {
    var byEmail = data[i][c.byEmail].toString();
    var mine = byEmail.toLowerCase() === access.email.toLowerCase();
    if (access.level < ROLE_LEVELS.admin && !mine) continue; // reps see only their own
    var when = new Date(data[i][c.sendAt]);
    out.push({
      id: data[i][c.id].toString(),
      sendAt: isNaN(when.getTime()) ? "" : when.toISOString(),
      status: data[i][c.status].toString(),
      scheduledBy: data[i][c.by].toString(),
      subject: data[i][c.subject].toString(),
      result: data[i][c.result].toString(),
      canCancel: (data[i][c.status].toString() === "Scheduled") && (access.level >= ROLE_LEVELS.admin || mine)
    });
  }
  out.sort(function(a,b){ return (a.sendAt||"").localeCompare(b.sendAt||""); });
  return out;
}

/** Cancel a scheduled email (admins any; reps only their own). */
function cancelScheduledEmail(id) {
  var ss = getSpreadsheet_();
  var access = getAccess_(ss);
  if (access.level < ROLE_LEVELS.elevated) throw new Error("Admin access required.");
  var sheet = ss.getSheetByName(SCHEDULED_SHEET);
  if (!sheet) throw new Error("No scheduled emails.");
  var c = scheduledColMap_(sheet), data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][c.id].toString() !== id) continue;
    if (data[i][c.status].toString() !== "Scheduled") throw new Error("This email can no longer be cancelled.");
    var mine = data[i][c.byEmail].toString().toLowerCase() === access.email.toLowerCase();
    if (access.level < ROLE_LEVELS.admin && !mine) throw new Error("You can only cancel your own scheduled emails.");
    sheet.getRange(i + 1, c.status + 1).setValue("Cancelled");
    sheet.getRange(i + 1, c.result + 1).setValue("Cancelled by " + (access.name || access.email));
    return { success: true };
  }
  throw new Error("Scheduled email not found.");
}

/** One-time setup — creates the recurring 5-minute checker. Run from the editor. */
function setupScheduledEmailChecker() {
  ScriptApp.getProjectTriggers().forEach(function(t){
    if (t.getHandlerFunction() === "scheduledEmailCheck_") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("scheduledEmailCheck_").timeBased().everyMinutes(5).create();
  return "Scheduled-email checker created (every 5 minutes).";
}

/** The recurring net — separate handler so cleanup never deletes it. */
function scheduledEmailCheck_() { fireScheduledEmails_(); }

function sendCommunique(payload) {
  var ss = getSpreadsheet_();
  return sendCommuniqueAs_(ss, payload, getAccess_(ss));
}

/**
 * Internal core — sends using an EXPLICIT access context rather than the live
 * session. Scheduled sends run inside a trigger (no session), so they resolve the
 * original scheduler's access and pass it in here. All scope rules still apply.
 */
function sendCommuniqueAs_(ss, payload, access) {
  if (!access || access.level < ROLE_LEVELS.elevated) throw new Error("Admin access required.");
  if (!payload.subject || !payload.subject.trim()) throw new Error("Subject is required.");
  if (!payload.body || !String(payload.body).replace(/<[^>]*>/g, "").trim())
    throw new Error("Message body is required.");
  if (payload.recipientType === "all" && access.level < ROLE_LEVELS.admin)
    throw new Error("Only full admins can send to all members.");

  var recipients = resolveCommuniqueRecipients_(ss, payload, access); // [{email,name}], scoped
  if (!recipients.length) throw new Error("No recipients matched your selection.");

  var ccAdmins = "";
  if (payload.ccAdmins) {
    var admins = getAdminEmails_(ss);
    if (admins.length > 0) ccAdmins = admins.join(",");
  }

  var personalised = hasNameTokens_(payload.body);

  // Attachments: decide delivery mode (may be FORCED to link — see planAttachments_)
  var metas = readAttachmentMeta_(payload.attachments);
  var plan = planAttachments_(metas, recipients.length, personalised);
  var linkBlock = (plan.mode === "link") ? attachmentLinkBlockHtml_(plan.files) : "";
  var blobs = [];
  if (plan.mode === "attach") {
    metas.forEach(function (m) { try { blobs.push(m.file.getBlob()); } catch (e) {} });
  }

  function makeHtml(bodyText) {
    return buildEmail_(communiqueBodyToSafeHtml_(bodyText, payload.format) + linkBlock, {
      headerTitle: payload.subject,
      signatureKey: payload.signatureKey || "general"
    });
  }

  // No personalisation -> one efficient BCC blast (unchanged behaviour)
  if (!personalised) {
    var res = sendBulkBcc_(recipients.map(function (r) { return r.email; }),
                           payload.subject, makeHtml(payload.body),
                           { cc: ccAdmins, attachments: blobs });
    res.attachmentMode = plan.mode;
    res.attachmentNote = plan.reason;
    return res;
  }

  // Personalised -> one send per recipient. Check quota up front rather than half-send.
  var remaining = MailApp.getRemainingDailyQuota();
  if (recipients.length > remaining) {
    throw new Error("Not enough email quota today: need " + recipients.length +
                    ", only " + remaining + " left.");
  }
  for (var i = 0; i < recipients.length; i++) {
    var mail = {
      to: recipients[i].email,
      subject: payload.subject,
      htmlBody: makeHtml(fillNameTokens_(payload.body, recipients[i].name)),
      name: EMAIL_FROM_NAME
    };
    if (ccAdmins && i === 0) mail.cc = ccAdmins;
    if (blobs.length) mail.attachments = blobs;
    MailApp.sendEmail(mail);
  }
  return { success: true, count: recipients.length, personalized: true,
           attachmentMode: plan.mode, attachmentNote: plan.reason };
}

/** Resolves the scoped recipient list as [{email, name}] — never trusts the client. */
function resolveCommuniqueRecipients_(ss, payload, access) {
  var rtype = payload.recipientType || "all";
  var inScope = scopeMemberPredicate_(access, ss);
  var out = {};
  function add(email, name) {
    if (!email) return;
    var k = email.toLowerCase();
    if (!out[k]) out[k] = { email: email, name: name || "" };
  }

  if (rtype === "admins") {
    var nameBy = {};
    readAllMembers_(ss).forEach(function (m) { if (m.email) nameBy[m.email.toLowerCase()] = m.name; });
    getAdminEmails_(ss).forEach(function (e) { add(e, nameBy[e.toLowerCase()] || ""); });
    return Object.keys(out).map(function (k) { return out[k]; });
  }

  var allowed = access.allowedSections || [];
  readAllMembers_(ss).forEach(function (m) {
    if (!m.active || !m.email) return;
    if (m.probation && m.probationFailed) return;
    if (access.level < ROLE_LEVELS.admin && !inScope(m)) return; // section / rep-group scope
    if (rtype === "all") {
      add(m.email, m.name);
    } else if (rtype === "groups") {
      var gs = (payload.groups || []).filter(function (g) {
        return access.level >= ROLE_LEVELS.admin || allowed.indexOf(g) !== -1;
      });
      if (m.groups.some(function (g) { return gs.indexOf(g) !== -1; })) add(m.email, m.name);
    } else if (rtype === "individuals") {
      if ((payload.emails || []).indexOf(m.email) !== -1) add(m.email, m.name);
    }
  });
  return Object.keys(out).map(function (k) { return out[k]; });
}

/**
 * Converts plain text (with line breaks) into safe HTML paragraphs.
 * Double newline = new paragraph; single newline = <br>.
 */

// -------------------------------------------------------
//  COMMUNIQUÉ HELPERS — name tokens (§1) + rich text (§2)
// -------------------------------------------------------
var COMMUNIQUE_NAME_TOKENS = /\{\s*(first|last|full)\s*name\s*\}/gi;

/** True if the body contains any {first name} / {last name} / {full name} token. */
function hasNameTokens_(text) {
  return /\{\s*(first|last|full)\s*name\s*\}/i.test(String(text || ""));
}

/** Replaces name tokens with this recipient's own name. Unknown name -> "there". */
function fillNameTokens_(text, fullName) {
  var parts = String(fullName || "").trim().split(/\s+/).filter(String);
  var first = parts[0] || "there";
  var last  = parts.length > 1 ? parts[parts.length - 1] : first;
  var full  = fullName || first;
  return String(text).replace(/\{\s*(first|last|full)\s*name\s*\}/gi, function (m, which) {
    which = which.toLowerCase();
    return which === "first" ? first : (which === "last" ? last : full);
  });
}

/**
 * Allowlist sanitiser for admin-authored rich text. Apps Script has no DOM, so this
 * is a regex pass: strip script/style blocks, event handlers, javascript: hrefs, and
 * any tag outside the allowlist (keeping its inner text).
 */
function sanitizeEmailHtml_(html) {
  var s = String(html || "");
  s = s.replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "");
  s = s.replace(/<\s*(script|style)[^>]*>/gi, "");
  s = s.replace(/\son\w+\s*=\s*"[^"]*"/gi, "").replace(/\son\w+\s*=\s*'[^']*'/gi, "");
  s = s.replace(/\son\w+\s*=\s*[^\s>]+/gi, "");
  s = s.replace(/(href\s*=\s*["']?)\s*javascript:[^"'>\s]*/gi, "$1#");
  var ALLOWED = ["p","br","b","strong","i","em","u","ul","ol","li","a","span","div"];
  s = s.replace(/<\s*\/?\s*([a-zA-Z0-9]+)([^>]*)>/g, function (tag, name, attrs) {
    if (ALLOWED.indexOf(name.toLowerCase()) === -1) return "";
    // keep only href/style on allowed tags
    var kept = "";
    var href = /href\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i.exec(attrs);
    if (href && name.toLowerCase() === "a") kept += " href=" + href[1];
    var style = /style\s*=\s*("[^"]*"|'[^']*')/i.exec(attrs);
    if (style) kept += " style=" + style[1];
    return tag.indexOf("</") === 0 ? "</" + name + ">" : "<" + name + kept + ">";
  });
  return s;
}

/** Branches on format: HTML from the rich editor, or legacy plain text. */
function communiqueBodyToSafeHtml_(body, format) {
  if (format === "html") return sanitizeEmailHtml_(body);
  return communiqueBodyToHtml_(body);
}

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
  if (sheet.getLastRow() < 2 || sheet.getLastColumn() === 0) return [];
  var data = sheet.getDataRange().getValues();
  // Email column by HEADER (fall back to column 1), so reordering can't break alerts
  var headers = data[0].map(function(x){ return x.toString().trim().toLowerCase(); });
  var eIdx = headers.indexOf("email"); if (eIdx === -1) eIdx = 0;
  var emails = [];
  for (var i = 1; i < data.length; i++) {
    var e = data[i][eIdx].toString().trim();
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
    if (opts.attachments && opts.attachments.length) mail.attachments = opts.attachments;
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

var CELEBRATE_STATUSES = ["Active", "Alumnus", "On Hiatus"];   // hiatus members still celebrated; never "Memorial"/"Left"
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

  // Profile photos live in the MEMBERS sheet, passport photos in Member Details.
  // Posters prefer the PROFILE photo: it is the image the member chose to represent
  // themselves, which suits a celebratory poster better than an administrative ID
  // photo collected at onboarding. Passport is the fallback, then no photo at all.
  var profileByName = {}, profileByEmail = {};
  try {
    var msh = ss.getSheetByName(MEMBERS_SHEET);
    if (msh && msh.getLastRow() > 1) {
      var mv = msh.getDataRange().getValues();
      var mh = mv[0].map(function (x) { return x.toString().trim().toLowerCase(); });
      var nIdx = mh.indexOf("name"), eIdx = mh.indexOf("email"), pIdx = mh.indexOf("profile photo");
      if (pIdx !== -1) {
        for (var i = 1; i < mv.length; i++) {
          var pv = String(mv[i][pIdx] || "").trim();
          if (!pv) continue;
          if (nIdx !== -1) profileByName[String(mv[i][nIdx] || "").trim()] = pv;
          if (eIdx !== -1) profileByEmail[String(mv[i][eIdx] || "").trim().toLowerCase()] = pv;
        }
      }
    }
  } catch (e) { Logger.log("profile photo lookup: " + e); }

  return values.map(function (r) {
    var nm = String(r[idx[MD_NAME_COL]]  || "").trim();
    var em = String(r[idx[MD_EMAIL_COL]] || "").trim();
    var passport = idx[MD_PHOTO_COL] != null ? String(r[idx[MD_PHOTO_COL]] || "").trim() : "";
    var profile  = profileByName[nm] || (em ? profileByEmail[em.toLowerCase()] : "") || "";
    return {
      name:   nm,
      email:  em,
      dobRaw: idx[MD_DOB_COL] != null ? r[idx[MD_DOB_COL]] : "",
      profilePhoto:  profile,                     // member-chosen (Members sheet)
      passportPhoto: passport,                    // onboarding ID photo (Member Details)
      photo:  profile || passport || "",          // resolved: profile -> passport -> none
      photoSource: profile ? "profile" : (passport ? "passport" : "none"),
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
                   photo: mem.photo, profilePhoto: mem.profilePhoto,
                   passportPhoto: mem.passportPhoto, photoSource: mem.photoSource,
                   age: bdAge_(dob, ref), daysAway: off });
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
  // Order: PROFILE photo (member-chosen) -> PASSPORT photo (onboarding ID) -> none.
  // Both are resolved by bdReadMembers_, so no per-member sheet scan is needed here.
  // Each candidate is tried in turn, so a broken/deleted profile file still falls
  // through to the passport rather than producing a photoless poster.
  var candidates = [];
  if (mem.profilePhoto)  candidates.push(mem.profilePhoto);
  if (mem.passportPhoto) candidates.push(mem.passportPhoto);
  if (!candidates.length && mem.photo) candidates.push(mem.photo); // legacy callers

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
  try { dailySchemaCheck_(); } catch (e) { Logger.log("Schema check: " + e); }
  try { autoCloseUnneededApologies_(getSpreadsheet_()); } catch (e) { Logger.log("Apology cleanup: " + e); }
  try { syncConsecutiveAuOffenses_(getSpreadsheet_()); } catch (e) { Logger.log("AU sweep: " + e); }
  try { syncAutomaticRewards_(getSpreadsheet_()); } catch (e) { Logger.log("Reward sweep: " + e); }
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
      var blob = generateBirthdayPoster_(mem);
      // Use the blob's ACTUAL type — forcing ".png" onto a PDF fallback produced
      // files that would not open. Name/extension now follow the real content.
      var ctype = blob.getContentType() || "";
      var isPng = ctype.indexOf("png") !== -1;
      var ext = isPng ? ".png" : ".pdf";
      var file = DriveApp.createFile(blob).setName("Birthday Poster - " + mem.name + ext);
      try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch(e) {}
      return {
        success: true, url: file.getUrl(), name: mem.name,
        format: isPng ? "png" : "pdf",
        downloadUrl: "https://drive.google.com/uc?export=download&id=" + file.getId(),
        note: isPng ? "" : "Exported as PDF — enable the Google Slides API advanced service for PNG posters."
      };
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
        // Force the content type — the fetched blob can arrive as octet-stream,
        // which makes the downloaded file unopenable.
        return resp.getBlob().setContentType("image/png")
                   .setName("Birthday Poster - " + name + ".png");
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
  return pdf.getBlob().setContentType("application/pdf")
            .setName("Birthday Poster - " + name + ".pdf");
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

// -------------------------------------------------------
//  MEMBERSHIP STATE (removal & rejoin)
//  Members.Status:            Active | Rejoining | Inactive
//  MemberDetails.Member Status: Active | Rejoining | Left  (also Alumnus/Memorial)
//  A member removed for 3 unexcused absences keeps ALL historical records. While
//  Inactive they are not rostered, so no further absences accrue and their points
//  sit frozen ("banked"). Passing a re-entry probation restores them to Active and
//  their banked history counts again, with the new probation attendance on top.
// -------------------------------------------------------
var MEMBERS_REMOVED_ON_COL = "Removed On";

/**
 * Writes a value, surviving a stale data-validation rule on the target cell.
 * Status columns often carry a dropdown from before new states existed (e.g. a
 * Status list of only Active/Inactive rejects "Rejoining"). A reject-input rule
 * makes setValue THROW, which previously left records half-updated. On failure we
 * relax that one cell to warn-only and retry, so a write is never lost.
 */
function safeSetValue_(sheet, row, col, value) {
  var range = sheet.getRange(row, col);
  try {
    range.setValue(value);
    SpreadsheetApp.flush();
    return true;
  } catch (e) {
    try {
      var rule = range.getDataValidation();
      if (rule) {
        range.setDataValidation(rule.copy().setAllowInvalid(true).build());
      } else {
        range.clearDataValidations();
      }
      range.setValue(value);
      SpreadsheetApp.flush();
      Logger.log("safeSetValue_: relaxed validation on " + sheet.getName() +
                 " r" + row + "c" + col + " to write \"" + value + "\"");
      return true;
    } catch (e2) {
      Logger.log("safeSetValue_ FAILED on " + sheet.getName() + " r" + row + "c" + col + ": " + e2);
      throw e2;
    }
  }
}

/** Reads a status list from a Config sheet column (the single source of truth). */
function getConfigStatusList_(headerName) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(CONFIG_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return [];
  var data = sheet.getDataRange().getValues();
  var h = data[0].map(function (x) { return x.toString().trim().toLowerCase(); });
  var idx = h.indexOf(headerName.toLowerCase());
  if (idx === -1) return [];
  var out = [];
  for (var i = 1; i < data.length; i++) {
    var v = data[i][idx] ? data[i][idx].toString().trim() : "";
    if (v && out.indexOf(v) === -1) out.push(v);
  }
  return out;
}

// Every status the system itself can WRITE. The Config lists must contain these,
// or a write will be rejected by the dropdown.
var REQUIRED_MEMBER_SHEET_STATUSES = ["Active", "Inactive", "Rejoining"];
var REQUIRED_MEMBER_DETAIL_STATUSES = ["Active", "Rejoining", "On Hiatus", "Left"];

/**
 * DIAGNOSTIC — checks the Config status lists cover every state the system can
 * produce. A missing value means that transition will throw when it writes.
 * Writes nothing.
 */
function validateStatusConfig() {
  var sheetList = getConfigStatusList_("Member Sheet Status");
  var detailList = getConfigStatusList_("Member Statuses");
  var problems = [];
  function check(label, list, required) {
    if (!list.length) { problems.push(label + ": Config column not found or empty."); return; }
    required.forEach(function (r) {
      var found = list.some(function (v) { return v.toLowerCase() === r.toLowerCase(); });
      if (!found) problems.push(label + ': missing "' + r + '" - any transition writing it will fail.');
    });
  }
  check("Member Sheet Status", sheetList, REQUIRED_MEMBER_SHEET_STATUSES);
  check("Member Statuses", detailList, REQUIRED_MEMBER_DETAIL_STATUSES);

  var msg = "STATUS CONFIG CHECK\n\n" +
    "Member Sheet Status: " + (sheetList.join(", ") || "(empty)") + "\n" +
    "Member Statuses:     " + (detailList.join(", ") || "(empty)") + "\n\n" +
    (problems.length ? "PROBLEMS:\n  " + problems.join("\n  ")
                     : "Both lists cover every status the system writes.");
  Logger.log(msg);
  return msg;
}

/**
 * Applies the Config status lists to the sheet dropdowns. Config is the single
 * source of truth, so edit the Config columns and re-run this rather than editing
 * validation by hand. Rules are warn-only so a script write can never be blocked.
 */
function setupMembershipStatusValidation() {
  requireFullAdmin_();
  var ss = getSpreadsheet_();
  var sheetList = getConfigStatusList_("Member Sheet Status");
  var detailList = getConfigStatusList_("Member Statuses");
  var out = [];

  var mSheet = ss.getSheetByName(MEMBERS_SHEET);
  if (mSheet && sheetList.length) {
    var mmap = headerIndexMap_(mSheet);
    if (mmap["status"] != null) {
      setColumnValidation_(mSheet, mmap["status"] + 1, sheetList);
      out.push("Members.Status -> " + sheetList.join(", "));
    }
  }
  var dSheet = ss.getSheetByName(MEMBER_DETAILS_SHEET);
  if (dSheet && detailList.length) {
    var dmap = headerIndexMap_(dSheet);
    if (dmap["member status"] != null) {
      setColumnValidation_(dSheet, dmap["member status"] + 1, detailList);
      out.push("MemberDetails.Member Status -> " + detailList.join(", "));
    }
  }
  SpreadsheetApp.flush();
  var msg = (out.length ? "Dropdowns updated from Config (warn-only):\n  " + out.join("\n  ")
                        : "No Config status columns found - nothing applied.") +
            "\n\n" + validateStatusConfig();
  Logger.log(msg);
  return msg;
}

/**
 * DIAGNOSTIC — finds members left in a contradictory state, e.g. probation was
 * restarted but the membership status never flipped because a stale dropdown
 * rejected the write. Writes nothing.
 */
function findBrokenMembershipStates() {
  requireManagement_();
  var ss = getSpreadsheet_();
  var problems = [];
  readAllMembers_(ss).forEach(function (m) {
    var detail = getMemberDetailStatus_(ss, m.name);
    // On probation but not rostered: they can never complete it.
    if (m.probation && !m.probationPassed && !m.probationFailed && !m.active && detail !== "On Hiatus") {
      problems.push({ name: m.name, issue: "probation restarted but membership is inactive",
                      membersStatus: m.active ? "Active" : "Inactive", detailStatus: detail,
                      probationStart: m.probationStart, fix: "repairMembershipState(\"" + m.name + "\")" });
    }
    // Active in one sheet, gone in the other.
    if (m.active && (detail === "Left" || detail === "Memorial")) {
      problems.push({ name: m.name, issue: "active in Members but \"" + detail + "\" in Member Details",
                      membersStatus: "Active", detailStatus: detail,
                      fix: "set one of the two to match the other" });
    }
  });
  Logger.log(problems.length
    ? "Members in a contradictory state (" + problems.length + "):\n" +
      problems.map(function (p) { return "  " + p.name + " - " + p.issue + "\n      fix: " + p.fix; }).join("\n")
    : "No contradictory membership states found.");
  return problems;
}

/**
 * Completes a reinstatement that stopped half-way: the member already has a fresh
 * probation, so this just brings the two status fields into line (Rejoining).
 */
function repairMembershipState(memberName) {
  requireManagement_();
  var ss = getSpreadsheet_();
  var member = null;
  readAllMembers_(ss).forEach(function (m) { if (m.name === memberName) member = m; });
  if (!member) throw new Error("Member not found: " + memberName);
  if (!member.probation) throw new Error(memberName + " is not on probation - nothing to repair.");
  setMembershipState_(ss, memberName, "Rejoining", "Rejoining", "");
  var msg = memberName + " set to Rejoining in both sheets; existing probation (started " +
            (member.probationStart || "?") + ") left as is.";
  Logger.log(msg);
  return { success: true, name: memberName, message: msg };
}

/** Repairs every member found by findBrokenMembershipStates(). */
function repairAllBrokenMembershipStates() {
  requireFullAdmin_();
  var problems = findBrokenMembershipStates();
  var fixed = [], skipped = [];
  problems.forEach(function (p) {
    if (p.issue.indexOf("probation restarted") !== 0) { skipped.push(p.name + " (" + p.issue + ")"); return; }
    try { repairMembershipState(p.name); fixed.push(p.name); }
    catch (e) { skipped.push(p.name + ": " + e.message); }
  });
  var msg = "Repaired " + fixed.length + ": " + (fixed.join(", ") || "none") +
            (skipped.length ? "\nNeeds a manual decision: " + skipped.join(", ") : "");
  Logger.log(msg);
  return msg;
}

/** Sets a member's status in BOTH sheets. Pass null to leave one untouched. */
function setMembershipState_(ss, memberName, membersStatus, detailsStatus, removedOnDate) {
  ss = ss || getSpreadsheet_();
  // --- Members sheet ---
  var sheet = ss.getSheetByName(MEMBERS_SHEET);
  if (sheet && sheet.getLastRow() > 1) {
    var data = sheet.getDataRange().getValues();
    var h = data[0].map(function(x){ return x.toString().trim().toLowerCase(); });
    var nameIdx = h.indexOf("name"), statusIdx = h.indexOf("status");
    var remIdx = h.indexOf(MEMBERS_REMOVED_ON_COL.toLowerCase());
    if (remIdx === -1 && removedOnDate !== undefined) {
      var col = sheet.getLastColumn() + 1;
      sheet.getRange(1, col).setValue(MEMBERS_REMOVED_ON_COL).setFontWeight("bold");
      remIdx = col - 1;
    }
    for (var i = 1; i < data.length; i++) {
      if (data[i][nameIdx].toString().trim() !== memberName) continue;
      if (membersStatus && statusIdx !== -1) safeSetValue_(sheet, i + 1, statusIdx + 1, membersStatus);
      if (removedOnDate !== undefined && remIdx !== -1) safeSetValue_(sheet, i + 1, remIdx + 1, removedOnDate || "");
      break;
    }
  }
  // --- Member Details sheet ---
  if (detailsStatus) {
    var ds = ss.getSheetByName(MEMBER_DETAILS_SHEET);
    if (ds && ds.getLastRow() > 1) {
      var dmap = headerIndexMap_(ds);
      var msIdx = dmap["member status"];
      if (msIdx != null) {
        var dd = ds.getDataRange().getValues();
        for (var r = 1; r < dd.length; r++) {
          if (dd[r][0].toString().trim() === memberName) {
            safeSetValue_(ds, r + 1, msIdx + 1, detailsStatus);
            break;
          }
        }
      }
    }
  }
}

/** Emails the removed member and the admins when a 3-AU removal fires. */
function sendRemovalNotice_(ss, member) {
  var admins = getAdminEmails_(ss);
  var appUrl = APP_URL || ScriptApp.getService().getUrl();
  try {
    if (member.email) {
      var body = "<p>Hi " + member.name + ",</p>" +
        "<p>Our records show three consecutive unexcused absences, so your membership has been set to <b>inactive</b>.</p>" +
        "<p>Your attendance history and points are kept safely on file. If you would like to return, sign in and submit a " +
        "<b>rejoin request</b> — once an admin approves it you will serve a short re-entry probation, after which your previous record is restored.</p>" +
        '<p><a href="' + appUrl + '">Open the attendance system</a></p>';
      MailApp.sendEmail({ to: member.email, subject: "Your Chorale membership is now inactive",
                          htmlBody: buildEmail_(body, { headerTitle: "Membership Update", signatureKey: "general" }),
                          name: EMAIL_FROM_NAME });
    }
  } catch(e) { Logger.log("removal member email: " + e); }
  try {
    if (admins.length) {
      MailApp.sendEmail({ to: admins.join(","), subject: "Member set inactive — " + member.name,
        htmlBody: buildEmail_("<p><b>" + member.name + "</b> reached three consecutive unexcused absences and has been set to " +
          "<b>Inactive</b> (Member Status: Left). An offense was recorded. Their history is preserved; they may submit a rejoin request.</p>",
          { headerTitle: "Automatic Removal", signatureKey: "general" }), name: EMAIL_FROM_NAME });
    }
  } catch(e) { Logger.log("removal admin email: " + e); }
}

/** MEMBER — submit a request to rejoin after being set inactive. */
function requestRejoin(reason) {
  var ss = getSpreadsheet_();
  var email = Session.getActiveUser().getEmail();
  if (!email) throw new Error("Could not detect your email.");
  var member = findMemberByEmail_(ss, email.toLowerCase());
  if (!member) throw new Error("No member record found.");
  if (member.active) throw new Error("Your membership is already active.");
  var sheet = ensureApologiesSheet_(ss);
  // Block duplicate pending requests
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    var pendingType = data[i][3].toString();
    if (data[i][1].toString().trim() === member.name &&
        (pendingType === "Rejoin Request" || pendingType === "Restart Probation") &&
        data[i][8].toString() === "Pending") {
      throw new Error("You already have a request awaiting review.");
    }
  }
  var now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
  sheet.appendRow([todayStr_(), member.name, email, "Rejoin Request", reason || "", now, "", "N/A", "Pending", "", ""]);
  try {
    var admins = getAdminEmails_(ss);
    if (admins.length) MailApp.sendEmail({ to: admins.join(","), subject: "Rejoin request — " + member.name,
      htmlBody: buildEmail_("<p><b>" + member.name + "</b> has asked to rejoin.</p><p>Reason: " + (reason || "—") + "</p>",
        { headerTitle: "Rejoin Request", signatureKey: "general" }), name: EMAIL_FROM_NAME });
  } catch(e) {}
  return { success: true };
}

/** ADMIN — approve a rejoin request: member enters re-entry probation. */
function approveRejoin(rowIndex, memberName) {
  requireManagement_();
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(APOLOGIES_SHEET);
  if (!sheet) throw new Error("Requests sheet not found.");
  reinstateMemberToProbation_(ss, memberName);
  sheet.getRange(rowIndex, 9).setValue("Approved");
  sheet.getRange(rowIndex, 11).setValue("Approved — re-entry probation started");
  return { success: true, name: memberName };
}

/** ADMIN — reinstate a member directly, without a request. */
function adminReinstateMember(memberName, mode) {
  requireManagement_();
  var ss = getSpreadsheet_();
  mode = (mode === "active") ? "active" : "probation";

  // BACKSTOP: someone on hiatus paused by arrangement — they never lost standing,
  // so they always return straight to Active. Even if this is called with
  // mode "probation" (e.g. the UI offered the removal flow by mistake), a hiatus
  // member is reactivated, not put on probation.
  var detail = getMemberDetailStatus_(ss, memberName);
  var wasHiatus = (detail === "On Hiatus");
  if (wasHiatus) mode = "active";

  if (mode === "active") {
    reinstateMemberActive_(ss, memberName);
  } else {
    reinstateMemberToProbation_(ss, memberName);
  }
  return { success: true, name: memberName, mode: mode, wasHiatus: wasHiatus };
}

/**
 * Reinstate straight to Active with NO probation — for correcting an accidental
 * removal, or an admin decision to waive re-entry probation. Clears probation
 * flags and returns the member to full Active in both sheets.
 */
function reinstateMemberActive_(ss, memberName) {
  var sheet = ss.getSheetByName(MEMBERS_SHEET);
  if (!sheet) throw new Error("Members sheet not found.");
  var data = sheet.getDataRange().getValues();
  var h = data[0].map(function(x){ return x.toString().trim().toLowerCase(); });
  var nameIdx = h.indexOf("name"), probIdx = h.indexOf("probation"),
      startIdx = h.indexOf("probation start"), endIdx = h.indexOf("probation end"),
      penIdx = h.indexOf("probation penalty"), ackIdx = h.indexOf("probation acknowledged"),
      passIdx = h.indexOf("probation passed"), failIdx = h.indexOf("probation failed");
  for (var i = 1; i < data.length; i++) {
    if (data[i][nameIdx].toString().trim() !== memberName) continue;
    var row = i + 1;
    if (probIdx !== -1)  sheet.getRange(row, probIdx + 1).setValue("No");
    if (startIdx !== -1) sheet.getRange(row, startIdx + 1).setValue("");
    if (endIdx !== -1)   sheet.getRange(row, endIdx + 1).setValue("");
    if (penIdx !== -1)   sheet.getRange(row, penIdx + 1).setValue("");
    if (ackIdx !== -1)   sheet.getRange(row, ackIdx + 1).setValue("");
    if (passIdx !== -1)  sheet.getRange(row, passIdx + 1).setValue("");
    if (failIdx !== -1)  sheet.getRange(row, failIdx + 1).setValue("");
    break;
  }
  setMembershipState_(ss, memberName, "Active", "Active", "");
  return true;
}

/**
 * ADMIN — set an active member inactive from the profile editor (manual removal,
 * distinct from the automatic 3-AU path). Preserves history; stamps Removed On.
 */
function adminSetMemberInactive_(memberName, reason) {
  requireManagement_();
  var ss = getSpreadsheet_();
  setMembershipState_(ss, memberName, "Inactive", "Left", todayStr_());
  return { success: true, name: memberName };
}
function adminSetMemberInactive(memberName, reason) { return adminSetMemberInactive_(memberName, reason); }

/**
 * ADMIN — put a member on planned hiatus. Distinct from removal: Member Details
 * status becomes "On Hiatus", so on return they go STRAIGHT to Active with NO
 * probation. History preserved; while inactive they are not rostered (points freeze).
 * Hiatus members still receive birthday recognition (CELEBRATE_STATUSES).
 */
function adminSetMemberOnHiatus(memberName, reason) {
  requireManagement_();
  var ss = getSpreadsheet_();
  setMembershipState_(ss, memberName, "Inactive", "On Hiatus", todayStr_());
  return { success: true, name: memberName };
}

/**
 * ADMIN — bring a hiatus member back. Straight to Active, no probation, because
 * they never lost standing — they only paused. (For removed/failed members use
 * adminReinstateMember, which offers the probation path.)
 */
function adminReactivateFromHiatus(memberName) {
  requireManagement_();
  var ss = getSpreadsheet_();
  var detail = getMemberDetailStatus_(ss, memberName);
  if (detail && detail !== "On Hiatus") {
    throw new Error("This member is not on hiatus (status: " + detail + "). Use Reinstate instead.");
  }
  reinstateMemberActive_(ss, memberName);  // clears probation flags, sets Active/Active
  return { success: true, name: memberName };
}

/** Shared: put a returning member into a fresh probation period. */
function reinstateMemberToProbation_(ss, memberName) {
  var sheet = ss.getSheetByName(MEMBERS_SHEET);
  if (!sheet) throw new Error("Members sheet not found.");
  // Set the membership state BEFORE the probation fields. If this throws, the
  // record is left untouched rather than half-migrated (probation restarted but
  // still marked inactive), which is what happened when a stale Status dropdown
  // rejected "Rejoining".
  setMembershipState_(ss, memberName, "Rejoining", "Rejoining", "");
  var data = sheet.getDataRange().getValues();
  var h = data[0].map(function(x){ return x.toString().trim().toLowerCase(); });
  var nameIdx = h.indexOf("name"), probIdx = h.indexOf("probation"),
      startIdx = h.indexOf("probation start"), endIdx = h.indexOf("probation end"),
      penIdx = h.indexOf("probation penalty"), ackIdx = h.indexOf("probation acknowledged");
  var today = todayStr_();
  for (var i = 1; i < data.length; i++) {
    if (data[i][nameIdx].toString().trim() !== memberName) continue;
    var row = i + 1;
    if (probIdx !== -1)  sheet.getRange(row, probIdx + 1).setValue("Yes");
    if (startIdx !== -1) sheet.getRange(row, startIdx + 1).setValue(today);
    if (endIdx !== -1)   sheet.getRange(row, endIdx + 1).setValue("");
    if (penIdx !== -1)   sheet.getRange(row, penIdx + 1).setValue("");
    if (ackIdx !== -1)   sheet.getRange(row, ackIdx + 1).setValue("");
    break;
  }
  return true;
}

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
    onTime = now <= new Date(sessionDT.getTime() - APOLOGY_DEADLINE_MINUTES * 60000);
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
      kind: isReq ? "request"
            : (rType === EMERGENCY_APOLOGY_TYPE ? "emergency"
               : ((!isReq && col9) ? "longterm"
                  : (/late/i.test(rType) ? "late" : "absent"))),
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
    // An Emergency apology counts only once APPROVED - it is filed after the fact
    // and must never quietly excuse a session before an admin has seen it.
    var isPendingEmergency = (data[i][3].toString() === EMERGENCY_APOLOGY_TYPE && status === "Pending");
    if (!isPendingEmergency && !endDate && rowDate === dateStr && groupMatch && status !== "Rejected" && status !== "Revoked" && status !== "Applied" && status !== "Not needed") {
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
  requireManagement_();
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
      // Explicit classification so the UI never has to guess:
      //   "request" | "longterm" (Absent + a real end date) | "late" | "absent"
      kind: isReq ? "request"
            : (rType === EMERGENCY_APOLOGY_TYPE ? "emergency"
               : ((!isReq && col9) ? "longterm"
                  : (/late/i.test(rType) ? "late" : "absent"))),
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
  var statusOrder = { "Pending": 0, "Applied": 1, "Approved": 1, "Not needed": 2, "Rejected": 3, "Revoked": 3 };
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
/**
 * Auto-closes apologies that are no longer needed because the member actually
 * turned up. Without this they sit Pending forever and clutter the review queue.
 * An Absent-type apology is moot if the member was Present or Late on that date;
 * a Late-type apology is moot only if they were Present (not merely late).
 * Long-term apologies are left alone - one attended day inside a multi-week range
 * does not make the range moot.
 * @returns {number} apologies closed
 */
function autoCloseUnneededApologies_(ss) {
  ss = ss || getSpreadsheet_();
  var apSheet = ss.getSheetByName(APOLOGIES_SHEET);
  var attSheet = ss.getSheetByName(ATTENDANCE_SHEET);
  if (!apSheet || !attSheet || apSheet.getLastRow() < 2 || attSheet.getLastRow() < 2) return 0;

  // best status per member per date
  var byMember = {};
  var ad = attSheet.getDataRange().getValues();
  for (var i = 1; i < ad.length; i++) {
    var n = ad[i][1].toString().trim(), ds = formatSheetDate_(ad[i][0]);
    if (!byMember[n]) byMember[n] = {};
    byMember[n][ds] = bestStatus_(byMember[n][ds], ad[i][4].toString());
  }

  var data = apSheet.getDataRange().getValues();
  var closed = 0;
  for (var r = 1; r < data.length; r++) {
    var type = data[r][3].toString();
    if (isRequestType_(type)) continue;
    var status = data[r][8].toString();
    if (status !== "Pending" && status !== "Approved") continue;
    if (data[r][9]) continue;                       // long-term: leave alone
    if (type === EMERGENCY_APOLOGY_TYPE) continue;  // always an explicit admin decision
    var name = data[r][1].toString().trim();
    var ds = formatSheetDate_(data[r][0]);
    var actual = byMember[name] ? byMember[name][ds] : null;
    if (!actual) continue;                          // no register for that date yet

    var moot = /late/i.test(type)
      ? (actual === "Present")
      : (actual === "Present" || actual === "Late Excused" || actual === "Late Unexcused");
    if (!moot) continue;

    apSheet.getRange(r + 1, 9).setValue("Not needed");
    apSheet.getRange(r + 1, 11).setValue("Auto-closed - member attended (" + actual + ")");
    closed++;
  }
  if (closed > 0) SpreadsheetApp.flush();
  return closed;
}

/** PUBLIC — run the apology cleanup on demand. */
function runApologyCleanup() {
  requireManagement_();
  var n = autoCloseUnneededApologies_(getSpreadsheet_());
  var msg = "Auto-closed " + n + " apology/apologies that were no longer needed.";
  Logger.log(msg);
  return { success: true, closed: n, message: msg };
}

/**
 * Backfills already-recorded attendance when an apology is APPROVED.
 * Until now approval only affected FUTURE recording, while revoking cascaded
 * backwards - so the system could retroactively punish but not retroactively
 * excuse. This closes that asymmetry.
 *   Absent-type apology: Absent Unexcused -> Absent Excused
 *   Late-type apology:   Late Unexcused   -> Late Excused
 * Present is never touched, and a single-day apology only affects its own date.
 */
function backfillApologyAttendance_(ss, row) {
  var name = row[1].toString().trim();
  var type = row[3].toString();
  if (isRequestType_(type)) return { changed: 0, name: name };
  var startDate = formatSheetDate_(row[0]);
  var endDate = row[9] ? formatSheetDate_(row[9]) : "";
  var groups = row[11] ? row[11].toString().split(",").map(function (x) { return x.trim(); }).filter(Boolean) : [];
  var isLate = /late/i.test(type);
  var from = isLate ? "Late Unexcused" : "Absent Unexcused";
  var to   = isLate ? "Late Excused"   : "Absent Excused";

  var sheet = ss.getSheetByName(ATTENDANCE_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return { changed: 0, name: name };
  var data = sheet.getDataRange().getValues();
  var changed = 0;
  for (var i = 1; i < data.length; i++) {
    if (data[i][1].toString().trim() !== name) continue;
    var ds = formatSheetDate_(data[i][0]);
    var inRange = endDate ? (ds >= startDate && ds <= endDate) : (ds === startDate);
    if (!inRange) continue;
    if (groups.length && groups.indexOf(data[i][2].toString().trim()) === -1) continue;
    if (data[i][4].toString() !== from) continue;
    sheet.getRange(i + 1, 5).setValue(to);
    changed++;
  }
  if (changed > 0) SpreadsheetApp.flush();
  return { changed: changed, name: name };
}

/**
 * Re-evaluates a member's automatic 3-AU offenses after their attendance changed.
 * An offense is keyed by the date of the 3rd unexcused absence in its set; if that
 * set no longer exists (because an absence was excused retroactively), the offense
 * is deleted. New sets are picked up by syncConsecutiveAuOffenses_ afterwards.
 * @returns {number} offenses removed
 */
function recalcConsecutiveAuOffenses_(ss, memberName) {
  var attSheet = ss.getSheetByName(ATTENDANCE_SHEET);
  var offSheet = ss.getSheetByName(OFFENSES_SHEET);
  if (!attSheet || !offSheet || offSheet.getLastRow() < 2) return 0;

  // Rebuild the member's valid set-keys from CURRENT attendance
  var byDate = {};
  var ad = attSheet.getDataRange().getValues();
  for (var i = 1; i < ad.length; i++) {
    if (ad[i][1].toString().trim() !== memberName) continue;
    var ds = formatSheetDate_(ad[i][0]);
    byDate[ds] = bestStatus_(byDate[ds], ad[i][4].toString());
  }
  var validKeys = {};
  var dates = Object.keys(byDate).sort(), run = 0;
  for (var d = 0; d < dates.length; d++) {
    if (byDate[dates[d]] === "Absent Unexcused") {
      run++;
      if (run >= CONSECUTIVE_ABSENCE_COUNT) { validKeys[dates[d]] = true; run = 0; }
    } else run = 0;
  }

  // Delete auto-offenses whose set no longer exists (bottom-up so indexes hold)
  var od = offSheet.getDataRange().getValues();
  var removed = 0;
  for (var r = od.length - 1; r >= 1; r--) {
    if (od[r][1].toString().trim() !== memberName) continue;
    var desc = od[r][2] ? od[r][2].toString() : "";
    if (desc.indexOf(CONSEC_AU_OFFENSE_TAG) === -1) continue;   // never touch manual offenses
    if (validKeys[formatSheetDate_(od[r][0])]) continue;
    offSheet.deleteRow(r + 1);
    removed++;
  }
  return removed;
}

/**
 * Members who are currently inactive but whose removal is NO LONGER justified,
 * because the absences that triggered it have since been excused. Reinstatement
 * stays a deliberate admin action - this just surfaces the cases.
 */
function getReinstatementFlags() {
  requireManagement_();
  var ss = getSpreadsheet_();
  var attSheet = ss.getSheetByName(ATTENDANCE_SHEET);
  if (!attSheet || attSheet.getLastRow() < 2) return [];
  var byMember = {};
  var ad = attSheet.getDataRange().getValues();
  for (var i = 1; i < ad.length; i++) {
    var n = ad[i][1].toString().trim();
    var ds = formatSheetDate_(ad[i][0]);
    if (!byMember[n]) byMember[n] = {};
    byMember[n][ds] = bestStatus_(byMember[n][ds], ad[i][4].toString());
  }
  var out = [];
  readAllMembers_(ss).forEach(function (m) {
    if (m.active) return;
    var detail = getMemberDetailStatus_(ss, m.name);
    if (detail === "On Hiatus" || detail === "Alumnus" || detail === "Memorial") return;
    if (m.probationFailed) return;              // removed for probation, not absences
    var dates = Object.keys(byMember[m.name] || {}).sort();
    var trailing = 0;
    for (var t = dates.length - 1; t >= 0; t--) {
      if (byMember[m.name][dates[t]] === "Absent Unexcused") trailing++; else break;
    }
    if (trailing < CONSECUTIVE_ABSENCE_COUNT) {
      out.push({ name: m.name, groups: m.groups, currentStreak: trailing,
                 reason: "Removed for consecutive unexcused absences, but the current streak is now " +
                         trailing + " - an apology was approved retroactively." });
    }
  });
  return out;
}

function approveApology(rowIndex, note) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(APOLOGIES_SHEET);
  if (!sheet) throw new Error("Apologies sheet not found.");
  var row = sheet.getRange(rowIndex, 1, 1, Math.max(12, sheet.getLastColumn())).getValues()[0];
  sheet.getRange(rowIndex, 9).setValue("Approved"); // Status
  if (note) sheet.getRange(rowIndex, 11).setValue(note);

  // Retroactively excuse anything already recorded for this apology, then re-check
  // the automatic 3-AU offenses that those absences may have triggered.
  var backfill = { changed: 0 }, offensesRemoved = 0, flagged = false;
  try {
    backfill = backfillApologyAttendance_(ss, row);
    if (backfill.changed > 0) {
      offensesRemoved = recalcConsecutiveAuOffenses_(ss, backfill.name);
      refreshAllRegisters_(ss);
      // Removal itself is NOT undone automatically - surface it for an admin instead.
      var member = null;
      readAllMembers_(ss).forEach(function (m) { if (m.name === backfill.name) member = m; });
      if (member && !member.active) flagged = true;
    }
  } catch (e) { Logger.log("apology backfill: " + e); }

  return { success: true, backfilled: backfill.changed,
           offensesRemoved: offensesRemoved, reinstatementFlagged: flagged };
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
        var deadlineDT = new Date(latestDT.getTime() - APOLOGY_DEADLINE_MINUTES * 60000);
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

  // Keep a session on the card for SESSION_GRACE_MINUTES after it starts, so the
  // view does not jump to the next session the instant this one begins. The client
  // no longer needs to simulate this.
  sessions = sessions.filter(function(s){ return !s.sessionPassed || s.withinGrace; });
  sessions.sort(function(a, b){ return (a.date + a.time).localeCompare(b.date + b.time); });
  return sessions;
}

/** Builds a single session entry with deadline logic. */
function buildSessionEntry_(dateStr, dayName, time, type, title, groups, checkDate, now) {
  var tp = time.split(":");
  var sessionDT = new Date(checkDate.getFullYear(), checkDate.getMonth(), checkDate.getDate(), parseInt(tp[0]), parseInt(tp[1]));
  var deadlineDT = new Date(sessionDT.getTime() - APOLOGY_DEADLINE_MINUTES * 60000);
  var graceEnd = new Date(sessionDT.getTime() + SESSION_GRACE_MINUTES * 60000);
  return {
    withinGrace: (now > sessionDT && now <= graceEnd),
    graceEndsAt: Utilities.formatDate(graceEnd, Session.getScriptTimeZone(), "HH:mm"),
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