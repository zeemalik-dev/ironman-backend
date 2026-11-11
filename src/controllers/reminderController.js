import { Member } from '../models/Member.js';
import { Gym } from '../models/Gym.js';

/**
 * Calculates reminder metadata for a member record.
 */
const enrichMemberReminder = (memberDoc, gymName, startOfToday, windowEnd) => {
  const mem = memberDoc.toObject ? memberDoc.toObject() : { ...memberDoc };
  const expiry = new Date(mem.expiryDate);
  const reminderTypes = [];

  let daysRemaining = null;
  let daysExpired = null;

  if (expiry < startOfToday) {
    reminderTypes.push('expired');
    daysExpired = Math.max(1, Math.floor((startOfToday.getTime() - expiry.getTime()) / (1000 * 60 * 60 * 24)));
  } else if (expiry <= windowEnd) {
    reminderTypes.push('expiring_soon');
    daysRemaining = Math.max(0, Math.ceil((expiry.getTime() - startOfToday.getTime()) / (1000 * 60 * 60 * 24)));
  }

  if (Number(mem.dueAmount) > 0) {
    reminderTypes.push('payment_due');
  }

  // Primary reminder type based on priority
  let primaryReminderType = 'none';
  if (reminderTypes.includes('payment_due') && reminderTypes.includes('expired')) {
    primaryReminderType = 'expired';
  } else if (reminderTypes.includes('expired')) {
    primaryReminderType = 'expired';
  } else if (reminderTypes.includes('expiring_soon')) {
    primaryReminderType = 'expiring_soon';
  } else if (reminderTypes.includes('payment_due')) {
    primaryReminderType = 'payment_due';
  }

  return {
    ...mem,
    gymName,
    reminderType: primaryReminderType,
    reminderTypes,
    daysRemaining,
    daysExpired,
  };
};

/**
 * GET /api/reminders/summary
 * Returns total counts for summary cards.
 */
export const getRemindersSummary = async (req, res) => {
  try {
    const gymId = req.gymId;
    let daysNum = req.query.days !== undefined ? Number(req.query.days) : undefined;

    if (daysNum === undefined || isNaN(daysNum)) {
      const gym = await Gym.findById(gymId).select('settings');
      daysNum = gym?.settings?.reminderDaysBeforeExpiry || 7;
    }

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const windowEnd = new Date(startOfToday.getTime() + (daysNum + 1) * 24 * 60 * 60 * 1000 - 1);

    const [expiringSoonCount, expiredCount, paymentDueCount, totalToContactCount] = await Promise.all([
      Member.countDocuments({
        gymId,
        expiryDate: { $gte: startOfToday, $lte: windowEnd },
      }),
      Member.countDocuments({
        gymId,
        expiryDate: { $lt: startOfToday },
        status: { $nin: ['due', 'frozen'] },
      }),
      Member.countDocuments({
        gymId,
        status: { $ne: 'frozen' },
        $or: [{ dueAmount: { $gt: 0 } }, { status: 'due' }],
      }),
      Member.countDocuments({
        gymId,
        status: { $ne: 'frozen' },
        $or: [
          { expiryDate: { $gte: startOfToday, $lte: windowEnd } },
          { expiryDate: { $lt: startOfToday } },
          { dueAmount: { $gt: 0 } },
          { status: 'due' },
        ],
      }),
    ]);

    res.json({
      success: true,
      summary: {
        expiringSoon: expiringSoonCount,
        expired: expiredCount,
        paymentDue: paymentDueCount,
        totalToContact: totalToContactCount,
        windowDays: daysNum,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /api/reminders
 * Returns filtered list of members requiring reminders with detailed calculations.
 */
export const getReminders = async (req, res) => {
  try {
    const gymId = req.gymId;
    const {
      type = 'all', // 'all' | 'expiring' | 'expired' | 'due'
      days,
      q,
      status,
      limit = 100,
      page = 1,
    } = req.query;

    // Fetch gym name & settings
    const gym = await Gym.findById(gymId).select('name currency phone settings');
    const gymName = gym?.name || 'Iron Man Gym';

    let daysNum = days !== undefined ? Number(days) : (gym?.settings?.reminderDaysBeforeExpiry || 7);
    if (isNaN(daysNum)) daysNum = 7;

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const windowEnd = new Date(startOfToday.getTime() + (daysNum + 1) * 24 * 60 * 60 * 1000 - 1);

    // Base query with tenant isolation
    const query = { gymId };

    // Status filter
    if (status && status !== 'all') {
      query.status = status;
    }

    // Search filter
    if (q) {
      query.$or = [
        { name: { $regex: q, $options: 'i' } },
        { memberId: { $regex: q, $options: 'i' } },
        { phone: { $regex: q, $options: 'i' } },
        { cnic: { $regex: q, $options: 'i' } },
      ];
    }

    // Category filter
    if (type === 'expiring') {
      query.expiryDate = { $gte: startOfToday, $lte: windowEnd };
    } else if (type === 'expired') {
      query.expiryDate = { $lt: startOfToday };
      if (!query.status) {
        query.status = { $nin: ['due', 'frozen'] };
      }
    } else if (type === 'due') {
      const dueCondition = [{ dueAmount: { $gt: 0 } }, { status: 'due' }];
      if (query.$or) {
        query.$and = [{ $or: query.$or }, { $or: dueCondition }];
        delete query.$or;
      } else {
        query.$or = dueCondition;
      }
    } else {
      // 'all' reminder types: must match at least one reminder condition
      const reminderCondition = [
        { expiryDate: { $gte: startOfToday, $lte: windowEnd } },
        { expiryDate: { $lt: startOfToday } },
        { dueAmount: { $gt: 0 } },
        { status: 'due' },
      ];

      if (query.$or) {
        query.$and = [{ $or: query.$or }, { $or: reminderCondition }];
        delete query.$or;
      } else {
        query.$or = reminderCondition;
      }
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [members, total, summaryExpiring, summaryExpired, summaryDue, summaryTotal] = await Promise.all([
      Member.find(query).sort({ expiryDate: 1, dueAmount: -1 }).skip(skip).limit(Number(limit)),
      Member.countDocuments(query),
      Member.countDocuments({ gymId, expiryDate: { $gte: startOfToday, $lte: windowEnd } }),
      Member.countDocuments({ gymId, expiryDate: { $lt: startOfToday }, status: { $nin: ['due', 'frozen'] } }),
      Member.countDocuments({ gymId, status: { $ne: 'frozen' }, $or: [{ dueAmount: { $gt: 0 } }, { status: 'due' }] }),
      Member.countDocuments({
        gymId,
        status: { $ne: 'frozen' },
        $or: [
          { expiryDate: { $gte: startOfToday, $lte: windowEnd } },
          { expiryDate: { $lt: startOfToday } },
          { dueAmount: { $gt: 0 } },
          { status: 'due' },
        ],
      }),
    ]);

    const enrichedReminders = members.map((mem) =>
      enrichMemberReminder(mem, gymName, startOfToday, windowEnd)
    );

    res.json({
      success: true,
      total,
      count: enrichedReminders.length,
      gymName,
      currency: gym?.currency || 'PKR',
      summary: {
        expiringSoon: summaryExpiring,
        expired: summaryExpired,
        paymentDue: summaryDue,
        totalToContact: summaryTotal,
        windowDays: daysNum,
      },
      reminders: enrichedReminders,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
