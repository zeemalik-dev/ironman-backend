import { Router } from 'express';
import {
  getSettings,
  updateGymProfile,
  updateMembershipSettings,
  updateFinanceSettings,
  updateNotificationSettings,
  updateSocialSettings,
  getStaffUsers,
  createStaffUser,
  updateStaffUser,
  getAuditLogs,
} from '../controllers/settingsController.js';
import { authenticate, requireGymContext, requireRole } from '../middleware/auth.js';

const router = Router();

// Base middleware: Authentication & Gym context required
router.use(authenticate, requireGymContext);

// Read settings & staff (Owners, SuperAdmins, Receptionists)
router.get('/', requireRole('superadmin', 'owner', 'receptionist'), getSettings);
router.get('/staff', requireRole('superadmin', 'owner', 'receptionist'), getStaffUsers);
router.get('/audit-logs', requireRole('superadmin', 'owner'), getAuditLogs);

// Notification preferences can be configured by owners & frontdesk
router.patch('/notifications', requireRole('superadmin', 'owner', 'receptionist'), updateNotificationSettings);
router.patch('/socials', requireRole('superadmin', 'owner', 'receptionist'), updateSocialSettings);

// Gym Profile, Membership, Finance, and Staff Management restricted to Gym Owners & SuperAdmins
router.patch('/profile', requireRole('superadmin', 'owner'), updateGymProfile);
router.patch('/membership', requireRole('superadmin', 'owner'), updateMembershipSettings);
router.patch('/finance', requireRole('superadmin', 'owner'), updateFinanceSettings);
router.post('/staff', requireRole('superadmin', 'owner'), createStaffUser);
router.patch('/staff/:id', requireRole('superadmin', 'owner'), updateStaffUser);

export default router;
