/**
 * Database Seeder
 * Run with: npm run seed
 * 
 * Creates initial data including:
 * - Superadmin user
 * - Sample admin user
 * - Sample regular users
 * - Sample profiles
 * - Initial benchmark
 */

const mongoose = require('mongoose');
const dotenv = require('dotenv');
const bcrypt = require('bcryptjs');

dotenv.config();

// Models
const User = require('../models/User');
const Profile = require('../models/Profile');
const Entry = require('../models/Entry');
const Benchmark = require('../models/Benchmark');

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('MongoDB connected for seeding');
  } catch (error) {
    console.error('Database connection error:', error.message);
    process.exit(1);
  }
};

const seedData = async () => {
  try {
    // Clear existing data
    console.log('Clearing existing data...');
    await User.deleteMany({});
    await Profile.deleteMany({});
    await Entry.deleteMany({});
    await Benchmark.deleteMany({});

    console.log('Creating users...');

    // Create Superadmin
    const superadmin = await User.create({
      email: 'superadmin@airhub.com',
      password: 'superadmin123',
      name: 'Super Administrator',
      role: 'superadmin',
      isApproved: true,
      isActive: true,
    });
    console.log(`✅ Superadmin created: ${superadmin.email}`);

    // Create Admin
    const admin = await User.create({
      email: 'admin@airhub.com',
      password: 'admin123',
      name: 'Admin User',
      role: 'admin',
      isApproved: true,
      isActive: true,
    });
    console.log(`✅ Admin created: ${admin.email}`);

    // Create Regular Users
    const users = await User.insertMany([
      {
        email: 'worker1@airhub.com',
        password: await bcrypt.hash('worker123', 12),
        name: 'John Worker',
        role: 'user',
        isApproved: true,
        isActive: true,
        bankDetails: {
          bankName: 'First National Bank',
          accountNumber: '1234567890',
          accountName: 'John Worker',
        },
      },
      {
        email: 'worker2@airhub.com',
        password: await bcrypt.hash('worker123', 12),
        name: 'Jane Smith',
        role: 'user',
        isApproved: true,
        isActive: true,
        bankDetails: {
          bankName: 'City Bank',
          accountNumber: '0987654321',
          accountName: 'Jane Smith',
        },
      },
      {
        email: 'worker3@airhub.com',
        password: await bcrypt.hash('worker123', 12),
        name: 'Bob Johnson',
        role: 'user',
        isApproved: true,
        isActive: true,
      },
      {
        email: 'pending@airhub.com',
        password: await bcrypt.hash('pending123', 12),
        name: 'Pending User',
        role: 'user',
        isApproved: false,  // Not approved yet
        isActive: true,
      },
    ]);
    console.log(`✅ ${users.length} workers created`);

    console.log('Creating profiles...');

    // Create Profiles
    const profiles = await Profile.insertMany([
      {
        email: 'profile1@client.com',
        password: await bcrypt.hash('profile123', 12),
        fullName: 'Client Company A',
        state: 'California',
        country: 'USA',
        accountBearerName: 'Michael Brown',
        defaultWorker: users[0]._id,  // John Worker
      },
      {
        email: 'profile2@client.com',
        password: await bcrypt.hash('profile123', 12),
        fullName: 'Client Company B',
        state: 'New York',
        country: 'USA',
        accountBearerName: 'Sarah Wilson',
        defaultWorker: users[0]._id,  // John Worker (assigned to multiple)
      },
      {
        email: 'profile3@client.com',
        password: await bcrypt.hash('profile123', 12),
        fullName: 'Client Company C',
        state: 'Lagos',
        country: 'Nigeria',
        accountBearerName: 'Emmanuel Okonkwo',
        defaultWorker: users[1]._id,  // Jane Smith
      },
      {
        email: 'profile4@client.com',
        password: await bcrypt.hash('profile123', 12),
        fullName: 'Client Company D',
        state: 'London',
        country: 'UK',
        accountBearerName: 'James Williams',
        defaultWorker: users[2]._id,  // Bob Johnson
      },
      {
        email: 'unassigned@client.com',
        password: await bcrypt.hash('profile123', 12),
        fullName: 'Unassigned Client',
        state: 'Texas',
        country: 'USA',
        accountBearerName: 'Robert Davis',
        defaultWorker: null,  // No worker assigned
      },
    ]);
    console.log(`✅ ${profiles.length} profiles created`);

    // Update users with assigned profiles
    await User.findByIdAndUpdate(users[0]._id, {
      assignedProfiles: [profiles[0]._id, profiles[1]._id],
    });
    await User.findByIdAndUpdate(users[1]._id, {
      assignedProfiles: [profiles[2]._id],
    });
    await User.findByIdAndUpdate(users[2]._id, {
      assignedProfiles: [profiles[3]._id],
    });

    console.log('Creating initial benchmark...');

    // Create Initial Benchmark
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 14);  // 2 weeks ago
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 14);  // 2 weeks from now

    const benchmark = await Benchmark.create({
      timeBenchmark: 8,  // 8 hours per day target
      qualityBenchmark: 85,  // 85% quality target
      startDate,
      endDate,
      thresholds: {
        excellent: 80,
        good: 70,
        average: 60,
        minimum: 50,
      },
      bonusRates: {
        excellent: 1.2,  // 20% bonus
        good: 1.1,       // 10% bonus
        average: 1.0,    // No bonus
        minimum: 0.9,    // 10% reduction
        below: 0.8,      // 20% reduction
      },
      createdBy: superadmin._id,
      notes: 'Initial benchmark for January 2026',
    });
    console.log(`✅ Benchmark created: Time ${benchmark.timeBenchmark}h, Quality ${benchmark.qualityBenchmark}%`);

    console.log('Creating sample entries...');

    // Create Sample Entries (last 14 days for worker 1)
    const entries = [];
    for (let i = 13; i >= 0; i--) {
      const entryDate = new Date();
      entryDate.setDate(entryDate.getDate() - i);
      entryDate.setHours(0, 0, 0, 0);

      // Random time between 6-10 hours
      const time = Math.round((6 + Math.random() * 4) * 100) / 100;
      // Random quality between 70-100
      const quality = Math.round((70 + Math.random() * 30) * 100) / 100;

      entries.push({
        profile: profiles[0]._id,
        worker: users[0]._id,
        date: entryDate,
        time,
        quality,
        adminApproved: i > 7,  // Older entries are approved
        adminTime: i > 7 ? time - (Math.random() * 0.5) : undefined,
        adminQuality: i > 7 ? quality - (Math.random() * 5) : undefined,
        approvedBy: i > 7 ? admin._id : undefined,
        approvedAt: i > 7 ? new Date() : undefined,
      });
    }

    // Add entries for worker 2
    for (let i = 6; i >= 0; i--) {
      const entryDate = new Date();
      entryDate.setDate(entryDate.getDate() - i);
      entryDate.setHours(0, 0, 0, 0);

      entries.push({
        profile: profiles[2]._id,
        worker: users[1]._id,
        date: entryDate,
        time: Math.round((7 + Math.random() * 3) * 100) / 100,
        quality: Math.round((75 + Math.random() * 25) * 100) / 100,
        adminApproved: false,
      });
    }

    await Entry.insertMany(entries);
    console.log(`✅ ${entries.length} entries created`);

    // Update profile performance stats
    console.log('Updating profile performance stats...');
    for (const profile of profiles) {
      await Profile.updatePerformanceStats(profile._id);
    }

    console.log('\n========================================');
    console.log('✅ Database seeding completed successfully!');
    console.log('========================================\n');
    console.log('Test Accounts:');
    console.log('----------------------------------------');
    console.log('Superadmin: superadmin@airhub.com / superadmin123');
    console.log('Admin:      admin@airhub.com / admin123');
    console.log('Worker 1:   worker1@airhub.com / worker123');
    console.log('Worker 2:   worker2@airhub.com / worker123');
    console.log('Worker 3:   worker3@airhub.com / worker123');
    console.log('Pending:    pending@airhub.com / pending123 (not approved)');
    console.log('----------------------------------------\n');

    process.exit(0);
  } catch (error) {
    console.error('Seeding error:', error);
    process.exit(1);
  }
};

// Run seeder
connectDB().then(seedData);
 