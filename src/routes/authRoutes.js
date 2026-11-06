import { Router } from 'express';
import {
  login,
  getMe,
  logout,
  verifyPassword,
  changeAccessPassword,
  getAccessPasswordStatus,
  forgotPassword,
  verifyOtp,
  resetPassword,
} from '../controllers/authController.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

router.post('/login', login);
router.post('/forgot-password', forgotPassword);
router.post('/verify-otp', verifyOtp);
router.post('/reset-password', resetPassword);
router.get('/me', authenticate, getMe);
router.post('/logout', authenticate, logout);
router.post('/verify-password', authenticate, verifyPassword);
router.post('/change-access-password', authenticate, changeAccessPassword);
router.get('/access-password-status', authenticate, getAccessPasswordStatus);

export default router;
