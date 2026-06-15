import { Router } from 'express';
import { Loan, Client, User } from '../db/index.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { validate, schemas } from '../middleware/validation.js';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

const router = Router();

// List loans (admin sees all, asesor sees theirs, tesorero sees all)
router.get('/', authMiddleware, async (req, res) => {
  const { role, id } = req.user;
  let filter = {};
  if (role === 'asesor') {
    filter.advisorId = id;
  }
  const loans = await Loan.find(filter).populate('clientId advisorId');
  res.json(loans);
});

// Get loan details (including installments)
router.get('/:id', authMiddleware, async (req, res) => {
  const loan = await Loan.findById(req.params.id).populate('clientId advisorId');
  if (!loan) return res.status(404).json({ error: 'Préstamo no encontrado' });
  res.json(loan);
});

// Create new loan (admin or asesor)
router.post('/', authMiddleware, requireRole('admin', 'asesor'), validate(schemas.createLoan), async (req, res) => {
  const data = req.validated;
  const advisorId = req.user.id; // advisor creating the loan
  let client = await Client.findById(data.clientId);
  if (!client) {
    client = await Client.findOne({ dni: data.clientId });
  }
  if (!client) return res.status(404).json({ error: 'Cliente no encontrado' });

  // Compute total to pay based on simple interest amortization
  const totalInterest = (data.amountUsd * data.interestRate) / 100;
  const totalToPay = data.amountUsd + totalInterest;

  // Generate installments (simple equal split)
  const principalPortion = data.amountUsd / data.installments;
  const interestPortion = totalInterest / data.installments;
  const installmentAmount = principalPortion + interestPortion;
  const now = new Date();
  const installments = [];
  for (let i = 1; i <= data.installments; i++) {
    const due = new Date(now);
    const daysToAdd = { Diaria: 1, Semanal: 7, Quincenal: 14, Mensual: 30 };
    due.setDate(due.getDate() + i * (daysToAdd[data.frequency] || 30));
    installments.push({
      installmentNumber: i,
      dueDate: due,
      amountUsd: installmentAmount,
      capitalPortion: principalPortion,
      interestPortion: interestPortion,
      status: 'pending',
      paidAmount: 0
    });
  }

  const loan = await Loan.create({
    clientId: client._id,
    advisorId: advisorId,
    amountUsd: data.amountUsd,
    bankSource: data.bankSource,
    frequency: data.frequency,
    installments: data.installments,
    interestRate: data.interestRate,
    status: 'active',
    totalToPay: totalToPay,
    graceDays: data.graceDays ?? 3,
    dailyPenaltyPercent: data.dailyPenaltyPercent ?? 3,
    compoundOnDefault: data.compoundOnDefault ?? true,
    installmentsData: installments
  });

  const populated = await Loan.findById(loan._id).populate('clientId advisorId');
  res.status(201).json(populated);
});

// Register payment for an installment (admin or assigned asesor)
router.post('/:id/payments', authMiddleware, requireRole('admin', 'asesor'), validate(z.object({
  installmentNumber: z.number().int().positive(),
  amount: z.number().positive()
})), async (req, res) => {
  const { installmentNumber, amount } = req.validated;
  const loan = await Loan.findById(req.params.id);
  if (!loan) return res.status(404).json({ error: 'Préstamo no encontrado' });

  const installment = loan.installmentsData.find(i => i.installmentNumber === installmentNumber);
  if (!installment) return res.status(404).json({ error: 'Cuota no encontrada' });

  const isLate = installment.status === 'late' || new Date(installment.dueDate) < new Date();
  let penaltyAmount = 0;
  let compoundApplied = false;

  if (isLate && !installment.lateFeeApplied) {
    const now = new Date();
    const msLate = now.getTime() - new Date(installment.dueDate).getTime();
    const daysLate = Math.max(0, Math.floor(msLate / (1000 * 60 * 60 * 24)));

    if (daysLate > 0 && loan.dailyPenaltyPercent > 0) {
      const penaltyDays = Math.min(daysLate, loan.graceDays);
      const dailyRate = loan.dailyPenaltyPercent / 100;
      penaltyAmount = installment.amountUsd * dailyRate * penaltyDays;

      // If past grace period, compound interest onto capital
      if (daysLate > loan.graceDays && loan.compoundOnDefault) {
        compoundApplied = true;
      }
    }
    installment.lateFeeApplied = true;
  }

  installment.paidAmount += amount;
  installment.status = installment.paidAmount >= installment.amountUsd ? 'paid' : 'partial';
  installment.paidAt = new Date();

  // Update aggregated loan fields
  loan.capitalRecovered += installment.capitalPortion * (amount / installment.amountUsd);
  loan.interestEarned += installment.interestPortion * (amount / installment.amountUsd);
  loan.lateFees += penaltyAmount;

  // If compounded, add interest to capital and reapply rate on remaining balance
  if (compoundApplied) {
    const unpaidInterest = loan.totalToPay - loan.capitalRecovered - loan.interestEarned;
    const newCapital = loan.amountUsd - loan.capitalRecovered + unpaidInterest;
    const newInterest = newCapital * loan.interestRate / 100;
    loan.totalToPay = newCapital + newInterest;
    loan.amountUsd = newCapital;
    loan.interestEarned = 0;
    loan.capitalRecovered = 0;
  }

  loan.updatedAt = new Date();

  await loan.save();
  res.json({ message: 'Pago registrado', loanId: loan._id, installmentNumber, newStatus: installment.status, paidAmount: installment.paidAmount, penaltyAmount, compoundApplied });
});

// Update loan (admin or asesor)
router.patch('/:id', authMiddleware, requireRole('admin', 'asesor'), validate(z.object({
  amountUsd: z.number().positive().optional(),
  interestRate: z.number().min(0).max(100).optional(),
  frequency: z.enum(['diaria', 'semanal', 'quincenal', 'mensual']).transform(v => v.charAt(0).toUpperCase() + v.slice(1)).optional(),
  installments: z.number().int().positive().optional(),
  status: z.enum(['active', 'completed', 'defaulted', 'cancelled']).optional(),
  bankSource: z.enum(['mercantil', 'bcv', 'bancamiga', 'plaza', 'binance']).optional(),
  graceDays: z.number().int().min(0).max(30).optional(),
  dailyPenaltyPercent: z.number().min(0).max(100).optional(),
  compoundOnDefault: z.boolean().optional(),
})), async (req, res) => {
  const data = req.validated;
  const loan = await Loan.findById(req.params.id);
  if (!loan) return res.status(404).json({ error: 'Préstamo no encontrado' });

  // If loan parameters change, recalculate installments
  if (data.amountUsd || data.interestRate || data.installments || data.frequency) {
    const amount = data.amountUsd ?? loan.amountUsd;
    const rate = data.interestRate ?? loan.interestRate;
    const installments = data.installments ?? loan.installments;
    const frequency = data.frequency ?? loan.frequency;
    const totalInterest = (amount * rate) / 100;
    const totalToPay = amount + totalInterest;
    const principalPortion = amount / installments;
    const interestPortion = totalInterest / installments;
    const installmentAmount = principalPortion + interestPortion;
    const now = new Date();
    const newInstallments = [];
    for (let i = 1; i <= installments; i++) {
      const due = new Date(now);
      const daysMap = { Diaria: 1, Semanal: 7, Quincenal: 14, Mensual: 30 };
      due.setDate(due.getDate() + i * (daysMap[frequency] || 30));
      newInstallments.push({
        installmentNumber: i,
        dueDate: due,
        amountUsd: installmentAmount,
        capitalPortion: principalPortion,
        interestPortion: interestPortion,
        status: 'pending',
        paidAmount: 0,
      });
    }
    loan.installmentsData = newInstallments;
    loan.totalToPay = totalToPay;
    loan.amountUsd = amount;
    loan.interestRate = rate;
    loan.installments = installments;
    loan.frequency = frequency;
    loan.capitalRecovered = 0;
    loan.interestEarned = 0;
  }

  if (data.status) loan.status = data.status;
  if (data.bankSource) loan.bankSource = data.bankSource;
  if (data.graceDays !== undefined) loan.graceDays = data.graceDays;
  if (data.dailyPenaltyPercent !== undefined) loan.dailyPenaltyPercent = data.dailyPenaltyPercent;
  if (data.compoundOnDefault !== undefined) loan.compoundOnDefault = data.compoundOnDefault;
  loan.updatedAt = new Date();

  await loan.save();
  const populated = await Loan.findById(loan._id).populate('clientId advisorId');
  res.json(populated);
});

// Delete loan (admin only)
router.delete('/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  const loan = await Loan.findByIdAndDelete(req.params.id);
  if (!loan) return res.status(404).json({ error: 'Préstamo no encontrado' });
  res.json({ message: 'Préstamo eliminado' });
});

export default router;
