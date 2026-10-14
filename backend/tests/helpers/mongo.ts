import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { Campaign } from '../../src/models/Campaign';
import { Submission } from '../../src/models/Submission';
import { User } from '../../src/models/User';

/**
 * Shared integration-test database (spec §8.6): one in-memory MongoDB replica
 * set per test file, unique indexes built once, collections cleared between
 * tests, torn down at the end. A replica set is required because the app uses
 * transactions (D7); the default WiredTiger storage engine supports them.
 */
let replSet: MongoMemoryReplSet | undefined;

export async function setupTestDb(): Promise<void> {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
  // Build indexes up front so the unique indexes (D11: User.email,
  // Submission.normalizedUrl) exist before duplicate-key tests run.
  await Promise.all([User.init(), Campaign.init(), Submission.init()]);
}

export async function clearTestDb(): Promise<void> {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((collection) => collection.deleteMany({})));
}

export async function teardownTestDb(): Promise<void> {
  await mongoose.disconnect();
  if (replSet !== undefined) {
    await replSet.stop();
    replSet = undefined;
  }
}
