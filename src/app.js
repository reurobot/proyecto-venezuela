import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { config } from './config/index.js';
import authRoutes from './routes/auth.js';
import clientRoutes from './routes/clients.js';
import loanRoutes from './routes/loans.js';
import treasuryRoutes from './routes/treasury.js';
import requestRoutes from './routes/requests.js';
import waitlistRoutes from './routes/waitlist.js';
import dashboardRoutes from './routes/dashboard.js';
import bcvRatesRouter from './routes/bcvRates.js';
import bcvCronRouter from './routes/bcvCron.js';
import appDataRouter from './routes/appData.js';
import usersRouter from './routes/users.js';
import adminRouter from './routes/admin.js';
import debugRouter from './routes/debug.js';
import notificationsRouter from './routes/notifications.js';

const app = express();

// Middleware stack
app.use(cors({ origin: config.corsOrigin, credentials: true }));
app.use(helmet());
app.use(express.json({ limit: '2mb' }));
app.use(morgan('dev'));
app.use(express.static('public'));

// API versioning prefix
const api = express.Router();

// Cron route (no auth, protected by CRON_SECRET)
api.use('/bcv-rates/cron', bcvCronRouter);

// Auth routes
api.use('/auth', authRoutes);
api.use('/clients', clientRoutes);
api.use('/loans', loanRoutes);
api.use('/treasury', treasuryRoutes);
api.use('/requests', requestRoutes);
api.use('/waitlist', waitlistRoutes);
api.use('/dashboard', dashboardRoutes);

// BCV rates (auth required)
api.use('/bcv-rates', bcvRatesRouter);

// App initial data (auth required)
api.use('/app-data', appDataRouter);
api.use('/users', usersRouter);
api.use('/notifications', notificationsRouter);
api.use('/debug', debugRouter);

app.use('/api/v1', api);
app.use('/api/v1/admin', adminRouter);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint no encontrado' });
});

export default app;
