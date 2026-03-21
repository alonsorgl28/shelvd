// ─── Supabase Auth for Shelvd ───

const SUPABASE_URL = 'https://ttdxdcxighxlauwcmhgk.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR0ZHhkY3hpZ2h4bGF1d2NtaGdrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxMTgzMzksImV4cCI6MjA4OTY5NDMzOX0.XLbEFU8xaCFk9B2yAjuyk2pRMW1casXn30zICv3bIu8';

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Make available globally
window.shelvdAuth = { supabase, currentUser: null, currentProfile: null };

// ─── DOM refs ───
const authScreen = document.getElementById('auth-screen');
const emailForm = document.getElementById('auth-email-form');
const emailInput = document.getElementById('auth-email');
const submitBtn = document.getElementById('auth-submit-btn');
const checkEmail = document.getElementById('auth-check-email');
const sentEmail = document.getElementById('auth-sent-email');
const backBtn = document.getElementById('auth-back-btn');
const usernameForm = document.getElementById('auth-username-form');
const usernameInput = document.getElementById('auth-username');
const usernamePreview = document.getElementById('username-preview-text');
const usernameError = document.getElementById('username-error');
const cardStamp = document.getElementById('library-card-stamp');
const cardNumber = document.getElementById('library-card-number');

// ─── Email form ───
emailForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = emailInput.value.trim();
    if (!email) return;

    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending...';

    const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
            emailRedirectTo: window.location.origin + window.location.pathname
        }
    });

    if (error) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Send magic link';
        console.error('Auth error:', error.message);
        return;
    }

    // Show "check email" step
    emailForm.style.display = 'none';
    checkEmail.style.display = 'flex';
    sentEmail.textContent = email;
});

// ─── Back button ───
backBtn.addEventListener('click', () => {
    checkEmail.style.display = 'none';
    emailForm.style.display = 'flex';
    submitBtn.disabled = false;
    submitBtn.textContent = 'Send magic link';
});

// ─── Username form ───
usernameInput.addEventListener('input', () => {
    const val = usernameInput.value.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
    usernameInput.value = val;
    usernamePreview.textContent = '@' + (val || '...');
    usernameError.textContent = '';
});

usernameForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = usernameInput.value.trim().toLowerCase();
    if (!username || username.length < 3) {
        usernameError.textContent = 'Username must be at least 3 characters';
        return;
    }

    const { error } = await supabase.from('profiles').insert({
        id: window.shelvdAuth.currentUser.id,
        username: username
    });

    if (error) {
        if (error.code === '23505') {
            usernameError.textContent = 'Username already taken';
        } else {
            usernameError.textContent = 'Something went wrong';
            console.error('Profile error:', error);
        }
        return;
    }

    window.shelvdAuth.currentProfile = { username };
    enterLibrary(username);
});

// ─── Auth state change ───
supabase.auth.onAuthStateChange(async (event, session) => {
    if (session?.user) {
        window.shelvdAuth.currentUser = session.user;

        // Update card number
        cardNumber.textContent = 'No. ' + session.user.id.substring(0, 6).toUpperCase();

        // Check if user has a profile
        const { data: profile } = await supabase
            .from('profiles')
            .select('username')
            .eq('id', session.user.id)
            .single();

        if (profile) {
            window.shelvdAuth.currentProfile = profile;
            // Stamp the card
            cardStamp.classList.add('stamped');
            setTimeout(() => enterLibrary(profile.username), 600);
        } else {
            // New user — show username picker
            emailForm.style.display = 'none';
            checkEmail.style.display = 'none';
            usernameForm.style.display = 'flex';
            cardStamp.classList.add('stamped');
        }
    }
});

// ─── Enter library ───
function enterLibrary(username) {
    // Update header
    const usernameEl = document.getElementById('library-user-username');
    if (usernameEl) usernameEl.textContent = '@' + username;

    // Show header
    document.querySelector('.library-user-header').style.display = '';

    // Update page title
    document.title = `Shelvd — @${username}`;

    // Animate out auth screen
    authScreen.classList.add('exiting');
    setTimeout(() => {
        authScreen.style.display = 'none';
        // Dispatch event so app.js knows to start
        window.dispatchEvent(new CustomEvent('shelvd:authenticated', {
            detail: { username }
        }));
    }, 600);
}

// ─── Check if already logged in on load ───
(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
        // Not logged in — auth screen stays visible
        authScreen.style.display = 'flex';
    }
    // If session exists, onAuthStateChange will handle it
})();
