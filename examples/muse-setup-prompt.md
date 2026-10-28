# Muse custom connector setup request

Replace the example domains below, then send this request to Muse.
Do NOT include the bearer token in the chat.

Create a private custom connector named "My openGym workouts". The server
speaks stateless MCP over Streamable HTTP and exposes read-only tools.

MCP endpoint:
https://YOUR_CONNECTOR_HOST/mcp?instance=https%3A%2F%2Fha.yourdomain.com%2Fopengym

Auth: HTTP Authorization: Bearer with my own openGym paired-account token.
Ask me for this credential in Muse's **secure credentials prompt**; do not
ask me to paste it into chat or store it inside connector source code.
If Muse does not offer a secure prompt, stop and tell me rather than
collecting my secret in the conversation.

Use only workout_summary, recent_workouts and training_plan to retrieve
workout data from my account. Do not make any writes.

Test the connector with tools/list, then use workout_summary for 30 days.
