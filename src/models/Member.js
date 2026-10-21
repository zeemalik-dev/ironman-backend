import mongoose from 'mongoose';

const MemberSchema = new mongoose.Schema(
  {
    gymId: { type: mongoose.Schema.Types.ObjectId, ref: 'Gym', required: true, index: true },
    memberId: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    cnic: { type: String, default: '', trim: true },
    address: { type: String, default: '' },
    emergencyContact: { type: String, default: '' },
    plan: {
      type: String,
      enum: ['daypass', 'monthly', 'quarterly', 'halfyearly', 'yearly', 'pt'],
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
      default: 'active',
    },
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
    frozenAt: { type: Date, default: null },
    freezeReason: { type: String, default: '' },
  },
  { timestamps: true }
);

MemberSchema.index({ gymId: 1, memberId: 1 }, { unique: true });

export const Member = mongoose.model('Member', MemberSchema);
