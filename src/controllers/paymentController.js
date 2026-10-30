import mongoose from 'mongoose';
import { Payment } from '../models/Payment.js';
import { Member } from '../models/Member.js';
import { Plan } from '../models/Plan.js';
import { Gym } from '../models/Gym.js';

export const getPayments = async (req, res) => {
  try {
    const gymId = req.gymId;
    const {
      method,
      paymentType,
      search,
      period,
      startDate,
      endDate,
      date,
      month,
      year,
      limit = 50,
      page = 1,
    } = req.query;
    const filter = { gymId };

    if (method && method !== 'all') filter.method = method;
    if (paymentType && paymentType !== 'all') filter.paymentType = paymentType;
    if (search) {
      filter.$or = [
        { memberName: { $regex: search, $options: 'i' } },
        { memberId: { $regex: search, $options: 'i' } },
        { invoiceNo: { $regex: search, $options: 'i' } },
      ];
    }

    // Date range / Period filtering
    if (period && period !== 'all') {
      const now = new Date();
      let start = null;
      let end = null;

      if (period === 'today' || period === 'daily') {
        let y, m, day;
        if (date && typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
          const parts = date.split('-').map(Number);
          y = parts[0];
          m = parts[1] - 1;
          day = parts[2];
        } else {
          const localNow = new Date(Date.now() + 5 * 60 * 60 * 1000);
          y = localNow.getUTCFullYear();
          m = localNow.getUTCMonth();
          day = localNow.getUTCDate();
        }
        start = new Date(Date.UTC(y, m, day, 0, 0, 0, 0) - 5 * 60 * 60 * 1000);
        end = new Date(Date.UTC(y, m, day, 23, 59, 59, 999));
      } else if (period === 'weekly') {
        const d = date ? new Date(date) : now;
        const endDay = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
        const startDay = new Date(endDay.getTime() - 6 * 24 * 60 * 60 * 1000);
        startDay.setHours(0, 0, 0, 0);
        start = startDay;
        end = endDay;
      } else if (period === 'monthly') {
        const y = year ? Number(year) : now.getFullYear();
        const m = month ? Number(month) - 1 : now.getMonth();
        start = new Date(y, m, 1, 0, 0, 0, 0);
        end = new Date(y, m + 1, 0, 23, 59, 59, 999);
      } else if (period === 'yearly') {
        const y = year ? Number(year) : now.getFullYear();
        start = new Date(y, 0, 1, 0, 0, 0, 0);
        end = new Date(y, 11, 31, 23, 59, 59, 999);
      } else if (period === 'custom' || startDate || endDate) {
        if (startDate) {
          const s = new Date(startDate);
          start = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate(), 0, 0, 0, 0) - 5 * 60 * 60 * 1000);
        }
        if (endDate) {
          const e = new Date(endDate);
          end = new Date(Date.UTC(e.getUTCFullYear(), e.getUTCMonth(), e.getUTCDate(), 23, 59, 59, 999));
        }
      }

      if (start || end) {
        filter.paidOn = {};
        if (start) filter.paidOn.$gte = start;
        if (end) filter.paidOn.$lte = end;
      }
    } else if (startDate || endDate) {
      filter.paidOn = {};
      if (startDate) {
        const s = new Date(startDate);
        filter.paidOn.$gte = new Date(s.getFullYear(), s.getMonth(), s.getDate(), 0, 0, 0, 0);
      }
      if (endDate) {
        const e = new Date(endDate);
        filter.paidOn.$lte = new Date(e.getFullYear(), e.getMonth(), e.getDate(), 23, 59, 59, 999);
      }
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [rawPayments, total, totalSum] = await Promise.all([
      Payment.find(filter).sort({ paidOn: -1 }).skip(skip).limit(Number(limit)).lean(),
      Payment.countDocuments(filter),
      Payment.aggregate([
        { $match: filter },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
    ]);

    const memberIds = [...new Set(rawPayments.map((p) => p.memberId))];
    const members = await Member.find({ gymId, memberId: { $in: memberIds } })
      .select('memberId dueAmount discountAmount discountType status')
      .lean();
    const memberMap = new Map(members.map((m) => [m.memberId, m]));

    const enrichedPayments = rawPayments.map((p) => {
      const m = memberMap.get(p.memberId);
      const dueRemaining = p.dueRemaining !== undefined ? Number(p.dueRemaining) : (m ? Number(m.dueAmount || 0) : 0);
      const discountAmount = Number(p.discountAmount !== undefined ? p.discountAmount : (m?.discountAmount || 0));
      const discountType = p.discountType || m?.discountType || 'none';
      return {
        ...p,
        dueRemaining,
        discountAmount,
        discountType,
        memberStatus: m?.status || 'active',
      };
    });

    res.json({
      success: true,
      total,
      totalCollected: totalSum[0]?.total || 0,
      count: enrichedPayments.length,
      payments: enrichedPayments,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const recordPayment = async (req, res) => {
  try {
    const gymId = req.gymId;
    const { memberId, amount, method = 'cash', paymentType = 'due_clearance', plan, notes } = req.body;

    if (!memberId || amount === undefined || Number(amount) <= 0) {
      return res.status(400).json({ success: false, message: 'Valid memberId and positive amount are required' });
    }

    const cleanMemberId = String(memberId).trim();
    const member = await Member.findOne({ gymId, memberId: cleanMemberId });
    if (!member) {
      return res.status(404).json({ success: false, message: `Member with ID "${cleanMemberId}" not found` });
    }

    const paidNum = Number(amount);

    // Prevent duplicate payment submissions within 5 seconds for same member, type & amount
    if (paymentType === 'renewal' || paymentType === 'due_clearance') {
      const recentDuplicate = await Payment.findOne({
        gymId,
        memberId: member.memberId,
        paymentType,
        amount: paidNum,
        createdAt: { $gte: new Date(Date.now() - 5000) },
      });
      if (recentDuplicate) {
        return res.status(409).json({
          success: false,
          message: `A ${paymentType === 'renewal' ? 'renewal' : 'due clearance'} payment for this member was just recorded a few seconds ago. Duplicate submission prevented.`,
        });
      }
    }

    // Validate due clearance amounts against member's actual outstanding dues
    if (paymentType === 'due_clearance') {
      const currentDues = Number(member.dueAmount) || 0;
      if (currentDues <= 0) {
        return res.status(400).json({
          success: false,
          message: `Member "${member.name}" (${member.memberId}) has no outstanding dues to clear.`,
        });
      }
      if (paidNum > currentDues) {
        return res.status(400).json({
          success: false,
          message: `Amount received (PKR ${paidNum}) cannot exceed total pending dues (PKR ${currentDues}).`,
        });
      }
    }

    let renewalFee = paidNum;
    let newExpiry = null;
    let durationDays = 30;

    if (paymentType === 'renewal') {
      // 1. Look up plan duration based on existing member plan (or passed plan)
      let planRecord = null;
      const targetPlanType = plan || member.plan;
      if (targetPlanType) {
        planRecord = await Plan.findOne({ gymId, planType: targetPlanType, isActive: true });
        if (!planRecord) {
          planRecord = await Plan.findOne({ gymId, planType: targetPlanType });
        }
        if (!planRecord) {
          planRecord = await Plan.findOne({ gymId, name: targetPlanType });
        }
      }

      const defaultDurationMap = {
        daypass: 1,
        monthly: 30,
        quarterly: 90,
        halfyearly: 180,
        yearly: 365,
        pt: 30,
      };

      durationDays = planRecord?.durationDays || defaultDurationMap[targetPlanType] || 30;

      // 2. Determine base date for renewal:
      // If current membership is still active, extend from current expiryDate.
      // If membership has already expired, calculate from today's date.
      const now = new Date();
      const currentExpiry = member.expiryDate ? new Date(member.expiryDate) : null;
      const isStillActive = currentExpiry && !isNaN(currentExpiry.getTime()) && currentExpiry.getTime() > now.getTime();
      const baseDate = isStillActive ? currentExpiry : now;
      newExpiry = new Date(baseDate.getTime() + durationDays * 24 * 60 * 60 * 1000);

      // 3. Financial calculations for renewal
      const planPrice = Number(planRecord?.price) || 0;
      const ptFee = member.withTrainer ? Number(member.trainerFee || 0) : 0;
      const fullCycleFee = planPrice + ptFee;

      let renewalDue = 0;
      if (fullCycleFee > 0 && paidNum < fullCycleFee) {
        renewalFee = fullCycleFee;
        renewalDue = fullCycleFee - paidNum;
      } else {
        renewalFee = paidNum;
        renewalDue = 0;
      }

      const previousDue = Number(member.dueAmount) || 0;
      const updatedDueAmount = previousDue + renewalDue;

      if (plan && plan !== member.plan) {
        member.plan = plan;
      }
      member.expiryDate = newExpiry;
      member.totalAmount = (Number(member.totalAmount) || 0) + renewalFee;
      member.paidAmount = (Number(member.paidAmount) || 0) + paidNum;
      member.dueAmount = updatedDueAmount;
      member.status = updatedDueAmount > 0 ? 'due' : 'active';
    } else {
      // Non-renewal payments (e.g. due clearance, pt fee) - do NOT extend expiry date
      member.paidAmount = (Number(member.paidAmount) || 0) + paidNum;
      member.dueAmount = Math.max(0, (Number(member.dueAmount) || 0) - paidNum);
      if (member.dueAmount === 0 && member.status === 'due') {
        const isExpired = member.expiryDate && new Date(member.expiryDate) < new Date();
        member.status = isExpired ? 'expired' : 'active';
      }
    }

    await member.save();

    const invoiceNo = `INV-${Date.now().toString().slice(-6)}`;
    const paymentNotes = notes || (
      paymentType === 'renewal'
        ? `Subscription renewal (${durationDays} days)`
        : paymentType === 'due_clearance'
        ? `Due clearance payment (Remaining dues: PKR ${member.dueAmount})`
        : ''
    );

    const recTrainerFee = (paymentType === 'renewal' && member.withTrainer) ? (Number(member.trainerFee) || 0) : 0;
    const payment = await Payment.create({
      gymId,
      memberId: member.memberId,
      memberName: member.name,
      amount: paidNum,
      method,
      paymentType,
      plan: plan || member.plan,
      invoiceNo,
      receivedBy: req.user?.name || 'Admin',
      paidOn: new Date(),
      notes: paymentNotes,
      planFee: paymentType === 'renewal' ? Math.max(0, renewalFee - recTrainerFee) : paidNum,
      trainerFee: recTrainerFee,
      trainerName: (paymentType === 'renewal' && member.withTrainer) ? (member.trainerName || '') : '',
      originalFee: paymentType === 'renewal' ? renewalFee : paidNum,
      finalFee: paymentType === 'renewal' ? renewalFee : paidNum,
      dueRemaining: member.dueAmount,
    });

    let successMsg = 'Payment recorded successfully';
    if (paymentType === 'renewal') {
      successMsg = `Subscription renewed successfully. Expiry extended to ${newExpiry.toISOString().split('T')[0]}`;
    } else if (paymentType === 'due_clearance') {
      successMsg = member.dueAmount === 0
        ? `All pending dues cleared for ${member.name}. Member status updated to active.`
        : `Dues payment of PKR ${paidNum} recorded. Remaining dues: PKR ${member.dueAmount}.`;
    }

    res.status(201).json({
      success: true,
      message: successMsg,
      payment,
      member: {
        memberId: member.memberId,
        name: member.name,
        expiryDate: member.expiryDate,
        status: member.status,
        paidAmount: member.paidAmount,
        dueAmount: member.dueAmount,
      },
      memberDueRemaining: member.dueAmount,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /api/payments/invoice/:idOrInvoiceNo
 * Retrieves complete invoice details for a payment transaction.
 */
export const getPaymentInvoice = async (req, res) => {
  try {
    const gymId = req.gymId;
    const { idOrInvoiceNo } = req.params;

    if (!idOrInvoiceNo) {
      return res.status(400).json({ success: false, message: 'Invoice Number or Payment ID is required' });
    }

    const isObjectId = mongoose.Types.ObjectId.isValid(idOrInvoiceNo);
    const query = {
      gymId,
      $or: [
        ...(isObjectId ? [{ _id: idOrInvoiceNo }] : []),
        { invoiceNo: idOrInvoiceNo.trim() },
      ],
    };

    const payment = await Payment.findOne(query);
    if (!payment) {
      return res.status(404).json({ success: false, message: `Invoice "${idOrInvoiceNo}" not found` });
    }

    const [gym, member, plan] = await Promise.all([
      Gym.findById(payment.gymId).lean(),
      Member.findOne({ gymId: payment.gymId, memberId: payment.memberId }).lean(),
      Plan.findOne({ gymId: payment.gymId, planType: payment.plan }).lean(),
    ]);

    const isDueClearance = payment.paymentType === 'due_clearance';
    const isAdmission = payment.paymentType === 'membership';
    const isRenewal = payment.paymentType === 'renewal';

    // Standard plan price from Plan collection (default to 5000 if monthly)
    const standardPlanPrice = Number(plan?.price) || (payment.plan === 'monthly' ? 5000 : 5000);

    // 1. Trainer info for THIS transaction
    let trainerFee = 0;
    let trainerName = '';

    if (isDueClearance) {
      trainerFee = 0;
      trainerName = '';
    } else if (payment.trainerFee !== undefined && payment.trainerFee > 0) {
      trainerFee = Number(payment.trainerFee);
      trainerName = payment.trainerName || member?.trainerName || '';
    } else if (isAdmission && member?.withTrainer && Number(member?.trainerFee) > 0) {
      trainerFee = Number(member.trainerFee);
      trainerName = member.trainerName || '';
    } else if (isRenewal && Number(payment.originalFee) > standardPlanPrice) {
      // If renewal fee was higher than plan price, the difference was the trainer fee
      trainerFee = Number(payment.originalFee) - standardPlanPrice;
      trainerName = member?.trainerName || '';
    }

    // 2. Standalone Membership Plan Fee & Admission Fee resolution
    let admissionFee = payment.admissionFee !== undefined && Number(payment.admissionFee) > 0
      ? Number(payment.admissionFee)
      : (isAdmission ? Number(member?.admissionFee || 0) : 0);

    if (admissionFee === 0 && payment.notes) {
      const match = payment.notes.match(/(?:Admission Fee|admissionFee)[:\s]+(?:PKR\s*)?(\d+)/i);
      if (match && match[1]) {
        admissionFee = Number(match[1]) || 0;
      }
    }

    let rawPlanFee = payment.planFee !== undefined && Number(payment.planFee) > 0
      ? Number(payment.planFee)
      : (isDueClearance ? Number(payment.amount || 0) : standardPlanPrice);

    if (isAdmission && admissionFee === 0) {
      // If payment combined admission fee into planFee (e.g. 10000 total for 5000 plan)
      if (rawPlanFee > standardPlanPrice) {
        admissionFee = rawPlanFee - standardPlanPrice;
        rawPlanFee = standardPlanPrice;
      } else if (payment.notes && /admission/i.test(payment.notes)) {
        // Half split fallback if note indicates admission fee included
        if (Number(payment.amount || 0) >= 10000) {
          admissionFee = 5000;
          rawPlanFee = Math.max(0, Number(payment.amount || 0) - 5000 - trainerFee);
        }
      }
    } else if (admissionFee > 0 && rawPlanFee > admissionFee && (rawPlanFee + admissionFee > Number(payment.amount || 0) + Number(payment.dueRemaining || 0))) {
      // If rawPlanFee already had admission fee inside it
      rawPlanFee = rawPlanFee - admissionFee;
    }

    const planFee = isDueClearance ? Number(payment.amount || 0) : rawPlanFee;

    // 4. Gross total for THIS transaction before discount
    const grossTotal = isDueClearance
      ? planFee
      : (planFee + trainerFee + admissionFee);

    // 5. Discounts for THIS transaction
    let discountAmount = 0;
    let discountType = 'none';
    let discountValue = 0;

    if (isDueClearance) {
      discountAmount = 0;
      discountType = 'none';
      discountValue = 0;
    } else if (payment.discountAmount !== undefined && payment.discountAmount > 0) {
      discountAmount = Number(payment.discountAmount);
      discountType = payment.discountType || 'none';
      discountValue = Number(payment.discountValue || 0);
    } else if (isAdmission && Number(member?.discountAmount) > 0) {
      // Legacy admission record fallback
      discountAmount = Number(member.discountAmount);
      discountType = member.discountType || 'none';
      discountValue = Number(member.discountValue || 0);
    }

    // 6. Total package payable for THIS transaction
    const totalPackageFee = isDueClearance
      ? planFee
      : Math.max(0, grossTotal - discountAmount);

    // 7. Current transaction payment amount received
    const amountReceived = Number(payment.amount || 0);

    // 8. Remaining dues for member
    const remainingDues = member ? Number(member.dueAmount || 0) : Math.max(0, totalPackageFee - amountReceived);

    const isFullPayment = remainingDues === 0;
    const paymentStatus = isFullPayment ? 'PAID IN FULL' : 'PARTIAL PAYMENT';
    const hasTrainer = trainerFee > 0;

    res.json({
      success: true,
      invoice: {
        invoiceNo: payment.invoiceNo,
        paymentId: payment._id,
        date: payment.paidOn,
        validityStartDate: payment.startDate || (isRenewal ? payment.paidOn : member?.startDate) || member?.startDate,
        validityEndDate: payment.expiryDate || member?.expiryDate,
        amountPaid: amountReceived,
        paymentMethod: payment.method,
        paymentType: payment.paymentType,
        planType: payment.plan,
        planName: plan?.name || (payment.plan ? payment.plan.toUpperCase() : 'STANDARD'),
        receivedBy: payment.receivedBy || 'Front Desk Reception',
        notes: payment.notes || '',
        gym: {
          name: gym?.name || 'Iron Man Hardcore Fitness',
          ownerName: gym?.ownerName || 'Imran',
          branchCode: gym?.branchCode || 'GYM-001',
          address: gym?.address ? (gym?.city ? `${gym.address}, ${gym.city}` : gym.address) : 'Main Boulevard, Gulberg III, Lahore',
          phone: gym?.phone || '+92 321 1234567',
          email: gym?.email || 'lahore@ironmangym.com',
          website: gym?.website || 'www.ironmangym.com',
          logoUrl: gym?.logoUrl || '',
          currency: gym?.currency || 'PKR',
          currencySymbol: gym?.currencySymbol || 'PKR',
          cancellationPolicy: gym?.settings?.cancellationPolicy || 'Memberships are non-refundable once activated.',
        },
        member: {
          memberId: member?.memberId || payment.memberId,
          name: member?.name || payment.memberName,
          phone: member?.phone || '',
          cnic: member?.cnic || '',
          address: member?.address || '',
          plan: member?.plan || payment.plan,
          startDate: member?.startDate || null,
          expiryDate: member?.expiryDate || null,
          status: member?.status || 'active',
          admissionFee: Number(member?.admissionFee !== undefined ? member.admissionFee : admissionFee),
          withTrainer: hasTrainer,
          trainerName,
          trainerFee,
          totalAmount: totalPackageFee,
          paidAmount: member?.paidAmount || amountReceived,
          dueAmount: remainingDues,
        },
        financials: {
          planFee,
          admissionFee,
          baseFee: planFee,
          trainerFee,
          trainerName,
          grossTotal,
          discountType,
          discountValue,
          discountAmount,
          subtotal: grossTotal,
          totalPackageFee,
          amountReceived,
          remainingDues,
          isFullPayment,
          paymentStatus,
        },
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

