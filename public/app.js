// -------------------------------
// CONFIG
// -------------------------------
const GOOGLE_CLIENT_ID = '370263063492-kuvvnhgnmo44ugk5gpd68323515n6jsu.apps.googleusercontent.com'; // Replace with your Google Client ID
// Use same origin as the page (works when serving frontend from the backend)
const BACKEND_URL = window.location?.origin || 'http://localhost:3000';

// Store auth session
let userToken = sessionStorage.getItem("userToken");
let currentUser = sessionStorage.getItem("currentUser")
    ? JSON.parse(sessionStorage.getItem("currentUser"))
    : null;

// -----------------------------------------
// ON LOAD: Google Sign-in initialization
// -----------------------------------------
// Initialize Google Sign-In when the library is available.
function initGoogleSignIn() {
    if (!window.google || !google.accounts || !google.accounts.id) {
        // Retry a few times if the library hasn't loaded yet
        let retries = 0;
        const maxRetries = 20;
        const interval = setInterval(() => {
            retries++;
            if (window.google && google.accounts && google.accounts.id) {
                clearInterval(interval);
                initGoogleSignIn();
            } else if (retries >= maxRetries) {
                clearInterval(interval);
                console.error('Google Identity library failed to load.');
            }
        }, 250);
        return;
    }

    try {
        google.accounts.id.initialize({
            client_id: GOOGLE_CLIENT_ID,
            callback: handleCredentialResponse,
        });

        const container = document.getElementById("googleSignUpButton");
        if (!container) {
            console.error('Google sign-up container not found: #googleSignUpButton');
            return;
        }

        google.accounts.id.renderButton(
            container,
            { theme: "outline", size: "large", text: "signin_with" }
        );
    } catch (err) {
        console.error('Failed to initialize Google Sign-In:', err);
    }
}

// Start initialization after DOM content is loaded
if (document.readyState === 'complete' || document.readyState === 'interactive') {
    initGoogleSignIn();
} else {
    window.addEventListener('DOMContentLoaded', initGoogleSignIn);
}

// -----------------------------------------
// GOOGLE LOGIN CALLBACK
// -----------------------------------------
function handleCredentialResponse(response) {
    console.log("Received Google credential...");

    fetch(`${BACKEND_URL}/exchange`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: response.credential }),
    })
        .then((res) => res.json())
        .then((data) => {
            if (data.success) {
                // Store session locally
                userToken = response.credential;
                currentUser = data.user;

                sessionStorage.setItem("userToken", userToken);
                sessionStorage.setItem("currentUser", JSON.stringify(currentUser));

                console.log("Sign-in successful. Redirecting to dashboard...");
                
                // Redirect to dashboard page on successful signup (without alert for smoother UX)
                setTimeout(() => {
                    window.location.href = "/dashboard.html";
                }, 500);
            } else {
                alert("Signup failed: " + data.error);
            }
        })
        .catch((err) => {
            console.error("Signup error:", err);
            alert("Error during signup: " + err.message);
        });
}
