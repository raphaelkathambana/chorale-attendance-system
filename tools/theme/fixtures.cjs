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

// Birthdays. One person per accent the server sends (bdPick_ templates in Code.js), so every accent
// renders as text, ring and fill in both themes. One has a photo (ring around an image); the rest
// show their initial. Ages, drafts and daysAway are fixed; dates derive from the frozen clock.
const BDAY_AVATAR = "data:image/svg+xml," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#8a7a66"/>' +
  '<circle cx="40" cy="31" r="15" fill="#e9dcc8"/><ellipse cx="40" cy="74" rx="27" ry="21" fill="#e9dcc8"/></svg>');
const BIRTHDAYS = [
  { name: SELF.name, accent: "#185FA5", age: 21, daysAway: 0, cardSent: true },
  { name: "Amani Wanjiru", accent: "#0F6E56", age: 20, daysAway: 0, avatar: BDAY_AVATAR },
  { name: "Cynthia Achieng", accent: "#534AB7", age: 22, daysAway: 0 },
  { name: "Dennis Ouma", accent: "#D85A30", age: 19, daysAway: 1 },
  { name: "Faith Kerubo", accent: "#993556", age: 23, daysAway: 1 },
  { name: "Hellen Mutua", accent: "#BA7517", age: 20, daysAway: 5 },
  { name: "Joy Wambui", accent: "#1D9E75", age: 21, daysAway: 12 },
].map(b => {
  const first = b.name.split(" ")[0];
  return { name: b.name, first, age: b.age, email: b.name === SELF.name ? SELF.email : email(b.name), avatar: b.avatar || "", accent: b.accent,
    daysAway: b.daysAway, cardSent: !!b.cardSent, headline: "Happy birthday, " + first + "!",
    groupDraft: "Happy birthday " + first + "! \u{1F382} Wishing you a wonderful year from all of us at the Chorale.",
    messageDraft: "Dear " + first + ",\n\nHappy birthday from the whole Chorale. Thank you for every rehearsal and every note.\n\nWith love,\nThe Committee" };
});
function birthdayDashboard(rangeMode) {
  const range = rangeMode === "week" || rangeMode === "month" ? rangeMode : "today";
  const within = BIRTHDAYS.filter(b => b.daysAway <= (range === "month" ? 31 : range === "week" ? 7 : 1));
  return { range, autoSend: false, all: within, today: within.filter(b => b.daysAway === 0), tomorrow: within.filter(b => b.daysAway === 1),
    upcoming: range === "today" ? [] : within.filter(b => b.daysAway > 1) };
}
// The banner: today's birthdays only. The viewer's own comes first and is marked isSelf.
const BIRTHDAY_BANNER = BIRTHDAYS.filter(b => b.daysAway === 0).map(b => ({ name: b.name, first: b.first, isSelf: b.email === SELF.email,
  accent: b.accent, avatar: b.avatar, message: b.email === SELF.email ? "Happy birthday, " + b.first + "! The whole Chorale is celebrating you today."
    : "It’s " + b.first + "’s birthday today — wish them well at practice." }));

// Communiqué templates (backend 3 Nov). Ids start "tpl_" like the backend's; the list comes back A–Z by
// name. One is the viewer's, two are someone else's, so a section admin sees rows with and without Edit.
const TEMPLATES = [
  { id: "tpl_1", name: "Concert dress code", subject: "Concert dress code for Saturday", owner: SELF, recipientType: "all", groups: [],
    body: "<p>Dear {first name},</p><p>For Saturday's concert please wear the full black uniform with the gold scarf. Call time is 4 PM at the main hall.</p>",
    attachments: [{ id: "f1", name: "Uniform guide.pdf", mimeType: "application/pdf", sizeBytes: 182000, sizeMB: 0.17, url: "https://drive.google.com/file/d/f1" }],
    updatedAt: Date.parse("2026-10-12T10:20:00+03:00"), updatedLabel: "Mon 12 Oct · 10:20" },
  { id: "tpl_2", name: "New chorale year welcome", subject: "Welcome to the {year} chorale year", owner: { name: "Esther Njeri", email: email("Esther Njeri") },
    recipientType: "all", groups: [], attachments: [],
    body: "<p>Dear {first name},</p><p>Welcome back! Rehearsals start on Wednesday at 6 PM. Please update your details on the app before then.</p>",
    updatedAt: Date.parse("2026-10-09T15:41:00+03:00"), updatedLabel: "Fri 9 Oct · 15:41" },
  { id: "tpl_3", name: "Sectional reminder", subject: "", owner: { name: "Esther Njeri", email: email("Esther Njeri") }, recipientType: "groups", groups: ["Orchestra"],
    body: "<p>Reminder: the Thursday sectional is in the music room.</p>", attachments: [],
    updatedAt: Date.parse("2026-10-02T09:05:00+03:00"), updatedLabel: "Fri 2 Oct · 09:05" },
];
// canEdit: the owner or a full admin (canManageDraft_ in Code.js).
const tplCanEdit = (t, fullAdmin) => fullAdmin || t.owner.email === SELF.email;
const templateRow = (t, fullAdmin) => {
  const text = t.body.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return { id: t.id, name: t.name, subject: t.subject, preview: text.length > 140 ? text.slice(0, 137) + "..." : text,
    ownerEmail: t.owner.email, ownerName: t.owner.name, mine: t.owner.email === SELF.email, canEdit: tplCanEdit(t, fullAdmin), corrupt: false,
    recipientType: t.recipientType, groups: t.groups, attachmentCount: t.attachments.length, updatedLabel: t.updatedLabel, updatedAt: t.updatedAt };
};
const templateFull = (t, fullAdmin) => ({ id: t.id, kind: "template", ownerEmail: t.owner.email, ownerName: t.owner.name, mine: t.owner.email === SELF.email,
  updatedAt: t.updatedAt, updatedLabel: t.updatedLabel, missingAttachments: 0, name: t.name, canEdit: tplCanEdit(t, fullAdmin),
  payload: { subject: t.subject, body: t.body, recipientType: t.recipientType, groups: t.groups, members: [], attachments: t.attachments, templateName: t.name } });

// Returned by a fixture to leave the call in flight: render.cjs never answers it, so the screen shows its
// waiting state (e.g. Start on the Chorale year page while the rollover runs).
const HOLD = { __hold: true };

const DETAILS_FULL = { admissionNumber: "140370", courseFaculty: "SCES", courseName: "BBIT", nationality: "Kenyan", choirPart: "Bass", instruments: "",
  nokName: "Mary Otieno", nokPhone: "+254 722 000111", nokRelationship: "Mother", nokResidence: "Kisumu", residence: "Madaraka", dateOfBirth: "2004-03-18",
  phoneNumber: "+254 711 222333", passportNumber: "AK1234567", nationalIdNumber: "34567890", gender: "M", yearOfStudy: "3", memberStatus: "On Hiatus" };
const REDACTED_FOR_SECTION_ADMINS = ["passportNumber", "nationalIdNumber", "nokName", "nokPhone", "nokRelationship", "nokResidence"];

// ─── Subscriptions (Scripts §14, backend 9 Nov 2026) ─────────────────────────
// Off by default so every other screen stays as it was: getUserRole() carries no
// `subscriptions` caps (no tab) and getMySubscription() throws (no card, no line).
// state.subs: "admin" | "treasurer" | "treasurerMember" | "section" | "paused" | "superadmin"
// state.subsSetup: "none" (the Treasurer hasn't set the fee or a number yet)
// state.mySubs: a SUBS_MINE key (the signed-in member's card)
const SUBS_YEAR = "2025/26", SUBS_FEE = 1000, SUBS_DEADLINE = "2025-11-30";
const SUBS_MEMBERS = [
  { name: "Amani Wanjiru", status: "Paid", paid: 1000, balance: 0, dueDate: SUBS_DEADLINE, dueReason: "Deadline" },
  { name: "Brian Otieno", status: "Part paid", paid: 600, balance: 400, dueDate: SUBS_DEADLINE, dueReason: "Deadline", pendingAmount: 400 },
  { name: "Cynthia Achieng", status: "Committed", paid: 0, balance: 1000, dueDate: SUBS_DEADLINE, dueReason: "Deadline", commitment: { id: "sub_c1", amount: 1000, payBy: "2026-10-30", lapsed: false } },
  { name: "Dennis Ouma", status: "Unpaid", paid: 0, balance: 1000, dueDate: SUBS_DEADLINE, dueReason: "Deadline", pendingAmount: 2000 },
  { name: "Esther Njeri", status: "Due", paid: 0, balance: 1000, dueDate: "2026-10-25", dueReason: "Returned to active", pendingAmount: 1000 },
  { name: "Faith Kerubo", status: "Paid", paid: 1000, balance: 0, dueDate: SUBS_DEADLINE, dueReason: "Deadline" },
  { name: "George Kamau", status: "Not required", paid: 0, balance: 0 },
  { name: "Hellen Mutua", status: "On hiatus", paid: 0, balance: 0 },
  { name: "Ian Mwangi", status: "Not due yet", paid: 0, balance: 0 },
  { name: "Joy Wambui", status: "Not due yet", paid: 400, balance: 0 },
  { name: "Victor Otieno", status: "Unpaid", paid: 0, balance: 1000, dueDate: SUBS_DEADLINE, dueReason: "Deadline", commitment: { id: "sub_c0", amount: 1000, payBy: "2026-09-30", lapsed: true }, commitmentPending: true },
];
const SUBS_SETTINGS = { fee: SUBS_FEE, deadline: SUBS_DEADLINE, receivingNumbers: [{ number: "0712345678", name: "STRATHMORE CHORALE" }],
  instructions: "Send Money to the Chorale line below, from your own line if you can.\nPaying for someone else too? Say who in the note." };
const SUBS_QUEUE = [
  { id: "sub_q1", type: "Payment", member: "Brian Otieno", amount: 400, code: "UK9RK1H8LC", paidAt: "2026-10-12 17:42", recipient: "STRATHMORE CHORALE 0712345678",
    message: "UK9RK1H8LC Confirmed. Ksh400.00 sent to STRATHMORE CHORALE 0712345678 on 12/10/26 at 5:42 PM.", note: "Balance for the year", payBy: "", submittedAt: "2026-10-12 17:45", numberChanged: false },
  { id: "sub_q2", type: "Payment", member: "Dennis Ouma", amount: 2000, code: "UK8QW2E5TP", paidAt: "2026-10-13 09:02", recipient: "STRATHMORE CHORALE 0712345678",
    message: "UK8QW2E5TP Confirmed. Ksh2,000.00 sent to STRATHMORE CHORALE 0712345678 on 13/10/26 at 9:02 AM.", note: "For me and Victor Otieno", payBy: "", submittedAt: "2026-10-13 09:10", numberChanged: false },
  { id: "sub_q3", type: "Payment", member: "Esther Njeri", amount: 1000, code: "UK7HD4M1RN", paidAt: "2026-10-13 20:15", recipient: "JANE MWANGI 0798765432",
    message: "UK7HD4M1RN Confirmed. Ksh1,000.00 sent to JANE MWANGI 0798765432 on 13/10/26 at 8:15 PM.", note: "", payBy: "", submittedAt: "2026-10-13 20:20", numberChanged: true },
  { id: "sub_q4", type: "Commitment", member: "Victor Otieno", amount: 1000, code: "", paidAt: "", recipient: "", message: "", note: "After my HELB comes through",
    payBy: "2026-10-30", submittedAt: "2026-10-14 08:30", numberChanged: false },
];
const SUBS_RECENT = [
  { id: "sub_r1", type: "Commitment", member: "Cynthia Achieng", amount: 1000, status: "Approved", code: "", paidAt: "", payBy: "2026-10-30", reason: "", decidedAt: "2026-10-10 11:05", decidedBy: "faith.kerubo@example.org", source: "Member", splitFrom: "" },
  { id: "sub_r2", type: "Payment", member: "Victor Otieno", amount: 1000, status: "Rejected", code: "UJ1AB2CD3E", paidAt: "2026-10-08 19:20", payBy: "", reason: "This code isn't on the Chorale statement. Check you sent it to 0712 345 678.", decidedAt: "2026-10-09 10:00", decidedBy: "faith.kerubo@example.org", source: "Member", splitFrom: "" },
  { id: "sub_r3", type: "Payment", member: "Joy Wambui", amount: 400, status: "Confirmed", code: "UJ9XY7KL2M", paidAt: "2026-10-03 18:10", payBy: "", reason: "", decidedAt: "2026-10-04 09:30", decidedBy: "faith.kerubo@example.org", source: "Split", splitFrom: "sub_r4" },
  { id: "sub_r4", type: "Payment", member: "Brian Otieno", amount: 600, status: "Confirmed", code: "UJ9XY7KL2M", paidAt: "2026-10-03 18:10", payBy: "", reason: "Split: Joy Wambui Ksh 400", decidedAt: "2026-10-04 09:30", decidedBy: "faith.kerubo@example.org", source: "Member", splitFrom: "" },
  { id: "sub_r5", type: "Payment", member: "Faith Kerubo", amount: 1000, status: "Confirmed", code: "", paidAt: "2026-10-02 00:00", payBy: "", reason: "", decidedAt: "2026-10-02 18:40", decidedBy: "faith.kerubo@example.org", source: "Treasurer", splitFrom: "" },
  { id: "sub_r6", type: "Payment", member: "Amani Wanjiru", amount: 1000, status: "Confirmed", code: "UJ3PL0Q2ZX", paidAt: "2026-09-29 07:55", payBy: "", reason: "", decidedAt: "2026-09-30 08:15", decidedBy: "faith.kerubo@example.org", source: "Member", splitFrom: "" },
];
const SUBS_TREASURERS = [{ name: "Faith Kerubo", appointedOn: "2025-11-03", appointedBy: "Test Admin", email: "faith.kerubo@example.org" }];
const SUBS_ITEM = (o) => Object.assign({ id: "", type: "Payment", amount: 0, status: "", code: "", paidAt: "", payBy: "", note: "", reason: "", submittedAt: "", decidedAt: "", source: "Member", mine: true }, o);
const SUBS_MINE = {
  due:       { status: "Due", owes: true, paid: 0, balance: 1000, dueDate: "2026-10-25", dueReason: "Returned to active", canCommit: true, items: [] },
  part:      { status: "Part paid", owes: true, paid: 600, balance: 400, dueDate: SUBS_DEADLINE, dueReason: "Deadline", pendingAmount: 400, canCommit: true, items: [
               SUBS_ITEM({ id: "sub_q1", amount: 400, status: "Pending", code: "UK9RK1H8LC", paidAt: "2026-10-12 17:42", submittedAt: "2026-10-12 17:45" }),
               SUBS_ITEM({ id: "sub_r2", amount: 1000, status: "Rejected", code: "UJ1AB2CD3E", paidAt: "2026-10-08 19:20", reason: "This code isn't on the Chorale statement. Check you sent it to 0712 345 678.", submittedAt: "2026-10-08 19:25" }),
               SUBS_ITEM({ id: "sub_r4", amount: 600, status: "Confirmed", code: "UJ9XY7KL2M", paidAt: "2026-10-03 18:10", reason: "Split: Joy Wambui Ksh 400", submittedAt: "2026-10-03 18:12" })] },
  unpaid:    { status: "Unpaid", owes: true, paid: 0, balance: 1000, dueDate: SUBS_DEADLINE, dueReason: "Deadline", canCommit: true,
               commitment: { id: "sub_c0", amount: 1000, payBy: "2026-09-30", lapsed: true },
               items: [SUBS_ITEM({ id: "sub_c0", type: "Commitment", amount: 1000, status: "Approved", payBy: "2026-09-30", submittedAt: "2026-09-12 10:00" })] },
  committed: { status: "Committed", owes: true, paid: 0, balance: 1000, dueDate: SUBS_DEADLINE, dueReason: "Deadline", canCommit: false,
               commitment: { id: "sub_c1", amount: 1000, payBy: "2026-10-30", lapsed: false },
               items: [SUBS_ITEM({ id: "sub_c1", type: "Commitment", amount: 1000, status: "Approved", payBy: "2026-10-30", submittedAt: "2026-10-09 15:00" })] },
  paid:      { status: "Paid", owes: true, paid: 1000, balance: 0, dueDate: SUBS_DEADLINE, dueReason: "Deadline", items: [
               SUBS_ITEM({ id: "sub_r6", amount: 1000, status: "Confirmed", code: "UJ3PL0Q2ZX", paidAt: "2026-09-29 07:55", submittedAt: "2026-09-29 08:00" })] },
  notdue:    { status: "Not due yet", owes: false, paid: 0, balance: 0, items: [] },
  notready:  { ready: false, status: "Not set up", owes: false, paid: 0, balance: 0, items: [] },
};
function subsMine(key) {
  const v = SUBS_MINE[key]; if (!v) throw new Error("Subscriptions are for members - your account has no Members row.");
  return Object.assign({ year: SUBS_YEAR, fee: SUBS_FEE, deadline: SUBS_DEADLINE, ready: true, pendingAmount: 0, commitment: null, commitmentPending: false,
    canCommit: false, instructions: SUBS_SETTINGS.instructions, receivingNumbers: SUBS_SETTINGS.receivingNumbers, treasurers: ["Faith Kerubo"], dueDate: "", dueReason: "" }, v);
}
function subsCapsFor(state) {
  const k = state.subs;
  if (!k) return undefined;
  if (k === "treasurer") return { canView: true, canAct: true, canAppoint: true, scope: "all", section: "", treasurerPaused: false };
  if (k === "treasurerMember") return { canView: true, canAct: true, canAppoint: false, scope: "all", section: "", treasurerPaused: false };
  if (k === "section") return { canView: true, canAct: false, canAppoint: false, scope: "section", section: "Choir", treasurerPaused: false };
  if (k === "paused") return { canView: true, canAct: false, canAppoint: true, scope: "all", section: "", treasurerPaused: true };
  if (k === "superadmin") return { canView: true, canAct: false, canAppoint: false, scope: "all", section: "", treasurerPaused: false };
  return { canView: true, canAct: false, canAppoint: true, scope: "all", section: "", treasurerPaused: false };
}
function subsOverview(state) {
  const caps = subsCapsFor(state) || { canView: true, canAct: false, canAppoint: false, scope: "all", section: "" };
  const none = state.subsSetup === "none";
  const groupsOf = n => (PEOPLE.find(p => p.name === n) || {}).groups || [];
  let members = SUBS_MEMBERS.map(m => Object.assign({ pendingAmount: 0, commitment: null, commitmentPending: false, dueDate: "", dueReason: "" }, m, { groups: groupsOf(m.name) }));
  if (none) members = members.map(m => Object.assign({}, m, { status: "Not set up", paid: 0, balance: 0, dueDate: "", dueReason: "", pendingAmount: 0, commitment: null, commitmentPending: false }));
  if (caps.scope === "section") members = members.filter(m => m.groups.indexOf(caps.section) !== -1);
  const owing = ["Paid", "Part paid", "Committed", "Due", "Unpaid"], counts = {};
  let expected = 0, collected = 0, outstanding = 0, waiting = 0;
  members.forEach(m => {
    counts[m.status] = (counts[m.status] || 0) + 1; collected += m.paid;
    if (owing.indexOf(m.status) !== -1) { expected += SUBS_FEE; outstanding += m.balance; }
    waiting += (m.pendingAmount ? 1 : 0) + (m.commitmentPending ? 1 : 0);
  });
  const fee = none ? 0 : SUBS_FEE, deadline = none ? "" : SUBS_DEADLINE;
  const out = { year: SUBS_YEAR, fee, deadline, caps,
    summary: { owing: members.filter(m => owing.indexOf(m.status) !== -1).length, expected, collected, outstanding,
               percentPaid: expected ? Math.round(Math.min(collected, expected) * 100 / expected) : 0, counts, waiting },
    members, treasurers: SUBS_TREASURERS.map(t => caps.canAppoint ? Object.assign({}, t) : { name: t.name, appointedOn: t.appointedOn, appointedBy: t.appointedBy }),
    settings: { fee, deadline } };
  if (caps.canAct) {
    out.settings = none ? { fee: 0, deadline: "", receivingNumbers: [], instructions: "" } : SUBS_SETTINGS;
    out.queue = none ? [] : SUBS_QUEUE; out.recent = none ? [] : SUBS_RECENT;
  }
  return out;
}
const SUBS_READ = { ok: true, code: "UK9RK1H8LC", amount: 1000, name: "STRATHMORE CHORALE", number: "0712345678", date: "2026-10-14", time: "05:20" };
const SUBS_EMAIL = '<div style="font-family:Arial,sans-serif;background:#FBF7EE;padding:24px"><div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #E8DEC6">'
  + '<div style="background:#14110F;color:#FBF7EE;padding:22px 26px;font-family:Georgia,serif;font-style:italic;font-size:24px">Subscription<div style="font:13px Arial;color:#B5AC9D;font-style:normal;margin-top:6px">2025/26</div></div>'
  + '<div style="padding:22px 26px;font-size:13.5px;line-height:1.6;color:#2A2522"><p>Hi Brian,</p><p>This is a reminder about your <b>2025/26</b> Chorale subscription of Ksh 1,000.</p>'
  + '<p>Paid so far: <b>Ksh 600</b> of Ksh 1,000. Balance: <b>Ksh 400</b>. Due by <b>2025-11-30</b>.</p><p>Send Money to: 0712345678 (STRATHMORE CHORALE).</p></div></div></div>';
function subsFixtures(state) {
  return {
    getMySubscription: () => subsMine(state.mySubs),
    previewMpesaMessage: text => /Confirmed/i.test(text || "") ? Object.assign({ kind: "sent" }, SUBS_READ)
      : { ok: false, error: "That doesn't look like an M-Pesa Send Money confirmation. Paste the whole message, from the code to the date and time." },
    submitSubscriptionPayment: () => ({ success: true, id: "sub_new", code: "UK9RK1H8LC", amount: 1000 }),
    requestSubscriptionCommitment: () => ({ success: true, id: "sub_new" }),
    withdrawSubscriptionItem: () => ({ success: true }),
    getSubscriptionsOverview: () => subsOverview(state),
    previewTreasurerMpesaMessage: text => /Confirmed/i.test(text || "") ? Object.assign({ kind: "received" }, SUBS_READ, { name: "DENNIS OUMA", number: "0722***456" })
      : { ok: false, error: "That doesn't look like an M-Pesa confirmation. Paste the whole message as it arrived." },
    confirmSubscriptionPayment: () => ({ success: true, emailed: 1 }),
    rejectSubscriptionItem: () => ({ success: true, emailed: true }),
    approveSubscriptionCommitment: () => ({ success: true, emailed: true }),
    recordSubscriptionPayment: () => ({ success: true, id: "sub_new", emailed: true }),
    updateSubscriptionSettings: p => Object.assign({ success: true }, p),
    sendSubscriptionReminders: o => o && o.preview ? { count: 4, names: ["Brian Otieno", "Dennis Ouma", "Esther Njeri", "Victor Otieno"], sampleHtml: SUBS_EMAIL } : { success: true, sent: 4, failed: [] },
    appointTreasurer: () => ({ success: true, treasurers: SUBS_TREASURERS }),
    removeTreasurer: () => ({ success: true, treasurers: [] }),
  };
}

// scenario: "admin" | "member" | "member-failed" | "superadmin".
// state (set per screen by render.cjs, read lazily): { role: "sectionAdmin", year: "before"|"available"|"pending",
//   myApology: <MY_APOLOGY key>, emergency: "prominent"|"hidden", birthdays: "banner",
//   yearStart: "running"|"already" (Start in flight / pressed again), tplSave: "stale" (update refused) }
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
    getUserRole: () => { const r = roleFor(), c = subsCapsFor(state); return c ? Object.assign(r, { subscriptions: c }) : r; },
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
    // Off by default: the banner sits above every tab, so it only shows on the screens that ask for it.
    getTodaysBirthdaysForBanner: () => (state.birthdays === "banner" ? BIRTHDAY_BANNER : []),
    getBirthdayDashboard: birthdayDashboard,
    getScheduledEmails: () => [{ id: "c1", sendAt: "2026-10-16T06:00:00.000Z", status: "Scheduled", scheduledBy: SELF.email, subject: "Concert dress code", result: "", canCancel: true },
      { id: "c2", sendAt: "2026-10-09T06:00:00.000Z", status: "Sent", scheduledBy: SELF.email, subject: "Welcome back", result: "Sent to 104", canCancel: false }],
    getSignatureOptions: () => [{ key: "committee", label: "The Strathmore Chorale Committee", name: "The Strathmore Chorale Committee", title: "", email: "chorale@example.org", phone: "" }],
    getCommuniqueRecipientOptions: () => ({ groups: ["Choir", "Band", "Orchestra"], members: PEOPLE.map(p => ({ name: p.name, email: email(p.name), groups: p.groups })),
      signatures: [{ key: "committee", label: "The Strathmore Chorale Committee", name: "The Strathmore Chorale Committee", title: "", email: "chorale@example.org", phone: "" }], canSendAll: true }),
    // Communiqué drafts
    getCommuniqueDrafts: () => DRAFTS,
    getCommuniqueDraft: id => { const d = DRAFTS.find(x => x.id === id) || DRAFTS[0];
      return { id: d.id, kind: "draft", ownerEmail: d.ownerEmail, ownerName: d.ownerName, mine: d.mine, updatedAt: d.updatedAt, updatedLabel: d.updatedLabel,
        payload: { subject: d.subject, body: d.preview, recipientType: d.recipientType, groups: d.groups, members: [], attachments: [] }, missingAttachments: 0 }; },
    saveCommuniqueDraft: () => ({ success: true, id: "d1", updatedAt: Date.parse("2026-10-14T15:00:00+03:00"), savedLabel: "Wed 14 Oct · 15:00" }),
    deleteCommuniqueDraft: () => ({ success: true }),
    deleteCommuniqueAttachment: () => ({ success: true, kept: false, reason: "" }),
    // Communiqué templates. Only full admins edit others' templates; a section admin edits their own.
    getCommuniqueTemplates: () => TEMPLATES.map(t => templateRow(t, state.role !== "sectionAdmin")),
    getCommuniqueTemplate: id => { const t = TEMPLATES.find(x => x.id === id);
      if (!t) throw new Error("Template not found - it may have been deleted."); return templateFull(t, state.role !== "sectionAdmin"); },
    // state.tplSave = "stale": the update is refused as saved elsewhere, which shows the Save-as-new panel.
    saveCommuniqueTemplate: tpl => {
      if (state.tplSave === "stale" && tpl && tpl.id) throw new Error("This template was saved somewhere else (another tab, device or admin) at Wed 14 Oct · 14:52. " +
        "Reopen it to get the latest version, or save yours as a new template.");
      return { success: true, id: (tpl && tpl.id) || "tpl_4", updatedAt: Date.parse("2026-10-14T15:00:00+03:00"), savedLabel: "Wed 14 Oct · 15:00" };
    },
    // Activity log
    getActivityLog: () => ({ entries: ACTIVITY, actions: [...new Set(ACTIVITY.map(e => e.action))].sort(), total: ACTIVITY.length,
      actors: [...new Map(ACTIVITY.map(e => [e.actor, { email: e.actor, name: e.actorName }])).values()] }),
    // Chorale years
    getYearInfo: () => yearInfo(state, superAdmin),
    previewNewYear: () => newYearPlan(state),
    // state.yearStart = "running": Start stays in flight (the waiting state); "already": the backend's second-Start notice.
    startNewYear: label => state.yearStart === "running" ? HOLD : state.yearStart === "already"
      ? (() => { throw new Error("The new year is already being started - this takes a few minutes. Reload the page in a few minutes to see it."); })()
      : ({ success: true, label: label || "2026/27", previousLabel: "2025/26", startsOn: "2026-11-01", customStart: false,
      archiveUrl: "https://docs.google.com/spreadsheets/d/archive-2025-26", backupUrl: "https://drive.google.com/file/d/backup-2025-26",
      summary: "1840 attendance rows archived · 2 probations carried", warnings: [], message: "Started 2026/27." }),
    // Dark mode plumbing: the server preference. render.cjs overrides it per mode.
    getThemePreference: () => "system",
  };
  Object.assign(fx, subsFixtures(state));
  // Archived-year reads go through callForYear(label, fn, args) and return fn's own shape.
  fx.callForYear = (label, fn, args) => (fx[fn] ? fx[fn].apply(null, args || []) : (/^(get|list|count)/.test(fn) ? [] : { success: true }));
  return fx;
}

module.exports = { fixtures, FIXED_NOW, MY_APOLOGY, HOLD };
