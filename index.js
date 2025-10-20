const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

// Get bot token from environment variable (set this in Render)
const BOT_TOKEN = process.env.BOT_TOKEN || '8338081238:AAHeUKy9XL7kgeUUvXdQExCMp9nQtqUhrFQ';
const API_BASE_URL = 'https://menuqrcode.onrender.com/api';

// Initialize bot with polling
const bot = new TelegramBot(BOT_TOKEN, { 
  polling: true,
  request: {
    timeout: 10000
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
    timestamp: new Date().toISOString(),
    service: 'YSG Telegram Bot'
  });
});

// API helper function
async function apiRequest(endpoint) {
  try {
    console.log(`🔄 Fetching: ${API_BASE_URL}${endpoint}`);
    const response = await axios.get(`${API_BASE_URL}${endpoint}`, { timeout: 10000 });
    console.log(`✅ Success: ${endpoint}`);
    return response.data;
  } catch (error) {
    console.error(`❌ API Error (${endpoint}):`, error.message);
    return null;
  }
}

// Start command - shows store info and categories
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  console.log(`🚀 /start command from chat ${chatId}`);
  
  try {
    // Show loading message
    await bot.sendMessage(chatId, '🔄 Loading YSG Store menu...');
    
    const store = await apiRequest('/stores/public/slug/ysg');
    if (!store) {
      await bot.sendMessage(chatId, '❌ Store not available at the moment. Please try again later.');
      return;
    }

    // Get categories
    const categories = await apiRequest(`/categories/store/${store._id}`);
    
    // Create store info message
    let storeInfo = `🏪 *${store.name}*\n\n`;
    if (store.description) storeInfo += `📝 ${store.description}\n`;
    if (store.address) storeInfo += `📍 ${store.address}\n`;
    if (store.phone) storeInfo += `📞 ${store.phone}\n`;

    // Add social links if available
    if (store.facebookUrl || store.telegramUrl || store.websiteUrl) {
      storeInfo += '\n🔗 Follow us:\n';
      if (store.facebookUrl) storeInfo += `• [Facebook](${store.facebookUrl})\n`;
      if (store.telegramUrl) storeInfo += `• [Telegram](${store.telegramUrl})\n`;
      if (store.websiteUrl) storeInfo += `• [Website](${store.websiteUrl})\n`;
    }

    // Send store info
    await bot.sendMessage(chatId, storeInfo, { parse_mode: 'Markdown' });

    // Create category buttons
    if (categories && categories.length > 0) {
      const keyboard = categories.map(category => [
        { text: `📂 ${category.name}` }
      ]);
      
      // Add "All Items" and "Refresh" buttons
      keyboard.push([{ text: '🍽️ All Items' }]);
      keyboard.push([{ text: '🔄 Refresh Menu' }]);
      
      const replyMarkup = {
        keyboard: keyboard,
        resize_keyboard: true,
        one_time_keyboard: false
      };
      
      await bot.sendMessage(chatId, '📋 *Select a category to browse products:*', {
        parse_mode: 'Markdown',
        reply_markup: replyMarkup
      });
    } else {
      await bot.sendMessage(chatId, '📭 No categories available at the moment.');
    }
    
  } catch (error) {
    console.error('Start command error:', error);
    await bot.sendMessage(chatId, '❌ Error loading store information. Please try /start again.');
  }
});

// Handle category selection
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (text && text.startsWith('📂 ')) {
    const categoryName = text.slice(2);
    console.log(`📂 Category selected: ${categoryName} by chat ${chatId}`);
    
    try {
      await bot.sendMessage(chatId, `🔄 Loading ${categoryName}...`);
      
      const store = await apiRequest('/stores/public/slug/ysg');
      if (!store) {
        await bot.sendMessage(chatId, '❌ Store not available');
        return;
      }

      const products = await apiRequest('/products/public-store/slug/ysg');
      const categories = await apiRequest(`/categories/store/${store._id}`);
      
      const category = categories.find(cat => cat.name === categoryName);
      
      if (category && products) {
        const categoryProducts = products.filter(product => 
          product.category && product.category._id === category._id
        );

        if (categoryProducts.length > 0) {
          // Send category header
          await bot.sendMessage(chatId, `📂 *${categoryName}*\n_${categoryProducts.length} items available_`, {
            parse_mode: 'Markdown'
          });

          // Send each product with image
          for (const product of categoryProducts) {
            const price = product.price ? ` - ${product.price} 💵` : '';
            const available = product.isAvailable === false ? '❌ ' : '✅ ';
            const caption = `${available}*${product.title}*${price}\n${product.description || ''}`;
            
            const imageUrl = product.image || product.imageUrl;
            
            if (imageUrl) {
              try {
                await bot.sendPhoto(chatId, imageUrl, {
                  caption: caption,
                  parse_mode: 'Markdown'
                });
                // Small delay to avoid rate limits
                await new Promise(resolve => setTimeout(resolve, 500));
              } catch (photoError) {
                console.log('Photo send failed, sending as text:', photoError.message);
                await bot.sendMessage(chatId, caption, { parse_mode: 'Markdown' });
              }
            } else {
              await bot.sendMessage(chatId, caption, { parse_mode: 'Markdown' });
            }
          }
          
        } else {
          await bot.sendMessage(chatId, `📭 No items found in *${categoryName}*`, {
            parse_mode: 'Markdown'
          });
        }
      } else {
        await bot.sendMessage(chatId, '❌ Category not found');
      }
      
    } catch (error) {
      console.error('Category error:', error);
      await bot.sendMessage(chatId, '❌ Error loading category. Please try again.');
    }
  }
});

// Handle "All Items"
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (text === '🍽️ All Items') {
    console.log(`🍽️ All Items selected by chat ${chatId}`);
    
    try {
      await bot.sendMessage(chatId, '🔄 Loading all menu items...');
      
      const products = await apiRequest('/products/public-store/slug/ysg');
      
      if (products && products.length > 0) {
        // Group by category for better organization
        const productsByCategory = {};
        products.forEach(product => {
          const categoryName = product.category ? product.category.name : 'Uncategorized';
          if (!productsByCategory[categoryName]) {
            productsByCategory[categoryName] = [];
          }
          productsByCategory[categoryName].push(product);
        });

        // Send category summary first
        let summary = '🍽️ *All Menu Items*\n\n';
        Object.keys(productsByCategory).forEach(category => {
          summary += `📂 ${category}: ${productsByCategory[category].length} items\n`;
        });
        
        await bot.sendMessage(chatId, summary, { parse_mode: 'Markdown' });

        // Send each product with image
        for (const product of products) {
          const price = product.price ? ` - ${product.price} 💵` : '';
          const available = product.isAvailable === false ? '❌ ' : '✅ ';
          const caption = `${available}*${product.title}*${price}\n${product.description || ''}`;
          
          const imageUrl = product.image || product.imageUrl;
          
          if (imageUrl) {
            try {
              await bot.sendPhoto(chatId, imageUrl, {
                caption: caption,
                parse_mode: 'Markdown'
              });
              // Small delay to avoid rate limits
              await new Promise(resolve => setTimeout(resolve, 500));
            } catch (photoError) {
              console.log('Photo send failed, sending as text:', photoError.message);
              await bot.sendMessage(chatId, caption, { parse_mode: 'Markdown' });
            }
          } else {
            await bot.sendMessage(chatId, caption, { parse_mode: 'Markdown' });
          }
        }
        
        await bot.sendMessage(chatId, `✅ Loaded ${products.length} items total`);
      } else {
        await bot.sendMessage(chatId, '📭 No items found in the menu');
      }
      
    } catch (error) {
      console.error('All items error:', error);
      await bot.sendMessage(chatId, '❌ Error loading menu. Please try again.');
    }
  }
});

// Handle refresh
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (text === '🔄 Refresh Menu') {
    console.log(`🔄 Refresh requested by chat ${chatId}`);
    // Simply trigger the start command again
    const fakeMsg = { ...msg, text: '/start' };
    bot.emit('message', fakeMsg);
  }
});

// Help command
bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  console.log(`❓ Help command from chat ${chatId}`);
  
  const helpText = `🤖 *YSG Menu Bot Help*

*Commands:*
/start - Show store menu and categories
/help - Show this help message

*Features:*
• 🏪 View store information
• 📂 Browse products by category  
• 🍽️ See all items at once
• 🖼️ View product images
• 💵 See prices and descriptions
• 🔄 Refresh to get latest menu

*How to use:*
1. Send /start to begin
2. Use the buttons to navigate
3. Tap any category to see products
4. Products with images will be shown

*Need help?* Contact the store directly.`;

  bot.sendMessage(chatId, helpText, { parse_mode: 'Markdown' });
});

// Handle unknown commands
bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  // Only respond to text messages that aren't commands or buttons we handle
  if (text && 
      !text.startsWith('/') && 
      !text.startsWith('📂 ') && 
      text !== '🍽️ All Items' && 
      text !== '🔄 Refresh Menu') {
    bot.sendMessage(chatId, '🤔 I didn\'t understand that. Send /start to see the menu or /help for assistance.');
  }
});

// Error handling
bot.on('error', (error) => {
  console.error('🤖 Bot error:', error);
});

bot.on('polling_error', (error) => {
  console.error('📡 Polling error:', error);
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 YSG Telegram Bot server running on port ${PORT}`);
  console.log(`🤖 Bot started with token: ${BOT_TOKEN.substring(0, 10)}...`);
  console.log(`🌐 Health check: http://localhost:${PORT}/health`);
  console.log(`✅ Bot is ready! Send /start in Telegram to test.`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('🛑 Shutting down bot gracefully...');
  bot.stopPolling();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('🛑 Received SIGTERM, shutting down...');
  bot.stopPolling();
  process.exit(0);
});