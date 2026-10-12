import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';

/**
 * Shared integration-test database (spec §8.6): one in-memory MongoDB replica
 * set per test file, collections cleared between tests, torn down at the end.
 * A replica set is required because the app uses transactions (D7).
 */
let replSet: MongoMemoryReplSet | undefined;

export async function setupTestDb(): Promise<void> {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
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
