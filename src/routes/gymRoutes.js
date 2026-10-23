import { Router } from 'express';
import {
  getAllGyms,
  getGymById,
  createGym,
  updateGym,
  deleteGym,
  deleteUserByEmail,
} from '../controllers/gymController.js';
import { authenticate, requireRole } from '../middleware/auth.js';

const router = Router();

// Gym routes accessible to SuperAdmin & Owners
router.use(authenticate);

router.get('/', requireRole('superadmin'), getAllGyms);
router.get('/:id', getGymById);
router.post('/', requireRole('superadmin'), createGym);
router.delete('/users/by-email/:email', requireRole('superadmin'), deleteUserByEmail);
router.put('/:id', requireRole('superadmin', 'owner'), updateGym);
router.delete('/:id', requireRole('superadmin'), deleteGym);

export default router;
