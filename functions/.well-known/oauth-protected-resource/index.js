/* GET /.well-known/oauth-protected-resource and /.well-known/oauth-protected-resource/api/mcp (RFC 9728): tells an
 * MCP client that /api/mcp is protected by Planyr's own OAuth server. See functions/api/oauth/_lib.js. */
import { originOf, protectedResourceMetadata } from "../../api/oauth/_lib.js";
import { metadataReply } from "../_metadata.js";
export const onRequest = (context) => metadataReply(context.request, protectedResourceMetadata(originOf(context.request)));
