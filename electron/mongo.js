/**
 * @file electron/mongo.js
 * Shared MongoDB client options and short-lived connection helpers for the main process.
 */
const { MongoClient, ServerApiVersion } = require('mongodb');

const SCRAPE_DB_NAME = process.env.MONGO_DB_NAME || 'electron_webscraping';

/**
 * @returns {import('mongodb').MongoClientOptions}
 */
function getMongoClientOptions() {
    return {
        serverApi: {
            version: ServerApiVersion.v1,
            strict: true,
            deprecationErrors: true,
        },
    };
}

/**
 * Runs a database operation against the configured MongoDB database.
 *
 * @template T
 * @param {(db: import('mongodb').Db) => Promise<T>} operation
 * @returns {Promise<T>}
 */
async function withMongo(operation) {
    if (!process.env.MONGO_URI) {
        throw new Error('MONGO_URI is not set.');
    }

    const opClient = new MongoClient(process.env.MONGO_URI, getMongoClientOptions());

    try {
        await opClient.connect();
        const db = opClient.db(SCRAPE_DB_NAME);
        return await operation(db);
    } finally {
        await opClient.close();
    }
}

/**
 * Verifies MongoDB connectivity: connect, ping admin, close.
 * Startup smoke test; does not keep a persistent connection.
 *
 * @returns {Promise<void>}
 */
async function pingOnce() {
    const client = new MongoClient(process.env.MONGO_URI, getMongoClientOptions());
    try {
        await client.connect();
        await client.db('admin').command({ ping: 1 });
        console.log('Pinged your deployment. You successfully connected to MongoDB!');
    } finally {
        await client.close();
    }
}

module.exports = {
    SCRAPE_DB_NAME,
    getMongoClientOptions,
    withMongo,
    pingOnce,
};
