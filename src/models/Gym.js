import mongoose from 'mongoose';

const GymSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    ownerName: { type: String, default: '', trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    branchCode: { type: String, required: true, unique: true, uppercase: true, trim: true },
    address: { type: String, default: '' },
    city: { type: String, default: 'Lahore' },
    country: { type: String, default: 'Pakistan' },
    phone: { type: String, default: '' },
    email: { type: String, default: '' },
    website: { type: String, default: '' },
    description: { type: String, default: '' },
    logoUrl: { type: String, default: '' },
    subscriptionPlan: {
      type: String,
      enum: ['starter', 'pro', 'enterprise'],
      default: 'pro',
    },
    subscriptionStatus: {
      type: String,
      enum: ['active', 'trial', 'past_due', 'suspended'],
      default: 'active',
    },
    mrrAmount: { type: Number, default: 4999 },
    currency: {
      type: String,
      enum: ['PKR', 'USD', 'AED', 'GBP', 'EUR', 'SAR'],
      default: 'PKR',
    },
    currencySymbol: { type: String, default: 'PKR' },
    dateFormat: {
      type: String,
      enum: ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'],
      default: 'DD/MM/YYYY',
    },
    timezone: {
      type: String,
      enum: ['Asia/Karachi', 'Asia/Dubai', 'UTC', 'America/New_York', 'Europe/London'],
      default: 'Asia/Karachi',
    },
    validUntil: {
      type: Date,
      default: () => new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    },
    settings: {
      taxRate: { type: Number, default: 0 },
      allowPartialPayments: { type: Boolean, default: true },
      freezeFee: { type: Number, default: 500 },
      gracePeriodDays: { type: Number, default: 3 },
      defaultMembershipDurationDays: { type: Number, default: 30 },
      allowRenewalBeforeExpiry: { type: Boolean, default: true },
      cancellationPolicy: { type: String, default: 'Memberships are non-refundable once activated.' },
      freezePolicy: { type: String, default: 'Freezing is allowed up to 30 days per year with standard fee.' },
      renewalPolicy: { type: String, default: 'Early renewal extends existing duration seamlessly.' },
      generalNotes: { type: String, default: '' },
      enableExpiryReminders: { type: Boolean, default: true },
      reminderDaysBeforeExpiry: { type: Number, default: 7 },
      defaultReminderLanguage: {
        type: String,
        enum: ['en', 'ur'],
        default: 'en',
      },
      enablePaymentDueReminders: { type: Boolean, default: true },
      checkInCutoffHour: { type: Number, default: 0, min: 0, max: 23 }, // Hour of day when new checkin day starts (0-23, e.g. 4 for 4:00 AM)
      checkInCutoffMinute: { type: Number, default: 0, min: 0, max: 59 },
      openingTime: { type: String, default: '06:00' },
      closingTime: { type: String, default: '23:00' },
    },
  },
  { timestamps: true }
);

export const Gym = mongoose.model('Gym', GymSchema);
