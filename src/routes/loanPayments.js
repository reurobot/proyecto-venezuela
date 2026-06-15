// Route to list all loan payments (movimientos) across the system
import { Router } from 'express';
import { Loan } from '../db/index.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';

const router = Router();

// GET /loan-payments – returns a flat list of all installments that have a paid amount
router.get('/', authMiddleware, requireRole('admin', 'tesorero'), async (req, res) => {
  try {
    // Load only the fields we need to keep the query light
    const loans = await Loan.find({}).select('installmentsData');
    const payments = [];
    loans.forEach((loan) => {
      loan.installmentsData?.forEach((inst) => {
        if (inst.paidAmount && inst.paidAmount > 0) {
          payments.push({
            loanId: loan._id.toString(),
            installmentNumber: inst.installmentNumber,
            dueDate: inst.dueDate ? new Date(inst.dueDate).toISOString() : null,
            amountUsd: inst.amountUsd,
            paidAmount: inst.paidAmount,
            paidAt: inst.paidAt ? new Date(inst.paidAt).toISOString() : null,
            status: inst.status,
          });
        }
      });
    });
    res.json(payments);
  } catch (err) {
    console.error('Error fetching loan payments:', err);
    res.status(500).json({ error: err.message || 'Error al cargar los movimientos de préstamos' });
  }
});

export default router;
