import mongoose from 'mongoose';
import { Member } from '../models/Member.js';
import { Attendance } from '../models/Attendance.js';
import { Payment } from '../models/Payment.js';
import { Expense } from '../models/Expense.js';
import { Gym } from '../models/Gym.js';
import { User } from '../models/User.js';
import { Trainer } from '../models/Trainer.js';
import { Equipment } from '../models/Equipment.js';
import { Plan } from '../models/Plan.js';
import { CashClosing } from '../models/CashClosing.js';

/**
 * Utility helper to resolve date range boundaries based on period/preset or custom range.
 */
export const resolveDateRange = (preset = 'monthly', customStart, customEnd, options = {}) => {
  const now = new Date();
  let startDate = new Date();
  let endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  const normalizedPeriod = (preset || 'monthly').toLowerCase();

  switch (normalizedPeriod) {
    case 'daily':
    case 'today': {
      const baseDate = options.date || customStart ? new Date(options.date || customStart) : now;
      startDate = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), 0, 0, 0, 0);
      endDate = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), 23, 59, 59, 999);
      break;
    }

    case 'weekly':
    case 'this_week': {
      const baseDate = options.date || customStart ? new Date(options.date || customStart) : now;
      const day = baseDate.getDay();
      const diff = baseDate.getDate() - day + (day === 0 ? -6 : 1); // Monday start
      startDate = new Date(baseDate.getFullYear(), baseDate.getMonth(), diff, 0, 0, 0, 0);
      endDate = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + 6, 23, 59, 59, 999);
      break;
    }

    case 'monthly':
    case 'this_month': {
      let targetYear = now.getFullYear();
      let targetMonth = now.getMonth();
      if (options.year !== undefined && options.month !== undefined) {
        targetYear = parseInt(options.year, 10);
        targetMonth = parseInt(options.month, 10) - 1;
      } else if (customStart) {
        const d = new Date(customStart);
        targetYear = d.getFullYear();
        targetMonth = d.getMonth();
      }
      startDate = new Date(targetYear, targetMonth, 1, 0, 0, 0, 0);
      endDate = new Date(targetYear, targetMonth + 1, 0, 23, 59, 59, 999);
      break;
    }

    case 'last_month':
      startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
      endDate = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
      break;

    case 'last_3_months':
      startDate = new Date(now.getFullYear(), now.getMonth() - 2, 1, 0, 0, 0, 0);
      break;

    case 'last_6_months':
      startDate = new Date(now.getFullYear(), now.getMonth() - 5, 1, 0, 0, 0, 0);
      break;

    case 'yearly':
    case 'this_year': {
      let targetYear = now.getFullYear();
      if (options.year) {
        targetYear = parseInt(options.year, 10);
      } else if (customStart) {
        targetYear = new Date(customStart).getFullYear();
      }
      startDate = new Date(targetYear, 0, 1, 0, 0, 0, 0);
      endDate = new Date(targetYear, 11, 31, 23, 59, 59, 999);
      break;
    }

    case 'custom':
      if (customStart) {
        startDate = new Date(customStart);
        startDate.setHours(0, 0, 0, 0);
      } else {
        startDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      }
      if (customEnd) {
        endDate = new Date(customEnd);
        endDate.setHours(23, 59, 59, 999);
      }
      break;

    default:
      startDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      break;
  }

  return { startDate, endDate, preset: normalizedPeriod };
};

/**
 * Generates an array of YYYY-MM-DD date strings covering every single day from startDate to endDate
 */
export const generateDateTimeline = (startDate, endDate) => {
  const dates = [];
  const curr = new Date(startDate);
  const end = new Date(endDate);
  curr.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);

  let count = 0;
  while (curr <= end && count < 370) {
    const year = curr.getFullYear();
    const month = String(curr.getMonth() + 1).padStart(2, '0');
    const day = String(curr.getDate()).padStart(2, '0');
    dates.push(`${year}-${month}-${day}`);
    curr.setDate(curr.getDate() + 1);
    count++;
  }
  return dates;
};

/**
 * 1. GET /api/reports/overview
 * Global operational and financial snapshot for Gym Owner
 */
export const getReportsOverview = async (req, res) => {
  try {
    const gymId = req.gymId;
    const gymObjectId = mongoose.Types.ObjectId.isValid(gymId)
      ? new mongoose.Types.ObjectId(gymId)
      : gymId;

    const { preset, period, startDate: customStart, endDate: customEnd, date, month, year } = req.query;
    const { startDate, endDate } = resolveDateRange(period || preset, customStart, customEnd, { date, month, year });
    const startStr = startDate.toISOString().split('T')[0];
    const endStr = endDate.toISOString().split('T')[0];

    const [
      incomeAgg,
      expenseAgg,
      activeMembersCount,
      totalMembersCount,
      newMembersInPeriod,
      renewalsInPeriod,
      pendingDuesAgg,
      attendanceCount,
      uniqueAttendeesAgg,
      paymentMethodsAgg,
      expenseCategoriesAgg,
      revenueTimeTrend,
      expenseTimeTrend,
      attendanceDailyTrend,
      cashClosingsInPeriod,
    ] = await Promise.all([
      Payment.aggregate([
        { $match: { gymId: gymObjectId, paidOn: { $gte: startDate, $lte: endDate } } },
        { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]),

      Expense.aggregate([
        { $match: { gymId: gymObjectId, spentOn: { $gte: startDate, $lte: endDate } } },
        { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]),

      Member.countDocuments({ gymId, status: 'active' }),
      Member.countDocuments({ gymId }),
      Member.countDocuments({ gymId, createdAt: { $gte: startDate, $lte: endDate } }),
      Payment.countDocuments({ gymId, paymentType: 'renewal', paidOn: { $gte: startDate, $lte: endDate } }),

      Member.aggregate([
        { $match: { gymId: gymObjectId, dueAmount: { $gt: 0 } } },
        { $group: { _id: null, total: { $sum: '$dueAmount' }, count: { $sum: 1 } } },
      ]),

      Attendance.countDocuments({ gymId, checkInTime: { $gte: startDate, $lte: endDate } }),

      Attendance.aggregate([
        { $match: { gymId: gymObjectId, checkInTime: { $gte: startDate, $lte: endDate } } },
        { $group: { _id: '$memberId' } },
        { $count: 'uniqueCount' },
      ]),

      Payment.aggregate([
        { $match: { gymId: gymObjectId, paidOn: { $gte: startDate, $lte: endDate } } },
        { $group: { _id: '$method', total: { $sum: '$amount' }, count: { $sum: 1 } } },
        { $sort: { total: -1 } },
      ]),

      Expense.aggregate([
        { $match: { gymId: gymObjectId, spentOn: { $gte: startDate, $lte: endDate } } },
        { $group: { _id: '$category', total: { $sum: '$amount' }, count: { $sum: 1 } } },
        { $sort: { total: -1 } },
      ]),

      Payment.aggregate([
        { $match: { gymId: gymObjectId, paidOn: { $gte: startDate, $lte: endDate } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$paidOn' } },
            amount: { $sum: '$amount' },
          },
        },
        { $sort: { _id: 1 } },
      ]),

      Expense.aggregate([
        { $match: { gymId: gymObjectId, spentOn: { $gte: startDate, $lte: endDate } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$spentOn' } },
            amount: { $sum: '$amount' },
          },
        },
        { $sort: { _id: 1 } },
      ]),

      Attendance.aggregate([
        { $match: { gymId: gymObjectId, checkInTime: { $gte: startDate, $lte: endDate } } },
        {
          $group: {
            _id: '$dateStr',
            checkIns: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),

      CashClosing.find({
        gymId,
        dateStr: { $gte: startStr, $lte: endStr },
      }),
    ]);

    const totalIncome = incomeAgg[0]?.total || 0;
    const totalExpenses = expenseAgg[0]?.total || 0;
    const netProfit = totalIncome - totalExpenses;
    const profitMargin = totalIncome > 0 ? ((netProfit / totalIncome) * 100).toFixed(1) : 0;
    const outstandingDues = pendingDuesAgg[0]?.total || 0;
    const dueMembersCount = pendingDuesAgg[0]?.count || 0;
    const uniqueAttendees = uniqueAttendeesAgg[0]?.uniqueCount || 0;

    const retentionRate = totalMembersCount > 0 ? ((activeMembersCount / totalMembersCount) * 100).toFixed(1) : 100;

    let totalCashDifference = 0;
    let closedDaysCount = cashClosingsInPeriod.length;
    let balancedDaysCount = 0;
    let shortDaysCount = 0;
    let excessDaysCount = 0;
    cashClosingsInPeriod.forEach((c) => {
      totalCashDifference += (c.difference || 0);
      if (c.status === 'short') shortDaysCount++;
      else if (c.status === 'excess') excessDaysCount++;
      else balancedDaysCount++;
    });

    // Populate every day in the range for smooth continuous Area Chart waves
    const allDates = generateDateTimeline(startDate, endDate);
    const trendMap = {};
    allDates.forEach((d) => {
      trendMap[d] = { date: d, income: 0, expense: 0, net: 0 };
    });
    revenueTimeTrend.forEach((item) => {
      if (trendMap[item._id]) {
        trendMap[item._id].income = item.amount;
        trendMap[item._id].net = item.amount - trendMap[item._id].expense;
      }
    });
    expenseTimeTrend.forEach((item) => {
      if (trendMap[item._id]) {
        trendMap[item._id].expense = item.amount;
        trendMap[item._id].net = trendMap[item._id].income - item.amount;
      }
    });
    const revenueExpenseTrend = Object.values(trendMap).sort((a, b) => a.date.localeCompare(b.date));

    res.json({
      success: true,
      data: {
        filter: { period: period || preset || 'monthly', startDate, endDate, startStr, endStr },
        summary: {
          totalIncome,
          totalExpenses,
          netProfit,
          profitMargin: Number(profitMargin),
          activeMembers: activeMembersCount,
          totalMembers: totalMembersCount,
          newMembers: newMembersInPeriod,
          renewals: renewalsInPeriod,
          outstandingDues,
          dueMembersCount,
          attendance: attendanceCount,
          uniqueAttendees,
          retentionRate: Number(retentionRate),
          cashDifference: totalCashDifference,
          cashClosing: {
            closedDays: closedDaysCount,
            totalDifference: totalCashDifference,
            balancedDays: balancedDaysCount,
            shortDays: shortDaysCount,
            excessDays: excessDaysCount,
          },
        },
        revenueExpenseTrend,
        attendanceDailyTrend,
        paymentMethods: paymentMethodsAgg.map((p) => ({
          method: p._id || 'cash',
          amount: p.total,
          count: p.count,
        })),
        expenseCategories: expenseCategoriesAgg.map((e) => ({
          category: e._id || 'utilities',
          amount: e.total,
          count: e.count,
        })),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 2. GET /api/reports/income-expense
 */
export const getIncomeExpenseReport = async (req, res) => {
  try {
    const gymId = req.gymId;
    const gymObjectId = mongoose.Types.ObjectId.isValid(gymId)
      ? new mongoose.Types.ObjectId(gymId)
      : gymId;

    const { preset, period, startDate: customStart, endDate: customEnd, date, month, year, limit = 50 } = req.query;
    const { startDate, endDate } = resolveDateRange(period || preset, customStart, customEnd, { date, month, year });
    const diffDays = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));

    const [
      incomeAgg,
      expenseAgg,
      paymentMethodsAgg,
      expenseCategoriesAgg,
      incomeTransactions,
      expenseTransactions,
      dailyCashflow,
    ] = await Promise.all([
      Payment.aggregate([
        { $match: { gymId: gymObjectId, paidOn: { $gte: startDate, $lte: endDate } } },
        { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]),

      Expense.aggregate([
        { $match: { gymId: gymObjectId, spentOn: { $gte: startDate, $lte: endDate } } },
        { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]),

      Payment.aggregate([
        { $match: { gymId: gymObjectId, paidOn: { $gte: startDate, $lte: endDate } } },
        { $group: { _id: '$method', total: { $sum: '$amount' }, count: { $sum: 1 } } },
        { $sort: { total: -1 } },
      ]),

      Expense.aggregate([
        { $match: { gymId: gymObjectId, spentOn: { $gte: startDate, $lte: endDate } } },
        { $group: { _id: '$category', total: { $sum: '$amount' }, count: { $sum: 1 } } },
        { $sort: { total: -1 } },
      ]),

      Payment.find({ gymId, paidOn: { $gte: startDate, $lte: endDate } })
        .sort({ paidOn: -1 })
        .limit(Number(limit)),

      Expense.find({ gymId, spentOn: { $gte: startDate, $lte: endDate } })
        .sort({ spentOn: -1 })
        .limit(Number(limit)),

      Promise.all([
        Payment.aggregate([
          { $match: { gymId: gymObjectId, paidOn: { $gte: startDate, $lte: endDate } } },
          { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$paidOn' } }, total: { $sum: '$amount' } } },
        ]),
        Expense.aggregate([
          { $match: { gymId: gymObjectId, spentOn: { $gte: startDate, $lte: endDate } } },
          { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$spentOn' } }, total: { $sum: '$amount' } } },
        ]),
      ]),
    ]);

    const grossIncome = incomeAgg[0]?.total || 0;
    const totalExpenses = expenseAgg[0]?.total || 0;
    const netProfit = grossIncome - totalExpenses;
    const profitMargin = grossIncome > 0 ? ((netProfit / grossIncome) * 100).toFixed(1) : 0;
    const avgDailyIncome = Math.round(grossIncome / diffDays);
    const avgDailyExpense = Math.round(totalExpenses / diffDays);

    const [revDays, expDays] = dailyCashflow;
    const allDates = generateDateTimeline(startDate, endDate);
    const trendMap = {};
    allDates.forEach((d) => {
      trendMap[d] = { date: d, income: 0, expense: 0, net: 0 };
    });
    revDays.forEach((r) => {
      if (trendMap[r._id]) {
        trendMap[r._id].income = r.total;
        trendMap[r._id].net = r.total - trendMap[r._id].expense;
      }
    });
    expDays.forEach((e) => {
      if (trendMap[e._id]) {
        trendMap[e._id].expense = e.total;
        trendMap[e._id].net = trendMap[e._id].income - e.total;
      }
    });

    res.json({
      success: true,
      data: {
        filter: { preset, startDate, endDate, diffDays },
        kpis: {
          grossIncome,
          totalExpenses,
          netProfit,
          profitMargin: Number(profitMargin),
          avgDailyIncome,
          avgDailyExpense,
          incomeTransactionsCount: incomeAgg[0]?.count || 0,
          expenseTransactionsCount: expenseAgg[0]?.count || 0,
        },
        paymentMethods: paymentMethodsAgg.map((p) => ({
          method: p._id || 'cash',
          amount: p.total,
          count: p.count,
        })),
        expenseCategories: expenseCategoriesAgg.map((e) => ({
          category: e._id || 'utilities',
          amount: e.total,
          count: e.count,
        })),
        dailyCashflow: Object.values(trendMap).sort((a, b) => a.date.localeCompare(b.date)),
        incomeTransactions,
        expenseTransactions,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 3. GET /api/reports/members
 */
export const getMembersReport = async (req, res) => {
  try {
    const gymId = req.gymId;
    const gymObjectId = mongoose.Types.ObjectId.isValid(gymId)
      ? new mongoose.Types.ObjectId(gymId)
      : gymId;

    const { preset, period, startDate: customStart, endDate: customEnd, date, month, year, limit = 100 } = req.query;
    const { startDate, endDate } = resolveDateRange(period || preset, customStart, customEnd, { date, month, year });

    const [
      totalMembers,
      activeMembers,
      dueMembers,
      expiredMembers,
      frozenMembers,
      newAdmissions,
      renewalsCount,
      plansDistribution,
      membersList,
      memberGrowthTimelineAgg,
    ] = await Promise.all([
      Member.countDocuments({ gymId }),
      Member.countDocuments({ gymId, status: 'active' }),
      Member.countDocuments({ gymId, dueAmount: { $gt: 0 } }),
      Member.countDocuments({ gymId, status: 'expired' }),
      Member.countDocuments({ gymId, status: 'frozen' }),
      Member.countDocuments({ gymId, createdAt: { $gte: startDate, $lte: endDate } }),
      Payment.countDocuments({ gymId, paymentType: 'renewal', paidOn: { $gte: startDate, $lte: endDate } }),
      Member.aggregate([
        { $match: { gymId: gymObjectId } },
        { $group: { _id: '$plan', count: { $sum: 1 }, totalRevenue: { $sum: '$paidAmount' } } },
        { $sort: { count: -1 } },
      ]),
      Member.find({ gymId })
        .sort({ createdAt: -1 })
        .limit(Number(limit))
        .select('memberId name phone cnic plan status startDate expiryDate totalAmount paidAmount dueAmount photoUrl'),
      Member.aggregate([
        { $match: { gymId: gymObjectId, createdAt: { $gte: startDate, $lte: endDate } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            newEnrolled: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
    ]);

    const allDates = generateDateTimeline(startDate, endDate);
    const memberMap = {};
    allDates.forEach((d) => {
      memberMap[d] = { _id: d, newEnrolled: 0 };
    });
    memberGrowthTimelineAgg.forEach((item) => {
      if (memberMap[item._id]) {
        memberMap[item._id].newEnrolled = item.newEnrolled;
      }
    });
    const memberGrowthTimeline = Object.values(memberMap).sort((a, b) => a._id.localeCompare(b._id));

    res.json({
      success: true,
      data: {
        filter: { period: period || preset || 'monthly', startDate, endDate },
        kpis: {
          totalMembers,
          activeMembers,
          dueMembers,
          expiredMembers,
          frozenMembers,
          newAdmissions,
          renewalsCount,
        },
        statusDistribution: [
          { name: 'Active', count: activeMembers, fill: '#10b981' },
          { name: 'Dues Pending', count: dueMembers, fill: '#f59e0b' },
          { name: 'Expired', count: expiredMembers, fill: '#ef4444' },
          { name: 'Frozen', count: frozenMembers, fill: '#6366f1' },
        ],
        plansDistribution: plansDistribution.map((p) => ({
          plan: p._id || 'monthly',
          count: p.count,
          totalRevenue: p.totalRevenue,
        })),
        memberGrowthTimeline,
        membersList,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 4. GET /api/reports/dues
 */
export const getDuesReport = async (req, res) => {
  try {
    const gymId = req.gymId;
    const gymObjectId = mongoose.Types.ObjectId.isValid(gymId)
      ? new mongoose.Types.ObjectId(gymId)
      : gymId;

    const { preset, startDate: customStart, endDate: customEnd, limit = 100 } = req.query;
    const { startDate, endDate } = resolveDateRange(preset, customStart, customEnd);

    const [
      totalDuesAgg,
      collectedDuesInPeriod,
      duesByPlanAgg,
      duesByStatusAgg,
      dueMembersList,
    ] = await Promise.all([
      Member.aggregate([
        { $match: { gymId: gymObjectId, dueAmount: { $gt: 0 } } },
        {
          $group: {
            _id: null,
            totalDue: { $sum: '$dueAmount' },
            count: { $sum: 1 },
            avgDue: { $avg: '$dueAmount' },
          },
        },
      ]),

      Payment.aggregate([
        {
          $match: {
            gymId: gymObjectId,
            paymentType: { $in: ['due_clearance', 'membership'] },
            paidOn: { $gte: startDate, $lte: endDate },
          },
        },
        { $group: { _id: null, totalCollected: { $sum: '$amount' } } },
      ]),

      Member.aggregate([
        { $match: { gymId: gymObjectId, dueAmount: { $gt: 0 } } },
        { $group: { _id: '$plan', totalDue: { $sum: '$dueAmount' }, count: { $sum: 1 } } },
        { $sort: { totalDue: -1 } },
      ]),

      Member.aggregate([
        { $match: { gymId: gymObjectId, dueAmount: { $gt: 0 } } },
        { $group: { _id: '$status', totalDue: { $sum: '$dueAmount' }, count: { $sum: 1 } } },
      ]),

      Member.find({ gymId, dueAmount: { $gt: 0 } })
        .sort({ dueAmount: -1 })
        .limit(Number(limit))
        .select('memberId name phone plan totalAmount paidAmount dueAmount expiryDate status notes'),
    ]);

    const totalOutstandingDues = totalDuesAgg[0]?.totalDue || 0;
    const membersWithDues = totalDuesAgg[0]?.count || 0;
    const avgOutstandingAmount = Math.round(totalDuesAgg[0]?.avgDue || 0);
    const duesCollectedInPeriod = collectedDuesInPeriod[0]?.totalCollected || 0;

    res.json({
      success: true,
      data: {
        filter: { preset, startDate, endDate },
        kpis: {
          totalOutstandingDues,
          membersWithDues,
          avgOutstandingAmount,
          duesCollectedInPeriod,
        },
        duesByPlan: duesByPlanAgg.map((d) => ({
          plan: d._id || 'monthly',
          totalDue: d.totalDue,
          count: d.count,
        })),
        duesByStatus: duesByStatusAgg.map((d) => ({
          status: d._id || 'due',
          totalDue: d.totalDue,
          count: d.count,
        })),
        dueMembersList,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 5. GET /api/reports/attendance
 */
export const getAttendanceReport = async (req, res) => {
  try {
    const gymId = req.gymId;
    const gymObjectId = mongoose.Types.ObjectId.isValid(gymId)
      ? new mongoose.Types.ObjectId(gymId)
      : gymId;

    const { preset, startDate: customStart, endDate: customEnd, limit = 60 } = req.query;
    const { startDate, endDate } = resolveDateRange(preset, customStart, customEnd);

    const [
      totalCheckIns,
      uniqueMembersAgg,
      dailyTrend,
      hourlyDistribution,
      recentCheckIns,
    ] = await Promise.all([
      Attendance.countDocuments({ gymId, checkInTime: { $gte: startDate, $lte: endDate } }),

      Attendance.aggregate([
        { $match: { gymId: gymObjectId, checkInTime: { $gte: startDate, $lte: endDate } } },
        { $group: { _id: '$memberId' } },
        { $count: 'uniqueCount' },
      ]),

      Attendance.aggregate([
        { $match: { gymId: gymObjectId, checkInTime: { $gte: startDate, $lte: endDate } } },
        {
          $group: {
            _id: '$dateStr',
            count: { $sum: 1 },
            uniqueMembers: { $addToSet: '$memberId' },
          },
        },
        {
          $project: {
            date: '$_id',
            count: 1,
            uniqueCount: { $size: '$uniqueMembers' },
          },
        },
        { $sort: { _id: -1 } },
        { $limit: Number(limit) },
      ]),

      Attendance.aggregate([
        { $match: { gymId: gymObjectId, checkInTime: { $gte: startDate, $lte: endDate } } },
        {
          $group: {
            _id: { $hour: '$checkInTime' },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),

      Attendance.find({ gymId, checkInTime: { $gte: startDate, $lte: endDate } })
        .sort({ checkInTime: -1 })
        .limit(30),
    ]);

    const allDates = generateDateTimeline(startDate, endDate);
    const attMap = {};
    allDates.forEach((d) => {
      attMap[d] = { date: d, count: 0, uniqueCount: 0 };
    });
    dailyTrend.forEach((item) => {
      if (attMap[item.date]) {
        attMap[item.date].count = item.count;
        attMap[item.date].uniqueCount = item.uniqueCount;
      }
    });
    const filledDailyTrend = Object.values(attMap).sort((a, b) => a.date.localeCompare(b.date));

    const uniqueMembers = uniqueMembersAgg[0]?.uniqueCount || 0;
    const activeDaysCount = Math.max(1, dailyTrend.length);
    const avgDailyCheckIns = (totalCheckIns / activeDaysCount).toFixed(1);

    let highestAttendanceDay = { date: '-', count: 0 };
    let lowestAttendanceDay = { date: '-', count: 0 };

    if (dailyTrend.length > 0) {
      const sortedByCount = [...dailyTrend].sort((a, b) => b.count - a.count);
      highestAttendanceDay = { date: sortedByCount[0].date, count: sortedByCount[0].count };
      lowestAttendanceDay = { date: sortedByCount[sortedByCount.length - 1].date, count: sortedByCount[sortedByCount.length - 1].count };
    }

    const hourMap = {};
    for (let h = 6; h <= 23; h++) {
      const label = `${h > 12 ? h - 12 : h}:00 ${h >= 12 ? 'PM' : 'AM'}`;
      hourMap[h] = { hour: h, timeLabel: label, checkIns: 0 };
    }
    hourlyDistribution.forEach((item) => {
      if (hourMap[item._id]) {
        hourMap[item._id].checkIns = item.count;
      }
    });

    res.json({
      success: true,
      data: {
        filter: { period: period || preset || 'monthly', startDate, endDate },
        kpis: {
          totalCheckIns,
          uniqueMembers,
          avgDailyCheckIns: Number(avgDailyCheckIns),
          highestAttendanceDay,
          lowestAttendanceDay,
        },
        dailyTrend: filledDailyTrend,
        hourlyDistribution: Object.values(hourMap),
        recentCheckIns,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 6. GET /api/reports/retention
 */
export const getRetentionReport = async (req, res) => {
  try {
    const gymId = req.gymId;
    const gymObjectId = mongoose.Types.ObjectId.isValid(gymId)
      ? new mongoose.Types.ObjectId(gymId)
      : gymId;

    const { preset, startDate: customStart, endDate: customEnd } = req.query;
    const { startDate, endDate } = resolveDateRange(preset, customStart, customEnd);

    const [
      totalMembers,
      activeMembers,
      expiredMembers,
      renewalsInPeriod,
      expiredInPeriod,
      newEnrolledInPeriod,
      renewalsByPlan,
    ] = await Promise.all([
      Member.countDocuments({ gymId }),
      Member.countDocuments({ gymId, status: 'active' }),
      Member.countDocuments({ gymId, status: 'expired' }),

      Payment.countDocuments({
        gymId,
        paymentType: 'renewal',
        paidOn: { $gte: startDate, $lte: endDate },
      }),

      Member.countDocuments({
        gymId,
        expiryDate: { $gte: startDate, $lte: endDate },
        status: { $in: ['expired', 'expiring'] },
      }),

      Member.countDocuments({
        gymId,
        createdAt: { $gte: startDate, $lte: endDate },
      }),

      Payment.aggregate([
        {
          $match: {
            gymId: gymObjectId,
            paymentType: 'renewal',
            paidOn: { $gte: startDate, $lte: endDate },
          },
        },
        { $group: { _id: '$plan', count: { $sum: 1 }, totalRevenue: { $sum: '$amount' } } },
        { $sort: { count: -1 } },
      ]),
    ]);

    const overallRetention = totalMembers > 0 ? ((activeMembers / totalMembers) * 100).toFixed(1) : 100;
    const totalDueForRenewal = renewalsInPeriod + expiredInPeriod;
    const periodRenewalRate = totalDueForRenewal > 0 ? ((renewalsInPeriod / totalDueForRenewal) * 100).toFixed(1) : 100;
    const churnRate = (100 - Number(overallRetention)).toFixed(1);

    res.json({
      success: true,
      data: {
        filter: { preset, startDate, endDate },
        kpis: {
          retentionRate: Number(overallRetention),
          periodRenewalRate: Number(periodRenewalRate),
          churnRate: Number(churnRate),
          totalRenewals: renewalsInPeriod,
          totalExpired: expiredInPeriod,
          activeMembers,
          expiredMembers,
          newEnrolledInPeriod,
        },
        retentionBreakdown: [
          { name: 'Retained / Active', value: activeMembers, fill: '#10b981' },
          { name: 'Churned / Expired', value: expiredMembers, fill: '#ef4444' },
        ],
        renewalsByPlan: renewalsByPlan.map((p) => ({
          plan: p._id || 'monthly',
          renewals: p.count,
          revenue: p.totalRevenue,
        })),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 7. GET /api/reports/trainers
 */
export const getTrainersReport = async (req, res) => {
  try {
    const gymId = req.gymId;
    const gymObjectId = mongoose.Types.ObjectId.isValid(gymId)
      ? new mongoose.Types.ObjectId(gymId)
      : gymId;

    const [trainers, memberTrainerAgg] = await Promise.all([
      Trainer.find({ gymId }),
      Member.aggregate([
        { $match: { gymId: gymObjectId, withTrainer: true, trainerId: { $ne: null } } },
        { $group: { _id: '$trainerId', clientCount: { $sum: 1 } } },
      ]),
    ]);

    const totalTrainers = trainers.length;
    const activeTrainers = trainers.filter((t) => t.status === 'active').length;
    const totalPayroll = trainers.reduce((sum, t) => sum + (t.salary || 0), 0);

    const clientCountMap = {};
    memberTrainerAgg.forEach((m) => {
      clientCountMap[m._id.toString()] = m.clientCount;
    });

    const trainerList = trainers.map((t) => ({
      _id: t._id,
      name: t.name,
      specialty: t.specialty,
      status: t.status,
      salary: t.salary,
      commissionPercent: t.commissionPercent,
      clientsCount: clientCountMap[t._id.toString()] || 0,
      joinDate: t.joinDate,
    }));

    res.json({
      success: true,
      data: {
        kpis: {
          totalTrainers,
          activeTrainers,
          totalPayroll,
        },
        trainerList,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 8. GET /api/reports/equipment
 */
export const getEquipmentReport = async (req, res) => {
  try {
    const gymId = req.gymId;
    const equipmentList = await Equipment.find({ gymId }).sort({ cost: -1 });

    const totalUnits = equipmentList.reduce((sum, e) => sum + (e.quantity || 1), 0);
    const totalAssetCost = equipmentList.reduce((sum, e) => sum + (e.cost || 0), 0);
    const workingCount = equipmentList.filter((e) => e.status === 'working').length;
    const maintenanceCount = equipmentList.filter((e) => e.status === 'maintenance').length;
    const outOfOrderCount = equipmentList.filter((e) => e.status === 'out_of_order').length;

    const categoryMap = {};
    equipmentList.forEach((e) => {
      categoryMap[e.category] = (categoryMap[e.category] || 0) + (e.quantity || 1);
    });

    res.json({
      success: true,
      data: {
        kpis: {
          totalItems: equipmentList.length,
          totalUnits,
          totalAssetCost,
          workingCount,
          maintenanceCount,
          outOfOrderCount,
        },
        statusBreakdown: [
          { name: 'Working', count: workingCount, fill: '#10b981' },
          { name: 'In Maintenance', count: maintenanceCount, fill: '#f59e0b' },
          { name: 'Out of Order', count: outOfOrderCount, fill: '#ef4444' },
        ],
        categoryBreakdown: Object.keys(categoryMap).map((cat) => ({
          category: cat,
          count: categoryMap[cat],
        })),
        equipmentList,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 9. GET /api/reports/cash-closing
 * Aggregates historical daily cash closing records for the selected period.
 */
export const getCashClosingReport = async (req, res) => {
  try {
    const gymId = req.gymId;
    const gymObjectId = mongoose.Types.ObjectId.isValid(gymId)
      ? new mongoose.Types.ObjectId(gymId)
      : gymId;

    const { preset, period, startDate: customStart, endDate: customEnd, date, month, year } = req.query;
    const { startDate, endDate } = resolveDateRange(period || preset, customStart, customEnd, { date, month, year });

    const startStr = startDate.toISOString().split('T')[0];
    const endStr = endDate.toISOString().split('T')[0];

    const closings = await CashClosing.find({
      gymId,
      dateStr: { $gte: startStr, $lte: endStr },
    }).sort({ dateStr: 1 });

    const totalClosedDays = closings.length;
    let totalExpectedCash = 0;
    let totalCountedCash = 0;
    let totalDifference = 0;
    let totalShortage = 0;
    let totalExcess = 0;
    let balancedDays = 0;
    let shortDays = 0;
    let excessDays = 0;

    const allDates = generateDateTimeline(startDate, endDate);
    const ccMap = {};
    allDates.forEach((d) => {
      ccMap[d] = { date: d, expected: 0, counted: 0, difference: 0, status: 'none', notes: '', closedBy: '' };
    });

    closings.forEach((c) => {
      totalExpectedCash += c.expectedCash || 0;
      totalCountedCash += c.countedCash || 0;
      totalDifference += c.difference || 0;

      if (c.status === 'short') {
        shortDays += 1;
        totalShortage += Math.abs(c.difference || 0);
      } else if (c.status === 'excess') {
        excessDays += 1;
        totalExcess += c.difference || 0;
      } else {
        balancedDays += 1;
      }

      if (ccMap[c.dateStr]) {
        ccMap[c.dateStr] = {
          date: c.dateStr,
          expected: c.expectedCash || 0,
          counted: c.countedCash || 0,
          difference: c.difference || 0,
          status: c.status,
          notes: c.notes || '',
          closedBy: c.closedBy?.name || 'Staff',
        };
      }
    });

    const differenceTrend = Object.values(ccMap).sort((a, b) => a.date.localeCompare(b.date));

    res.json({
      success: true,
      data: {
        filter: { period: period || preset || 'monthly', startDate, endDate, startStr, endStr },
        kpis: {
          totalClosedDays,
          totalExpectedCash,
          totalCountedCash,
          totalDifference,
          totalShortage,
          totalExcess,
          balancedDays,
          shortDays,
          excessDays,
        },
        differenceTrend,
        statusBreakdown: [
          { name: 'Balanced', count: balancedDays, fill: '#10b981' },
          { name: 'Short', count: shortDays, fill: '#ef4444' },
          { name: 'Excess', count: excessDays, fill: '#3b82f6' },
        ],
        closingsList: closings,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Legacy/Operational HUD endpoint (Dashboard)
 */
export const getDashboardStats = async (req, res) => {
  try {
    const gymId = req.gymId;
    const gymObjectId = mongoose.Types.ObjectId.isValid(gymId)
      ? new mongoose.Types.ObjectId(gymId)
      : gymId;

    const todayStr = new Date().toISOString().split('T')[0];
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

    const sevenDaysLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const [
      totalMembers,
      activeMembers,
      expiringMembersCount,
      frozenMembersCount,
      todayCheckIns,
      todayPayments,
      pendingDuesAgg,
      recentAttendance,
      expiringSoonList,
    ] = await Promise.all([
      Member.countDocuments({ gymId }),
      Member.countDocuments({ gymId, status: 'active' }),
      Member.countDocuments({ gymId, expiryDate: { $gte: now, $lte: sevenDaysLater } }),
      Member.countDocuments({ gymId, status: 'frozen' }),
      Attendance.countDocuments({ gymId, dateStr: todayStr }),
      Payment.aggregate([
        { $match: { gymId: gymObjectId, paidOn: { $gte: startOfToday, $lte: endOfToday } } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      Member.aggregate([
        { $match: { gymId: gymObjectId, dueAmount: { $gt: 0 } } },
        { $group: { _id: null, totalDues: { $sum: '$dueAmount' } } },
      ]),
      Attendance.find({ gymId, dateStr: todayStr }).sort({ checkInTime: -1 }).limit(20),
      Member.find({ gymId, expiryDate: { $gte: now, $lte: sevenDaysLater } }).limit(5),
    ]);

    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
    sixMonthsAgo.setDate(1);

    const monthlyRevenue = await Payment.aggregate([
      { $match: { gymId: gymObjectId, paidOn: { $gte: sixMonthsAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m', date: '$paidOn' } },
          revenue: { $sum: '$amount' },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const monthlyExpenses = await Expense.aggregate([
      { $match: { gymId: gymObjectId, spentOn: { $gte: sixMonthsAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m', date: '$spentOn' } },
          expense: { $sum: '$amount' },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    res.json({
      success: true,
      metrics: {
        totalMembers,
        activeMembers,
        expiringSoon: expiringMembersCount,
        frozenMembers: frozenMembersCount,
        todayCheckIns,
        todayIncome: todayPayments[0]?.total || 0,
        pendingDues: pendingDuesAgg[0]?.totalDues || 0,
      },
      recentAttendance,
      expiringSoonList,
      financialTrends: {
        revenue: monthlyRevenue,
        expenses: monthlyExpenses,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * SuperAdmin Platform Aggregations
 */
export const getSuperAdminStats = async (req, res) => {
  try {
    const [totalGyms, activeGyms, totalUsers, totalMembers, mrrAgg, recentGyms] = await Promise.all([
      Gym.countDocuments(),
      Gym.countDocuments({ subscriptionStatus: 'active' }),
      User.countDocuments(),
      Member.countDocuments(),
      Gym.aggregate([
        { $match: { subscriptionStatus: 'active' } },
        { $group: { _id: null, totalMRR: { $sum: '$mrrAmount' } } },
      ]),
      Gym.find().sort({ createdAt: -1 }).limit(6),
    ]);

    const planBreakdown = await Gym.aggregate([
      { $group: { _id: '$subscriptionPlan', count: { $sum: 1 } } },
    ]);

    res.json({
      success: true,
      metrics: {
        totalGyms,
        activeGyms,
        totalUsers,
        totalPlatformMembers: totalMembers,
        totalMRR: mrrAgg[0]?.totalMRR || 0,
        systemStatus: 'Operational',
        uptime: '99.98%',
      },
      planBreakdown,
      recentGyms,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
