const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

// Get bot token from environment variable
const BOT_TOKEN = process.env.BOT_TOKEN || '8338081238:AAHeUKy9XL7kgeUUvXdQExCMp9nQtqUhrFQ';
const API_BASE_URL = 'https://menuqrcode.onrender.com/api';

// Initialize bot with better configuration
const bot = new TelegramBot(BOT_TOKEN, { 
  polling: {
    interval: 3000,
    timeout: 10,
    retryTimeout: 10000
  },
  request: {
    timeout: 15000,
    proxy: false
  }
});

app.use(express.json());

// Health check endpoint
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>YSG Telegram Bot</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 40px; text-align: center; }
        .status { color: #22c55e; font-size: 24px; margin: 20px 0; }
      </style>
    </head>
    <body>
      <h1>🍽️ YSG Store Telegram Bot</h1>
      <div class="status">✅ Bot is running on Render with Node.js!</div>
      <p>Go to Telegram and send <code>/start</code> to test the bot.</p>
    </body>
    </html>
  `);
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    platform: 'nodejs',
    timestamp: new Date().toISOString()
  });
});

// API helper function with retry logic
async function apiRequest(endpoint, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`🔄 Fetching (attempt ${attempt}/${retries}): ${endpoint}`);
      
      const response = await axios.get(`${API_BASE_URL}${endpoint}`, { 
        timeout: 10000,
        headers: {
          'User-Agent': 'YSGTelegramBot/1.0'
        }
      });
      
      console.log(`✅ Success: ${endpoint}`);
      return response.data;
      
    } catch (error) {
      console.error(`❌ API Error (${endpoint}, attempt ${attempt}):`, error.message);
      
      if (error.response?.status === 429) {
        // Rate limited - wait and retry
        const waitTime = Math.min(1000 * Math.pow(2, attempt), 10000); // Exponential backoff
        console.log(`⏳ Rate limited, waiting ${waitTime}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }
      
      if (attempt === retries) {
        return null;
      }
      
      // Wait before retry for other errors
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  return null;
}

// Cache to avoid frequent API calls
const cache = {
  store: null,
  categories: null,
  products: null,
  lastFetch: 0
};

const CACHE_DURATION = 60000; // 1 minute cache

async function getCachedData() {
  const now = Date.now();
  
  // Return cached data if it's fresh
  if (cache.store && cache.categories && cache.products && 
      (now - cache.lastFetch) < CACHE_DURATION) {
    console.log('📦 Using cached data');
    return {
      store: cache.store,
      categories: cache.categories,
      products: cache.products
    };
  }
  
  // Fetch fresh data
  console.log('🔄 Fetching fresh data from API');
  const [store, categories, products] = await Promise.all([
    apiRequest('/stores/public/slug/ysg'),
    apiRequest('/categories/store/slug/ysg').catch(() => null),
    apiRequest('/products/public-store/slug/ysg')
  ]);
  
  if (store && products) {
    cache.store = store;
    cache.categories = categories;
    cache.products = products;
    cache.lastFetch = now;
  }
  
  return { store, categories, products };
}

// Start command
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  console.log(`🚀 /start command from chat ${chatId}`);
  
  try {
    await bot.sendMessage(chatId, '🔄 Loading YSG Store menu...');
    
    const { store, categories, products } = await getCachedData();
    
    if (!store) {
      await bot.sendMessage(chatId, 
        '❌ Store is temporarily unavailable.\n\n' +
        'This might be due to high traffic. Please try again in a few moments.'
      );
      return;
    }

    // Create store info message
    let storeInfo = `🏪 *${store.name}*\n\n`;
    if (store.description) storeInfo += `📝 ${store.description}\n`;
    if (store.address) storeInfo += `📍 ${store.address}\n`;
    if (store.phone) storeInfo += `📞 ${store.phone}\n`;

    // Send store info
    await bot.sendMessage(chatId, storeInfo, { parse_mode: 'Markdown' });

    // Create category buttons
    if (categories && categories.length > 0) {
      const keyboard = categories.map(category => [
        { text: `📂 ${category.name}` }
      ]);
      
      keyboard.push([{ text: '🍽️ All Items' }]);
      keyboard.push([{ text: '🔄 Refresh' }]);
      
      const replyMarkup = {
        keyboard: keyboard,
        resize_keyboard: true
      };
      
      await bot.sendMessage(chatId, '📋 *Select a category:*', {
        parse_mode: 'Markdown',
        reply_markup: replyMarkup
      });
    } else {
      // Fallback: show all items if no categories
      await bot.sendMessage(chatId, 
        '📋 *Menu Categories*\n\n' +
        '📂 All Items\n\n' +
        'Select "All Items" to browse the menu.',
        { parse_mode: 'Markdown' }
      );
    }
    
  } catch (error) {
    console.error('Start command error:', error);
    await bot.sendMessage(chatId, 
      '❌ Unable to load menu at the moment.\n\n' +
      'Please try again in a few minutes.'
    );
  }
});

// Handle category selection
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (text && text.startsWith('📂 ')) {
    const categoryName = text.slice(2);
    console.log(`📂 Category selected: ${categoryName}`);
    
    try {
      await bot.sendMessage(chatId, `🔄 Loading ${categoryName}...`);
      
      const { store, categories, products } = await getCachedData();
      
      if (!store || !products) {
        await bot.sendMessage(chatId, '❌ Menu temporarily unavailable');
        return;
      }

      let categoryProducts = [];
      
      if (categories && categories.length > 0) {
        const category = categories.find(cat => cat.name === categoryName);
        if (category) {
          categoryProducts = products.filter(product => 
            product.category && product.category._id === category._id
          );
        }
      }
      
      // If no specific category found or no categories, show all products
      if (categoryProducts.length === 0) {
        categoryProducts = products;
      }

      if (categoryProducts.length > 0) {
        await bot.sendMessage(chatId, 
          `📂 *${categoryName}*\n_${categoryProducts.length} items_`,
          { parse_mode: 'Markdown' }
        );

        // Send products in batches to avoid rate limits
        for (let i = 0; i < categoryProducts.length; i++) {
          const product = categoryProducts[i];
          const price = product.price ? ` - ${product.price}` : '';
          const caption = `✅ *${product.title}*${price}\n${product.description || ''}`;
          
          const imageUrl = product.image || product.imageUrl;
          
          if (imageUrl) {
            try {
              await bot.sendPhoto(chatId, imageUrl, {
                caption: caption,
                parse_mode: 'Markdown'
              });
            } catch (photoError) {
              await bot.sendMessage(chatId, caption, { parse_mode: 'Markdown' });
            }
          } else {
            await bot.sendMessage(chatId, caption, { parse_mode: 'Markdown' });
          }
          
          // Add delay between messages to avoid rate limits
          if (i < categoryProducts.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
      } else {
        await bot.sendMessage(chatId, `📭 No items found in ${categoryName}`);
      }
      
    } catch (error) {
      console.error('Category error:', error);
      await bot.sendMessage(chatId, '❌ Error loading category');
    }
  }
});

// Handle "All Items"
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (text === '🍽️ All Items') {
    console.log(`🍽️ All Items selected`);
    
    try {
      await bot.sendMessage(chatId, '🔄 Loading all menu items...');
      
      const { products } = await getCachedData();
      
      if (products && products.length > 0) {
        await bot.sendMessage(chatId, 
          `🍽️ *All Menu Items*\n_${products.length} items total_`,
          { parse_mode: 'Markdown' }
        );

        for (let i = 0; i < products.length; i++) {
          const product = products[i];
          const price = product.price ? ` - ${product.price}` : '';
          const caption = `✅ *${product.title}*${price}\n${product.description || ''}`;
          
          const imageUrl = product.image || product.imageUrl;
          
          if (imageUrl) {
            try {
              await bot.sendPhoto(chatId, imageUrl, {
                caption: caption,
                parse_mode: 'Markdown'
              });
            } catch (photoError) {
              await bot.sendMessage(chatId, caption, { parse_mode: 'Markdown' });
            }
          } else {
            await bot.sendMessage(chatId, caption, { parse_mode: 'Markdown' });
          }
          
          // Add delay between messages
          if (i < products.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
      } else {
        await bot.sendMessage(chatId, '📭 No items found');
      }
      
    } catch (error) {
      console.error('All items error:', error);
      await bot.sendMessage(chatId, '❌ Error loading menu');
    }
  }
});

// Handle refresh
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (text === '🔄 Refresh') {
    console.log(`🔄 Refresh requested`);
    // Clear cache and restart
    cache.store = null;
    cache.categories = null;
    cache.products = null;
    
    const fakeMsg = { ...msg, text: '/start' };
    bot.emit('message', fakeMsg);
  }
});

// Help command
bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  const helpText = `🤖 *YSG Menu Bot Help*

*Commands:*
/start - Show store menu
/help - Show this help

*Tips:*
• Use buttons to navigate
• Images load automatically
• Refresh if menu seems old

The bot caches data for 1 minute to avoid API limits.`;

  bot.sendMessage(chatId, helpText, { parse_mode: 'Markdown' });
});

// Error handling
bot.on('polling_error', (error) => {
  console.error('📡 Polling error (non-fatal):', error.message);
});

bot.on('error', (error) => {
  console.error('🤖 Bot error:', error);
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 YSG Bot running on port ${PORT}`);
  console.log(`✅ Bot is ready!`);
});

// Keep the process alive
setInterval(() => {
  // Keep-alive
}, 60000);