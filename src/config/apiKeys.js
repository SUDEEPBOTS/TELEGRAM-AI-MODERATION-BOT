class GeminiKeyManager {
  constructor() {
    this.keys = [];
    this.currentIndex = 0;
    this.usage = {};
    this.hourlyLimit = 15;
    this.initKeys();
  }
  
  initKeys() {
    // Load all API keys from environment
    for (let i = 1; i <= 10; i++) {
      const key = process.env[`GEMINI_API_KEY_${i}`];
      if (key && key.trim() !== '') {
        this.keys.push({
          key: key.trim(),
          index: i,
          used: 0,
          blocked: false,
          lastReset: Date.now()
        });
      }
    }
    
    console.log(`Loaded ${this.keys.length} Gemini API keys`);
  }
  
  getNextKey() {
    if (this.keys.length === 0) {
      throw new Error('No Gemini API keys available');
    }
    
    // Reset hourly usage
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;
    
    for (const keyObj of this.keys) {
      if (now - keyObj.lastReset > oneHour) {
        keyObj.used = 0;
        keyObj.blocked = false;
        keyObj.lastReset = now;
      }
    }
    
    // Find available key
    const availableKeys = this.keys.filter(k => 
      !k.blocked && k.used < this.hourlyLimit
    );
    
    if (availableKeys.length === 0) {
      // All keys exhausted, reset all
      this.keys.forEach(k => {
        k.used = 0;
        k.blocked = false;
        k.lastReset = now;
      });
      return this.keys[0].key;
    }
    
    // Use round-robin selection
    for (let i = 0; i < this.keys.length; i++) {
      this.currentIndex = (this.currentIndex + 1) % this.keys.length;
      const keyObj = this.keys[this.currentIndex];
      
      if (!keyObj.blocked && keyObj.used < this.hourlyLimit) {
        keyObj.used++;
        return keyObj.key;
      }
    }
    
    // Fallback to first key
    this.keys[0].used++;
    return this.keys[0].key;
  }
  
  markKeyBlocked(key, reason) {
    const keyObj = this.keys.find(k => k.key === key);
    if (keyObj) {
      keyObj.blocked = true;
      keyObj.blockReason = reason;
      console.log(`Key ${keyObj.index} blocked: ${reason}`);
    }
  }
  
  getKeyStats() {
    return this.keys.map(k => ({
      index: k.index,
      used: k.used,
      blocked: k.blocked,
      available: this.hourlyLimit - k.used
    }));
  }
  
  resetAllKeys() {
    const now = Date.now();
    this.keys.forEach(k => {
      k.used = 0;
      k.blocked = false;
      k.lastReset = now;
    });
    return 'All keys reset successfully';
  }
}

module.exports = new GeminiKeyManager();
