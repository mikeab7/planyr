/* GET /.well-known/oauth-authorization-server (RFC 8414) — where "Connect to Claude" signs in. See functions/api/oauth/_lib.js. */
import { authorizationServerMetadata, originOf } from "../api/oauth/_lib.js";
import { metadataReply } from "./_metadata.js";
export const onRequest = (context) => metadataReply(context.request, authorizationServerMetadata(originOf(context.request)));
