// ─── Shelvd Analytics — lightweight event tracking via Supabase ───
//
// Table SQL (run in Supabase SQL editor):
//
//   create table events (
//     id uuid default gen_random_uuid() primary key,
//     event text not null,
//     props jsonb default '{}',
//     url text,
//     referrer text,
//     created_at timestamptz default now()
//   );
//   alter table events enable row level security;
//   create policy "anon_insert" on events for insert with check (true);
//   create policy "anon_select" on events for select using (false);
//

const SHELVD_EVENTS = {
    LANDING_VISIT: 'landing_visit',
    APP_VISIT: 'app_visit',
    AUTH_STARTED: 'auth_started',
    AUTH_COMPLETED: 'auth_completed',
    BOOK_ADDED: 'book_added',
    SHARE_CLICKED: 'share_clicked',
    PUBLIC_PROFILE_VIEWED: 'public_profile_viewed'
};

function shelvdTrack(event, props = {}) {
    try {
        const sb = window.shelvdAuth?.supabase;
        if (!sb) return;

        sb.from('events').insert({
            event,
            props,
            url: window.location.pathname,
            referrer: document.referrer || null
        }).then(() => {
            console.log('[Shelvd] Tracked:', event);
        }).catch(() => {
            // Silent fail — analytics should never break the app
        });
    } catch (e) {
        // Silent fail
    }
}

// Export for use by other modules
window.shelvdTrack = shelvdTrack;
window.SHELVD_EVENTS = SHELVD_EVENTS;
