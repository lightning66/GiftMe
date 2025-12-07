// GiftMe Backend Server
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const cheerio = require('cheerio');

const app = express();
app.use(cors({ origin: ['http://localhost:5500', 'http://127.0.0.1:5500', 'http://localhost:3000'] }));
app.use(express.json());

const PORT = process.env.PORT || 3000;
const USERS_FILE = path.join(__dirname, 'users.json');
const SIGNIN_LOGS_FILE = path.join(__dirname, 'signin_logs.json');

if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, JSON.stringify([], null, 2));
if (!fs.existsSync(SIGNIN_LOGS_FILE)) fs.writeFileSync(SIGNIN_LOGS_FILE, JSON.stringify([], null, 2));

function getUsers() {
    try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch { return []; }
}

function saveUsers(u) { fs.writeFileSync(USERS_FILE, JSON.stringify(u, null, 2)); }

function addUser(userData) {
    const users = getUsers();
    const existing = users.find(x => x.email === userData.email);
    if (!existing) {
        users.push({ id: userData.id, email: userData.email, name: userData.name, picture: userData.picture, provider: 'google', items: [], signupDate: new Date().toISOString() });
        saveUsers(users);
        return true;
    }
    return false;
}

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Access token required' });
    try {
        const decoded = jwt.decode(token);
        if (!decoded) return res.status(401).json({ error: 'Invalid token' });
        req.user = decoded;
        next();
    } catch (e) { return res.status(401).json({ error: 'Token decode failed' }); }
}

app.post('/exchange', (req, res) => {
    const token = req.body && req.body.token;
    if (!token) return res.status(400).json({ error: 'missing_token' });
    const decoded = jwt.decode(token);
    if (!decoded) return res.status(400).json({ error: 'invalid_token' });
    const userInfo = { id: decoded.sub, email: decoded.email, name: decoded.name, picture: decoded.picture };
    const isNew = addUser(userInfo);
    try {
        const logs = JSON.parse(fs.readFileSync(SIGNIN_LOGS_FILE, 'utf8')) || [];
        logs.push({ email: userInfo.email, action: 'sign_in', timestamp: new Date().toISOString() });
        fs.writeFileSync(SIGNIN_LOGS_FILE, JSON.stringify(logs, null, 2));
    } catch (e) {}
    res.json({ success: true, user: userInfo, isNewUser: isNew });
});

// Fetch item details: extract title, image, and price
app.post('/fetch-item', async (req, res) => {
    const { url, price: userPrice, originalPrice, savings } = req.body || {};
    if (!url) return res.status(400).json({ error: 'URL is required' });
    
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 12000);
        
        const response = await fetch(url, { 
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer': 'https://www.google.com/',
                'Cookie': 'session=true'
            }, 
            signal: controller.signal,
            compress: true
        });
        clearTimeout(timeout);
        
        if (!response.ok) return res.status(502).json({ error: `Upstream fetch failed with status ${response.status}` });
        
        const html = await response.text();
        const $ = cheerio.load(html);
        
        let title = $('meta[property="og:title"]').attr('content') ||
                   $('meta[name="title"]').attr('content') ||
                   $('title').text().trim().substring(0, 200) || '';

        // Attempt to extract structured data (JSON-LD) which many retailers include
        let jsonLdData = null;
        try {
            $('script[type="application/ld+json"]').each((i, el) => {
                const raw = $(el).contents().text().trim();
                if (!raw) return;
                try {
                    const parsed = JSON.parse(raw);
                    // prefer Product or array containing Product
                    if (parsed) {
                        if (Array.isArray(parsed)) {
                            parsed.forEach(p => { if (!jsonLdData && p && (p['@type'] === 'Product' || p.product)) jsonLdData = p; });
                        } else if (!jsonLdData && (parsed['@type'] === 'Product' || parsed.product || parsed.offers)) {
                            jsonLdData = parsed;
                        }
                    }
                } catch (e) { /* ignore JSON parse errors */ }
            });
        } catch (e) {}

        // Try multiple image selectors to find the best image
        let image = $('meta[property="og:image"]').attr('content') ||
                   $('link[rel="image_src"]').attr('href') ||
                   $('meta[name="image"]').attr('content') ||
                   $('meta[property="twitter:image"]').attr('content') ||
                   $('meta[property="twitter:image:src"]').attr('content') ||
                   '';

        // If JSON-LD provided image(s), prefer them
        if ((!image || image.length === 0) && jsonLdData) {
            if (jsonLdData.image) {
                if (Array.isArray(jsonLdData.image)) image = jsonLdData.image[0];
                else if (typeof jsonLdData.image === 'string') image = jsonLdData.image;
                else if (jsonLdData.image.url) image = jsonLdData.image.url;
            }
            if ((!title || title.length === 0) && (jsonLdData.name || jsonLdData.title)) {
                title = jsonLdData.name || jsonLdData.title;
            }
        }

        // If still no image, try common img attributes (data-src, srcset, itemprop)
        if (!image) {
            const img = $('img[itemprop="image"]').first() || $('img[data-src], img[data-lazy-src], img[srcset], img').first();
            if (img && img.length) {
                image = img.attr('data-src') || img.attr('data-lazy-src') || img.attr('src') || '';
                // if srcset, take the largest candidate
                const srcset = img.attr('srcset');
                if ((!image || image.length === 0) && srcset) {
                    const parts = srcset.split(',').map(s => s.trim().split(' '));
                    if (parts.length) image = parts[parts.length - 1][0];
                }
            }
        }

        let price = 'Price not available';

        // If JSON-LD offers include price, prefer that (most reliable) but keep the numeric value too
        let jsonLdPriceNumber = null;
        if (jsonLdData && jsonLdData.offers) {
            try {
                const offers = Array.isArray(jsonLdData.offers) ? jsonLdData.offers[0] : jsonLdData.offers;
                if (offers && (offers.price || offers.priceSpecification || offers.priceCurrency)) {
                    const p = offers.price || (offers.priceSpecification && offers.priceSpecification.price) || null;
                    const q = p || offers.price;
                    if (q) {
                        jsonLdPriceNumber = parseFloat(String(q).replace(/[^0-9.]/g, ''));
                        if (!isNaN(jsonLdPriceNumber)) price = (offers.priceCurrency ? offers.priceCurrency + ' ' : '') + `$${jsonLdPriceNumber.toFixed(2)}`.replace('undefined ', '');
                    }
                }
            } catch (e) {}
        }

        // If user provided price data, use it (override extracted)
        if (userPrice) {
            price = typeof userPrice === 'number' ? `$${userPrice.toFixed(2)}` : userPrice;
        } else if (originalPrice && savings) {
            // If user provided original and savings, calculate current
            const orig = parseFloat(originalPrice);
            const save = parseFloat(savings);
            const current = orig - save;
            price = `$${Math.max(0, current).toFixed(2)}`;
        } else {
            // First, try meta and itemprop price tags which are more reliable than raw regex
            const metaPrice = $('meta[property="product:price:amount"]').attr('content') || $('meta[itemprop="price"]').attr('content') || $('meta[name="price"]').attr('content');
            if (metaPrice) {
                const mp = parseFloat(String(metaPrice).replace(/[^0-9.]/g, ''));
                if (!isNaN(mp)) price = `$${mp.toFixed(2)}`;
            }

            if (price === 'Price not available') {
                const itempropPrice = $('[itemprop="price"]').first().attr('content') || $('[itemprop="price"]').first().text();
                if (itempropPrice) {
                    const ip = parseFloat(String(itempropPrice).replace(/[^0-9.]/g, ''));
                    if (!isNaN(ip)) price = `$${ip.toFixed(2)}`;
                }
            }

            // Before using regex fallback, search scripts for known JSON keys used by some retailers that reliably contain the product price
            let scriptFoundPrice = null;
            try {
                const scriptsText = $('script').map((i, el) => $(el).html()).get().join('\n');
                // Match both plain and escaped quotes around keys, e.g. "current_retail" or current_retail
                const m1 = scriptsText.match(/(?:\\")?current_retail(?:\\")?\s*:\s*([0-9]+(?:\.[0-9]+)?)/i);
                if (m1 && m1[1]) scriptFoundPrice = parseFloat(m1[1]);
                const m2 = scriptsText.match(/(?:\\")?formatted_current_price(?:\\")?\s*:\s*"\$([0-9,]+(?:\.[0-9]+)?)"/i);
                if (m2 && m2[1] && !scriptFoundPrice) scriptFoundPrice = parseFloat(String(m2[1]).replace(/,/g, ''));
                const m3 = scriptsText.match(/"price"\s*:\s*\{[^}]*"current_retail"\s*:\s*([0-9]+(?:\.[0-9]+)?)/i);
                if (m3 && m3[1] && !scriptFoundPrice) scriptFoundPrice = parseFloat(m3[1]);
            } catch (e) {}
            if (!isNaN(scriptFoundPrice) && scriptFoundPrice) {
                // If JSON-LD price is available, prefer the higher value (handles cases where JSON-LD lists a sale/unit price)
                if (jsonLdPriceNumber && !isNaN(jsonLdPriceNumber)) {
                    price = `$${Math.max(jsonLdPriceNumber, scriptFoundPrice).toFixed(2)}`;
                } else {
                    price = `$${scriptFoundPrice.toFixed(2)}`;
                }
            }

            // Last resort: regex from raw HTML (keeps previous behavior)
            if (price === 'Price not available') {
                const priceRegex = /\$[0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?/g;
                const allPrices = html.match(priceRegex) || [];
                const uniquePrices = [...new Set(allPrices)].map(p => parseFloat(p.replace(/[^0-9.]/g, ''))).filter(n => !isNaN(n)).sort((a, b) => a - b);
                if (uniquePrices.length > 0) {
                    price = `$${uniquePrices[0].toFixed(2)}`;
                }
            }
        }
        
        let source = '';
        try { source = new URL(url).hostname.replace(/^www\./, ''); } catch (e) { source = url; }
        
        // Resolve relative URLs to absolute and handle protocol-relative URLs
        if (image && image.length) {
            image = String(image).trim();
            if (image.startsWith('//')) image = 'https:' + image;
            if (!image.startsWith('http')) {
                try { image = new URL(image, url).href; } catch (e) { image = ''; }
            }
        }
        
        // Clean up the response
        res.json({ 
            title: title || 'Untitled Item', 
            image: image || '', 
            price, 
            source, 
            url 
        });
        
    } catch (err) {
        clearTimeout(timeout);
        if (err.name === 'AbortError') {
            return res.status(504).json({ error: 'Page load timed out - try providing price manually' });
        }
        console.error('fetch-item error:', err && err.message);
        res.status(500).json({ error: 'Failed to fetch item - try providing price manually' });
    }
});

app.get('/proxy-image', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).send('Image URL required');
    if (!/^https?:\/\//i.test(url)) return res.status(400).send('Invalid image URL');
    try {
        const r = await fetch(url);
        if (!r.ok) return res.status(502).send('Failed to fetch image');
        res.setHeader('Content-Type', r.headers.get('content-type') || 'image/*');
        r.body.pipe(res);
    } catch (e) {
        console.error('proxy-image', e && e.message);
        res.status(500).send('Error fetching image');
    }
});

app.post('/add-item', authenticateToken, (req, res) => {
    try {
        const { title, image, price, url, source } = req.body || {};
        const users = getUsers();
        const user = users.find(u => u.email === req.user.email);
        if (!user) return res.status(404).json({ error: 'User not found' });
        user.items = user.items || [];
        user.items.push({ title, image, price, url: url || '', source: source || '', addedAt: new Date().toISOString() });
        saveUsers(users);
        res.json({ success: true });
    } catch (e) {
        console.error('add-item', e && e.message);
        res.status(500).json({ error: 'Failed to add item' });
    }
});

app.get('/items', authenticateToken, (req, res) => {
    const users = getUsers();
    const user = users.find(u => u.email === req.user.email);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user.items || []);
});

app.delete('/items/:index', authenticateToken, (req, res) => {
    const idx = parseInt(req.params.index);
    const users = getUsers();
    const user = users.find(u => u.email === req.user.email);
    if (!user || isNaN(idx) || idx < 0 || idx >= (user.items || []).length) return res.status(404).json({ error: 'Item not found' });
    user.items.splice(idx, 1);
    saveUsers(users);
    res.json({ success: true });
});

app.get('/users/:email', (req, res) => {
    const users = getUsers();
    const user = users.find(u => u.email === req.params.email);
    if (user) res.json(user);
    else res.status(404).json({ error: 'User not found' });
});

app.delete('/users/:email', (req, res) => {
    let users = getUsers();
    const initialLength = users.length;
    users = users.filter(u => u.email !== req.params.email);
    if (users.length < initialLength) {
        saveUsers(users);
        res.json({ success: true, message: 'User deleted' });
    } else {
        res.status(404).json({ error: 'User not found' });
    }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Serve static files from public folder
app.use(express.static(path.join(__dirname, 'public')));

// Fallback to index.html for SPA routing
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`🎁 GiftMe Server running on http://localhost:${PORT}`));
