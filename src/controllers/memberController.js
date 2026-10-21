import mongoose from 'mongoose';
import { Member } from '../models/Member.js';
import { Payment } from '../models/Payment.js';
import { Plan } from '../models/Plan.js';
import { Trainer } from '../models/Trainer.js';
import { Attendance } from '../models/Attendance.js';
import { CashClosing } from '../models/CashClosing.js';

export const getMembers = async (req, res) => {
  try {
    const gymId = req.gymId;
    const { q, status, plan, limit = 100, page = 1 } = req.query;

    const now = new Date();

    // Auto-sync status for members whose expiryDate has passed (and not frozen)
    await Member.updateMany(
      {
        gymId,
        expiryDate: { $lt: now },
        status: { $nin: ['expired', 'frozen'] },
      },
      { $set: { status: 'expired' } }
    );

    // Ensure legacy members with undefined status and future expiryDate are set to active (or due if pending dues)
    await Member.updateMany(
      {
        gymId,
        expiryDate: { $gte: now },
        $or: [{ status: { $exists: false } }, { status: null }, { status: '' }],
        dueAmount: { $gt: 0 },
      },
      { $set: { status: 'due' } }
    );
    await Member.updateMany(
      {
        gymId,
        expiryDate: { $gte: now },
        $or: [{ status: { $exists: false } }, { status: null }, { status: '' }],
      },
      { $set: { status: 'active' } }
    );

    const filter = { gymId };
    if (status && status !== 'all') {
      filter.status = status;
    }
    if (plan && plan !== 'all') {
      filter.plan = plan;
    }
    if (q) {
      filter.$or = [
        { name: { $regex: q, $options: 'i' } },
        { memberId: { $regex: q, $options: 'i' } },
        { phone: { $regex: q, $options: 'i' } },
        { cnic: { $regex: q, $options: 'i' } },
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [members, total] = await Promise.all([
      Member.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
      Member.countDocuments(filter),
    ]);

    res.json({ success: true, total, count: members.length, members });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getMemberById = async (req, res) => {
  try {
    const member = await Member.findOne({ _id: req.params.id, gymId: req.gymId });
    if (!member) {
      return res.status(404).json({ success: false, message: 'Member not found' });
    }
    const [payments, attendance] = await Promise.all([
      Payment.find({
        gymId: req.gymId,
        $or: [{ memberId: member.memberId }, { memberId: String(member._id) }],
      }).sort({ paidOn: -1 }),
      Attendance.find({
        gymId: req.gymId,
        $or: [{ member: member._id }, { memberId: member.memberId }],
      }).sort({ checkInTime: -1 }).limit(100),
    ]);

    const now = new Date();
    const expiry = new Date(member.expiryDate);
    const diffMs = expiry.getTime() - now.getTime();
    const daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    const isRenewEligible = daysRemaining <= 10;
    const daysFrozen = member.frozenAt
      ? Math.max(0, Math.ceil((now.getTime() - new Date(member.frozenAt).getTime()) / (1000 * 60 * 60 * 24)))
      : 0;

    res.json({
      success: true,
      member: {
        ...member.toObject(),
        daysRemaining,
        isRenewEligible,
        daysFrozen,
      },
      payments,
      attendance,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const createMember = async (req, res) => {
  try {
    const gymId = req.gymId;
    const {
      name,
      phone,
      cnic,
      address,
      emergencyContact,
      plan = 'monthly',
      durationDays = 30,
      originalFee,
      discountType = 'none',
      discountValue = 0,
      totalAmount,
      paidAmount = 0,
      paymentMethod = 'cash',
      paymentMode = 'full',
      withTrainer,
      trainerId,
      trainerName,
      photoUrl,
      notes,
    } = req.body;

    if (!name || !phone) {
      return res.status(400).json({ success: false, message: 'Name and phone are required' });
    }

    // 1. Authoritative plan lookup and pricing
    let planFee = 5000;
    let authoritativePlan = null;
    if (plan) {
      authoritativePlan = await Plan.findOne({
        gymId,
        $or: [
          { planType: plan },
          { name: plan },
          ...(mongoose.Types.ObjectId.isValid(plan) ? [{ _id: plan }] : []),
        ],
      });
    }

    if (authoritativePlan) {
      planFee = Number(authoritativePlan.price);
    } else if (originalFee !== undefined && !isNaN(Number(originalFee))) {
      planFee = Number(originalFee);
    } else if (totalAmount !== undefined && !isNaN(Number(totalAmount))) {
      planFee = Number(totalAmount);
    }

    // 2. Personal Trainer Lookup & Fee calculation
    let isWithTrainer = Boolean(withTrainer);
    let assignedTrainer = null;
    let trainerFee = 0;

    if (isWithTrainer && trainerId) {
      assignedTrainer = await Trainer.findOne({ _id: trainerId, gymId });
      if (assignedTrainer) {
        trainerFee = Number(assignedTrainer.fee !== undefined ? assignedTrainer.fee : 3000);
      } else {
        isWithTrainer = false;
        trainerFee = 0;
      }
    } else {
      isWithTrainer = false;
      trainerFee = 0;
    }

    // Calculated base fee is membership plan fee + trainer fee (when personal trainer is enabled)
    let baseFee = planFee + trainerFee;

    // Support custom pricing override if admin explicitly set custom original fee
    if (originalFee !== undefined && !isNaN(Number(originalFee))) {
      const customFee = Number(originalFee);
      if (customFee >= 0) {
        baseFee = customFee;
      }
    }

    if (baseFee < 0) {
      return res.status(400).json({ success: false, message: 'Original fee cannot be negative' });
    }

    // 2. Validate discount type and value
    const normDiscountType = (discountType || 'none').toLowerCase();
    const rawDiscountValue = discountValue;

    if (
      normDiscountType !== 'none' &&
      rawDiscountValue !== undefined &&
      rawDiscountValue !== '' &&
      (isNaN(Number(rawDiscountValue)) || typeof rawDiscountValue === 'boolean')
    ) {
      return res.status(400).json({ success: false, message: 'Please enter a valid discount value' });
    }

    const discountVal = Number(rawDiscountValue) || 0;
    let calculatedDiscountAmount = 0;
    let finalDiscountValue = 0;

    if (normDiscountType === 'percentage') {
      if (discountVal < 0) {
        return res.status(400).json({ success: false, message: 'Discount percentage cannot be negative' });
      }
      if (discountVal > 100) {
        return res.status(400).json({ success: false, message: 'Discount percentage cannot exceed 100%' });
      }
      finalDiscountValue = discountVal;
      calculatedDiscountAmount = Math.round(((baseFee * discountVal) / 100) * 100) / 100;
    } else if (normDiscountType === 'fixed') {
      if (discountVal < 0) {
        return res.status(400).json({ success: false, message: 'Discount amount cannot be negative' });
      }
      if (discountVal > baseFee) {
        return res.status(400).json({ success: false, message: 'Discount amount cannot exceed the original fee' });
      }
      finalDiscountValue = discountVal;
      calculatedDiscountAmount = Math.round(discountVal * 100) / 100;
    } else if (normDiscountType === 'none' || !normDiscountType) {
      finalDiscountValue = 0;
      calculatedDiscountAmount = 0;
    } else {
      return res.status(400).json({ success: false, message: 'Invalid discount type' });
    }

    // 3. Final payable fee calculated on backend
    const finalFee = Math.max(0, Math.round((baseFee - calculatedDiscountAmount) * 100) / 100);

    // 4. Validate payment amount against final payable fee
    const paid = Number(paidAmount) || 0;

    if (paid < 0) {
      return res.status(400).json({ success: false, message: 'Paid amount cannot be negative' });
    }
    if (paid > finalFee) {
      return res.status(400).json({ success: false, message: 'Paid amount cannot exceed the final payable fee' });
    }
    if (paymentMode === 'full' && paid !== finalFee) {
      return res.status(400).json({ success: false, message: 'In Full Payment mode, payment amount must equal the final payable fee' });
    }
    if (paymentMode === 'partial' && finalFee > 0 && paid >= finalFee) {
      return res.status(400).json({ success: false, message: 'In Partial Payment mode, advance payment must be less than the final payable fee' });
    }

    // 5. Calculate outstanding balance
    const dueAmount = Math.max(0, Math.round((finalFee - paid) * 100) / 100);
    const now = new Date();
    const expiryDays = authoritativePlan?.durationDays || Number(durationDays) || 30;
    const expiryDate = new Date(now.getTime() + expiryDays * 24 * 60 * 60 * 1000);

    // Auto generate memberId if not given
    let memberId = req.body.memberId;
    if (!memberId) {
      const existingMembers = await Member.find({ gymId }, { memberId: 1 }).lean();
      let maxNum = 1000;
      for (const m of existingMembers) {
        if (!m.memberId) continue;
        const match = String(m.memberId).match(/\d+/);
        if (match) {
          const num = parseInt(match[0], 10);
          if (!isNaN(num) && num > maxNum) {
            maxNum = num;
          }
        }
      }
      let candidateSeq = maxNum + 1;
      while (await Member.exists({ gymId, memberId: `M-${candidateSeq}` })) {
        candidateSeq++;
      }
      memberId = `M-${candidateSeq}`;
    }

    const member = await Member.create({
      gymId,
      memberId,
      name,
      phone,
      cnic,
      address,
      emergencyContact,
      plan: authoritativePlan ? authoritativePlan.planType : (plan || 'monthly'),
      withTrainer: isWithTrainer,
      trainerId: isWithTrainer && assignedTrainer ? assignedTrainer._id : undefined,
      trainerName: isWithTrainer && assignedTrainer ? assignedTrainer.name : '',
      trainerFee: isWithTrainer ? trainerFee : 0,
      startDate: now,
      expiryDate,
      status: dueAmount > 0 ? 'due' : 'active',
      originalFee: baseFee,
      discountType: normDiscountType,
      discountValue: finalDiscountValue,
      discountAmount: calculatedDiscountAmount,
      finalFee,
      totalAmount: finalFee,
      paidAmount: paid,
      dueAmount,
      photoUrl: photoUrl || '',
      notes: notes || '',
    });

    // If payment was made (paid > 0), log transaction in Payment ledger
    let payment = null;
    if (paid > 0) {
      let paymentNotes = dueAmount > 0
        ? 'Initial admission fee payment (partial advance)'
        : 'Initial admission fee payment (full)';
      if (isWithTrainer && assignedTrainer) {
        paymentNotes += ` [Personal Trainer: ${assignedTrainer.name} (+PKR ${trainerFee})]`;
      }
      if (calculatedDiscountAmount > 0) {
        paymentNotes += ` [Discount: PKR ${calculatedDiscountAmount} (${normDiscountType === 'percentage' ? `${finalDiscountValue}%` : 'Fixed Amount'})]`;
      }

      payment = await Payment.create({
        gymId,
        memberId: member.memberId,
        memberName: member.name,
        amount: paid,
        method: paymentMethod || 'cash',
        paymentType: 'membership',
        plan: member.plan,
        invoiceNo: `INV-${Date.now().toString().slice(-6)}`,
        receivedBy: req.user?.name || 'Admin',
        paidOn: now,
        notes: paymentNotes,
        planFee: planFee,
        trainerFee: isWithTrainer ? trainerFee : 0,
        trainerName: isWithTrainer && assignedTrainer ? assignedTrainer.name : '',
        originalFee: baseFee,
        discountType: normDiscountType,
        discountValue: finalDiscountValue,
        discountAmount: calculatedDiscountAmount,
        finalFee: finalFee,
        dueRemaining: dueAmount,
      });
    }

    res.status(201).json({ success: true, message: 'Member created successfully', member, payment });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'Member with this ID or credentials already exists. Please try again.',
      });
    }
    res.status(500).json({ success: false, message: error.message });
  }
};

export const updateMember = async (req, res) => {
  try {
    const member = await Member.findOneAndUpdate(
      { _id: req.params.id, gymId: req.gymId },
      req.body,
      { new: true, runValidators: true }
    );
    if (!member) {
      return res.status(404).json({ success: false, message: 'Member not found' });
    }
    res.json({ success: true, message: 'Member updated successfully', member });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const renewMembership = async (req, res) => {
  try {
    const {
      plan,
      durationDays = 30,
      renewalFee,
      totalAmount,
      amount,
      paidAmount,
      paymentMethod = 'cash',
      paymentMode = 'full',
      withTrainer,
      trainerId,
      notes,
    } = req.body;

    const member = await Member.findOne({ _id: req.params.id, gymId: req.gymId });
    if (!member) {
      return res.status(404).json({ success: false, message: 'Member not found' });
    }

    const fee = Number(renewalFee !== undefined ? renewalFee : (totalAmount !== undefined ? totalAmount : amount)) || 0;
    const paid = Number(paidAmount !== undefined ? paidAmount : amount) || 0;

    if (fee < 0) {
      return res.status(400).json({ success: false, message: 'Renewal fee cannot be negative' });
    }
    if (paid < 0) {
      return res.status(400).json({ success: false, message: 'Paid amount cannot be negative' });
    }
    if (paid > fee) {
      return res.status(400).json({ success: false, message: 'Paid amount cannot exceed renewal fee' });
    }
    if (paymentMode === 'full' && paid !== fee) {
      return res.status(400).json({ success: false, message: 'In Full Payment mode, payment amount must equal the renewal fee' });
    }
    if (paymentMode === 'partial' && fee > 0 && paid >= fee) {
      return res.status(400).json({ success: false, message: 'In Partial Payment mode, advance payment must be less than the renewal fee' });
    }

    const currentExpiry = new Date(member.expiryDate);
    const baseDate = currentExpiry > new Date() ? currentExpiry : new Date();
    const newExpiry = new Date(baseDate.getTime() + Number(durationDays) * 24 * 60 * 60 * 1000);

    // Preserve previous outstanding dues and calculate new renewal due
    const previousDue = Number(member.dueAmount) || 0;
    const newRenewalDue = Math.max(0, fee - paid);
    const updatedDueAmount = previousDue + newRenewalDue;

    member.plan = plan || member.plan;
    member.expiryDate = newExpiry;
    member.totalAmount = (Number(member.totalAmount) || 0) + fee;
    member.paidAmount = (Number(member.paidAmount) || 0) + paid;
    member.dueAmount = updatedDueAmount;
    member.status = updatedDueAmount > 0 ? 'due' : 'active';

    // Handle personal trainer assignment on renewal
    if (withTrainer !== undefined) {
      if (Boolean(withTrainer)) {
        let assignedTrainer = null;
        if (trainerId) {
          assignedTrainer = await Trainer.findOne({ _id: trainerId, gymId: req.gymId });
        } else if (member.trainerId) {
          assignedTrainer = await Trainer.findOne({ _id: member.trainerId, gymId: req.gymId });
        }
        if (assignedTrainer) {
          const renewTrainerFee = Number(assignedTrainer.fee !== undefined ? assignedTrainer.fee : 3000);
          member.withTrainer = true;
          member.trainerId = assignedTrainer._id;
          member.trainerName = assignedTrainer.name;
          member.trainerFee = renewTrainerFee;
        }
      } else {
        member.withTrainer = false;
        member.trainerId = undefined;
        member.trainerName = '';
        member.trainerFee = 0;
      }
    }

    await member.save();

    let payment = null;
    if (paid > 0) {
      let paymentNotes = notes || (newRenewalDue > 0 ? `Membership renewal (partial advance)` : `Membership renewal for ${durationDays} days`);
      if (member.withTrainer && member.trainerName) {
        paymentNotes += ` [Personal Trainer: ${member.trainerName} (+PKR ${member.trainerFee})]`;
      }

      const renTrainerFee = member.withTrainer ? (Number(member.trainerFee) || 0) : 0;
      payment = await Payment.create({
        gymId: req.gymId,
        memberId: member.memberId,
        memberName: member.name,
        amount: paid,
        method: paymentMethod || 'cash',
        paymentType: 'renewal',
        plan: member.plan,
        invoiceNo: `INV-${Date.now().toString().slice(-6)}`,
        receivedBy: req.user?.name || 'Admin',
        paidOn: new Date(),
        notes: paymentNotes,
        planFee: Math.max(0, fee - renTrainerFee),
        trainerFee: renTrainerFee,
        trainerName: member.withTrainer ? (member.trainerName || '') : '',
        originalFee: fee,
        finalFee: fee,
        dueRemaining: updatedDueAmount,
      });
    }

    res.json({ success: true, message: 'Membership renewed successfully', member, payment });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteMember = async (req, res) => {
  try {
    const gymId = req.gymId;
    const member = await Member.findOne({ _id: req.params.id, gymId });
    if (!member) {
      return res.status(404).json({ success: false, message: 'Member not found' });
    }

    // 1. Find all payments for this member to identify affected cashflow dates
    const memberPayments = await Payment.find({
      gymId,
      $or: [
        { memberId: member.memberId },
        { memberId: String(member._id) },
      ],
    });

    const affectedDates = new Set();
    memberPayments.forEach((p) => {
      if (p.paidOn) {
        try {
          const dStr = new Date(p.paidOn).toISOString().split('T')[0];
          affectedDates.add(dStr);
        } catch (_) {}
      }
    });

    // 2. Cascade delete all payment transactions (Cashflow, Invoices, Fees)
    const paymentDeleteResult = await Payment.deleteMany({
      gymId,
      $or: [
        { memberId: member.memberId },
        { memberId: String(member._id) },
      ],
    });

    // 3. Cascade delete all attendance records (Check-in history)
    const attendanceDeleteResult = await Attendance.deleteMany({
      gymId,
      $or: [
        { member: member._id },
        { memberId: member.memberId },
      ],
    });

    // 4. Synchronize any existing CashClosing records for affected dates so cash drawer reports remain consistent
    const gymObjectId = mongoose.Types.ObjectId.isValid(gymId)
      ? new mongoose.Types.ObjectId(gymId)
      : gymId;

    for (const dateStr of affectedDates) {
      const existingClosing = await CashClosing.findOne({ gymId, dateStr });
      if (existingClosing) {
        const parts = dateStr.split('-');
        const year = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1;
        const day = parseInt(parts[2], 10);
        const dayStart = new Date(year, month, day, 0, 0, 0, 0);
        const dayEnd = new Date(year, month, day, 23, 59, 59, 999);

        const remainingCashIncomeAgg = await Payment.aggregate([
          {
            $match: {
              gymId: gymObjectId,
              method: 'cash',
              paidOn: { $gte: dayStart, $lte: dayEnd },
            },
          },
          { $group: { _id: null, total: { $sum: '$amount' } } },
        ]);

        const newCashIncome = remainingCashIncomeAgg[0]?.total || 0;
        const newExpectedCash = (existingClosing.openingCash || 0) + newCashIncome - (existingClosing.cashExpenses || 0);
        const newDifference = (existingClosing.countedCash || 0) - newExpectedCash;
        const newStatus = newDifference === 0 ? 'balanced' : newDifference < 0 ? 'short' : 'excess';

        existingClosing.cashIncome = newCashIncome;
        existingClosing.expectedCash = newExpectedCash;
        existingClosing.difference = newDifference;
        existingClosing.status = newStatus;
        await existingClosing.save();
      }
    }

    // 5. Delete the member record
    await Member.deleteOne({ _id: member._id, gymId });

    res.json({
      success: true,
      message: `Member "${member.name}" and all associated details (cashflow, payments, attendance) removed successfully`,
      deletedSummary: {
        memberId: member.memberId,
        name: member.name,
        paymentsDeleted: paymentDeleteResult.deletedCount || 0,
        attendanceDeleted: attendanceDeleteResult.deletedCount || 0,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const freezeMember = async (req, res) => {
  try {
    const gymId = req.gymId;
    const { id } = req.params;
    const { reason = '' } = req.body;

    const member = await Member.findOne({ _id: id, gymId });
    if (!member) {
      return res.status(404).json({ success: false, message: 'Member not found' });
    }

    if (member.status === 'frozen') {
      return res.status(400).json({ success: false, message: 'Member is already frozen' });
    }

    member.status = 'frozen';
    member.frozenAt = new Date();
    if (reason) member.freezeReason = String(reason).trim();
    await member.save();

    res.json({
      success: true,
      message: `Membership for "${member.name}" has been frozen successfully`,
      member,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const unfreezeMember = async (req, res) => {
  try {
    const gymId = req.gymId;
    const { id } = req.params;

    const member = await Member.findOne({ _id: id, gymId });
    if (!member) {
      return res.status(404).json({ success: false, message: 'Member not found' });
    }

    if (member.status !== 'frozen') {
      return res.status(400).json({ success: false, message: 'Member is not currently frozen' });
    }

    // Extend expiry date by the duration the membership was frozen so paid time is not lost
    const now = new Date();
    if (member.frozenAt) {
      const frozenMs = now.getTime() - new Date(member.frozenAt).getTime();
      if (frozenMs > 0) {
        member.expiryDate = new Date(new Date(member.expiryDate).getTime() + frozenMs);
      }
    }

    // Determine restored status
    if (new Date(member.expiryDate) < now) {
      member.status = 'expired';
    } else if (Number(member.dueAmount) > 0) {
      member.status = 'due';
    } else {
      member.status = 'active';
    }

    member.frozenAt = null;
    member.freezeReason = '';
    await member.save();

    res.json({
      success: true,
      message: `Membership for "${member.name}" has been unfrozen and restored to ${member.status} status`,
      member,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const bookTrainer = async (req, res) => {
  try {
    const gymId = req.gymId;
    const { id } = req.params;
    const { trainerId, paidAmount = 0, paymentMethod = 'cash', paymentMode = 'full', notes = '' } = req.body;

    if (!trainerId) {
      return res.status(400).json({ success: false, message: 'Please select a trainer to book' });
    }

    const [member, trainer] = await Promise.all([
      Member.findOne({ _id: id, gymId }),
      Trainer.findOne({ _id: trainerId, gymId }),
    ]);

    if (!member) {
      return res.status(404).json({ success: false, message: 'Member not found' });
    }
    if (!trainer) {
      return res.status(404).json({ success: false, message: 'Trainer not found' });
    }

    const trainerFee = Number(trainer.fee !== undefined ? trainer.fee : 3000);
    const numPaid = Math.max(0, Number(paidAmount) || 0);

    if (numPaid > trainerFee) {
      return res.status(400).json({
        success: false,
        message: `Paid amount cannot exceed trainer fee (${trainerFee})`,
      });
    }

    // Update member coaching fields
    member.withTrainer = true;
    member.trainerId = trainer._id;
    member.trainerName = trainer.name;
    member.trainerFee = trainerFee;

    // Financial adjustment: add trainer fee to total amount and update paid/due amounts
    member.totalAmount = (Number(member.totalAmount) || 0) + trainerFee;
    member.paidAmount = (Number(member.paidAmount) || 0) + numPaid;
    const dueAddition = Math.max(0, trainerFee - numPaid);
    member.dueAmount = (Number(member.dueAmount) || 0) + dueAddition;

    await member.save();

    // Create payment transaction if money was collected now
    let payment = null;
    if (numPaid > 0) {
      const now = new Date();
      payment = await Payment.create({
        gymId,
        memberId: member.memberId,
        memberName: member.name,
        amount: numPaid,
        method: paymentMethod || 'cash',
        paymentType: 'pt_fee',
        plan: member.plan,
        invoiceNo: `INV-PT-${Date.now().toString().slice(-6)}`,
        receivedBy: req.user?.name || 'Admin',
        paidOn: now,
        notes: notes || `Personal Trainer booking: Coach ${trainer.name} (+PKR ${trainerFee})`,
        trainerFee: trainerFee,
        trainerName: trainer.name,
        finalFee: trainerFee,
        dueRemaining: dueAddition,
      });
    }

    res.json({
      success: true,
      message: `Coach "${trainer.name}" successfully booked for ${member.name}!`,
      member,
      payment,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const removeTrainer = async (req, res) => {
  try {
    const gymId = req.gymId;
    const { id } = req.params;

    const member = await Member.findOne({ _id: id, gymId });
    if (!member) {
      return res.status(404).json({ success: false, message: 'Member not found' });
    }

    const previousTrainer = member.trainerName;
    member.withTrainer = false;
    member.trainerId = null;
    member.trainerName = '';
    member.trainerFee = 0;
    await member.save();

    res.json({
      success: true,
      message: `Personal trainer ${previousTrainer ? `"${previousTrainer}" ` : ''}unassigned from ${member.name}.`,
      member,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
