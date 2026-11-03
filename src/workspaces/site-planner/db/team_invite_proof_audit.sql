-- READ-ONLY audit (NEW-1, 2026-11-02): who is on a team through the old address-match door? Run in the Supabase SQL
-- editor. Changes nothing, removes nobody, and prints COUNTS ONLY — no address, name or id.
--
-- "claimed_never_emailed": a team_members row whose team has a CLAIMED invite for that same member's address that
--   was never emailed (last_sent_at is null). The sign-up trigger used to claim such an invite the instant the
--   address registered, so a nonzero count is the shape an address-match join leaves behind. It is a LEAD to look
--   at, not proof of misuse: an admin who typed an address in and had the person sign up later also leaves it
--   (the invite email can fail to send), and rows from before last_sent_at existed (2026-10-04) read null too.
-- "claimed_total":   every member whose membership matches a claimed invite for their own address (the denominator).
-- "members_total":   all team_members rows.
with matched as (
  select m.team_id, m.user_id, i.id as invite_id, i.last_sent_at
  from public.team_members m
  join public.profiles p on p.id = m.user_id
  join public.team_invites i
    on i.team_id = m.team_id and lower(trim(i.email)) = lower(trim(p.email)) and i.claimed_at is not null
)
select 'members_total'::text as metric, count(*)::bigint as n from public.team_members
union all select 'claimed_total', count(*) from matched
union all select 'claimed_never_emailed', count(*) from matched where last_sent_at is null
union all select 'claimed_emailed', count(*) from matched where last_sent_at is not null;
