# LarkGPT 🤖️

LarkGPT is a bot application running OpenAI's text completion engine and image creation engine for Lark (Feishu).

✅ Private and Group Chat Supported

✅ Private Session Context for Each User

✅ Image Creation Supported

✅ Bot Initialization Command Supported

## Quick Start

1. Clone the project and install dependencies.
```bash
git clone https://github.com/yiheyang/larkgpt.git
yarn # or `npm install`
```
2. Configure your LarkGPT.
```bash
cp .env.example .env

# Edit .env
```
3. Start your LarkGPT and check your robot is running on the port (default: 3000).
```bash
yarn start # or `npm start`
```
4. Configure "Request URL" with `http(s)://domain:port/event` and add "Message received [v2.0] - im.message.receive_v1" event in "Event Subscription" - "Lark Developer App Panel".
5. Go to "Permissions & Scopes" and add all permissions that "im.message.receive_v1" requires and the following permissions.
- im:message
- im:message:send_as_bot
- im:resource
6. Turn on "Features/Bot" ability.

## Robot Command
```text
/help help message
/reset # Reset user's session context
/img <prompt> # Generate an image with the given prompt
```
## LICENCE
This project is under the protection of MIT license.
