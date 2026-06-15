import { Router } from 'express';
import {
  User, Client, Loan, TreasuryAccount, BcvRate,
  Request as LoanRequest, Waitlist, TreasuryTransaction, Notification
} from '../db/index.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

router.get('/', authMiddleware, async (req, res) => {
  try {
    const { role, id } = req.user;

    // BCV rate — try to fetch fresh rate if stored one is stale
    const bcvDoc = await BcvRate.findOne({ currency: 'VES' }).sort({ date: -1 });
    let tasaBCV = bcvDoc ? bcvDoc.usdRate : 45.5;
    const oneDayMs = 86400000;
    const isStale = !bcvDoc || Date.now() - new Date(bcvDoc.date).getTime() > oneDayMs;
    if (isStale) {
      try {
        const resp = await fetch('https://bcv.today/api/v1/rate.json');
        if (resp.ok) {
          const data = await resp.json();
          if (data.USD && data.date) {
            tasaBCV = data.USD;
            const d = new Date(data.date + 'T12:00:00');
            const exists = await BcvRate.findOne({ currency: 'VES', date: d });
            if (exists) { exists.usdRate = data.USD; await exists.save(); }
            else { await BcvRate.create({ date: d, usdRate: data.USD, currency: 'VES' }); }
          }
        }
      } catch (_) {} // silent fallback to stored rate
    }

    // Treasury accounts banks
    const accounts = await TreasuryAccount.find({ isActive: { $ne: false } });
    const banks = accounts.map(a => ({
      id: a._id.toString(),
      name: a.name,
      balance: a.balanceUsd,
      accountNumber: a.accountNumber || (a.name + ' • ' + a.type),
      type: a.type || 'local',
    }));

    // Clients with advisor names and loan stats
    const clientFilter = role === 'admin' ? {} : { assignedAdvisorId: id };
    const clientsRaw = await Client.find(clientFilter).populate('assignedAdvisorId', 'fullName email');
    const clientIds = clientsRaw.map(c => c._id);

    const loanStats = await Loan.aggregate([
      { $match: { clientId: { $in: clientIds } } },
      {
        $group: {
          _id: '$clientId',
          totalLoans: { $sum: 1 },
          activeLoan: { $push: { $cond: [{ $eq: ['$status', 'active'] }, '$_id', null] } },
        },
      },
    ]);
    const statsMap = {};
    for (const s of loanStats) {
      const activeLoans = s.activeLoan.filter(Boolean);
      statsMap[s._id.toString()] = {
        totalLoans: s.totalLoans,
        activeLoanId: activeLoans.length > 0 ? activeLoans[0].toString() : null,
      };
    }

    const clients = [];
    for (const c of clientsRaw) {
      const s = statsMap[c._id.toString()] || { totalLoans: 0, activeLoanId: null };
      clients.push({
        id: c._id.toString(),
        name: `${c.firstName} ${c.lastName}`,
        email: c.email || '',
        phone: c.phone || '',
        cedula: c.dni || '',
        status: c.status === 'blocked' ? 'inactive' : (c.status || 'active'),
        asesorId: c.assignedAdvisorId ? c.assignedAdvisorId._id.toString() : '',
        asesorName: c.assignedAdvisorId ? c.assignedAdvisorId.fullName || '' : '',
        totalLoans: s.totalLoans,
        activeLoan: s.activeLoanId || undefined,
        since: c.createdAt ? new Date(c.createdAt).toISOString().split('T')[0] : '',
        sequentialId: c.sequentialId,
      });
    }

    // Loans with client and advisor names
    const loanFilter = role === 'asesor' ? { advisorId: id } : {};
    const loansRaw = await Loan.find(loanFilter)
      .populate('clientId', 'firstName lastName dni')
      .populate('advisorId', 'fullName');

    const loans = loansRaw.map(l => {
  // Map installments for detailed view
  const installments = l.installmentsData.map(i => ({
    installmentNumber: i.installmentNumber,
    dueDate: i.dueDate ? new Date(i.dueDate).toISOString().split('T')[0] : '',
    amountUsd: i.amountUsd,
    capitalPortion: i.capitalPortion,
    interestPortion: i.interestPortion,
    status: i.status,
    paidAmount: i.paidAmount,
    paidAt: i.paidAt ? new Date(i.paidAt).toISOString() : undefined,
    lateFeeApplied: i.lateFeeApplied
  }));
      const totalPaid = l.installmentsData.reduce(function(sum, i) { return sum + (i.paidAmount || 0); }, 0);
      const paidInstallments = l.installmentsData.filter(function(i) { return i.status === 'paid'; }).length;
      const nextDue = l.installmentsData.find(function(i) { return i.status === 'pending' || i.status === 'late'; });
      const freqMap = { Diaria: 1 / 30, Semanal: 0.25, Quincenal: 0.5, Mensual: 1 };
      const frequencyMonths = freqMap[l.frequency] || 1;
      const monthlyPmt = l.installments > 0 ? l.totalToPay / l.installments : 0;
      let status = l.status;
      if (status === 'completed') status = 'paid';
      else if (status === 'defaulted') status = 'overdue';

      return {
        id: l._id.toString(),
        clientId: l.clientId ? l.clientId._id.toString() : '',
        clientName: l.clientId ? ((l.clientId.firstName || '') + ' ' + (l.clientId.lastName || '')).trim() : '',
        amount: l.amountUsd,
        currency: 'USD',
        rate: l.interestRate,
        termMonths: Math.round(l.installments * frequencyMonths),
        monthlyPayment: monthlyPmt,
        paid: totalPaid,
        balance: Math.max(0, l.totalToPay - totalPaid),
        status: status,
        asesorId: l.advisorId ? l.advisorId._id.toString() : '',
        asesorName: l.advisorId ? l.advisorId.fullName || '' : '',
        startDate: l.createdAt ? new Date(l.createdAt).toISOString().split('T')[0] : '',
        nextDue: nextDue ? new Date(nextDue.dueDate).toISOString().split('T')[0] : '',
        cuotasPaid: paidInstallments,
        cuotasTotal: l.installments,
        graceDays: l.graceDays ?? 3,
        dailyPenaltyPercent: l.dailyPenaltyPercent ?? 3,
        compoundOnDefault: l.compoundOnDefault ?? true,
        frecuencia: (l.frequency || 'diaria').toLowerCase(),
        sequentialId: l.sequentialId,
      };
    });

    // Advisors (users with role asesor)
    const advisorsRaw = await User.find({ role: 'asesor' });
    const advisors = [];
    for (const a of advisorsRaw) {
      const loanCount = await Loan.countDocuments({ advisorId: a._id, status: { $ne: 'cancelled' } });
      const collectedAgg = await Loan.aggregate([
        { $match: { advisorId: a._id } },
        { $unwind: '$installmentsData' },
        { $match: { 'installmentsData.status': 'paid' } },
        { $group: { _id: null, total: { $sum: '$installmentsData.paidAmount' } } },
      ]);
      const totalCollected = collectedAgg[0] ? collectedAgg[0].total : 0;
      const nameArr = (a.fullName || '').split(' ');
      const initials = nameArr.map(function(n) { return n[0]; }).filter(Boolean).slice(0, 2).join('').toUpperCase() || '??';
      advisors.push({
        id: a._id.toString(),
        name: a.fullName || '',
        email: a.email,
        phone: a.phone || '',
        status: a.isActive ? 'active' : 'inactive',
        activeLoans: loanCount,
        totalCollected: totalCollected,
        commission: Math.round(totalCollected * 0.1),
        since: a.createdAt ? new Date(a.createdAt).toISOString().split('T')[0] : '',
        initials: initials,
      });
    }

    // Requests
    const reqFilter = role === 'admin' ? {} : { requesterId: id };
    const requestsRaw = await LoanRequest.find(reqFilter).sort({ createdAt: -1 });
    const userIds = [];
    for (const r of requestsRaw) {
      if (r.requesterId) userIds.push(r.requesterId.toString());
    }
    const uniqueUserIds = [...new Set(userIds)];
    const userMap = {};
    if (uniqueUserIds.length > 0) {
      const users = await User.find({ _id: { $in: uniqueUserIds } }).select('fullName');
      for (const u of users) userMap[u._id.toString()] = u.fullName;
    }

    const requests = requestsRaw.map(function(r) {
      let reqType = 'other';
      if (r.type === 'loan_approval') reqType = 'new-loan';
      else if (r.type === 'withdrawal') reqType = 'cancellation';

      let priority = 'medium';
      if (r.priority === 'urgent' || r.priority === 'high') priority = 'high';
      else if (r.priority === 'low') priority = 'low';

      let reqStatus = 'pending';
      if (r.status === 'approved') reqStatus = 'approved';
      else if (r.status === 'rejected') reqStatus = 'rejected';

      return {
        id: r._id.toString(),
        clientName: r.title || 'Solicitud',
        clientId: r.requesterId ? r.requesterId.toString() : '',
        type: reqType,
        amount: (r.dataJson && r.dataJson.amount) || 0,
        status: reqStatus,
        asesorId: r.requesterId ? r.requesterId.toString() : '',
        asesorName: userMap[r.requesterId ? r.requesterId.toString() : ''] || '',
        createdAt: r.createdAt ? new Date(r.createdAt).toISOString().split('T')[0] : '',
        notes: r.description || '',
        priority: priority,
      };
    });

    // Waitlist with client info
    const waitRaw = await Waitlist.find({}).sort({ createdAt: -1 });
    const waitClientIds = [];
    for (const w of waitRaw) {
      if (w.clientId) waitClientIds.push(w.clientId.toString());
    }
    const uniqueWaitClientIds = [...new Set(waitClientIds)];
    const waitClientMap = {};
    if (uniqueWaitClientIds.length > 0) {
      const waitClients = await Client.find({ _id: { $in: uniqueWaitClientIds } }).select('firstName lastName phone');
      for (const c of waitClients) {
        waitClientMap[c._id.toString()] = {
          name: ((c.firstName || '') + ' ' + (c.lastName || '')).trim(),
          phone: c.phone || '',
        };
      }
    }

    const waitQueue = waitRaw.map(function(w, idx) {
      const ci = waitClientMap[w.clientId ? w.clientId.toString() : ''] || {};
      return {
        id: w._id.toString(),
        clientName: ci.name || '',
        phone: ci.phone || '',
        requestType: w.preferredFrequency ? 'Préstamo ' + w.preferredFrequency : 'Préstamo',
        amount: w.requestedAmountUsd,
        registeredAt: w.createdAt ? new Date(w.createdAt).toISOString() : '',
        notes: w.notes || '',
        position: idx + 1,
      };
    });

    // Recent treasury transactions
    const transactionsRaw = await TreasuryTransaction.find().sort({ createdAt: -1 }).limit(50);
    const transactions = transactionsRaw.map(t => ({
      id: t._id.toString(),
      accountId: t.accountId ? t.accountId.toString() : '',
      type: t.type,
      amountUsd: t.amountUsd,
      commission: t.commission || 0,
      description: t.description || '',
      createdAt: t.createdAt ? t.createdAt.toISOString() : '',
    }));

    // Calendar events (all pending installments)
    const calendarEvents = [];
    for (const l of loansRaw) {
      const clientName = l.clientId ? ((l.clientId.firstName || '') + ' ' + (l.clientId.lastName || '')).trim() : '';
      for (const inst of l.installmentsData) {
        if (inst.status === 'paid' || inst.status === 'cancelled') continue;
        calendarEvents.push({
          loanId: l._id.toString(),
          clientName,
          installmentNumber: inst.installmentNumber,
          dueDate: inst.dueDate ? new Date(inst.dueDate).toISOString().split('T')[0] : '',
          amountUsd: inst.amountUsd || 0,
          status: inst.status === 'late' ? 'overdue' : (inst.status || 'pending'),
sequentialId: l.sequentialId,
          installmentsData: installments,
        });
      }
    }
    calendarEvents.sort((a, b) => a.dueDate.localeCompare(b.dueDate));

    // Notifications
    const notifications = await Notification.find({ userId: id }).sort({ createdAt: -1 }).limit(20);
    const unreadCount = await Notification.countDocuments({ userId: id, read: false });

    res.json({
      tasaBCV,
      banks,
      clients,
      loans,
      requests,
      advisors,
      waitQueue,
      transactions,
      notifications,
      unreadCount,
      calendarEvents,
      capitalFondeo: 0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Error al cargar datos iniciales' });
  }
});

export default router;
