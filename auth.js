// ─── Supabase Auth for Shelvd ───

const SUPABASE_URL = 'https://ttdxdcxighxlauwcmhgk.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR0ZHhkY3hpZ2h4bGF1d2NtaGdrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxMTgzMzksImV4cCI6MjA4OTY5NDMzOX0.XLbEFU8xaCFk9B2yAjuyk2pRMW1casXn30zICv3bIu8';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
window.shelvdAuth = { supabase: sb, currentUser: null, currentProfile: null };

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

// ─── Check session on load ───
async function checkAuth() {
    const { data: { session } } = await sb.auth.getSession();

    if (!session) {
        authScreen.style.display = 'flex';
        return;
    }

    window.shelvdAuth.currentUser = session.user;
    cardNumber.textContent = 'No. ' + session.user.id.substring(0, 6).toUpperCase();

    // Look up profile
    const { data: profile } = await sb
        .from('profiles')
        .select('username')
        .eq('id', session.user.id)
        .maybeSingle();

    if (profile && profile.username) {
        window.shelvdAuth.currentProfile = profile;
        cardStamp.classList.add('stamped');
        enterLibrary(profile.username);
    } else {
        // New user — show username picker
        emailForm.style.display = 'none';
        checkEmail.style.display = 'none';
        usernameForm.style.display = 'flex';
        cardStamp.classList.add('stamped');
    }
}

// ─── Listen for auth changes (magic link callback) ───
sb.auth.onAuthStateChange(async (event) => {
    if (event === 'SIGNED_IN') {
        checkAuth();
    }
});

// ─── Email form ───
emailForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = emailInput.value.trim();
    if (!email) return;

    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending...';

    const { error } = await sb.auth.signInWithOtp({
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

    const { data: { session } } = await sb.auth.getSession();
    if (!session) {
        usernameError.textContent = 'Session expired — please reload';
        return;
    }

    const { error } = await sb.from('profiles').insert({
        id: session.user.id,
        username: username
    });

    if (error) {
        if (error.code === '23505') {
            // Could be our own profile already exists
            const { data: existing } = await sb
                .from('profiles')
                .select('username')
                .eq('id', session.user.id)
                .maybeSingle();
            if (existing) {
                enterLibrary(existing.username);
                return;
            }
            usernameError.textContent = 'Username already taken';
        } else {
            usernameError.textContent = error.message || 'Something went wrong';
        }
        return;
    }

    window.shelvdAuth.currentProfile = { username };
    enterLibrary(username);
});

// ─── Enter library ───
function enterLibrary(username) {
    const usernameEl = document.getElementById('library-user-username');
    if (usernameEl) usernameEl.textContent = '@' + username;

    document.querySelector('.library-user-header').style.display = '';
    document.title = `Shelvd — @${username}`;

    // Show share button
    const shareBtn = document.getElementById('share-btn');
    shareBtn.style.display = '';
    shareBtn.setAttribute('data-username', username);

    authScreen.classList.add('exiting');
    setTimeout(() => {
        authScreen.style.display = 'none';
        window.dispatchEvent(new CustomEvent('shelvd:authenticated', {
            detail: { username }
        }));
    }, 600);
}

// ─── Share Button ───
document.getElementById('share-btn').addEventListener('click', function () {
    const btn = this;
    if (btn.classList.contains('copied')) return;

    const username = btn.getAttribute('data-username') || 'user';
    const shareUrl = `${window.location.origin}/@${username}`;

    // Copy to clipboard
    navigator.clipboard.writeText(shareUrl).catch(() => {
        // Fallback
        const ta = document.createElement('textarea');
        ta.value = shareUrl;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
    });

    // Stamp animation
    btn.classList.add('stamping');

    // Burst particles
    const container = document.getElementById('share-particles');
    container.innerHTML = '';
    const colors = ['rgba(255,228,196,0.8)', 'rgba(255,214,165,0.7)', 'rgba(200,184,160,0.6)'];
    for (let i = 0; i < 10; i++) {
        const p = document.createElement('div');
        p.className = 'share-particle';
        const angle = (i / 10) * Math.PI * 2;
        const dist = 20 + Math.random() * 25;
        const tx = Math.cos(angle) * dist;
        const ty = Math.sin(angle) * dist;
        p.style.background = colors[i % colors.length];
        p.style.animation = `particleBurst 0.6s ease-out forwards`;
        p.style.setProperty('--tx', tx + 'px');
        p.style.setProperty('--ty', ty + 'px');
        p.style.left = '0px';
        p.style.top = '0px';
        container.appendChild(p);
        // Set final position via inline keyframe
        p.animate([
            { transform: 'translate(0,0) scale(1)', opacity: 1 },
            { transform: `translate(${tx}px, ${ty}px) scale(0.3)`, opacity: 0 }
        ], { duration: 600, easing: 'ease-out', fill: 'forwards' });
    }

    // Switch to check icon
    setTimeout(() => {
        btn.classList.remove('stamping');
        btn.classList.add('copied');
        btn.querySelector('.share-label').textContent = 'Copied';
    }, 300);

    // Reset after 2s
    setTimeout(() => {
        btn.classList.remove('copied');
        btn.querySelector('.share-label').textContent = 'Share';
        container.innerHTML = '';
    }, 2500);
});

// ─── Start ───
checkAuth();
