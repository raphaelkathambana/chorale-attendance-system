/*
 * Fake backend for tools/theme/render.cjs — stands in for google.script.run so the real
 * Page.html + Scripts.html render with populated screens (tables, pills, cards, charts).
 *
 * Shapes mirror Code.js return values. They only need to be good enough to RENDER every
 * component; when a new endpoint or field shows up as an empty panel or a handler error in
 * the render log, add it here. Unlisted reads return [] (an empty state is still themed) and
 * unlisted writes return { success: true }.
 *
 * The clock is frozen at FIXED_NOW (Africa/Nairobi), so every date below is fixed too and
 * screenshots are identical run to run. `.cjs` so `clasp push` never uploads it.
 */
"use strict";

const FIXED_NOW = "2026-10-14T15:00:00+03:00"; // a Wednesday afternoon, before a 6 PM practice

const STATUSES = ["Present", "Late Excused", "Late Unexcused", "Absent Excused", "Absent Unexcused"];
const P = "Present", LE = "Late Excused", LU = "Late Unexcused", AE = "Absent Excused", AU = "Absent Unexcused";

const PEOPLE = [
  { name: "Amani Wanjiru", groups: ["Choir"], roles: { Choir: "Soprano" } },
  { name: "Brian Otieno", groups: ["Choir", "Band"], roles: { Choir: "Tenor", Band: "Guitar" } },
  { name: "Cynthia Achieng", groups: ["Choir"], roles: { Choir: "Alto" } },
  { name: "Dennis Ouma", groups: ["Choir"], roles: { Choir: "Tenor" } },
  { name: "Esther Njeri", groups: ["Orchestra"], roles: { Orchestra: "Violin" } },
  { name: "Faith Kerubo", groups: ["Choir"], roles: { Choir: "Soprano" } },
  { name: "George Kamau", groups: ["Band"], roles: { Band: "Drums" } },
  { name: "Hellen Mutua", groups: ["Choir", "Orchestra"], roles: { Choir: "Alto", Orchestra: "Cello" } },
  { name: "Ian Mwangi", groups: ["Choir"], roles: { Choir: "Bass" } },
  { name: "Joy Wambui", groups: ["Band"], roles: { Band: "Keys" } },
  { name: "Victor Otieno", groups: ["Choir"], roles: { Choir: "Bass" } },
];
const SELF = { name: "Test Admin", email: "admin@example.org", groups: ["Choir"], roles: { Choir: "Tenor" } };

const email = n => n.toLowerCase().replace(/\s+/g, ".") + "@example.org";
const SESSION_DATES = ["2026-09-02", "2026-09-09", "2026-09-16", "2026-09-23", "2026-09-30", "2026-10-03", "2026-10-07", "2026-10-10"];
// One status row per person, one column per session — the source for every derived figure.
const GRID = [
  [P, P, P, P, P, P, P, P], [P, LE, P, P, LU, P, P, P], [P, P, AE, P, P, P, LE, P], [AU, P, AU, AU, P, AU, AU, P],
  [P, P, P, LE, P, P, P, P], [P, AE, P, P, P, P, P, AE], [LU, LU, P, LU, P, LU, P, LU], [P, P, P, P, AE, P, P, P],
  [P, P, LE, P, P, AU, P, P], [AE, P, P, P, P, P, P, P], [AU, AU, AE, P, AU, AU, AU, AU],
];

function countStatuses(list) {
  const c = {}; STATUSES.forEach(s => (c[s] = 0)); list.forEach(s => c[s]++); return c;
}
const attended = s => s === P || s === LE || s === LU;
const rate = list => (list.length ? Math.round((list.filter(attended).length / list.length) * 100) : 0);

function historyFor(name) {
  const i = Math.max(0, PEOPLE.findIndex(p => p.name === name));
  const person = PEOPLE[i] || SELF, row = GRID[i];
  const records = SESSION_DATES.map((d, k) => ({ date: d, group: person.groups[0], role: person.roles[person.groups[0]], status: row[k], rowIndex: 10 + k }))
    .sort((a, b) => b.date.localeCompare(a.date));
  const stats = {}; person.groups.forEach(g => { stats[g] = Object.assign(countStatuses(row), { total: row.length, attendanceRate: rate(row) }); });
  return { records, stats, profilePhoto: "", groups: person.groups, name: person.name };
}

const SESSIONS_10 = SESSION_DATES.concat(["2026-10-11", "2026-10-12"]);
const probationInfo = (name, seq) => {
  const done = seq.length, att = seq.filter(attended).length;
  return {
    name, probationStart: "2026-09-01", attended: att, totalSessions: done, maxSessions: 10, remaining: 10 - done,
    rate: done ? Math.round((att / done) * 100) : 0, onTrack: att >= Math.ceil(done * 0.7), threshold: 70, required: 7,
    complete: done >= 10, passed: false, lastSessionDate: SESSIONS_10[done - 1] || "",
    sessionSequence: seq.map((s, k) => ({ date: SESSIONS_10[k], status: s, sessionKey: "Choir", groups: ["Choir"], carried: name === "George Kamau" && k < 2 })),
    pendingSlots: 10 - done, scopedSection: null, groups: ["Choir"], profilePhoto: "",
  };
};

function sessionsList() {
  return SESSION_DATES.slice().reverse().map((d, k) => {
    const col = GRID.map(r => r[SESSION_DATES.indexOf(d)]);
    const meeting = k === 2;
    return {
      date: d, sessionKey: meeting ? "Band,Choir" : "Choir", groups: meeting ? ["Band", "Choir"] : ["Choir"],
      type: meeting ? "Meeting" : "Practice", title: meeting ? "Concert planning" : "Practice",
      total: col.length, attended: col.filter(attended).length, attendanceRate: rate(col),
      counts: countStatuses(col), recordedBy: ["Test Admin"], apologyCount: k % 3,
    };
  });
}

function sessionDetail(dateStr, sessionKey) {
  const k = Math.max(0, SESSION_DATES.indexOf(dateStr));
  const col = GRID.map(r => r[k]);
  return {
    date: dateStr, sessionKey: sessionKey || "Choir", groups: String(sessionKey || "Choir").split(",").map(g => g.trim()).filter(Boolean),
    type: String(sessionKey || "").indexOf(",") !== -1 ? "Meeting" : "Practice", title: String(sessionKey || "").indexOf(",") !== -1 ? "Concert planning" : "Practice",
    records: PEOPLE.map((p, i) => ({ name: p.name, group: p.groups[0], role: p.roles[p.groups[0]], status: col[i], recordedBy: "Test Admin", rowIndex: 100 + i })),
    counts: countStatuses(col), total: col.length, attended: col.filter(attended).length, attendanceRate: rate(col),
    recordedBy: ["Test Admin"], apologyCount: 2,
  };
}

function groupDashboard(opts) {
  const all = GRID.flat(), sc = countStatuses(all), total = all.length, att = all.filter(attended).length;
  const trend = SESSION_DATES.map((d, k) => {
    const col = GRID.map(r => r[k]), c = countStatuses(col);
    return { date: d, rate: rate(col), attended: col.filter(attended).length, total: col.length, present: c[P], late: c[LE] + c[LU], ae: c[AE], au: c[AU] };
  });
  const per = x => Math.round((x / SESSION_DATES.length) * 10) / 10;
  const memberRates = PEOPLE.map((p, i) => ({ name: p.name, rate: rate(GRID[i]), attended: GRID[i].filter(attended).length, total: GRID[i].length }));
  const bucket = (min, max) => memberRates.filter(m => m.rate >= min && m.rate <= max).length;
  return {
    section: (opts && opts.section) || "All", range: { start: "2026-09-01", end: "2026-10-14" }, sessionsCount: SESSION_DATES.length,
    overallRate: Math.round((att / total) * 100), absenteeismRate: Math.round(((sc[AE] + sc[AU]) / total) * 100), auRate: Math.round((sc[AU] / total) * 100),
    statusCounts: sc, totalRecords: total,
    avgPerSession: { total: per(total), attended: per(att), present: per(sc[P]), late: per(sc[LE] + sc[LU]), absentExcused: per(sc[AE]), absentUnexcused: per(sc[AU]) },
    momentum: { firstHalfRate: 78, secondHalfRate: 74, delta: -4, direction: "declining" },
    apologyStats: { total: 9, absentType: 6, lateType: 3, onTime: 7, lateSubmission: 2, approved: 5, pending: 2, rejected: 1, notNeeded: 1, complianceRate: 38 },
    trend,
    nearAU: [
      { name: "Victor Otieno", consecutiveAU: 4, groups: ["Choir"], lastSessions: SESSION_DATES.slice(-5).map((d, k) => ({ date: d, status: GRID[10][3 + k] })) },
      { name: "Dennis Ouma", consecutiveAU: 2, groups: ["Choir"], lastSessions: SESSION_DATES.slice(-5).map((d, k) => ({ date: d, status: GRID[3][3 + k] })) },
    ],
    probationCount: 3, probationFallingBehind: [probationInfo("Joy Wambui", [AU, P, AU, AE, AU])], probationOnTrack: 2,
    partBreakdown: [
      { section: "Choir", part: "Bass", rate: 56, total: 16, attended: 9, present: 8, late: 1, ae: 1, au: 6, lateShare: 14, skew: "absence-leaning" },
      { section: "Choir", part: "Tenor", rate: 72, total: 16, attended: 12, present: 9, late: 3, ae: 0, au: 4, lateShare: 43, skew: "even" },
      { section: "Band", part: "Drums", rate: 100, total: 8, attended: 8, present: 4, late: 4, ae: 0, au: 0, lateShare: 100, skew: "late-leaning" },
      { section: "Choir", part: "Soprano", rate: 94, total: 16, attended: 15, present: 15, late: 0, ae: 1, au: 0, lateShare: 0, skew: "clean" },
    ],
    sectionComparison: [
      { section: "Orchestra", rate: 94, total: 16, attended: 15, present: 14, late: 1, ae: 1, au: 0 },
      { section: "Band", rate: 88, total: 24, attended: 21, present: 15, late: 6, ae: 3, au: 0 },
      { section: "Choir", rate: 71, total: 64, attended: 45, present: 38, late: 7, ae: 4, au: 15 },
    ],
    distribution: { buckets: [{ label: "0-25%", min: 0, max: 25, count: bucket(0, 25) }, { label: "26-50%", min: 26, max: 50, count: bucket(26, 50) }, { label: "51-75%", min: 51, max: 75, count: bucket(51, 75) }, { label: "76-100%", min: 76, max: 100, count: bucket(76, 100) }], memberCount: PEOPLE.length },
    weekdayStats: [{ day: "Wed", rate: 77, total: 55 }, { day: "Sat", rate: 82, total: 33 }],
    sessionTypeStats: [{ type: "Practice", rate: 78, total: 77 }, { type: "Meeting", rate: 82, total: 11 }],
    behaviour: { chronicLate: [{ name: "George Kamau", late: 5, absent: 0, rate: 100 }], chronicAbsent: [{ name: "Victor Otieno", late: 0, absent: 7, rate: 13 }, { name: "Dennis Ouma", late: 0, absent: 5, rate: 38 }],
      mixed: 0, spotless: 1, occasional: 6, chronicMin: 3, chronicLateCount: 1, chronicAbsentCount: 2 },
    topAttenders: memberRates.slice().sort((a, b) => b.rate - a.rate).slice(0, 5), minSessionsForTop: 4,
    membershipHealth: { active: 11, hiatus: 1, rejoining: 1, inactive: 2, alumnus: 3, joinedInRange: 2, removedInRange: 1 },
    probationPerformance: { inRange: { passed: 2, conditional: 1, failed: 1, total: 4, passRate: 75 }, byMonth: [{ month: "2026-09", passed: 1, conditional: 1, failed: 0, total: 2, passRate: 100 }, { month: "2026-10", passed: 1, conditional: 0, failed: 1, total: 2, passRate: 50 }] },
    comparison: { previousRange: { start: "2026-07-19", end: "2026-08-31" }, previousRate: 81, rateDelta: -4, previousSessions: 7, sessionsDelta: 1, previousAvgAttended: 8.9, avgAttendedDelta: -0.4, previousAuRate: 9, direction: "declining", auRateDelta: 4 },
  };
}

function scoreboard() {
  return PEOPLE.map((p, i) => {
    const sc = countStatuses(GRID[i]);
    const attPts = sc[P] * 3 + (sc[LE] + sc[LU]) * 1 - sc[AU] * 2;
    const offenseCount = i === 10 ? 2 : i === 3 ? 1 : 0, rewardCount = i === 0 ? 1 : 0;
    return { name: p.name, groups: p.groups, attPoints: attPts, consecPenalty: i === 10 ? -3 : 0, offenseCount, offensePts: -2 * offenseCount,
      rewardCount, rewardPts: 5 * rewardCount, probPenalty: 0, statusCounts: sc, totalDays: 8, profilePhoto: "",
      totalPoints: attPts - 2 * offenseCount + 5 * rewardCount + (i === 10 ? -3 : 0) };
  }).sort((a, b) => b.totalPoints - a.totalPoints || a.name.localeCompare(b.name))
    .map((r, k, arr) => Object.assign(r, { denseRank: k + 1, compRank: k && arr[k - 1].totalPoints === r.totalPoints ? arr[k - 1].compRank : k + 1 }));
}

const apology = (rowIndex, date, name, type, kind, status, extra) => Object.assign({
  rowIndex, date, name, email: email(name), type, isRequest: kind === "request", kind, reason: "Clinical rotation at the hospital ran late.",
  submittedAt: date + " 12:10", onTime: true, status, endDate: "", rawEndDate: "", reviewNote: "",
}, extra || {});

function apologyQueue() {
  return [
    apology(2, "2026-10-14", "Brian Otieno", "Emergency", "emergency", "Pending", { onTime: false, reason: "Family emergency — had to travel home." }),
    apology(3, "2026-10-14", "Cynthia Achieng", "Absent", "absent", "Pending"),
    apology(4, "2026-10-10", "Ian Mwangi", "Late", "late", "Approved", { reviewNote: "Noted." }),
    apology(5, "2026-10-13", "Victor Otieno", "Absent", "longterm", "Pending", { endDate: "2026-10-20", rawEndDate: "2026-10-20" }),
    apology(6, "2026-10-07", "Dennis Ouma", "Absent", "absent", "Rejected", { onTime: false, reviewNote: "Submitted after the deadline." }),
    apology(7, "2026-10-03", "Faith Kerubo", "Absent", "absent", "Not needed"),
    apology(8, "2026-10-12", "Amani Wanjiru", "Name Change", "request", "Pending", { oldName: "Amani Wanjiru", newName: "Amani W. Kariuki", reason: "Marriage" }),
    apology(9, "2026-10-11", "Hellen Mutua", "Section Transfer", "request", "Pending", { currentGroups: ["Choir", "Orchestra"], newGroups: ["Orchestra"], reason: "Timetable clash" }),
    apology(10, "2026-10-09", "Esther Njeri", "Course Details", "request", "Approved", {
      reason: "Faculty: SCES | Course: BBIT | Year: 3 | Reason: Moved year", rawEndDate: '{"courseFaculty":"SCES","courseName":"BBIT","yearOfStudy":"3"}',
      current: { courseFaculty: "SCES", courseName: "BBIT", yearOfStudy: "2" } }),
  ];
}

function memberList() {
  return PEOPLE.map((p, i) => ({
    name: p.name, email: email(p.name), phone: "+254 7" + String(10000000 + i * 1234567).slice(0, 8), admNo: String(140000 + i * 37),
    groups: p.groups, roles: p.roles, active: i !== 10, probation: i === 9 || i === 6, probationPassed: false, probationFailed: false,
    probationStart: i === 9 || i === 6 ? "2026-09-01" : "", probationEnd: "", profilePhoto: "",
    gender: i % 2 ? "M" : "F", yearOfStudy: String(1 + (i % 4)), courseFaculty: ["SCES", "SBS", "SHSS"][i % 3], memberStatus: i === 10 ? "On Hiatus" : "Active",
    attendanceRate: rate(GRID[i]), attended: GRID[i].filter(attended).length, totalSessions: GRID[i].length,
  }));
}

// One myApology per status the backend can return on getUpcomingSessions() (plan §4.2).
const MY_APOLOGY = {
  pending: { status: "Pending", type: "Absent", longTerm: false },
  "pending-emergency": { status: "Pending", type: "Emergency", longTerm: false },
  approved: { status: "Approved", type: "Absent", longTerm: false },
  applied: { status: "Applied", type: "Late", longTerm: false },
  "not-needed": { status: "Not needed", type: "Absent", longTerm: false },
  rejected: { status: "Rejected", type: "Absent", longTerm: false },
  revoked: { status: "Revoked", type: "Absent", longTerm: false },
  "longterm-pending": { status: "Pending", type: "Absent", longTerm: true, startDate: "2026-10-12", endDate: "2026-10-26" },
  "longterm-approved": { status: "Approved", type: "Absent", longTerm: true, startDate: "2026-10-12", endDate: "2026-10-26" },
};

function yearInfo(state, readOnly) {
  const open = state.year === "available" || state.year === "pending";
  return {
    currentLabel: "2025/26", currentStartsOn: "2025-11-01", nextLabel: "2026/27", nextStartsOn: "2026-11-01",
    defaultStartsOn: "2026-11-01", latestStartsOn: open ? "2026-11-03" : "2026-11-01",
    canStartNow: open, blockReason: open ? "" : "The 2026/27 year can start from Sun 1 Nov 2026.",
    canRollover: !readOnly, canViewPast: true,
    pastYears: [
      { label: "2024/25", startsOn: "2024-11-01", endsOn: "2025-10-31", rolledOverOn: "2025-11-01", rolledOverBy: "Test Admin", archiveUrl: "https://docs.google.com/spreadsheets/d/archive-2024-25" },
      { label: "2023/24", startsOn: "2023-11-01", endsOn: "2024-10-31", rolledOverOn: "2023-11-02", rolledOverBy: "Test Admin", archiveUrl: "https://docs.google.com/spreadsheets/d/archive-2023-24" },
    ],
  };
}

function newYearPlan(state) {
  const pending = state.year === "pending";
  const pendingApologiesArchived = pending ? [
    { rowIndex: 41, date: "2026-10-28", name: "Cynthia Achieng", email: email("Cynthia Achieng"), type: "Absent", isRequest: false, kind: "absent",
      reason: "Clinical rotation at the hospital ran late.", submittedAt: "2026-10-27 18:02", sessionTime: "18:00", onTime: true, status: "Pending", endDate: "", groups: ["Choir"] },
    { rowIndex: 44, date: "2026-10-31", name: "Brian Otieno", email: email("Brian Otieno"), type: "Emergency", isRequest: false, kind: "emergency",
      reason: "Family emergency — had to travel home.", submittedAt: "2026-10-31 18:40", sessionTime: "18:00", onTime: false, status: "Pending", endDate: "", groups: ["Choir"] },
  ] : [];
  const warnings = pending ? [pendingApologiesArchived.length + " apology/request(s) for last year are still Pending. Decide them before starting, or they are archived unresolved."] : [];
  return {
    currentLabel: "2025/26", currentStartsOn: "2025-11-01", nextLabel: "2026/27", nextStartsOn: "2026-11-01", defaultStartsOn: "2026-11-01",
    customStart: false, today: "2026-11-02", canStart: true, blockReason: "", warnings,
    sheets: { Attendance: { total: 1840, archive: 1840, live: 0, both: 0 }, Apologies: { total: 212, archive: 209, live: 1, both: 2 },
      Offenses: { total: 23, archive: 23, live: 0, both: 0 }, Rewards: { total: 31, archive: 31, live: 0, both: 0 } },
    probationCarry: [{ name: "Joy Wambui", probationStart: "2026-09-01", carriedSessions: 5, carriedAttended: 1 }, { name: "George Kamau", probationStart: "2026-09-01", carriedSessions: 7, carriedAttended: 7 }],
    penaltiesCleared: [{ name: "Victor Otieno", penalty: -5, probationEnded: "2026-06-14" }],
    pendingApologiesArchived, auOffensesDropped: [{ name: "Dennis Ouma", date: "2026-10-28" }],
    message: "NEW YEAR ROLLOVER - DRY RUN (nothing changed)",
  };
}

const ACTIVITY = [
  ["2026-10-14 14:52", SELF.email, SELF.name, "Attendance recorded", "Choir · Wed 14 Oct", "11 members"],
  ["2026-10-14 14:31", SELF.email, SELF.name, "Apology approved", "Cynthia Achieng", "Absent · Wed 14 Oct"],
  ["2026-10-14 09:00", "System", "System", "Offense recorded", "Victor Otieno", "3 consecutive unexcused absences (automatic)"],
  ["2026-10-13 19:12", email("Dennis Ouma"), "Dennis Ouma", "Apology submitted", "Dennis Ouma", "Absent · Sat 17 Oct"],
  ["2026-10-13 16:05", SELF.email, SELF.name, "Communique draft saved", "Concert dress code", "All active members"],
  ["2026-10-12 11:40", SELF.email, SELF.name, "Member removed", "Old Member", "Left the chorale"],
  ["2026-10-12 10:02", SELF.email, SELF.name, "Meeting scheduled", "Concert planning", "Sat 17 Oct · 10:00 · Band, Choir"],
  ["2026-10-11 08:00", "System", "System", "Reward awarded", "Amani Wanjiru", "Perfect attendance (September)"],
].map(([timestamp, actor, actorName, action, target, details]) => ({ timestamp, actor, actorName, action, target, details }));

const DRAFTS = [
  { id: "d1", subject: "Concert dress code", preview: "Dear {first name}, for Saturday's concert please wear the full black uniform with the gold scarf…",
    ownerEmail: SELF.email, ownerName: SELF.name, mine: true, recipientType: "all", groups: [], attachmentCount: 1,
    createdLabel: "Tue 13 Oct · 16:05", updatedLabel: "Wed 14 Oct · 09:12", updatedAt: Date.parse("2026-10-14T09:12:00+03:00") },
  { id: "d2", subject: "", preview: "", ownerEmail: SELF.email, ownerName: SELF.name, mine: true, recipientType: "sections", groups: ["Band"], attachmentCount: 0,
    createdLabel: "Mon 12 Oct · 11:00", updatedLabel: "Mon 12 Oct · 11:00", updatedAt: Date.parse("2026-10-12T11:00:00+03:00") },
  { id: "d3", subject: "Orchestra sectional moved", preview: "The Thursday sectional moves to the music room from next week.",
    ownerEmail: email("Esther Njeri"), ownerName: "Esther Njeri", mine: false, recipientType: "sections", groups: ["Orchestra"], attachmentCount: 0,
    createdLabel: "Fri 9 Oct · 15:30", updatedLabel: "Fri 9 Oct · 15:41", updatedAt: Date.parse("2026-10-09T15:41:00+03:00") },
];

const DETAILS_FULL = { admissionNumber: "140370", courseFaculty: "SCES", courseName: "BBIT", nationality: "Kenyan", choirPart: "Bass", instruments: "",
  nokName: "Mary Otieno", nokPhone: "+254 722 000111", nokRelationship: "Mother", nokResidence: "Kisumu", residence: "Madaraka", dateOfBirth: "2004-03-18",
  phoneNumber: "+254 711 222333", passportNumber: "AK1234567", nationalIdNumber: "34567890", gender: "M", yearOfStudy: "3", memberStatus: "On Hiatus" };
const REDACTED_FOR_SECTION_ADMINS = ["passportNumber", "nationalIdNumber", "nokName", "nokPhone", "nokRelationship", "nokResidence"];

// scenario: "admin" | "member" | "member-failed" | "superadmin".
// state (set per screen by render.cjs, read lazily): { role: "sectionAdmin", year: "before"|"available"|"pending",
//   myApology: <MY_APOLOGY key>, emergency: "prominent"|"hidden" }
function fixtures(scenario, state) {
  state = state || {};
  const isMember = scenario === "member" || scenario === "member-failed";
  const failed = scenario === "member-failed";
  const superAdmin = scenario === "superadmin";
  const roleFor = () => {
    if (isMember) return { role: "member", email: SELF.email, name: SELF.name, groups: SELF.groups, section: "", repGroup: "", allowedSections: [],
      isAdminLike: false, readOnly: false, isMember: true, canViewPastYears: false, canStartNewYear: false };
    if (superAdmin) return { role: "superAdmin", email: "oversight@example.org", name: "Peter Musyoka", groups: [], section: "", repGroup: "",
      allowedSections: ["Choir", "Band", "Orchestra"], isAdminLike: true, readOnly: true, isMember: false, canViewPastYears: true, canStartNewYear: false };
    if (state.role === "sectionAdmin") return { role: "sectionAdmin", email: SELF.email, name: SELF.name, groups: SELF.groups, section: "Choir", repGroup: "",
      allowedSections: ["Choir"], isAdminLike: true, readOnly: false, isMember: true, canViewPastYears: true, canStartNewYear: false };
    return { role: "admin", email: SELF.email, name: SELF.name, groups: SELF.groups, section: "", repGroup: "", allowedSections: ["Choir", "Band", "Orchestra"],
      isAdminLike: true, readOnly: false, isMember: true, canViewPastYears: true, canStartNewYear: true };
  };
  const fx = {
    getUserRole: roleFor,
    getMembers: () => PEOPLE.map(p => ({ name: p.name, groups: p.groups, roles: p.roles, probation: p.name === "Joy Wambui", probationStart: "2026-09-01" })),
    getAllMemberNames: () => PEOPLE.map(p => p.name),
    getMemberList: memberList,
    getFilteredMemberNames: () => PEOPLE.map(p => p.name),
    getMemberFilterOptions: () => ({ sections: ["Choir", "Band", "Orchestra"], roles: { Choir: ["Soprano", "Alto", "Tenor", "Bass"], Band: ["Guitar", "Drums", "Keys"], Orchestra: ["Violin", "Cello"] },
      genders: ["F", "M"], faculties: ["SBS", "SCES", "SHSS"], yearsOfStudy: ["1", "2", "3", "4"], probationStatuses: ["On probation", "Passed"], memberStatuses: ["Active", "On Hiatus"] }),
    countFilteredMembers: () => PEOPLE.length,
    getMemberHistory: historyFor,
    getMemberForEdit: name => { const m = memberList().find(x => x.name === name) || memberList()[0];
      return Object.assign({}, m, { membership: { state: "active", detailStatus: "Active", active: true, availableActions: ["hiatus", "inactive"] }, choirPart: m.roles.Choir || "", bandRole: m.roles.Band || "", orchestraRole: m.roles.Orchestra || "", details: { courseFaculty: "SCES", courseName: "BBIT", yearOfStudy: "2", nationality: "Kenyan", gender: "F" } }); },
    // Section admins get passport, national ID and next of kin blank, listed in redacted[].
    getMemberDetails: () => {
      if (state.role !== "sectionAdmin") return Object.assign({}, DETAILS_FULL, { redacted: [] });
      const d = Object.assign({}, DETAILS_FULL); REDACTED_FOR_SECTION_ADMINS.forEach(k => (d[k] = "")); d.redacted = REDACTED_FOR_SECTION_ADMINS.slice(); return d;
    },
    getAttendanceDates: () => SESSION_DATES.slice().reverse().map(d => ({ date: d, groups: ["Choir"] })),
    getAttendanceForDate: () => [],
    batchUpdateAttendance: () => ({ success: true, updated: 3, skipped: [] }),
    getSessionTime: () => ({ found: true, time: "18:00", latest: "18:00", dayName: "Wednesday" }),
    getMeetings: () => [{ id: 4, rowIndex: 4, date: "2026-10-17", dayName: "Saturday", time: "10:00", groups: ["Band", "Choir"], title: "Concert planning", createdBy: "Test Admin" }],
    updateMeeting: (id, ch) => Object.assign({ success: true, id, date: "2026-10-17", time: "10:00", groups: ["Band", "Choir"], title: "Concert planning", apologiesForOldSlot: 0 }, ch || {}),
    getUpcomingSessions: () => [
      { withinGrace: false, graceEndsAt: "20:00", date: "2026-10-14", dayName: "Wednesday", time: "18:00", type: "Practice", kind: "Practice", title: "Practice",
        groups: ["Choir"], deadline: "17:30", deadlinePassed: !!state.emergency, sessionPassed: false, sessionKey: "2026-10-14|18:00|Choir",
        myApology: state.myApology ? MY_APOLOGY[state.myApology] : null },
      { withinGrace: false, graceEndsAt: "12:00", date: "2026-10-17", dayName: "Saturday", time: "10:00", type: "Meeting", kind: "Meeting", title: "Concert planning",
        groups: ["Band", "Choir"], deadline: "09:30", deadlinePassed: false, sessionPassed: false, sessionKey: "2026-10-17|10:00|Band,Choir", myApology: null },
    ],
    // state.emergency = "prominent" (door under the next-session card) | "hidden" (hint on the apology page only)
    getEmergencyApologyOption: () => state.emergency
      ? { eligible: true, reason: "", phase: state.emergency, date: "2026-10-14", time: "18:00", groups: ["Choir"], sessionKey: "Choir",
          opensAt: "2026-10-14 17:30", promptUntil: "2026-10-14 20:00", closesAt: "2026-10-14 23:59", status: "Not yet recorded" }
      : { eligible: false, reason: "The apology deadline has not passed yet." },
    getSessionsList: sessionsList,
    getSessionDetail: sessionDetail,
    getGroupDashboard: groupDashboard,
    getScoreboard: scoreboard,
    getProbationDashboard: () => [probationInfo("Joy Wambui", [AU, P, AU, AE, AU]), probationInfo("George Kamau", [P, LU, P, P, LU, P, P]), probationInfo("Ian Mwangi", [P, P, P, P, P, P, P, P, P, P])],
    getProbationOutcomeFlags: () => [],
    getApologyQueue: apologyQueue,
    getReinstatementFlags: () => [{ name: "Victor Otieno", groups: ["Choir"], currentStreak: 1, reason: "Removed for consecutive unexcused absences, but the current streak is now 1 after an approved apology." }],
    getOffenseList: () => [{ rowIndex: 2, date: "2026-10-07", name: "Victor Otieno", description: "3 consecutive unexcused absences", recordedBy: "System", points: -3 },
      { rowIndex: 3, date: "2026-09-30", name: "Dennis Ouma", description: "Disruptive during rehearsal", recordedBy: "Test Admin", points: -2 }],
    getRewardCategories: () => [{ category: "Perfect attendance (month)", points: 5, variable: false }, { category: "Extra effort", points: "", variable: true }],
    getRewardList: () => [{ rowIndex: 2, date: "2026-10-01", name: "Amani Wanjiru", category: "Perfect attendance (month)", description: "[auto:perfect] September", points: 5, recordedBy: "System" }],
    getMyAttendance: () => superAdmin
      ? { isMember: false, name: "", email: "oversight@example.org", groups: [], history: [], message: "This account has no membership record, so there is no personal attendance to show." }
      : { name: SELF.name, email: SELF.email, groups: SELF.groups, roles: SELF.roles, probation: false, probationPassed: !failed, probationFailed: failed,
          probationPenalty: failed ? -5 : 0, probationAcknowledged: !failed, probationInfo: failed ? probationInfo(SELF.name, [AU, P, AU, AE, AU, AU, P, AU, AE, AU]) : null,
          onboardingCompleted: true, history: historyFor(failed ? "Victor Otieno" : "Brian Otieno") },
    getMyApologies: () => apologyQueue().slice(1, 4),
    getMyProfile: () => superAdmin
      ? { isMember: false, name: "", email: "oversight@example.org", groups: [], history: [], message: "This account has no membership record, so there is no personal attendance to show." }
      : { name: SELF.name, email: SELF.email, phone: "+254 700 000000", admNo: "140001", groups: SELF.groups, roles: SELF.roles, profilePhoto: "",
          details: { gender: "F", courseFaculty: "SCES", courseName: "BBIT", yearOfStudy: "2", nationality: "Kenyan" } },
    getConfigLists: () => ({ choirParts: ["Soprano", "Alto", "Tenor", "Bass"], bandRoles: ["Guitar", "Drums", "Keys"], orchestraRoles: ["Violin", "Cello"], faculties: ["SBS", "SCES", "SHSS"] }),
    getTodaysBirthdaysForBanner: () => [],
    getScheduledEmails: () => [{ id: "c1", sendAt: "2026-10-16T06:00:00.000Z", status: "Scheduled", scheduledBy: SELF.email, subject: "Concert dress code", result: "", canCancel: true },
      { id: "c2", sendAt: "2026-10-09T06:00:00.000Z", status: "Sent", scheduledBy: SELF.email, subject: "Welcome back", result: "Sent to 104", canCancel: false }],
    getSignatureOptions: () => [{ key: "committee", label: "The Strathmore Chorale Committee", name: "The Strathmore Chorale Committee", title: "", email: "chorale@example.org", phone: "" }],
    getCommuniqueRecipientOptions: () => ({ groups: ["Choir", "Band", "Orchestra"], members: PEOPLE.map(p => ({ name: p.name, email: email(p.name), groups: p.groups })),
      signatures: [{ key: "committee", label: "The Strathmore Chorale Committee", name: "The Strathmore Chorale Committee", title: "", email: "chorale@example.org", phone: "" }], canSendAll: true }),
    // Communiqué drafts
    getCommuniqueDrafts: () => DRAFTS,
    getCommuniqueDraft: id => { const d = DRAFTS.find(x => x.id === id) || DRAFTS[0];
      return { id: d.id, ownerEmail: d.ownerEmail, ownerName: d.ownerName, mine: d.mine, updatedAt: d.updatedAt, updatedLabel: d.updatedLabel,
        payload: { subject: d.subject, body: d.preview, recipientType: d.recipientType, groups: d.groups, members: [], attachments: [] }, missingAttachments: 0 }; },
    saveCommuniqueDraft: () => ({ success: true, id: "d1", updatedAt: Date.parse("2026-10-14T15:00:00+03:00"), updatedLabel: "Wed 14 Oct · 15:00" }),
    deleteCommuniqueDraft: () => ({ success: true }),
    deleteCommuniqueAttachment: () => ({ success: true, kept: false, reason: "" }),
    // Activity log
    getActivityLog: () => ({ entries: ACTIVITY, actions: [...new Set(ACTIVITY.map(e => e.action))].sort(), total: ACTIVITY.length }),
    // Chorale years
    getYearInfo: () => yearInfo(state, superAdmin),
    previewNewYear: () => newYearPlan(state),
    startNewYear: label => ({ success: true, label: label || "2026/27", previousLabel: "2025/26", startsOn: "2026-11-01", customStart: false,
      archiveUrl: "https://docs.google.com/spreadsheets/d/archive-2025-26", backupUrl: "https://drive.google.com/file/d/backup-2025-26",
      summary: "1840 attendance rows archived · 2 probations carried", warnings: [], message: "Started 2026/27." }),
    // Dark mode plumbing: the server preference. render.cjs overrides it per mode.
    getThemePreference: () => "system",
  };
  // Archived-year reads go through callForYear(label, fn, args) and return fn's own shape.
  fx.callForYear = (label, fn, args) => (fx[fn] ? fx[fn].apply(null, args || []) : (/^(get|list|count)/.test(fn) ? [] : { success: true }));
  return fx;
}

module.exports = { fixtures, FIXED_NOW, MY_APOLOGY };
