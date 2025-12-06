const mongoose = require('mongoose');
const logger = require('../utils/logger');

class MongoDB {
  constructor() {
    this.isConnected = false;
    this.connection = null;
  }
  
  async connect() {
    if (this.isConnected) {
      return this.connection;
    }
    
    try {
      const MONGODB_URI = process.env.MONGODB_URI;
      
      if (!MONGODB_URI) {
        throw new Error('MONGODB_URI is not defined in environment variables');
      }
      
      // Connection options
      const options = {
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
        family: 4
      };
      
      // Connect to MongoDB
      await mongoose.connect(MONGODB_URI, options);
      
      this.connection = mongoose.connection;
      this.isConnected = true;
      
      // Event listeners
      this.connection.on('connected', () => {
        logger.info('MongoDB connected successfully');
      });
      
      this.connection.on('error', (err) => {
        logger.error('MongoDB connection error:', err);
        this.isConnected = false;
      });
      
      this.connection.on('disconnected', () => {
        logger.warn('MongoDB disconnected');
        this.isConnected = false;
      });
      
      // Graceful shutdown
      process.on('SIGINT', async () => {
        await this.disconnect();
        process.exit(0);
      });
      
      logger.info('MongoDB connection established');
      return this.connection;
      
    } catch (error) {
      logger.error('Failed to connect to MongoDB:', error);
      throw error;
    }
  }
  
  async disconnect() {
    if (this.isConnected && mongoose.connection.readyState === 1) {
      await mongoose.disconnect();
      this.isConnected = false;
      logger.info('MongoDB disconnected');
    }
  }
  
  getConnection() {
    if (!this.isConnected) {
      throw new Error('MongoDB not connected. Call connect() first.');
    }
    return this.connection;
  }
  
  getStatus() {
    return {
      connected: this.isConnected,
      readyState: mongoose.connection.readyState,
      host: mongoose.connection.host,
      name: mongoose.connection.name,
      models: Object.keys(mongoose.models)
    };
  }
  
  // Health check
  async healthCheck() {
    try {
      if (!this.isConnected) {
        return { healthy: false, error: 'Not connected to MongoDB' };
      }
      
      // Ping the database
      await mongoose.connection.db.admin().ping();
      return { 
        healthy: true, 
        ping: 'ok',
        collections: await mongoose.connection.db.listCollections().toArray()
      };
    } catch (error) {
      return { healthy: false, error: error.message };
    }
  }
  
  // Clear all data (for development)
  async clearDatabase() {
    if (process.env.NODE_ENV !== 'development') {
      throw new Error('clearDatabase can only be used in development mode');
    }
    
    const collections = mongoose.connection.collections;
    for (const key in collections) {
      await collections[key].deleteMany({});
    }
    
    logger.warn('Database cleared');
    return 'Database cleared successfully';
  }
}

module.exports = new MongoDB();
