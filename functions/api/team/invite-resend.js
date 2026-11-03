/* /api/team/invite-resend — the invitee emails themselves their invitation again. Thin Pages Function wrapper;
 * all logic + the contract live in ../lib/inviteResend.js. */
import { handleInviteResend } from "../lib/inviteResend.js";

export const onRequest = ({ env, request }) => handleInviteResend({ env, request });
