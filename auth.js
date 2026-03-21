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

// ─── Check if viewing a public profile ───
function getPublicUsername() {
    const path = window.location.pathname;
    const match = path.match(/^\/@([a-zA-Z0-9_]+)/);
    return match ? match[1].toLowerCase() : null;
}

// ─── Check session on load ───
async function checkAuth() {
    const publicUsername = getPublicUsername();

    // If visiting /@username → load public profile, no login needed
    if (publicUsername) {
        authScreen.style.display = 'none';
        enterLibrary(publicUsername, true);
        return;
    }

    // Otherwise check if logged in
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
function enterLibrary(username, isPublic) {
    const usernameEl = document.getElementById('library-user-username');
    if (usernameEl) usernameEl.textContent = '@' + username;

    document.querySelector('.library-user-header').style.display = '';
    document.title = `Shelvd — @${username}`;

    // Show share button
    const shareBtn = document.getElementById('share-btn');
    shareBtn.style.display = '';
    shareBtn.setAttribute('data-username', username);

    // Show add book button only for logged-in users (not public view)
    if (!isPublic) {
        document.getElementById('add-book-btn').style.display = '';
    }

    if (isPublic) {
        // Public view — skip auth animation, start immediately
        authScreen.style.display = 'none';
        window.dispatchEvent(new CustomEvent('shelvd:authenticated', {
            detail: { username, isPublic: true }
        }));
    } else {
        authScreen.classList.add('exiting');
        setTimeout(() => {
            authScreen.style.display = 'none';
            window.dispatchEvent(new CustomEvent('shelvd:authenticated', {
                detail: { username }
            }));
        }, 600);
    }
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

// ─── Add Book Modal ───
const SUPABASE_URL = 'https://ttdxdcxighxlauwcmhgk.supabase.co';

const addBtn = document.getElementById('add-book-btn');
const addModal = document.getElementById('add-book-modal');
const addBackdrop = document.getElementById('add-book-backdrop');
const captureZone = document.getElementById('add-capture-zone');
const fileInput = document.getElementById('add-book-input');
const stepCapture = document.getElementById('add-step-capture');
const stepAnalyzing = document.getElementById('add-step-analyzing');
const stepConfirm = document.getElementById('add-step-confirm');

let currentImageBase64 = null;
let currentImageBlob = null;

function openAddModal() {
    addModal.style.display = 'flex';
    stepCapture.style.display = '';
    stepAnalyzing.style.display = 'none';
    stepConfirm.style.display = 'none';
}

function closeAddModal() {
    addModal.style.display = 'none';
    currentImageBase64 = null;
    currentImageBlob = null;
}

addBtn.addEventListener('click', openAddModal);
addBackdrop.addEventListener('click', closeAddModal);
document.getElementById('add-close-btn').addEventListener('click', closeAddModal);
document.getElementById('add-confirm-close').addEventListener('click', closeAddModal);

captureZone.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    currentImageBlob = file;

    // Resize image for API (max 1024px) and convert to base64
    const base64 = await resizeAndEncode(file, 1024);
    currentImageBase64 = base64;

    // Show analyzing step
    stepCapture.style.display = 'none';
    stepAnalyzing.style.display = '';

    // Show preview
    const previewUrl = URL.createObjectURL(file);
    document.getElementById('add-preview-analyzing').innerHTML =
        `<img src="${previewUrl}" alt="preview">`;

    // Call edge function
    try {
        const resp = await fetch(`${SUPABASE_URL}/functions/v1/analyze-book`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image: base64 })
        });
        const data = await resp.json();

        // Show confirm step
        stepAnalyzing.style.display = 'none';
        stepConfirm.style.display = '';

        document.getElementById('add-preview-confirm').innerHTML =
            `<img src="${previewUrl}" alt="cover">`;
        document.getElementById('add-field-title').value = data.title || '';
        document.getElementById('add-field-author').value = data.author || '';
        document.getElementById('add-field-pages').value = data.pages || 250;
    } catch (err) {
        console.error('Analyze error:', err);
        // Show confirm with empty fields
        stepAnalyzing.style.display = 'none';
        stepConfirm.style.display = '';
        document.getElementById('add-preview-confirm').innerHTML =
            `<img src="${previewUrl}" alt="cover">`;
    }

    fileInput.value = '';
});

// Retake
document.getElementById('add-retake-btn').addEventListener('click', () => {
    stepConfirm.style.display = 'none';
    stepCapture.style.display = '';
});

// Add to shelf
document.getElementById('add-confirm-btn').addEventListener('click', async () => {
    const title = document.getElementById('add-field-title').value.trim();
    const author = document.getElementById('add-field-author').value.trim();
    const pages = parseInt(document.getElementById('add-field-pages').value) || 250;

    if (!title) return;

    const confirmBtn = document.getElementById('add-confirm-btn');
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Adding...';

    try {
        const { data: { session } } = await sb.auth.getSession();
        if (!session) {
            confirmBtn.textContent = 'Session expired';
            return;
        }

        // Upload cover image to Supabase Storage
        let coverUrl = null;
        if (currentImageBlob) {
            const fileName = `${session.user.id}/${Date.now()}.jpg`;
            const { error: uploadErr } = await sb.storage
                .from('covers')
                .upload(fileName, currentImageBlob, {
                    contentType: 'image/jpeg',
                    upsert: false
                });

            if (!uploadErr) {
                const { data: urlData } = sb.storage
                    .from('covers')
                    .getPublicUrl(fileName);
                coverUrl = urlData.publicUrl;
            }
        }

        // Insert book into database
        const { data: book, error: insertErr } = await sb
            .from('books')
            .insert({
                user_id: session.user.id,
                title,
                author,
                pages,
                cover: coverUrl
            })
            .select()
            .single();

        if (insertErr) {
            console.error('Insert error:', insertErr);
            confirmBtn.textContent = 'Error — try again';
            confirmBtn.disabled = false;
            return;
        }

        // Dispatch event so app.js can add the book to the 3D scene
        window.dispatchEvent(new CustomEvent('shelvd:book-added', {
            detail: { book, coverUrl }
        }));

        // Update book count
        const countEl = document.getElementById('header-book-count');
        const currentCount = parseInt(countEl.textContent) || 0;
        countEl.textContent = (currentCount + 1) + ' books';

        closeAddModal();
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Add to shelf';
    } catch (err) {
        console.error('Add book error:', err);
        confirmBtn.textContent = 'Error — try again';
        confirmBtn.disabled = false;
    }
});

// Resize image and return base64 (without data:... prefix)
function resizeAndEncode(file, maxSize) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = function (e) {
            const img = new Image();
            img.onload = function () {
                const canvas = document.createElement('canvas');
                let w = img.width;
                let h = img.height;
                if (w > maxSize || h > maxSize) {
                    const scale = maxSize / Math.max(w, h);
                    w = Math.round(w * scale);
                    h = Math.round(h * scale);
                }
                canvas.width = w;
                canvas.height = h;
                canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
                resolve(dataUrl.split(',')[1]); // strip data:image/jpeg;base64,
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}

// ─── Start ───
checkAuth();
