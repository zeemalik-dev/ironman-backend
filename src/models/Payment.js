import mongoose from 'mongoose';

const PaymentSchema = new mongoose.Schema(
  {
    gymId: { type: mongoose.Schema.Types.ObjectId, ref: 'Gym', required: true, index: true },
    memberId: { type: String, required: true },
    memberName: { type: String, required: true },
    amount: { type: Number, required: true },
    method: {
      type: String,
      enum: ['cash', 'jazzcash', 'easypaisa', 'bank_transfer', 'card'],
      default: 'cash',
    },
    paymentType: {
      type: String,
      enum: ['membership', 'renewal', 'due_clearance', 'pt_fee', 'other'],
      default: 'membership',
    },
    plan: { type: String, default: 'monthly' },
    invoiceNo: { type: String, required: true },
    receivedBy: { type: String, default: 'Admin' },
    paidOn: { type: Date, default: Date.now },
    startDate: { type: Date },
    expiryDate: { type: Date },
    notes: { type: String, default: '' },
    planFee: { type: Number, default: 0 },
    admissionFee: { type: Number, default: 0 },
    trainerFee: { type: Number, default: 0 },
    trainerName: { type: String, default: '' },
    originalFee: { type: Number, default: 0 },
    discountType: {
      type: String,
      enum: ['percentage', 'fixed', 'none'],
      default: 'none',
    },
    discountValue: { type: Number, default: 0 },
    discountAmount: { type: Number, default: 0 },
    finalFee: { type: Number, default: 0 },
    dueRemaining: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const Payment = mongoose.model('Payment', PaymentSchema);
