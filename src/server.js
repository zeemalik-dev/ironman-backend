import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectDB } from './config/db.js';

// Import Routes
import authRoutes from './routes/authRoutes.js';
import gymRoutes from './routes/gymRoutes.js';
import memberRoutes from './routes/memberRoutes.js';
import attendanceRoutes from './routes/attendanceRoutes.js';
import paymentRoutes from './routes/paymentRoutes.js';
import expenseRoutes from './routes/expenseRoutes.js';
import trainerRoutes from './routes/trainerRoutes.js';
import equipmentRoutes from './routes/equipmentRoutes.js';
import planRoutes from './routes/planRoutes.js';
import reportRoutes from './routes/reportRoutes.js';
import uploadRoutes from './routes/uploadRoutes.js';
import cashClosingRoutes from './routes/cashClosingRoutes.js';
import reminderRoutes from './routes/reminderRoutes.js';
import settingsRoutes from './routes/settingsRoutes.js';
import { errorHandler } from './middleware/errorHandler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8000;

// Connect to MongoDB
connectDB();

// CORS Whitelist Configuration
const allowedOrigins = [
  process.env.CLIENT_URL || 'http://localhost:3000',
  process.env.ADMIN_URL || 'http://localhost:4000',
  'http://localhost:3000',
  'http://localhost:4000',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:4000',
];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or curl)
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(null, true); // Allow during local development
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-tenant-id', 'x-client-mutation-id', 'X-Client-Mutation-Id'],
  })
);

// Body Parsing & Cookie Parser Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Static Uploads Directory
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Health Check Endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'online',
    timestamp: new Date().toISOString(),
    service: 'Iron Man Gym Multi-Tenant API',
    port: PORT,
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/gyms', gymRoutes);
app.use('/api/members', memberRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/trainers', trainerRoutes);
app.use('/api/equipment', equipmentRoutes);
app.use('/api/plans', planRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/cash-closing', cashClosingRoutes);
app.use('/api/reminders', reminderRoutes);
app.use('/api/settings', settingsRoutes);

// Centralized Error Handler
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`=============================================`);
  console.log(`🚀 Iron Man Unified Backend Running on Port ${PORT}`);
  console.log(`🔗 API Base: http://localhost:${PORT}/api`);
  console.log(`📂 Uploads URL: http://localhost:${PORT}/uploads`);
  console.log(`🌐 Allowed Client: ${process.env.CLIENT_URL || 'http://localhost:3000'}`);
  console.log(`👑 Allowed SuperAdmin: ${process.env.ADMIN_URL || 'http://localhost:4000'}`);
  console.log(`=============================================`);
});