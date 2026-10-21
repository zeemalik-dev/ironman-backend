import { Router } from 'express';
import {
  getMembers,
  getMemberById,
  createMember,
  updateMember,
  renewMembership,
  deleteMember,
  freezeMember,
  unfreezeMember,
  bookTrainer,
  removeTrainer,
} from '../controllers/memberController.js';
import { authenticate, requireGymContext } from '../middleware/auth.js';

const router = Router();

router.use(authenticate, requireGymContext);

router.get('/', getMembers);
router.get('/:id', getMemberById);
router.post('/', createMember);
router.put('/:id', updateMember);
router.post('/:id/renew', renewMembership);
router.post('/:id/freeze', freezeMember);
router.post('/:id/unfreeze', unfreezeMember);
router.post('/:id/book-trainer', bookTrainer);
router.post('/:id/remove-trainer', removeTrainer);
router.delete('/:id', deleteMember);

export default router;
