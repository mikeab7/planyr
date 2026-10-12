-- B2244017 — the SECOND pinned test account (e2e-teammate@planyr.test), the teammate half of a
-- two-account sharing check (ui-audit/verify-shared-overlay-access.mjs, V1671200). Applied once to
-- production by the shipping session. Idempotent. Mirrors the primary test account's auth rows exactly
-- (email provider, confirmed, an EMPTY password hash so no password can ever match — it can only sign in through /api/auth/e2e-session, which
-- pins this id). It owns nothing and is on no team except the throwaway one a check creates and deletes.
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                        is_sso_user, is_anonymous, created_at, updated_at, encrypted_password,
                        confirmation_token, recovery_token, email_change, email_change_token_new,
                        email_change_token_current, phone_change, phone_change_token, reauthentication_token)
values ('e2e7ea4a-0b5f-4c1e-9d2a-224401700001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'e2e-teammate@planyr.test', now(), '{"provider":"email","providers":["email"]}'::jsonb, '{"email_verified":true}'::jsonb,
        false, false, now(), now(), '',  -- empty, not NULL: GoTrue cannot scan NULL into these string columns
        '', '', '', '', '', '', '', '')
on conflict (id) do nothing;

insert into auth.identities (user_id, provider, provider_id, identity_data, created_at, updated_at)
values ('e2e7ea4a-0b5f-4c1e-9d2a-224401700001', 'email', 'e2e7ea4a-0b5f-4c1e-9d2a-224401700001',
        '{"sub":"e2e7ea4a-0b5f-4c1e-9d2a-224401700001","email":"e2e-teammate@planyr.test","email_verified":false,"phone_verified":false}'::jsonb,
        now(), now())
on conflict do nothing;
