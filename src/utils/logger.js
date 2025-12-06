const winston = require('winston');
const path = require('path');

// Define log format
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

// Create logger instance
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  defaultMeta: { service: 'telegram-ai-bot' },
  transports: [
    // Console transport
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }),
    // File transport for errors
    new winston.transports.File({ 
      filename: path.join(__dirname, '../../logs/error.log'), 
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }),
    // File transport for all logs
    new winston.transports.File({ 
      filename: path.join(__dirname, '../../logs/combined.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 5
    })
  ]
});

// Create logs directory if it doesn't exist
const fs = require('fs');
const logDir = path.join(__dirname, '../../logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// Add Telegram logging transport
class TelegramTransport extends winston.transports.Transport {
  constructor(opts) {
    super(opts);
    this.bot = opts.bot;
    this.chatId = opts.chatId;
    this.name = 'telegram';
  }

  log(info, callback) {
    setImmediate(() => {
      this.emit('logged', info);
    });

    if (this.bot && this.chatId && info.level === 'error') {
      const message = `🚨 <b>Bot Error</b>\n\n` +
        `<b>Time:</b> ${info.timestamp}\n` +
        `<b>Level:</b> ${info.level}\n` +
        `<b>Message:</b> ${info.message}\n` +
        `<b>Stack:</b>\n<code>${info.stack || 'No stack trace'}</code>`;
      
      this.bot.sendMessage(this.chatId, message, { parse_mode: 'HTML' })
        .catch(err => {
          console.error('Failed to send error to Telegram:', err);
        });
    }

    callback();
  }
}

// Function to add Telegram transport
logger.addTelegramTransport = function(bot, chatId) {
  this.add(new TelegramTransport({ bot, chatId }));
};

// Logging utility functions
logger.requestLog = function(req) {
  this.info('Request', {
    method: req.method,
    url: req.url,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });
};

logger.errorLog = function(error, context = {}) {
  this.error('Error occurred', {
    error: error.message,
    stack: error.stack,
    ...context
  });
};

logger.botAction = function(action, details) {
  this.info('Bot Action', { action, ...details });
};

logger.databaseQuery = function(query, duration, collection) {
  this.debug('Database Query', { query, duration, collection });
};

module.exports = logger;
