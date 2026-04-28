import mongoose from 'mongoose';
import dns from 'node:dns';

const connectDB = async () => {
  try {
    const dnsServers = (process.env.MONGODB_DNS_SERVERS || '0.0.0.0,1.1.1.1')
      .split(',')
      .map((server) => server.trim())
      .filter(Boolean);

    if (dnsServers.length > 0) {
      dns.setServers(dnsServers);
    }

    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      retryWrites: true,
      w: 'majority',
      serverSelectionTimeoutMS: Number(process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS || 5000),
      socketTimeoutMS: Number(process.env.MONGODB_SOCKET_TIMEOUT_MS || 45000),
      maxPoolSize: Number(process.env.MONGODB_POOL_MAX || 100),
      minPoolSize: Number(process.env.MONGODB_POOL_MIN || 5),
      family: 4
    });

    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
    return conn.connection;
  } catch (error) {
    console.error(`❌ MongoDB Connection Error: ${error.message}`);
    process.exit(1);
  }
};

export default connectDB;
