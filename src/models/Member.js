import mongoose from 'mongoose';

const MemberSchema = new mongoose.Schema(
  {
    gymId: { type: mongoose.Schema.Types.ObjectId, ref: 'Gym', required: true, index: true },
    softwareId: { type: Number, index: true },
    memberCode: { type: String, trim: true, index: true },
    machineUserId: { type: String, default: null, trim: true, index: true },
    machineUid: { type: Number, default: null },
    machinePassword: { type: String, default: null, trim: true },
    fingerprintCount: { type: Number, default: 0 },
    memberId: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    phone: { type: String, default: '', trim: true },
    mobile: { type: String, default: null, trim: true },
    cnic: { type: String, default: null, trim: true },
    address: { type: String, default: '' },
    emergencyContact: { type: String, default: '' },
    planId: { type: mongoose.Schema.Types.ObjectId, ref: 'Plan', default: null },
    plan: {
      type: String,
      default: 'monthly',
    },
    withTrainer: { type: Boolean, default: false },
    trainerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Trainer', required: false },
    trainerName: { type: String, default: '' },
    trainerFee: { type: Number, default: 0 },
    startDate: { type: Date, default: Date.now },
    expiryDate: { type: Date, required: true },
    status: {
      type: String,
      enum: ['active', 'expiring', 'expired', 'frozen', 'due'],
      default: 'expired',
    },
    admissionFee: { type: Number, default: 0 },
    originalFee: { type: Number, default: 0 },
    discountType: {
      type: String,
      enum: ['percentage', 'fixed', 'none'],
      default: 'none',
    },
    discountValue: { type: Number, default: 0 },
    discountAmount: { type: Number, default: 0 },
    finalFee: { type: Number, default: 0 },
    totalAmount: { type: Number, default: 0 },
    paidAmount: { type: Number, default: 0 },
    dueAmount: { type: Number, default: 0 },
    photoUrl: { type: String, default: '' },
    notes: { type: String, default: '' },
    biometricUid: { type: Number, default: null },
    frozenAt: { type: Date, default: null },
    freezeReason: { type: String, default: '' },
  },
  { timestamps: true }
);

MemberSchema.index({ gymId: 1, memberId: 1 }, { unique: true });
MemberSchema.index({ gymId: 1, softwareId: 1 }, { unique: true, sparse: true });
MemberSchema.index({ gymId: 1, memberCode: 1 }, { unique: true, sparse: true });
MemberSchema.index({ gymId: 1, machineUserId: 1 }, { sparse: true });

export const Member = mongoose.model('Member', MemberSchema);
