const winston = require('winston');

// Check if we're in Vercel environment
const isVercel = process.env.VERCEL === '1' || 
                 process.env.NODE_ENV === 'production' || 
                 process.env.VERCEL_URL;

// Create transports array
const transports = [];

// Always add console transport
transports.push(
  new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      winston.format.printf(({ timestamp, level, message, ...meta }) => {
        return `${timestamp} [${level}]: ${message} ${
          Object.keys(meta).length ? JSON.stringify(meta) : ''
        }`;
      })
    )
  })
);

// Only add file transport in development/local environment
if (!isVercel) {
  const fs = require('fs');
  const path = require('path');
  
  // Create logs directory safely
  try {
    const logDir = path.join(__dirname, '../../logs');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    
    transports.push(
      new winston.transports.File({
        filename: path.join(logDir, 'error.log'),
        level: 'error',
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.json()
        )
      })
    );
    
    transports.push(
      new winston.transports.File({
        filename: path.join(logDir, 'combined.log'),
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.json()
        )
      })
    );
    
  } catch (fileError) {
    console.warn('File logging disabled:', fileError.message);
  }
}

// Create logger instance
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  transports: transports,
  // Handle exceptions
  exceptionHandlers: transports,
  rejectionHandlers: transports
});

// Test the logger
if (!isVercel) {
  logger.info('Logger initialized successfully');
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`Vercel: ${isVercel ? 'Yes' : 'No'}`);
}

module.exports = logger;
