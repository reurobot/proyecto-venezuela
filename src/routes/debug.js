import { Router } from 'express';
import { config } from '../config/index.js';

const router = Router();

// Simple debug endpoint – returns the MongoDB URI the app is using.
router.get('/mongo-uri', (req, res) => {
  // Do NOT expose credentials in production; this is for troubleshooting only.
  res.json({ mongoUri: config.mongoUri });
});

export default router;
