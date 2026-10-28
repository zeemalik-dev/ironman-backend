import { Attendance } from '../models/Attendance.js';
import { Member } from '../models/Member.js';
import { Gym } from '../models/Gym.js';

/**
 * Returns YYYY-MM-DD string for a date in the given timezone (default Asia/Karachi),
 * respecting gym checkInCutoffHour and checkInCutoffMinute (e.g. if cutoff is 04:00 AM,
 * any time between 04:00 AM Today and 03:59 AM Tomorrow counts as "Today").
 */
export const getGymDateString = (
  date = new Date(),
  timezone = 'Asia/Karachi',
  cutoffHour = 0,
  cutoffMinute = 0
) => {
  const d = date instanceof Date ? new Date(date) : new Date(date);

  // If cutoff is not midnight (00:00), subtract cutoff offset from current time
  // so that the 24h operational cycle shifts seamlessly.
  // Example: if cutoff is 04:00 AM, at 02:00 AM on Oct 27, (02:00 - 4h) = 10:00 PM on Oct 26.
  if (cutoffHour > 0 || cutoffMinute > 0) {
    const offsetMs = (cutoffHour * 60 + cutoffMinute) * 60 * 1000;
    d.setTime(d.getTime() - offsetMs);
  }

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(d);
};

/**
 * Given a YYYY-MM-DD string and timezone, returns UTC startOfDay and endOfDay Date objects.
 */
export const getDayBounds = (dateStr, timezone = 'Asia/Karachi') => {
  const [y, m, d] = dateStr.split('-').map(Number);
  const testDate = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));

  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23',
  });

  const parts = fmt.formatToParts(testDate);
  const p = {};
  for (const part of parts) p[part.type] = part.value;
  const asDate = new Date(Date.UTC(p.year, p.month - 1, p.day, p.hour === '24' ? 0 : p.hour, p.minute, p.second));
  const offsetMs = asDate.getTime() - testDate.getTime();

  const startOfDay = new Date(testDate.getTime() - offsetMs);
  const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000 - 1);
  return { startOfDay, endOfDay };
};

/**
 * Shifts a YYYY-MM-DD string by delta days in the given timezone.
 */
export const shiftGymDate = (dateStr, daysDelta, timezone = 'Asia/Karachi') => {
  const bounds = getDayBounds(dateStr, timezone);
  const midDay = new Date(bounds.startOfDay.getTime() + 12 * 60 * 60 * 1000 + daysDelta * 24 * 60 * 60 * 1000);
  return getGymDateString(midDay, timezone);
};

export const checkIn = async (req, res) => {
  try {
    const gymId = req.gymId;
    const { identifier, timestamp } = req.body; // memberId, phone, or cnic

    if (!identifier) {
      return res.status(400).json({ success: false, message: 'Member ID, Phone, or CNIC required' });
    }

    const member = await Member.findOne({
      gymId,
      $or: [
        { memberId: identifier.trim() },
        { phone: identifier.trim() },
        { cnic: identifier.trim() },
      ],
    });

    if (!member) {
      return res.status(404).json({ success: false, message: 'Member not found in database' });
    }

    const gym = await Gym.findById(gymId).select('timezone settings');
    const timezone = gym?.timezone || 'Asia/Karachi';
    const cutoffHour = gym?.settings?.checkInCutoffHour ?? 0;
    const cutoffMinute = gym?.settings?.checkInCutoffMinute ?? 0;
    const punchDate = timestamp ? new Date(timestamp) : new Date();
    const todayStr = getGymDateString(punchDate, timezone, cutoffHour, cutoffMinute);

    // Check if member already checked in today
    const recentCheckIn = await Attendance.findOne({
      gymId,
      member: member._id,
      dateStr: todayStr,
    }).sort({ checkInTime: -1 });

    if (recentCheckIn) {
      return res.status(400).json({
        success: false,
        message: `${member.name} (${member.memberId}) is already checked in today.`,
        alreadyCheckedIn: true,
        attendance: recentCheckIn,
        member: {
          id: member._id,
          memberId: member.memberId,
          name: member.name,
          status: member.status,
          plan: member.plan,
          dueAmount: member.dueAmount,
          expiryDate: member.expiryDate,
          photoUrl: member.photoUrl,
        },
      });
    }

    const attendance = await Attendance.create({
      gymId,
      member: member._id,
      memberId: member.memberId,
      memberName: member.name,
      checkInTime: punchDate,
      dateStr: todayStr,
      statusSnapshot: member.status,
    });

    res.json({
      success: true,
      message: `Welcome, ${member.name}! Admission approved.`,
      attendance,
      member: {
        id: member._id,
        memberId: member.memberId,
        name: member.name,
        status: member.status,
        plan: member.plan,
        dueAmount: member.dueAmount,
        expiryDate: member.expiryDate,
        photoUrl: member.photoUrl,
      },
      warning:
        member.status === 'expired'
          ? 'Membership Expired!'
          : member.status === 'due'
          ? `Pending Dues: PKR ${member.dueAmount}`
          : member.status === 'frozen'
          ? 'Membership is currently frozen.'
          : null,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getAttendanceLogs = async (req, res) => {
  try {
    const gymId = req.gymId;
    const gym = await Gym.findById(gymId).select('timezone settings');
    const timezone = gym?.timezone || 'Asia/Karachi';
    const cutoffHour = gym?.settings?.checkInCutoffHour ?? 0;
    const cutoffMinute = gym?.settings?.checkInCutoffMinute ?? 0;

    const { date, limit = 50 } = req.query;
    const dateStr = date || getGymDateString(new Date(), timezone, cutoffHour, cutoffMinute);

    const logs = await Attendance.find({ gymId, dateStr })
      .sort({ checkInTime: -1 });

    // Deduplicate by member so a single member does not appear multiple times in a day
    const uniqueLogs = [];
    const seenMembers = new Map();

    for (const log of logs) {
      const key = log.member?.toString() || log.memberId;
      if (!seenMembers.has(key)) {
        const entry = log.toObject();
        entry.scanCount = 1;
        seenMembers.set(key, uniqueLogs.length);
        uniqueLogs.push(entry);
      } else {
        const index = seenMembers.get(key);
        uniqueLogs[index].scanCount = (uniqueLogs[index].scanCount || 1) + 1;
      }
    }

    const limitedLogs = uniqueLogs.slice(0, Number(limit));
    const totalToday = uniqueLogs.length;

    res.json({
      success: true,
      date: dateStr,
      count: limitedLogs.length,
      totalToday,
      totalScans: logs.length,
      logs: limitedLogs,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Historical Attendance & Absent Members
 * GET /api/attendance/history
 */
export const getAttendanceHistory = async (req, res) => {
  try {
    const gymId = req.gymId;
    const gym = await Gym.findById(gymId).select('timezone settings name');
    const timezone = gym?.timezone || 'Asia/Karachi';
    const cutoffHour = gym?.settings?.checkInCutoffHour ?? 0;
    const cutoffMinute = gym?.settings?.checkInCutoffMinute ?? 0;

    const {
      filter = 'today',
      preset,
      date,
      selectedDate: querySelectedDate,
      startDate: queryStartDate,
      endDate: queryEndDate,
      search = '',
      status = 'all', // 'all' | 'present' | 'absent'
    } = req.query;

    const activeFilter = (preset || filter || 'today').toLowerCase();
    const todayStr = getGymDateString(new Date(), timezone, cutoffHour, cutoffMinute);

    let rangeStartDate = todayStr;
    let rangeEndDate = todayStr;
    let targetSelectedDate = querySelectedDate || date || todayStr;

    switch (activeFilter) {
      case 'today':
        rangeStartDate = todayStr;
        rangeEndDate = todayStr;
        targetSelectedDate = todayStr;
        break;

      case 'yesterday': {
        const yest = shiftGymDate(todayStr, -1, timezone);
        rangeStartDate = yest;
        rangeEndDate = yest;
        targetSelectedDate = yest;
        break;
      }

      case 'last7days':
      case '7days':
      case 'weekly':
        rangeStartDate = shiftGymDate(todayStr, -6, timezone);
        rangeEndDate = todayStr;
        targetSelectedDate = querySelectedDate || todayStr;
        break;

      case 'last30days':
      case '30days':
      case 'monthly':
        rangeStartDate = shiftGymDate(todayStr, -29, timezone);
        rangeEndDate = todayStr;
        targetSelectedDate = querySelectedDate || todayStr;
        break;

      case 'custom':
        if (queryStartDate && queryEndDate) {
          rangeStartDate = queryStartDate;
          rangeEndDate = queryEndDate;
        } else if (queryStartDate) {
          rangeStartDate = queryStartDate;
          rangeEndDate = queryStartDate;
        } else if (date) {
          rangeStartDate = date;
          rangeEndDate = date;
        } else {
          rangeStartDate = todayStr;
          rangeEndDate = todayStr;
        }
        // Ensure range order
        if (rangeStartDate > rangeEndDate) {
          const tmp = rangeStartDate;
          rangeStartDate = rangeEndDate;
          rangeEndDate = tmp;
        }
        targetSelectedDate = querySelectedDate || rangeEndDate;
        break;

      default:
        rangeStartDate = todayStr;
        rangeEndDate = todayStr;
        targetSelectedDate = todayStr;
        break;
    }

    // Ensure selected date falls within range
    if (targetSelectedDate < rangeStartDate || targetSelectedDate > rangeEndDate) {
      targetSelectedDate = rangeEndDate;
    }

    // Generate list of dates in the range
    const datesList = [];
    let curDateStr = rangeStartDate;
    while (curDateStr <= rangeEndDate) {
      datesList.push(curDateStr);
      curDateStr = shiftGymDate(curDateStr, 1, timezone);
      if (datesList.length > 90) break; // safety guard
    }

    // Retrieve all gym members and attendances within range
    const { startOfDay: rangeStartUtc } = getDayBounds(rangeStartDate, timezone);
    const { endOfDay: rangeEndUtc } = getDayBounds(rangeEndDate, timezone);

    const [members, attendances] = await Promise.all([
      Member.find({ gymId }).lean(),
      Attendance.find({
        gymId,
        $or: [
          { dateStr: { $in: datesList } },
          { checkInTime: { $gte: rangeStartUtc, $lte: rangeEndUtc } },
        ],
      }).lean(),
    ]);

    // Build member lookup maps
    const memberById = new Map();
    const memberByCode = new Map();
    for (const mem of members) {
      if (mem._id) memberById.set(mem._id.toString(), mem);
      if (mem.memberId) memberByCode.set(String(mem.memberId).trim().toLowerCase(), mem);
    }

    // Helper to find member and exclude deleted records
    const resolveMember = (att) => {
      if (att.member && memberById.has(att.member.toString())) {
        return memberById.get(att.member.toString());
      }
      if (att.memberId && memberByCode.has(String(att.memberId).trim().toLowerCase())) {
        return memberByCode.get(String(att.memberId).trim().toLowerCase());
      }
      return null;
    };

    // Calculate attendance for each day in range
    const dailySummaries = [];
    let selectedDayDetails = null;

    for (const dayStr of datesList) {
      const { startOfDay: dayStartUtc, endOfDay: dayEndUtc } = getDayBounds(dayStr, timezone);

      // Find attendances matching this day
      const dayAttendances = attendances.filter((a) => {
        if (a.dateStr === dayStr) return true;
        if (a.checkInTime) {
          const t = new Date(a.checkInTime).getTime();
          return t >= dayStartUtc.getTime() && t <= dayEndUtc.getTime();
        }
        return false;
      });

      // Group by unique member (handle multiple check-ins)
      const presentMap = new Map();
      for (const a of dayAttendances) {
        const mem = resolveMember(a);
        if (!mem) {
          // Member deleted -> exclude from report!
          continue;
        }

        let entry = presentMap.get(mem._id.toString());
        if (!entry) {
          entry = {
            member: mem,
            checkIns: [],
            firstCheckIn: a.checkInTime,
            lastCheckIn: a.checkInTime,
          };
          presentMap.set(mem._id.toString(), entry);
        }
        entry.checkIns.push(a);
        if (new Date(a.checkInTime) < new Date(entry.firstCheckIn)) entry.firstCheckIn = a.checkInTime;
        if (new Date(a.checkInTime) > new Date(entry.lastCheckIn)) entry.lastCheckIn = a.checkInTime;
      }

      // Calculate absent members
      const absentMembers = [];
      for (const mem of members) {
        if (presentMap.has(mem._id.toString())) {
          continue; // Present
        }

        // Registration check: Exclude members who were not yet registered on dayStr
        const createdTime = mem.createdAt ? new Date(mem.createdAt).getTime() : null;
        const startTime = mem.startDate ? new Date(mem.startDate).getTime() : null;
        const regTime =
          createdTime && startTime
            ? Math.min(createdTime, startTime)
            : createdTime || startTime || 0;

        if (regTime > dayEndUtc.getTime()) {
          // Registered after this date -> Exclude!
          continue;
        }

        if (startTime && startTime > dayEndUtc.getTime()) {
          // Membership starts in future -> Exclude!
          continue;
        }

        // Eligibility / Expiry check:
        // Define eligibility based on membership validity on that date;
        // expired members should not automatically be counted as absent.
        const expiryTime = mem.expiryDate ? new Date(mem.expiryDate).getTime() : null;
        if (expiryTime && expiryTime < dayStartUtc.getTime()) {
          // Membership already expired before this date -> Not eligible/Not absent!
          continue;
        }

        // Frozen check: Frozen members are on hold, not counted as absent
        if (mem.status === 'frozen' || mem.frozen === true) {
          continue;
        }

        absentMembers.push(mem);
      }

      const presentCount = presentMap.size;
      const absentCount = absentMembers.length;
      const totalEligible = presentCount + absentCount;
      const attendancePercentage =
        totalEligible > 0 ? Number(((presentCount / totalEligible) * 100).toFixed(1)) : 0;

      const daySummary = {
        date: dayStr,
        totalEligible,
        present: presentCount,
        absent: absentCount,
        attendancePercentage,
        totalScans: dayAttendances.length,
      };

      dailySummaries.push(daySummary);

      // If this is the currently selected date, capture detailed lists
      if (dayStr === targetSelectedDate) {
        selectedDayDetails = {
          daySummary,
          presentMap,
          absentMembers,
        };
      }
    }

    // Fallback if selected day wasn't matched (shouldn't happen)
    if (!selectedDayDetails && dailySummaries.length > 0) {
      targetSelectedDate = dailySummaries[dailySummaries.length - 1].date;
      // Recalculate or pick last
      selectedDayDetails = {
        daySummary: dailySummaries[dailySummaries.length - 1],
        presentMap: new Map(),
        absentMembers: [],
      };
    }

    // Build member records for the selected date
    const presentListFormatted = Array.from(selectedDayDetails.presentMap.values()).map(
      (entry) => ({
        _id: entry.member._id,
        memberId: entry.member.memberId,
        name: entry.member.name,
        phone: entry.member.phone || '',
        status: entry.member.status || 'active',
        plan: entry.member.plan || 'monthly',
        photoUrl: entry.member.photoUrl || '',
        attendanceStatus: 'present',
        checkInCount: entry.checkIns.length,
        checkInTime: entry.lastCheckIn,
        firstCheckInTime: entry.firstCheckIn,
        expiryDate: entry.member.expiryDate,
        dueAmount: entry.member.dueAmount || 0,
      })
    );

    const absentListFormatted = selectedDayDetails.absentMembers.map((mem) => ({
      _id: mem._id,
      memberId: mem.memberId,
      name: mem.name,
      phone: mem.phone || '',
      status: mem.status || 'active',
      plan: mem.plan || 'monthly',
      photoUrl: mem.photoUrl || '',
      attendanceStatus: 'absent',
      checkInCount: 0,
      checkInTime: null,
      firstCheckInTime: null,
      expiryDate: mem.expiryDate,
      dueAmount: mem.dueAmount || 0,
    }));

    const allMembers = [...presentListFormatted, ...absentListFormatted];

    // Apply search and status filters for the member list
    let filteredMembers = allMembers;

    if (status && status !== 'all') {
      filteredMembers = filteredMembers.filter(
        (m) => m.attendanceStatus.toLowerCase() === status.toLowerCase()
      );
    }

    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      filteredMembers = filteredMembers.filter(
        (m) =>
          String(m.name || '').toLowerCase().includes(q) ||
          String(m.memberId || '').toLowerCase().includes(q) ||
          String(m.phone || '').toLowerCase().includes(q)
      );
    }

    // Period aggregate summary
    const totalPresentScans = dailySummaries.reduce((sum, d) => sum + d.present, 0);
    const avgAttendancePercentage =
      dailySummaries.length > 0
        ? Number(
            (
              dailySummaries.reduce((sum, d) => sum + d.attendancePercentage, 0) /
              dailySummaries.length
            ).toFixed(1)
          )
        : 0;

    res.json({
      success: true,
      gymName: gym?.name || 'Iron Man Gym',
      timezone,
      today: todayStr,
      filter: activeFilter,
      range: {
        startDate: rangeStartDate,
        endDate: rangeEndDate,
      },
      selectedDate: targetSelectedDate,
      summary: selectedDayDetails.daySummary,
      periodSummary: {
        daysCount: datesList.length,
        avgAttendancePercentage,
        totalPresentSum: totalPresentScans,
        peakAttendanceDay: dailySummaries.reduce(
          (peak, cur) => (cur.present > (peak?.present || -1) ? cur : peak),
          null
        ),
      },
      dailySummaries,
      counts: {
        totalEligible: selectedDayDetails.daySummary.totalEligible,
        present: presentListFormatted.length,
        absent: absentListFormatted.length,
        all: allMembers.length,
        filtered: filteredMembers.length,
      },
      members: filteredMembers,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

