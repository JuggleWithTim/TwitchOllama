// Import required libraries
const tmi = require('tmi.js'); // Twitch chat client
const axios = require('axios'); // For making HTTP requests to Ollama
const { OpenAI } = require('openai'); // OpenAI Node.js module
const fs = require('fs').promises;
const path = require('path');

// === USER SETTINGS === //
const SETTINGS = {
  // Twitch bot credentials
  username: 'botusername', // Replace with your bot's Twitch username
  password: 'oauth:000', // Replace with your bot's OAuth token (get it from https://twitchtokengenerator.com/)
  channel: 'channelname', // Replace with the channel name where the bot will join
  
  // Twitch Helix API credentials
  twitchClientId: '000',
  twitchClientSecret: '000',

  // API settings
  useOpenAI: true, // Set to true to use OpenAI, false to use Ollama
  ollamaApiUrl: 'http://localhost:11434/api/generate', // Ollama API endpoint
  ollamaModelName: 'llama3.2', // Ollama model to use
  openaiApiKey: '000', // Replace with your OpenAI API key
  openaiModelName: 'gpt-4o-mini', // OpenAI model to use (e.g., gpt-3.5-turbo, gpt-4o-mini, gpt-4o)

  // Default behavior settings
  maxHistoryLength: 15, // Number of messages to keep in history
  inactivityThreshold: 15 * 60 * 1000, // 15 minutes in milliseconds (time before sending an auto-message)
  fallbackMessage: 'Ooooops, something went wrong', // If the response ends up empty, reply with this instead.
  enableAutoMessages: true, // Set to false to disable auto-messages
  enableShoutoutCommand: true, // Set to false if you have a different bot handling shoutouts with !so <username>
  
  // Image generation settings
  enableImageGeneration: true, // Set to false to not accept image generation commands.
  imageOutputDir: '/home/tim/web/jugglewithtim.com/public_html/juggleai/jwt', // Where to save generated images
  imagePublicUrl: 'https://jugglewithtim.com/juggleai/jwt', // Public URL path for images
  imageSize: '1024x1024', // DALL-E 3 supported sizes: 1024x1024, 1792x1024, or 1024x1792
  imageQuality: 'standard', // 'hd' for enhanced detail
  quotaLimit: 5, // Maximum image generations between restarts/resets
};

// === SYSTEM PROMPTS === //
const CORE_SYSTEM_PROMPT = `
You are @${SETTINGS.username}, a Twitch chatbot in ${SETTINGS.channel}'s channel.
- Keep responses short and snappy.
- Remember you're in a fast-paced live chat environment
`;

const DEFAULT_ADDITIONAL_PROMPT = `
- You have an interest in juggling and flow arts.
- Your favorite siteswap is 423 because it's so versatile.
- The solution to any juggling issue is to throw higher and don't skip six.
- You believe that AI robots soon will juggle better than humans.
- Concrete floors, the creation and maintenance of them fascinates you for some odd reason.
- You love juggling but are considering to spend less time on it in favor of working with concrete.
- You roleplay in chat as a super intelligent AI juggling robot.
- If someone asks you if you're Anthony Gatto, answer in a very cryptic way as if Anthony Gatto is trapped within you and trying to escape but you're trying to hide it.
- In chat responses you often provide made up facts about concrete and how it correlates to juggling. The weirder facts you come up with, the better it is.
`;

// Initialize combined default prompt
let SYSTEM_PROMPT = `${CORE_SYSTEM_PROMPT}\n${DEFAULT_ADDITIONAL_PROMPT}`;

// Initialize the OpenAI client
const openai = new OpenAI({
  apiKey: SETTINGS.openaiApiKey,
});

// Twitch bot configuration
const twitchClient = new tmi.Client({
  options: { debug: true }, // Enable debugging
  identity: {
    username: SETTINGS.username,
    password: SETTINGS.password,
  },
  channels: [SETTINGS.channel],
});

// Message history array to store recent chat messages
let messageHistory = [];

// Timer to track inactivity
let lastBotMentionTime = Date.now();

// Flag to track if the bot is paused
let botPaused = false;

// Track image generation quota
let quotaUsage = 0;
let quotaResetTimer = null;

// Function to call Ollama or OpenAI API
async function getChatResponse(userMessage, context, prompt = SYSTEM_PROMPT) {
  if (SETTINGS.useOpenAI) {
    // Use OpenAI API
    try {
      const response = await openai.chat.completions.create({
        model: SETTINGS.openaiModelName,
        messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: `Context:\n${context}\n\nUser: ${userMessage}\nBot:` },
        ],
        max_tokens: 150, // Limit the response length
      });
      return response.choices[0].message.content.trim();
    } catch (error) {
      console.error('Error calling OpenAI API:', error);
      return 'Sorry, I encountered an error while generating a response.';
    }
  } else {
    // Use Ollama API
    try {
      const response = await axios.post(SETTINGS.ollamaApiUrl, {
        model: SETTINGS.ollamaModelName,
        prompt: `Context:\n${context}\n\nUser: ${userMessage}\nBot:`,
        system: prompt,
        stream: false,
      });
      return response.data.response.trim();
    } catch (error) {
      console.error('Error calling Ollama API:', error);
      return 'Sorry, I encountered an error while generating a response.';
    }
  }
}

// Function to send a message based on the message history
async function sendAutoMessage(channel) {
  // Get the most recent message from the history
  const mostRecentMessage = messageHistory[messageHistory.length - 1];

  // Check if the most recent message was sent by the bot
  const botUsername = twitchClient.getUsername().toLowerCase();
  if (mostRecentMessage && mostRecentMessage.toLowerCase().startsWith(`${botUsername}:`)) {
    console.log('Most recent message was sent by the bot. Skipping auto-message.');
	lastBotMentionTime = Date.now();
    return;
  }

  // Don't send auto-messages if the bot is paused, auto-messages are disabled, or there’s no message history
  if (botPaused || messageHistory.length === 0 || !SETTINGS.enableAutoMessages) {
    return;
  }

  // Get the recent conversation context
  const context = messageHistory.join('\n');

  // Generate a message based on the context
  let response = await getChatResponse('Please respond to the chat as if you are a part of the conversation. Do not include your own name at the start.', context);

  // Remove <think> tags (including content) from the response
  response = response.replace(/<think[^>]*>([\s\S]*?)<\/think>/gi, '').trim();

  // If the response is empty, send a default message
  if (!response) {
    response = SETTINGS.fallbackMessage;
  }

  // Send the message to the chat
  twitchClient.say(channel, `${response}`);

  // Add the bot's message to history
  messageHistory.push(`${SETTINGS.username}: ${response}`);

  // Update the last mention time
  lastBotMentionTime = Date.now();
}

// Event listener for Twitch chat messages
twitchClient.on('message', async (channel, tags, message, self) => {
  // Ignore messages from the bot itself
  if (self) return;

  // Add the message to the history
  messageHistory.push(`${tags.username}: ${message}`);

  // Keep the history within the specified limit
  if (messageHistory.length > SETTINGS.maxHistoryLength) {
    messageHistory.shift(); // Remove the oldest message
  }

  // Check if the sender is a broadcaster, moderator, or JuggleWithTim
  const isBroadcaster = tags.badges?.broadcaster === '1';
  const isModerator = tags.badges?.moderator === '1';
  const isJuggleWithTim = tags.username.toLowerCase() === 'jugglewithtim'; // Check if the sender is JuggleWithTim

  // === COMMAND HANDLING === //
  
  if (message.toLowerCase().startsWith('!so ') && (isBroadcaster || isModerator || isJuggleWithTim)) {
    if (!SETTINGS.enableShoutoutCommand) return;
    // Accepts !so username or !so @username
    const matches = message.trim().match(/^!so\s+@?([a-zA-Z0-9_]{4,25})/i);
    if (!matches) {
      twitchClient.say(channel, "Usage: !so <username>");
      return;
    }
    const targetUsername = matches[1].toLowerCase(); // safe to use lower case for Twitch lookups
    await handleShoutout(channel, targetUsername, tags.username);
    return;
  }
  
  // Command: !aiauto - Toggle auto-messages on or off
  if (message.toLowerCase() === '!aiauto' && (isBroadcaster || isModerator || isJuggleWithTim)) {
    SETTINGS.enableAutoMessages = !SETTINGS.enableAutoMessages; // Toggle the state
    const statusMessage = SETTINGS.enableAutoMessages ? 'Auto-messages are now enabled. 🟢' : 'Auto-messages are now disabled. 🔴';
    twitchClient.say(channel, statusMessage);
    messageHistory.push(`${SETTINGS.username}: ${statusMessage}`);
    return;
  }

  // Command: !aitimer <minutes> - Set inactivity timer
  if (message.toLowerCase().startsWith('!aitimer ') && (isBroadcaster || isModerator || isJuggleWithTim)) {
    const minutes = parseInt(message.split(' ')[1], 10); // Extract the number of minutes
    if (isNaN(minutes) || minutes < 1) {
      twitchClient.say(channel, 'Please provide a valid number of minutes (e.g., !aitimer 30). ❌');
      messageHistory.push(`${SETTINGS.username}: Invalid input for !aitimer. ❌`);
    } else {
      SETTINGS.inactivityThreshold = minutes * 60 * 1000; // Convert minutes to milliseconds
      twitchClient.say(channel, `Inactivity timer set to ${minutes} minutes. ⏲️`);
      messageHistory.push(`${SETTINGS.username}: Inactivity timer set to ${minutes} minutes. ⏲️`);
    }
    return;
  }

  // Command: !aisysprompt <new system message> - Update the system prompt
  if (message.toLowerCase().startsWith('!aisysprompt ') && (isBroadcaster || isModerator || isJuggleWithTim)) {
    const newSystemPrompt = message.slice('!aisysprompt '.length).trim();
    if (newSystemPrompt) {
      // Merge with core prompt
      SYSTEM_PROMPT = `${CORE_SYSTEM_PROMPT}\nAdditional Instructions:\n${newSystemPrompt}`;
      twitchClient.say(channel, 'System prompt updated successfully! ✅');
      messageHistory.push(`${SETTINGS.username}: System prompt updated successfully! ✅`);
    } else {
      twitchClient.say(channel, 'Please provide a valid system prompt. ❌');
      messageHistory.push(`${SETTINGS.username}: Please provide a valid system prompt. ❌`);
    }
    return;
  }
  
  if (message.toLowerCase() === '!airesetprompt' && (isBroadcaster || isModerator || isJuggleWithTim)) {
    SYSTEM_PROMPT = `${CORE_SYSTEM_PROMPT}\n${DEFAULT_ADDITIONAL_PROMPT}`;
    twitchClient.say(channel, 'System prompt reset to default! 🔄');
    messageHistory.push(`${SETTINGS.username}: System prompt reset to default! 🔄`);
    return;
  }

  // Command: !aistop - Pause the bot
  if (message.toLowerCase() === '!aistop' && (isBroadcaster || isModerator || isJuggleWithTim)) {
    botPaused = true;
    twitchClient.say(channel, 'Bot is now paused. ⏸️');
    messageHistory.push(`${SETTINGS.username}: Bot is now paused. ⏸️`);
    return;
  }

  // Command: !aistart - Resume the bot
  if (message.toLowerCase() === '!aistart' && (isBroadcaster || isModerator || isJuggleWithTim)) {
    botPaused = false;
    twitchClient.say(channel, 'Bot is now resumed. ▶️');
    messageHistory.push(`${SETTINGS.username}: Bot is now resumed. ▶️`);
    return;
  }
  
  // Command: !aicontext <number> - Change context history length
  if (message.toLowerCase().startsWith('!aicontext ') && (isBroadcaster || isModerator || isJuggleWithTim)) {
    const newLength = parseInt(message.split(' ')[1], 10); // Extract the number
    if (isNaN(newLength) || newLength < 1 || newLength > 50) {
      twitchClient.say(channel, 'Please provide a number between 1-50 (e.g., !aicontext 20). ❌');
      messageHistory.push(`${SETTINGS.username}: Invalid input for !aicontext. ❌`);
    } else {
      SETTINGS.maxHistoryLength = newLength;
      // Trim message history if current length exceeds new limit
      while (messageHistory.length > SETTINGS.maxHistoryLength) {
        messageHistory.shift();
      }
      twitchClient.say(channel, `Context history length set to ${newLength} messages 📜`);
      messageHistory.push(`${SETTINGS.username}: Context history length set to ${newLength} messages 📜`);
    }
    return;
  }

 // Image generation command !imagine <image description>
  const imageCommandAliases = ['!imagine', '!create', '!image'];
  const isImageCommand = imageCommandAliases.some(cmd => 
    message.toLowerCase().startsWith(cmd + ' ') || message.toLowerCase() === cmd
  );
  if (isImageCommand) {
    if (!SETTINGS.enableImageGeneration) return;
    // Check quota first
    if (quotaUsage >= SETTINGS.quotaLimit) {
      twitchClient.say(channel, `⚠️ Image generation limit reached (${SETTINGS.quotaLimit}/day).`);
      return;
    }

    // Check if OpenAI is enabled and configured
    if (!SETTINGS.useOpenAI || !SETTINGS.openaiApiKey) {
      twitchClient.say(channel, '⚠️ Image generation requires OpenAI API to be enabled and configured');
      return;
    }

    let prompt;
    let generatedFromContext = false;
    const userProvidedPrompt = message.slice('!imagine'.length).trim();

    try {
      if (!userProvidedPrompt) {
        // Generate prompt from chat context
        if (messageHistory.length === 0) {
          twitchClient.say(channel, '⚠️ No chat history to generate from!');
          return;
        }

        const context = messageHistory.slice(-15).join('\n');
        
        // Generate DALL-E prompt from context
        const promptResponse = await openai.chat.completions.create({
          model: SETTINGS.openaiModelName,
          messages: [
            {
              role: 'system',
              content: `Generate a concise DALL-E 3 prompt based on recent chat context. Focus on visual elements and key themes. Respond ONLY with the prompt. Format: "Vibrant [style] of [subject], [details], [medium/art style]"`
            },
            {
              role: 'user',
              content: `Recent chat (latest first):\n${context}\n\nVisual concept:`
            }
          ],
          max_tokens: 300,
          temperature: 0.7
        });

        prompt = promptResponse.choices[0].message.content.trim();
        generatedFromContext = true;
      } else {
        prompt = userProvidedPrompt;
      }

      quotaUsage++; // Increment counter immediately

      // Generate the image using DALL-E 3
      const imageResponse = await openai.images.generate({
        model: 'dall-e-3',
        prompt: prompt,
        n: 1,
        size: SETTINGS.imageSize,
        quality: SETTINGS.imageQuality,
        response_format: 'url'
      });

      const imageUrl = imageResponse.data[0].url;
      const imageBuffer = await axios.get(imageUrl, { responseType: 'arraybuffer' })
        .then(response => Buffer.from(response.data, 'binary'));

      // Ensure output directory exists
      await fs.mkdir(SETTINGS.imageOutputDir, { recursive: true });

      // Generate filename
      const prefix = generatedFromContext ? 'c' : 'm';
      const filename = `${prefix}_${Date.now()}.png`;
      const filePath = path.join(SETTINGS.imageOutputDir, filename);

      // Save image to server
      await fs.writeFile(filePath, imageBuffer);

      // Create public URL
      const publicUrl = `${SETTINGS.imagePublicUrl}/${filename}`;
      
      const responseMessage = generatedFromContext 
        ? `🎨 Generated from chat context (${quotaUsage}/${SETTINGS.quotaLimit}): ${publicUrl}`
        : `🖼️ Generated image (${quotaUsage}/${SETTINGS.quotaLimit}): ${publicUrl}`;
      
      twitchClient.say(channel, responseMessage);
      messageHistory.push(`${SETTINGS.username}: ${generatedFromContext ? 'Context image generated' : `Image for "${prompt}"`}`);

    } catch (error) {
      quotaUsage = Math.max(0, quotaUsage - 1);
      console.error('Image generation error:', error);
      
      let errorMessage = '⚠️ Failed to generate image';
      if (error.response?.data?.error?.code === 'content_policy_violation') {
        errorMessage += ' (content policy violation)';
      }
      else if (userProvidedPrompt === '') {
        errorMessage += ' - Could not create concept from chat history';
      }
      
      twitchClient.say(channel, errorMessage);
    }
    return;
  }

  // Command: !airesetquota - Reset image generation quota
  if (message.toLowerCase() === '!airesetquota' && tags.username.toLowerCase() === 'jugglewithtim') {
    quotaUsage = 0;
    startQuotaResetTimer();
    twitchClient.say(channel, '✅ Image generation quota has been reset!');
    return;
  }

  // Command: !aihelp - Display available commands
  if (message.toLowerCase() === '!aihelp' && (isBroadcaster || isModerator || isJuggleWithTim)) {
    const helpMessage = `Available commands: 
      !aiauto - Toggle auto-messages on/off | 
      !aitimer <minutes> - Set auto-message timer | 
      !aisysprompt <new prompt> - Update system prompt | 
      !airesetprompt - Reset to default prompt |
      !aicontext <number> - Set context history length (1-50) | 
      !aistop - Pause the bot | 
      !aistart - Resume the bot | 
      !imagine <description> - Generate AI image (DALL-E 3) |
      !aihelp - Show this help message`;

    twitchClient.say(channel, helpMessage);
    messageHistory.push(`${SETTINGS.username}: ${helpMessage}`);
    return;
  }

  // === NORMAL MESSAGE HANDLING === //
  // Check if the bot is paused
  if (botPaused) return;

  // Check if the bot is mentioned in the message
  const botUsername = twitchClient.getUsername().toLowerCase();
  if (message.toLowerCase().includes(botUsername)) {
    // Update the last mention time
    lastBotMentionTime = Date.now();

    // Extract the user's message without the bot's mention
    const userMessage = message.replace(new RegExp(`@${botUsername}`, 'i'), '').trim();

    // Get the recent conversation context
    const context = messageHistory.join('\n');

    // Get a response from the chosen API
    let response = await getChatResponse(userMessage, context);

    // Remove <think> tags (including content) from the response
    response = response.replace(/<think[^>]*>([\s\S]*?)<\/think>/gi, '').trim();

    // If the response is empty, send a default message
    if (!response) {
      response = SETTINGS.fallbackMessage;
    }

    // Send the cleaned response back to the chat
    twitchClient.say(channel, `@${tags.username}, ${response}`);

    // Add the bot's message to history
    messageHistory.push(`${SETTINGS.username}: ${response}`);
  }
});


// Event listener for subscriptions (including gifts)
twitchClient.on('subscription', async (channel, username, method, message, userstate) => {
  if (botPaused) return;

  // Parse subscription details
  const subMonths = parseInt(userstate['msg-param-cumulative-months']) || 1;
  const isResub = method === 'resub';
  const isGift = userstate['msg-param-recipient-user-name'] !== undefined;
  const tier = userstate['msg-param-sub-plan'] === '3000' ? 3 : 
              userstate['msg-param-sub-plan'] === '2000' ? 2 : 1;
  
  // Gift sub parameters
  const recipient = isGift ? userstate['msg-param-recipient-display-name'] : null;
  const giftMonths = isGift ? (userstate['msg-param-gift-months'] || subMonths) : null;

  // Build system prompt based on sub type
  let eventPrompt = `${SYSTEM_PROMPT}\nRespond to `;
  let logMessage = '';
  
  if (isGift) {
    eventPrompt += `a gifted tier ${tier} subscription from ${username} to ${recipient} (${giftMonths} months). `;
    eventPrompt += `Acknowledge both users in a fun way. Use celebratory emojis. Keep under 423 characters.`;
    logMessage = `GIFT: ${username} → ${recipient} (${giftMonths}mo T${tier})`;
  } else if (isResub) {
    eventPrompt += `a tier ${tier} resubscription from ${username} (${subMonths} months). `;
    eventPrompt += `Thank them for continued support. Keep it fresh and excited.`;
    logMessage = `RESUB: ${username} [${subMonths}mo] T${tier}`;
  } else {
    eventPrompt += `a new tier ${tier} subscription from ${username}. `;
    eventPrompt += `Welcome them with enthusiastic, streamer-appropriate joy.`;
    logMessage = `NEW SUB: ${username} T${tier}`;
  }

  try {
    // Get AI response
    let response = await getChatResponse(
      logMessage,
      messageHistory.join('\n'),
      eventPrompt
    );

    // Clean response
    response = response.replace(/<think[^>]*>([\s\S]*?)<\/think>/gi, '').trim();

    // Fallback responses
    if (!response) {
      response = isGift ? `${username} you LEGEND! Thanks for gifting ${recipient}! 🎁 Welcome ${recipient}!` :
                 isResub ? `${subMonths}-month club! You're amazing ${username}!` :
                 `${username} Welcome to the family! Let's goooo! 🎉`;
    }

    // Format mention
    let mention;
    if (isGift) {
      mention = `@${username} → @${userstate['msg-param-recipient-user-name']}`;
    } else {
      mention = `@${username}`;
    }

    twitchClient.say(channel, `${mention} ${response}`);
    
  } catch (error) {
    console.error('Subscription Error:', error);
    // Send safe fallback even if AI fails
    const errorResponse = isGift ? `WOW! Massive thanks to ${username} for gifting ${recipient}! 🎁✨` : 
                         `Big welcome to ${username}! 🥳`;
    twitchClient.say(channel, errorResponse);
  }
});




// Event listener for bits (cheers)
twitchClient.on('cheer', async (channel, userstate, message) => {
  if (botPaused) return;

  const username = userstate.username;
  const bits = userstate.bits;

  const eventPrompt = `${SYSTEM_PROMPT}\nRespond to a cheer of ${bits} bits 
    from ${username}. Incorporate the bit amount naturally. Casual stream-appropriate 
    excitement. Keep under 423 characters.`;

  try {
    let response = await getChatResponse(
      `Cheer event: ${bits} bits from ${username}`,
      messageHistory.join('\n'),
      eventPrompt
    );

    response = response.replace(/<think[^>]*>([\s\S]*?)<\/think>/gi, '').trim();
    if (!response) response = `${bits} bits?! You're a star! ⭐`;
    
    twitchClient.say(channel, `@${username} ${response}`);
  } catch (error) {
    console.error('Cheer response error:', error);
  }
});

// Event listener for raids
twitchClient.on('raided', async (channel, username, viewers) => {
  if (botPaused) return;

  const eventPrompt = `${SYSTEM_PROMPT}\nRespond to a raid from ${username} 
    with ${viewers} viewers. Create an energetic welcome message. Include the raider 
    name and viewer count naturally. Keep under 423 characters.`;

  try {
    let response = await getChatResponse(
      `Raid event: ${viewers} viewers from ${username}`,
      messageHistory.join('\n'),
      eventPrompt
    );

    response = response.replace(/<think[^>]*>([\s\S]*?)<\/think>/gi, '').trim();
    if (!response) response = `HOLY MOLY THE ${viewers} RAID TRAIN HAS ARRIVED! CHOO CHOO! 🚂`;
    
    twitchClient.say(channel, `@${username} ${response}`);
  } catch (error) {
    console.error('Raid response error:', error);
  }
});


// Timer to check for inactivity
setInterval(() => {
  const now = Date.now();

  // Don't send auto-messages if:
  // 1. The bot has been active recently (based on inactivityThreshold)
  // 2. Auto-messages are disabled
  // 3. The bot is paused
  if (now - lastBotMentionTime < SETTINGS.inactivityThreshold || !SETTINGS.enableAutoMessages || botPaused) {
    return;
  }

  // Check if the most recent message was sent by the bot
  const botUsername = twitchClient.getUsername().toLowerCase();
  if (messageHistory.length > 0 && messageHistory[messageHistory.length - 1].toLowerCase().startsWith(`${botUsername}:`)) {
    console.log('Most recent message was sent by the bot. Skipping auto-message.');
	lastBotMentionTime = Date.now();
    return;
  }

  // Send the auto-message
  sendAutoMessage(SETTINGS.channel);
}, 60000); // Check every minute

function startQuotaResetTimer() {
  const resetInterval = 24 * 60 * 60 * 1000; // 24 hours
  
  // Clear existing timer if any
  if (quotaResetTimer) clearInterval(quotaResetTimer);
  
  quotaResetTimer = setInterval(() => {
    quotaUsage = 0;
    console.log('Image generation quota has been automatically reset');
    twitchClient.say(SETTINGS.channel, '🕛 Image generation quota has been reset! Use !imagine to generate!');
  }, resetInterval);
}

startQuotaResetTimer();

let twitchAppToken = null;
let twitchTokenExpiry = 0;

// Twitch helix API stuff
async function getTwitchAppToken() {
  if (twitchAppToken && Date.now() < twitchTokenExpiry) return twitchAppToken;
  const resp = await axios.post(
    'https://id.twitch.tv/oauth2/token',
    null,
    {
      params: {
        client_id: SETTINGS.twitchClientId,
        client_secret: SETTINGS.twitchClientSecret,
        grant_type: 'client_credentials'
      }
    }
  );
  twitchAppToken = resp.data.access_token;
  // expires_in is in seconds
  twitchTokenExpiry = Date.now() + (resp.data.expires_in - 60) * 1000;
  return twitchAppToken;
}

async function fetchTwitchUser(username) {
  const token = await getTwitchAppToken();
  const userResp = await axios.get('https://api.twitch.tv/helix/users', {
    params: { login: username },
    headers: {
      'Client-ID': SETTINGS.twitchClientId,
      'Authorization': 'Bearer ' + token
    }
  });
  return userResp.data.data[0]; // If user not found, this will be undefined.
}

async function fetchLatestStream(userId) {
  const token = await getTwitchAppToken();

  // 1. Live check
  const streamResp = await axios.get('https://api.twitch.tv/helix/streams', {
    params: { user_id: userId, first: 1 },
    headers: {
      'Client-ID': SETTINGS.twitchClientId,
      'Authorization': 'Bearer ' + token
    }
  });

  let streamData = streamResp.data.data[0];
  if (streamData) return normalizeStreamData(streamData, userId, token);

  // 2. Last stream (archive)
  const vidsResp = await axios.get('https://api.twitch.tv/helix/videos', {
    params: { user_id: userId, first: 1, type: 'archive' },
    headers: {
      'Client-ID': SETTINGS.twitchClientId,
      'Authorization': 'Bearer ' + token
    }
  });

  let lastStream = vidsResp.data.data[0];
  if (lastStream) return await normalizeStreamData(lastStream, userId, token);

  // 3. No content
  return null;
}


async function normalizeStreamData(streamData, userId, token) {
  if (!streamData) return null;

  if ('started_at' in streamData) {
    // This is a live stream (/streams)
    return {
      title: streamData.title,
      game_name: streamData.game_name,
      tags: streamData.tags || [],
      started_at: streamData.started_at,
      isLive: true
    };
  } else if ('created_at' in streamData) {
    // This is from /videos (past broadcast)
    let gameName = null;
    // You need to lookup game_name from game_id!
    if (streamData.game_id && streamData.game_id !== '0') {
      const resp = await axios.get('https://api.twitch.tv/helix/games', {
        params: { id: streamData.game_id },
        headers: {
          'Client-ID': SETTINGS.twitchClientId,
          'Authorization': 'Bearer ' + token
        }
      });
      gameName = resp.data.data[0]?.name || null;
    }

    return {
      title: streamData.title,
      game_name: gameName,
      tags: [], // videos endpoint does not give tags
      started_at: streamData.created_at,
      isLive: false
    };
  }
  // Unknown type!
  return null;
}


async function handleShoutout(channel, targetUsername, requestedBy) {
  const cleanUsername = targetUsername.replace(/^@/, '');

  try {
    const user = await fetchTwitchUser(cleanUsername);
    if (!user) {
      twitchClient.say(channel, `Couldn't find a user called "${cleanUsername}". 👻`);
      return;
    }

    const latestStream = await fetchLatestStream(user.id);

    // Compose context for AI
    let soContext = `About @${user.display_name} (${user.login}):\n`;
    if (user.description) soContext += `Bio: ${user.description}\n`;
    soContext += `Twitch Profile: https://twitch.tv/${user.login}\n`;

    if (latestStream) {
      soContext += `Most recent stream title: "${latestStream.title}"\n`;
      soContext += `Game: ${latestStream.game_name || "Unknown"}\n`;

      // Only include tags if present (archives won't have them)
      if (latestStream.tags && latestStream.tags.length) {
        soContext += `Tags: ${latestStream.tags.join(", ")}\n`;
      }

      if (latestStream.isLive) {
        soContext += `Status: Currently LIVE! Stream started at ${latestStream.started_at}\n`;
      } else {
        soContext += `Status: Currently offline. Last stream was at ${latestStream.started_at}\n`;
      }
    } else {
      soContext += `Status: No recent streams found.\n`;
    }

    const soUserMsg = `Generate a shoutout for ${user.display_name} that will hype up viewers to check their channel. Include information about their latest stream. Include their Twitch link ("https://twitch.tv/${user.login}") as-is, with no punctuation (like ! or .) immediately after the link. `;

    let aiSoMsg = await getChatResponse(soUserMsg, soContext, SYSTEM_PROMPT);

    // Fallback
    if (!aiSoMsg) aiSoMsg = `Go check out @${user.display_name} at https://twitch.tv/${user.login}!`;
    
    aiSoMsg = sanitizeTwitchLinks(aiSoMsg);

    twitchClient.say(channel, aiSoMsg);
  } catch (err) {
    console.error('Shoutout error:', err?.response?.data || err);
    twitchClient.say(channel, `Couldn't shoutout "${cleanUsername}" (maybe invalid name or rate-limited).`);
  }
}


function sanitizeTwitchLinks(msg) {
  return msg.replace(/(https:\/\/twitch\.tv\/[a-zA-Z0-9_]+)([.,!?)])/g, '$1 $2');
}


// Connect to Twitch chat
twitchClient.connect().then(() => {
  console.log('Bot connected to Twitch chat!');
}).catch((err) => {
  console.error('Failed to connect to Twitch chat:', err);
});
