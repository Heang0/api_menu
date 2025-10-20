const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

// Get bot token from environment variable
const BOT_TOKEN = process.env.BOT_TOKEN || '8338081238:AAHeUKy9XL7kgeUUvXdQExCMp9nQtqUhrFQ';
const API_BASE_URL = 'https://menuqrcode.onrender.com/api';

// Use webhook instead of polling to avoid conflicts
const bot = new TelegramBot(BOT_TOKEN);

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
      <div class="status">✅ Bot is running on Render with Webhook!</div>
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

// Webhook endpoint - Telegram will send messages here
app.post('/webhook', async (req, res) => {
  try {
    const update = req.body;
    
    if (update.message) {
      await handleMessage(update.message);
    } else if (update.callback_query) {
      await handleCallbackQuery(update.callback_query);
    }
    
    res.send('OK');
  } catch (error) {
    console.error('Webhook error:', error);
    res.send('OK');
  }
});

// API helper function with retry logic
async function apiRequest(endpoint, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`🔄 Fetching (attempt ${attempt}/${retries}): ${endpoint}`);
      
      const response = await axios.get(`${API_BASE_URL}${endpoint}`, { 
        timeout: 10000
      });
      
      console.log(`✅ Success: ${endpoint}`);
      return response.data;
      
    } catch (error) {
      console.error(`❌ API Error (${endpoint}, attempt ${attempt}):`, error.message);
      
      if (error.response?.status === 429) {
        const waitTime = Math.min(1000 * Math.pow(2, attempt), 10000);
        console.log(`⏳ Rate limited, waiting ${waitTime}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }
      
      if (attempt === retries) {
        return null;
      }
      
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
  
  if (cache.store && cache.categories && cache.products && 
      (now - cache.lastFetch) < CACHE_DURATION) {
    console.log('📦 Using cached data');
    return {
      store: cache.store,
      categories: cache.categories,
      products: cache.products
    };
  }
  
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

// Set up bot commands menu (appears in Telegram UI)
async function setupBotCommands() {
  try {
    await bot.setMyCommands([
      { command: 'start', description: 'Start the bot and show menu' },
      { command: 'menu', description: 'Show the main menu' },
      { command: 'help', description: 'Show help information' }
    ]);
    console.log('✅ Bot commands menu set up');
  } catch (error) {
    console.error('❌ Failed to set up bot commands:', error);
  }
}

// Handle incoming messages
async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const text = msg.text;

  console.log(`📨 Message from ${chatId}: ${text}`);

  if (text === '/start' || text === '/menu') {
    await handleStart(chatId);
  } else if (text.startsWith('📂 ')) {
    await handleCategory(chatId, text.slice(2));
  } else if (text === '🍽️ All Items') {
    await handleAllItems(chatId);
  } else if (text === '🔄 Refresh') {
    await handleRefresh(chatId);
  } else if (text === '/help') {
    await handleHelp(chatId);
  } else if (text && !text.startsWith('/')) {
    // Unknown text message
    await bot.sendMessage(chatId, 
      '🤔 I didn\'t understand that. Use the menu buttons or send /start to begin.'
    );
  }
}

// Handle callback queries (for inline buttons)
async function handleCallbackQuery(callbackQuery) {
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data;

  try {
    if (data === 'show_categories') {
      await showCategories(chatId);
    } else if (data.startsWith('category_')) {
      const categoryName = data.replace('category_', '');
      await handleCategory(chatId, categoryName);
    } else if (data === 'all_items') {
      await handleAllItems(chatId);
    }
    
    // Answer the callback query
    await bot.answerCallbackQuery(callbackQuery.id);
  } catch (error) {
    console.error('Callback query error:', error);
  }
}

// Start command
async function handleStart(chatId) {
  try {
    await bot.sendMessage(chatId, '🔄 Loading YSG Store menu...');
    
    const { store, categories, products } = await getCachedData();
    
    if (!store) {
      await bot.sendMessage(chatId, 
        '❌ Store is temporarily unavailable.\nPlease try again in a few moments.'
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

    // Create main menu with inline buttons
    const menuButtons = {
      reply_markup: {
        inline_keyboard: [
          [{ text: '📋 View Categories', callback_data: 'show_categories' }],
          [{ text: '🍽️ All Items', callback_data: 'all_items' }],
          [{ text: '🔄 Refresh', callback_data: 'refresh' }]
        ]
      }
    };

    await bot.sendMessage(chatId, 
      '🎛️ *Main Menu*\n\nChoose an option below:',
      { 
        parse_mode: 'Markdown',
        reply_markup: menuButtons.reply_markup
      }
    );

    // Also set up persistent keyboard
    const keyboard = {
      keyboard: [
        ['📋 Menu', '🍽️ All Items'],
        ['🔄 Refresh', '❓ Help']
      ],
      resize_keyboard: true,
      persistent: true
    };

    await bot.sendMessage(chatId, 
      '💡 You can also use the keyboard below:',
      { reply_markup: keyboard }
    );
    
  } catch (error) {
    console.error('Start command error:', error);
    await bot.sendMessage(chatId, '❌ Error loading menu. Please try again.');
  }
}

// Show categories
async function showCategories(chatId) {
  try {
    const { categories } = await getCachedData();
    
    if (categories && categories.length > 0) {
      const categoryButtons = categories.map(category => [
        { 
          text: `📂 ${category.name}`, 
          callback_data: `category_${category.name}` 
        }
      ]);

      const replyMarkup = {
        inline_keyboard: categoryButtons
      };

      await bot.sendMessage(chatId, 
        '📋 *Categories*\n\nSelect a category:',
        { 
          parse_mode: 'Markdown',
          reply_markup: replyMarkup 
        }
      );
    } else {
      await bot.sendMessage(chatId, '📭 No categories available');
    }
  } catch (error) {
    console.error('Show categories error:', error);
    await bot.sendMessage(chatId, '❌ Error loading categories');
  }
}

// Handle category selection
async function handleCategory(chatId, categoryName) {
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
    
    if (categoryProducts.length === 0) {
      categoryProducts = products;
    }

    if (categoryProducts.length > 0) {
      await bot.sendMessage(chatId, 
        `📂 *${categoryName}*\n_${categoryProducts.length} items_`,
        { parse_mode: 'Markdown' }
      );

      // Send products
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
        
        if (i < categoryProducts.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
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

// Handle "All Items"
async function handleAllItems(chatId) {
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
        
        if (i < products.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
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

// Handle refresh
async function handleRefresh(chatId) {
  cache.store = null;
  cache.categories = null;
  cache.products = null;
  await handleStart(chatId);
}

// Help command
async function handleHelp(chatId) {
  const helpText = `🤖 *YSG Menu Bot Help*

*Commands:*
/start - Start the bot
/menu - Show main menu  
/help - Show this help

*Features:*
• 🏪 Store information
• 📂 Browse by categories
• 🍽️ View all items
• 🖼️ Product images
• 🔄 Refresh menu

*Tips:*
• Use the menu buttons
• Tap categories to browse
• Refresh for latest menu`;

  await bot.sendMessage(chatId, helpText, { parse_mode: 'Markdown' });
}

// Set webhook on startup
async function setWebhook() {
  try {
    const webhookUrl = `https://api-menu-rm9e.onrender.com/webhook`;
    await bot.setWebHook(webhookUrl);
    console.log(`✅ Webhook set to: ${webhookUrl}`);
    
    // Set up bot commands menu
    await setupBotCommands();
  } catch (error) {
    console.error('❌ Webhook setup failed:', error);
  }
}

// Start server
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`🚀 YSG Bot running on port ${PORT}`);
  
  // Set webhook after server starts
  setTimeout(() => {
    setWebhook();
  }, 2000);
});

console.log('✅ Bot server starting...');