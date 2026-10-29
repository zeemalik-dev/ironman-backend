import { Expense } from '../models/Expense.js';

export const getExpenses = async (req, res) => {
  try {
    const gymId = req.gymId;
    const { category, month, limit = 50, page = 1 } = req.query;
    const filter = { gymId };

    if (category && category !== 'all') filter.category = category;
    if (month) {
      const start = new Date(`${month}-01`);
      const end = new Date(start.getFullYear(), start.getMonth() + 1, 0, 23, 59, 59);
      filter.spentOn = { $gte: start, $lte: end };
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [expenses, total, totalSum] = await Promise.all([
      Expense.find(filter).sort({ spentOn: -1 }).skip(skip).limit(Number(limit)),
      Expense.countDocuments(filter),
      Expense.aggregate([
        { $match: filter },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
    ]);

    res.json({
      success: true,
      total,
      totalSpent: totalSum[0]?.total || 0,
      count: expenses.length,
      expenses,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const createExpense = async (req, res) => {
  try {
    const gymId = req.gymId;
    const { title, category, amount, spentOn, receiptNo, notes } = req.body;

    if (!title || amount === undefined || Number(amount) <= 0) {
      return res.status(400).json({ success: false, message: 'Title and a positive amount are required' });
    }

    const expense = await Expense.create({
      gymId,
      title,
      category: category || 'utilities',
      amount: Number(amount),
      spentOn: spentOn ? new Date(spentOn) : new Date(),
      receiptNo: receiptNo || '',
      paidBy: req.user?.name || 'Admin',
      notes: notes || '',
    });

    res.status(201).json({ success: true, message: 'Expense logged successfully', expense });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteExpense = async (req, res) => {
  try {
    const expense = await Expense.findOneAndDelete({ _id: req.params.id, gymId: req.gymId });
    if (!expense) {
      return res.status(404).json({ success: false, message: 'Expense record not found' });
    }
    res.json({ success: true, message: 'Expense record removed successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
