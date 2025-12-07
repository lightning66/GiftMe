// Use same origin as the page (works when serving frontend from the backend)
const BACKEND_URL = window.location?.origin || 'http://localhost:3000';

// Read token and currentUser from sessionStorage
let userToken = sessionStorage.getItem('userToken');
let currentUser = sessionStorage.getItem('currentUser') ? JSON.parse(sessionStorage.getItem('currentUser')) : null;

const welcomeEl = document.getElementById('welcome');
const signOutBtn = document.getElementById('signOut');
const addItemBtn = document.getElementById('addItemBtn');
const itemLinkInput = document.getElementById('itemLink');
const itemsContainer = document.getElementById('itemsContainer');

// Display user photo and name in the top-right corner
const userPhotoEl = document.getElementById('userPhoto');
const userNameEl = document.getElementById('userName');

// Ensure the user is authenticated before showing dashboard
function ensureAuthenticated() {
    if (!userToken || !currentUser) {
        // Not authenticated — redirect back to main page
        window.location.href = '/index.html';
        return false;
    }
    return true;
}

async function loadItems() {
    try {
        const response = await fetch(`${BACKEND_URL}/items`, {
            headers: { 'Authorization': `Bearer ${userToken}` }
        });
        const items = await response.json();
        itemsContainer.innerHTML = '';
        items.forEach((item, index) => {
            const itemCard = document.createElement('div');
            itemCard.style = 'border: 1px solid #ccc; padding: 15px; border-radius: 5px; width: 200px; position: relative;';

            // Truncate long titles
            const truncatedTitle = item.title.length > 50 ? `${item.title.substring(0, 50)}...` : item.title;

            itemCard.innerHTML = `
                <button class="delete-btn" data-index="${index}" style="position: absolute; top: 5px; right: 5px; background: #f44336; color: white; border: none; border-radius: 50%; width: 25px; height: 25px; cursor: pointer;">×</button>
                <div style="position:absolute; top:8px; left:8px; background:rgba(0,0,0,0.6); color:#fff; padding:4px 8px; border-radius:4px; font-size:12px;">${item.source || ''}</div>
                <img src="${item.image ? `${BACKEND_URL}/proxy-image?url=${encodeURIComponent(item.image)}` : ''}" alt="${truncatedTitle}" style="width: 100%; height: 150px; object-fit: cover; border-radius: 5px;">
                <h3 style="font-size: 16px; margin: 10px 0;">${truncatedTitle}</h3>
                <p style="color: #4caf50; font-weight: bold;">${item.price || 'Price not available'}</p>
            `;

            itemsContainer.appendChild(itemCard);
        });

        // Add event listeners to delete buttons
        document.querySelectorAll('.delete-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const index = e.target.getAttribute('data-index');
                try {
                    const response = await fetch(`${BACKEND_URL}/items/${index}`, {
                        method: 'DELETE',
                        headers: { 'Authorization': `Bearer ${userToken}` }
                    });
                    if (response.ok) {
                        loadItems(); // Refresh list
                    } else {
                        alert('Failed to delete item.');
                    }
                } catch (err) {
                    console.error('Error deleting item:', err);
                    alert('Failed to delete item.');
                }
            });
        });
    } catch (err) {
        console.error('Error loading items:', err);
    }
}


// Flag set when user initiates manual sign-out to avoid automatic beacon
let isManualSignOut = false;

function sendSignOutBeacon(isAutomatic = false) {
    if (!currentUser) return;
    const params = new URLSearchParams();
    params.append('email', currentUser.email);
    params.append('automatic', isAutomatic ? 'true' : 'false');

    // sendBeacon accepts a USVString; URLSearchParams.toString() produces that
    navigator.sendBeacon(`${BACKEND_URL}/signout-beacon`, params.toString());
}

function init() {
    if (!ensureAuthenticated()) return;

    welcomeEl.textContent = `Welcome, ${currentUser.name}`;

    // Show user photo and name
    if (currentUser && currentUser.picture) {
        userPhotoEl.src = currentUser.picture;
    } else {
        userPhotoEl.src = '';
    }
    userNameEl.textContent = currentUser ? currentUser.name : 'User';

    // Load user's items
    loadItems();

    // Sign out button click handler
    signOutBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        isManualSignOut = true; // Set flag to prevent automatic beacon
        console.log('Sign-out button clicked');
        signOutBtn.disabled = true;
        signOutBtn.textContent = 'Signing out...';

        try {
            if (userToken) {
                console.log('Sending authenticated sign-out request...');
                const resp = await fetch(`${BACKEND_URL}/signout`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${userToken}`
                    },
                    keepalive: true
                });

                if (resp && (resp.ok || resp.status === 200)) {
                    console.log('Manual sign-out recorded by server');
                } else {
                    console.warn('Manual sign-out fetch returned non-OK:', resp && resp.status);
                }
            }
        } catch (err) {
            console.error('Error during manual sign-out fetch:', err);
        } finally {
            // Ensure a beacon backup
            try { sendSignOutBeacon(false); } catch (be) { console.warn('Beacon failed', be); }
            sessionStorage.removeItem('userToken');
            sessionStorage.removeItem('currentUser');
            window.location.href = '/index.html';
        }
    });

    // Handle page close/unload - log automatic sign-out when browser/tab closes
    window.addEventListener('beforeunload', () => {
        // don't send automatic beacon if user already initiated manual sign-out
        if (!isManualSignOut) sendSignOutBeacon(true);
    });

    // Backup for unload event
    window.addEventListener('unload', () => {
        if (!isManualSignOut) sendSignOutBeacon(true);
    });

    addItemBtn.addEventListener('click', async () => {
        const link = itemLinkInput.value.trim();
        if (!link) {
            alert('Please enter a valid product link.');
            return;
        }

        try {
            // Get optional price inputs
            const priceInput = document.getElementById('itemPrice').value.trim();
            const originalPriceInput = document.getElementById('itemOriginal').value.trim();
            const savingsInput = document.getElementById('itemSavings').value.trim();
            
            const fetchBody = { url: link };
            if (priceInput) fetchBody.price = parseFloat(priceInput);
            if (originalPriceInput) fetchBody.originalPrice = parseFloat(originalPriceInput);
            if (savingsInput) fetchBody.savings = parseFloat(savingsInput);
            
            const response = await fetch(`${BACKEND_URL}/fetch-item`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(fetchBody)
            });

            const data = await response.json();
            if (data.error) {
                alert(`Error: ${data.error}`);
                return;
            }

            // Save item to user's account (include url and source)
            const saveResponse = await fetch(`${BACKEND_URL}/add-item`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${userToken}`
                },
                body: JSON.stringify({ title: data.title, image: data.image, price: data.price, url: link, source: data.source })
            });

            if (!saveResponse.ok) {
                alert('Failed to save item.');
                return;
            }

            // Refresh items list
            loadItems();
            itemLinkInput.value = '';
            document.getElementById('itemPrice').value = '';
            document.getElementById('itemOriginal').value = '';
            document.getElementById('itemSavings').value = '';
        } catch (err) {
            console.error('Error adding item:', err);
            alert('Failed to add item. Please try again.');
        }
    });
}

init();
