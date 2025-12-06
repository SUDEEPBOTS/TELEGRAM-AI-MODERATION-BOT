const crypto = require('crypto');

class Helpers {
  // Check if text is a command
  static isCommand(text) {
    return text && text.startsWith('/');
  }
  
  // Extract command from text
  static extractCommand(text) {
    if (!this.isCommand(text)) return null;
    
    const match = text.match(/^\/([a-zA-Z0-9_]+)(@\w+)?/);
    return match ? match[1].toLowerCase() : null;
  }
  
  // Extract arguments from command
  static extractArgs(text) {
    if (!this.isCommand(text)) return '';
    
    const match = text.match(/^\/([a-zA-Z0-9_]+)(@\w+)?\s+(.*)/);
    return match ? match[3] : '';
  }
  
  // Generate random string
  static randomString(length = 8) {
    return crypto.randomBytes(Math.ceil(length / 2))
      .toString('hex')
      .slice(0, length);
  }
  
  // Format date
  static formatDate(date, format = 'DD/MM/YYYY HH:mm:ss') {
    const d = new Date(date);
    const pad = (n) => n.toString().padStart(2, '0');
    
    return format
      .replace('YYYY', d.getFullYear())
      .replace('MM', pad(d.getMonth() + 1))
      .replace('DD', pad(d.getDate()))
      .replace('HH', pad(d.getHours()))
      .replace('mm', pad(d.getMinutes()))
      .replace('ss', pad(d.getSeconds()));
  }
  
  // Truncate text
  static truncate(text, length = 100) {
    if (text.length <= length) return text;
    return text.substring(0, length) + '...';
  }
  
  // Escape HTML
  static escapeHtml(text) {
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
  }
  
  // Parse duration string to seconds
  static parseDuration(durationStr) {
    if (!durationStr) return 0;
    
    let totalSeconds = 0;
    const regex = /(\d+)\s*(s|sec|second|m|min|minute|h|hour|d|day|w|week|mon|month|y|year)s?/gi;
    let match;
    
    while ((match = regex.exec(durationStr)) !== null) {
      const value = parseInt(match[1]);
      const unit = match[2].toLowerCase();
      
      switch(unit) {
        case 's': case 'sec': case 'second':
          totalSeconds += value;
          break;
        case 'm': case 'min': case 'minute':
          totalSeconds += value * 60;
          break;
        case 'h': case 'hour':
          totalSeconds += value * 3600;
          break;
        case 'd': case 'day':
          totalSeconds += value * 86400;
          break;
        case 'w': case 'week':
          totalSeconds += value * 604800;
          break;
        case 'mon': case 'month':
          totalSeconds += value * 2592000; // 30 days
          break;
        case 'y': case 'year':
          totalSeconds += value * 31536000; // 365 days
          break;
      }
    }
    
    return totalSeconds;
  }
  
  // Format seconds to human readable
  static formatDuration(seconds) {
    if (seconds === 0) return 'permanent';
    
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (secs > 0 && days === 0 && hours === 0) parts.push(`${secs}s`);
    
    return parts.join(' ') || '0s';
  }
  
  // Generate inline keyboard
  static generateInlineKeyboard(buttons, columns = 2) {
    const keyboard = [];
    let row = [];
    
    buttons.forEach((button, index) => {
      row.push(button);
      if ((index + 1) % columns === 0 || index === buttons.length - 1) {
        keyboard.push(row);
        row = [];
      }
    });
    
    return { inline_keyboard: keyboard };
  }
  
  // Generate reply keyboard
  static generateReplyKeyboard(buttons, columns = 2, resize = true, oneTime = false) {
    const keyboard = [];
    let row = [];
    
    buttons.forEach((button, index) => {
      row.push({ text: button });
      if ((index + 1) % columns === 0 || index === buttons.length - 1) {
        keyboard.push(row);
        row = [];
      }
    });
    
    return {
      keyboard,
      resize_keyboard: resize,
      one_time_keyboard: oneTime
    };
  }
  
  // Remove keyboard
  static removeKeyboard() {
    return {
      remove_keyboard: true
    };
  }
  
  // Create pagination
  static createPagination(currentPage, totalPages, prefix = 'page') {
    const buttons = [];
    
    if (currentPage > 1) {
      buttons.push({
        text: '⬅️ Previous',
        callback_data: `${prefix}_${currentPage - 1}`
      });
    }
    
    buttons.push({
      text: `${currentPage}/${totalPages}`,
      callback_data: 'current'
    });
    
    if (currentPage < totalPages) {
      buttons.push({
        text: 'Next ➡️',
        callback_data: `${prefix}_${currentPage + 1}`
      });
    }
    
    return this.generateInlineKeyboard(buttons, 3);
  }
  
  // Validate email
  static isValidEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
  }
  
  // Validate URL
  static isValidUrl(url) {
    try {
      new URL(url);
      return true;
    } catch (_) {
      return false;
    }
  }
  
  // Debounce function
  static debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }
  
  // Throttle function
  static throttle(func, limit) {
    let inThrottle;
    return function(...args) {
      if (!inThrottle) {
        func.apply(this, args);
        inThrottle = true;
        setTimeout(() => inThrottle = false, limit);
      }
    };
  }
  
  // Deep clone object
  static deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }
  
  // Merge objects deeply
  static deepMerge(target, source) {
    const output = Object.assign({}, target);
    if (this.isObject(target) && this.isObject(source)) {
      Object.keys(source).forEach(key => {
        if (this.isObject(source[key])) {
          if (!(key in target)) {
            Object.assign(output, { [key]: source[key] });
          } else {
            output[key] = this.deepMerge(target[key], source[key]);
          }
        } else {
          Object.assign(output, { [key]: source[key] });
        }
      });
    }
    return output;
  }
  
  // Check if value is object
  static isObject(item) {
    return item && typeof item === 'object' && !Array.isArray(item);
  }
  
  // Sleep function
  static sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  // Generate unique ID
  static generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }
}

module.exports = Helpers;
