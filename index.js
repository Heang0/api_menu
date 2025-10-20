const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

// Your bot token
const BOT_TOKEN = '8338081238:AAHeUKy9XL7kgeUUvXdQExCMp9nQtqUhrFQ';
const API_BASE_URL = 'https://menuqrcode.onrender.com/api';

// Initialize bot
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

app.use(express.json());

// Health check
app.get('/', (req, res) => {
  res.send('✅ YSG Bot is running on Render with Node.js!');
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', platform: 'nodejs' });
});

// API helper function
async function apiRequest(endpoint) {
  try {
    const response = await axios.get(`${API_BASE_URL}${endpoint}`);
    return response.data;
  } catch (error) {
    console.error('API Error:', error.message);
    return null;
  }
}

// Start command
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  
  try {
    const store = await apiRequest('/stores/public/slug/ysg');
    if (!store) {
      bot.sendMessage(chatId, '❌ Store not available');
      return;
    }

    // Get categories
    const categories = await apiRequest(`/categories/store/${store._id}`);
    
    // Create store info
    let storeInfo = `🏪 *${store.name}*\n`;
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
      
      const replyMarkup = {
        keyboard: keyboard,
        resize_keyboard: true
      };
      
      await bot.sendMessage(chatId, '📋 *Select a category:*', {
        parse_mode: 'Markdown',
        reply_markup: replyMarkup
      });
    } else {
      await bot.sendMessage(chatId, '📭 No categories available');
    }
    
  } catch (error) {
    console.error('Start error:', error);
    bot.sendMessage(chatId, '❌ Error loading store information');
  }
});

// Handle category selection
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (text && text.startsWith('📂 ')) {
    const categoryName = text.slice(2);
    
    try {
      const store = await apiRequest('/stores/public/slug/ysg');
      if (!store) {
        bot.sendMessage(chatId, '❌ Store not available');
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
          // Send each product with image
          for (const product of categoryProducts) {
            const price = product.price ? ` - ${product.price}` : '';
            const caption = `*${product.title}*${price}\n${product.description || ''}`;
            
            const imageUrl = product.image || product.imageUrl;
            
            if (imageUrl) {
              try {
                await bot.sendPhoto(chatId, imageUrl, {
                  caption: caption,
                  parse_mode: 'Markdown'
                });
              } catch (photoError) {
                // If photo fails, send as text
                await bot.sendMessage(chatId, caption, { parse_mode: 'Markdown' });
              }
            } else {
              await bot.sendMessage(chatId, caption, { parse_mode: 'Markdown' });
            }
          }
          
          await bot.sendMessage(chatId, `📂 *${categoryName}* - ${categoryProducts.length} items`, {
            parse_mode: 'Markdown'
          });
        } else {
          await bot.sendMessage(chatId, `📭 No items found in ${categoryName}`);
        }
      } else {
        await bot.sendMessage(chatId, '❌ Category not found');
      }
      
    } catch (error) {
      console.error('Category error:', error);
      bot.sendMessage(chatId, '❌ Error loading category');
    }
  }
});

// Handle "All Items"
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (text === '🍽️ All Items') {
    try {
      const products = await apiRequest('/products/public-store/slug/ysg');
      
      if (products && products.length > 0) {
        // Send each product with image
        for (const product of products) {
          const price = product.price ? ` - ${product.price}` : '';
          const caption = `*${product.title}*${price}\n${product.description || ''}`;
          
          const imageUrl = product.image || product.imageUrl;
          
          if (imageUrl) {
            try {
              await bot.sendPhoto(chatId, imageUrl, {
                caption: caption,
                parse_mode: 'Markdown'
              });
            } catch (photoError) {
              // If photo fails, send as text
              await bot.sendMessage(chatId, caption, { parse_mode: 'Markdown' });
            }
          } else {
            await bot.sendMessage(chatId, caption, { parse_mode: 'Markdown' });
          }
        }
        
        await bot.sendMessage(chatId, `🍽️ *All Items* - ${products.length} items total`, {
          parse_mode: 'Markdown'
        });
      } else {
        await bot.sendMessage(chatId, '📭 No items found in the menu');
      }
      
    } catch (error) {
      console.error('All items error:', error);
      bot.sendMessage(chatId, '❌ Error loading menu');
    }
  }
});

// Help command
bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  const helpText = `🤖 *YSG Menu Bot Help*

*Commands:*
/start - Show store menu
/help - Show this help

*Features:*
• Browse menu by categories  
• See all items with images
• View prices and descriptions

Use the buttons to navigate!`;
  
  bot.sendMessage(chatId, helpText, { parse_mode: 'Markdown' });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 YSG Bot running on port ${PORT}`);
  console.log('🤖 Telegram bot started with polling...');
});

// Error handling
bot.on('error', (error) => {
  console.error('Bot error:', error);
});

bot.on('polling_error', (error) => {
  console.error('Polling error:', error);
});