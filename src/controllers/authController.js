import jwt from 'jsonwebtoken';
import { User } from '../models/User.js';
import { Gym } from '../models/Gym.js';

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
      return res.status(400).json({ success: false, message: 'Admin password is required' });
    }

    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid admin password. Action verification failed.',
      });
    }

    res.json({ success: true, message: 'Password verified successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
