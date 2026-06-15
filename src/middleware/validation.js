import { z } from 'zod';

export function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        error: 'Datos de entrada inválidos',
        details: result.error.flatten().fieldErrors
      });
    }
    req.validated = result.data;
    next();
  };
}

export const schemas = {
  login: z.object({
    email: z.string().email('Email inválido'),
    password: z.string().min(1, 'Contraseña requerida')
  }),

  registerClient: z.object({
    firstName: z.string().min(1, 'Nombre requerido'),
    lastName: z.string().min(1, 'Apellido requerido'),
    dni: z.string().min(1, 'DNI requerido'),
    phone: z.string().min(1, 'Teléfono requerido'),
    email: z.string().email('Email inválido').optional().or(z.literal('')),
    baseInterestRate: z.number().min(0).max(100).default(25),
    maxPreapprovedAmount: z.number().min(0).default(500),
    assignedAdvisorId: z.string().optional().nullable()
  }),

  createLoan: z.object({
    clientId: z.string().min(1, 'Cliente inválido'),
    amountUsd: z.number().positive('Monto debe ser positivo'),
    bankSource: z.enum(['mercantil', 'bcv', 'bancamiga', 'plaza', 'binance']),
    frequency: z.enum(['diaria', 'semanal', 'quincenal', 'mensual']).transform(v => v.charAt(0).toUpperCase() + v.slice(1)),
    installments: z.number().int().positive('Cuotas inválidas'),
    interestRate: z.number().min(0).max(100),
    graceDays: z.number().int().min(0).max(30).optional().default(3),
    dailyPenaltyPercent: z.number().min(0).max(100).optional().default(3),
    compoundOnDefault: z.boolean().optional().default(true)
  }),

  treasuryTransaction: z.object({
    accountId: z.string().min(1),
    type: z.enum(['deposit', 'withdrawal']),
    amountUsd: z.number().positive(),
    commission: z.number().min(0).default(0),
    description: z.string().min(1, 'Descripción requerida'),
    referenceId: z.string().optional(),
    referenceType: z.string().optional()
  }),

  bcvRate: z.object({
    usdRate: z.number().positive('Tasa debe ser positiva')
  }),

  createRequest: z.object({
    type: z.enum(['loan_approval', 'withdrawal', 'deposit', 'client_registration', 'rate_change', 'other']),
    priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
    title: z.string().min(1, 'Título requerido'),
    description: z.string().optional(),
    dataJson: z.record(z.any()).optional()
  }),

  updateRequest: z.object({
    status: z.enum(['approved', 'rejected', 'cancelled']),
    rejectionReason: z.string().optional()
  }),

  addWaitlist: z.object({
    clientId: z.string().min(1),
    requestedAmountUsd: z.number().positive(),
    preferredFrequency: z.enum(['Semanal', 'Quincenal', 'Mensual']).optional(),
    preferredInstallments: z.number().int().positive().optional(),
    notes: z.string().optional()
  }),

  createAccount: z.object({
    name: z.string().min(1, 'Nombre requerido'),
    type: z.enum(['bank', 'local', 'exchange', 'crypto']),
    balanceUsd: z.number().min(0).default(0),
    currency: z.string().default('USD'),
    accountNumber: z.string().optional().default(''),
  }),

  updateAccount: z.object({
    name: z.string().min(1).optional(),
    type: z.enum(['bank', 'exchange', 'crypto']).optional(),
    balanceUsd: z.number().min(0).optional(),
    currency: z.string().optional(),
    accountNumber: z.string().optional(),
    isActive: z.boolean().optional(),
  }),

  updateProfile: z.object({
    fullName: z.string().min(1).optional(),
    phone: z.string().optional(),
    currentPassword: z.string().optional(),
    newPassword: z.string().min(6).optional()
  }).refine(data => !data.newPassword || data.currentPassword, {
    message: 'Contraseña actual requerida para cambiar contraseña',
    path: ['currentPassword']
  })
};