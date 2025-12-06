const { GoogleGenerativeAI } = require('@google/generative-ai');
const apiKeyManager = require('../config/apiKeys');
const logger = require('../utils/logger');

class GeminiService {
  constructor() {
    this.genAI = null;
    this.currentModel = null;
    this.init();
  }
  
  init() {
    try {
      const apiKey = apiKeyManager.getNextKey();
      this.genAI = new GoogleGenerativeAI(apiKey);
      this.currentModel = this.genAI.getGenerativeModel({ 
        model: "gemini-2.0-flash-exp",
        generationConfig: {
          temperature: 0.7,
          topP: 0.9,
          maxOutputTokens: 500,
        }
      });
      logger.info('Gemini service initialized');
    } catch (error) {
      logger.error('Failed to initialize Gemini:', error);
    }
  }
  
  async query(prompt, retries = 3) {
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        if (!this.currentModel) {
          this.init();
        }
        
        const result = await this.currentModel.generateContent(prompt);
        const response = await result.response;
        const text = response.text();
        
        logger.debug(`Gemini response (attempt ${attempt + 1}): ${text.substring(0, 100)}...`);
        return text;
      } catch (error) {
        logger.error(`Gemini query attempt ${attempt + 1} failed:`, error.message);
        
        if (error.message.includes('429') || error.message.includes('quota')) {
          // Rate limit exceeded, switch key
          apiKeyManager.markKeyBlocked(apiKeyManager.currentKey, 'Rate limit');
          this.init(); // Reinitialize with new key
        }
        
        if (attempt === retries - 1) {
          throw new Error(`Gemini query failed after ${retries} attempts: ${error.message}`);
        }
        
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
      }
    }
  }
  
  async moderateMessage(message, context = {}) {
    const prompt = `
    You are Yuki, an AI moderator for a Telegram group.
    
    Message to moderate: "${message}"
    
    Context:
    - Sender: ${context.senderName || 'Unknown'}
    - Group: ${context.groupName || 'Unknown'}
    - Previous warnings: ${context.warnings || 0}
    
    Rules:
    1. NO hate speech, racism, sexism
    2. NO personal attacks or bullying
    3. NO spam, scams, or malicious links
    4. NO NSFW content
    5. NO excessive caps or flooding
    6. Respect all members
    
    Analyze and respond with ONLY valid JSON:
    {
      "action": "BAN" | "MUTE" | "KICK" | "WARN" | "IGNORE" | "DELETE",
      "reason": "Clear reason for action",
      "duration": 3600 (seconds, only for MUTE),
      "severity": "LOW" | "MEDIUM" | "HIGH",
      "dm_message": "Message to send user in DM",
      "response": "Public response in group (short)"
    }
    
    Guidelines:
    - BAN for severe violations (hate speech, threats)
    - MUTE (1-24h) for medium violations (abuse, spam)
    - KICK for temporary removal
    - WARN for minor issues
    - DELETE for rule-breaking without punishment
    - IGNORE for acceptable messages
    
    Be strict but fair. Protect the community.
    `;
    
    try {
      const response = await this.query(prompt);
      const parsed = JSON.parse(response.trim());
      
      // Validate response
      const validActions = ['BAN', 'MUTE', 'KICK', 'WARN', 'IGNORE', 'DELETE'];
      if (!validActions.includes(parsed.action)) {
        parsed.action = 'IGNORE';
      }
      
      return parsed;
    } catch (error) {
      logger.error('Moderation parsing error:', error);
      return {
        action: 'IGNORE',
        reason: 'Error in moderation system',
        severity: 'LOW'
      };
    }
  }
  
  async handleAppeal(appealData) {
    const prompt = `
    Appeal Review Request:
    
    User: ${appealData.userName}
    User ID: ${appealData.userId}
    Group: ${appealData.groupName}
    
    Original Offense: ${appealData.offense}
    Original Action: ${appealData.action}
    User's Appeal Reason: "${appealData.reason}"
    
    User History:
    - Total warnings: ${appealData.totalWarnings}
    - Previous bans: ${appealData.previousBans}
    - Appeal attempts: ${appealData.appealAttempts}
    
    Instructions:
    Review this appeal fairly. Consider:
    1. Sincerity of apology
    2. Understanding of rules
    3. Past behavior
    4. Likelihood of reoffending
    
    Respond with ONLY JSON:
    {
      "decision": "APPROVE" | "DENY",
      "reason": "Detailed explanation",
      "conditions": ["Condition 1", "Condition 2"] (if any),
      "probation_days": 7 (if APPROVE)
    }
    
    Be compassionate but maintain group safety.
    `;
    
    try {
      const response = await this.query(prompt);
      return JSON.parse(response.trim());
    } catch (error) {
      logger.error('Appeal handling error:', error);
      return {
        decision: 'DENY',
        reason: 'Error processing appeal',
        conditions: [],
        probation_days: 0
      };
    }
  }
  
  async generateWelcomeMessage(user, group) {
    const prompt = `
    Generate a warm welcome message for a new member.
    
    New Member: ${user.first_name} ${user.last_name || ''} (@${user.username || 'no_username'})
    Group: ${group.title}
    
    Message should be:
    - Friendly and welcoming
    - Short (1-2 lines)
    - Include group rules mention
    - Optional: Add emoji
    - In Hindi/English mix
    
    Respond with ONLY the welcome message text.
    `;
    
    try {
      const response = await this.query(prompt);
      return response.trim();
    } catch (error) {
      return `Welcome ${user.first_name}! Please read group rules. 👋`;
    }
  }
  
  async chatResponse(message, history = []) {
    const prompt = `
    You are Yuki, a friendly and helpful AI assistant in a Telegram group.
    
    Conversation History (last 5 messages):
    ${history.slice(-5).map(msg => `${msg.sender}: ${msg.text}`).join('\n')}
    
    New message: "${message}"
    
    Respond as Yuki:
    - Be concise (max 2 sentences)
    - Be helpful and friendly
    - Use emojis occasionally
    - If question is unclear, ask for clarification
    - Don't mention you're an AI unless asked
    
    Respond with ONLY your response message.
    `;
    
    try {
      const response = await this.query(prompt);
      return response.trim();
    } catch (error) {
      return "I'm here! How can I help? 😊";
    }
  }
}

module.exports = new GeminiService();
