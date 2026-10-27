import { Gym } from '../models/Gym.js';
import { User } from '../models/User.js';
import { AuditLog } from '../models/AuditLog.js';

/**
 * Helper to record an audit log entry
 */
const recordAudit = async (gymId, user, action, section, description, details = {}) => {
  try {
    await AuditLog.create({
      gymId,
      userId: user.userId || user.id || user._id,
      userName: user.name || 'Staff User',
      userRole: user.role || 'owner',
      action,
      section,
      description,
      details,
    });
  } catch (err) {
    console.error('[AuditLog Error]', err.message);
  }
};

/**
 * GET /api/settings
 * Retrieves all configuration and profile details for the authenticated gym.
 */
export const getSettings = async (req, res) => {
  try {
    const gymId = req.gymId;
    let gym = await Gym.findById(gymId);

    if (!gym) {
      return res.status(404).json({ success: false, message: 'Gym not found' });
    }

    const [staff, recentAuditLogs, ownerUser] = await Promise.all([
      User.find({ gymId }).select('-password').sort({ createdAt: -1 }),
      AuditLog.find({ gymId }).sort({ createdAt: -1 }).limit(25),
      User.findOne({ gymId, role: 'owner' }),
      User.findOne({ gymId, role: 'owner' }),
    ]);

    const gymData = gym.toObject();
    if (!gymData.ownerName && ownerUser) {
      gymData.ownerName = ownerUser.name;
    }

    res.json({
      success: true,
      gym: gymData,
      staff,
      auditLogs: recentAuditLogs,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * PATCH /api/settings/profile
 * Updates basic gym identity and contact details.
 */
export const updateGymProfile = async (req, res) => {
  try {
    const gymId = req.gymId;
    const { name, phone, email, address, city, country, website, description, logoUrl, ownerName } = req.body;

    if (!name || name.trim().length === 0) {
      return res.status(400).json({ success: false, message: 'Gym Name is required' });
    }

    if (email && !/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).json({ success: false, message: 'Invalid email address format' });
    }

    const gym = await Gym.findById(gymId);
    if (!gym) {
      return res.status(404).json({ success: false, message: 'Gym not found' });
    }

    const previousData = {
      name: gym.name,
      ownerName: gym.ownerName,
      phone: gym.phone,
      email: gym.email,
      address: gym.address,
    };

    gym.name = name.trim();
    if (ownerName !== undefined) {
      gym.ownerName = ownerName.trim();
      if (ownerName.trim()) {
        await User.updateMany(
          { gymId, role: 'owner' },
          { $set: { name: ownerName.trim() } }
        );
      }
    }
    gym.phone = (phone || '').trim();
    gym.email = (email || '').trim().toLowerCase();
    gym.address = (address || '').trim();
    gym.city = (city || 'Lahore').trim();
    gym.country = (country || 'Pakistan').trim();
    gym.website = (website || '').trim();
    gym.description = (description || '').trim();
    if (logoUrl !== undefined) {
      gym.logoUrl = logoUrl;
    }

    await gym.save();

    await recordAudit(
      gymId,
      req.user,
      'UPDATE_GYM_PROFILE',
      'profile',
      `Updated Gym Profile to "${gym.name}" (Owner: "${gym.ownerName || 'N/A'}")`,
      { previous: previousData, current: { name: gym.name, ownerName: gym.ownerName, phone: gym.phone, email: gym.email } }
    );

    res.json({
      success: true,
      message: 'Gym Profile updated successfully',
      gym,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * PATCH /api/settings/membership
 * Updates membership duration, grace period, freeze fees, and policy disclaimers.
 */
export const updateMembershipSettings = async (req, res) => {
  try {
    const gymId = req.gymId;
    const {
      defaultMembershipDurationDays,
      freezeFee,
      gracePeriodDays,
      allowPartialPayments,
      allowRenewalBeforeExpiry,
      cancellationPolicy,
      freezePolicy,
      renewalPolicy,
      generalNotes,
    } = req.body;

    const gym = await Gym.findById(gymId);
    if (!gym) {
      return res.status(404).json({ success: false, message: 'Gym not found' });
    }

    if (!gym.settings) {
      gym.settings = {};
    }

    if (defaultMembershipDurationDays !== undefined) {
      const days = Number(defaultMembershipDurationDays);
      if (isNaN(days) || days < 1) {
        return res.status(400).json({ success: false, message: 'Default membership duration must be at least 1 day' });
      }
      gym.settings.defaultMembershipDurationDays = days;
    }

    if (freezeFee !== undefined) {
      const fee = Number(freezeFee);
      if (isNaN(fee) || fee < 0) {
        return res.status(400).json({ success: false, message: 'Freeze fee must be a positive number or 0' });
      }
      gym.settings.freezeFee = fee;
    }

    if (gracePeriodDays !== undefined) {
      const grace = Number(gracePeriodDays);
      if (isNaN(grace) || grace < 0) {
        return res.status(400).json({ success: false, message: 'Grace period must be a non-negative number' });
      }
      gym.settings.gracePeriodDays = grace;
    }

    if (allowPartialPayments !== undefined) {
      gym.settings.allowPartialPayments = Boolean(allowPartialPayments);
    }

    if (allowRenewalBeforeExpiry !== undefined) {
      gym.settings.allowRenewalBeforeExpiry = Boolean(allowRenewalBeforeExpiry);
    }

    if (cancellationPolicy !== undefined) gym.settings.cancellationPolicy = cancellationPolicy;
    if (freezePolicy !== undefined) gym.settings.freezePolicy = freezePolicy;
    if (renewalPolicy !== undefined) gym.settings.renewalPolicy = renewalPolicy;
    if (generalNotes !== undefined) gym.settings.generalNotes = generalNotes;

    gym.markModified('settings');
    await gym.save();

    await recordAudit(
      gymId,
      req.user,
      'UPDATE_MEMBERSHIP_SETTINGS',
      'membership',
      'Updated membership policies and grace period settings',
      {
        gracePeriodDays: gym.settings.gracePeriodDays,
        freezeFee: gym.settings.freezeFee,
        defaultDuration: gym.settings.defaultMembershipDurationDays,
      }
    );

    res.json({
      success: true,
      message: 'Membership settings updated successfully',
      settings: gym.settings,
      gym,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * PATCH /api/settings/finance
 * Updates currency, date formatting, timezone, and tax rate.
 * Historical financial transactions remain unchanged.
 */
export const updateFinanceSettings = async (req, res) => {
  try {
    const gymId = req.gymId;
    const {
      currency,
      currencySymbol,
      dateFormat,
      timezone,
      taxRate,
      checkInCutoffHour,
      checkInCutoffMinute,
      openingTime,
      closingTime,
    } = req.body;

    const gym = await Gym.findById(gymId);
    if (!gym) {
      return res.status(404).json({ success: false, message: 'Gym not found' });
    }

    const allowedCurrencies = ['PKR', 'USD', 'AED', 'GBP', 'EUR', 'SAR'];
    if (currency && !allowedCurrencies.includes(currency)) {
      return res.status(400).json({
        success: false,
        message: `Unsupported currency. Allowed: ${allowedCurrencies.join(', ')}`,
      });
    }

    const allowedDateFormats = ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'];
    if (dateFormat && !allowedDateFormats.includes(dateFormat)) {
      return res.status(400).json({
        success: false,
        message: `Unsupported date format. Allowed: ${allowedDateFormats.join(', ')}`,
      });
    }

    const allowedTimezones = ['Asia/Karachi', 'Asia/Dubai', 'UTC', 'America/New_York', 'Europe/London'];
    if (timezone && !allowedTimezones.includes(timezone)) {
      return res.status(400).json({
        success: false,
        message: `Unsupported timezone. Allowed: ${allowedTimezones.join(', ')}`,
      });
    }

    const previous = {
      currency: gym.currency,
      dateFormat: gym.dateFormat,
      timezone: gym.timezone,
    };

    if (currency) gym.currency = currency;
    if (currencySymbol) gym.currencySymbol = currencySymbol;
    if (dateFormat) gym.dateFormat = dateFormat;
    if (timezone) gym.timezone = timezone;

    if (!gym.settings) gym.settings = {};

    if (taxRate !== undefined) {
      const tax = Number(taxRate);
      if (isNaN(tax) || tax < 0 || tax > 100) {
        return res.status(400).json({ success: false, message: 'Tax rate must be between 0% and 100%' });
      }
      gym.settings.taxRate = tax;
    }

    if (checkInCutoffHour !== undefined) {
      const hr = Number(checkInCutoffHour);
      if (!isNaN(hr) && hr >= 0 && hr <= 23) {
        gym.settings.checkInCutoffHour = hr;
      }
    }

    if (checkInCutoffMinute !== undefined) {
      const min = Number(checkInCutoffMinute);
      if (!isNaN(min) && min >= 0 && min <= 59) {
        gym.settings.checkInCutoffMinute = min;
      }
    }

    if (openingTime !== undefined) {
      gym.settings.openingTime = String(openingTime).trim();
    }

    if (closingTime !== undefined) {
      gym.settings.closingTime = String(closingTime).trim();
    }

    gym.markModified('settings');
    await gym.save();

    await recordAudit(
      gymId,
      req.user,
      'UPDATE_FINANCE_SETTINGS',
      'finance',
      `Updated finance & regional settings to currency: ${gym.currency}, format: ${gym.dateFormat}`,
      { previous, current: { currency: gym.currency, dateFormat: gym.dateFormat, timezone: gym.timezone } }
    );

    res.json({
      success: true,
      message: 'Finance & Regional settings updated successfully',
      gym,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * PATCH /api/settings/notifications
 * Configures reminder lead days, default template language, and automated notification triggers.
 */
export const updateNotificationSettings = async (req, res) => {
  try {
    const gymId = req.gymId;
    const {
      enableExpiryReminders,
      reminderDaysBeforeExpiry,
      defaultReminderLanguage,
      enablePaymentDueReminders,
    } = req.body;

    const gym = await Gym.findById(gymId);
    if (!gym) {
      return res.status(404).json({ success: false, message: 'Gym not found' });
    }

    if (!gym.settings) {
      gym.settings = {};
    }

    if (reminderDaysBeforeExpiry !== undefined) {
      const days = Number(reminderDaysBeforeExpiry);
      if (isNaN(days) || days < 1 || days > 90) {
        return res.status(400).json({ success: false, message: 'Reminder window must be between 1 and 90 days' });
      }
      gym.settings.reminderDaysBeforeExpiry = days;
    }

    if (defaultReminderLanguage !== undefined) {
      if (!['en', 'ur'].includes(defaultReminderLanguage)) {
        return res.status(400).json({ success: false, message: 'Supported languages are "en" and "ur"' });
      }
      gym.settings.defaultReminderLanguage = defaultReminderLanguage;
    }

    if (enableExpiryReminders !== undefined) {
      gym.settings.enableExpiryReminders = Boolean(enableExpiryReminders);
    }

    if (enablePaymentDueReminders !== undefined) {
      gym.settings.enablePaymentDueReminders = Boolean(enablePaymentDueReminders);
    }

    gym.markModified('settings');
    await gym.save();

    await recordAudit(
      gymId,
      req.user,
      'UPDATE_NOTIFICATION_SETTINGS',
      'notifications',
      `Updated reminder preferences: window=${gym.settings.reminderDaysBeforeExpiry}d, language=${gym.settings.defaultReminderLanguage}`,
      {
        reminderDaysBeforeExpiry: gym.settings.reminderDaysBeforeExpiry,
        defaultReminderLanguage: gym.settings.defaultReminderLanguage,
        enableExpiryReminders: gym.settings.enableExpiryReminders,
      }
    );

    res.json({
      success: true,
      message: 'Notification & Reminder preferences updated successfully',
      settings: gym.settings,
      gym,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /api/settings/staff
 * Lists staff users belonging to the authenticated gym.
 */
export const getStaffUsers = async (req, res) => {
  try {
    const gymId = req.gymId;
    const staff = await User.find({ gymId }).select('-password').sort({ createdAt: -1 });
    res.json({ success: true, staff });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * POST /api/settings/staff
 * Enrolls a new staff user (receptionist, trainer, or owner) strictly for this gym.
 */
export const createStaffUser = async (req, res) => {
  try {
    const gymId = req.gymId;
    const { name, email, password, role = 'receptionist', phone } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: 'Name, email, and password are required' });
    }

    // Prohibit superadmin creation by gym owners
    if (role === 'superadmin') {
      return res.status(403).json({ success: false, message: 'Cannot create SuperAdmin accounts from gym portal' });
    }

    if (!['owner', 'receptionist', 'trainer'].includes(role)) {
      return res.status(400).json({ success: false, message: 'Invalid role. Must be owner, receptionist, or trainer' });
    }

    const existingUser = await User.findOne({ email: email.toLowerCase().trim() });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'User with this email already exists' });
    }

    const user = await User.create({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password,
      role,
      gymId,
      phone: (phone || '').trim(),
      isActive: true,
    });

    await recordAudit(
      gymId,
      req.user,
      'CREATE_STAFF_USER',
      'staff',
      `Created staff user "${user.name}" with role [${user.role}]`,
      { userId: user._id, email: user.email, role: user.role }
    );

    res.status(201).json({
      success: true,
      message: 'Staff user created successfully',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        phone: user.phone,
        isActive: user.isActive,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * PATCH /api/settings/staff/:id
 * Updates staff user profile, role, or active status with safety checks.
 */
export const updateStaffUser = async (req, res) => {
  try {
    const gymId = req.gymId;
    const targetUserId = req.params.id;
    const { name, phone, role, isActive, password } = req.body;

    const user = await User.findOne({ _id: targetUserId, gymId });
    if (!user) {
      return res.status(404).json({ success: false, message: 'Staff user not found in this gym' });
    }

    // Prevent privilege escalation to superadmin
    if (role === 'superadmin' || user.role === 'superadmin') {
      return res.status(403).json({ success: false, message: 'SuperAdmin modifications not permitted' });
    }

    // Prevent deactivating the only active gym owner
    if (isActive === false && user.role === 'owner') {
      const activeOwnersCount = await User.countDocuments({ gymId, role: 'owner', isActive: true });
      if (activeOwnersCount <= 1) {
        return res.status(400).json({
          success: false,
          message: 'Cannot deactivate the sole active Gym Owner. Assign another owner first.',
        });
      }
    }

    if (name) user.name = name.trim();
    if (phone !== undefined) user.phone = phone.trim();
    if (role && ['owner', 'receptionist', 'trainer'].includes(role)) {
      user.role = role;
    }
    if (isActive !== undefined) {
      user.isActive = Boolean(isActive);
    }
    if (password && password.trim().length >= 6) {
      user.password = password; // pre-save hook handles hashing
    }

    await user.save();

    await recordAudit(
      gymId,
      req.user,
      'UPDATE_STAFF_USER',
      'staff',
      `Updated staff user "${user.name}" (${user.email})`,
      { role: user.role, isActive: user.isActive }
    );

    res.json({
      success: true,
      message: 'Staff user updated successfully',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        phone: user.phone,
        isActive: user.isActive,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /api/settings/audit-logs
 * Retrieves paginated audit logs for the authenticated gym.
 */
export const getAuditLogs = async (req, res) => {
  try {
    const gymId = req.gymId;
    const { section, page = 1, limit = 50 } = req.query;
    const filter = { gymId };

    if (section && section !== 'all') {
      filter.section = section;
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [auditLogs, total] = await Promise.all([
      AuditLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
      AuditLog.countDocuments(filter),
    ]);

    res.json({
      success: true,
      total,
      count: auditLogs.length,
      auditLogs,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
