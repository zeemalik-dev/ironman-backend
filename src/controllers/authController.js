import jwt from 'jsonwebtoken';
import { Resend } from 'resend';
import { User } from '../models/User.js';
import { Gym } from '../models/Gym.js';

const getResendClient = () => {
  const apiKey = (process.env.RESEND_API_KEY || '').trim();
  if (!apiKey) return null;
  return new Resend(apiKey);
};

// Auto-sync user from Railway superadmin directory if not already seeded locally
async function tryFindAndSyncRemoteUser(cleanEmail) {
  try {
    const railwayUrl = 'https://divineesoft-gympro-production.up.railway.app/api';
    const loginRes = await fetch(`${railwayUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: process.env.DEFAULT_SUPERADMIN_EMAIL || 'superadmin@ironman.com',
        password: process.env.DEFAULT_SUPERADMIN_PASSWORD || 'Admin@123456',
      }),
    });
    const loginData = await loginRes.json();
    if (!loginData.token) return null;

    const gymsRes = await fetch(`${railwayUrl}/gyms`, {
      headers: { Authorization: `Bearer ${loginData.token}` },
    });
    const gymsData = await gymsRes.json();
    const gyms = gymsData?.gyms || [];

    for (const g of gyms) {
      if (g.email && g.email.toLowerCase().trim() === cleanEmail) {
        return await User.create({
          name: g.ownerName || `${g.name} Owner`,
          email: cleanEmail,
          password: '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
          role: 'owner',
          isActive: true,
        });
      }

      const detailRes = await fetch(`${railwayUrl}/gyms/${g._id}`, {
        headers: { Authorization: `Bearer ${loginData.token}` },
      });
      const detailData = await detailRes.json();
      const match = (detailData.staff || []).find(
        (s) => s.email && s.email.toLowerCase().trim() === cleanEmail
      );
      if (match) {
        return await User.create({
          name: match.name || g.name,
          email: cleanEmail,
          password: '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
          role: match.role || 'owner',
          isActive: match.isActive !== false,
        });
      }
    }
  } catch (err) {
    console.warn('[Remote Sync Warning]', err.message);
  }
  return null;
}

// Sync updated password to Railway cloud backend so login works seamlessly
async function syncPasswordToRemoteRailway(cleanEmail, newPassword) {
  try {
    const railwayUrl = 'https://divineesoft-gympro-production.up.railway.app/api';
    const loginRes = await fetch(`${railwayUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: process.env.DEFAULT_SUPERADMIN_EMAIL || 'superadmin@ironman.com',
        password: process.env.DEFAULT_SUPERADMIN_PASSWORD || 'Admin@123456',
      }),
    });
    const loginData = await loginRes.json();
    if (!loginData.token) return;

    const gymsRes = await fetch(`${railwayUrl}/gyms`, {
      headers: { Authorization: `Bearer ${loginData.token}` },
    });
    const gymsData = await gymsRes.json();
    const gyms = gymsData?.gyms || [];

    for (const g of gyms) {
      const detailRes = await fetch(`${railwayUrl}/gyms/${g._id}`, {
        headers: { Authorization: `Bearer ${loginData.token}` },
      });
      const detailData = await detailRes.json();
      const staffMember = (detailData.staff || []).find(
        (s) => s.email && s.email.toLowerCase().trim() === cleanEmail
      );

      if (staffMember) {
        console.log(`[Railway Password Sync] Updating password for staff ${cleanEmail} (Gym: ${g.name})...`);
        const patchRes = await fetch(`${railwayUrl}/settings/staff/${staffMember._id}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${loginData.token}`,
            'x-tenant-id': g._id.toString(),
          },
          body: JSON.stringify({ password: newPassword }),
        });
        const patchData = await patchRes.json();
        console.log('[Railway Password Sync Result]', patchData.message || patchData);
        return;
      }
    }
  } catch (err) {
    console.warn('[Railway Password Sync Warning]', err.message);
  }
}

const generateTokenAndSetCookie = (res, user) => {
  const token = jwt.sign(
    {
      userId: user._id,
      role: user.role,
      gymId: user.gymId,
      email: user.email,
    },
    process.env.JWT_SECRET || 'ironman-gym-super-secret-jwt-key-2026',
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );

  const isProduction = process.env.NODE_ENV === 'production';
  const cookieName = process.env.COOKIE_NAME || 'ironman_token';

  res.cookie(cookieName, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    path: '/',
  });

  return token;
};

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required' });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() }).populate('gymId');
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    if (!user.isActive) {
      return res.status(403).json({ success: false, message: 'Account is deactivated' });
    }

    const token = generateTokenAndSetCookie(res, user);

    res.json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        avatarUrl: user.avatarUrl,
        gym: user.gymId || null,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('-password').populate('gymId');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        avatarUrl: user.avatarUrl,
        gym: user.gymId || null,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const logout = async (req, res) => {
  const cookieName = process.env.COOKIE_NAME || 'ironman_token';
  const isProduction = process.env.NODE_ENV === 'production';

  res.clearCookie(cookieName, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    path: '/',
  });

  res.json({ success: true, message: 'Logged out successfully' });
};

export const verifyPassword = async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) {
      return res.status(400).json({ success: false, message: 'Password is required' });
    }

    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Compares against accessPassword if set, or defaults to main password
    const isMatch = await user.compareAccessPassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid access password. Verification failed.',
      });
    }

    res.json({ success: true, message: 'Password verified successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const changeAccessPassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Both current password and new access password are required',
      });
    }

    if (newPassword.trim().length < 4) {
      return res.status(400).json({
        success: false,
        message: 'New access password must be at least 4 characters long',
      });
    }

    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Validate current password (matches accessPassword if set, or main password if default)
    const isMatch = await user.compareAccessPassword(currentPassword);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Current password is incorrect.',
      });
    }

    // Set new access password (will be hashed by pre-save hook)
    user.accessPassword = newPassword.trim();
    await user.save();

    res.json({
      success: true,
      message: 'Access password updated successfully for all protected sections and actions',
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getAccessPasswordStatus = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    res.json({
      success: true,
      isCustomized: Boolean(user.accessPassword),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * POST /api/auth/forgot-password
 * Sends a 6-digit OTP to the user's email via Resend
 */
export const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || !email.trim()) {
      return res.status(400).json({ success: false, message: 'Email address is required' });
    }

    const cleanEmail = email.toLowerCase().trim();
    let user = await User.findOne({ email: cleanEmail }).populate('gymId');

    if (!user) {
      user = await tryFindAndSyncRemoteUser(cleanEmail);
      if (user && user.gymId) {
        user = await User.findById(user._id).populate('gymId');
      }
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'No active account found with this email address'
      });
    }

    // Dynamic Gym Name resolution for this user
    let gymName = 'Iron Man Gym';
    if (user.gymId && typeof user.gymId === 'object' && user.gymId.name) {
      gymName = user.gymId.name;
    } else if (user.gymId) {
      const foundGym = await Gym.findById(user.gymId);
      if (foundGym?.name) gymName = foundGym.name;
    }

    // Fallback: Check if there is a gym registered directly with this email
    if (gymName === 'Iron Man Gym') {
      const gymByEmail = await Gym.findOne({ email: cleanEmail });
      if (gymByEmail?.name) gymName = gymByEmail.name;
    }

    // Generate 6-digit numeric OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    user.resetPasswordOtp = otp;
    user.resetPasswordExpires = expiry;
    await user.save();

    // Send email via Resend if API key is present
    const resend = getResendClient();
    let emailSent = false;
    let emailError = null;
    let deliveredToEmail = cleanEmail;

    if (resend) {
      try {
        const fromEmail = `${gymName} <support@gym.divineesoft.com>`;
        const emailHtml = `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; background-color: #0d0d10; color: #ffffff; border-radius: 16px; border: 1px solid #27272a;">
            <div style="text-align: center; margin-bottom: 24px;">
              <h1 style="color: #ef4444; font-size: 24px; font-weight: 900; margin: 0; letter-spacing: 1px; text-transform: uppercase;">${gymName}</h1>
              <p style="color: #a1a1aa; font-size: 12px; margin-top: 4px; text-transform: uppercase; letter-spacing: 2px;">Security Verification</p>
            </div>
            <p style="font-size: 14px; color: #d4d4d8; line-height: 1.6;">Hello <strong>${user.name || 'Admin'}</strong>,</p>
            <p style="font-size: 13px; color: #a1a1aa; line-height: 1.6;">
              We received a request to reset your administrative portal password for <strong>${gymName}</strong>. Use the verification code below to authorize your password update:
            </p>
            <div style="text-align: center; margin: 32px 0;">
              <div style="display: inline-block; background: #18181b; border: 2px solid #ef4444; border-radius: 12px; padding: 14px 32px; font-size: 32px; font-weight: 900; letter-spacing: 8px; color: #ffffff; font-family: monospace;">
                ${otp}
              </div>
              <p style="font-size: 11px; color: #71717a; margin-top: 8px;">Valid for 10 minutes only</p>
            </div>
            <p style="font-size: 12px; color: #71717a; line-height: 1.5; border-top: 1px solid #27272a; padding-top: 16px;">
              If you did not initiate this request, you can safely ignore this email. Your current password remains protected.
            </p>
          </div>
        `;

        const sendRes = await resend.emails.send({
          from: fromEmail,
          to: cleanEmail,
          subject: `🔐 Your Password Reset OTP Code - ${gymName}`,
          html: emailHtml,
        });

        if (sendRes.error) {
          console.error('[Resend Delivery Error]', sendRes.error);
          emailError = sendRes.error.message;
        } else {
          emailSent = true;
          deliveredToEmail = cleanEmail;
        }
      } catch (err) {
        console.error('[Resend Error]', err);
        emailError = err.message;
      }
    } else {
      console.warn('[Resend Warning] RESEND_API_KEY is not defined in .env. OTP generated in logs for testing:', otp);
    }

    if (!emailSent && emailError) {
      return res.status(500).json({
        success: false,
        message: `Failed to deliver OTP to ${cleanEmail}: ${emailError}`,
      });
    }

    res.json({
      success: true,
      message: `Verification OTP has been sent to ${cleanEmail}`,
      emailSent,
      deliveredToEmail: cleanEmail,
      devOtp: !emailSent ? otp : undefined,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * POST /api/auth/verify-otp
 * Validates the 6-digit OTP code before proceeding to password change
 */
export const verifyOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Email address and 6-digit OTP code are required',
      });
    }

    const cleanEmail = email.toLowerCase().trim();
    const cleanOtp = String(otp).trim();

    const user = await User.findOne({
      email: cleanEmail,
      resetPasswordOtp: cleanOtp,
      resetPasswordExpires: { $gt: new Date() },
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired OTP code. Please check or request a new code.',
      });
    }

    res.json({
      success: true,
      message: 'OTP verified successfully.',
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * POST /api/auth/reset-password
 * Verifies the 6-digit OTP and updates the user's password
 */
export const resetPassword = async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;

    if (!email || !otp || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Email, OTP code, and new password are required'
      });
    }

    if (String(newPassword).length < 6) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 6 characters long'
      });
    }

    const cleanEmail = email.toLowerCase().trim();
    const cleanOtp = String(otp).trim();

    const user = await User.findOne({
      email: cleanEmail,
      resetPasswordOtp: cleanOtp,
      resetPasswordExpires: { $gt: new Date() }
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired OTP code. Please request a new code.'
      });
    }

    // Update password (pre-save hook will hash it with bcrypt automatically)
    user.password = newPassword;
    user.resetPasswordOtp = null;
    user.resetPasswordExpires = null;
    await user.save();

    // Sync new password to Railway cloud database
    await syncPasswordToRemoteRailway(cleanEmail, newPassword);

    res.json({
      success: true,
      message: 'Password reset successfully! You can now sign in with your new password.'
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
