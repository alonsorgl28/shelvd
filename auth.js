// ─── Supabase Auth for Shelvd ───

const SUPABASE_URL = 'https://ttdxdcxighxlauwcmhgk.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR0ZHhkY3hpZ2h4bGF1d2NtaGdrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxMTgzMzksImV4cCI6MjA4OTY5NDMzOX0.XLbEFU8xaCFk9B2yAjuyk2pRMW1casXn30zICv3bIu8';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        flowType: 'pkce',
        detectSessionInUrl: true
    }
});
window.shelvdAuth = { supabase: sb, currentUser: null, currentProfile: null };

// ─── DOM refs ───
const authScreen = document.getElementById('auth-screen');
const emailForm = document.getElementById('auth-email-form');
const magicLinkForm = document.getElementById('auth-magic-link-form');
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
const actionBar = document.getElementById('action-bar');
const utilityMenuToggle = document.getElementById('utility-menu-toggle');
const searchToggleBtn = document.getElementById('search-toggle-btn');

// ─── Check if viewing a public profile ───
function getPublicUsername() {
    const path = window.location.pathname;
    const match = path.match(/^\/@([a-zA-Z0-9_]+)/);
    return match ? match[1].toLowerCase() : null;
}

// ─── Auth state management ───
let hasEnteredLibrary = false;

async function handleSession(session) {
    if (hasEnteredLibrary) return;

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
        authScreen.style.display = 'flex';
        cardStamp.classList.add('stamped');
    }
}

// ─── Handle OAuth callback code manually ───
async function handleOAuthCallback() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');

    if (code) {
        console.log('[Shelvd] OAuth code detected, exchanging...');
        // Clean URL immediately
        window.history.replaceState({}, '', window.location.pathname);

        const { data, error } = await sb.auth.exchangeCodeForSession(code);
        if (error) {
            console.error('[Shelvd] Code exchange failed:', error.message);
        } else {
            console.log('[Shelvd] Code exchange success');
        }
        // Session will be handled by onAuthStateChange
        return true;
    }

    // Also check hash fragment (implicit flow / magic links)
    const hash = window.location.hash;
    if (hash && hash.includes('access_token')) {
        console.log('[Shelvd] Hash token detected');
        // Supabase client handles this automatically
        return true;
    }

    return false;
}

// ─── Auth listener ───
sb.auth.onAuthStateChange(async (event, session) => {
    console.log('[Shelvd] Auth event:', event, session ? 'has session' : 'no session');
    if (hasEnteredLibrary) return;

    // Public profile — skip auth entirely
    const publicUsername = getPublicUsername();
    if (publicUsername) {
        authScreen.style.display = 'none';
        enterLibrary(publicUsername, true);
        return;
    }

    if (session) {
        handleSession(session);
    } else if (event === 'INITIAL_SESSION') {
        // No session on initial load — show login
        authScreen.style.display = 'flex';
    }
});

// Process OAuth callback before anything else
handleOAuthCallback();

// ─── Auth redirect: always go to root (not back to /@username) ───
function getAuthRedirectUrl() {
    return window.location.origin + '/';
}

// ─── Google OAuth ───
document.getElementById('auth-google-btn').addEventListener('click', async () => {
    if (window.shelvdTrack) shelvdTrack('auth_started', { method: 'google' });
    const { error } = await sb.auth.signInWithOAuth({
        provider: 'google',
        options: {
            redirectTo: getAuthRedirectUrl()
        }
    });
    if (error) console.error('Google auth error:', error.message);
});

// ─── Magic link form ───
magicLinkForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = emailInput.value.trim();
    if (!email) return;

    if (window.shelvdTrack) shelvdTrack('auth_started', { method: 'magic_link' });
    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending...';

    const { error } = await sb.auth.signInWithOtp({
        email,
        options: {
            emailRedirectTo: getAuthRedirectUrl()
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
    if (hasEnteredLibrary) return;
    hasEnteredLibrary = true;

    const usernameEl = document.getElementById('library-user-username');
    if (usernameEl) usernameEl.textContent = '@' + username;

    document.querySelector('.library-user-header').style.display = '';
    document.title = `Shelvd — @${username}`;

    // Show action bar with staggered animation
    actionBar.style.display = '';
    closeUtilityMenu();
    document.getElementById('share-btn').setAttribute('data-username', username);

    // Hide owner-only buttons for public view
    if (isPublic) {
        document.getElementById('add-book-btn').style.display = 'none';
        document.getElementById('logout-btn').style.display = 'none';
        const ioBtn = document.getElementById('io-btn');
        if (ioBtn) ioBtn.style.display = 'none';
    }

    if (isPublic) {
        // Public view — skip auth animation, start immediately
        authScreen.style.display = 'none';
        if (window.shelvdTrack) shelvdTrack('public_profile_viewed', { username });
        window.dispatchEvent(new CustomEvent('shelvd:authenticated', {
            detail: { username, isPublic: true }
        }));
    } else {
        if (window.shelvdTrack) shelvdTrack('auth_completed', { username });
        authScreen.classList.add('exiting');
        setTimeout(() => {
            authScreen.style.display = 'none';
            window.dispatchEvent(new CustomEvent('shelvd:authenticated', {
                detail: { username }
            }));
        }, 600);
    }
}

function isMobileLibraryUI() {
    return window.matchMedia('(max-width: 768px)').matches;
}

function closeUtilityMenu() {
    if (!actionBar || !utilityMenuToggle) return;
    actionBar.classList.remove('mobile-open');
    utilityMenuToggle.classList.remove('active');
    utilityMenuToggle.setAttribute('aria-expanded', 'false');
}

function openUtilityMenu() {
    if (!actionBar || !utilityMenuToggle || !isMobileLibraryUI()) return;
    actionBar.classList.add('mobile-open');
    utilityMenuToggle.classList.add('active');
    utilityMenuToggle.setAttribute('aria-expanded', 'true');
}

if (utilityMenuToggle && actionBar) {
    utilityMenuToggle.addEventListener('click', (event) => {
        event.stopPropagation();
        if (!isMobileLibraryUI()) return;
        if (actionBar.classList.contains('mobile-open')) {
            closeUtilityMenu();
        } else {
            openUtilityMenu();
        }
    });

    document.addEventListener('click', (event) => {
        if (!isMobileLibraryUI() || !actionBar.classList.contains('mobile-open')) return;
        if (actionBar.contains(event.target) || utilityMenuToggle.contains(event.target)) return;
        closeUtilityMenu();
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closeUtilityMenu();
    });

    window.addEventListener('resize', () => {
        if (!isMobileLibraryUI()) closeUtilityMenu();
    });
}

if (searchToggleBtn) {
    searchToggleBtn.addEventListener('click', () => {
        if (isMobileLibraryUI()) closeUtilityMenu();
    });
}

// ─── Logout Button ───
document.getElementById('logout-btn').addEventListener('click', async () => {
    await sb.auth.signOut();
    // Clear local caches
    localStorage.removeItem('book-covers-cache');
    localStorage.removeItem('book-covers-version');
    window.location.href = '/';
});

// ─── Share Button ───
document.getElementById('share-btn').addEventListener('click', function () {
    const btn = this;
    if (btn.classList.contains('copied')) return;

    const username = btn.getAttribute('data-username') || 'user';
    const shareUrl = `${window.location.origin}/@${username}`;
    if (window.shelvdTrack) shelvdTrack('share_clicked', { username });

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

    // Subtle acknowledgement pulse
    btn.classList.add('stamping');

    // Switch to check icon
    setTimeout(() => {
        btn.classList.remove('stamping');
        btn.classList.add('copied');
        btn.querySelector('.share-label').textContent = 'Copied';
    }, 220);

    // Reset after 2s
    setTimeout(() => {
        btn.classList.remove('copied');
        btn.querySelector('.share-label').textContent = 'Share';
    }, 2200);
});

// ─── Add Book Modal ───

const addBtn = document.getElementById('add-book-btn');
const addModal = document.getElementById('add-book-modal');
const addBackdrop = document.getElementById('add-book-backdrop');
const addCard = addModal.querySelector('.add-book-card');
const ioBtn = document.getElementById('io-btn');
const logoutBtn = document.getElementById('logout-btn');
const captureZone = document.getElementById('add-capture-zone');
const fileInput = document.getElementById('add-book-input');
const stepCapture = document.getElementById('add-step-capture');
const stepAnalyzing = document.getElementById('add-step-analyzing');
const stepConfirm = document.getElementById('add-step-confirm');

let currentImageBase64 = null;
let currentImageBlob = null;
const ADD_MODAL_TRANSITION_MS = 340;
const ADD_BUTTON_HALO_MS = 480;
let addModalOpenFrame = null;
let addModalCloseTimeout = null;
let addModalHaloTimeout = null;

function clearAddModalTimers() {
    if (addModalOpenFrame) {
        cancelAnimationFrame(addModalOpenFrame);
        addModalOpenFrame = null;
    }

    if (addModalCloseTimeout) {
        clearTimeout(addModalCloseTimeout);
        addModalCloseTimeout = null;
    }

    if (addModalHaloTimeout) {
        clearTimeout(addModalHaloTimeout);
        addModalHaloTimeout = null;
    }
}

function setAddModalLaunchVector() {
    const addBtnRect = addBtn.getBoundingClientRect();
    const addCardRect = addCard.getBoundingClientRect();
    const addBtnCenterX = addBtnRect.left + (addBtnRect.width / 2);
    const addBtnCenterY = addBtnRect.top + (addBtnRect.height / 2);
    const addCardCenterX = addCardRect.left + (addCardRect.width / 2);
    const addCardCenterY = addCardRect.top + (addCardRect.height / 2);
    const originX = ((addBtnCenterX - addCardRect.left) / addCardRect.width) * 100;
    const originY = ((addBtnCenterY - addCardRect.top) / addCardRect.height) * 100;

    addModal.style.setProperty('--add-launch-x', `${addBtnCenterX - addCardCenterX}px`);
    addModal.style.setProperty('--add-launch-y', `${addBtnCenterY - addCardCenterY}px`);
    addModal.style.setProperty('--add-origin-x', `${originX}%`);
    addModal.style.setProperty('--add-origin-y', `${originY}%`);
}

function resetAddModalContent() {
    const stepChoose = document.getElementById('add-step-choose');
    if (stepChoose) {
        stepChoose.style.display = '';
        stepCapture.style.display = 'none';
    } else {
        stepCapture.style.display = '';
    }
    stepAnalyzing.style.display = 'none';
    stepConfirm.style.display = 'none';
}

function openAddModal() {
    if (addModal.classList.contains('is-open') || addModal.style.display === 'flex' || addModalCloseTimeout) return;

    closeUtilityMenu();
    clearAddModalTimers();
    resetAddModalContent();
    addBtn.classList.add('active');
    addBtn.classList.add('launching');
    addModal.classList.remove('is-open');
    addModal.style.display = 'flex';
    setAddModalLaunchVector();

    addModalOpenFrame = requestAnimationFrame(() => {
        addModal.classList.add('is-open');
        addModalOpenFrame = null;
    });

    addModalHaloTimeout = setTimeout(() => {
        addBtn.classList.remove('launching');
        addModalHaloTimeout = null;
    }, ADD_BUTTON_HALO_MS);
}

[addBtn, ioBtn, logoutBtn].forEach((button) => {
    if (!button) return;
    button.addEventListener('click', () => {
        if (isMobileLibraryUI()) closeUtilityMenu();
    });
});

function closeAddModal() {
    clearAddModalTimers();

    if (addModal.style.display !== 'flex') {
        addBtn.classList.remove('active');
        addBtn.classList.remove('launching');
        currentImageBase64 = null;
        currentImageBlob = null;
        return;
    }

    setAddModalLaunchVector();
    addModal.classList.remove('is-open');
    currentImageBase64 = null;
    currentImageBlob = null;

    addModalCloseTimeout = setTimeout(() => {
        addModal.style.display = 'none';
        addBtn.classList.remove('active');
        addBtn.classList.remove('launching');
        addModalCloseTimeout = null;
    }, ADD_MODAL_TRANSITION_MS);
}

addBtn.addEventListener('click', openAddModal);
addBackdrop.addEventListener('click', closeAddModal);
document.getElementById('add-close-btn').addEventListener('click', closeAddModal);
document.getElementById('add-confirm-close').addEventListener('click', closeAddModal);

captureZone.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', async (e) => {
    let file = e.target.files[0];
    if (!file) return;

    // Show upload spinner immediately
    const uploadSpinner = document.getElementById('add-upload-spinner');
    uploadSpinner.style.display = 'flex';

    // Convert HEIC/HEIF to JPEG (Chrome doesn't support HEIC natively)
    const name = file.name.toLowerCase();
    if (name.endsWith('.heic') || name.endsWith('.heif') || file.type === 'image/heic' || file.type === 'image/heif') {
        try {
            const blob = await window.heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 });
            file = new File([blob], file.name.replace(/\.heic|\.heif/i, '.jpg'), { type: 'image/jpeg' });
        } catch (err) {
            console.error('HEIC conversion failed:', err);
        }
    }

    currentImageBlob = file;

    // Resize image for API (max 1024px) and convert to base64
    const base64 = await resizeAndEncode(file, 1024);
    currentImageBase64 = base64;

    // Hide upload spinner, show analyzing step
    uploadSpinner.style.display = 'none';
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
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
            },
            body: JSON.stringify({ image: base64 })
        });
        const data = await resp.json();
        console.log('Vision result:', data);

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

        // Upload cover image to Supabase Storage (compressed)
        let coverUrl = null;
        if (currentImageBlob) {
            const compressedBlob = await compressForUpload(currentImageBlob, 800);
            const fileName = `${session.user.id}/${Date.now()}.jpg`;
            const { error: uploadErr } = await sb.storage
                .from('covers')
                .upload(fileName, compressedBlob, {
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

        if (window.shelvdTrack) shelvdTrack('book_added', { title, author });

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

// Compress image for Storage upload (max 800px, JPEG 0.8) — returns Blob
function compressForUpload(file, maxSize = 800) {
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
                canvas.toBlob((blob) => {
                    resolve(blob || file); // fallback to original if toBlob fails
                }, 'image/jpeg', 0.8);
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}

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
// Auth is handled by onAuthStateChange listener above
