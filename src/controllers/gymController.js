import { Gym } from '../models/Gym.js';
import { User } from '../models/User.js';

export const getAllGyms = async (req, res) => {
  try {
    const { status, plan, search } = req.query;
    const filter = {};

    if (status) filter.subscriptionStatus = status;
    if (plan) filter.subscriptionPlan = plan;
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { branchCode: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ];
    }

    const gyms = await Gym.find(filter).sort({ createdAt: -1 });
    res.json({ success: true, count: gyms.length, gyms });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getGymById = async (req, res) => {
  try {
    const gym = await Gym.findById(req.params.id);
    if (!gym) {
      return res.status(404).json({ success: false, message: 'Gym not found' });
    }
    const staff = await User.find({ gymId: gym._id }).select('-password');
    res.json({ success: true, gym, staff });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const createGym = async (req, res) => {
  try {
    const {
      name,
      slug,
      branchCode,
      address,
      phone,
      email,
      logoUrl,
      subscriptionPlan,
      mrrAmount,
      currency,
      ownerName,
      ownerEmail,
      ownerPassword,
    } = req.body;

    const normalizedOwnerEmail = ownerEmail ? ownerEmail.toLowerCase().trim() : null;
    if (normalizedOwnerEmail) {
      const existingUser = await User.findOne({ email: normalizedOwnerEmail });
      if (existingUser) {
        const gymExists = existingUser.gymId ? await Gym.findById(existingUser.gymId) : null;
        if (gymExists) {
          return res.status(400).json({
            success: false,
            message: `A user with email ${normalizedOwnerEmail} is already assigned to active gym "${gymExists.name}".`,
          });
        }
        // Orphaned user from a previously deleted gym - clean it up
        await User.deleteOne({ _id: existingUser._id });
      }
    }

    const existingGym = await Gym.findOne({ $or: [{ slug }, { branchCode }] });
    if (existingGym) {
      return res.status(400).json({ success: false, message: 'Gym slug or Branch code already in use' });
    }

    const gym = await Gym.create({
      name,
      slug: slug || name.toLowerCase().replace(/[^a-z0-9]/g, '-'),
      branchCode: branchCode || `GYM-${Math.floor(1000 + Math.random() * 9000)}`,
      address,
      phone,
      email,
      logoUrl,
      subscriptionPlan: subscriptionPlan || 'pro',
      mrrAmount: mrrAmount || 4999,
      currency: currency || 'PKR',
    });

    let ownerUser = null;
    if (normalizedOwnerEmail && ownerPassword) {
      ownerUser = await User.create({
        name: ownerName || `${name} Owner`,
        email: normalizedOwnerEmail,
        password: ownerPassword,
        role: 'owner',
        gymId: gym._id,
        phone: phone || '',
      });
    }

    res.status(201).json({
      success: true,
      message: 'Gym and Owner created successfully',
      gym,
      owner: ownerUser ? { id: ownerUser._id, email: ownerUser.email, name: ownerUser.name } : null,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const updateGym = async (req, res) => {
  try {
    const gym = await Gym.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!gym) {
      return res.status(404).json({ success: false, message: 'Gym not found' });
    }
    if (req.body.ownerName && req.body.ownerName.trim()) {
      await User.updateMany(
        { gymId: gym._id, role: 'owner' },
        { $set: { name: req.body.ownerName.trim() } }
      );
    }
    res.json({ success: true, message: 'Gym updated successfully', gym });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteGym = async (req, res) => {
  try {
    const gym = await Gym.findByIdAndDelete(req.params.id);
    if (!gym) {
      return res.status(404).json({ success: false, message: 'Gym not found' });
    }
    // Delete associated users so emails can be cleanly re-used
    await User.deleteMany({ gymId: gym._id });
    res.json({ success: true, message: 'Gym deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteUserByEmail = async (req, res) => {
  try {
    const { email } = req.params;
    const result = await User.deleteMany({ email: email.toLowerCase().trim() });
    res.json({ success: true, message: `Deleted ${result.deletedCount} user(s) matching ${email}` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
